-- Guard OS — Migration 7: กันแม่แบบกะซ้ำ (feedback คุณเต๋ 1 ส.ค. 2569)

-- ปิดแม่แบบที่ซ้ำกันเป๊ะ (property + ชื่อ + เวลาเดียวกัน) เก็บตัวแรกไว้
with d as (
  select id, row_number() over (
    partition by tenant_id, property_id, name, start_time, end_time
    order by id
  ) as rn
  from shift_templates
  where is_active
)
update shift_templates set is_active = false
where id in (select id from d where rn > 1);

-- ห้ามสร้างซ้ำเป๊ะอีก (เฉพาะตัวที่ active)
create unique index if not exists uq_active_template
  on shift_templates (tenant_id, property_id, name, start_time, end_time)
  where is_active;
