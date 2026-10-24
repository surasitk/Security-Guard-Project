-- Guard OS / Horguard — Migration 35: แพ็กเกจ + เพดานการใช้งาน (Plan limits) + CMS ราคาสำหรับเว็บไซต์
-- (24 ต.ค. 2569 · ตามคำขอคุณเต๋) · รันซ้ำได้
-- · ทุกแพ็กเกจได้ฟีเจอร์ครบเท่ากัน ต่างกันที่จำนวนผู้ใช้หน้างาน + เพดาน (limits)
-- · Super Admin แก้ราคา/เพดาน/ข้อความหน้าเว็บของแต่ละแพ็กเกจได้ (plans = CMS) และกำหนดแพ็กเกจให้แต่ละ Tenant
-- · ค่า null ในเพดาน = ไม่จำกัด · Tenant ใส่ค่าเฉพาะราย (overrides) ได้ เช่น ซื้อ +5 โครงการ
-- · เว็บไซต์อ่านราคาผ่าน get_public_pricing() (anon)

-- ============================================================
-- 1) ตาราง
-- ============================================================
create table if not exists plans (
  id                text primary key check (id ~ '^[a-z0-9_-]{2,30}$'),
  name              text not null,
  tagline           text,
  price_monthly     numeric(12,2),                 -- null = ติดต่อฝ่ายขาย
  price_yearly      numeric(12,2),                 -- null = คิดจาก months_free ใน pricing content
  setup_fee         numeric(12,2),
  setup_fee_note    text,                          -- เช่น 'ตามขอบเขตงาน'
  included_users    integer,                       -- ผู้ใช้หน้างานที่รวมในราคา
  overage_per_user  numeric(10,2),                 -- คนเกิน คิดเพิ่มคนละ
  limits            jsonb not null default '{}',   -- ดู plan_limit_keys()
  features          jsonb not null default '[]',   -- ข้อความ bullet บนเว็บ ["...", ...]
  support_text      text,
  badge             text,                          -- เช่น 'แนะนำ'
  highlight         boolean not null default false,
  cta_label         text,
  cta_url           text,
  sort_order        integer not null default 0,
  is_public         boolean not null default true,  -- แสดงบนเว็บไซต์
  is_active         boolean not null default true,  -- กำหนดให้ Tenant ได้
  updated_at        timestamptz not null default now(),
  updated_by        uuid references users(id)
);
alter table plans enable row level security;
drop policy if exists plans_select on plans;
create policy plans_select on plans for select using (is_platform_admin());

create table if not exists plan_addons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price       numeric(12,2),
  unit        text default 'เดือน',
  limit_key   text,          -- เพดานที่ add-on นี้เพิ่ม (ใส่ใน overrides ของ Tenant)
  limit_delta integer,
  sort_order  integer not null default 0,
  is_public   boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table plan_addons enable row level security;
drop policy if exists plan_addons_select on plan_addons;
create policy plan_addons_select on plan_addons for select using (is_platform_admin());

create table if not exists site_content (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
alter table site_content enable row level security;
drop policy if exists site_content_select on site_content;
create policy site_content_select on site_content for select using (is_platform_admin());

create table if not exists tenant_plans (
  tenant_id      uuid primary key references tenants(id) on delete cascade,
  plan_id        text not null references plans(id),
  status         text not null default 'active' check (status in ('trial','active','suspended')),
  billing_cycle  text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  trial_ends_at  timestamptz,
  overrides      jsonb not null default '{}',   -- เพดานเฉพาะราย {"max_properties": 10, ...} (null = ไม่จำกัด)
  note           text,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references users(id)
);
alter table tenant_plans enable row level security;
drop policy if exists tenant_plans_select on tenant_plans;
create policy tenant_plans_select on tenant_plans for select
  using (is_platform_admin() or (tenant_id = auth_tenant_id() and is_tenant_admin()));

create table if not exists tenant_plan_history (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  plan_id    text,
  status     text,
  overrides  jsonb,
  note       text,
  changed_by uuid references users(id),
  changed_at timestamptz not null default now()
);
create index if not exists idx_tph_tenant on tenant_plan_history(tenant_id, changed_at desc);
alter table tenant_plan_history enable row level security;
drop policy if exists tph_select on tenant_plan_history;
create policy tph_select on tenant_plan_history for select using (is_platform_admin());

-- ============================================================
-- 2) ข้อมูลเริ่มต้น (ตามเอกสารราคา 24 ต.ค. 2569 · ราคาไม่รวม VAT)
-- ============================================================
insert into plans (id, name, tagline, price_monthly, price_yearly, setup_fee, setup_fee_note, included_users, overage_per_user,
                   limits, features, support_text, badge, highlight, cta_label, sort_order)
values
 ('starter', 'Starter', 'สำหรับบริษัทที่เริ่มต้น ไม่เกิน 80 คน', 2490, 24900, 5000, null, 30, 79,
  '{"max_field_users":80,"max_properties":5,"max_checkpoints_per_property":10,"max_staff_accounts":2,"max_client_accounts":3,"broadcasts_per_month":4,"media_retention_days":30,"report_lookback_months":3,"own_line_oa":false}',
  '["รวมผู้ใช้หน้างาน 30 คน","คนเกิน คิดเพิ่มคนละ 79฿","5 โครงการ · จุดตรวจ 10 จุดต่อโครงการ","แอดมิน + ผจก.โซน 2 บัญชี","บัญชีลูกค้า 3 บัญชี","ประกาศกลุ่มผ่าน LINE 4 ครั้ง/เดือน","เก็บรูปและเสียง 30 วัน · รายงานย้อนหลัง 3 เดือน"]',
  'LINE OA', null, false, 'ขอดูเดโม', 10),
 ('business', 'Business', 'สำหรับบริษัท 50–300 คน หลายโครงการ', 6900, 69000, 10000, null, 100, 65,
  '{"max_field_users":300,"max_properties":30,"max_checkpoints_per_property":30,"max_staff_accounts":10,"max_client_accounts":30,"broadcasts_per_month":20,"media_retention_days":90,"report_lookback_months":12,"own_line_oa":false}',
  '["รวมผู้ใช้หน้างาน 100 คน","คนเกิน คิดเพิ่มคนละ 65฿","30 โครงการ · จุดตรวจ 30 จุดต่อโครงการ","แอดมิน + ผจก.โซน 10 บัญชี","บัญชีลูกค้า 30 บัญชี","ประกาศกลุ่มผ่าน LINE 20 ครั้ง/เดือน","เก็บรูปและเสียง 90 วัน · รายงานย้อนหลัง 12 เดือน"]',
  'LINE OA ในเวลาทำการ ตอบภายใน 4 ชม.', 'แนะนำ', true, 'ทดลองใช้ฟรี 30 วัน', 20),
 ('enterprise', 'Enterprise', 'สำหรับบริษัทใหญ่ 300 คนขึ้นไป', 16900, 169000, null, 'ตามขอบเขตงาน', 300, 49,
  '{"max_field_users":null,"max_properties":null,"max_checkpoints_per_property":null,"max_staff_accounts":null,"max_client_accounts":null,"broadcasts_per_month":null,"media_retention_days":365,"report_lookback_months":null,"own_line_oa":true}',
  '["รวมผู้ใช้หน้างาน 300 คน","คนเกิน คิดเพิ่มคนละ 49฿","โครงการและจุดตรวจไม่จำกัด","แอดมิน ผจก.โซน และบัญชีลูกค้าไม่จำกัด","ประกาศกลุ่มผ่าน LINE ไม่จำกัด (fair use)","เก็บรูปและเสียง 1 ปี · รายงานย้อนหลังไม่จำกัด","LINE OA แบรนด์ตัวเอง (เพิ่มเงินได้)"]',
  'ผู้ดูแลเฉพาะ + SLA', null, false, 'คุยกับทีมขาย', 30)
on conflict (id) do nothing;

insert into plan_addons (name, description, price, unit, limit_key, limit_delta, sort_order)
select * from (values
  ('+5 โครงการ', 'เพิ่มเพดานโครงการโดยไม่ต้องอัปเกรด', 500::numeric, 'เดือน', 'max_properties', 5, 10),
  ('ขยายเก็บรูปและเสียงเป็น 1 ปี', 'สำหรับ Starter และ Business', 1000::numeric, 'เดือน', 'media_retention_days', null, 20)
) v(name, description, price, unit, limit_key, limit_delta, sort_order)
where not exists (select 1 from plan_addons);

insert into site_content (key, value) values ('pricing', '{
  "title": "ราคาเดียว ฟีเจอร์ครบทุกแพ็กเกจ",
  "subtitle": "SOS ตรวจพิกัดน่าสงสัย และ geofence มีครบทุกแพ็กเกจ ต่างกันแค่จำนวนผู้ใช้และเพดานการใช้งาน",
  "vat_note": "ราคาไม่รวม VAT",
  "months_free_yearly": 2,
  "trial_days": 30,
  "trial_plan": "business",
  "counting_rule": "นับเฉพาะผู้ใช้หน้างาน (รปภ. หัวหน้ากะ สแปร์ สายตรวจ) ที่เข้างานอย่างน้อย 1 ครั้งในเดือน · เจ้าของ แอดมิน ผจก.โซน และลูกค้าไม่นับ",
  "notes": ["จ่ายรายปี ลด 2 เดือน", "ค่าเริ่มระบบยกเว้นให้เมื่อจ่ายรายปี", "ทดลองใช้ฟรี 30 วัน แบบ Business"],
  "limit_labels": {
    "max_field_users": "เพดานผู้ใช้หน้างาน",
    "max_properties": "โครงการ",
    "max_checkpoints_per_property": "จุดตรวจ QR ต่อโครงการ",
    "max_staff_accounts": "บัญชีแอดมิน + ผจก.โซน",
    "max_client_accounts": "บัญชีลูกค้า (Client dashboard)",
    "broadcasts_per_month": "ประกาศกลุ่มผ่าน LINE ต่อเดือน",
    "media_retention_days": "เก็บรูป selfie / เสียง SOS (วัน)",
    "report_lookback_months": "ดูรายงานย้อนหลัง (เดือน)",
    "own_line_oa": "LINE OA แบรนด์ตัวเอง"
  }
}') on conflict (key) do nothing;

-- Tenant ปัจจุบัน: Test Vendor + The Sun Guard = Enterprise (ตามคำสั่งคุณเต๋)
insert into tenant_plans (tenant_id, plan_id, status, note)
select t.id, 'enterprise', 'active', 'กำหนดโดยระบบ (migration 35): Tenant ทดสอบ / ลูกค้าแรก'
  from tenants t where t.code_prefix in ('TV','SN')
on conflict (tenant_id) do nothing;
-- Tenant อื่นที่ยังไม่มีแพ็กเกจ (ถ้ามี) = ทดลอง Business 30 วัน
insert into tenant_plans (tenant_id, plan_id, status, trial_ends_at, note)
select t.id, 'business', 'trial', now() + interval '30 days', 'ทดลองใช้ (migration 35)'
  from tenants t where not exists (select 1 from tenant_plans tp where tp.tenant_id = t.id)
on conflict (tenant_id) do nothing;
update tenants t set plan = tp.plan_id from tenant_plans tp where tp.tenant_id = t.id and t.plan is distinct from tp.plan_id;

-- Tenant ใหม่ → ทดลองแพ็กเกจตาม pricing.trial_plan
create or replace function trg_tenant_default_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_plan text; v_days int;
begin
  select coalesce(value->>'trial_plan', 'business'), coalesce((value->>'trial_days')::int, 30)
    into v_plan, v_days from site_content where key = 'pricing';
  if v_plan is null or not exists (select 1 from plans where id = v_plan) then v_plan := 'business'; v_days := 30; end if;
  insert into tenant_plans (tenant_id, plan_id, status, trial_ends_at, note)
  values (new.id, v_plan, 'trial', now() + make_interval(days => v_days), 'ทดลองใช้อัตโนมัติ')
  on conflict (tenant_id) do nothing;
  return new;
end $$;
drop trigger if exists tenant_default_plan on tenants;
create trigger tenant_default_plan after insert on tenants for each row execute function trg_tenant_default_plan();

-- ============================================================
-- 3) อ่านเพดาน
-- ============================================================
-- บทบาทที่นับเป็น "ผู้ใช้หน้างาน" (ลงเวลา/เดินตรวจ)
create or replace function is_field_role(p_role text) returns boolean
language sql immutable as $$ select p_role in ('guard','shift_leader','spare','supervisor','assistant_supervisor','trainer') $$;

-- เพดานของ Tenant: overrides ก่อน แล้วค่อยแพ็กเกจ · คืน null = ไม่จำกัด
-- (มี key ใน overrides แต่ค่าเป็น null = ไม่จำกัดเฉพาะราย)
create or replace function tenant_limit(p_tenant uuid, p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select case
           when tp.tenant_id is null then null
           when tp.overrides ? p_key then nullif(tp.overrides->>p_key, '')::numeric
           else nullif(p.limits->>p_key, '')::numeric
         end
    from (select p_tenant as tid) x
    left join tenant_plans tp on tp.tenant_id = x.tid
    left join plans p on p.id = tp.plan_id
$$;
revoke execute on function tenant_limit(uuid, text) from public, anon;

create or replace function plan_limit_error(p_key text, p_limit numeric) returns void
language plpgsql as $$
begin
  raise exception 'plan_limit:%', p_key using detail = coalesce(p_limit::text, ''), hint = 'อัปเกรดแพ็กเกจหรือซื้อเพิ่มได้ ติดต่อ Horguard';
end $$;

-- ============================================================
-- 4) ตรวจเพดานตอนเพิ่มข้อมูล (trigger) — ใช้กับทุกช่องทาง (RPC/นำเข้า/แก้ตรง)
-- ============================================================
create or replace function trg_limit_properties() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max numeric; v_cnt int;
begin
  if new.is_test or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and not old.is_test then return new; end if;
  v_max := tenant_limit(new.tenant_id, 'max_properties');
  if v_max is null then return new; end if;
  select count(*) into v_cnt from properties
   where tenant_id = new.tenant_id and is_active and not is_test and id <> new.id;
  if v_cnt >= v_max then perform plan_limit_error('max_properties', v_max); end if;
  return new;
end $$;
drop trigger if exists limit_properties on properties;
create trigger limit_properties before insert or update of is_active, is_test on properties
  for each row execute function trg_limit_properties();

create or replace function trg_limit_checkpoints() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max numeric; v_cnt int;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.property_id = new.property_id then return new; end if;
  v_max := tenant_limit(new.tenant_id, 'max_checkpoints_per_property');
  if v_max is null then return new; end if;
  select count(*) into v_cnt from checkpoints
   where property_id = new.property_id and is_active and id <> new.id;
  if v_cnt >= v_max then perform plan_limit_error('max_checkpoints_per_property', v_max); end if;
  return new;
end $$;
drop trigger if exists limit_checkpoints on checkpoints;
create trigger limit_checkpoints before insert or update of is_active, property_id on checkpoints
  for each row execute function trg_limit_checkpoints();

-- ผู้ใช้: แอดมิน+ผจก.โซน / ลูกค้า / ผู้ใช้หน้างาน (นับบัญชีที่เปิดใช้อยู่)
create or replace function trg_limit_users() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_key text; v_max numeric; v_cnt int;
begin
  if not new.is_active then return new; end if;
  v_key := case when new.role in ('admin','zone_manager') then 'max_staff_accounts'
                when new.role = 'client' then 'max_client_accounts'
                when is_field_role(new.role) then 'max_field_users' end;
  if v_key is null then return new; end if;
  -- แก้ไขคนเดิมที่ยังอยู่กลุ่มเดิม ไม่ต้องตรวจ
  if tg_op = 'UPDATE' and old.is_active and old.tenant_id = new.tenant_id
     and (case when old.role in ('admin','zone_manager') then 'max_staff_accounts'
               when old.role = 'client' then 'max_client_accounts'
               when is_field_role(old.role) then 'max_field_users' end) = v_key then
    return new;
  end if;
  v_max := tenant_limit(new.tenant_id, v_key);
  if v_max is null then return new; end if;
  select count(*) into v_cnt from users u
   where u.tenant_id = new.tenant_id and u.is_active and u.id <> new.id
     and case v_key when 'max_staff_accounts' then u.role in ('admin','zone_manager')
                    when 'max_client_accounts' then u.role = 'client'
                    else is_field_role(u.role) end;
  if v_cnt >= v_max then perform plan_limit_error(v_key, v_max); end if;
  return new;
end $$;
drop trigger if exists limit_users on users;
create trigger limit_users before insert or update of is_active, role, tenant_id on users
  for each row execute function trg_limit_users();

create or replace function trg_limit_broadcasts() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_max numeric; v_cnt int;
begin
  v_max := tenant_limit(new.tenant_id, 'broadcasts_per_month');
  if v_max is null then return new; end if;
  select count(*) into v_cnt from broadcasts
   where tenant_id = new.tenant_id
     and created_at >= date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  if v_cnt >= v_max then perform plan_limit_error('broadcasts_per_month', v_max); end if;
  return new;
end $$;
drop trigger if exists limit_broadcasts on broadcasts;
create trigger limit_broadcasts before insert on broadcasts for each row execute function trg_limit_broadcasts();

-- ============================================================
-- 5) รายงานย้อนหลังตามแพ็กเกจ: report_attendance ตัดวันเริ่มให้ไม่เกิน report_lookback_months
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'report_attendance_core') then
    alter function report_attendance(date, date, uuid, uuid) rename to report_attendance_core;
  end if;
end $$;
revoke execute on function report_attendance_core(date, date, uuid, uuid) from public, anon, authenticated;

create or replace function report_min_date(p_tenant uuid default null) returns date
language sql stable security definer set search_path = public as $$
  select case when is_platform_admin() then null
              else ((now() at time zone 'Asia/Bangkok')::date
                    - make_interval(months => tenant_limit(coalesce(p_tenant, auth_tenant_id()), 'report_lookback_months')::int))::date
         end
$$;
grant execute on function report_min_date(uuid) to authenticated;

create or replace function report_attendance(
  p_from date, p_to date, p_property_id uuid default null, p_user_id uuid default null
) returns table (
  work_date date, property_id uuid, property_name text, user_id uuid, full_name text, employee_code text,
  check_in_at timestamptz, check_out_at timestamptz, late_minutes integer, ot_minutes integer,
  kind text, is_holiday_work boolean, status text, flag_reason text, daily_wage numeric, amount numeric
) language sql stable security definer set search_path = public as $$
  select * from report_attendance_core(greatest(p_from, coalesce(report_min_date(), p_from)), p_to, p_property_id, p_user_id)
$$;
grant execute on function report_attendance(date, date, uuid, uuid) to authenticated;

-- ============================================================
-- 6) อายุเก็บรูป/เสียงตามแพ็กเกจ (bucket selfies/<tenant_id>/...)
-- ============================================================
create or replace function selfie_purge_candidates(p_limit int default 500)
returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  with cfg as (
    select app_setting_int('selfie_retention_days', 60) as default_days,
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
  ),
  objs as (
    select o.name, o.created_at,
           case when split_part(o.name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(o.name, '/', 1)::uuid end as tid
      from storage.objects o
     where o.bucket_id = 'selfies'
  )
  select objs.name
    from objs, cfg
   where objs.created_at < now() - make_interval(days =>
           coalesce(tenant_limit(objs.tid, 'media_retention_days')::int, cfg.default_days))
     and not exists (select 1 from held where held.p = objs.name)
   order by objs.created_at
   limit greatest(1, least(p_limit, 1000));
$$;
revoke all on function selfie_purge_candidates(int) from public, anon, authenticated;
grant execute on function selfie_purge_candidates(int) to service_role;

-- ============================================================
-- 7) การใช้งานของ Tenant (เจ้าของ/แอดมิน ดูของตัวเอง · Super Admin ดูได้ทุก Tenant)
-- ============================================================
create or replace function tenant_usage(p_tenant uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tid uuid := coalesce(p_tenant, auth_tenant_id());
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';
  tp tenant_plans%rowtype; p plans%rowtype;
  v_active int; v_over int; v_est numeric; v_next plans%rowtype; v_next_cost numeric;
  v_usage jsonb;
begin
  if not (is_platform_admin() or (v_tid = auth_tenant_id() and is_tenant_admin())) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into tp from tenant_plans where tenant_id = v_tid;
  select * into p from plans where id = tp.plan_id;

  select count(distinct a.user_id) into v_active
    from attendance a join users u on u.id = a.user_id
   where a.tenant_id = v_tid and a.check_in_at >= v_month_start and is_field_role(u.role);

  v_usage := jsonb_build_object(
    'active_field_users_month', v_active,
    'max_field_users',          (select count(*) from users u where u.tenant_id = v_tid and u.is_active and is_field_role(u.role)),
    'max_properties',           (select count(*) from properties x where x.tenant_id = v_tid and x.is_active and not x.is_test),
    'max_checkpoints_per_property', (select coalesce(max(c), 0) from (select count(*) c from checkpoints k where k.tenant_id = v_tid and k.is_active group by k.property_id) q),
    'max_staff_accounts',       (select count(*) from users u where u.tenant_id = v_tid and u.is_active and u.role in ('admin','zone_manager')),
    'max_client_accounts',      (select count(*) from users u where u.tenant_id = v_tid and u.is_active and u.role = 'client'),
    'broadcasts_per_month',     (select count(*) from broadcasts b where b.tenant_id = v_tid and b.created_at >= v_month_start)
  );

  v_over := greatest(0, v_active - coalesce(p.included_users, v_active));
  v_est := coalesce(p.price_monthly, 0) + v_over * coalesce(p.overage_per_user, 0);
  -- แพ็กเกจถัดไปที่ถูกกว่าสำหรับจำนวนคนเท่านี้ (แจ้ง "อัปเกรดแล้วถูกกว่า")
  select * into v_next from plans n
   where n.is_active and n.sort_order > coalesce(p.sort_order, 0) and n.price_monthly is not null
   order by n.sort_order limit 1;
  if v_next.id is not null then
    v_next_cost := v_next.price_monthly + greatest(0, v_active - coalesce(v_next.included_users, v_active)) * coalesce(v_next.overage_per_user, 0);
  end if;

  return jsonb_build_object(
    'ok', true, 'tenant_id', v_tid,
    'plan', to_jsonb(p) - 'updated_by',
    'status', tp.status, 'billing_cycle', tp.billing_cycle, 'trial_ends_at', tp.trial_ends_at,
    'overrides', coalesce(tp.overrides, '{}'),
    'limits', (select jsonb_object_agg(k, tenant_limit(v_tid, k))
                 from unnest(array['max_field_users','max_properties','max_checkpoints_per_property','max_staff_accounts',
                                   'max_client_accounts','broadcasts_per_month','media_retention_days','report_lookback_months']) k),
    'usage', v_usage,
    'billing', jsonb_build_object('active_users', v_active, 'included', p.included_users, 'overage_users', v_over,
                                  'overage_per_user', p.overage_per_user, 'estimate_monthly', v_est,
                                  'cheaper_plan', case when v_next.id is not null and v_next_cost < v_est
                                                       then jsonb_build_object('id', v_next.id, 'name', v_next.name, 'estimate_monthly', v_next_cost) end)
  );
end $$;
revoke execute on function tenant_usage(uuid) from public, anon;
grant execute on function tenant_usage(uuid) to authenticated;

-- ============================================================
-- 8) Super Admin: จัดการแพ็กเกจ (CMS) + กำหนดแพ็กเกจให้ Tenant
-- ============================================================
create or replace function admin_list_plans() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true,
    'plans',   coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('tenant_count',
                  (select count(*) from tenant_plans tp where tp.plan_id = p.id)) order by p.sort_order) from plans p), '[]'),
    'addons',  coalesce((select jsonb_agg(to_jsonb(a) order by a.sort_order) from plan_addons a), '[]'),
    'content', (select value from site_content where key = 'pricing'),
    'tenants', coalesce((select jsonb_agg(jsonb_build_object(
                  'tenant_id', t.id, 'name', t.name, 'code_prefix', t.code_prefix, 'is_active', t.is_active,
                  'plan_id', tp.plan_id, 'status', tp.status, 'billing_cycle', tp.billing_cycle,
                  'trial_ends_at', tp.trial_ends_at, 'overrides', tp.overrides, 'note', tp.note, 'updated_at', tp.updated_at,
                  'field_users', (select count(*) from users u where u.tenant_id = t.id and u.is_active and is_field_role(u.role)),
                  'properties', (select count(*) from properties x where x.tenant_id = t.id and x.is_active and not x.is_test))
                  order by t.name) from tenants t left join tenant_plans tp on tp.tenant_id = t.id), '[]'));
end $$;

create or replace function admin_save_plan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := lower(trim(p->>'id'));
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_id is null or v_id !~ '^[a-z0-9_-]{2,30}$' then return jsonb_build_object('ok', false, 'error', 'invalid_plan_id'); end if;
  if coalesce(trim(p->>'name'), '') = '' then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;
  insert into plans as x (id, name, tagline, price_monthly, price_yearly, setup_fee, setup_fee_note, included_users, overage_per_user,
                          limits, features, support_text, badge, highlight, cta_label, cta_url, sort_order, is_public, is_active, updated_at, updated_by)
  values (v_id, trim(p->>'name'), p->>'tagline',
          nullif(p->>'price_monthly','')::numeric, nullif(p->>'price_yearly','')::numeric,
          nullif(p->>'setup_fee','')::numeric, p->>'setup_fee_note',
          nullif(p->>'included_users','')::int, nullif(p->>'overage_per_user','')::numeric,
          coalesce(p->'limits', '{}'), coalesce(p->'features', '[]'), p->>'support_text', nullif(p->>'badge',''),
          coalesce((p->>'highlight')::boolean, false), p->>'cta_label', p->>'cta_url',
          coalesce(nullif(p->>'sort_order','')::int, 0), coalesce((p->>'is_public')::boolean, true),
          coalesce((p->>'is_active')::boolean, true), now(), auth_user_id())
  on conflict (id) do update set
    name = excluded.name, tagline = excluded.tagline, price_monthly = excluded.price_monthly, price_yearly = excluded.price_yearly,
    setup_fee = excluded.setup_fee, setup_fee_note = excluded.setup_fee_note, included_users = excluded.included_users,
    overage_per_user = excluded.overage_per_user, limits = excluded.limits, features = excluded.features,
    support_text = excluded.support_text, badge = excluded.badge, highlight = excluded.highlight, cta_label = excluded.cta_label,
    cta_url = excluded.cta_url, sort_order = excluded.sort_order, is_public = excluded.is_public, is_active = excluded.is_active,
    updated_at = now(), updated_by = auth_user_id();
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (auth_tenant_id(), auth_user_id(), 'save_plan', 'plans', v_id, p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function admin_save_addon(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce((p->>'delete')::boolean, false) then delete from plan_addons where id = v_id; return jsonb_build_object('ok', true); end if;
  if coalesce(trim(p->>'name'), '') = '' then return jsonb_build_object('ok', false, 'error', 'name_required'); end if;
  if v_id is null then
    insert into plan_addons (name, description, price, unit, limit_key, limit_delta, sort_order, is_public)
    values (trim(p->>'name'), p->>'description', nullif(p->>'price','')::numeric, coalesce(p->>'unit','เดือน'),
            nullif(p->>'limit_key',''), nullif(p->>'limit_delta','')::int, coalesce(nullif(p->>'sort_order','')::int, 0),
            coalesce((p->>'is_public')::boolean, true))
    returning id into v_id;
  else
    update plan_addons set name = trim(p->>'name'), description = p->>'description', price = nullif(p->>'price','')::numeric,
           unit = coalesce(p->>'unit','เดือน'), limit_key = nullif(p->>'limit_key',''), limit_delta = nullif(p->>'limit_delta','')::int,
           sort_order = coalesce(nullif(p->>'sort_order','')::int, 0), is_public = coalesce((p->>'is_public')::boolean, true), updated_at = now()
     where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function admin_save_site_content(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into site_content (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth_user_id())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth_user_id();
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_set_tenant_plan(
  p_tenant uuid, p_plan text, p_status text default 'active', p_billing_cycle text default 'monthly',
  p_trial_ends_at timestamptz default null, p_overrides jsonb default '{}', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not exists (select 1 from tenants where id = p_tenant) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not exists (select 1 from plans where id = p_plan) then return jsonb_build_object('ok', false, 'error', 'invalid_plan_id'); end if;
  if p_status not in ('trial','active','suspended') or p_billing_cycle not in ('monthly','yearly') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  insert into tenant_plans as x (tenant_id, plan_id, status, billing_cycle, trial_ends_at, overrides, note, updated_at, updated_by)
  values (p_tenant, p_plan, p_status, p_billing_cycle, case when p_status = 'trial' then p_trial_ends_at end,
          coalesce(p_overrides, '{}'), p_note, now(), auth_user_id())
  on conflict (tenant_id) do update set
    plan_id = excluded.plan_id, status = excluded.status, billing_cycle = excluded.billing_cycle,
    trial_ends_at = excluded.trial_ends_at, overrides = excluded.overrides, note = excluded.note,
    started_at = case when x.plan_id <> excluded.plan_id then now() else x.started_at end,
    updated_at = now(), updated_by = auth_user_id();
  update tenants set plan = p_plan where id = p_tenant;
  insert into tenant_plan_history (tenant_id, plan_id, status, overrides, note, changed_by)
  values (p_tenant, p_plan, p_status, coalesce(p_overrides, '{}'), p_note, auth_user_id());
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (p_tenant, auth_user_id(), 'set_tenant_plan', 'tenant_plans', p_tenant::text,
          jsonb_build_object('plan', p_plan, 'status', p_status, 'cycle', p_billing_cycle, 'overrides', p_overrides));
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function admin_list_plans(), admin_save_plan(jsonb), admin_save_addon(jsonb),
  admin_save_site_content(text, jsonb), admin_set_tenant_plan(uuid, text, text, text, timestamptz, jsonb, text) from public, anon;
grant execute on function admin_list_plans(), admin_save_plan(jsonb), admin_save_addon(jsonb),
  admin_save_site_content(text, jsonb), admin_set_tenant_plan(uuid, text, text, text, timestamptz, jsonb, text) to authenticated;

-- ============================================================
-- 9) สำหรับเว็บไซต์ (anon): ราคา/เพดานที่ตั้ง is_public
-- ============================================================
create or replace function get_public_pricing() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'tagline', p.tagline, 'price_monthly', p.price_monthly,
        'price_yearly', p.price_yearly, 'setup_fee', p.setup_fee, 'setup_fee_note', p.setup_fee_note,
        'included_users', p.included_users, 'overage_per_user', p.overage_per_user, 'limits', p.limits,
        'features', p.features, 'support_text', p.support_text, 'badge', p.badge, 'highlight', p.highlight,
        'cta_label', p.cta_label, 'cta_url', p.cta_url) order by p.sort_order)
      from plans p where p.is_public and p.is_active), '[]'),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'description', a.description,
        'price', a.price, 'unit', a.unit) order by a.sort_order) from plan_addons a where a.is_public), '[]'),
    'content', (select value from site_content where key = 'pricing'),
    'updated_at', greatest((select max(updated_at) from plans), (select max(updated_at) from site_content))
  )
$$;
grant execute on function get_public_pricing() to anon, authenticated;
