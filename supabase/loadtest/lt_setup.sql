-- LOADTEST 600 — สร้างข้อมูลทดสอบ (บริษัทแยก ลบทิ้งได้ด้วย lt_cleanup.sql)
-- 40 โครงการ · 600 คน (ยาม 540, หัวหน้ากะ 30, สายตรวจ 20, แอดมิน 10) · ไม่มี LINE (ไม่ส่งข้อความจริง)
-- ประวัติย้อนหลัง 29 วัน (กะ/เข้างาน/ตรวจจุด) เพื่อให้รายงานมีปริมาณข้อมูลจริง
-- กะ "วันนี้" ของทุกคนเริ่ม now()-5 นาที ให้สคริปต์จำลองเข้างานได้ทันที
do $$
declare
  v_t uuid; v_p uuid[]; v_u uuid; i int; v_prop uuid; v_day uuid; v_night uuid;
begin
  if exists (select 1 from tenants where name = 'LOADTEST-600 (ลบได้)') then raise exception 'มีข้อมูล loadtest อยู่แล้ว — รัน lt_cleanup.sql ก่อน'; end if;
  insert into tenants (name, plan) values ('LOADTEST-600 (ลบได้)', 'pro') returning id into v_t;

  -- 40 โครงการ รอบกรุงเทพฯ
  for i in 1..40 loop
    insert into properties (tenant_id, name, code, province, center, geofence_radius_m, billing_rate_per_guard_day)
    values (v_t, format('LT โครงการ %s', lpad(i::text, 2, '0')), format('LT-%s', lpad(i::text, 2, '0')), 'กรุงเทพมหานคร',
            st_setsrid(st_makepoint(100.45 + (i % 8) * 0.03, 13.65 + (i / 8) * 0.03), 4326)::geography, 150, 850)
    returning id into v_prop;
    v_p := v_p || v_prop;
    insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, headcount) values
      (v_t, v_prop, 'กะกลางวัน', '07:00', '19:00', false, 7),
      (v_t, v_prop, 'กะกลางคืน', '19:00', '07:00', true, 7);
    insert into checkpoints (tenant_id, property_id, name, code)
    select v_t, v_prop, 'จุด ' || k, format('LTCP%s%s', lpad(i::text, 2, '0'), k) from generate_series(1, 4) k;
  end loop;

  -- 570 คนเข้ากะ: คนที่ n อยู่โครงการ ((n-1) % 40)+1 · คี่=กลางวัน คู่=กลางคืน
  for i in 1..570 loop
    insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage)
    values (v_t, format('LT%s', lpad(i::text, 4, '0')), format('ทดสอบ โหลด %s', i), format('09%s', lpad(i::text, 8, '0')),
            case when i <= 540 then 'guard' else 'shift_leader' end, 500)
    returning id into v_u;
    insert into property_managers (user_id, property_id, tenant_id) values (v_u, v_p[((i - 1) % 40) + 1], v_t);
  end loop;
  -- สายตรวจ 20 คน ดูแลคนละ 2 โครงการ
  for i in 1..20 loop
    insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage)
    values (v_t, format('LTSV%s', lpad(i::text, 2, '0')), format('สายตรวจ โหลด %s', i), format('08%s', lpad(i::text, 8, '0')), 'supervisor', 700)
    returning id into v_u;
    insert into property_managers (user_id, property_id, tenant_id) values (v_u, v_p[i], v_t), (v_u, v_p[i + 20], v_t);
  end loop;
  for i in 1..10 loop
    insert into users (tenant_id, employee_code, full_name, phone, role)
    values (v_t, format('LTAD%s', lpad(i::text, 2, '0')), format('แอดมิน โหลด %s', i), format('07%s', lpad(i::text, 8, '0')), 'admin');
  end loop;

  -- ประวัติ 29 วัน (current_date-30 .. current_date-2)
  insert into shift_assignments (tenant_id, property_id, user_id, template_id, starts_at, ends_at, status)
  select v_t, pm.property_id, u.id, st.id,
         (x.wd + st.start_time) at time zone 'Asia/Bangkok',
         (x.wd + st.start_time) at time zone 'Asia/Bangkok' + interval '12 hours', 'checked_out'
  from users u
  join property_managers pm on pm.user_id = u.id
  join shift_templates st on st.property_id = pm.property_id
       and st.name = case when substring(u.employee_code from 3)::int % 2 = 1 then 'กะกลางวัน' else 'กะกลางคืน' end
  cross join generate_series((current_date - 30)::timestamp, (current_date - 2)::timestamp, interval '1 day') g(dd)
  cross join lateral (select g.dd::date as wd) x
  where u.tenant_id = v_t and u.role in ('guard', 'shift_leader');

  insert into attendance (tenant_id, property_id, user_id, assignment_id, check_in_at, check_out_at, in_location, in_distance_m, late_minutes, flag_reason)
  select a.tenant_id, a.property_id, a.user_id, a.id,
         a.starts_at + make_interval(mins => r.m), a.ends_at + make_interval(mins => (random() * 20)::int),
         p.center, 0, greatest(0, r.m), case when r.m > 30 then 'late' end
  from shift_assignments a join properties p on p.id = a.property_id
  cross join lateral (select (random() * 25 - 12)::int + case when random() < 0.03 then 45 else 0 end as m) r
  where a.tenant_id = v_t;

  insert into patrol_scans (tenant_id, property_id, user_id, assignment_id, checkpoint_id, scanned_at, location, distance_m)
  select a.tenant_id, a.property_id, a.user_id, a.id, c.id,
         a.starts_at + make_interval(mins => (rd * 90 + c.k * 5)::int), p.center, 0
  from shift_assignments a join properties p on p.id = a.property_id
  cross join generate_series(0, 1) rd
  join lateral (select id, row_number() over (order by code) k from checkpoints where property_id = a.property_id) c on true
  where a.tenant_id = v_t;

  -- กะวันนี้ (ครอบคลุม now) ของ 570 คน
  insert into shift_assignments (tenant_id, property_id, user_id, template_id, starts_at, ends_at, status)
  select v_t, pm.property_id, u.id, null, now() - interval '5 minutes', now() + interval '11 hours', 'scheduled'
  from users u join property_managers pm on pm.user_id = u.id
  where u.tenant_id = v_t and u.role in ('guard', 'shift_leader');

  create table if not exists public.lt_results (id bigserial primary key, phase text, fn text, ms double precision, ok boolean, at timestamptz default clock_timestamp());
  alter table public.lt_results enable row level security;
  revoke all on public.lt_results from anon, authenticated;
  raise notice 'loadtest tenant %', v_t;
end $$;

select (select count(*) from users u join tenants t on t.id = u.tenant_id where t.name = 'LOADTEST-600 (ลบได้)') users,
       (select count(*) from shift_assignments a join tenants t on t.id = a.tenant_id where t.name = 'LOADTEST-600 (ลบได้)') assignments,
       (select count(*) from patrol_scans a join tenants t on t.id = a.tenant_id where t.name = 'LOADTEST-600 (ลบได้)') scans;
