-- Guard OS — Migration 11: ที่อยู่ละเอียด (อำเภอ/ตำบล/รหัสไปรษณีย์) + view โครงการพร้อม lat/lng

alter table properties add column if not exists district text;      -- อำเภอ/เขต
alter table properties add column if not exists subdistrict text;   -- ตำบล/แขวง
alter table properties add column if not exists postcode text;

-- view สำหรับหน้า admin: อ่าน lat/lng ได้ตรงๆ (center เป็น geography อ่านผ่าน PostgREST ไม่สะดวก)
create or replace view v_properties with (security_invoker = on) as
select
  p.id, p.tenant_id, p.name, p.code, p.province, p.district, p.subdistrict, p.postcode,
  p.address, p.geofence_radius_m, p.billing_rate_per_guard_day,
  p.contract_start, p.contract_end, p.client_user_id, p.is_active, p.created_at,
  st_y(p.center::geometry) as lat,
  st_x(p.center::geometry) as lng
from properties p;

-- ขยาย RPC สร้างโครงการให้ vendor ให้รับที่อยู่ครบ (ต้อง drop ก่อนเพราะ signature เปลี่ยน)
drop function if exists create_property_for_vendor(uuid,text,text,text,double precision,double precision,integer,numeric);
create or replace function create_property_for_vendor(
  p_tenant_id uuid, p_name text, p_code text,
  p_province text, p_district text, p_subdistrict text, p_postcode text, p_address text,
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
  insert into properties (tenant_id, name, code, province, district, subdistrict, postcode, address,
                          center, geofence_radius_m, billing_rate_per_guard_day)
  values (
    p_tenant_id, p_name, p_code,
    nullif(p_province,''), nullif(p_district,''), nullif(p_subdistrict,''), nullif(p_postcode,''), nullif(p_address,''),
    case when p_lat is not null then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
    coalesce(p_radius, 150), p_rate
  ) returning id into v_id;
  return jsonb_build_object('ok', true, 'property_id', v_id);
end $$;
revoke execute on function create_property_for_vendor(uuid,text,text,text,text,text,text,text,double precision,double precision,integer,numeric) from anon, public;
grant execute on function create_property_for_vendor(uuid,text,text,text,text,text,text,text,double precision,double precision,integer,numeric) to authenticated;
