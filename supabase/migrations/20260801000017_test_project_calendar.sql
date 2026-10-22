-- Guard OS — Migration 17: โครงการทดสอบของ Super Admin + ปฏิทินกะในแอป LINE
-- รันหลัง migration 16 · รันซ้ำได้
--
-- 1) properties.is_test — โครงการทดสอบ: เห็นได้เฉพาะ Super Admin, ไม่นับในภาพรวม/รายงานของ Vendor
-- 2) Super Admin เป็นยามได้เฉพาะในโครงการทดสอบ (กันข้อมูลทดสอบปนกับลูกค้า)
-- 3) สร้างโครงการทดสอบให้ Super Admin ทุกคนอัตโนมัติ
-- 4) my_calendar() — ปฏิทินกะในแอป: ยาม/สายตรวจ/Super Admin เห็นเฉพาะกะตัวเอง
--    เจ้าของ/แอดมิน Vendor เห็นกะทุกโครงการของบริษัท · ลูกค้าเจ้าของโครงการเห็นกะของโครงการตน

-- ============================================================
-- 1) ธงโครงการทดสอบ + การมองเห็น
-- ============================================================
alter table properties add column if not exists is_test boolean not null default false;

create or replace function is_test_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_test from properties where id = p_property_id), false)
$$;

create or replace function can_see_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (not is_test_property(p_property_id) or is_platform_admin())
     and (is_tenant_admin()
          or exists (select 1 from property_managers pm
                     where pm.user_id = auth_user_id() and pm.property_id = p_property_id))
$$;

drop policy if exists properties_select on properties;
create policy properties_select on properties for select
  using (
    tenant_id = auth_tenant_id() and (not is_test or is_platform_admin()) and (
      is_tenant_admin()
      or can_see_property(id)
      or client_user_id = auth_user_id()
      or exists (select 1 from shift_assignments sa
                 where sa.property_id = properties.id and sa.user_id = auth_user_id() and sa.status <> 'cancelled')
    )
  );
-- นโยบายแบบ restrictive: ซ้อนทับทุก policy เดิม (รวม *_write แบบ for all) → ซ่อนโครงการทดสอบจากทุกคนยกเว้น Super Admin
-- กะ/การลงเวลา/การสแกนของตัวเองยังเห็นได้เสมอ
drop policy if exists properties_hide_test on properties;
create policy properties_hide_test on properties as restrictive for select
  using (not is_test or is_platform_admin());
drop policy if exists templates_hide_test on shift_templates;
create policy templates_hide_test on shift_templates as restrictive for select
  using (not is_test_property(property_id) or is_platform_admin());
drop policy if exists checkpoints_hide_test on checkpoints;
create policy checkpoints_hide_test on checkpoints as restrictive for select
  using (not is_test_property(property_id) or is_platform_admin());
drop policy if exists assignments_hide_test on shift_assignments;
create policy assignments_hide_test on shift_assignments as restrictive for select
  using (user_id = auth_user_id() or not is_test_property(property_id) or is_platform_admin());
drop policy if exists attendance_hide_test on attendance;
create policy attendance_hide_test on attendance as restrictive for select
  using (user_id = auth_user_id() or not is_test_property(property_id) or is_platform_admin());
drop policy if exists scans_hide_test on patrol_scans;
create policy scans_hide_test on patrol_scans as restrictive for select
  using (user_id = auth_user_id() or not is_test_property(property_id) or is_platform_admin());

create or replace view v_properties with (security_invoker = on) as
select
  p.id, p.tenant_id, p.name, p.code, p.province, p.district, p.subdistrict, p.postcode,
  p.address, p.geofence_radius_m, p.billing_rate_per_guard_day,
  p.contract_start, p.contract_end, p.client_user_id, p.is_active, p.created_at,
  st_y(p.center::geometry) as lat,
  st_x(p.center::geometry) as lng,
  p.is_test
from properties p;

-- ============================================================
-- 2) Super Admin เป็นยามได้เฉพาะโครงการทดสอบ · โครงการทดสอบรับเฉพาะ Super Admin
-- ============================================================
create or replace function trg_test_project_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_test boolean; v_pa boolean;
begin
  v_test := is_test_property(new.property_id);
  v_pa := exists (select 1 from platform_admins where user_id = new.user_id);
  if v_test and not v_pa then
    raise exception 'test_project_platform_admin_only' using hint = 'โครงการทดสอบจ่ายกะได้เฉพาะ Super Admin';
  end if;
  if v_pa and not v_test then
    raise exception 'platform_admin_test_only' using hint = 'Super Admin เป็นยามได้เฉพาะในโครงการทดสอบ';
  end if;
  return new;
end $$;
drop trigger if exists shift_assignments_test_guard on shift_assignments;
create trigger shift_assignments_test_guard before insert or update of user_id, property_id on shift_assignments
  for each row execute function trg_test_project_guard();

-- โครงการทดสอบไม่นับเพดานจำนวนโครงการ
create or replace function trg_property_managers_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text; v_n integer;
begin
  if is_test_property(new.property_id) then return new; end if;
  select role into v_role from users where id = new.user_id;
  select count(*) into v_n from property_managers pm
  where pm.user_id = new.user_id and not is_test_property(pm.property_id);
  if v_n > project_limit(v_role) then
    raise exception 'project_limit_exceeded' using hint = format('%s ผูกได้ไม่เกิน %s โครงการ', v_role, project_limit(v_role));
  end if;
  return new;
end $$;

-- ============================================================
-- 3) โครงการทดสอบของ Super Admin (อยู่ในบริษัทของตัวเอง ไม่มีพิกัด = เช็คอินได้ทุกที่)
-- ============================================================
insert into properties (tenant_id, name, code, is_test, province)
select distinct u.tenant_id, 'โครงการทดสอบ (Super Admin)', 'TEST', true, 'ทดสอบ'
from platform_admins pa join users u on u.id = pa.user_id
where not exists (select 1 from properties p where p.tenant_id = u.tenant_id and p.is_test);

-- my_projects: Super Admin เห็นโครงการทดสอบเสมอ (ใช้ปุ่มเข้างานฉุกเฉินได้)
create or replace function my_projects()
returns table (property_id uuid, property_name text, province text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.province
  from properties p
  where p.tenant_id = auth_tenant_id() and p.is_active
    and case when is_platform_admin() then p.is_test
             else not p.is_test and exists (select 1 from property_managers pm
                                             where pm.user_id = auth_user_id() and pm.property_id = p.id) end
  order by p.name
$$;

-- ============================================================
-- 4) adhoc_check_in — เพิ่ม: Super Admin เข้างานฉุกเฉินได้ในโครงการทดสอบ
-- ============================================================
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
                 when v_role in ('supervisor','assistant_supervisor') then 'adhoc'
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


-- ============================================================
-- 5) ปฏิทินกะในแอป LINE
-- ============================================================
create or replace function my_calendar(p_from date, p_to date)
returns table (
  assignment_id uuid, starts_at timestamptz, ends_at timestamptz, status text, kind text,
  is_holiday_work boolean, property_id uuid, property_name text, user_name text, is_mine boolean
)
language sql stable security definer set search_path = public as $$
  select sa.id, sa.starts_at, sa.ends_at, sa.status, sa.kind, sa.is_holiday_work,
         p.id, p.name, u.full_name, sa.user_id = auth_user_id()
  from shift_assignments sa
  join properties p on p.id = sa.property_id
  join users u on u.id = sa.user_id
  where sa.tenant_id = auth_tenant_id()
    and sa.status <> 'cancelled'
    and sa.starts_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
    and sa.starts_at <  ((least(p_to, p_from + 62) + 1)::timestamp at time zone 'Asia/Bangkok')
    and (
      sa.user_id = auth_user_id()
      or (not is_platform_admin() and not p.is_test and (
            auth_user_role() in ('owner','admin')
            or (auth_user_role() = 'client' and p.client_user_id = auth_user_id())))
    )
  order by sa.starts_at
$$;

revoke execute on function is_test_property(uuid), my_calendar(date,date), my_projects(),
  adhoc_check_in(uuid,double precision,double precision,text,text,text,boolean) from anon, public;
grant execute on function is_test_property(uuid), my_calendar(date,date), my_projects(),
  adhoc_check_in(uuid,double precision,double precision,text,text,text,boolean) to authenticated;
