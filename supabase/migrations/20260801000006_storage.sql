-- Guard OS — Sprint 1
-- Migration 6: Storage bucket สำหรับ selfie (F3)
-- path: selfies/{tenant_id}/{yyyy-mm-dd}/{filename}

insert into storage.buckets (id, name, public)
values ('selfies', 'selfies', false)
on conflict (id) do nothing;

-- อัปโหลดได้เฉพาะโฟลเดอร์ tenant ตัวเอง
create policy selfies_upload on storage.objects for insert
  with check (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
  );

-- อ่านได้: เจ้าของไฟล์ตาม path tenant ตน (staff ดูผ่าน signed URL ที่ server สร้าง)
create policy selfies_read on storage.objects for select
  using (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth_tenant_id()::text
  );

-- หมายเหตุ PDPA (รีวิว 1.4): ตั้ง retention purge selfie เก่ากว่า 90 วันด้วย pg_cron ใน Sprint 2
