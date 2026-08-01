-- Guard OS — Sprint 1
-- Migration 4: RLS ทุกตาราง ไม่มีข้อยกเว้น
-- JWT ที่ mint จาก Edge Function auth-line มี app_metadata: { tenant_id, user_id, user_role }

-- ============================================================
-- Helper functions อ่าน claims จาก JWT (stable → planner cache ได้)
-- ============================================================
create or replace function auth_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

create or replace function auth_user_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'user_id', '')::uuid
$$;

create or replace function auth_user_role() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'user_role'
$$;

create or replace function is_tenant_staff() returns boolean
language sql stable as $$
  select auth_user_role() in ('owner','admin','supervisor','shift_leader')
$$;

create or replace function is_tenant_admin() returns boolean
language sql stable as $$
  select auth_user_role() in ('owner','admin')
$$;

-- ============================================================
-- เปิด RLS ทุกตาราง
-- ============================================================
alter table tenants            enable row level security;
alter table users              enable row level security;
alter table properties         enable row level security;
alter table units              enable row level security;
alter table property_managers  enable row level security;
alter table tenant_holidays    enable row level security;
alter table shift_templates    enable row level security;
alter table shift_assignments  enable row level security;
alter table devices            enable row level security;
alter table audit_logs         enable row level security;
alter table attendance         enable row level security;

-- ============================================================
-- tenants: เห็นเฉพาะบริษัทตัวเอง · แก้ได้เฉพาะ owner/admin
-- ============================================================
create policy tenants_select on tenants for select
  using (id = auth_tenant_id());
create policy tenants_update on tenants for update
  using (id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- users: เห็นตัวเอง + staff เห็นทั้ง tenant · เขียนเฉพาะ admin
-- (client เห็นเฉพาะตัวเอง — รายชื่อยามไม่ใช่ของลูกค้า)
-- ============================================================
create policy users_select on users for select
  using (tenant_id = auth_tenant_id() and (id = auth_user_id() or is_tenant_staff()));
create policy users_insert on users for insert
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());
create policy users_update on users for update
  using (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- properties: staff เห็นทั้ง tenant · client เห็นเฉพาะ property ตน
-- guard เห็น property ที่ตนมีกะ (ต้องเห็นชื่อ/พิกัดตอน check-in)
-- ============================================================
create policy properties_select on properties for select
  using (
    tenant_id = auth_tenant_id() and (
      is_tenant_staff()
      or client_user_id = auth_user_id()
      or exists (
        select 1 from shift_assignments sa
        where sa.property_id = properties.id
          and sa.user_id = auth_user_id()
          and sa.status <> 'cancelled'
      )
    )
  );
create policy properties_write on properties for all
  using (tenant_id = auth_tenant_id() and is_tenant_admin())
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- units / tenant_holidays / shift_templates: อ่านทั้ง tenant · เขียน admin
-- ============================================================
create policy units_select on units for select
  using (tenant_id = auth_tenant_id());
create policy units_write on units for all
  using (tenant_id = auth_tenant_id() and is_tenant_admin())
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());

create policy holidays_select on tenant_holidays for select
  using (tenant_id = auth_tenant_id());
create policy holidays_write on tenant_holidays for all
  using (tenant_id = auth_tenant_id() and is_tenant_admin())
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());

create policy templates_select on shift_templates for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff());
create policy templates_write on shift_templates for all
  using (tenant_id = auth_tenant_id() and is_tenant_admin())
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- property_managers: staff อ่าน · admin เขียน
-- ============================================================
create policy pm_select on property_managers for select
  using (tenant_id = auth_tenant_id() and is_tenant_staff());
create policy pm_write on property_managers for all
  using (tenant_id = auth_tenant_id() and is_tenant_admin())
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- shift_assignments: ยามเห็นกะตัวเอง · staff เห็นทั้ง tenant
-- เขียนเฉพาะ admin (สลับกะ/หาคนแทนใช้ RPC ใน Sprint 5)
-- ============================================================
create policy assignments_select on shift_assignments for select
  using (
    tenant_id = auth_tenant_id()
    and (user_id = auth_user_id() or is_tenant_staff())
  );
create policy assignments_write on shift_assignments for all
  using (tenant_id = auth_tenant_id() and is_tenant_admin())
  with check (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- devices: เห็นเครื่องตัวเอง · staff เห็นทั้ง tenant · เขียนผ่าน RPC เท่านั้น
-- ============================================================
create policy devices_select on devices for select
  using (tenant_id = auth_tenant_id() and (user_id = auth_user_id() or is_tenant_staff()));

-- ============================================================
-- audit_logs: อ่านเฉพาะ admin · เขียนผ่าน security definer เท่านั้น
-- ============================================================
create policy audit_select on audit_logs for select
  using (tenant_id = auth_tenant_id() and is_tenant_admin());

-- ============================================================
-- attendance: ยามเห็นของตัวเอง · staff เห็นทั้ง tenant
-- *** ไม่มี insert/update policy — เขียนได้ทาง RPC check_in/check_out เท่านั้น (anti-cheating) ***
-- ============================================================
create policy attendance_select on attendance for select
  using (
    tenant_id = auth_tenant_id()
    and (user_id = auth_user_id() or is_tenant_staff())
  );
