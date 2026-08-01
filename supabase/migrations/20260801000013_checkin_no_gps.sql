-- Guard OS — Migration 13: check-in/out ยอมให้ไม่มีพิกัด GPS (ติดธงให้หัวหน้าตรวจ)
-- เหตุ: ยามจุดในอาคาร/อับสัญญาณ GPS หาพิกัดไม่ได้ ต้องลงเวลาได้เสมอ (จากรีวิว ก.ค. 2569 ข้อ 1.2)

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
  v_assign shift_assignments%rowtype;
  v_point  geography := case when p_lat is not null and p_lng is not null
                             then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist   numeric;
  v_dev_id uuid;
  v_late   integer;
  v_dev    devices%rowtype;
  v_flag   text := null;
begin
  select * into v_assign from shift_assignments
  where id = p_assignment_id and user_id = auth_user_id() and tenant_id = auth_tenant_id()
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_your_assignment'); end if;
  if v_assign.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'wrong_status', 'status', v_assign.status);
  end if;
  if now() < v_assign.starts_at - interval '60 minutes' or now() > v_assign.ends_at then
    return jsonb_build_object('ok', false, 'error', 'outside_time_window');
  end if;

  if v_point is not null then
    v_dist := check_geofence(v_assign.property_id, v_point);
    if v_dist > 0 then
      return jsonb_build_object('ok', false, 'error', 'outside_geofence', 'distance_m', v_dist);
    end if;
  else
    v_flag := 'no_gps';   -- ไม่มีพิกัด → ติดธงให้หัวหน้าตรวจ
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

  insert into attendance (
    tenant_id, property_id, user_id, assignment_id,
    check_in_at, in_location, in_selfie_url, in_distance_m,
    late_minutes, device_id, is_mock_flag, flag_reason
  ) values (
    v_assign.tenant_id, v_assign.property_id, auth_user_id(), v_assign.id,
    now(), v_point, p_selfie_url, v_dist,
    v_late, v_dev_id, p_gps_is_mock, v_flag
  )
  on conflict (assignment_id) do nothing;   -- กันกดซ้ำ

  update shift_assignments set status = 'checked_in' where id = v_assign.id;
  return jsonb_build_object('ok', true, 'checked_in_at', now(), 'late_minutes', v_late, 'no_gps', v_point is null);
end $$;

create or replace function check_out(
  p_assignment_id uuid, p_lat double precision, p_lng double precision, p_selfie_url text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_assign shift_assignments%rowtype;
  v_att    attendance%rowtype;
  v_point  geography := case when p_lat is not null and p_lng is not null
                             then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist   numeric;
  v_early  integer;
begin
  select * into v_assign from shift_assignments
  where id = p_assignment_id and user_id = auth_user_id() and tenant_id = auth_tenant_id()
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_your_assignment'); end if;
  if v_assign.status <> 'checked_in' then return jsonb_build_object('ok', false, 'error', 'not_checked_in'); end if;

  select * into v_att from attendance where assignment_id = v_assign.id for update;
  if v_point is not null then v_dist := check_geofence(v_assign.property_id, v_point); end if;
  v_early := greatest(0, floor(extract(epoch from (v_assign.ends_at - now())) / 60))::integer;

  update attendance set
    check_out_at = now(), out_location = v_point,
    out_selfie_url = coalesce(p_selfie_url, out_selfie_url),
    out_distance_m = v_dist, early_leave_minutes = v_early
  where id = v_att.id;

  update shift_assignments set status = 'checked_out' where id = v_assign.id;
  return jsonb_build_object('ok', true, 'checked_out_at', now(), 'early_leave_minutes', v_early);
end $$;

grant execute on function check_in(uuid,double precision,double precision,text,text,text,boolean) to authenticated;
grant execute on function check_out(uuid,double precision,double precision,text) to authenticated;
