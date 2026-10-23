// แปลข้อผิดพลาดทุกแบบเป็นภาษาไทยที่คนทั่วไปอ่านเข้าใจ — ใช้ร่วมกันทั้งหลังบ้าน (admin) และแอปรปภ. (liff)
// รับได้ทั้ง: รหัสจาก RPC ('outside_geofence') · Error object · ข้อความ Postgres/PostgREST · HTTP status
// หลักการ: บอกว่าเกิดอะไร + ควรทำอะไรต่อ · ไม่โชว์ศัพท์ระบบ (ยกเว้นรหัสอ้างอิงสั้นๆ ท้ายข้อความเมื่อไม่รู้จัก)

export const ERROR_TH = {
  // ── สิทธิ์ / การเข้าสู่ระบบ ──
  not_authenticated: 'หมดเวลาการเข้าสู่ระบบ — ปิดแล้วเปิดหน้านี้ใหม่',
  unauthorized: 'หมดเวลาการเข้าสู่ระบบ — ปิดแล้วเปิดหน้านี้ใหม่',
  invalid_line_token: 'การเข้าสู่ระบบด้วย LINE หมดอายุ — ปิดแล้วเปิดใหม่อีกครั้ง',
  missing_id_token: 'ยังไม่ได้เข้าสู่ระบบด้วย LINE — ปิดแล้วเปิดใหม่อีกครั้ง',
  forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้ — ติดต่อผู้ดูแลระบบ',
  forbidden_switch_vendor: 'คุณไม่มีสิทธิ์ดูข้อมูลของบริษัทนี้',
  vendor_not_found: 'ไม่พบบริษัทนี้ในระบบ',
  not_registered: 'บัญชี LINE นี้ยังไม่ได้ลงทะเบียน — ลงทะเบียนด้วยรหัสพนักงานและเบอร์โทร',
  role_not_allowed: 'ตำแหน่งของคุณทำรายการนี้ไม่ได้',
  auth_failed: 'เข้าสู่ระบบไม่สำเร็จ — ปิดแล้วเปิดใหม่อีกครั้ง',

  // ── ลงทะเบียน / ผูก LINE ──
  missing_employee_code_or_phone: 'กรอกรหัสพนักงานและเบอร์โทรให้ครบ',
  no_matching_employee: 'ไม่พบพนักงานที่รหัสและเบอร์โทรตรงกัน — ตรวจสอบอีกครั้ง หรือติดต่อหัวหน้า',
  line_already_bound: 'รหัสพนักงานนี้ผูกกับ LINE อื่นไปแล้ว — ติดต่อผู้ดูแลเพื่อยกเลิกการผูกเดิม',
  bind_failed: 'ผูกบัญชี LINE ไม่สำเร็จ — ลองอีกครั้ง',
  consent_required: 'กรุณากดยอมรับเงื่อนไขการใช้ข้อมูลก่อน',
  notice_outdated: 'ประกาศความเป็นส่วนตัวมีฉบับใหม่ — อ่านและกดรับทราบอีกครั้ง',
  unknown_purpose: 'ไม่พบหัวข้อความยินยอมนี้',
  user_no_line: 'พนักงานคนนี้ยังไม่ได้ผูก LINE จึงส่งข้อความไม่ได้',

  // ── เข้า-ออกงาน ──
  not_your_assignment: 'กะนี้ไม่ใช่ของคุณ',
  wrong_status: 'กะนี้ลงเวลาไปแล้ว',
  outside_time_window: 'ยังไม่ถึงเวลา — เข้างานได้ก่อนเริ่มกะไม่เกิน 45 นาที',
  outside_geofence: 'คุณอยู่นอกพื้นที่โครงการ — เข้าไปในพื้นที่แล้วลองใหม่',
  not_checked_in: 'ยังไม่ได้ลงเวลาเข้างานของกะนี้',
  already_checked_in: 'คุณยังไม่ได้ออกงานจากกะก่อนหน้า — ออกงานก่อนแล้วค่อยเข้างานใหม่',
  checkout_window_closed: 'เลยเวลาออกงานแล้ว (เกิน 1 ชม. หลังจบกะ) — ติดต่อหัวหน้าให้ปิดกะ',
  reason_required: 'กรุณาเลือกหรือพิมพ์เหตุผลที่ออกก่อนเวลา',
  device_blocked: 'เครื่องนี้ถูกระงับการใช้งาน — ติดต่อหัวหน้ากะ',
  use_scheduled_shift: 'คุณมีกะตามตารางช่วงนี้ — ใช้ปุ่มเข้างานของกะนั้นแทน',
  not_member_of_project: 'คุณไม่ได้รับมอบหมายในโครงการนี้',
  next_shift_too_soon: 'กะถัดไปของคุณใกล้เริ่มแล้ว — รอเข้างานตามกะ',
  no_slot_now: 'ตอนนี้ยังไม่ถึงช่วงกะของโครงการ — เข้างานได้ก่อนเริ่มช่วงกะ 45 นาที',
  no_slots_defined: 'โครงการนี้ยังไม่ได้ตั้งช่วงกะ — ติดต่อผู้ดูแล',
  project_not_open_mode: 'โครงการนี้ใช้การจัดกะล่วงหน้า — รอหัวหน้าจ่ายกะให้',
  overlaps_existing_shift: 'ช่วงเวลานี้ชนกับกะอื่นของพนักงานคนนี้',
  no_overlapping_shifts: 'ช่วงเวลานี้ชนกับกะอื่นของพนักงานคนนี้',

  // ── จุดตรวจ / SOS / ส่งข้อความ ──
  checkpoint_not_found: 'ไม่พบจุดตรวจนี้ หรือถูกปิดใช้งาน — ตรวจสอบ QR อีกครั้ง',
  no_active_shift_here: 'คุณยังไม่ได้เข้างานที่โครงการของจุดตรวจนี้ — เข้างานก่อนแล้วค่อยสแกน',
  too_frequent: 'เพิ่งส่งไปเมื่อครู่ — รอสักครู่แล้วลองใหม่',
  empty_message: 'กรุณาพิมพ์ข้อความก่อนส่ง',
  message_too_long: 'ข้อความยาวเกินไป — ย่อให้สั้นลง',
  no_recipients: 'ไม่มีผู้รับที่ผูก LINE ไว้ในกลุ่มที่เลือก',
  missing_notification_id: 'ส่งแจ้งเตือนไม่สำเร็จ — ลองใหม่อีกครั้ง',
  invalid_status: 'สถานะไม่ถูกต้อง — รีเฟรชหน้าแล้วลองใหม่',

  // ── ผู้ใช้ / บทบาท ──
  duplicate_employee_code: 'รหัสพนักงานนี้มีอยู่แล้วในบริษัทนี้ — ใช้รหัสอื่น',
  invalid_role: 'บทบาทไม่ถูกต้อง',
  owner_requires_owner: 'ตั้งบทบาท "เจ้าของ" ได้เฉพาะเจ้าของหรือ Super Admin',
  platform_admin_requires_platform_admin: 'ตั้ง Super Admin ได้เฉพาะ Super Admin',
  cannot_remove_own_platform_admin: 'ถอดสิทธิ์ Super Admin ของตัวเองไม่ได้',
  cannot_change_own_role: 'เปลี่ยนบทบาทของตัวเองไม่ได้',
  cannot_disable_self: 'ปิดใช้งานบัญชีของตัวเองไม่ได้',
  last_owner: 'บริษัทต้องมีเจ้าของอย่างน้อย 1 คน',
  project_limit_exceeded: 'ผูกโครงการเกินจำนวนที่บทบาทนี้กำหนด',
  property_not_in_vendor: 'โครงการที่เลือกไม่ใช่ของบริษัทนี้',
  user_not_found: 'ไม่พบผู้ใช้นี้ หรือถูกปิดใช้งานแล้ว',
  test_project_platform_admin_only: 'โครงการทดสอบจ่ายกะได้เฉพาะ Super Admin',
  platform_admin_test_only: 'Super Admin ทำงานได้เฉพาะในโครงการทดสอบ',

  // ── โครงการ / กะ ──
  property_not_found: 'ไม่พบโครงการนี้ หรือถูกปิดใช้งาน',
  template_not_found: 'ไม่พบแม่แบบกะนี้ หรือถูกปิดใช้งาน',
  invalid_mode: 'รูปแบบกะไม่ถูกต้อง',
  not_found: 'ไม่พบข้อมูลนี้ อาจถูกลบหรือปิดใช้ไปแล้ว — รีเฟรชหน้า',
  missing_key: 'ระบบค้นหาสถานที่ยังไม่พร้อม — ปักหมุดบนแผนที่แทน',
  missing_q: 'พิมพ์ชื่อสถานที่ก่อนค้นหา',

  // ── ไฟล์ / รูป / อุปกรณ์ ──
  image_decode_failed: 'เปิดรูปไม่ได้ — ถ่ายรูปใหม่อีกครั้ง',
  compress_failed: 'ย่อขนาดรูปไม่สำเร็จ — ถ่ายรูปใหม่อีกครั้ง',
  selfie_upload_failed: 'ส่งรูปไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  media_upload_failed: 'ส่งไฟล์ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  sign_failed: 'เปิดรูปไม่ได้ในขณะนี้ — ลองใหม่อีกครั้ง',
  gps: 'หาตำแหน่งไม่ได้ — เปิด GPS และอนุญาตให้ LINE ใช้ตำแหน่ง',
  timeout: 'ใช้เวลานานเกินไป — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  unsupported: 'เครื่องนี้ใช้ฟังก์ชันนี้ไม่ได้ — อัปเดตแอป LINE หรือพิมพ์รหัสแทน',

  // ── ระบบ ──
  internal_error: 'ระบบขัดข้องชั่วคราว — ลองใหม่อีกครั้งในอีกสักครู่',
}

const HTTP_TH = {
  400: 'ข้อมูลที่ส่งไม่ถูกต้อง — ตรวจสอบแล้วลองใหม่',
  401: 'หมดเวลาการเข้าสู่ระบบ — ปิดแล้วเปิดหน้านี้ใหม่',
  403: 'คุณไม่มีสิทธิ์ทำรายการนี้ — ติดต่อผู้ดูแลระบบ',
  404: 'ไม่พบข้อมูลที่ต้องการ — รีเฟรชหน้าแล้วลองใหม่',
  409: 'ข้อมูลซ้ำหรือชนกับรายการที่มีอยู่แล้ว',
  413: 'ไฟล์ใหญ่เกินไป',
  429: 'ใช้งานถี่เกินไป — รอสักครู่แล้วลองใหม่',
  500: 'ระบบขัดข้องชั่วคราว — ลองใหม่อีกครั้งในอีกสักครู่',
  502: 'ระบบขัดข้องชั่วคราว — ลองใหม่อีกครั้งในอีกสักครู่',
  503: 'ระบบไม่ว่างชั่วคราว — ลองใหม่อีกครั้งในอีกสักครู่',
  504: 'ระบบตอบช้าเกินไป — ลองใหม่อีกครั้งในอีกสักครู่',
}

// ข้อความจาก Postgres / PostgREST / เบราว์เซอร์ → ไทย (ตรวจตามลำดับ)
const PATTERNS = [
  [/no_overlapping_shifts|exclusion constraint|conflicting key value/i, ERROR_TH.no_overlapping_shifts],
  [/duplicate key|unique constraint|already exists/i, 'ข้อมูลนี้มีอยู่แล้ว (ซ้ำกับรายการเดิม) — ตรวจสอบรหัสหรือชื่ออีกครั้ง'],
  [/violates foreign key/i, 'ยังมีข้อมูลอื่นผูกกับรายการนี้อยู่ จึงลบหรือแก้ไม่ได้'],
  [/violates not-null|null value in column/i, 'กรอกข้อมูลที่จำเป็นให้ครบ'],
  [/violates check constraint/i, 'ข้อมูลบางช่องไม่อยู่ในรูปแบบที่ระบบรับ — ตรวจสอบอีกครั้ง'],
  [/row-level security|permission denied|insufficient_privilege/i, HTTP_TH[403]],
  [/jwt expired|invalid jwt|jwt|token/i, HTTP_TH[401]],
  [/invalid input syntax|invalid input value/i, 'รูปแบบข้อมูลไม่ถูกต้อง — ตรวจสอบตัวเลข วันที่ หรือเวลาอีกครั้ง'],
  [/statement timeout|canceling statement/i, 'ข้อมูลมากเกินไป ใช้เวลานานเกินกำหนด — ลดช่วงวันที่แล้วลองใหม่'],
  [/failed to fetch|networkerror|load failed|network request failed|err_internet|internet/i, 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ — ตรวจสอบสัญญาณแล้วลองใหม่'],
  [/aborted|timed? ?out/i, ERROR_TH.timeout],
  [/user denied geolocation|geolocation|permission.*location/i, ERROR_TH.gps],
  [/notallowederror|permission denied.*(camera|microphone)|getusermedia/i, 'ไม่ได้รับอนุญาตใช้กล้องหรือไมโครโฟน — อนุญาตในการตั้งค่า LINE แล้วลองใหม่'],
]

const hasThai = (s) => /[฀-๿]/.test(s)

/** แปลงข้อผิดพลาดใดๆ เป็นข้อความภาษาไทยที่อ่านเข้าใจ */
export function errTh(e, fallback = 'ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง') {
  if (e == null || e === '') return fallback
  const raw = typeof e === 'string' ? e : (e.message || e.error || e.code || String(e))
  const s = String(raw).trim()
  if (ERROR_TH[s]) return ERROR_TH[s]
  if (/statement timeout|canceling statement/i.test(s)) return 'ข้อมูลมากเกินไป ใช้เวลานานเกินกำหนด — ลดช่วงวันที่แล้วลองใหม่'
  // รหัสอยู่ในข้อความ เช่น 'project_limit_exceeded' จาก raise exception หรือ 'rpc_check_in_failed_401'
  const code = Object.keys(ERROR_TH).find((k) => new RegExp(`(^|[^a-z_])${k}([^a-z_]|$)`).test(s))
  if (code) return ERROR_TH[code]
  if (hasThai(s)) return s                      // เป็นข้อความไทยที่แปลแล้ว — ไม่แปลซ้ำ
  for (const [re, th] of PATTERNS) if (re.test(s)) return th
  const http = s.match(/(?:→|failed_|status[ :]*|\b)(4\d\d|5\d\d)\b/)
  if (http && HTTP_TH[http[1]]) return HTTP_TH[http[1]]
  return `${fallback} (รหัส: ${s.slice(0, 40)})`
}
