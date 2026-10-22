-- Horguard (Guard OS) — PDPA
-- Migration 18: Privacy Notice + consent แยกตามวัตถุประสงค์
--
-- หลักการ (ตาม flow ที่คุณเต๋กำหนด 22 ต.ค. 2569)
--   1. เปิด LIFF ครั้งแรก → แสดง Privacy Notice ฉบับสั้น + ลิงก์ฉบับเต็ม → กด "รับทราบ"
--      (Notice = แจ้งให้ทราบ ไม่ใช่ขอความยินยอม — การลงเวลา/GPS/รูปยืนยันตัวตนใช้ฐานสัญญาจ้าง/ประโยชน์อันชอบธรรม)
--   2. ฟีเจอร์ที่ต้องใช้ consent → checkbox แยกแต่ละเรื่อง ไม่ติ๊กไว้ก่อน ปฏิเสธได้ ไม่กระทบการใช้งานหลัก
--   3. บันทึกผ่าน RPC เท่านั้น เวลาจาก server (ไม่มี insert policy ให้ client)
--   4. Notice เปลี่ยนเวอร์ชัน → my_privacy_status().acknowledged = false → แอปแสดงใหม่
--   5. ดูย้อนหลัง + ถอน consent ได้จากหน้าโปรไฟล์ (my_privacy_history / set_consent)
--
-- ผู้ควบคุมข้อมูล = บริษัท รปภ. (tenant) ที่เป็นนายจ้าง · Horguard = ผู้ประมวลผลข้อมูล
-- ข้อความ Notice เก็บใน DB → แก้ข้อความ/ออกเวอร์ชันใหม่ได้โดยไม่ต้อง deploy แอป

-- ------------------------------------------------------------
-- Notice แต่ละเวอร์ชัน (ใช้ได้ทีละ 1 เวอร์ชัน)
-- ------------------------------------------------------------
create table if not exists privacy_notices (
  version      text primary key,                 -- เช่น '2026-10-22'
  is_current   boolean not null default false,
  effective_at timestamptz not null default now(),
  title_th     text not null,
  summary_th   jsonb not null,                   -- [{ "title": "...", "text": "..." }, ...] ข้อความสั้นอ่านง่าย
  full_url     text not null,                    -- ฉบับเต็ม
  change_note  text,                             -- เปลี่ยนอะไรจากเวอร์ชันก่อน (แสดงตอนให้รับทราบใหม่)
  created_at   timestamptz not null default now()
);
create unique index if not exists uq_privacy_notice_current on privacy_notices (is_current) where is_current;

-- ------------------------------------------------------------
-- วัตถุประสงค์ที่ต้องขอ consent แยก (ไม่บังคับ)
-- ------------------------------------------------------------
create table if not exists consent_purposes (
  code           text primary key,
  title_th       text not null,
  description_th text not null,
  is_active      boolean not null default true,  -- false = ไม่แสดงในแอป (ยังไม่เปิดใช้ฟีเจอร์)
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- บันทึกการรับทราบ Notice (1 แถวต่อคนต่อเวอร์ชัน)
-- ------------------------------------------------------------
create table if not exists privacy_acknowledgements (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references tenants(id),
  user_id        uuid not null references users(id),
  notice_version text not null references privacy_notices(version),
  accepted_at    timestamptz not null default now(),   -- เวลา server เท่านั้น
  user_agent     text,
  unique (user_id, notice_version)
);
create index if not exists idx_privack_tenant on privacy_acknowledgements (tenant_id, accepted_at);

-- ------------------------------------------------------------
-- ประวัติ consent แบบ append-only (ให้/ถอน แต่ละครั้งเป็น 1 แถว ไม่แก้ไม่ลบ)
-- ------------------------------------------------------------
create table if not exists consent_events (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references tenants(id),
  user_id        uuid not null references users(id),
  purpose_code   text not null references consent_purposes(code),
  granted        boolean not null,
  notice_version text references privacy_notices(version),
  source         text not null check (source in ('notice', 'profile', 'admin_import')),
  recorded_at    timestamptz not null default now()    -- เวลา server เท่านั้น
);
create index if not exists idx_consent_user on consent_events (user_id, purpose_code, recorded_at desc);
create index if not exists idx_consent_tenant on consent_events (tenant_id, recorded_at);

-- ------------------------------------------------------------
-- RLS: อ่านได้ตามสิทธิ์ · เขียนผ่าน RPC เท่านั้น
-- ------------------------------------------------------------
alter table privacy_notices          enable row level security;
alter table consent_purposes         enable row level security;
alter table privacy_acknowledgements enable row level security;
alter table consent_events           enable row level security;

create policy privacy_notices_read  on privacy_notices  for select using (auth_user_id() is not null or is_platform_admin());
create policy consent_purposes_read on consent_purposes for select using (auth_user_id() is not null or is_platform_admin());
create policy privack_read on privacy_acknowledgements for select
  using (tenant_id = auth_tenant_id() and (user_id = auth_user_id() or is_tenant_admin()));
create policy consent_events_read on consent_events for select
  using (tenant_id = auth_tenant_id() and (user_id = auth_user_id() or is_tenant_admin()));

-- ------------------------------------------------------------
-- สถานะ consent ล่าสุดของ user ต่อวัตถุประสงค์ (null = ยังไม่เคยตอบ = ถือว่าไม่ยินยอม)
-- ------------------------------------------------------------
create or replace function has_consent(p_user_id uuid, p_purpose text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select granted from consent_events
     where user_id = p_user_id and purpose_code = p_purpose
     order by recorded_at desc, id desc limit 1
  ), false);
$$;

create or replace function _privacy_status(p_user_id uuid, p_tenant_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with n as (select * from privacy_notices where is_current limit 1)
  select jsonb_build_object(
    'company',  (select name from tenants where id = p_tenant_id),
    'notice',   (select jsonb_build_object('version', n.version, 'title', n.title_th, 'summary', n.summary_th,
                                           'full_url', n.full_url, 'effective_at', n.effective_at,
                                           'change_note', n.change_note) from n),
    'acknowledged', exists (select 1 from privacy_acknowledgements a, n
                             where a.user_id = p_user_id and a.notice_version = n.version),
    'acknowledged_at', (select a.accepted_at from privacy_acknowledgements a, n
                         where a.user_id = p_user_id and a.notice_version = n.version),
    'is_first_time', not exists (select 1 from privacy_acknowledgements a where a.user_id = p_user_id),
    'purposes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', p.code, 'title', p.title_th, 'description', p.description_th,
               'granted', (select e.granted from consent_events e
                            where e.user_id = p_user_id and e.purpose_code = p.code
                            order by e.recorded_at desc, e.id desc limit 1))
             order by p.sort_order, p.code)
        from consent_purposes p where p.is_active), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------------
-- RPC 1: สถานะของฉัน — แอปเรียกทุกครั้งหลัง login
--   acknowledged = false → แสดงหน้า Notice (ครั้งแรก หรือมีเวอร์ชันใหม่)
-- ------------------------------------------------------------
create or replace function my_privacy_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth_user_id() is null then raise exception 'not_authenticated'; end if;
  return _privacy_status(auth_user_id(), auth_tenant_id());
end;
$$;

-- ------------------------------------------------------------
-- RPC 2: กด "รับทราบ" + ตัวเลือก consent ที่ติ๊ก/ไม่ติ๊ก
--   p_consents = {"client_view_photo": true, "company_news": false}
--   ส่งเฉพาะข้อที่ผู้ใช้ตัดสินใจ — ข้อที่ไม่ส่งมา = ไม่บันทึก (ถือว่ายังไม่ยินยอม)
-- ------------------------------------------------------------
create or replace function acknowledge_privacy(p_version text, p_consents jsonb default '{}'::jsonb, p_user_agent text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth_user_id();
  v_tenant uuid := auth_tenant_id();
  v_cur    text;
  k        text;
  v        jsonb;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select version into v_cur from privacy_notices where is_current;
  if v_cur is null or p_version is distinct from v_cur then
    raise exception 'notice_outdated' using hint = 'โหลดประกาศฉบับล่าสุดแล้วลองใหม่';
  end if;

  insert into privacy_acknowledgements (tenant_id, user_id, notice_version, user_agent)
  values (v_tenant, v_user, v_cur, left(p_user_agent, 300))
  on conflict (user_id, notice_version) do nothing;

  for k, v in select * from jsonb_each(coalesce(p_consents, '{}'::jsonb)) loop
    continue when jsonb_typeof(v) <> 'boolean';
    continue when not exists (select 1 from consent_purposes where code = k and is_active);
    -- บันทึกเฉพาะเมื่อสถานะเปลี่ยน (กันแถวซ้ำเวลารับทราบเวอร์ชันใหม่)
    if has_consent(v_user, k) is distinct from (v)::boolean
       or not exists (select 1 from consent_events where user_id = v_user and purpose_code = k) then
      insert into consent_events (tenant_id, user_id, purpose_code, granted, notice_version, source)
      values (v_tenant, v_user, k, (v)::boolean, v_cur, 'notice');
    end if;
  end loop;

  -- คงคอลัมน์เดิมใน users ไว้ให้ระบบเก่าที่อ่านค่านี้
  update users set consent_version = v_cur, consented_at = now()
   where id = v_user and consent_version is distinct from v_cur;

  return _privacy_status(v_user, v_tenant);
end;
$$;

-- ------------------------------------------------------------
-- RPC 3: ให้/ถอน consent จากหน้าโปรไฟล์ (มีผลทันที)
-- ------------------------------------------------------------
create or replace function set_consent(p_purpose text, p_granted boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth_user_id();
  v_tenant uuid := auth_tenant_id();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from consent_purposes where code = p_purpose and is_active) then
    raise exception 'unknown_purpose';
  end if;
  if has_consent(v_user, p_purpose) is distinct from p_granted
     or not exists (select 1 from consent_events where user_id = v_user and purpose_code = p_purpose) then
    insert into consent_events (tenant_id, user_id, purpose_code, granted, notice_version, source)
    values (v_tenant, v_user, p_purpose, p_granted,
            (select version from privacy_notices where is_current), 'profile');
  end if;
  return _privacy_status(v_user, v_tenant);
end;
$$;

-- ------------------------------------------------------------
-- RPC 4: ประวัติของฉัน (หน้าโปรไฟล์)
-- ------------------------------------------------------------
create or replace function my_privacy_history()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth_user_id();
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'acknowledgements', coalesce((
      select jsonb_agg(jsonb_build_object('version', a.notice_version, 'accepted_at', a.accepted_at,
                                          'title', n.title_th, 'full_url', n.full_url, 'is_current', n.is_current)
                       order by a.accepted_at desc)
        from privacy_acknowledgements a join privacy_notices n on n.version = a.notice_version
       where a.user_id = v_user), '[]'::jsonb),
    'consent_events', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', e.purpose_code, 'title', p.title_th, 'granted', e.granted,
                                          'source', e.source, 'recorded_at', e.recorded_at)
                       order by e.recorded_at desc, e.id desc)
        from consent_events e join consent_purposes p on p.code = e.purpose_code
       where e.user_id = v_user), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- RPC 5 (แอดมิน Force): ภาพรวมการรับทราบ/consent ของพนักงานในบริษัท
-- ------------------------------------------------------------
create or replace function tenant_privacy_overview()
returns table (user_id uuid, employee_code text, full_name text, role text,
               acknowledged_current boolean, acknowledged_at timestamptz, consents jsonb)
language sql stable security definer set search_path = public as $$
  select u.id, u.employee_code, u.full_name, u.role,
         exists (select 1 from privacy_acknowledgements a join privacy_notices n on n.version = a.notice_version and n.is_current
                  where a.user_id = u.id),
         (select max(a.accepted_at) from privacy_acknowledgements a where a.user_id = u.id),
         coalesce((select jsonb_object_agg(p.code, has_consent(u.id, p.code)) from consent_purposes p where p.is_active), '{}'::jsonb)
    from users u
   where u.tenant_id = auth_tenant_id() and is_tenant_admin() and u.is_active
   order by u.employee_code;
$$;

revoke all on function has_consent(uuid, text)      from public, anon;
revoke all on function _privacy_status(uuid, uuid)  from public, anon, authenticated;
revoke all on function my_privacy_status()          from public, anon;
revoke all on function acknowledge_privacy(text, jsonb, text) from public, anon;
revoke all on function set_consent(text, boolean)   from public, anon;
revoke all on function my_privacy_history()         from public, anon;
revoke all on function tenant_privacy_overview()    from public, anon;
grant execute on function has_consent(uuid, text)      to authenticated, service_role;
grant execute on function my_privacy_status()          to authenticated;
grant execute on function acknowledge_privacy(text, jsonb, text) to authenticated;
grant execute on function set_consent(text, boolean)   to authenticated;
grant execute on function my_privacy_history()         to authenticated;
grant execute on function tenant_privacy_overview()    to authenticated;

-- ------------------------------------------------------------
-- ข้อมูลตั้งต้น: Notice v2026-10-22 + consent 2 เรื่อง
-- ⚠️ ข้อความเป็นร่าง — ให้ที่ปรึกษากฎหมาย/DPO ตรวจก่อนใช้งานจริง
-- ------------------------------------------------------------
insert into privacy_notices (version, is_current, title_th, summary_th, full_url, change_note) values (
  '2026-10-22', true,
  'ประกาศความเป็นส่วนตัวสำหรับพนักงานรักษาความปลอดภัย',
  '[
    {"title":"เราเก็บอะไร","text":"ชื่อ รหัสพนักงาน เบอร์โทร บัญชี LINE รูปถ่ายตอนเข้า-ออกงานและสแกนจุดตรวจ พิกัดตำแหน่งขณะลงเวลา และข้อมูลเครื่องมือถือที่ใช้"},
    {"title":"ใช้ทำอะไร","text":"ลงเวลาทำงาน ยืนยันว่าอยู่ที่จุดปฏิบัติงานจริง ตรวจการเดินตรวจ คำนวณค่าแรงและค่าล่วงเวลา และป้องกันการลงเวลาแทนกัน"},
    {"title":"ใครเห็นข้อมูล","text":"บริษัทนายจ้างของคุณ หัวหน้างาน และผู้ดูแลระบบ Horguard ที่ได้รับมอบหมาย ไม่มีการขายข้อมูลให้ผู้อื่น"},
    {"title":"เก็บนานแค่ไหน","text":"รูปถ่ายเก็บ 60 วันแล้วลบอัตโนมัติ (รายการที่ระบบพบความผิดปกติเก็บ 1 ปีเพื่อใช้เป็นหลักฐาน) ข้อมูลเวลาทำงานเก็บตามที่กฎหมายแรงงานกำหนด"},
    {"title":"สิทธิของคุณ","text":"ขอดู ขอสำเนา ขอแก้ไข ขอลบ หรือคัดค้านการใช้ข้อมูลได้ โดยติดต่อฝ่ายบุคคลของบริษัท และถอนความยินยอมเรื่องที่ไม่บังคับได้ทุกเมื่อในหน้าโปรไฟล์"}
  ]'::jsonb,
  'https://horguard.com/privacy',
  null
) on conflict (version) do nothing;

insert into consent_purposes (code, title_th, description_th, is_active, sort_order) values
  ('client_view_photo', 'ให้ลูกค้าเจ้าของสถานที่เห็นรูปเข้างานของฉัน',
   'ลูกค้าที่จ้างบริษัทจะเห็นรูปถ่ายตอนเข้างานและเดินตรวจของคุณในรายงานของโครงการ ถ้าไม่ยินยอม ลูกค้าจะเห็นเฉพาะเวลาและสถานะ ไม่เห็นรูป', true, 10),
  ('company_news', 'รับข่าวสารและประกาศกะว่างทาง LINE',
   'บริษัทส่งข่าวสาร ประกาศรับสมัครกะว่าง และงานเสริมให้ทาง LINE ไม่ยินยอมก็ยังได้รับข้อความเรื่องกะงานของตัวเองตามปกติ', true, 20)
on conflict (code) do nothing;
