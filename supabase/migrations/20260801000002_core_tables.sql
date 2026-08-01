-- Guard OS — Sprint 1
-- Migration 2: Core tables (กลุ่ม A Organization + Scheduling core + System)
-- อิงเอกสาร "Guard OS — Database Schema + System Flows" + ข้อแก้จากรีวิว ก.ค. 2569
--   (tenant_holidays, consent PDPA, device_type kiosk, late/early minutes)

-- ============================================================
-- A1. tenants — บริษัท รปภ. (1 แถว = 1 ลูกค้า SaaS)
-- ============================================================
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  plan          text not null default 'basic',          -- basic / pro
  billing_email text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- A2. users — ทุกบทบาทอยู่ตารางเดียว รวม client
-- ============================================================
create table users (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  line_user_id   text unique,                            -- ว่างจนกว่าจะผูกบัญชี (F1)
  employee_code  text not null,
  full_name      text not null,
  phone          text,
  role           text not null check (role in ('owner','admin','supervisor','shift_leader','guard','client')),
  daily_wage     numeric(10,2),
  photo_url      text,
  weekly_day_off smallint check (weekly_day_off between 0 and 6),  -- วันหยุดประจำสัปดาห์ (0=อาทิตย์) ใช้คำนวณ OT วันหยุด
  consent_version text,                                  -- PDPA: เวอร์ชันข้อตกลงที่ยินยอม
  consented_at   timestamptz,                            -- PDPA: เวลายินยอม
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (tenant_id, employee_code)
);
create index idx_users_tenant on users(tenant_id);
create index idx_users_line on users(line_user_id);

-- ============================================================
-- A3. properties — โครงการ/ไซต์
-- ============================================================
create table properties (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references tenants(id),
  name                       text not null,
  code                       text not null,
  client_user_id             uuid references users(id),
  address                    text,
  center                     geography(point, 4326),
  geofence                   geography(polygon, 4326),   -- ถ้า null ใช้ center + radius
  geofence_radius_m          integer not null default 150,
  contract_start             date,
  contract_end               date,
  billing_rate_per_guard_day numeric(10,2),              -- Sprint 4 จะย้ายเป็น property_billing_rates
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  unique (tenant_id, code)
);
create index idx_properties_tenant on properties(tenant_id);

-- ============================================================
-- A4. units — หน่วยย่อยใน property (optional)
-- ============================================================
create table units (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  property_id uuid not null references properties(id),
  name        text not null,
  is_active   boolean not null default true
);
create index idx_units_property on units(property_id);

-- ============================================================
-- A5. property_managers — supervisor/shift_leader ดูแล property ไหนบ้าง
-- ============================================================
create table property_managers (
  user_id     uuid not null references users(id),
  property_id uuid not null references properties(id),
  tenant_id   uuid not null references tenants(id),
  primary key (user_id, property_id)
);
create index idx_pm_property on property_managers(property_id);
create index idx_pm_tenant on property_managers(tenant_id);

-- ============================================================
-- A6. tenant_holidays — วันหยุดตามประเพณีของบริษัท (จากรีวิว 1.1)
--     จำเป็นต่อ OT 2.5x ตามกฎกระทรวง มีผล 24 เม.ย. 2569
-- ============================================================
create table tenant_holidays (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  holiday_date date not null,
  name         text not null,
  unique (tenant_id, holiday_date)
);
create index idx_holidays_tenant on tenant_holidays(tenant_id);

-- ============================================================
-- B1. shift_templates — แม่แบบกะประจำ property
-- ============================================================
create table shift_templates (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  property_id      uuid not null references properties(id),
  name             text not null,                        -- กะเช้า/บ่าย/ดึก
  start_time       time not null,
  end_time         time not null,
  crosses_midnight boolean not null default false,
  required_guards  integer not null default 1,
  days_of_week     integer[] not null default '{0,1,2,3,4,5,6}',
  is_active        boolean not null default true
);
create index idx_templates_property on shift_templates(property_id);

-- ============================================================
-- B2. shift_assignments — หัวใจของระบบ (ใคร ที่ไหน เมื่อไร)
-- ============================================================
create table shift_assignments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  property_id      uuid not null references properties(id),
  unit_id          uuid references units(id),
  user_id          uuid not null references users(id),
  template_id      uuid references shift_templates(id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'scheduled'
                   check (status in ('scheduled','checked_in','checked_out','absent','cancelled')),
  is_ot            boolean not null default false,
  is_holiday_work  boolean not null default false,       -- คำนวณตอน generate จาก tenant_holidays + weekly_day_off
  is_replacement   boolean not null default false,
  replaced_user_id uuid references users(id),
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  -- กันกะซ้อนต่อ user (ยกเว้นกะที่ถูกยกเลิก)
  constraint no_overlapping_shifts exclude using gist (
    user_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelled')
);
create index idx_assign_tenant on shift_assignments(tenant_id);
create index idx_assign_property_time on shift_assignments(property_id, starts_at);
create index idx_assign_user_range on shift_assignments using gist (user_id, tstzrange(starts_at, ends_at));

-- ============================================================
-- F1. devices — anti-cheating (จากรีวิว 1.3: รองรับเครื่องกลางประจำป้อม)
-- ============================================================
create table devices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  user_id            uuid references users(id),            -- null ได้สำหรับ shared_kiosk
  device_fingerprint text not null,
  device_type        text not null default 'personal' check (device_type in ('personal','shared_kiosk')),
  kiosk_property_id  uuid references properties(id),       -- kiosk ประจำ property ไหน
  user_agent         text,
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  is_blocked         boolean not null default false,
  unique (tenant_id, device_fingerprint)
);
create index idx_devices_tenant on devices(tenant_id);

-- ============================================================
-- F3. audit_logs — ทุกการแก้กะ/ผูก-ปลดบัญชี/อนุมัติ ต้องมีร่องรอย
-- ============================================================
create table audit_logs (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references tenants(id),
  actor_user_id uuid references users(id),
  action        text not null,
  target_table  text,
  target_id     text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index idx_audit_tenant_time on audit_logs(tenant_id, created_at);
