-- Guard OS — Sprint 1
-- Migration 5: RPC (F3 check-in/check-out + my_current_assignments + generate กะรายเดือน)
-- ทุกตัวเป็น security definer + ตรวจสิทธิ์เองจาก JWT — client ไม่มีทาง insert ตรง

-- ============================================================
-- my_current_assignments — หากะ active ของ user ณ ตอนนี้ (±60 นาที grace)
-- ============================================================
create or replace function my_current_assignments()
returns table (
  assignment_id uuid,
  property_id   uuid,
  property_name text,
  unit_name     text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  status        text,
  checked_in_at timestamptz
)
language sql security definer set search_path = public as $$
  select sa.id, sa.property_id, p.name, u.name, sa.starts_at, sa.ends_at, sa.status, a.check_in_at
  from shift_assignments sa
  join properties p on p.id = sa.property_id
  left join units u on u.id = sa.unit_id
  left join attendance a on a.assignment_id = sa.id
  where sa.user_id = auth_user_id()
    and sa.tenant_id = auth_tenant_id()
    and sa.status in ('scheduled','checked_in')
    and now() between sa.starts_at - interval '60 minutes'
                  and sa.ends_at   + interval '60 minutes'
  order by sa.starts_at
$$;

-- ============================================================
-- ตรวจ geofence: polygon ถ้ามี ไม่งั้น center + radius — คืนระยะห่าง (0 = อยู่ใน)
-- ============================================================
create or replace function check_geofence(p_property_id uuid, p_point geography)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_prop properties%rowtype;
  v_dist numeric;
begin
  select * into v_prop from properties where id = p_property_id;
  if v_prop.geofence is not null then
    if st_covers(v_prop.geofence, p_point) then return 0; end if;
    return round(st_distance(v_prop.geofence, p_point)::numeric, 1);
  elsif v_prop.center is not null then
    v_dist := round(st_distance(v_prop.center, p_point)::numeric, 1);
    if v_dist <= v_prop.geofence_radius_m then return 0; end if;
    return v_dist - v_prop.geofence_radius_m;
  end if;
  return 0;  -- property ยังไม่ตั้งพิกัด → ไม่บล็อก แต่ check_in จะตั้งธงไว้
end $$;

-- ============================================================
-- upsert_device — ลงทะเบียน/อัปเดตเครื่อง คืน device id (ใช้ภายใน RPC)
-- ============================================================
create or replace function upsert_device(p_fingerprint text, p_user_agent text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into devices (tenant_id, user_id, device_fingerprint, user_agent)
  values (auth_tenant_id(), auth_user_id(), p_fingerprint, p_user_agent)
  on conflict (tenant_id, device_fingerprint)
  do update set last_seen = now(), user_agent = excluded.user_agent
  returning id into v_id;
  return v_id;
end $$;

-- ============================================================
-- check_in — F3: ตรวจกะเป็นของ user จริง → geofence → insert attendance เวลา server
-- ============================================================
create or replace function check_in(
  p_assignment_id      uuid,
  p_lat                double precision,
  p_lng                double precision,
  p_selfie_url         text,
  p_device_fingerprint text default null,
  p_user_agent         text default null,
  p_gps_is_mock        boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_assign   shift_assignments%rowtype;
  v_point    geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_dist     numeric;
  v_dev_id   uuid;
  v_late     integer;
  v_dev      devices%rowtype;
  v_flag     text := null;
begin
  select * into v_assign from shift_assignments
  where id = p_assignment_id and user_id = auth_user_id() and tenant_id = auth_tenant_id()
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_your_assignment');
  end if;
  if v_assign.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_assign.status);
  end if;
  if now() < v_assign.starts_at - interval '60 minutes' or now() > v_assign.ends_at then
    return jsonb_build_object('ok', false, 'error', 'outside_time_window');
  end if;

  v_dist := check_geofence(v_assign.property_id, v_point);
  if v_dist > 0 then
    return jsonb_build_object('ok', false, 'error', 'outside_geofence', 'distance_m', v_dist);
  end if;

  if p_device_fingerprint is not null then
    v_dev_id := upsert_device(p_device_fingerprint, p_user_agent);
    select * into v_dev from devices where id = v_dev_id;
    if v_dev.is_blocked then
      return jsonb_build_object('ok', false, 'error', 'device_blocked');
    end if;
    -- เครื่อง kiosk ต้องเป็นเครื่องของ property นี้เท่านั้น
    if v_dev.device_type = 'shared_kiosk' and v_dev.kiosk_property_id is distinct from v_assign.property_id then
      v_flag := 'kiosk_wrong_property';
    end if;
  end if;

  if p_gps_is_mock then
    v_flag := coalesce(v_flag || ',', '') || 'mock_gps_suspected';
  end if;

  v_late := greatest(0, floor(extract(epoch from (now() - v_assign.starts_at)) / 60))::integer;

  insert into attendance (
    tenant_id, property_id, user_id, assignment_id,
    check_in_at, in_location, in_selfie_url, in_distance_m,
    late_minutes, device_id, is_mock_flag, flag_reason
  ) values (
    v_assign.tenant_id, v_assign.property_id, auth_user_id(), v_assign.id,
    now(), v_point, p_selfie_url, v_dist,
    v_late, v_dev_id, p_gps_is_mock, v_flag
  );

  update shift_assignments set status = 'checked_in' where id = v_assign.id;

  return jsonb_build_object('ok', true, 'checked_in_at', now(), 'late_minutes', v_late);
end $$;

-- ============================================================
-- check_out — F3: update แถวเดิม
-- ============================================================
create or replace function check_out(
  p_assignment_id uuid,
  p_lat           double precision,
  p_lng           double precision,
  p_selfie_url    text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_assign shift_assignments%rowtype;
  v_att    attendance%rowtype;
  v_point  geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_dist   numeric;
  v_early  integer;
begin
  select * into v_assign from shift_assignments
  where id = p_assignment_id and user_id = auth_user_id() and tenant_id = auth_tenant_id()
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_your_assignment');
  end if;
  if v_assign.status <> 'checked_in' then
    return jsonb_build_object('ok', false, 'error', 'not_checked_in');
  end if;

  select * into v_att from attendance where assignment_id = v_assign.id for update;
  v_dist  := check_geofence(v_assign.property_id, v_point);
  v_early := greatest(0, floor(extract(epoch from (v_assign.ends_at - now())) / 60))::integer;

  update attendance set
    check_out_at        = now(),
    out_location        = v_point,
    out_selfie_url      = coalesce(p_selfie_url, out_selfie_url),
    out_distance_m      = v_dist,
    early_leave_minutes = v_early
  where id = v_att.id;

  update shift_assignments set status = 'checked_out' where id = v_assign.id;

  return jsonb_build_object('ok', true, 'checked_out_at', now(), 'early_leave_minutes', v_early);
end $$;

-- ============================================================
-- generate_assignments — admin สร้างกะล่วงหน้ารายเดือนจาก template
-- กำหนด is_holiday_work จาก tenant_holidays + weekly_day_off ของยาม (รีวิว 1.1)
-- ============================================================
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
      ) or (v_user.weekly_day_off is not null and extract(dow from v_day)::int = v_user.weekly_day_off);

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

-- จำกัดสิทธิ์เรียก RPC เฉพาะผู้ล็อกอิน
revoke execute on all functions in schema public from anon;
grant execute on function my_current_assignments() to authenticated;
grant execute on function check_in(uuid, double precision, double precision, text, text, text, boolean) to authenticated;
grant execute on function check_out(uuid, double precision, double precision, text) to authenticated;
grant execute on function generate_assignments(uuid, uuid, date, date) to authenticated;
