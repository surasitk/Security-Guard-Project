-- Horguard — ข้อมูลตั้งต้นสำหรับ STAGING เท่านั้น (ห้ามรันบน Prod)
-- รันหลัง migration ครบทุกไฟล์ · รันซ้ำได้ (มีข้อมูลเดโมแล้วจะข้าม)
-- ข้อมูลทั้งหมดเป็นของสมมติ ไม่มีข้อมูลส่วนตัวของพนักงานจริง
--
-- ผูก LINE ของ Super Admin: เปิดแอป Horguard Patrol (staging) → ลงทะเบียนด้วย
--   รหัสพนักงาน STG-ADMIN · เบอร์ 0000000000
-- พนักงานเดโมทั้งหมดยังไม่ผูก LINE (ไม่มีใครได้รับข้อความจริง)

do $$
declare
  v_test uuid; v_demo uuid; v_admin uuid;
  p_a uuid; p_b uuid; p_c uuid; p_t uuid;
  t_a_day uuid; t_a_night uuid; t_b_day uuid; t_b_night uuid;
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; g6 uuid; sp uuid; sv uuid; cl uuid;
  d date;
begin
  -- ── บริษัท ──
  select id into v_test from tenants where is_test limit 1;
  if v_test is null then
    insert into tenants (name, plan, is_test) values ('Test Vendor', 'pro', true) returning id into v_test;
  end if;

  if exists (select 1 from tenants where name = 'Horguard Demo Security') then
    raise notice 'มีข้อมูลเดโมอยู่แล้ว — ข้าม'; return;
  end if;
  insert into tenants (name, plan, billing_email) values ('Horguard Demo Security', 'pro', null) returning id into v_demo;

  -- ── Super Admin (อยู่ใน Test Vendor, สลับไปดูบริษัทเดโมได้) ──
  select id into v_admin from users where employee_code = 'STG-ADMIN' and tenant_id = v_test;
  if v_admin is null then
    insert into users (tenant_id, employee_code, full_name, phone, role)
    values (v_test, 'STG-ADMIN', 'Tae Khunsong (Staging)', '0000000000', 'owner') returning id into v_admin;
  end if;
  insert into platform_admins (user_id) values (v_admin) on conflict do nothing;

  -- ── โครงการ ──
  insert into properties (tenant_id, name, code, province, district, address, center, geofence_radius_m, billing_rate_per_guard_day)
  values (v_demo, 'อาคารสำนักงาน A', 'DEMO-A', 'กรุงเทพมหานคร', 'สาทร', 'ถ.สาทรเหนือ (สมมติ)',
          st_setsrid(st_makepoint(100.5294, 13.7215), 4326)::geography, 150, 900) returning id into p_a;
  insert into properties (tenant_id, name, code, province, district, address, center, geofence_radius_m, billing_rate_per_guard_day)
  values (v_demo, 'คอนโด B', 'DEMO-B', 'กรุงเทพมหานคร', 'ราชเทวี', 'ถ.เพชรบุรี (สมมติ)',
          st_setsrid(st_makepoint(100.5393, 13.7517), 4326)::geography, 150, 850) returning id into p_b;
  insert into properties (tenant_id, name, code, province, district, address, center, geofence_radius_m, billing_rate_per_guard_day, shift_mode)
  values (v_demo, 'โรงงาน C (ไม่จัดกะ)', 'DEMO-C', 'สมุทรปราการ', 'บางพลี', 'ถ.บางนา-ตราด (สมมติ)',
          st_setsrid(st_makepoint(100.6950, 13.6400), 4326)::geography, 250, 800, 'open') returning id into p_c;
  insert into properties (tenant_id, name, code, province, center, is_test)
  values (v_test, 'โครงการทดสอบ (Super Admin)', 'TEST-01', 'ทดสอบ',
          st_setsrid(st_makepoint(100.5294, 13.7215), 4326)::geography, true) returning id into p_t;

  -- ── พนักงานเดโม (ไม่ผูก LINE) ──
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off) values
    (v_demo, 'DG-001', 'สมชาย ทดสอบ',   '0800000001', 'guard', 480, '{0}') returning id into g1;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off) values
    (v_demo, 'DG-002', 'วิไล ทดสอบ',    '0800000002', 'guard', 480, '{3}') returning id into g2;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off) values
    (v_demo, 'DG-003', 'อนันต์ ทดสอบ',  '0800000003', 'shift_leader', 550, '{6}') returning id into g3;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off) values
    (v_demo, 'DG-004', 'ประภา ทดสอบ',   '0800000004', 'guard', 480, '{1}') returning id into g4;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off) values
    (v_demo, 'DG-005', 'ธนพล ทดสอบ',    '0800000005', 'guard', 500, '{}') returning id into g5;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off) values
    (v_demo, 'DG-006', 'กมล ทดสอบ',     '0800000006', 'guard', 500, '{}') returning id into g6;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage) values
    (v_demo, 'DS-001', 'สแปร์ ทดสอบ',   '0800000007', 'spare', 600) returning id into sp;
  insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage) values
    (v_demo, 'DV-001', 'สายตรวจ ทดสอบ', '0800000008', 'supervisor', 700) returning id into sv;
  insert into users (tenant_id, employee_code, full_name, phone, role) values
    (v_demo, 'DC-001', 'ลูกค้า ทดสอบ',  '0800000009', 'client') returning id into cl;

  insert into property_managers (user_id, property_id, tenant_id) values
    (g1, p_a, v_demo), (g2, p_a, v_demo), (g3, p_a, v_demo), (g3, p_b, v_demo),
    (g4, p_b, v_demo), (g5, p_c, v_demo), (g6, p_c, v_demo),
    (sp, p_a, v_demo), (sp, p_b, v_demo), (sp, p_c, v_demo),
    (sv, p_a, v_demo), (sv, p_b, v_demo), (sv, p_c, v_demo),
    (cl, p_a, v_demo),
    (v_admin, p_t, v_test);
  update properties set client_user_id = cl where id = p_a;

  -- ── แม่แบบกะ ──
  insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, headcount)
    values (v_demo, p_a, 'กะกลางวัน', '07:00', '19:00', false, 2) returning id into t_a_day;
  insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, headcount)
    values (v_demo, p_a, 'กะกลางคืน', '19:00', '07:00', true, 1) returning id into t_a_night;
  insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, headcount)
    values (v_demo, p_b, 'กะกลางวัน', '08:00', '20:00', false, 1) returning id into t_b_day;
  insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, headcount)
    values (v_demo, p_b, 'กะกลางคืน', '20:00', '08:00', true, 1) returning id into t_b_night;
  -- โรงงาน C: ช่วงกะสำหรับโหมดไม่จัดกะ (ยามกดเข้างานเอง)
  insert into shift_templates (tenant_id, property_id, name, start_time, end_time, crosses_midnight, headcount) values
    (v_demo, p_c, 'ช่วงเช้า', '08:00', '20:00', false, 2),
    (v_demo, p_c, 'ช่วงดึก', '20:00', '08:00', true, 1);

  -- ── กะ 14 วันข้างหน้า (เวลาไทย) ──
  for d in select generate_series(current_date, current_date + 13, interval '1 day')::date loop
    insert into shift_assignments (tenant_id, property_id, user_id, template_id, starts_at, ends_at) values
      (v_demo, p_a, g1, t_a_day,   (d + time '07:00') at time zone 'Asia/Bangkok', (d + time '19:00') at time zone 'Asia/Bangkok'),
      (v_demo, p_a, g2, t_a_day,   (d + time '07:00') at time zone 'Asia/Bangkok', (d + time '19:00') at time zone 'Asia/Bangkok'),
      (v_demo, p_a, g3, t_a_night, (d + time '19:00') at time zone 'Asia/Bangkok', (d + 1 + time '07:00') at time zone 'Asia/Bangkok'),
      (v_demo, p_b, g4, t_b_day,   (d + time '08:00') at time zone 'Asia/Bangkok', (d + time '20:00') at time zone 'Asia/Bangkok');
  end loop;

  -- ── จุดตรวจ ──
  insert into checkpoints (tenant_id, property_id, name, code) values
    (v_demo, p_a, 'ประตูหน้า', 'CPDEMOA001'), (v_demo, p_a, 'ลานจอด B1', 'CPDEMOA002'), (v_demo, p_a, 'ดาดฟ้า', 'CPDEMOA003'),
    (v_demo, p_b, 'ล็อบบี้', 'CPDEMOB001'), (v_demo, p_c, 'โกดังสินค้า', 'CPDEMOC001'),
    (v_test, p_t, 'จุดทดสอบ', 'CPTEST0001');

  raise notice 'staging seed done: demo tenant %, admin %', v_demo, v_admin;
end $$;
