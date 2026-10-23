// ป้ายสถานะ/ธง/บทบาท เป็นภาษาไทยที่เดียว — ทุกหน้าใช้ชุดนี้ ไม่โชว์ค่าระบบ (เช่น no_gps, checked_in) ให้ผู้ใช้เห็น
// tone: duty = เขียว (ปกติ/กำลังทำ) · warn = เหลือง (ต้องดู) · alert = แดง (ผิดปกติ/ต้องจัดการ) · solid = ดำ (เสร็จ)

export const STATUS_TH = {
  scheduled: 'รอเข้างาน', overdue: 'เลยเวลาเริ่ม', checked_in: 'กำลังปฏิบัติงาน',
  checked_out: 'ออกงานแล้ว', absent: 'ขาดงาน', cancelled: 'ยกเลิกแล้ว',
}
export const STATUS_TONE = { checked_in: 'duty', overdue: 'warn', absent: 'alert', checked_out: 'solid' }

export const FLAG_TH = {
  no_gps: 'ไม่มีพิกัด GPS',
  mock_gps: 'สงสัยใช้ GPS ปลอม',
  mock_gps_suspected: 'สงสัยใช้ GPS ปลอม',
  kiosk_wrong_property: 'ลงเวลาจากเครื่องของโครงการอื่น',
  emergency: 'เข้างานฉุกเฉิน',
  early_checkout: 'ออกก่อนเวลา',
  closed_by_admin: 'หัวหน้าปิดกะแทน',
  auto_closed_admin: 'ระบบปิดกะให้อัตโนมัติ',
  late: 'เข้าสาย',
}
export const FLAG_TONE = { emergency: 'warn', early_checkout: 'warn', closed_by_admin: 'warn', auto_closed_admin: 'warn', late: 'warn' }

export const KIND_TH = { scheduled: 'ตามตารางกะ', adhoc: 'เช็คอินโครงการ (ไม่มีกะ)', emergency: 'เข้างานฉุกเฉิน', open: 'ตามช่วงกะ' }

export const ROLE_TH = {
  owner: 'เจ้าของ', admin: 'ธุรการ/แอดมิน', supervisor: 'สายตรวจ', assistant_supervisor: 'ผู้ช่วยสายตรวจ',
  trainer: 'ครูฝึก', spare: 'ตัวสแปร์', shift_leader: 'หัวหน้ากะ', guard: 'รปภ.', client: 'ลูกค้า',
}

export const INCIDENT_TH = { open: 'รอรับเรื่อง', ack: 'รับเรื่องแล้ว กำลังจัดการ', closed: 'ปิดเรื่องแล้ว' }
export const INCIDENT_TONE = { open: 'alert', ack: 'warn', closed: 'duty' }

export const ACTION_TH = {
  generate_assignments: 'จ่ายกะ', import_shifts: 'นำเข้ากะจาก Excel',
  create_user: 'เพิ่มผู้ใช้', update_user: 'แก้ไขผู้ใช้', set_user_active: 'เปิด/ปิดใช้ผู้ใช้',
  line_account_bound: 'ผูกบัญชี LINE', create_vendor: 'สร้าง Tenant', update_vendor: 'แก้ไข Tenant',
  admin_close_assignment: 'ปิดกะแทน (ลืมเช็คเอาต์)', create_checkpoint: 'สร้างจุดตรวจ', set_checkpoint_active: 'เปิด/ปิดจุดตรวจ',
  save_property: 'บันทึกโครงการ', set_property_active: 'เปิด/ปิดโครงการ', set_shift_mode: 'เปลี่ยนรูปแบบกะของโครงการ',
  dispatch: 'สั่งส่งคนไปโครงการ', send_broadcast: 'ส่งประกาศกลุ่ม',
  incident_open: 'เปิดเรื่องแจ้งเหตุใหม่', incident_ack: 'รับเรื่องแจ้งเหตุ', incident_closed: 'ปิดเรื่องแจ้งเหตุ',
}

const hasThai = (s) => /[฀-๿]/.test(String(s || ''))
/** แปลค่าระบบเป็นไทย — ไม่รู้จัก = ใช้ fallback (ไม่โชว์ค่าระบบ) */
export const th = (map, v, fallback = 'อื่นๆ') => (v == null || v === '' ? '' : map[v] || (hasThai(v) ? v : fallback))

/** 'no_gps,emergency' → [{ code, label, tone }] */
export const flagList = (reason, isMock = false) => {
  const codes = String(reason || '').split(',').map((x) => x.trim()).filter(Boolean)
  if (isMock && !codes.some((c) => c.startsWith('mock_gps'))) codes.push('mock_gps')
  return codes.map((c) => ({ code: c, label: th(FLAG_TH, c, 'ติดธงตรวจสอบ'), tone: FLAG_TONE[c] || 'alert' }))
}
