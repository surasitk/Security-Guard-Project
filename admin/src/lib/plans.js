// แพ็กเกจ + เพดาน (migration 35) — ค่าคงที่ที่ใช้ร่วมกันระหว่างหน้า Super Admin และหน้า "แพ็กเกจของฉัน"
// เพดาน null = ไม่จำกัด

export const LIMITS = [
  { k: 'max_field_users', label: 'เพดานผู้ใช้หน้างาน', unit: 'คน', hint: 'รปภ. หัวหน้ากะ สแปร์ สายตรวจ ผู้ช่วยสายตรวจ ครูฝึก ที่เปิดใช้อยู่' },
  { k: 'max_properties', label: 'โครงการ', unit: 'แห่ง', hint: 'ไม่นับโครงการทดสอบ' },
  { k: 'max_checkpoints_per_property', label: 'จุดตรวจ QR ต่อโครงการ', unit: 'จุด' },
  { k: 'max_staff_accounts', label: 'บัญชีแอดมิน + ผจก.โซน', unit: 'บัญชี' },
  { k: 'max_client_accounts', label: 'บัญชีลูกค้า (Client dashboard)', unit: 'บัญชี' },
  { k: 'broadcasts_per_month', label: 'ประกาศกลุ่มผ่าน LINE ต่อเดือน', unit: 'ครั้ง' },
  { k: 'media_retention_days', label: 'เก็บรูป selfie / เสียง SOS', unit: 'วัน', info: true },
  { k: 'report_lookback_months', label: 'ดูรายงานย้อนหลัง', unit: 'เดือน', info: true },
]
export const LIMIT_KEYS = LIMITS.map((l) => l.k)

export const STATUS_TH = { trial: 'ทดลองใช้', active: 'ใช้งาน', suspended: 'ระงับ' }
export const CYCLE_TH = { monthly: 'รายเดือน', yearly: 'รายปี' }

export const baht = (n) => (n == null || n === '' ? '—' : `${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })}฿`)
export const limitText = (v, unit) => (v == null ? 'ไม่จำกัด' : `${Number(v).toLocaleString('th-TH')} ${unit || ''}`.trim())

/** ราคารายปี: ใช้ค่าที่ตั้งไว้ ถ้าไม่ได้ตั้งคิดจาก (12 − เดือนที่ลด) × รายเดือน */
export function yearlyPrice(plan, monthsFree = 2) {
  if (plan.price_yearly != null && plan.price_yearly !== '') return Number(plan.price_yearly)
  if (plan.price_monthly == null || plan.price_monthly === '') return null
  return Number(plan.price_monthly) * (12 - (Number(monthsFree) || 0))
}

export const daysLeft = (ts) => (ts ? Math.ceil((new Date(ts) - Date.now()) / 86400000) : null)
