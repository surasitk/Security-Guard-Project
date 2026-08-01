-- Guard OS — Sprint 1
-- Migration 1: Extensions
-- หลักการ: timestamp ฝั่ง server เท่านั้น · events เขียนผ่าน RPC เท่านั้น · RLS ทุกตาราง

create extension if not exists postgis;        -- geofence / ระยะทาง
create extension if not exists btree_gist;     -- EXCLUDE constraint กันกะซ้อน
create extension if not exists pgcrypto;       -- gen_random_uuid()
-- pg_cron ใช้ตั้งแต่ Sprint 2 (missed patrol) — เปิดผ่าน Dashboard > Database > Extensions
