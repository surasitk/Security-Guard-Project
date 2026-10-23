// สิทธิ์ฝั่งหน้าเว็บ (ฐานข้อมูลบังคับซ้ำอีกชั้น — หน้าเว็บแค่ซ่อนปุ่มที่ใช้ไม่ได้)
import { getUser } from '../lib/api'

const role = () => { const u = getUser() || {}; return u.effective_role || u.role }
/** ผจก.โซน: เข้า Force ดูได้อย่างเดียว */
export const readOnly = () => role() === 'zone_manager'
export const canEdit = () => !readOnly()
/** เห็นค่าแรง/ยอดเงินได้ไหม */
export const seeMoney = () => role() !== 'zone_manager'
