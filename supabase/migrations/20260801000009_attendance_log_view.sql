-- Guard OS — Migration 9: view สำหรับหน้า Monitoring (แปลงพิกัด geography → lat/lng)
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
  a.in_selfie_url, a.out_selfie_url
from attendance a;
