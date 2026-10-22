# Horguard — Staging → Prod

ทุกงานขึ้น **Staging ก่อนเสมอ** ทดสอบผ่านแล้วค่อยขึ้น Prod ด้วยไฟล์ชุดเดียวกัน

| | Staging | Prod |
|---|---|---|
| Supabase | `horguard-staging` | `ybghyacwfdlezanewvgn` (Security Guard Project) |
| หลังบ้าน | `/Security-Guard-Project/staging/admin/` | `/Security-Guard-Project/admin/` |
| แอป LINE | `/Security-Guard-Project/staging/app/` | `/Security-Guard-Project/app/` |
| LIFF | LIFF staging 2 ตัว (LINE Login channel 2010926067 เดิม) | `2010926067-B1ybp5Oq` (admin), `2010926067-2cuN81fZ` (app) |
| LINE OA | Horguard Staging (provider Guard OS) | @299nskem |
| ข้อมูล | เดโมล้วน (`supabase/seed/staging_seed.sql`) | ข้อมูลจริง |

## ขั้นตอนปล่อยงาน
1. **Migration** — ไฟล์ใหม่ใน `supabase/migrations/` (เลขถัดไป) → รันบน Staging → ทดสอบ
2. **Edge function** — deploy บน Staging → ทดสอบ
3. **Frontend** — `npm run build:staging` ทั้ง `admin/` และ `liff/` → อัปโหลดไป `docs/staging/admin|app/`
4. ทดสอบบนมือถือ/หลังบ้าน Staging (มีป้าย STAGING สีส้มด้านบน)
5. อนุมัติ "ขึ้น Prod" → รัน migration เดียวกันบน Prod → deploy function → `npm run build` → อัปโหลดไป `docs/admin|app/`
6. ตรวจซ้ำบน Prod ด้วยโครงการทดสอบใน Test Vendor

## ตั้ง Staging ครั้งแรก
1. สร้างโปรเจกต์ Supabase `horguard-staging` (Free)
2. รัน migration `20260801000001` … ล่าสุด ตามลำดับ แล้วรัน `supabase/seed/staging_seed.sql`
3. Secrets (เจ้าของบัญชีตั้งเอง): `LINE_CHANNEL_ID` (2010926067), `GUARD_JWT_SECRET` (JWT secret ของโปรเจกต์ staging), `LINE_MESSAGING_TOKEN` (OA staging), `GOOGLE_MAPS_API_KEY`
4. Deploy edge functions: `auth-line`, `notify-line`, `place-search`
5. สร้าง LIFF 2 ตัวชี้ไป URL staging แล้วใส่ ID ใน `admin/.env.staging`, `liff/.env.staging`
6. ผูก LINE Super Admin: ลงทะเบียนด้วยรหัส `STG-ADMIN` เบอร์ `0000000000`

ไฟล์ `.env.production` / `.env.staging` มีแค่ค่าสาธารณะ (URL, anon key, LIFF ID) — ห้ามใส่ service role key หรือ secret
