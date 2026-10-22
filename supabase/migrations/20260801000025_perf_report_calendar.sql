-- Horguard — Migration 25: ปรับความเร็ว (ผลลัพธ์เหมือนเดิมทุกแถว)
-- จาก load test 600 คน:
--   report_attendance 30 วัน ~2–3.5 วิ → can_see_property() (security definer) ถูกเรียกทีละแถว
--   my_calendar ~90 ms/คน → ไล่ทุกกะของบริษัทแล้วกรองทีละแถว
-- แก้: คำนวณสิทธิ์ครั้งเดียว (ชุดโครงการที่เห็นได้) + index ตามบริษัท/คน + วันเริ่มกะ

create index if not exists idx_assign_tenant_start on shift_assignments (tenant_id, starts_at);
create index if not exists idx_assign_user_start on shift_assignments (user_id, starts_at);
create index if not exists idx_pm_user_property on property_managers (user_id, property_id);

create or replace function report_attendance(
  p_from date, p_to date, p_property_id uuid default null, p_user_id uuid default null
) returns table (
  work_date date, property_id uuid, property_name text, user_id uuid, full_name text, employee_code text,
  check_in_at timestamptz, check_out_at timestamptz, late_minutes integer, ot_minutes integer,
  kind text, is_holiday_work boolean, status text, flag_reason text, daily_wage numeric, amount numeric
) language sql stable security definer set search_path = public as $$
  with me as (
    select auth_tenant_id() as tid, auth_user_id() as uid,
           is_tenant_staff() as staff, is_tenant_admin() as adm, is_platform_admin() as pa
  ),
  vis as (   -- โครงการที่ผู้ใช้เห็นได้ (= can_see_property + เงื่อนไขโครงการทดสอบเดิม)
    select p.id, p.name from properties p, me
    where p.tenant_id = me.tid and me.staff
      and (not p.is_test or me.pa)
      and (me.adm or exists (select 1 from property_managers pm where pm.user_id = me.uid and pm.property_id = p.id))
      and (p_property_id is null or p.id = p_property_id)
  )
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
  from vis p
  join shift_assignments sa on sa.property_id = p.id
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
  where sa.tenant_id = (select tid from me)
    and sa.status <> 'cancelled'
    and (a.id is not null or sa.ends_at < now())
    -- ช่วงเวลากว้างกว่าวันทำงาน 1 วันเพื่อใช้ index แล้วกรองวันจริงด้านล่าง
    and sa.starts_at >= (p_from - 1)::timestamp at time zone 'Asia/Bangkok'
    and sa.starts_at <  (least(p_to, p_from + 92) + 2)::timestamp at time zone 'Asia/Bangkok'
    and d.work_date between p_from and least(p_to, p_from + 92)
    and (p_user_id is null or sa.user_id = p_user_id)
  order by p.name, d.work_date, sa.starts_at, u.full_name
$$;

create or replace function my_calendar(p_from date, p_to date)
returns table (assignment_id uuid, starts_at timestamptz, ends_at timestamptz, status text, kind text,
               is_holiday_work boolean, property_id uuid, property_name text, user_name text, is_mine boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth_tenant_id() as tid, auth_user_id() as uid, auth_user_role() as role, is_platform_admin() as pa,
           (p_from::timestamp at time zone 'Asia/Bangkok') as t0,
           ((least(p_to, p_from + 62) + 1)::timestamp at time zone 'Asia/Bangkok') as t1
  )
  select * from (
    -- กะของตัวเอง
    select sa.id, sa.starts_at, sa.ends_at, sa.status, sa.kind, sa.is_holiday_work,
           p.id, p.name, u.full_name, true
    from me join shift_assignments sa on sa.user_id = me.uid
    join properties p on p.id = sa.property_id
    join users u on u.id = sa.user_id
    where sa.tenant_id = me.tid and sa.status <> 'cancelled'
      and sa.starts_at >= me.t0 and sa.starts_at < me.t1
    union all
    -- กะของคนอื่น: เจ้าของ/แอดมินเห็นทั้งบริษัท · ลูกค้าเห็นโครงการของตัวเอง
    select sa.id, sa.starts_at, sa.ends_at, sa.status, sa.kind, sa.is_holiday_work,
           p.id, p.name, u.full_name, false
    from me join shift_assignments sa on sa.tenant_id = me.tid
    join properties p on p.id = sa.property_id
    join users u on u.id = sa.user_id
    where me.role in ('owner', 'admin', 'client') and not me.pa
      and sa.user_id is distinct from me.uid and sa.status <> 'cancelled'
      and sa.starts_at >= me.t0 and sa.starts_at < me.t1
      and not p.is_test
      and (me.role in ('owner', 'admin') or (me.role = 'client' and p.client_user_id = me.uid))
  ) x
  order by 2
$$;

grant execute on function report_attendance(date, date, uuid, uuid), my_calendar(date, date) to authenticated;
