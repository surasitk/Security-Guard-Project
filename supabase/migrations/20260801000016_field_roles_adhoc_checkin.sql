-- Guard OS — Migration 16: บทบาทภาคสนาม + เช็คอินไม่มีกะ/ฉุกเฉิน + ออกก่อนเวลา + โปรไฟล์ผู้ใช้
-- (15 ต.ค. 2569 · ตามคำขอคุณเต๋) — ไฟล์นี้รวมเนื้อหา migration 15 ไว้แล้ว รันไฟล์นี้ไฟล์เดียวพอ (รันซ้ำได้)
--
-- 1) บทบาทใหม่ assistant_supervisor (ผู้ช่วยสายตรวจ) — ใช้แอปเหมือนสายตรวจ แต่ไม่เข้าหลังบ้าน
-- 2) สมาชิกโครงการ (property_managers): สายตรวจ/ผู้ช่วย/หัวหน้ากะ/ลูกค้า ≤ 10 โครงการ · ยาม ≤ 5 โครงการ
-- 3) สายตรวจ/ผู้ช่วย เช็คอินได้แม้ไม่มีกะ (เลือกโครงการ) · ยาม เช็คอินฉุกเฉินในโครงการที่มีชื่อ
-- 4) กะปกติ: เช็คอินได้ก่อนเวลา 45 นาที · เช็คเอาต์ได้ถึง 1 ชม. หลังจบกะ (เกินนั้น Admin ปิดให้)
-- 5) ออกก่อนเวลาต้องใส่เหตุผล → คิวแจ้ง Owner/Admin ทาง LINE OA (edge function notify-line)
-- 6) ต้องเช็คเอาต์ก่อน ถึงเช็คอินใหม่ได้
-- 7) วันหยุดประจำสัปดาห์เลือกได้หลายวันต่อคน (weekly_days_off)

-- ============================================================
-- 1) บทบาท
-- ============================================================
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('owner','admin','supervisor','assistant_supervisor','shift_leader','guard','client'));

-- ============================================================
-- 2) ชนิดกะ + เหตุผลออกก่อนเวลา
-- ============================================================
alter table shift_assignments add column if not exists kind text not null default 'scheduled';
alter table shift_assignments drop constraint if exists shift_assignments_kind_check;
alter table shift_assignments add constraint shift_assignments_kind_check
  check (kind in ('scheduled','adhoc','emergency'));
alter table attendance add column if not exists early_reason text;

create or replace view v_attendance_log with (security_invoker = on) as
select
  a.id, a.tenant_id, a.property_id, a.user_id,
  a.check_in_at, a.check_out_at,
  a.late_minutes, a.early_leave_minutes,
  a.is_mock_flag, a.flag_reason,
  a.in_distance_m, a.out_distance_m,
  st_y(a.in_location::geometry)  as in_lat,
  st_x(a.in_location::geometry)  as in_lng,
  st_y(a.out_location::geometry) as out_lat,
  st_x(a.out_location::geometry) as out_lng,
  a.in_selfie_url, a.out_selfie_url,
  a.early_reason
from attendance a;

-- ============================================================
-- 2b) วันหยุดประจำสัปดาห์หลายวัน (0=อาทิตย์ … 6=เสาร์)
-- ============================================================
alter table users add column if not exists weekly_days_off smallint[] not null default '{}';
update users set weekly_days_off = array[weekly_day_off]
where weekly_day_off is not null and weekly_days_off = '{}';

create or replace function generate_assignments(
  p_template_id uuid,
  p_user_id     uuid,
  p_date_from   date,
  p_date_to     date
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tpl     shift_templates%rowtype;
  v_user    users%rowtype;
  v_day     date;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_created integer := 0;
  v_skipped integer := 0;
  v_is_holiday boolean;
begin
  if not is_tenant_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_tpl from shift_templates
  where id = p_template_id and tenant_id = auth_tenant_id();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;

  select * into v_user from users
  where id = p_user_id and tenant_id = auth_tenant_id();
  if not found then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  v_day := p_date_from;
  while v_day <= p_date_to loop
    if extract(dow from v_day)::int = any(v_tpl.days_of_week) then
      -- เวลาไทย: กะนับตามวันที่เริ่มกะ (กติกาจากรีวิว)
      v_starts := (v_day || ' ' || v_tpl.start_time)::timestamp at time zone 'Asia/Bangkok';
      v_ends   := (case when v_tpl.crosses_midnight then v_day + 1 else v_day end
                   || ' ' || v_tpl.end_time)::timestamp at time zone 'Asia/Bangkok';

      v_is_holiday := exists (
        select 1 from tenant_holidays
        where tenant_id = auth_tenant_id() and holiday_date = v_day
      ) or (extract(dow from v_day)::int = any(coalesce(v_user.weekly_days_off, '{}')));

      begin
        insert into shift_assignments (
          tenant_id, property_id, user_id, template_id,
          starts_at, ends_at, is_holiday_work, created_by
        ) values (
          auth_tenant_id(), v_tpl.property_id, p_user_id, v_tpl.id,
          v_starts, v_ends, v_is_holiday, auth_user_id()
        );
        v_created := v_created + 1;
      exception when exclusion_violation then
        v_skipped := v_skipped + 1;  -- กะซ้อน → ข้าม
      end;
    end if;
    v_day := v_day + 1;
  end loop;

  insert into audit_logs (tenant_id, actor_user_id, action, target_table, after)
  values (auth_tenant_id(), auth_user_id(), 'generate_assignments', 'shift_assignments',
          jsonb_build_object('template_id', p_template_id, 'user_id', p_user_id,
                             'from', p_date_from, 'to', p_date_to,
                             'created', v_created, 'skipped_overlap', v_skipped));

  return jsonb_build_object('ok', true, 'created', v_created, 'skipped_overlap', v_skipped);
end $$;


-- ============================================================
-- 3) คิวแจ้งเตือน LINE (ส่งโดย edge function notify-line)
-- ============================================================
create table if not exists line_notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  property_id uuid references properties(id),
  user_id     uuid references users(id),
  kind        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
alter table line_notifications enable row level security;
drop policy if exists notif_select on line_notifications;
create policy notif_select on line_notifications for select
  using (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- 4) สมาชิกโครงการ: เพดานจำนวน
-- ============================================================
create or replace function project_limit(p_role text) returns integer
language sql immutable as $$
  select case when p_role = 'guard' then 5
              when p_role in ('supervisor','assistant_supervisor','shift_leader','client') then 10
              else 0 end
$$;

create or replace function trg_property_managers_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text; v_n integer;
begin
  select role into v_role from users where id = new.user_id;
  select count(*) into v_n from property_managers where user_id = new.user_id;
  if v_n > project_limit(v_role) then
    raise exception 'project_limit_exceeded' using hint = format('%s ผูกได้ไม่เกิน %s โครงการ', v_role, project_limit(v_role));
  end if;
  return new;
end $$;
drop trigger if exists property_managers_limit on property_managers;
create constraint trigger property_managers_limit after insert on property_managers
  deferrable initially deferred for each row execute function trg_property_managers_limit();

-- ============================================================
-- 5) สิทธิ์ตามโครงการ (จาก migration 15 + ผู้ช่วยสายตรวจ)
-- ============================================================
create or replace function can_see_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_tenant_admin()
      or exists (select 1 from property_managers pm
                 where pm.user_id = auth_user_id() and pm.property_id = p_property_id)
$$;

drop policy if exists properties_select on properties;
create policy properties_select on properties for select
  using (
    tenant_id = auth_tenant_id() and (
      is_tenant_admin()
      or can_see_property(id)
      or client_user_id = auth_user_id()
      or exists (select 1 from shift_assignments sa
                 where sa.property_id = properties.id and sa.user_id = auth_user_id() and sa.status <> 'cancelled')
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
-- 6) RPC ฝั่ง Admin: โครงการของ Vendor · สิทธิ์ผู้ใช้ · บันทึกโปรไฟล์ผู้ใช้
-- ============================================================
create or replace function list_properties_for_tenant(p_tenant_id uuid)
returns table (id uuid, name text, code text, province text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not can_manage_tenant(p_tenant_id) then return; end if;
  return query select p.id, p.name, p.code, p.province from properties p
  where p.tenant_id = p_tenant_id and p.is_active order by p.name;
end $$;

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

drop function if exists save_user(uuid,uuid,text,text,text,text,numeric,integer,uuid[],boolean);
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
  if p_role not in ('owner','admin','supervisor','assistant_supervisor','shift_leader','guard','client') then
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

-- ============================================================
-- 7) RPC ฝั่งแอป: กะปัจจุบัน · โครงการของฉัน
-- ============================================================
drop function if exists my_current_assignments();
create function my_current_assignments()
returns table (
  assignment_id uuid, property_id uuid, property_name text, unit_name text,
  starts_at timestamptz, ends_at timestamptz, status text, checked_in_at timestamptz,
  kind text, checkout_deadline timestamptz
)
language sql security definer set search_path = public as $$
  select sa.id, sa.property_id, p.name, u.name, sa.starts_at, sa.ends_at, sa.status, a.check_in_at,
         sa.kind, sa.ends_at + interval '1 hour'
  from shift_assignments sa
  join properties p on p.id = sa.property_id
  left join units u on u.id = sa.unit_id
  left join attendance a on a.assignment_id = sa.id
  where sa.user_id = auth_user_id() and sa.tenant_id = auth_tenant_id()
    and (sa.status = 'checked_in'
         or (sa.status = 'scheduled' and now() between sa.starts_at - interval '45 minutes' and sa.ends_at))
  order by (sa.status = 'checked_in') desc, sa.starts_at
$$;

create or replace function my_projects()
returns table (property_id uuid, property_name text, province text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.province
  from property_managers pm join properties p on p.id = pm.property_id
  where pm.user_id = auth_user_id() and p.tenant_id = auth_tenant_id() and p.is_active
  order by p.name
$$;

-- ============================================================
-- 8) check_in กะปกติ: ก่อนเวลาได้ 45 นาที · ต้องไม่มีกะที่ยังไม่เช็คเอาต์
-- ============================================================
create or replace function check_in(
  p_assignment_id uuid, p_lat double precision, p_lng double precision, p_selfie_url text,
  p_device_fingerprint text default null, p_user_agent text default null, p_gps_is_mock boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_assign shift_assignments%rowtype;
  v_point  geography := case when p_lat is not null and p_lng is not null
                             then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist numeric; v_dev_id uuid; v_late integer; v_dev devices%rowtype; v_flag text := null;
begin
  select * into v_assign from shift_assignments
  where id = p_assignment_id and user_id = auth_user_id() and tenant_id = auth_tenant_id() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_your_assignment'); end if;
  if v_assign.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_assign.status);
  end if;
  if exists (select 1 from shift_assignments where user_id = auth_user_id() and status = 'checked_in' and id <> v_assign.id) then
    return jsonb_build_object('ok', false, 'error', 'already_checked_in');
  end if;
  if now() < v_assign.starts_at - interval '45 minutes' or now() > v_assign.ends_at then
    return jsonb_build_object('ok', false, 'error', 'outside_time_window');
  end if;

  if v_point is not null then
    v_dist := check_geofence(v_assign.property_id, v_point);
    if v_dist > 0 then return jsonb_build_object('ok', false, 'error', 'outside_geofence', 'distance_m', v_dist); end if;
  else
    v_flag := 'no_gps';
  end if;
  if p_device_fingerprint is not null then
    v_dev_id := upsert_device(p_device_fingerprint, p_user_agent);
    select * into v_dev from devices where id = v_dev_id;
    if v_dev.is_blocked then return jsonb_build_object('ok', false, 'error', 'device_blocked'); end if;
    if v_dev.device_type = 'shared_kiosk' and v_dev.kiosk_property_id is distinct from v_assign.property_id then
      v_flag := coalesce(v_flag || ',', '') || 'kiosk_wrong_property';
    end if;
  end if;
  if p_gps_is_mock then v_flag := coalesce(v_flag || ',', '') || 'mock_gps_suspected'; end if;
  v_late := greatest(0, floor(extract(epoch from (now() - v_assign.starts_at)) / 60))::integer;

  insert into attendance (tenant_id, property_id, user_id, assignment_id, check_in_at, in_location,
                          in_selfie_url, in_distance_m, late_minutes, device_id, is_mock_flag, flag_reason)
  values (v_assign.tenant_id, v_assign.property_id, auth_user_id(), v_assign.id, now(), v_point,
          p_selfie_url, v_dist, v_late, v_dev_id, p_gps_is_mock, v_flag)
  on conflict (assignment_id) do nothing;
  update shift_assignments set status = 'checked_in' where id = v_assign.id;
  return jsonb_build_object('ok', true, 'checked_in_at', now(), 'late_minutes', v_late, 'no_gps', v_point is null);
end $$;

-- ============================================================
-- 9) adhoc_check_in — สายตรวจ/ผู้ช่วย (ไม่มีกะ) · ยาม/หัวหน้ากะ (ฉุกเฉิน)
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
  v_kind := case when v_role in ('supervisor','assistant_supervisor') then 'adhoc'
                 when v_role in ('guard','shift_leader') then 'emergency' end;
  if v_kind is null then return jsonb_build_object('ok', false, 'error', 'role_not_allowed'); end if;

  select * into v_prop from properties where id = p_property_id and tenant_id = auth_tenant_id() and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'property_not_found'); end if;
  if not exists (select 1 from property_managers where user_id = auth_user_id() and property_id = p_property_id) then
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
-- 10) check_out — ถึง 1 ชม. หลังจบกะ · ออกก่อนเวลาต้องมีเหตุผล → คิวแจ้ง LINE
-- ============================================================
drop function if exists check_out(uuid, double precision, double precision, text);
create or replace function check_out(
  p_assignment_id uuid, p_lat double precision, p_lng double precision,
  p_selfie_url text default null, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_assign shift_assignments%rowtype;
  v_att attendance%rowtype;
  v_point geography := case when p_lat is not null and p_lng is not null
                            then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist numeric; v_early integer := 0; v_notif uuid := null;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_assign from shift_assignments
  where id = p_assignment_id and user_id = auth_user_id() and tenant_id = auth_tenant_id() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_your_assignment'); end if;
  if v_assign.status <> 'checked_in' then return jsonb_build_object('ok', false, 'error', 'not_checked_in'); end if;
  if now() > v_assign.ends_at + interval '1 hour' then
    return jsonb_build_object('ok', false, 'error', 'checkout_window_closed');
  end if;

  if v_assign.kind = 'scheduled' and now() < v_assign.ends_at then
    v_early := ceil(extract(epoch from (v_assign.ends_at - now())) / 60)::integer;
    if v_reason is null then
      return jsonb_build_object('ok', false, 'error', 'reason_required', 'early_minutes', v_early);
    end if;
  end if;

  select * into v_att from attendance where assignment_id = v_assign.id for update;
  if v_point is not null then v_dist := check_geofence(v_assign.property_id, v_point); end if;

  update attendance set
    check_out_at = now(), out_location = v_point,
    out_selfie_url = coalesce(p_selfie_url, out_selfie_url),
    out_distance_m = v_dist, early_leave_minutes = v_early,
    early_reason = case when v_early > 0 then v_reason else early_reason end,
    flag_reason = case when v_early > 0 then coalesce(flag_reason || ',', '') || 'early_checkout' else flag_reason end
  where id = v_att.id;

  update shift_assignments set status = 'checked_out',
    ends_at = case when kind <> 'scheduled' then greatest(now(), starts_at + interval '1 second') else ends_at end
  where id = v_assign.id;

  if v_early > 0 then
    insert into line_notifications (tenant_id, property_id, user_id, kind, payload)
    select v_assign.tenant_id, v_assign.property_id, auth_user_id(), 'early_checkout',
           jsonb_build_object('user_name', u.full_name, 'employee_code', u.employee_code,
                              'property_name', p.name, 'shift_end', v_assign.ends_at,
                              'checked_out_at', now(), 'early_minutes', v_early, 'reason', v_reason)
    from users u, properties p where u.id = auth_user_id() and p.id = v_assign.property_id
    returning id into v_notif;
  end if;

  return jsonb_build_object('ok', true, 'checked_out_at', now(), 'early_leave_minutes', v_early, 'notification_id', v_notif);
end $$;

-- ============================================================
-- 11) Admin ปิดกะที่ลืมเช็คเอาต์ (เกิน 1 ชม. หลังจบกะ)
-- ============================================================
create or replace function admin_close_assignment(p_assignment_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_assign shift_assignments%rowtype;
begin
  select * into v_assign from shift_assignments where id = p_assignment_id for update;
  if not found or not can_manage_tenant(v_assign.tenant_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_assign.status <> 'checked_in' then return jsonb_build_object('ok', false, 'error', 'not_checked_in'); end if;
  update attendance set check_out_at = least(now(), v_assign.ends_at),
    flag_reason = coalesce(flag_reason || ',', '') || 'closed_by_admin',
    early_reason = coalesce(early_reason, p_note)
  where assignment_id = v_assign.id and check_out_at is null;
  update shift_assignments set status = 'checked_out',
    ends_at = case when kind <> 'scheduled' then greatest(least(now(), ends_at), starts_at + interval '1 second') else ends_at end
  where id = v_assign.id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (v_assign.tenant_id, auth_user_id(), 'admin_close_assignment', 'shift_assignments', v_assign.id::text,
          jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- สิทธิ์เรียกใช้
-- ============================================================
revoke execute on function
  can_see_property(uuid), list_properties_for_tenant(uuid), list_user_access(uuid),
  save_user(uuid,uuid,text,text,text,text,numeric,smallint[],uuid[],boolean),
  my_current_assignments(), my_projects(),
  check_in(uuid,double precision,double precision,text,text,text,boolean),
  adhoc_check_in(uuid,double precision,double precision,text,text,text,boolean),
  check_out(uuid,double precision,double precision,text,text),
  admin_close_assignment(uuid,text)
from anon, public;
grant execute on function
  can_see_property(uuid), list_properties_for_tenant(uuid), list_user_access(uuid),
  save_user(uuid,uuid,text,text,text,text,numeric,smallint[],uuid[],boolean),
  my_current_assignments(), my_projects(),
  check_in(uuid,double precision,double precision,text,text,text,boolean),
  adhoc_check_in(uuid,double precision,double precision,text,text,text,boolean),
  check_out(uuid,double precision,double precision,text,text),
  admin_close_assignment(uuid,text)
to authenticated;
