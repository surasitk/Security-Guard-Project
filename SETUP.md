# Guard OS — คู่มือ Deploy (Sprint 1)

Supabase project: `https://ybghyacwfdlezanewvgn.supabase.co` · LINE OA: `@299nskem`

## 1) Database (Supabase)

วิธีที่ง่ายที่สุด: เปิด **Supabase Dashboard → SQL Editor** แล้วรันไฟล์ใน `supabase/migrations/` **ตามลำดับ**:

1. `20260801000001_extensions.sql` — postgis, btree_gist, pgcrypto
2. `20260801000002_core_tables.sql` — ตารางหลัก 10 ตาราง
3. `20260801000003_attendance.sql`
4. `20260801000004_rls.sql` — RLS ทุกตาราง
5. `20260801000005_rpc.sql` — check_in / check_out / my_current_assignments / generate_assignments
6. `20260801000006_storage.sql` — bucket selfies + policies

(หรือใช้ Supabase CLI: `supabase link --project-ref ybghyacwfdlezanewvgn` แล้ว `supabase db push`)

## 2) LINE Developers Console

1. สร้าง **LINE Login channel** (คนละอันกับ Messaging API ของ OA) ใน provider เดียวกับ @299nskem
2. ใน Login channel → สร้าง **LIFF app**:
   - Size: `Full`
   - Endpoint URL: URL ที่ deploy LIFF (ข้อ 4)
   - Scope: `profile`, `openid`
   - จด **LIFF ID** และ **Channel ID** ไว้
3. Messaging API channel (@299nskem): เปิด webhook ไว้ก่อน (ใช้จริง Sprint 2 สำหรับ reply token)

## 3) Edge Function

```bash
supabase functions deploy auth-line --project-ref ybghyacwfdlezanewvgn
supabase secrets set LINE_CHANNEL_ID=<Channel ID ของ LINE Login channel>
supabase secrets set GUARD_JWT_SECRET=<JWT Secret จาก Dashboard > Settings > API>
```

หมายเหตุ: โปรเจกต์ต้องใช้ Legacy JWT Secret (HS256) สำหรับ mint token — ถ้าเปิด JWT Signing Keys แบบใหม่ (asymmetric) ให้คง legacy secret ไว้ด้วย

## 4) LIFF App

```bash
cd liff
cp .env.example .env    # เติม VITE_LIFF_ID + VITE_SUPABASE_ANON_KEY
npm install
npm run build           # ได้ dist/
```

Deploy `dist/` ขึ้น Vercel / Cloudflare Pages / Netlify (ฟรีทั้งหมด) แล้วเอา URL ไปใส่เป็น LIFF Endpoint URL

## 5) Rich Menu

1. เปิดไฟล์ Figma → เฟรม `RichMenu / Guard / 2500x1686` → Export เป็น **PNG @1x** (ขนาด 2500×1686 ต้อง < 1MB)
2. อัปโหลดผ่าน [LINE Official Account Manager](https://manager.line.biz/) → Rich menus → สร้างใหม่:
   - Template: **Large (6 ช่อง 3×2)**
   - ผูกแต่ละช่องเป็นลิงก์เปิด LIFF: `https://liff.line.me/<LIFF_ID>?page=<checkin|checkout|scan|incident|shifts|leave>`
   - (Sprint 1 ใช้งานจริงได้ 3 ช่อง: เข้างาน/ออกงาน/กะของฉัน — ช่องอื่นตั้ง action เป็นข้อความ "เร็วๆ นี้" ไปก่อน)
3. Per-role rich menu (ตั้งเมนูต่างกันต่อ user) ทำผ่าน Messaging API ใน Sprint 2

## 6) ข้อมูลตั้งต้น (รันใน SQL Editor)

```sql
-- บริษัทแรก
insert into tenants (name, plan) values ('The Sun Guard', 'pro') returning id;

-- admin คนแรก (แทน <TENANT_ID> ด้วยค่าที่ได้)
insert into users (tenant_id, employee_code, full_name, phone, role)
values ('<TENANT_ID>', 'ADM-001', 'ชื่อแอดมิน', '08xxxxxxxx', 'owner');

-- โครงการแรก + พิกัด (lng, lat)
insert into properties (tenant_id, name, code, center, geofence_radius_m)
values ('<TENANT_ID>', 'ชื่อโครงการ', 'P001',
        st_setsrid(st_makepoint(98.3381, 7.8804), 4326)::geography, 150);

-- วันหยุดตามประเพณีปี 2569 (ตัวอย่าง)
insert into tenant_holidays (tenant_id, holiday_date, name) values
('<TENANT_ID>', '2026-08-12', 'วันแม่แห่งชาติ'),
('<TENANT_ID>', '2026-12-05', 'วันพ่อแห่งชาติ');
```

## 7) ทดสอบ flow จริง

1. Admin สร้างยาม 1 คน (role guard, ใส่ employee_code + phone)
2. สร้าง shift_template แล้วเรียก `select generate_assignments('<TEMPLATE_ID>','<USER_ID>','2026-08-01','2026-08-31');`
3. ยาม add เพื่อน @299nskem → เปิด LIFF → ลงทะเบียน (รหัสพนักงาน + เบอร์) → ติ๊ก consent
4. ถึงเวลากะ → กดเข้างาน → ถ่าย selfie → ระบบตรวจ geofence ฝั่ง server → บันทึกเวลา server
