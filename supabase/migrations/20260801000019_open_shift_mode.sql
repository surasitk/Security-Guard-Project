-- Guard OS — Migration 19: โหมด "ไม่จัดกะล่วงหน้า" (เลือกเป็นรายโครงการ)
-- รันหลัง migration 18 · รันซ้ำได้
--
-- โครงการที่เปิดโหมดนี้: ไม่ต้องจ่ายกะให้ยาม · ยามที่ผูกกับโครงการกดเข้างานได้เอง
-- · ระบบจับเข้า "ช่วงกะ" (= แม่แบบกะของโครงการ) ที่ใกล้ที่สุด เข้าได้ก่อนเริ่ม 45 นาที · สายนับจากเวลาเริ่มช่วงกะ
-- · เช็คอินครั้งเดียวอยู่ได้ถึง 24 ชม. (ควง 24) · ออกเมื่อไรก็ได้ ไม่ต้องใส่เหตุผล
-- · แม่แบบกะมี "จำนวนคนที่ต้องมี" → หน้าภาพรวมเตือนเมื่อช่วงกะไหนคนไม่ครบ (เลยเวลาเริ่ม 15 นาที)

-- ============================================================
-- 1) โครงสร้าง
-- ============================================================
alter table properties add column if not exists shift_mode text not null default 'scheduled';
alter table properties drop constraint if exists properties_shift_mode_check;
alter table properties add constraint properties_shift_mode_check check (shift_mode in ('scheduled','open'));

alter table shift_templates add column if not exists headcount integer not null default 1;
alter table shift_templates drop constraint if exists shift_templates_headcount_check;
alter table shift_templates add constraint shift_templates_headcount_check check (headcount between 1 and 50);

alter table shift_assignments drop constraint if exists shift_assignments_kind_check;
alter table shift_assignments add constraint shift_assignments_kind_check
  check (kind in ('scheduled','adhoc','emergency','open'));

create or replace view v_properties with (security_invoker = on) as
select
  p.id, p.tenant_id, p.name, p.code, p.province, p.district, p.subdistrict, p.postcode,
  p.address, p.geofence_radius_m, p.billing_rate_per_guard_day,
  p.contract_start, p.contract_end, p.client_user_id, p.is_active, p.created_at,
  st_y(p.center::geometry) as lat,
  st_x(p.center::geometry) as lng,
  p.is_test,
  p.shift_mode
from properties p;

-- ============================================================
-- 2) Admin: เปิด/ปิดโหมดไม่จัดกะ
-- ============================================================
create or replace function set_property_shift_mode(p_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  if p_mode not in ('scheduled','open') then return jsonb_build_object('ok', false, 'error', 'invalid_mode'); end if;
  select tenant_id into v_tenant from properties where id = p_id;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not can_manage_tenant(v_tenant) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update properties set shift_mode = p_mode where id = p_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (v_tenant, auth_user_id(), 'set_shift_mode', 'properties', p_id::text, jsonb_build_object('shift_mode', p_mode));
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 3) ช่วงกะที่ครอบคลุมเวลาหนึ่ง (ใช้ร่วม: เข้างาน + หน้าภาพรวม)
--    แต่ละแม่แบบกะ × วันที่ (เมื่อวาน/วันนี้/พรุ่งนี้ ตามเวลาไทย) ตามวันที่มีกะ
-- ============================================================
create or replace function slot_instances(p_property_id uuid, p_at timestamptz)
returns table (template_id uuid, name text, headcount integer, slot_day date, slot_start timestamptz, slot_end timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.headcount, d.day,
         (d.day + t.start_time) at time zone 'Asia/Bangkok',
         (case when t.crosses_midnight or t.end_time <= t.start_time then d.day + 1 else d.day end + t.end_time)
           at time zone 'Asia/Bangkok'
  from shift_templates t
  cross join lateral (
    select ((p_at at time zone 'Asia/Bangkok')::date + k) as day from generate_series(-1, 1) k
  ) d
  where t.property_id = p_property_id and t.is_active
    and extract(dow from d.day)::int = any(t.days_of_week)
$$;

-- ============================================================
-- 4) open_check_in — ยามเข้างานในโครงการโหมดไม่จัดกะ
-- ============================================================
create or replace function open_check_in(
  p_property_id uuid, p_lat double precision, p_lng double precision, p_selfie_url text,
  p_device_fingerprint text default null, p_user_agent text default null, p_gps_is_mock boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prop properties%rowtype;
  v_user users%rowtype;
  v_slot record;
  v_point geography := case when p_lat is not null and p_lng is not null
                            then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist numeric; v_dev_id uuid; v_dev devices%rowtype; v_flag text := null;
  v_next timestamptz; v_end timestamptz; v_aid uuid; v_late integer; v_hol boolean;
begin
  select * into v_prop from properties where id = p_property_id and tenant_id = auth_tenant_id() and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'property_not_found'); end if;
  if v_prop.shift_mode <> 'open' then return jsonb_build_object('ok', false, 'error', 'project_not_open_mode'); end if;
  if not ((v_prop.is_test and is_platform_admin())
          or exists (select 1 from property_managers where user_id = auth_user_id() and property_id = p_property_id)) then
    return jsonb_build_object('ok', false, 'error', 'not_member_of_project');
  end if;
  if exists (select 1 from shift_assignments where user_id = auth_user_id() and status = 'checked_in') then
    return jsonb_build_object('ok', false, 'error', 'already_checked_in');
  end if;
  if not exists (select 1 from shift_templates where property_id = p_property_id and is_active) then
    return jsonb_build_object('ok', false, 'error', 'no_slots_defined');
  end if;

  -- ช่วงกะที่กำลังดำเนินอยู่ หรือจะเริ่มใน 45 นาที → เลือกอันที่เริ่มล่าสุด
  select * into v_slot from slot_instances(p_property_id, now()) s
  where now() >= s.slot_start - interval '45 minutes' and now() < s.slot_end
  order by s.slot_start desc limit 1;
  if v_slot.template_id is null then return jsonb_build_object('ok', false, 'error', 'no_slot_now'); end if;

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
    if v_dev.device_type = 'shared_kiosk' and v_dev.kiosk_property_id is distinct from p_property_id then
      v_flag := coalesce(v_flag || ',', '') || 'kiosk_wrong_property';
    end if;
  end if;
  if p_gps_is_mock then v_flag := coalesce(v_flag || ',', '') || 'mock_gps_suspected'; end if;

  -- อยู่ได้ถึง 24 ชม. จากเวลาเริ่มช่วงกะ (ควง) แต่ไม่ชนกะถัดไปของคนนี้
  select min(starts_at) into v_next from shift_assignments
  where user_id = auth_user_id() and status <> 'cancelled' and starts_at > now();
  v_end := least(v_slot.slot_start + interval '24 hours',
                 coalesce(v_next - interval '1 minute', v_slot.slot_start + interval '24 hours'));
  if v_end <= now() + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'next_shift_too_soon');
  end if;

  select * into v_user from users where id = auth_user_id();
  v_hol := exists (select 1 from tenant_holidays where tenant_id = v_prop.tenant_id and holiday_date = v_slot.slot_day)
           or extract(dow from v_slot.slot_day)::int = any(coalesce(v_user.weekly_days_off, '{}'));
  v_late := greatest(0, floor(extract(epoch from (now() - v_slot.slot_start)) / 60))::integer;

  begin
    insert into shift_assignments (tenant_id, property_id, user_id, template_id, starts_at, ends_at,
                                   status, kind, is_holiday_work, created_by)
    values (v_prop.tenant_id, p_property_id, auth_user_id(), v_slot.template_id, v_slot.slot_start, v_end,
            'checked_in', 'open', v_hol, auth_user_id())
    returning id into v_aid;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'overlaps_existing_shift');
  end;
  insert into attendance (tenant_id, property_id, user_id, assignment_id, check_in_at, in_location,
                          in_selfie_url, in_distance_m, late_minutes, device_id, is_mock_flag, flag_reason)
  values (v_prop.tenant_id, p_property_id, auth_user_id(), v_aid, now(), v_point,
          p_selfie_url, v_dist, v_late, v_dev_id, p_gps_is_mock, v_flag);

  return jsonb_build_object('ok', true, 'assignment_id', v_aid, 'kind', 'open', 'property', v_prop.name,
                            'slot', v_slot.name, 'slot_start', v_slot.slot_start, 'late_minutes', v_late,
                            'checked_in_at', now(), 'no_gps', v_point is null);
end $$;

-- ============================================================
-- 5) my_projects — เพิ่มรูปแบบกะของโครงการ (แอปใช้เลือกปุ่ม)
-- ============================================================
drop function if exists my_projects();
create function my_projects()
returns table (property_id uuid, property_name text, province text, shift_mode text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.province, p.shift_mode
  from properties p
  where p.tenant_id = auth_tenant_id() and p.is_active
    and case when is_platform_admin() then p.is_test
             else not p.is_test and exists (select 1 from property_managers pm
                                             where pm.user_id = auth_user_id() and pm.property_id = p.id) end
  order by p.name
$$;

-- ============================================================
-- 6) open_coverage — ช่วงกะที่กำลังดำเนินอยู่ของโครงการโหมดไม่จัดกะ: ต้องมีกี่คน · อยู่เวรกี่คน
-- ============================================================
create or replace function open_coverage()
returns table (property_id uuid, property_name text, slot_name text, slot_start timestamptz, slot_end timestamptz,
               headcount integer, on_duty integer, short boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, s.name, s.slot_start, s.slot_end, s.headcount,
         (select count(*)::int from shift_assignments sa
          where sa.property_id = p.id and sa.status = 'checked_in') as on_duty,
         now() > s.slot_start + interval '15 minutes'
           and (select count(*) from shift_assignments sa
                where sa.property_id = p.id and sa.status = 'checked_in') < s.headcount as short
  from properties p
  cross join lateral slot_instances(p.id, now()) s
  where p.tenant_id = auth_tenant_id() and p.is_active and p.shift_mode = 'open'
    and is_tenant_staff() and can_see_property(p.id)
    and (not p.is_test or is_platform_admin())
    and now() >= s.slot_start and now() < s.slot_end
  order by short desc, p.name, s.slot_start
$$;

revoke execute on function set_property_shift_mode(uuid,text), slot_instances(uuid,timestamptz),
  open_check_in(uuid,double precision,double precision,text,text,text,boolean), my_projects(), open_coverage()
  from anon, public;
grant execute on function set_property_shift_mode(uuid,text),
  open_check_in(uuid,double precision,double precision,text,text,text,boolean), my_projects(), open_coverage()
  to authenticated;
