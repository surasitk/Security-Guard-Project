-- Guard OS — Migration 10: ชั้นเจ้าของแพลตฟอร์ม (SaaS vendor management)
-- Vendor = tenant (บริษัท รปภ. ที่ใช้ระบบ) · platform admin = คุณเต๋ สร้าง/ดู vendor ได้ทุกราย

create table if not exists platform_admins (
  user_id uuid primary key references users(id),
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- ไม่มี policy — เข้าถึงผ่าน security definer function เท่านั้น

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth_user_id())
$$;

-- สร้าง vendor ใหม่ + owner คนแรกของบริษัทนั้น
create or replace function create_vendor(
  p_company text, p_plan text,
  p_owner_name text, p_owner_code text, p_owner_phone text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tid uuid; v_uid uuid;
begin
  if not is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  insert into tenants (name, plan) values (p_company, coalesce(p_plan, 'basic')) returning id into v_tid;
  insert into users (tenant_id, employee_code, full_name, phone, role)
  values (v_tid, p_owner_code, p_owner_name, p_owner_phone, 'owner') returning id into v_uid;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (v_tid, auth_user_id(), 'create_vendor', 'tenants', v_tid::text,
          jsonb_build_object('company', p_company, 'owner_code', p_owner_code));
  return jsonb_build_object('ok', true, 'tenant_id', v_tid, 'owner_id', v_uid);
end $$;

-- รายชื่อ vendor ทั้งหมด + จำนวนโครงการ/พนักงาน
create or replace function list_vendors() returns table (
  id uuid, name text, plan text, is_active boolean, created_at timestamptz,
  properties_count bigint, users_count bigint, line_linked_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then return; end if;
  return query
  select t.id, t.name, t.plan, t.is_active, t.created_at,
    (select count(*) from properties p where p.tenant_id = t.id and p.is_active),
    (select count(*) from users u where u.tenant_id = t.id and u.is_active),
    (select count(*) from users u where u.tenant_id = t.id and u.line_user_id is not null)
  from tenants t order by t.created_at;
end $$;

-- สร้างโครงการให้ vendor รายใดก็ได้ (เฉพาะ platform admin)
create or replace function create_property_for_vendor(
  p_tenant_id uuid, p_name text, p_code text, p_province text,
  p_lat double precision, p_lng double precision,
  p_radius integer, p_rate numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  insert into properties (tenant_id, name, code, province, center, geofence_radius_m, billing_rate_per_guard_day)
  values (
    p_tenant_id, p_name, p_code, nullif(p_province, ''),
    case when p_lat is not null then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
    coalesce(p_radius, 150), p_rate
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'property_id', v_id);
end $$;

revoke execute on function is_platform_admin(), create_vendor(text,text,text,text,text), list_vendors(), create_property_for_vendor(uuid,text,text,text,double precision,double precision,integer,numeric) from anon, public;
grant execute on function is_platform_admin(), create_vendor(text,text,text,text,text), list_vendors(), create_property_for_vendor(uuid,text,text,text,double precision,double precision,integer,numeric) to authenticated;

-- ตั้งคุณเต๋ (ADM-001 ของ The Sun Guard) เป็น platform admin คนแรก
insert into platform_admins (user_id)
select u.id from users u join tenants t on t.id = u.tenant_id
where t.name = 'The Sun Guard' and u.employee_code = 'ADM-001'
on conflict do nothing;
