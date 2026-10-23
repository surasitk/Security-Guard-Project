-- Guard OS / Horguard — Migration 30: บทบาทใหม่ "ผู้จัดการโซน" (zone_manager)
-- (23 ต.ค. 2569 · ตามคำขอคุณเต๋) · รันหลัง migration 29 · รันซ้ำได้
--
-- · ผู้จัดการโซน: ดูแลโครงการในโซนที่ได้รับมอบหมายไม่ให้ รปภ.ขาดจุด · ออกคำสั่ง/วางแผนให้ผู้ช่วยสายตรวจและตัวสแปร์ · รองจากเจ้าของ
--   ใน Horguard Force "ดูได้อย่างเดียว": ภาพรวมวันนี้ แผนที่กำลังพล ตารางกะ จุดตรวจ รายงาน (ไม่เห็นค่าแรง/เงิน)
--   เห็นเฉพาะโครงการที่ผูกไว้ — ถ้าไม่ได้ผูกเลย เห็นทุกโครงการของบริษัท
-- · ครูฝึก: ซัพพอร์ตผู้จัดการโซนเมื่อลา/ติดงาน · ดูแผนที่กำลังพลใน LINE ได้ เฉพาะโครงการที่ผูกไว้
-- · สายตรวจ (เดิม "สายตรวจ/ผจก.โซน"): ใช้ LINE อย่างเดียว ไม่เข้า Force (ปิดที่หน้าเว็บ — ข้อมูลเดิมไม่เปลี่ยน)

-- ── บทบาท + จำนวนโครงการที่ผูกได้ ─────────────────────────────────────────
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('owner','admin','zone_manager','supervisor','assistant_supervisor','trainer','spare','shift_leader','guard','client'));

create or replace function project_limit(p_role text) returns integer
language sql immutable as $$
  select case when p_role = 'guard' then 5
              when p_role = 'zone_manager' then 50
              when p_role in ('supervisor','assistant_supervisor','trainer','spare','shift_leader','client') then 10
              else 0 end
$$;

-- ── ขอบเขตการมองเห็น ─────────────────────────────────────────────────────
-- staff (อ่านข้อมูลหลังบ้าน) รวมผู้จัดการโซน · การเขียนยังต้องเป็น owner/admin เหมือนเดิม
create or replace function is_tenant_staff() returns boolean
language sql stable as $$
  select auth_user_role() in ('owner','admin','zone_manager','supervisor','shift_leader')
$$;

create or replace function is_zone_manager() returns boolean
language sql stable as $$ select auth_user_role() = 'zone_manager' $$;

-- เห็นทุกโครงการ: owner/admin หรือ ผจก.โซนที่ยังไม่ได้ผูกโครงการ
create or replace function sees_all_properties() returns boolean
language sql stable security definer set search_path = public as $$
  select is_tenant_admin()
      or (auth_user_role() = 'zone_manager'
          and not exists (select 1 from property_managers pm where pm.user_id = auth_user_id()))
$$;

create or replace function can_see_property(p_property_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (not is_test_property(p_property_id) or is_platform_admin())
     and (sees_all_properties()
          or exists (select 1 from property_managers pm
                     where pm.user_id = auth_user_id() and pm.property_id = p_property_id))
$$;

-- ใครเปิดแผนที่กำลังพลได้ (Force + LINE): owner / admin / ผจก.โซน / ครูฝึก (+ หัวหน้ากะ/สายตรวจ เดิมใน Force)
create or replace function can_view_force_map() returns boolean
language sql stable as $$
  select auth_user_role() in ('owner','admin','zone_manager','trainer','supervisor','shift_leader')
$$;
grant execute on function is_zone_manager(), sees_all_properties(), can_view_force_map() to authenticated;

-- ── แก้ฟังก์ชันเดิมด้วยการแทนข้อความ (คงโค้ดส่วนอื่นไว้ทั้งหมด) ─────────────
do $$
declare d text;
begin
  -- แผนที่กำลังพล: ให้ครูฝึกเห็นได้ (เฉพาะโครงการที่ผูก)
  d := pg_get_functiondef('force_map(uuid)'::regprocedure);
  if position('can_view_force_map()' in d) = 0 then
    execute replace(d, 'and is_tenant_staff() and can_see_property(p.id)', 'and can_view_force_map() and can_see_property(p.id)');
  end if;

  -- งานที่ "สั่งการ/แก้ไข" ผ่าน is_tenant_staff(): ผจก.โซนดูได้อย่างเดียว
  for d in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('dispatch_person', 'send_broadcast', 'set_incident_status') loop
    if position('not is_zone_manager()' in d) = 0 then
      execute replace(d, 'is_tenant_staff()', '(is_tenant_staff() and not is_zone_manager())');
    end if;
  end loop;
end $$;

-- ── รายงานเข้างาน: ผจก.โซนไม่เห็นค่าแรง/ยอดเงิน · ไม่ได้ผูกโครงการ = เห็นทุกโครงการ ──
create or replace function report_attendance(
  p_from date, p_to date, p_property_id uuid default null, p_user_id uuid default null
) returns table (
  work_date date, property_id uuid, property_name text, user_id uuid, full_name text, employee_code text,
  check_in_at timestamptz, check_out_at timestamptz, late_minutes integer, ot_minutes integer,
  kind text, is_holiday_work boolean, status text, flag_reason text, daily_wage numeric, amount numeric
) language sql stable security definer set search_path = public as $$
  with me as (
    select auth_tenant_id() as tid, auth_user_id() as uid,
           is_tenant_staff() as staff, sees_all_properties() as all_props, is_platform_admin() as pa,
           not is_zone_manager() as money
  ),
  vis as (
    select p.id, p.name from properties p, me
    where p.tenant_id = me.tid and me.staff
      and (not p.is_test or me.pa)
      and (me.all_props or exists (select 1 from property_managers pm where pm.user_id = me.uid and pm.property_id = p.id))
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
         case when (select money from me) then u.daily_wage end,
         case when not (select money from me) then null
              when a.id is not null then coalesce(u.daily_wage, 0) else 0 end
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
    and sa.starts_at >= (p_from - 1)::timestamp at time zone 'Asia/Bangkok'
    and sa.starts_at <  (least(p_to, p_from + 92) + 2)::timestamp at time zone 'Asia/Bangkok'
    and d.work_date between p_from and least(p_to, p_from + 92)
    and (p_user_id is null or sa.user_id = p_user_id)
  order by p.name, d.work_date, sa.starts_at, u.full_name
$$;
grant execute on function report_attendance(date, date, uuid, uuid) to authenticated;
