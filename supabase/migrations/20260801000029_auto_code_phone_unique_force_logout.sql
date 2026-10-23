-- Guard OS / Horguard — Migration 29
-- 1) รหัสพนักงานสร้างอัตโนมัติ (PREFIX-NNN ต่อ Tenant · PREFIX-000 = Owner ที่ Super Admin สร้างพร้อม Tenant)
--    · The Sun Guard ใช้ SN ต่อจากเลขสูงสุดเดิม · Tenant ใหม่: ตัวแรกของชื่ออังกฤษ + สุ่มอีก 1 ตัว (ไม่ซ้ำ Tenant อื่น)
-- 2) เบอร์โทรห้ามซ้ำกับผู้ใช้ที่ยัง active ทั้งระบบ (ซ้ำกับคนที่ปิดใช้แล้วได้)
-- 3) ปิดใช้ผู้ใช้ = เตะออกทุกเครื่องทันที (PostgREST db_pre_request เช็คทุก request)
-- รันซ้ำได้

-- ── 1. Tenant: ชื่อภาษาอังกฤษ + prefix รหัสพนักงาน ─────────────────────────
alter table tenants add column if not exists name_en text;
alter table tenants add column if not exists code_prefix text;
create unique index if not exists tenants_code_prefix_uq on tenants (code_prefix) where code_prefix is not null;

update tenants set code_prefix = 'SN', name_en = coalesce(name_en, 'The Sun Guard')
 where code_prefix is null and exists (select 1 from users u where u.tenant_id = tenants.id and u.employee_code like 'SN-%');
update tenants set code_prefix = 'TV', name_en = coalesce(name_en, 'Test Vendor')
 where code_prefix is null and is_test and not exists (select 1 from tenants t where t.code_prefix = 'TV');

-- สุ่ม prefix 2 ตัวอักษร: ตัวแรกของชื่ออังกฤษ + A–Z แบบสุ่มที่ยังไม่มีใครใช้
create or replace function gen_tenant_prefix(p_name_en text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_first text := upper(substring(coalesce(p_name_en, '') from '[A-Za-z]')); v_c text;
begin
  if v_first is null then return null; end if;
  for v_c in select chr(65 + i) from generate_series(0, 25) i order by random() loop
    if not exists (select 1 from tenants where code_prefix = v_first || v_c) then return v_first || v_c; end if;
  end loop;
  return null;
end $$;

-- รหัสถัดไปของ Tenant (ล็อกแถว tenant กันชนกันเมื่อสร้างพร้อมกัน) · 000 สงวนให้ Owner
create or replace function next_employee_code(p_tenant_id uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_pre text; v_n integer;
begin
  select code_prefix into v_pre from tenants where id = p_tenant_id for update;
  if v_pre is null then
    v_pre := gen_tenant_prefix((select coalesce(name_en, name) from tenants where id = p_tenant_id));
    if v_pre is null then v_pre := 'X' || chr(65 + floor(random() * 26)::int); end if;
    update tenants set code_prefix = v_pre where id = p_tenant_id;
  end if;
  select coalesce(max(substring(employee_code from '-([0-9]+)$')::integer), 0) + 1 into v_n
    from users where tenant_id = p_tenant_id and employee_code ~ ('^' || v_pre || '-[0-9]+$');
  return v_pre || '-' || lpad(v_n::text, greatest(3, length(v_n::text)), '0');
end $$;
revoke execute on function gen_tenant_prefix(text), next_employee_code(uuid) from public, anon, authenticated;

-- ── 2. เบอร์โทรไม่ซ้ำ (เฉพาะผู้ใช้ active) ──────────────────────────────────
update users set phone = nullif(regexp_replace(phone, '[\s-]', '', 'g'), '') where phone ~ '[\s-]';
create or replace function norm_phone(p text) returns text
language sql immutable as $$
  select nullif(case when d like '66%' and length(d) = 11 then '0' || substr(d, 3) else d end, '')
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x
$$;
create unique index if not exists users_active_phone_uq on users (norm_phone(phone))
  where is_active and norm_phone(phone) is not null;

create or replace function phone_in_use(p_phone text, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select norm_phone(p_phone) is not null and exists (
    select 1 from users where is_active and norm_phone(phone) = norm_phone(p_phone)
      and (p_except is null or id <> p_except))
$$;
revoke execute on function phone_in_use(text, uuid) from public, anon;
grant execute on function phone_in_use(text, uuid) to authenticated;

-- ── save_user: รหัสอัตโนมัติ + เบอร์ไม่ซ้ำ ─────────────────────────────────
create or replace function save_user(
  p_id uuid, p_tenant_id uuid,
  p_employee_code text, p_full_name text, p_phone text, p_role text,
  p_daily_wage numeric, p_weekly_days_off smallint[],
  p_property_ids uuid[], p_platform_admin boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_old users%rowtype;
  v_code text;
  v_props uuid[] := coalesce(p_property_ids, '{}');
  v_days smallint[] := coalesce((select array_agg(distinct d order by d) from unnest(p_weekly_days_off) d where d between 0 and 6), '{}');
  v_con text;
begin
  if not can_manage_tenant(p_tenant_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_role not in ('owner','admin','zone_manager','supervisor','assistant_supervisor','trainer','spare','shift_leader','guard','client') then
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;
  if p_role = 'owner' and not (auth_user_role() = 'owner' or is_platform_admin()) then
    return jsonb_build_object('ok', false, 'error', 'owner_requires_owner');
  end if;
  if p_platform_admin is not null and not is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'platform_admin_requires_platform_admin');
  end if;
  if p_platform_admin = false and p_id = auth_user_id() then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_own_platform_admin');
  end if;
  if norm_phone(p_phone) is null then
    return jsonb_build_object('ok', false, 'error', 'phone_required');
  end if;
  if phone_in_use(p_phone, p_id) then
    return jsonb_build_object('ok', false, 'error', 'phone_in_use');
  end if;
  if project_limit(p_role) = 0 then v_props := '{}'; end if;
  if cardinality(v_props) > project_limit(p_role) then
    return jsonb_build_object('ok', false, 'error', 'project_limit_exceeded', 'limit', project_limit(p_role));
  end if;
  if exists (select 1 from unnest(v_props) x(pid)
             where not exists (select 1 from properties p where p.id = x.pid and p.tenant_id = p_tenant_id)) then
    return jsonb_build_object('ok', false, 'error', 'property_not_in_vendor');
  end if;

  if v_id is null then
    v_code := next_employee_code(p_tenant_id);   -- ไม่รับรหัสจากหน้าจอ: ระบบออกให้เสมอ
    insert into users (tenant_id, employee_code, full_name, phone, role, daily_wage, weekly_days_off, weekly_day_off)
    values (p_tenant_id, v_code, trim(p_full_name), norm_phone(p_phone),
            p_role, p_daily_wage, v_days, v_days[1])
    returning id into v_id;
  else
    select * into v_old from users where id = v_id;
    if v_old.id is null or v_old.tenant_id <> p_tenant_id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_id = auth_user_id() and v_old.role <> p_role then
      return jsonb_build_object('ok', false, 'error', 'cannot_change_own_role');
    end if;
    if v_old.role = 'owner' and p_role <> 'owner'
       and not exists (select 1 from users where tenant_id = p_tenant_id and role = 'owner' and is_active and id <> v_id) then
      return jsonb_build_object('ok', false, 'error', 'last_owner');
    end if;
    v_code := v_old.employee_code;
    -- แก้รหัสได้เฉพาะ Super Admin (กรณีแก้ข้อมูลเก่า)
    if is_platform_admin() and nullif(trim(p_employee_code), '') is not null then v_code := upper(trim(p_employee_code)); end if;
    update users set
      employee_code  = v_code,
      full_name      = coalesce(nullif(trim(p_full_name), ''), full_name),
      phone          = norm_phone(p_phone),
      role           = p_role,
      daily_wage     = p_daily_wage,
      weekly_days_off = v_days,
      weekly_day_off  = v_days[1]
    where id = v_id;
  end if;

  delete from property_managers where user_id = v_id;
  insert into property_managers (user_id, property_id, tenant_id)
  select v_id, x.pid, p_tenant_id from unnest(v_props) x(pid) on conflict do nothing;

  if p_platform_admin is not null then
    if p_platform_admin then
      insert into platform_admins (user_id) values (v_id) on conflict do nothing;
    else
      delete from platform_admins where user_id = v_id;
    end if;
  end if;

  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (p_tenant_id, auth_user_id(), case when p_id is null then 'create_user' else 'update_user' end,
          'users', v_id::text, jsonb_build_object('employee_code', v_code, 'role', p_role, 'properties', v_props, 'platform_admin', p_platform_admin));
  return jsonb_build_object('ok', true, 'id', v_id, 'employee_code', v_code);
exception when unique_violation then
  get stacked diagnostics v_con = constraint_name;
  return jsonb_build_object('ok', false, 'error',
    case when v_con = 'users_active_phone_uq' then 'phone_in_use' else 'duplicate_employee_code' end);
end $$;

-- ── create_vendor: ชื่อไทย/อังกฤษ · prefix อัตโนมัติ · Owner = PREFIX-000 ────
drop function if exists create_vendor(text, text, text, text, text);
create or replace function create_vendor(
  p_name_th text, p_name_en text, p_plan text,
  p_owner_name text, p_owner_phone text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_uid uuid; v_pre text; v_code text;
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if nullif(trim(p_name_th), '') is null then return jsonb_build_object('ok', false, 'error', 'name_th_required'); end if;
  if substring(coalesce(p_name_en, '') from '[A-Za-z]') is null then return jsonb_build_object('ok', false, 'error', 'name_en_required'); end if;
  if nullif(trim(p_owner_name), '') is null then return jsonb_build_object('ok', false, 'error', 'owner_name_required'); end if;
  if norm_phone(p_owner_phone) is null then return jsonb_build_object('ok', false, 'error', 'phone_required'); end if;
  if phone_in_use(p_owner_phone) then return jsonb_build_object('ok', false, 'error', 'phone_in_use'); end if;

  v_pre := gen_tenant_prefix(p_name_en);
  if v_pre is null then return jsonb_build_object('ok', false, 'error', 'prefix_exhausted'); end if;
  v_code := v_pre || '-000';

  insert into tenants (name, name_en, code_prefix, plan)
  values (trim(p_name_th), trim(p_name_en), v_pre, coalesce(nullif(p_plan, ''), 'basic')) returning id into v_tid;
  insert into users (tenant_id, employee_code, full_name, phone, role)
  values (v_tid, v_code, trim(p_owner_name), norm_phone(p_owner_phone), 'owner') returning id into v_uid;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (v_tid, auth_user_id(), 'create_vendor', 'tenants', v_tid::text,
          jsonb_build_object('company', trim(p_name_th), 'name_en', trim(p_name_en), 'prefix', v_pre, 'owner_code', v_code));
  return jsonb_build_object('ok', true, 'tenant_id', v_tid, 'owner_id', v_uid, 'prefix', v_pre, 'owner_code', v_code);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'phone_in_use');
end $$;
revoke execute on function create_vendor(text, text, text, text, text) from public, anon;
grant execute on function create_vendor(text, text, text, text, text) to authenticated;

-- update_vendor: แก้ชื่อภาษาอังกฤษได้ (prefix ไม่เปลี่ยน — รหัสเดิมยังใช้ได้)
drop function if exists update_vendor(uuid, text, text, boolean);
create or replace function update_vendor(p_tenant_id uuid, p_name text, p_plan text, p_is_active boolean, p_name_en text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update tenants set
    name = coalesce(nullif(trim(p_name),''), name),
    name_en = coalesce(nullif(trim(p_name_en),''), name_en),
    plan = coalesce(nullif(p_plan,''), plan),
    is_active = coalesce(p_is_active, is_active)
  where id = p_tenant_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (p_tenant_id, auth_user_id(), 'update_vendor', 'tenants', p_tenant_id::text,
          jsonb_build_object('name', p_name, 'name_en', p_name_en, 'plan', p_plan, 'is_active', p_is_active));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function update_vendor(uuid, text, text, boolean, text) from public, anon;
grant execute on function update_vendor(uuid, text, text, boolean, text) to authenticated;

drop function if exists list_vendors();
create function list_vendors() returns table (
  id uuid, name text, plan text, is_active boolean, created_at timestamptz,
  properties_count bigint, users_count bigint, line_linked_count bigint, is_test boolean,
  name_en text, code_prefix text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then return; end if;
  return query
  select t.id, t.name, t.plan, t.is_active, t.created_at,
    (select count(*) from properties p where p.tenant_id = t.id and p.is_active),
    (select count(*) from users u where u.tenant_id = t.id and u.is_active),
    (select count(*) from users u where u.tenant_id = t.id and u.line_user_id is not null),
    t.is_test, t.name_en, t.code_prefix
  from tenants t order by t.is_test, t.created_at;
end $$;
revoke execute on function list_vendors() from anon, public;
grant execute on function list_vendors() to authenticated;

-- ── 3. Force logout ────────────────────────────────────────────────────────
alter table users add column if not exists tokens_valid_after timestamptz;

create or replace function set_user_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_u users%rowtype;
begin
  select * into v_u from users where id = p_id;
  if v_u.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not can_manage_tenant(v_u.tenant_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_id = auth_user_id() then return jsonb_build_object('ok', false, 'error', 'cannot_disable_self'); end if;
  if p_active and not v_u.is_active and phone_in_use(v_u.phone, p_id) then
    return jsonb_build_object('ok', false, 'error', 'phone_in_use');
  end if;
  if not p_active and v_u.role = 'owner'
     and not exists (select 1 from users where tenant_id = v_u.tenant_id and role = 'owner' and is_active and id <> p_id) then
    return jsonb_build_object('ok', false, 'error', 'last_owner');
  end if;
  update users set is_active = p_active,
    tokens_valid_after = case when p_active then tokens_valid_after else now() end
  where id = p_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (v_u.tenant_id, auth_user_id(), 'set_user_active', 'users', p_id::text,
          jsonb_build_object('is_active', p_active, 'employee_code', v_u.employee_code));
  return jsonb_build_object('ok', true);
end $$;

-- เรียกก่อนทุก request ของ PostgREST: ผู้ใช้ถูกปิด หรือ token ออกก่อนถูกปิด → 401 account_disabled
create or replace function check_request() returns void
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid; v_ok boolean;
begin
  begin
    v_uid := auth_user_id();
  exception when others then return;
  end;
  if v_uid is null then return; end if;
  select u.is_active and (u.tokens_valid_after is null
           or coalesce((auth.jwt() ->> 'iat')::bigint, 0) > floor(extract(epoch from u.tokens_valid_after))::bigint)
    into v_ok from users u where u.id = v_uid;
  if v_ok is not true then
    raise sqlstate 'PGRST' using
      message = '{"code":"account_disabled","message":"account_disabled","details":null,"hint":null}',
      detail = '{"status":401,"headers":{}}';
  end if;
end $$;
grant execute on function check_request() to anon, authenticated;

-- ── 4. คำว่า "ยาม" → "รปภ." ในข้อความที่ฟังก์ชันส่งกลับให้ผู้ใช้ (เช่น ผลตรวจนำเข้า Excel) ──
do $$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%ยาม%' loop
    d := pg_get_functiondef(r.oid);
    execute replace(d, 'ยาม', 'รปภ.');
  end loop;
end $$;

alter role authenticator set pgrst.db_pre_request = 'public.check_request';
notify pgrst, 'reload config';
