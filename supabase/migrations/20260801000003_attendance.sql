-- Guard OS — Sprint 1
-- Migration 3: attendance (Events กลุ่ม D — เขียนผ่าน RPC เท่านั้น ไม่มี insert policy ให้ client)

create table attendance (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  property_id         uuid not null references properties(id),
  user_id             uuid not null references users(id),
  assignment_id       uuid not null unique references shift_assignments(id),  -- 1 กะ = 1 แถว
  check_in_at         timestamptz,          -- เวลา server เท่านั้น
  check_out_at        timestamptz,
  in_location         geography(point, 4326),
  out_location        geography(point, 4326),
  in_selfie_url       text,
  out_selfie_url      text,
  in_distance_m       numeric(8,1),
  out_distance_m      numeric(8,1),
  late_minutes        integer not null default 0,   -- จากรีวิว: คำนวณตอน check-in เทียบกะ
  early_leave_minutes integer not null default 0,   -- จากรีวิว: คำนวณตอน check-out
  device_id           uuid references devices(id),
  is_mock_flag        boolean not null default false,
  flag_reason         text,
  created_at          timestamptz not null default now()
);
create index idx_att_tenant_time on attendance(tenant_id, check_in_at);
create index idx_att_property_time on attendance(property_id, check_in_at);
create index idx_att_user_time on attendance(user_id, check_in_at);
