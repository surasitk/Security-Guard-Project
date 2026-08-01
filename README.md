# Guard OS

ระบบบริหารงานบริษัทรักษาความปลอดภัย (SaaS) — ลูกค้ารายแรก: The Sun Guard ภูเก็ต

**สถาปัตยกรรม:** LINE OA เดียว (@299nskem) + LIFF เดียว + Supabase เดียว
แยกบริษัทด้วย `tenant_id` แยกโครงการด้วย `property_id` ใน logic ไม่แยก infrastructure

## หลักการออกแบบ (สรุป)

- LIFF จำแค่ตัวตน (LINE userId) — การผูก user ↔ property resolve ฝั่ง server ผ่านกะเสมอ
- user ผูกกับ "กะ" ไม่ผูกกับ property ตรงๆ — รองรับตัววิ่งหลายไซต์/วัน
- timestamp ฝั่ง server เท่านั้น ไม่รับเวลาจาก client
- ตารางเหตุการณ์ (attendance, patrol_scans, incidents) เขียนผ่าน RPC เท่านั้น — anti-cheating
- เปิด RLS ทุกตาราง ไม่มีข้อยกเว้น

## โครงสร้าง repo

```
supabase/
  migrations/          # DDL + RLS + RPC (รันตามลำดับเลขไฟล์)
  functions/auth-line/ # Edge Function: ผูกบัญชี LINE + mint JWT (F1/F2)
liff/                  # LIFF app (Vite + React) — ลงทะเบียน + เข้า/ออกงาน (F3)
admin/                 # Web admin หลังบ้าน (Vite + React, LINE Login)
docs/                  # build แล้วสำหรับ GitHub Pages (app/ + admin/)
assets/richmenu/       # Rich Menu artwork (export จาก Figma)
SETUP.md               # คู่มือ deploy ทีละขั้น
```

## สถานะ (Sprint 1 — ส.ค. 2569)

- [x] Schema กลุ่ม A (tenants, users, properties, units, property_managers) + tenant_holidays
- [x] shift_templates + shift_assignments (EXCLUDE constraint กันกะซ้อน)
- [x] attendance + RPC check_in / check_out / my_current_assignments / generate_assignments
- [x] RLS ทุกตาราง + Storage bucket selfies
- [x] Edge Function auth-line (F1 ลงทะเบียน + F2 login + PDPA consent)
- [x] LIFF: Register + Home (check-in/out พร้อม GPS + selfie)
- [x] Rich Menu artwork (guard) — Monotone Minimal ใน Figma
- [x] Web admin (docs/admin — ภาพรวมวันนี้ / ตารางกะ / พนักงาน / โครงการ)
- [x] Deploy: Supabase (DB+RLS+RPC+Edge Function) ✓ · LINE Login channel 2010926067 ✓
- [ ] Sprint 2: patrol (กลุ่ม C) + missed detection

## ธีม

**Monotone Minimal** — ขาว/ดำ/เทาเท่านั้น ใช้ร่วมกันทั้ง Rich Menu, LIFF และ Web admin
โทเคนสีอยู่ใน `liff/src/theme.css` (--ink #111111, --paper #FAFAF8, --line #E4E2DE)
ฟอนต์: IBM Plex Sans Thai + Inter

เอกสารอ้างอิงหลัก: Google Doc "Guard OS — Database Schema + System Flows"

## URLs (production)

- LIFF ยาม: https://liff.line.me/2010926067-2cuN81fZ → https://surasitk.github.io/Security-Guard-Project/app/
- Admin: https://liff.line.me/2010926067-B1ybp5Oq หรือเปิดตรง https://surasitk.github.io/Security-Guard-Project/admin/
- LINE Login channel: 2010926067 (provider: Guard OS)
