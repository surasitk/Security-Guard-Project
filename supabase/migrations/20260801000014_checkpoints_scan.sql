-- Guard OS — Migration 14: จุดตรวจ (checkpoints) + สแกน (patrol_scans) — Sprint 2 core (แบบย่อ)
-- QR แต่ละจุดเก็บ random code · ยามสแกน → RPC ตรวจว่ามีกะ active ที่ property นั้น → บันทึกเวลา server

create table if not exists checkpoints (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  property_id uuid not null references properties(id),
  name        text not null,
  code        text not null unique,            -- random token ใน QR (กันเดา)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_checkpoints_property on checkpoints(property_id);
create index if not exists idx_checkpoints_code on checkpoints(code);

create table if not exists patrol_scans (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  property_id   uuid not null references properties(id),
  user_id       uuid not null references users(id),
  assignment_id uuid references shift_assignments(id),
  checkpoint_id uuid not null references checkpoints(id),
  scanned_at    timestamptz not null default now(),   -- เวลา server เท่านั้น
  location      geography(point, 4326),
  distance_m    numeric(8,1),
  selfie_url    text,
  device_id     uuid references devices(id),
  flag_reason   text
);
create index if not exists idx_scans_tenant_time on patrol_scans(tenant_id, scanned_at);
create index if not exists idx_scans_property_time on patrol_scans(property_id, scanned_at);
create index if not exists idx_scans_checkpoint on patrol_scans(checkpoint_id, scanned_at);

alter table checkpoints  enable row level security;
alter table patrol_scans enable row level security;

-- checkpoints: staff อ่านทั้ง tenant · เขียนผ่าน RPC เท่านั้น
create policy checkpoints_select on checkpoints for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff());
-- patrol_scans: ยามเห็นของตัวเอง · staff เห็นทั้ง tenant · เขียนผ่าน RPC เท่านั้น
create policy scans_select on patrol_scans for select
  using (tenant_id = auth_tenant_id() and (user_id = auth_user_id() or is_tenant_staff()));

-- ============================================================
-- create_checkpoint — admin สร้างจุดตรวจ + สุ่ม code (ใช้ทำ QR)
-- ============================================================
create or replace function create_checkpoint(p_property_id uuid, p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_code text; v_id uuid;
begin
  select tenant_id into v_tenant from properties where id = p_property_id;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'property_not_found'); end if;
  if not can_manage_tenant(v_tenant) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_code := 'CP' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
  insert into checkpoints (tenant_id, property_id, name, code)
  values (v_tenant, p_property_id, p_name, v_code) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end $$;

create or replace function set_checkpoint_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from checkpoints where id = p_id;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not can_manage_tenant(v_tenant) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update checkpoints set is_active = p_active where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- scan_checkpoint — ยามสแกน QR (code) → ตรวจกะ active → บันทึก
-- ============================================================
create or replace function scan_checkpoint(
  p_code text, p_lat double precision default null, p_lng double precision default null,
  p_selfie_url text default null, p_device_fingerprint text default null, p_user_agent text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cp     checkpoints%rowtype;
  v_assign shift_assignments%rowtype;
  v_point  geography := case when p_lat is not null and p_lng is not null
                             then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;
  v_dist   numeric; v_dev_id uuid; v_flag text := null;
begin
  select * into v_cp from checkpoints where code = p_code and is_active and tenant_id = auth_tenant_id();
  if not found then return jsonb_build_object('ok', false, 'error', 'checkpoint_not_found'); end if;

  -- หากะ active ของ user ที่ property เดียวกับจุดตรวจ (±60 นาที)
  select * into v_assign from shift_assignments
  where user_id = auth_user_id() and tenant_id = auth_tenant_id()
    and property_id = v_cp.property_id and status = 'checked_in'
    and now() between starts_at - interval '60 minutes' and ends_at + interval '60 minutes'
  order by starts_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_active_shift_here'); end if;

  if v_point is not null then v_dist := check_geofence(v_cp.property_id, v_point); else v_flag := 'no_gps'; end if;
  if p_device_fingerprint is not null then v_dev_id := upsert_device(p_device_fingerprint, p_user_agent); end if;

  insert into patrol_scans (tenant_id, property_id, user_id, assignment_id, checkpoint_id,
                            scanned_at, location, distance_m, selfie_url, device_id, flag_reason)
  values (v_cp.tenant_id, v_cp.property_id, auth_user_id(), v_assign.id, v_cp.id,
          now(), v_point, v_dist, p_selfie_url, v_dev_id, v_flag);

  return jsonb_build_object('ok', true, 'checkpoint', v_cp.name, 'scanned_at', now());
end $$;

-- view สำหรับ admin: จุดตรวจ + จำนวนสแกนวันนี้
create or replace view v_checkpoints with (security_invoker = on) as
select c.*, p.name as property_name,
  (select count(*) from patrol_scans s where s.checkpoint_id = c.id and s.scanned_at > now() - interval '24 hours') as scans_24h
from checkpoints c join properties p on p.id = c.property_id;

grant execute on function
  create_checkpoint(uuid,text), set_checkpoint_active(uuid,boolean),
  scan_checkpoint(text,double precision,double precision,text,text,text)
to authenticated;
