-- Guard OS — Migration 22: รายงานเข้างาน + จำนวนเงิน
-- รันหลัง migration 21 · รันซ้ำได้
-- จำนวนเงิน = ค่าแรง/วัน ที่ตั้งไว้ในหน้าพนักงาน (users.daily_wage) ต่อ 1 กะที่เข้างานจริง · ขาดงาน = 0
-- แถวละ 1 กะ: วันที่ (ตามวันเริ่มกะ เวลาไทย) · ชื่อ · เข้างาน · ออกงาน · สาย(นาที) · OT(นาที)
-- OT = เวลาออกงานจริงที่เกินเวลาจบกะ: กะตามตาราง = จบกะที่จ่ายไว้ · โหมดไม่จัดกะ = จบช่วงกะ · เช็คอินไม่มีกะ/ฉุกเฉิน = ไม่คิด OT
-- กะที่ผ่านไปแล้วแต่ไม่มีการเข้างาน = ขาดงาน (เวลาว่าง)

drop function if exists report_attendance(date,date,uuid,uuid);
create function report_attendance(
  p_from date, p_to date, p_property_id uuid default null, p_user_id uuid default null
) returns table (
  work_date date, property_id uuid, property_name text, user_id uuid, full_name text, employee_code text,
  check_in_at timestamptz, check_out_at timestamptz, late_minutes integer, ot_minutes integer,
  kind text, is_holiday_work boolean, status text, flag_reason text,
  daily_wage numeric, amount numeric
)
language sql stable security definer set search_path = public as $$
  select d.work_date, p.id, p.name, u.id, u.full_name, u.employee_code,
         a.check_in_at, a.check_out_at,
         coalesce(a.late_minutes, 0),
         case when a.check_out_at is not null and d.planned_end is not null
              then greatest(0, floor(extract(epoch from (a.check_out_at - d.planned_end)) / 60))::int
              else 0 end,
         sa.kind, sa.is_holiday_work,
         case when a.id is null and sa.ends_at < now() then 'absent' else sa.status end,
         a.flag_reason,
         u.daily_wage,
         case when a.id is not null then coalesce(u.daily_wage, 0) else 0 end
  from shift_assignments sa
  join properties p on p.id = sa.property_id
  join users u on u.id = sa.user_id
  left join attendance a on a.assignment_id = sa.id
  left join shift_templates t on t.id = sa.template_id
  cross join lateral (
    select (sa.starts_at at time zone 'Asia/Bangkok')::date as work_date,
           case sa.kind
             when 'scheduled' then sa.ends_at
             when 'open' then sa.starts_at + case when t.id is null then null
                                                  when t.crosses_midnight or t.end_time <= t.start_time
                                                    then (t.end_time - t.start_time) + interval '24 hours'
                                                  else (t.end_time - t.start_time) end
             else null end as planned_end
  ) d
  where sa.tenant_id = auth_tenant_id()
    and is_tenant_staff() and can_see_property(sa.property_id)
    and (not p.is_test or is_platform_admin())
    and sa.status <> 'cancelled'
    and (a.id is not null or sa.ends_at < now())
    and d.work_date between p_from and least(p_to, p_from + 92)
    and (p_property_id is null or sa.property_id = p_property_id)
    and (p_user_id is null or sa.user_id = p_user_id)
  order by p.name, d.work_date, sa.starts_at, u.full_name
$$;

revoke execute on function report_attendance(date,date,uuid,uuid) from anon, public;
grant execute on function report_attendance(date,date,uuid,uuid) to authenticated;
