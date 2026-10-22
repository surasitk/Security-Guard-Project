-- Horguard (Guard OS) — Sprint 2
-- Migration 16: ลบรูป selfie เก่าอัตโนมัติ (PDPA data minimisation)
--
-- ภาพรวม
--   pg_cron (ทุกคืน 02:30 เวลาไทย) → pg_net เรียก Edge Function `purge-selfies`
--   → function ขอรายชื่อไฟล์ที่หมดอายุจาก selfie_purge_candidates()
--   → ลบไฟล์ผ่าน Storage API (ลบแถวใน storage.objects ตรงๆ ด้วย SQL ไม่ได้ ไฟล์จริงจะค้างอยู่)
--   → เรียก selfie_purge_mark() เคลียร์ path ใน attendance / patrol_scans + บันทึก selfie_purge_runs
--
-- ระยะเก็บ (แก้ได้ในตาราง app_settings ไม่ต้อง deploy ใหม่)
--   selfie_retention_days          = 60   รูปทั่วไป
--   selfie_flagged_retention_days  = 365  รูปของรายการที่ติดธงผิดปกติ (mock GPS / flag_reason) เก็บไว้เป็นหลักฐาน
--
-- ก่อนรันไฟล์นี้: Dashboard → Database → Extensions เปิด pg_cron และ pg_net
-- หลังรันไฟล์นี้: ทำตาม SETUP.md หัวข้อ 7 (ตั้ง Vault secrets + deploy function purge-selfies)

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------
-- ค่าตั้งระบบ (ระดับแพลตฟอร์ม)
-- ------------------------------------------------------------
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
-- ไม่มี policy = client อ่าน/เขียนไม่ได้ · ใช้ผ่าน function security definer / service role เท่านั้น

insert into app_settings (key, value, note) values
  ('selfie_retention_days',         '60',  'ลบรูป selfie ที่เก่ากว่านี้ (วัน)'),
  ('selfie_flagged_retention_days', '365', 'รูปของรายการที่ติดธงผิดปกติ เก็บนานกว่า (วัน)')
on conflict (key) do nothing;

create or replace function app_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_settings where key = p_key), p_default);
$$;

-- ------------------------------------------------------------
-- ประวัติการลบ (ไว้ตรวจย้อนหลัง / ตอบคำถาม PDPA)
-- ------------------------------------------------------------
create table if not exists selfie_purge_runs (
  id            bigint generated always as identity primary key,
  run_at        timestamptz not null default now(),
  cutoff_days   int not null,
  files_deleted int not null default 0,
  refs_cleared  int not null default 0,
  note          text
);
alter table selfie_purge_runs enable row level security;
create policy selfie_purge_runs_platform on selfie_purge_runs for select
  using (is_platform_admin());

-- ------------------------------------------------------------
-- 1) รายชื่อไฟล์ที่ลบได้
--    - อยู่ใน bucket selfies และอัปโหลดก่อน cutoff
--    - ไม่ใช่รูปของรายการติดธง ที่ยังอยู่ในระยะเก็บหลักฐาน
-- ------------------------------------------------------------
create or replace function selfie_purge_candidates(p_limit int default 500)
returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  with cfg as (
    select now() - make_interval(days => app_setting_int('selfie_retention_days', 60))          as cutoff,
           now() - make_interval(days => app_setting_int('selfie_flagged_retention_days', 365)) as flagged_cutoff
  ),
  held as (
    select a.in_selfie_url as p from attendance a, cfg
     where (a.is_mock_flag or a.flag_reason is not null) and a.check_in_at >= cfg.flagged_cutoff
    union
    select a.out_selfie_url from attendance a, cfg
     where (a.is_mock_flag or a.flag_reason is not null) and a.check_in_at >= cfg.flagged_cutoff
    union
    select s.selfie_url from patrol_scans s, cfg
     where s.flag_reason is not null and s.scanned_at >= cfg.flagged_cutoff
  )
  select o.name
    from storage.objects o, cfg
   where o.bucket_id = 'selfies'
     and o.created_at < cfg.cutoff
     and not exists (select 1 from held where held.p = o.name)
   order by o.created_at
   limit greatest(1, least(p_limit, 1000));
$$;

-- ------------------------------------------------------------
-- 2) หลังลบไฟล์สำเร็จ: เคลียร์ path ที่ชี้ไปไฟล์ที่ไม่มีแล้ว + บันทึกรอบ
--    (เวลาเข้า-ออกงาน พิกัด และธงยังอยู่ครบ หายเฉพาะรูป)
-- ------------------------------------------------------------
create or replace function selfie_purge_mark(p_paths text[], p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_refs int := 0;
  v_n    int;
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return 0;
  end if;

  update attendance set in_selfie_url = null where in_selfie_url = any(p_paths);
  get diagnostics v_n = row_count; v_refs := v_refs + v_n;

  update attendance set out_selfie_url = null where out_selfie_url = any(p_paths);
  get diagnostics v_n = row_count; v_refs := v_refs + v_n;

  update patrol_scans set selfie_url = null where selfie_url = any(p_paths);
  get diagnostics v_n = row_count; v_refs := v_refs + v_n;

  insert into selfie_purge_runs (cutoff_days, files_deleted, refs_cleared, note)
  values (app_setting_int('selfie_retention_days', 60), cardinality(p_paths), v_refs, p_note);

  return v_refs;
end;
$$;

-- ตรวจว่า caller ถือ cron_secret ตัวจริงไหม (เทียบใน DB — รหัสไม่ออกจาก Vault)
create or replace function verify_cron_secret(p_secret text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'), false);
$$;
revoke all on function verify_cron_secret(text) from public, anon, authenticated;
grant execute on function verify_cron_secret(text) to service_role;

-- เรียกได้เฉพาะ service role (Edge Function) — ยาม/แอดมินเรียกไม่ได้
revoke all on function selfie_purge_candidates(int)      from public, anon, authenticated;
revoke all on function selfie_purge_mark(text[], text)   from public, anon, authenticated;
revoke all on function app_setting_int(text, int)        from public, anon, authenticated;
grant execute on function selfie_purge_candidates(int)    to service_role;
grant execute on function selfie_purge_mark(text[], text) to service_role;
grant execute on function app_setting_int(text, int)      to service_role;

-- ------------------------------------------------------------
-- 3) ตั้งเวลา: ทุกวัน 19:30 UTC = 02:30 เวลาไทย (ช่วงที่มีคนเข้า-ออกงานน้อย)
--    URL และ secret อ่านจาก Supabase Vault (ไม่ฝังคีย์ไว้ในโค้ด)
-- ------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'purge-old-selfies';

select cron.schedule(
  'purge-old-selfies',
  '30 19 * * *',
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/purge-selfies',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
               ),
    body    := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
  $job$
);
