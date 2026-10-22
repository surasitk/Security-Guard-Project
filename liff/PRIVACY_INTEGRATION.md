# เชื่อม Privacy Notice เข้า Horguard Patrol (LIFF)

ฐานข้อมูลพร้อมแล้ว (migration 18 รันบน production 22 ต.ค. 2569) · หน้าจออยู่ใน `src/pages/PrivacyNotice.jsx`

> ⚠️ ซอร์ส `liff/src` ใน repo นี้เก่ากว่าแอปที่ใช้งานจริง (r26 build จากซอร์สที่ไม่ได้ commit)
> ให้แก้ตามขั้นตอนด้านล่างในซอร์สล่าสุด แล้ว build → `docs/app`

## 1. App.jsx — ด่านรับทราบหลัง login

```jsx
import { PrivacyGate, PrivacyPage } from './pages/PrivacyNotice.jsx'
import { rpc } from './lib/api'

// state เพิ่ม: 'privacy'
// หลัง silentLogin() / Register onDone:
const s = await rpc('my_privacy_status')
setPrivacy(s)
setState(s.acknowledged ? 'ready' : 'privacy')

if (state === 'privacy') return <PrivacyGate status={privacy} onDone={() => setState('ready')} />
if (page === 'privacy') return <PrivacyPage />   // เพิ่ม 'privacy' ใน targetPage()
```

ถ้า `my_privacy_status` error (เช่น เน็ตหลุด) ให้แสดง error เหมือนตอน login ไม่ผ่าน ห้ามข้ามด่านไปหน้า Home

## 2. Register.jsx — เอา checkbox ยินยอมแบบรวมออก

checkbox เดิมรวมรูป + พิกัดเป็น "ยินยอม" ข้อเดียว ซึ่งไม่ตรงหลัก (การลงเวลาใช้ฐานสัญญาจ้าง ไม่ใช่ consent)
ให้เปลี่ยนเป็นข้อความแจ้ง เช่น "ขั้นถัดไปคุณจะได้อ่านประกาศความเป็นส่วนตัว" แล้วส่ง `consent_version`
เป็นค่า Notice ปัจจุบันต่อไปตามเดิม (Edge Function `auth-line` ยังต้องการค่านี้ ไม่ต้อง deploy ใหม่)

## 3. ทางเข้าหน้าความเป็นส่วนตัว

- ลิงก์ท้ายหน้า Home: `?page=privacy` "ความเป็นส่วนตัว"
- (ไม่บังคับ) ปุ่มใน rich menu หรือเมนูโปรไฟล์

## 4. ออก Notice เวอร์ชันใหม่ (ไม่ต้อง deploy แอป)

```sql
update privacy_notices set is_current = false where is_current;
insert into privacy_notices (version, is_current, title_th, summary_th, full_url, change_note)
values ('2027-01-15', true, '...', '[{"title":"...","text":"..."}]', 'https://horguard.com/privacy', 'เพิ่ม...');
```
ทุกคนจะเห็นหน้ารับทราบใหม่ตอนเปิดแอปครั้งถัดไป (ค่า consent เดิมยังอยู่ ไม่ต้องเลือกใหม่)

## 5. ใช้ consent ในฟีเจอร์

```sql
select has_consent(user_id, 'client_view_photo')   -- false ถ้าไม่เคยตอบหรือถอนแล้ว
```
เช่น หน้ารายงานลูกค้า (client portal) ต้องซ่อนรูปของยามที่ has_consent = false
