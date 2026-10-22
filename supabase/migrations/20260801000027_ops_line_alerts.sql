-- Horguard (Guard OS) — Ops
-- Migration 17: แจ้งเตือนปัญหาระบบเข้า LINE OA
--
-- ชั้นที่ 1 (ไฟล์นี้): DB ตรวจตัวเองทุก 10 นาทีด้วย pg_cron แล้ว push เข้า LINE เมื่อพบ
--   · ฐานข้อมูลใกล้เต็ม           (ขนาด DB เทียบโควตาใน app_settings)
--   · พื้นที่เก็บรูปใกล้เต็ม        (bucket selfies เทียบโควตา)
--   · connection ใกล้เต็ม         (เทียบ max_connections)
--   · query ค้างนานเกิน            (active นานกว่า 5 นาที)
--   · cron job ล้มเหลว             (cron.job_run_details status = failed)
--   · Edge Function ที่ cron เรียกตอบ error (net._http_response >= 400 / timeout)
-- ชั้นที่ 2 (นอก DB): Cloudflare Worker `horguard-watchdog` เช็กเว็บ/API ทุก 5 นาที
--   เผื่อกรณี Supabase ล่มทั้งก้อน (ตอนนั้น DB ส่งเตือนเองไม่ได้) — ดู ops/watchdog-worker.js
--
-- กันสแปม: เรื่องเดียวกันเตือนซ้ำไม่เกินทุก 3 ชั่วโมง + แจ้ง "กลับมาปกติ" เมื่อหาย
-- ต้องมี Vault secrets: line_channel_token, ops_line_user_ids (คั่นด้วย comma) — ดู SETUP.md

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

insert into app_settings (key, value, note) values
  ('ops_db_quota_mb',          '8192', 'โควตาขนาดฐานข้อมูล (MB) — Supabase Pro = 8 GB, Free = 500 MB'),
  ('ops_storage_quota_mb',     '102400', 'โควตา Storage (MB) — Pro = 100 GB, Free = 1 GB'),
  ('ops_warn_pct',             '80',   'เตือนเมื่อใช้เกินกี่ % ของโควตา'),
  ('ops_long_query_minutes',   '5',    'query ที่รันนานเกินนี้ถือว่าค้าง'),
  ('ops_alert_cooldown_min',   '180',  'เรื่องเดิมเตือนซ้ำได้ทุกกี่นาที')
on conflict (key) do nothing;

-- สถานะการเตือนแต่ละเรื่อง (กันส่งซ้ำ + รู้ว่าหายแล้ว)
create table if not exists ops_alert_state (
  key          text primary key,
  is_open      boolean not null default false,
  last_sent_at timestamptz,
  last_detail  text,
  updated_at   timestamptz not null default now()
);
alter table ops_alert_state enable row level security;
create policy ops_alert_state_platform on ops_alert_state for select using (is_platform_admin());

-- request id ของการยิง LINE (ไว้แยกออกจากการเช็ก Edge Function error)
create table if not exists ops_line_requests (
  request_id bigint primary key,
  created_at timestamptz not null default now()
);
alter table ops_line_requests enable row level security;

-- ------------------------------------------------------------
-- ส่งข้อความ LINE (push) ถึงผู้ดูแลทุกคนใน ops_line_user_ids
-- p_key ใช้กันสแปม: เรื่องเดิมภายใน cooldown จะไม่ส่งซ้ำ (ส่ง null = ส่งเสมอ)
-- ------------------------------------------------------------
create or replace function ops_send_line(p_key text, p_text text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token    text;
  v_ids      text;
  v_uid      text;
  v_cooldown int := app_setting_int('ops_alert_cooldown_min', 180);
  v_last     timestamptz;
  v_req      bigint;
begin
  if p_key is not null then
    select last_sent_at into v_last from ops_alert_state where key = p_key;
    if v_last is not null and v_last > now() - make_interval(mins => v_cooldown) then
      update ops_alert_state set is_open = true, last_detail = p_text, updated_at = now() where key = p_key;
      return false;
    end if;
  end if;

  -- btrim: กันกรณีคัดลอก token มาพร้อมขึ้นบรรทัดใหม่ (ทำให้ header Authorization เพี้ยน)
  select btrim(decrypted_secret, E' \t\r\n') into v_token from vault.decrypted_secrets where name = 'line_channel_token';
  select btrim(decrypted_secret, E' \t\r\n') into v_ids   from vault.decrypted_secrets where name = 'ops_line_user_ids';
  if v_token is null or v_ids is null then
    raise warning 'ops_send_line: ยังไม่ได้ตั้ง Vault secrets line_channel_token / ops_line_user_ids';
    return false;
  end if;

  foreach v_uid in array string_to_array(replace(v_ids, ' ', ''), ',') loop
    continue when v_uid = '';
    select net.http_post(
      url     := 'https://api.line.me/v2/bot/message/push',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_token),
      body    := jsonb_build_object('to', v_uid,
                                    'messages', jsonb_build_array(
                                      jsonb_build_object('type', 'text', 'text', left(p_text, 4900))))
    ) into v_req;
    insert into ops_line_requests (request_id) values (v_req) on conflict do nothing;
  end loop;
  delete from ops_line_requests where created_at < now() - interval '2 days';

  if p_key is not null then
    insert into ops_alert_state (key, is_open, last_sent_at, last_detail, updated_at)
    values (p_key, true, now(), p_text, now())
    on conflict (key) do update
      set is_open = true, last_sent_at = now(), last_detail = excluded.last_detail, updated_at = now();
  end if;
  return true;
end;
$$;

-- ปิดเรื่องที่เคยเตือน แล้วแจ้งว่ากลับมาปกติ (ส่งครั้งเดียว)
create or replace function ops_resolve(p_key text, p_text text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from ops_alert_state where key = p_key and is_open) then
    update ops_alert_state set is_open = false, last_sent_at = null, updated_at = now() where key = p_key;
    perform ops_send_line(null, p_text);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- ตัวตรวจสุขภาพ (cron ทุก 10 นาที)
-- ------------------------------------------------------------
create or replace function ops_health_check()
returns jsonb
language plpgsql security definer set search_path = public, extensions, storage, cron, net as $$
declare
  v_pct        int := app_setting_int('ops_warn_pct', 80);
  v_db_mb      numeric := pg_database_size(current_database()) / 1048576.0;
  v_db_quota   int := app_setting_int('ops_db_quota_mb', 8192);
  v_st_mb      numeric;
  v_st_quota   int := app_setting_int('ops_storage_quota_mb', 102400);
  v_conn       int;
  v_conn_max   int := current_setting('max_connections')::int;
  v_long_min   int := app_setting_int('ops_long_query_minutes', 5);
  v_long       text;
  v_cron_fail  text;
  v_http_fail  text;
  v_report     jsonb := '{}'::jsonb;
begin
  -- 1) ฐานข้อมูลใกล้เต็ม
  if v_db_mb >= v_db_quota * v_pct / 100.0 then
    perform ops_send_line('db-size', format(
      E'🔴 Horguard: ฐานข้อมูลใกล้เต็ม\nใช้ %s MB จาก %s MB (%s%%)\nควรอัปเกรดแพ็กเกจหรือลบข้อมูลเก่า',
      round(v_db_mb), v_db_quota, round(v_db_mb * 100 / v_db_quota)));
  else
    perform ops_resolve('db-size', format(E'✅ Horguard: ขนาดฐานข้อมูลกลับมาปกติ (%s MB)', round(v_db_mb)));
  end if;

  -- 2) พื้นที่รูปใกล้เต็ม
  select coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0 into v_st_mb
    from storage.objects where bucket_id = 'selfies';
  if v_st_mb >= v_st_quota * v_pct / 100.0 then
    perform ops_send_line('storage-size', format(
      E'🔴 Horguard: พื้นที่เก็บรูปใกล้เต็ม\nใช้ %s MB จาก %s MB\nเช็กว่าการลบรูปเก่าทำงานอยู่ไหม (selfie_purge_runs)',
      round(v_st_mb), v_st_quota));
  else
    perform ops_resolve('storage-size', E'✅ Horguard: พื้นที่เก็บรูปกลับมาปกติ');
  end if;

  -- 3) connection ใกล้เต็ม
  select count(*) into v_conn from pg_stat_activity;
  if v_conn >= v_conn_max * v_pct / 100.0 then
    perform ops_send_line('connections', format(
      E'🟠 Horguard: การเชื่อมต่อฐานข้อมูลใกล้เต็ม\n%s จาก %s connections\nแอปอาจช้าหรือเข้าไม่ได้', v_conn, v_conn_max));
  else
    perform ops_resolve('connections', E'✅ Horguard: การเชื่อมต่อฐานข้อมูลกลับมาปกติ');
  end if;

  -- 4) query ค้าง
  select string_agg(format('• %s นาที: %s', round(extract(epoch from now() - query_start) / 60),
                           left(regexp_replace(query, '\s+', ' ', 'g'), 120)), E'\n')
    into v_long
    from pg_stat_activity
   where state = 'active'
     and pid <> pg_backend_pid()
     and backend_type = 'client backend'
     and query_start < now() - make_interval(mins => v_long_min);
  if v_long is not null then
    perform ops_send_line('long-query', E'🟠 Horguard: มี query ค้างนาน\n' || v_long);
  else
    perform ops_resolve('long-query', E'✅ Horguard: ไม่มี query ค้างแล้ว');
  end if;

  -- 5) cron job ล้มเหลวใน 15 นาทีล่าสุด
  select string_agg(distinct format('• %s: %s', j.jobname, left(coalesce(d.return_message, ''), 150)), E'\n')
    into v_cron_fail
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where d.status = 'failed' and d.start_time > now() - interval '15 minutes';
  if v_cron_fail is not null then
    perform ops_send_line('cron-failed', E'🔴 Horguard: งานตั้งเวลาล้มเหลว\n' || v_cron_fail);
  end if;

  -- 6) Edge Function ที่ cron เรียก ตอบ error / timeout (ไม่นับการยิง LINE เอง)
  select string_agg(format('• HTTP %s %s', coalesce(r.status_code::text, 'timeout'),
                           left(coalesce(r.error_msg, r.content::text, ''), 150)), E'\n')
    into v_http_fail
    from net._http_response r
   where r.created > now() - interval '15 minutes'
     and (r.status_code >= 400 or r.timed_out or r.error_msg is not null)
     and not exists (select 1 from ops_line_requests l where l.request_id = r.id);
  if v_http_fail is not null then
    perform ops_send_line('edge-fn-error', E'🔴 Horguard: Edge Function ตอบ error\n' || v_http_fail);
  end if;

  v_report := jsonb_build_object('db_mb', round(v_db_mb), 'storage_mb', round(v_st_mb),
                                 'connections', v_conn, 'max_connections', v_conn_max);
  return v_report;
end;
$$;

revoke all on function ops_send_line(text, text) from public, anon, authenticated;
revoke all on function ops_resolve(text, text)   from public, anon, authenticated;
revoke all on function ops_health_check()        from public, anon, authenticated;
grant execute on function ops_send_line(text, text) to service_role;
grant execute on function ops_health_check()        to service_role;

-- ping สำหรับ watchdog ภายนอก: ตอบได้ = DB ยังรับ query
create or replace function ops_ping()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'at', now());
$$;
grant execute on function ops_ping() to anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ops-health-check';
select cron.schedule('ops-health-check', '*/10 * * * *', $job$ select ops_health_check(); $job$);
