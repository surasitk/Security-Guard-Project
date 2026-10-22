-- LOADTEST 600 — ฟังก์ชันจำลองการใช้งาน 1 วัน (เรียก RPC จริงด้วยสิทธิ์ authenticated + JWT claims ของแต่ละคน)
create or replace function public.lt_guard_day(p_from int, p_to int) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_t uuid := (select id from tenants where name = 'LOADTEST-600 (ลบได้)');
  r record; c record; t0 timestamptz; fns text[] := '{}'; mss float8[] := '{}'; oks boolean[] := '{}';
  v jsonb; k int; lat float8; lng float8; n int := 0; v_codes text[]; v_code text;
begin
  for r in
    select u.id uid, u.role, u.employee_code, a.id aid, p.id pid, st_y(p.center::geometry) plat, st_x(p.center::geometry) plng,
           substring(u.employee_code from 3)::int num
    from users u join shift_assignments a on a.user_id = u.id and a.status = 'scheduled'
    join properties p on p.id = a.property_id
    where u.tenant_id = v_t and u.role in ('guard', 'shift_leader')
      and substring(u.employee_code from 3)::int between p_from and p_to
    order by u.employee_code
  loop
    n := n + 1;
    select array_agg(code order by code) into v_codes from checkpoints where property_id = r.pid;
    lat := r.plat + (random() - 0.5) * 0.0006; lng := r.plng + (random() - 0.5) * 0.0006;   -- ±30 ม.
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', v_t, 'user_id', r.uid, 'user_role', r.role), 'sub', r.uid, 'aud', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- เปิดแอป
    t0 := clock_timestamp(); perform count(*) from my_projects();
    fns := fns || 'my_projects'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || true;
    t0 := clock_timestamp(); perform count(*) from my_current_assignments();
    fns := fns || 'my_current_assignments'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || true;
    t0 := clock_timestamp(); perform count(*) from my_calendar(current_date - 7, current_date + 30);
    fns := fns || 'my_calendar'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || true;
    -- เข้างาน
    t0 := clock_timestamp(); v := check_in(r.aid, lat, lng, 'loadtest/selfie.jpg', 'lt-dev-' || r.employee_code, 'loadtest', false);
    fns := fns || 'check_in'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || coalesce((v->>'ok')::boolean, false);
    -- ตรวจจุด 8 รอบ × 4 จุด
    for k in 1..8 loop
      t0 := clock_timestamp(); perform count(*) from my_current_assignments();
      fns := fns || 'my_current_assignments'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || true;
      foreach v_code in array v_codes loop
        t0 := clock_timestamp(); v := scan_checkpoint(v_code, lat, lng, null, 'lt-dev-' || r.employee_code, 'loadtest');
        fns := fns || 'scan_checkpoint'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || coalesce((v->>'ok')::boolean, false);
      end loop;
    end loop;
    -- SOS ~1%
    if r.num % 100 = 7 then
      t0 := clock_timestamp(); v := report_sos(r.pid, lat, lng, null, null, 'บุกรุก', 'loadtest');
      fns := fns || 'report_sos'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || coalesce((v->>'ok')::boolean, false);
    end if;
    -- ออกงาน: 90% ตรงเวลา (เลื่อนเวลาจบกะมาเป็นตอนนี้), 10% ออกก่อนพร้อมเหตุผล
    perform set_config('role', 'postgres', true);
    if r.num % 10 <> 0 then update shift_assignments set ends_at = now() where id = r.aid; end if;
    perform set_config('role', 'authenticated', true);
    t0 := clock_timestamp(); v := check_out(r.aid, lat, lng, null, case when r.num % 10 = 0 then 'loadtest ออกก่อน' end);
    fns := fns || 'check_out'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000; oks := oks || coalesce((v->>'ok')::boolean, false);
    perform set_config('role', 'postgres', true);
  end loop;
  perform set_config('role', 'postgres', true);
  insert into lt_results (phase, fn, ms, ok) select 'guard', f, m, o from unnest(fns, mss, oks) x(f, m, o);
  return jsonb_build_object('users', n, 'calls', coalesce(array_length(fns, 1), 0),
                            'failed', (select count(*) from unnest(oks) o where not o));
end $$;

create or replace function public.lt_admin_day(p_rounds int) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_t uuid := (select id from tenants where name = 'LOADTEST-600 (ลบได้)');
  r record; t0 timestamptz; fns text[] := '{}'; mss float8[] := '{}'; k int; v_pid uuid;
  s timestamptz := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
begin
  for r in select id uid, role, employee_code from users where tenant_id = v_t and role in ('supervisor', 'admin') order by employee_code loop
    select property_id into v_pid from property_managers where user_id = r.uid limit 1;
    if v_pid is null then select id into v_pid from properties where tenant_id = v_t order by code limit 1; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', v_t, 'user_id', r.uid, 'user_role', r.role), 'sub', r.uid, 'aud', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    for k in 1..p_rounds loop
      -- Dashboard (3 คิวรีเหมือนหน้าเว็บ ผ่าน RLS)
      t0 := clock_timestamp();
      perform count(*) from shift_assignments a join properties p on p.id = a.property_id left join users u on u.id = a.user_id
        where not p.is_test and a.starts_at >= s and a.starts_at < s + interval '1 day' and a.status <> 'cancelled';
      perform count(*) from (select a.* from attendance a join properties p on p.id = a.property_id left join users u on u.id = a.user_id
        where not p.is_test and a.check_in_at >= s order by a.check_in_at desc limit 500) z;
      perform count(*) from shift_assignments a left join users u on u.id = a.user_id left join properties p on p.id = a.property_id
        where a.status = 'checked_in' and a.ends_at < now() - interval '1 hour';
      fns := fns || 'dashboard(3 queries)'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp(); perform count(*) from force_map(null);
      fns := fns || 'force_map'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp(); perform count(*) from (select * from v_incidents where status <> 'closed' order by created_at desc limit 30) z;
      fns := fns || 'v_incidents'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp(); perform count(*) from open_coverage();
      fns := fns || 'open_coverage'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
      t0 := clock_timestamp(); perform count(*) from (select * from v_attendance_log where check_in_at >= now() - interval '1 day' order by check_in_at desc limit 200) z;
      fns := fns || 'monitor(v_attendance_log)'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
      if k = 1 then
        t0 := clock_timestamp(); perform count(*) from report_attendance(current_date - 30, current_date, null, null);
        fns := fns || 'report_attendance(30 วัน)'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
        t0 := clock_timestamp(); perform count(*) from dispatch_candidates(v_pid);
        fns := fns || 'dispatch_candidates'::text; mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
      end if;
    end loop;
    perform set_config('role', 'postgres', true);
  end loop;
  perform set_config('role', 'postgres', true);
  insert into lt_results (phase, fn, ms, ok) select 'admin', f, m, true from unnest(fns, mss) x(f, m);
  return jsonb_build_object('calls', coalesce(array_length(fns, 1), 0));
end $$;
revoke all on function public.lt_guard_day(int, int), public.lt_admin_day(int) from public, anon, authenticated;

-- สรุปผล
create or replace view public.lt_summary as
select phase, fn, count(*) calls, count(*) filter (where not ok) failed,
       round(avg(ms)::numeric, 1) avg_ms,
       round((percentile_cont(0.5) within group (order by ms))::numeric, 1) p50_ms,
       round((percentile_cont(0.95) within group (order by ms))::numeric, 1) p95_ms,
       round((percentile_cont(0.99) within group (order by ms))::numeric, 1) p99_ms,
       round(max(ms)::numeric, 1) max_ms, round(sum(ms)::numeric / 1000, 2) total_s
from public.lt_results group by phase, fn order by phase, fn;
revoke all on public.lt_summary from anon, authenticated;

-- วัด my_calendar ซ้ำได้ (ไม่เปลี่ยนข้อมูล) — ใช้เทียบก่อน/หลังปรับความเร็ว
create or replace function public.lt_calendar(p_phase text) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_t uuid := (select id from tenants where name = 'LOADTEST-600 (ลบได้)');
  r record; t0 timestamptz; fns text[] := '{}'; mss float8[] := '{}';
begin
  for r in select id uid, role from users where tenant_id = v_t order by employee_code loop
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', v_t, 'user_id', r.uid, 'user_role', r.role), 'sub', r.uid, 'aud', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    t0 := clock_timestamp(); perform count(*) from my_calendar(current_date - 7, current_date + 30);
    fns := fns || ('my_calendar/' || r.role); mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
    if r.role in ('admin', 'supervisor') then
      t0 := clock_timestamp(); perform count(*) from report_attendance(current_date - 30, current_date, null, null);
      fns := fns || ('report_attendance/' || r.role); mss := mss || extract(epoch from clock_timestamp() - t0) * 1000;
    end if;
    perform set_config('role', 'postgres', true);
  end loop;
  perform set_config('role', 'postgres', true);
  insert into lt_results (phase, fn, ms, ok) select p_phase, f, m, true from unnest(fns, mss) x(f, m);
  return jsonb_build_object('calls', coalesce(array_length(fns, 1), 0));
end $$;
revoke all on function public.lt_calendar(text) from public, anon, authenticated;
