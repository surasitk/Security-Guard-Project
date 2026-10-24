-- Guard OS / Horguard — Migration 32: ชื่อ + รูปโปรไฟล์ LINE (อัปเดตทุกครั้งที่เข้าระบบ)
-- (24 ต.ค. 2569) · ใช้แสดงรูปวงกลมเล็กใน Force (ผู้ใช้และสิทธิ์ · มอนิเตอร์ · แผนที่กำลังพล) และ Patrol (แผนที่กำลังพล)
-- รูปโหลดจาก server ของ LINE โดยตรง — ฐานข้อมูลเก็บแค่ลิงก์ · ใช้ "จำว่าใครเป็นใคร" ไม่ใช่ยืนยันตัวตน (ใช้เซลฟี่)
-- รันซ้ำได้

alter table users add column if not exists line_display_name text;
alter table users add column if not exists line_picture_url text;
alter table users add column if not exists line_profile_at timestamptz;

-- ของเดิม: photo_url ที่ดึงจาก LINE ตอนลงทะเบียน → ย้ายมาเป็นรูป LINE
update users set line_picture_url = photo_url
 where line_picture_url is null and photo_url like 'https://profile.line-scdn.net/%';

-- แผนที่กำลังพล: ใส่รูปของคนที่อยู่เวร
do $$
declare d text;
begin
  d := pg_get_functiondef('force_map(uuid)'::regprocedure);
  if position('''photo''' in d) = 0 then
    execute replace(d, '''since'', a.check_in_at, ''phone'', u.phone)',
                       '''since'', a.check_in_at, ''phone'', u.phone, ''photo'', coalesce(u.line_picture_url, u.photo_url))');
  end if;
end $$;
