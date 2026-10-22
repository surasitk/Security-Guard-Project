#!/usr/bin/env bash
# Horguard — ถอดรหัสและกู้คืน backup จาก GitHub Actions
#
# ใช้:
#   ./scripts/restore-backup.sh horguard-db-2026-10-23_0300.dump.gpg            # ถอดรหัสอย่างเดียว ได้ไฟล์ .dump
#   ./scripts/restore-backup.sh horguard-db-2026-10-23_0300.dump.gpg "$DB_URL"  # ถอดรหัส + กู้คืนเข้า DB ปลายทาง
#
# ⚠️ กู้คืนเข้า project ทดสอบก่อนเสมอ ห้ามกู้ทับ production โดยไม่ได้ตั้งใจ
# ต้องมี gpg และ pg_restore (macOS: brew install gnupg libpq)

set -euo pipefail
IN="${1:?ระบุไฟล์ .dump.gpg}"
DB_URL="${2:-}"
OUT="${IN%.gpg}"

read -r -s -p "BACKUP_PASSPHRASE: " PASS; echo
gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" --output "$OUT" --decrypt "$IN"
echo "ถอดรหัสแล้ว: $OUT"
pg_restore --list "$OUT" | head -20

if [ -n "$DB_URL" ]; then
  read -r -p "กู้คืนเข้า DB นี้จริงไหม? พิมพ์ yes: " OK
  [ "$OK" = "yes" ] || { echo "ยกเลิก"; exit 1; }
  pg_restore --dbname="$DB_URL" --no-owner --no-privileges --clean --if-exists "$OUT"
  echo "กู้คืนเสร็จ"
fi
