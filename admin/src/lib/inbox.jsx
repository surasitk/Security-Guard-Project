// กล่องข้อความ (migration 36) — ประเภท สี ไอคอน และตัวช่วยร่วมระหว่างหน้า Inbox และหน้า Super Admin ส่งข้อความ
export const CAT = {
  plan: { label: 'แพ็กเกจ', tone: 'warn' },
  billing: { label: 'ค่าบริการ', tone: 'warn' },
  alert: { label: 'แจ้งเตือน', tone: 'alert' },
  maintenance: { label: 'ปิดปรับปรุง', tone: 'alert' },
  announcement: { label: 'ประกาศ', tone: '' },
  system: { label: 'ระบบ', tone: '' },
}
export const CAT_KEYS = ['announcement', 'alert', 'billing', 'plan', 'maintenance', 'system']
export const ROLE_TH = { owner: 'เจ้าของ', admin: 'แอดมิน', zone_manager: 'ผจก.โซน', shift_leader: 'หัวหน้ากะ', supervisor: 'สายตรวจ' }
export const SEND_ROLES = ['owner', 'admin', 'zone_manager', 'shift_leader', 'supervisor']
export const LINE_OA = 'https://lin.ee/5e7WMZj'

// ไอคอนเส้น 18px ตามประเภท
export const CAT_ICON = {
  plan: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  billing: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.01" /></>,
  maintenance: <><path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z" /></>,
  announcement: <><path d="M3 10v4h3l7 4V6L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
  system: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
}
export const CatIcon = ({ c }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{CAT_ICON[c] || CAT_ICON.system}</svg>
)
export const CatTag = ({ c }) => <span className={`badge ${CAT[c]?.tone || ''}`}>{CAT[c]?.label || c}</span>
export const HighTag = () => <span className="badge alert">สำคัญ</span>

const BKK = 'Asia/Bangkok'
/** เวลาแบบกล่องจดหมาย: วันนี้ = เวลา · เมื่อวาน · ปีนี้ = วัน เดือน · อื่นๆ = วันที่เต็ม */
export function mailTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const day = (x) => x.toLocaleDateString('en-CA', { timeZone: BKK })
  const now = new Date()
  if (day(d) === day(now)) return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: BKK })
  if (day(d) === day(new Date(now - 86400000))) return 'เมื่อวาน'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}), timeZone: BKK })
}
export const fullTime = (ts) => (ts ? `${new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: BKK })} น.` : '')
