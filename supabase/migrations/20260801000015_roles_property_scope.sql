-- Guard OS — Migration 15: บทบาท + สิทธิ์ตามโครงการ + Super Admin สลับ Vendor
-- (15 ต.ค. 2569 · ตามคำขอคุณเต๋)
--
-- 1) owner/admin ของ Vendor เห็นทุกโครงการในบริษัทตัวเอง
--    supervisor / shift_leader / client เห็นเฉพาะโครงการที่ผูกไว้ใน property_managers
-- 2) Super Admin (platform_admins) สลับไปดู Vendor ใดก็ได้ — token ออกโดย edge function auth-line
--    (app_metadata.tenant_id = Vendor ที่เลือก, user_role = owner, acting = true)
-- 3) save_user — สร้าง/แก้ผู้ใช้ในหน้าเดียว: Vendor, บทบาท, โครงการที่ดูแล, สถานะ Super Admin

-- ============================================================
-- helper: ผู้ใช้คนนี้เห็นโครงการนี้ไหม
-- ============================================================
create or replace function can_see_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_tenant_admin()
      or exists (select 1 from property_managers pm
                 where pm.user_id = auth_user_id() and pm.property_id = p_property_id)
$$;

-- ============================================================
-- ปรับ RLS: ฝั่ง staff ที่ไม่ใช่ owner/admin เห็นเฉพาะโครงการที่ผูกไว้
-- ============================================================
drop policy if exists properties_select on properties;
create policy properties_select on properties for select
  using (
    tenant_id = auth_tenant_id() and (
      is_tenant_admin()
      or (auth_user_role() in ('supervisor','shift_leader','client') and can_see_property(id))
      or client_user_id = auth_user_id()
      or exists (
        select 1 from shift_assignments sa
        where sa.property_id = properties.id
          and sa.user_id = auth_user_id()
          and sa.status <> 'cancelled'
      )
    )
  );

drop policy if exists templates_select on shift_templates;
create policy templates_select on shift_templates for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff() and can_see_property(property_id));

drop policy if exists assignments_select on shift_assignments;
create policy assignments_select on shift_assignments for select
  using (tenant_id = auth_tenant_id()
         and (user_id = auth_user_id() or (is_tenant_staff() and can_see_property(property_id))));

drop policy if exists attendance_select on attendance;
create policy attendance_select on attendance for select
  using (tenant_id = auth_tenant_id()
         and (user_id = auth_user_id() or (is_tenant_staff() and can_see_property(property_id))));

drop policy if exists checkpoints_select on checkpoints;
create policy checkpoints_select on checkpoints for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff() and can_see_property(property_id));

drop policy if exists scans_select on patrol_scans;
create policy scans_select on patrol_scans for select
  using (tenant_id = auth_tenant_id()
         and (user_id = auth_user_id() or (is_tenant_staff() and can_see_property(property_id))));

-- ============================================================
-- list_properties_for_tenant — รายชื่อโครงการของ Vendor ใดๆ (ใช้ในฟอร์มผู้ใช้)
-- ============================================================
create or replace function list_properties_for_tenant(p_tenant_id uuid)
returns table (id uuid, name text, code text, province text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_tenant(p_tenant_id) then return; end if;
  return query
  select p.id, p.name, p.code, p.province from properties p
  where p.tenant_id = p_tenant_id and p.is_active order by p.name;
end $$;

-- ============================================================
-- list_user_access — โครงการที่ผูก + สถานะ Super Admin ของผู้ใช้ใน Vendor ที่เลือก
-- ============================================================
create or replace function list_user_access(p_tenant_id uuid)
returns table (user_id uuid, property_ids uuid[], is_platform_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_tenant(p_tenant_id) then return; end if;
  return query
  select u.id,
         coalesce((select array_agg(pm.property_id) from property_managers pm where pm.user_id = u.id), '{}'),
         exists (select 1 from platform_admins pa where pa.user_id = u.id)
  from users u where u.tenant_id = p_tenant_id;
end $$;

-- ============================================================
-- save_user — สร้าง (p_id null) หรือแก้ผู้ใช้ พร้อมบทบาท/โครงการ/Super Admin
-- ============================================================
create or replace function save_user(
  p_id uuid, p_tenant_id uuid,
  p_employee_code text, p_full_name text, p_phone text, p_role text,
  p_daily_wage numeric, p_weekly_day_off integer,
  p_property_ids uuid[], p_platform_admin boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_old users%rowtype;
  v_was_pa boolean;
begin
  if not can_manage_tenant(p_tenant_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_role not in ('owner','admin','supervisor','shift_leader','guard','client') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  -- ตั้ง owner ได้เฉพาะ owner ของ Vendor หรือ Super Admin
  if p_role = 'owner' and not (auth_user_role() = 'owner' or is_platform_admin()) then
    return jsonb_build_object('ok', false, 'error', 'owner_requires_owner');
  end if;
  -- ตั้ง/ถอด Super Admin ได้เฉพาะ Super Admin
  if p_platform_admin is not null and not is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'platform_admin_requires_platform_admin');
  end if;
  if p_platform_admin = false and p_id = auth_user_id() then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_own_platform_admin');
  end if;
  -- โครงการที่ผูกต้องเป็นของ Vendor เดียวกัน
  if exists (select 1 from unnest(coalesce(p_property_ids, '{}')) x(pid)
             where not exists (select 1 from properties p where p.id = x.pid and p.tenant_id = p_tenant_id)) then
    return jsonb_build_object('ok', false, 'error', 'property_not_in_vendor');
  end if;

  if v_id is null then
    insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_day_off)
    values (p_tenant_id, trim(p_employee_code), trim(p_full_name), nullif(trim(p_phone), ''),
            p_role, p_daily_wage, p_weekly_day_off)
    returning id into v_id;
  else
    select * into v_old from users where id = v_id;
    if v_old.id is null or v_old.tenant_id <> p_tenant_id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    -- กันลดตำแหน่งตัวเอง และกัน Vendor ไม่มี owner เหลือ
    if v_id = auth_user_id() and v_old.role <> p_role then
      return jsonb_build_object('ok', false, 'error', 'cannot_change_own_role');
    end if;
    if v_old.role = 'owner' and p_role <> 'owner'
       and not exists (select 1 from users where tenant_id = p_tenant_id and role = 'owner'
                       and is_active and id <> v_id) then
      return jsonb_build_object('ok', false, 'error', 'last_owner');
    end if;
    update users set
      employee_code  = coalesce(nullif(trim(p_employee_code), ''), employee_code),
      full_name      = coalesce(nullif(trim(p_full_name), ''), full_name),
      phone          = nullif(trim(p_phone), ''),
      role           = p_role,
      daily_wage     = p_daily_wage,
      weekly_day_off = p_weekly_day_off
    where id = v_id;
  end if;

  -- โครงการที่ดูแล: ใช้กับ supervisor / shift_leader / client เท่านั้น
  delete from property_managers where user_id = v_id;
  if p_role in ('supervisor','shift_leader','client') then
    insert into property_managers (user_id, property_id, tenant_id)
    select v_id, x.pid, p_tenant_id from unnest(coalesce(p_property_ids, '{}')) x(pid)
    on conflict do nothing;
  end if;

  -- Super Admin
  if p_platform_admin is not null then
    v_was_pa := exists (select 1 from platform_admins where user_id = v_id);
    if p_platform_admin and not v_was_pa then
      insert into platform_admins (user_id) values (v_id);
    elsif not p_platform_admin and v_was_pa then
      delete from platform_admins where user_id = v_id;
    end if;
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (p_tenant_id, auth_user_id(), case when p_id is null then 'create_user' else 'update_user' end,
          'users', v_id::text,
          jsonb_build_object('role', p_role, 'properties', p_property_ids, 'platform_admin', p_platform_admin));

  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'duplicate_employee_code');
end $$;

revoke execute on function
  can_see_property(uuid), list_properties_for_tenant(uuid), list_user_access(uuid),
  save_user(uuid,uuid,text,text,text,text,numeric,integer,uuid[],boolean)
from anon, public;
grant execute on function
  can_see_property(uuid), list_properties_for_tenant(uuid), list_user_access(uuid),
  save_user(uuid,uuid,text,text,text,text,numeric,integer,uuid[],boolean)
to authenticated;
