-- Guard OS — Migration 12: RPC สำหรับ CRUD ที่เสถียร (เขียน geography ฝั่ง server)
-- แก้บั๊ก "เซฟโครงการไม่ได้" — PostgREST เขียน geography ผ่าน PATCH ไม่เสถียร → ใช้ RPC แทน

-- helper: user มีสิทธิ์จัดการ tenant นี้ไหม (admin ของ tenant ตัวเอง หรือ platform admin)
create or replace function can_manage_tenant(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_tenant_id = auth_tenant_id() and is_tenant_admin()) or is_platform_admin()
$$;

-- ============================================================
-- save_property — insert (p_id null) หรือ update (p_id มีค่า)
-- ============================================================
create or replace function save_property(
  p_id uuid, p_tenant_id uuid,
  p_name text, p_code text,
  p_province text, p_district text, p_subdistrict text, p_postcode text, p_address text,
  p_lat double precision, p_lng double precision,
  p_radius integer, p_rate numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_center geography;
  v_id uuid;
begin
  if p_id is not null then
    select tenant_id into v_tenant from properties where id = p_id;
    if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  else
    v_tenant := coalesce(p_tenant_id, auth_tenant_id());
  end if;

  if not can_manage_tenant(v_tenant) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_center := case when p_lat is not null and p_lng is not null
                   then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end;

  if p_id is null then
    insert into properties (tenant_id, name, code, province, district, subdistrict, postcode, address,
                            center, geofence_radius_m, billing_rate_per_guard_day)
    values (v_tenant, p_name, p_code, nullif(p_province,''), nullif(p_district,''), nullif(p_subdistrict,''),
            nullif(p_postcode,''), nullif(p_address,''), v_center, coalesce(p_radius,150), p_rate)
    returning id into v_id;
  else
    update properties set
      name = p_name, code = p_code,
      province = nullif(p_province,''), district = nullif(p_district,''),
      subdistrict = nullif(p_subdistrict,''), postcode = nullif(p_postcode,''), address = nullif(p_address,''),
      center = coalesce(v_center, center),   -- ไม่ล้างพิกัดเดิมถ้าไม่ได้ส่งมา
      geofence_radius_m = coalesce(p_radius,150), billing_rate_per_guard_day = p_rate
    where id = p_id returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'property_id', v_id);
end $$;

-- เปิด/ปิดใช้งานโครงการ
create or replace function set_property_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from properties where id = p_id;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not can_manage_tenant(v_tenant) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update properties set is_active = p_active where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- update_vendor — แก้ชื่อ/แพ็คเกจ/สถานะ (platform admin เท่านั้น)
-- ============================================================
create or replace function update_vendor(p_tenant_id uuid, p_name text, p_plan text, p_is_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update tenants set
    name = coalesce(nullif(p_name,''), name),
    plan = coalesce(nullif(p_plan,''), plan),
    is_active = coalesce(p_is_active, is_active)
  where id = p_tenant_id;
  insert into audit_logs (tenant_id, actor_user_id, action, target_table, target_id, after)
  values (p_tenant_id, auth_user_id(), 'update_vendor', 'tenants', p_tenant_id::text,
          jsonb_build_object('name', p_name, 'plan', p_plan, 'is_active', p_is_active));
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- set_user_active — เปิด/ปิดพนักงาน (แทนการลบ)
-- ============================================================
create or replace function set_user_active(p_id uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_role text;
begin
  select tenant_id, role into v_tenant, v_role from users where id = p_id;
  if v_tenant is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not can_manage_tenant(v_tenant) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_id = auth_user_id() then return jsonb_build_object('ok', false, 'error', 'cannot_disable_self'); end if;
  update users set is_active = p_active where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  can_manage_tenant(uuid),
  save_property(uuid,uuid,text,text,text,text,text,text,text,double precision,double precision,integer,numeric),
  set_property_active(uuid,boolean),
  update_vendor(uuid,text,text,boolean),
  set_user_active(uuid,boolean)
to authenticated;
