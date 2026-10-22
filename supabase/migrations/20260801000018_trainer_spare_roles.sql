-- Guard OS — Migration 18: บทบาทใหม่ ครูฝึก (trainer) + ตัวสแปร์ (spare)
-- รันหลัง migration 17 · รันซ้ำได้
-- ครูฝึก / ผู้ช่วยสายตรวจ / ตัวสแปร์: เช็คอิน-เอาต์ได้ทุกโครงการที่ผูกไว้แม้ไม่มีกะ (ไม่เกิน 10 โครงการ) · ไม่เข้าหลังบ้าน

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('owner','admin','supervisor','assistant_supervisor','trainer','spare','shift_leader','guard','client'));

create or replace function project_limit(p_role text) returns integer
language sql immutable as $$
  select case when p_role = 'guard' then 5
              when p_role in ('supervisor','assistant_supervisor','trainer','spare','shift_leader','client') then 10
              else 0 end
$$;

-- บันทึกผู้ใช้: รับบทบาทใหม่
create or replace function save_user(
  p_id uuid, p_tenant_id uuid,
  p_employee_code text, p_full_name text, p_phone text, p_role text,
  p_daily_wage numeric, p_weekly_days_off smallint[],
  p_property_ids uuid[], p_platform_admin boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_old users%rowtype;
  v_props uuid[] := coalesce(p_property_ids, '{}');
  v_days smallint[] := coalesce((select array_agg(distinct d order by d) from unnest(p_weekly_days_off) d where d between 0 and 6), '{}');
begin
  if not can_manage_tenant(p_tenant_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_role not in ('owner','admin','supervisor','assistant_supervisor','trainer','spare','shift_leader','guard','client') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  if p_role = 'owner' and not (auth_user_role() = 'owner' or is_platform_admin()) then
    return jsonb_build_object('ok', false, 'error', 'owner_requires_owner');
  end if;
  if p_platform_admin is not null and not is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'platform_admin_requires_platform_admin');
  end if;
  if p_platform_admin = false and p_id = auth_user_id() then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_own_platform_admin');
  end if;
  if project_limit(p_role) = 0 then v_props := '{}'; end if;
  if cardinality(v_props) > project_limit(p_role) then
    return jsonb_build_object('ok', false, 'error', 'project_limit_exceeded', 'limit', project_limit(p_role));
  end if;
  if exists (select 1 from unnest(v_props) x(pid)
             where not exists (select 1 from properties p where p.id = x.pid and p.tenant_id = p_tenant_id)) then
    return jsonb_build_object('ok', false, 'error', 'property_not_in_vendor');
  end if;

  if v_id is null then
    insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off, weekly_day_off)
    values (p_tenant_id, trim(p_employee_code), trim(p_full_name), nullif(trim(p_phone), ''),
            p_role, p_daily_wage, v_days, v_days[1])
    returning id into v_id;
  else
    select * into v_old from users where id = v_id;
    if v_old.id is null or v_old.tenant_id <> p_tenant_id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_id = auth_user_id() and v_old.role <> p_role then
      return jsonb_build_object('ok', false, 'error', 'cannot_change_own_role');
    end if;
    if v_old.role = 'owner' and p_role <> 'owner'
       and not exists (select 1 from users where tenant_id = p_tenant_id and role = 'owner' and is_active and id <> v_id) then
      return jsonb_build_object('ok', false, 'error', 'last_owner');
    end if;
    update users set
      employee_code  = coalesce(nullif(trim(p_employee_code), ''), employee_code),
      full_name      = coalesce(nullif(trim(p_full_name), ''), full_name),
      phone          = nullif(trim(p_phone), ''),
      role           = p_role,
      daily_wage     = p_daily_wage,
      weekly_days_off = v_days,
      weekly_day_off  = v_days[1]
    where id = v_id;
  end if;

  delete from property_managers where user_id = v_id;
  insert into property_managers (user_id, property_id, tenant_id)
  select v_id, x.pid, p_tenant_id from unnest(v_props) x(pid) on conflict do nothing;

  if p_platform_admin is not null then
    if p_platform_admin then
      insert into platform_admins (user_id) values (v_id) on conflict do nothing;
    else
      delete from platform_admins where user_id = v_id;
    end if;
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (p_tenant_id, auth_user_id(), case when p_id is null then 'create_user' else 'update_user' end,
          'users', v_id::text, jsonb_build_object('role', p_role, 'properties', v_props, 'platform_admin', p_platform_admin));
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'duplicate_employee_code');
end $$;


-- เช็คอินไม่มีกะ: ครูฝึก/ตัวสแปร์ ใช้แบบเดียวกับสายตรวจ (kind = adhoc)
create or replace function adhoc_check_in(
  p_property_id uuid, p_lat double precision, p_lng double precision, p_selfie_url text,
  p_device_fingerprint text default null, p_user_agent text default null, p_gps_is_mock boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := auth_user_role();
  v_kind text;
  v_prop properties%rowtype;
  v_point geography := case when p_lat is not null and p_lng is not null
                            then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist numeric; v_dev_id uuid; v_dev devices%rowtype; v_flag text := null;
  v_next timestamptz; v_end timestamptz; v_aid uuid;
begin
  v_kind := case when is_platform_admin() then 'emergency'   -- Super Admin: เฉพาะโครงการทดสอบ
                 when v_role in ('supervisor','assistant_supervisor','trainer','spare') then 'adhoc'
                 when v_role in ('guard','shift_leader') then 'emergency' end;
  if v_kind is null then return jsonb_build_object('ok', false, 'error', 'role_not_allowed'); end if;

  select * into v_prop from properties where id = p_property_id and tenant_id = auth_tenant_id() and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'property_not_found'); end if;
  if is_platform_admin() and not v_prop.is_test then
    return jsonb_build_object('ok', false, 'error', 'platform_admin_test_only');
  end if;
  if not v_prop.is_test
     and not exists (select 1 from property_managers where user_id = auth_user_id() and property_id = p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member_of_project');
  end if;
  if exists (select 1 from shift_assignments where user_id = auth_user_id() and status = 'checked_in') then
    return jsonb_build_object('ok', false, 'error', 'already_checked_in');
  end if;
  if exists (select 1 from shift_assignments where user_id = auth_user_id() and status = 'scheduled'
             and now() between starts_at - interval '45 minutes' and ends_at) then
    return jsonb_build_object('ok', false, 'error', 'use_scheduled_shift');
  end if;

  if v_point is not null then
    v_dist := check_geofence(p_property_id, v_point);
    if v_dist > 0 then return jsonb_build_object('ok', false, 'error', 'outside_geofence', 'distance_m', v_dist); end if;
  else
    v_flag := 'no_gps';
  end if;
  if p_device_fingerprint is not null then
    v_dev_id := upsert_device(p_device_fingerprint, p_user_agent);
    select * into v_dev from devices where id = v_dev_id;
    if v_dev.is_blocked then return jsonb_build_object('ok', false, 'error', 'device_blocked'); end if;
  end if;
  if p_gps_is_mock then v_flag := coalesce(v_flag || ',', '') || 'mock_gps_suspected'; end if;
  if v_kind = 'emergency' then v_flag := coalesce(v_flag || ',', '') || 'emergency'; end if;

  -- เวลาจบชั่วคราว: 12 ชม. หรือก่อนกะถัดไปของคนนี้ (กันชนกะ) — ตอนเช็คเอาต์จะตัดให้ตรงเวลาจริง
  select min(starts_at) into v_next from shift_assignments
  where user_id = auth_user_id() and status <> 'cancelled' and starts_at > now();
  v_end := least(now() + interval '12 hours', coalesce(v_next - interval '1 minute', now() + interval '12 hours'));
  if v_end <= now() + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'next_shift_too_soon');
  end if;

  insert into shift_assignments (tenant_id, property_id, user_id, starts_at, ends_at, status, kind, created_by)
  values (v_prop.tenant_id, p_property_id, auth_user_id(), now(), v_end, 'checked_in', v_kind, auth_user_id())
  returning id into v_aid;
  insert into attendance (tenant_id, property_id, user_id, assignment_id, check_in_at, in_location,
                          in_selfie_url, in_distance_m, late_minutes, device_id, is_mock_flag, flag_reason)
  values (v_prop.tenant_id, p_property_id, auth_user_id(), v_aid, now(), v_point,
          p_selfie_url, v_dist, 0, v_dev_id, p_gps_is_mock, v_flag);
  return jsonb_build_object('ok', true, 'assignment_id', v_aid, 'kind', v_kind, 'checked_in_at', now(),
                            'property', v_prop.name, 'no_gps', v_point is null);
end $$;


