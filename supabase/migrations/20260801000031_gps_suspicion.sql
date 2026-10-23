-- Guard OS / Horguard — Migration 31: ตรวจหาพิกัดน่าสงสัย (สงสัยใช้ Fake GPS) + รายงานให้เจ้าหน้าที่ตรวจ
-- (23 ต.ค. 2569 · ตามคำขอคุณเต๋) · รันซ้ำได้
--
-- LINE LIFF (หน้าเว็บ) ตรวจ "mock location" ตรงๆ ไม่ได้ → ระบบไม่บล็อก แต่ "ติดธง + เก็บหลักฐาน" ให้เจ้าหน้าที่ตัดสินใจเอง
-- 1) แอปส่งค่าพิกัดหลายครั้งต่อการเข้า/ออกงาน (ความแม่นยำ ความสูง ความเร็ว เวลา) → gps_evidence
-- 2) assess_gps() ให้คะแนนความน่าสงสัย ทันทีที่ส่งหลักฐาน + รอบตรวจทุกชั่วโมง (pg_cron gps_sweep)
-- 3) คะแนน ≥ 3 → gps_suspicions (สถานะ รอตรวจ / ปกติ / ยืนยันว่าผิดปกติ) + ธงในมอนิเตอร์ (gps_suspect_in / gps_suspect_out)

-- ── ตาราง ───────────────────────────────────────────────────────────────
create table if not exists gps_evidence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  attendance_id uuid not null references attendance(id) on delete cascade,
  user_id       uuid not null references users(id),
  property_id   uuid not null references properties(id),
  phase         text not null check (phase in ('in','out')),
  samples       jsonb not null default '[]',     -- [{lat,lng,acc,alt,alt_acc,speed,heading,ts}]
  user_agent    text,
  created_at    timestamptz not null default now(),
  unique (attendance_id, phase)
);

create table if not exists gps_suspicions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  attendance_id uuid not null references attendance(id) on delete cascade,
  user_id       uuid not null references users(id),
  property_id   uuid not null references properties(id),
  phase         text not null check (phase in ('in','out')),
  event_at      timestamptz not null,
  score         integer not null,
  reasons       text[] not null default '{}',   -- ข้อความไทยพร้อมแสดง
  codes         text[] not null default '{}',
  detail        jsonb not null default '{}',
  status        text not null default 'pending' check (status in ('pending','normal','confirmed')),
  review_note   text,
  reviewed_by   uuid references users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (attendance_id, phase)
);
create index if not exists idx_gps_susp_tenant_time on gps_suspicions(tenant_id, event_at desc);
create index if not exists idx_gps_susp_user on gps_suspicions(user_id, event_at desc);
create index if not exists idx_scans_user_time on patrol_scans(user_id, scanned_at);   -- ใช้หาตำแหน่งก่อนหน้า (และช่วยลบข้อมูลเร็วขึ้น)
create index if not exists idx_scans_assignment on patrol_scans(assignment_id);
create index if not exists idx_scans_device on patrol_scans(device_id);

alter table gps_evidence   enable row level security;
alter table gps_suspicions enable row level security;
drop policy if exists gps_susp_select on gps_suspicions;
create policy gps_susp_select on gps_suspicions for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff() and can_see_property(property_id));
drop policy if exists gps_evidence_select on gps_evidence;
create policy gps_evidence_select on gps_evidence for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff() and can_see_property(property_id));
-- เขียนผ่าน RPC เท่านั้น

-- ── ประเมินความน่าสงสัย ───────────────────────────────────────────────────
create or replace function assess_gps(p_attendance_id uuid, p_phase text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  a attendance%rowtype; p properties%rowtype; ev gps_evidence%rowtype;
  v_at timestamptz; v_loc geography;
  v_score int := 0; v_reasons text[] := '{}'; v_codes text[] := '{}'; v_detail jsonb := '{}';
  v_n int; v_prev record; v_km numeric; v_min numeric; v_same int; v_d numeric;
begin
  select * into a from attendance where id = p_attendance_id;
  if a.id is null then return 0; end if;
  if p_phase = 'in' then v_at := a.check_in_at; v_loc := a.in_location;
  else v_at := a.check_out_at; v_loc := a.out_location; end if;
  if v_at is null or v_loc is null then return 0; end if;     -- ไม่มีพิกัด = มีธง no_gps อยู่แล้ว
  select * into p from properties where id = a.property_id;
  select * into ev from gps_evidence where attendance_id = a.id and phase = p_phase;

  -- 1) จากค่าที่แอปส่งมา (อ่านพิกัด 3 ครั้ง ห่างกัน ~1–2 วินาที)
  if ev.id is not null then
    v_n := jsonb_array_length(ev.samples);
    v_detail := v_detail || jsonb_build_object('samples', v_n);
    -- นับเฉพาะเมื่อ GPS อ้างว่าแม่นยำสูง (< 30 ม.) — พิกัดจาก Wi-Fi/เสาสัญญาณซ้ำกันได้ตามปกติ GPS จริงต้องขยับเล็กน้อย
    if v_n >= 2 and (select max((s->>'acc')::numeric) from jsonb_array_elements(ev.samples) s) < 30 then
      -- GPS จริงขยับเล็กน้อยเสมอ — ค่าเดิมทุกตำแหน่งทศนิยมทุกครั้งเป็นลักษณะของแอปพิกัดปลอม
      if (select count(distinct (s->>'lat') || ',' || (s->>'lng')) from jsonb_array_elements(ev.samples) s) = 1
         and (select count(distinct s->>'ts') from jsonb_array_elements(ev.samples) s) > 1 then
        v_score := v_score + 2; v_codes := array_append(v_codes, 'static_samples');
        v_reasons := array_append(v_reasons, 'พิกัดนิ่งผิดปกติ — อ่าน 3 ครั้งได้ค่าเดียวกันทุกตำแหน่งทศนิยม'::text);
      end if;
      if (select count(distinct s->>'acc') from jsonb_array_elements(ev.samples) s) = 1
         and (select count(distinct s->>'ts') from jsonb_array_elements(ev.samples) s) > 1 then
        v_score := v_score + 1; v_codes := array_append(v_codes, 'static_accuracy');
        v_reasons := array_append(v_reasons, 'ค่าความแม่นยำ GPS เท่ากันทุกครั้ง'::text);
      end if;
    end if;
    if exists (select 1 from jsonb_array_elements(ev.samples) s
               where (s->>'acc') is not null and (s->>'acc')::numeric <= 1) then
      v_score := v_score + 2; v_codes := array_append(v_codes, 'perfect_accuracy');
      v_reasons := array_append(v_reasons, 'ความแม่นยำ GPS ดีเกินจริง (≤ 1 เมตร)'::text);
    end if;
  end if;

  -- 2) พิกัดตรงจุดกลางโครงการเป๊ะ (แอปปลอมพิกัดมักปักหมุดตรงจุดที่ตั้งโครงการ)
  if p.center is not null then
    v_d := st_distance(v_loc, p.center);
    if v_d < 1 then
      v_score := v_score + 2; v_codes := array_append(v_codes, 'at_site_center');
      v_reasons := array_append(v_reasons, 'พิกัดตรงจุดกลางโครงการเป๊ะ (ห่าง < 1 เมตร)'::text);
    end if;
  end if;

  -- 3) ย้ายที่เร็วเกินจริง: เทียบกับตำแหน่งล่าสุดก่อนหน้าใน 6 ชั่วโมง (เข้า/ออกงาน/สแกนจุดตรวจ)
  select x.loc, x.at, x.src into v_prev from (
      select a2.in_location loc, a2.check_in_at at, 'เข้างาน' src from attendance a2
       where a2.user_id = a.user_id and a2.in_location is not null and a2.check_in_at < v_at and a2.check_in_at > v_at - interval '6 hours'
         and not (a2.id = a.id and p_phase = 'in')
      union all
      select a2.out_location, a2.check_out_at, 'ออกงาน' from attendance a2
       where a2.user_id = a.user_id and a2.out_location is not null and a2.check_out_at < v_at and a2.check_out_at > v_at - interval '6 hours'
      union all
      select s.location, s.scanned_at, 'สแกนจุดตรวจ' from patrol_scans s
       where s.user_id = a.user_id and s.location is not null and s.scanned_at < v_at and s.scanned_at > v_at - interval '6 hours'
    ) x order by x.at desc limit 1;
  if v_prev.loc is not null then
    v_km := round((st_distance(v_loc, v_prev.loc) / 1000)::numeric, 1);
    v_min := greatest(1, extract(epoch from (v_at - v_prev.at)) / 60);
    if v_km >= 3 and v_km / (v_min / 60) > 150 then
      v_score := v_score + 4; v_codes := array_append(v_codes, 'impossible_travel');
      v_reasons := array_append(v_reasons, format('ย้ายที่เร็วเกินจริง — ห่างจาก%sครั้งก่อน %s กม. ภายใน %s นาที', v_prev.src, v_km, round(v_min))::text);
      v_detail := v_detail || jsonb_build_object('travel_km', v_km, 'travel_min', round(v_min));
    end if;
  end if;

  -- 4) พิกัดซ้ำเป๊ะกับวันอื่น (GPS จริงไม่ได้ค่าเดิมถึงระดับ 10 ซม. ซ้ำหลายวัน)
  select count(distinct (coalesce(a2.check_in_at, a2.check_out_at) at time zone 'Asia/Bangkok')::date) into v_same
    from attendance a2
   where a2.user_id = a.user_id and a2.id <> a.id
     and coalesce(a2.check_in_at, a2.check_out_at) > v_at - interval '60 days'
     and ((a2.in_location is not null and round(st_y(a2.in_location::geometry)::numeric, 6) = round(st_y(v_loc::geometry)::numeric, 6)
                                      and round(st_x(a2.in_location::geometry)::numeric, 6) = round(st_x(v_loc::geometry)::numeric, 6))
       or (a2.out_location is not null and round(st_y(a2.out_location::geometry)::numeric, 6) = round(st_y(v_loc::geometry)::numeric, 6)
                                       and round(st_x(a2.out_location::geometry)::numeric, 6) = round(st_x(v_loc::geometry)::numeric, 6)));
  if v_same >= 2 then
    v_score := v_score + 2; v_codes := array_append(v_codes, 'repeated_coords');
    v_reasons := array_append(v_reasons, format('พิกัดซ้ำเป๊ะกับอีก %s วันก่อนหน้า', v_same)::text);
  end if;

  -- บันทึก: คะแนน ≥ 3 = น่าสงสัย · ถ้าเคยถูกตรวจแล้ว (ปกติ/ยืนยัน) คงสถานะเดิม แค่อัปเดตเหตุผล
  if v_score >= 3 then
    insert into gps_suspicions (tenant_id, attendance_id, user_id, property_id, phase, event_at, score, reasons, codes, detail)
    values (a.tenant_id, a.id, a.user_id, a.property_id, p_phase, v_at, v_score, v_reasons, v_codes, v_detail)
    on conflict (attendance_id, phase) do update
      set score = excluded.score, reasons = excluded.reasons, codes = excluded.codes, detail = excluded.detail, updated_at = now();
    update attendance set flag_reason = concat_ws(',', nullif(flag_reason, ''), 'gps_suspect_' || p_phase)
     where id = a.id and coalesce(flag_reason, '') not like '%gps_suspect_' || p_phase || '%';
  else
    delete from gps_suspicions where attendance_id = a.id and phase = p_phase and status = 'pending';
  end if;
  return v_score;
end $$;
revoke execute on function assess_gps(uuid, text) from public, anon, authenticated;

-- ── แอปส่งหลักฐานพิกัด (หลังเข้า/ออกงานสำเร็จ — ไม่ทำให้การลงเวลาช้าลง) ──────
create or replace function submit_gps_evidence(p_phase text, p_samples jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a attendance%rowtype; v_score int; v_samples jsonb;
begin
  if p_phase not in ('in','out') then return jsonb_build_object('ok', false, 'error', 'invalid_phase'); end if;
  -- รายการเข้า/ออกงานล่าสุดของผู้ใช้เอง ภายใน 15 นาที
  select * into a from attendance
   where user_id = auth_user_id()
     and case when p_phase = 'in' then check_in_at else check_out_at end > now() - interval '15 minutes'
   order by case when p_phase = 'in' then check_in_at else check_out_at end desc limit 1;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- เก็บได้ไม่เกิน 5 ค่า เฉพาะฟิลด์ที่รู้จัก
  select coalesce(jsonb_agg(jsonb_build_object(
           'lat', s->'lat', 'lng', s->'lng', 'acc', s->'acc', 'alt', s->'alt', 'alt_acc', s->'alt_acc',
           'speed', s->'speed', 'heading', s->'heading', 'ts', s->'ts')), '[]')
    into v_samples
    from (select value s from jsonb_array_elements(case when jsonb_typeof(p_samples) = 'array' then p_samples else '[]' end) limit 5) x;
  insert into gps_evidence (tenant_id, attendance_id, user_id, property_id, phase, samples, user_agent)
  values (a.tenant_id, a.id, a.user_id, a.property_id, p_phase, v_samples,
          left(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'user-agent', 300))
  on conflict (attendance_id, phase) do update set samples = excluded.samples, created_at = now();
  v_score := assess_gps(a.id, p_phase);
  return jsonb_build_object('ok', true);   -- ไม่บอกคะแนนกับผู้ใช้
exception when others then
  return jsonb_build_object('ok', false, 'error', 'evidence_failed');
end $$;
revoke execute on function submit_gps_evidence(text, jsonb) from public, anon;
grant execute on function submit_gps_evidence(text, jsonb) to authenticated;

-- ── รอบตรวจทุกชั่วโมง: เก็บตกรายการที่ไม่มีหลักฐานจากแอป + ตรวจรูปแบบข้ามวัน ──
create or replace function gps_sweep() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, check_in_at, check_out_at from attendance
            where coalesce(check_out_at, check_in_at) > now() - interval '3 hours' loop
    if r.check_in_at  is not null then perform assess_gps(r.id, 'in');  n := n + 1; end if;
    if r.check_out_at is not null then perform assess_gps(r.id, 'out'); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function gps_sweep() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'gps-suspicion-sweep';
select cron.schedule('gps-suspicion-sweep', '17 * * * *', $job$ select gps_sweep(); $job$);

-- ── เจ้าหน้าที่ตรวจและบันทึกผล ─────────────────────────────────────────────
create or replace function review_gps_suspicion(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s gps_suspicions%rowtype;
begin
  select * into s from gps_suspicions where id = p_id;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not can_manage_tenant(s.tenant_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_status not in ('pending','normal','confirmed') then return jsonb_build_object('ok', false, 'error', 'invalid_status'); end if;
  update gps_suspicions set status = p_status, review_note = nullif(trim(coalesce(p_note, '')), ''),
         reviewed_by = case when p_status = 'pending' then null else auth_user_id() end,
         reviewed_at = case when p_status = 'pending' then null else now() end, updated_at = now()
   where id = p_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (s.tenant_id, auth_user_id(), 'review_gps_suspicion', 'gps_suspicions', p_id::text,
          jsonb_build_object('status', p_status, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function review_gps_suspicion(uuid, text, text) from public, anon;
grant execute on function review_gps_suspicion(uuid, text, text) to authenticated;

-- ── มอนิเตอร์: บอกว่าเหตุการณ์ไหน (เข้า/ออก) น่าสงสัย ─────────────────────────
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
  a.in_selfie_url, a.out_selfie_url,
  a.early_reason,
  si.status  as gps_in_status,  si.reasons as gps_in_reasons,
  so.status  as gps_out_status, so.reasons as gps_out_reasons
from attendance a
left join gps_suspicions si on si.attendance_id = a.id and si.phase = 'in'
left join gps_suspicions so on so.attendance_id = a.id and so.phase = 'out';
