-- Guard OS — Migration 8: เพิ่มจังหวัดให้โครงการ (สำหรับ filter dashboard)
alter table properties add column if not exists province text;
create index if not exists idx_properties_province on properties(tenant_id, province);
