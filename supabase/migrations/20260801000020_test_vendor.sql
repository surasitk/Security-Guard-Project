-- Guard OS — Migration 20: Test Vendor (เห็นเฉพาะ Super Admin) + ย้ายโครงการทดสอบและบัญชี Super Admin เข้าไป
-- รันหลัง migration 19 · รันซ้ำได้
-- · Vendor อื่นไม่มีทางเห็นรายชื่อ Vendor (list_vendors ใช้ได้เฉพาะ Super Admin)
-- · บัญชี Super Admin ย้ายมาอยู่ Test Vendor ด้วย — แอป LINE ทำงานในบริษัทของผู้ใช้ จึงต้องอยู่บริษัทเดียวกับโครงการทดสอบ
--   หลังบ้านยังสลับไปจัดการ Vendor จริงได้ตามเดิม และ Vendor จริงจะไม่มีชื่อ Super Admin ในรายชื่อผู้ใช้อีก

alter table tenants add column if not exists is_test boolean not null default false;

do $$
declare v_test uuid;
begin
  select id into v_test from tenants where is_test order by created_at limit 1;
  if v_test is null then
    insert into tenants (name, plan, is_test) values ('Test Vendor', 'pro', true) returning id into v_test;
  end if;

  -- โครงการทดสอบ + ข้อมูลที่ผูกอยู่
  update shift_templates    set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update shift_assignments  set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update attendance         set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update checkpoints        set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update patrol_scans       set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update line_notifications set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update units              set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update property_managers  set tenant_id = v_test where property_id in (select id from properties where is_test) and tenant_id <> v_test;
  update properties         set tenant_id = v_test where is_test and tenant_id <> v_test;

  -- บัญชี Super Admin
  delete from property_managers where user_id in (select user_id from platform_admins) and tenant_id <> v_test;
  update devices set tenant_id = v_test where user_id in (select user_id from platform_admins) and tenant_id <> v_test;
  update users   set tenant_id = v_test where id in (select user_id from platform_admins) and tenant_id <> v_test;
end $$;

drop function if exists list_vendors();
create function list_vendors() returns table (
  id uuid, name text, plan text, is_active boolean, created_at timestamptz,
  properties_count bigint, users_count bigint, line_linked_count bigint, is_test boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then return; end if;
  return query
  select t.id, t.name, t.plan, t.is_active, t.created_at,
    (select count(*) from properties p where p.tenant_id = t.id and p.is_active),
    (select count(*) from users u where u.tenant_id = t.id and u.is_active),
    (select count(*) from users u where u.tenant_id = t.id and u.line_user_id is not null),
    t.is_test
  from tenants t order by t.is_test, t.created_at;
end $$;
revoke execute on function list_vendors() from anon, public;
grant execute on function list_vendors() to authenticated;
