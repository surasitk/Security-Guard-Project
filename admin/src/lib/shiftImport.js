// นำเข้าตารางกะจาก Excel — สร้างไฟล์แบบฟอร์ม + อ่านไฟล์ที่กรอกแล้ว
// แบบฟอร์มมี 5 ชีต: อ่านก่อน · แม่แบบกะ · จ่ายกะ · รายชื่อโครงการ · รายชื่อพนักงาน
// การตรวจข้อมูลจริง (มีโครงการไหม กะซ้อนไหม ฯลฯ) ทำที่ฐานข้อมูลด้วย RPC import_shifts

export const SHEET_TPL = 'แม่แบบกะ'
export const SHEET_ASG = 'จ่ายกะ'
export const TPL_COLS = ['รหัสโครงการ', 'ชื่อกะ', 'เวลาเริ่ม', 'เวลาเลิก', 'จำนวนคน', 'วันที่มีกะ']
export const ASG_COLS = ['รหัสพนักงาน', 'รหัสโครงการ', 'ชื่อกะ', 'ตั้งแต่วันที่', 'ถึงวันที่']

const DOW_TOKENS = [
  ['อาทิตย์', 0], ['อา', 0], ['sun', 0],
  ['จันทร์', 1], ['จ', 1], ['mon', 1],
  ['อังคาร', 2], ['อ', 2], ['tue', 2],
  ['พฤหัสบดี', 4], ['พฤหัส', 4], ['พฤ', 4], ['thu', 4],
  ['พุธ', 3], ['พ', 3], ['wed', 3],
  ['ศุกร์', 5], ['ศ', 5], ['fri', 5],
  ['เสาร์', 6], ['ส', 6], ['sat', 6],
]
const dowOf = (t) => DOW_TOKENS.find(([k]) => k === t.toLowerCase().replace(/\./g, ''))?.[1]

/** "ทุกวัน" · "จ-ศ" · "จ,อ,พ" · "ส-อา" → [0..6] หรือ null ถ้าอ่านไม่ได้ */
export function parseDays(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, '')
  if (!s || /^(ทุกวัน|all|everyday|daily)$/i.test(s)) return s ? [0, 1, 2, 3, 4, 5, 6] : null
  if (/^(จ-ศ|จันทร์-ศุกร์|วันทำการ)$/.test(s)) return [1, 2, 3, 4, 5]
  const out = new Set()
  for (const part of s.split(/[,/、]+/).filter(Boolean)) {
    const m = part.split(/-|–|ถึง/).filter(Boolean)
    if (m.length === 2 && dowOf(m[0]) != null && dowOf(m[1]) != null) {
      let a = dowOf(m[0]); const b = dowOf(m[1])
      for (let i = 0; i < 7; i++) { out.add(a); if (a === b) break; a = (a + 1) % 7 }
    } else if (dowOf(part) != null) out.add(dowOf(part))
    else return null
  }
  return out.size ? [...out].sort() : null
}

const pad = (n) => String(n).padStart(2, '0')

/** เวลา: Date ของ Excel · เศษส่วนวัน · "7:00" · "07.00" · "0700" → "07:00" */
export function parseTime(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`
  if (typeof v === 'number') {
    const mins = Math.round((v % 1) * 1440)
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`
  }
  const s = String(v).trim().replace(/\s*น\.?$/, '')
  let m = s.match(/^(\d{1,2})[:.](\d{2})$/) || s.match(/^(\d{2})(\d{2})$/)
  if (!m) { const h = s.match(/^(\d{1,2})$/); if (h) m = [s, h[1], '00'] }
  if (!m) return s // ส่งต่อให้ฐานข้อมูลแจ้ง error
  return `${pad(+m[1])}:${m[2]}`
}

/** วันที่: Date ของ Excel · "2026-11-01" · "01/11/2026" · "1/11/2569" (พ.ศ.) → "2026-11-01" */
export function parseDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return parseDate(d) }
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) { let y = +m[1]; if (y > 2400) y -= 543; return `${y}-${pad(+m[2])}-${pad(+m[3])}` }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return `${y}-${pad(+m[2])}-${pad(+m[1])}` }
  return s
}

const cellText = (c) => {
  const v = c?.value
  if (v == null) return ''
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.richText) return v.richText.map((t) => t.text).join('')
    if (v.text != null) return String(v.text)
    if (v.result != null) return v.result
  }
  return v
}

/** อ่านไฟล์ที่ผู้ใช้กรอก → { templates, assignments } (แถวว่างข้าม) */
export async function readWorkbook(ExcelJS, file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const sheet = (name) => wb.getWorksheet(name)
  const ws1 = sheet(SHEET_TPL), ws2 = sheet(SHEET_ASG)
  if (!ws1 && !ws2) throw new Error(`ไม่พบชีต "${SHEET_TPL}" หรือ "${SHEET_ASG}" — ใช้ไฟล์แบบฟอร์มที่ดาวน์โหลดจากหน้านี้`)
  const rows = (ws, n) => {
    const out = []
    ws?.eachRow({ includeEmpty: false }, (row, no) => {
      if (no === 1) return
      const vals = Array.from({ length: n }, (_, i) => cellText(row.getCell(i + 1)))
      if (vals.every((x) => String(x ?? '').trim() === '')) return
      out.push({ row: no, vals })
    })
    return out
  }
  const templates = rows(ws1, TPL_COLS.length).map(({ row, vals }) => ({
    row,
    property_code: String(vals[0] ?? '').trim(),
    name: String(vals[1] ?? '').trim(),
    start: parseTime(vals[2]),
    end: parseTime(vals[3]),
    headcount: vals[4] === '' ? 1 : Number(vals[4]),
    days_text: String(vals[5] ?? '').trim() || 'ทุกวัน',
  }))
  const assignments = rows(ws2, ASG_COLS.length).map(({ row, vals }) => ({
    row,
    employee_code: String(vals[0] ?? '').trim(),
    property_code: String(vals[1] ?? '').trim(),
    template_name: String(vals[2] ?? '').trim(),
    date_from: parseDate(vals[3]),
    date_to: parseDate(vals[4]),
  }))
  return { templates, assignments }
}

/** แปลงแถวบนหน้าจอ (แก้ได้) → payload ของ RPC */
export function toPayload({ templates, assignments }) {
  return {
    templates: templates.map((t) => ({ ...t, headcount: Number(t.headcount) || t.headcount, days: parseDays(t.days_text) || [] })),
    assignments: assignments.map((a) => ({ ...a, date_from: parseDate(a.date_from), date_to: parseDate(a.date_to) || parseDate(a.date_from) })),
  }
}

/** สร้างไฟล์แบบฟอร์ม (มีรายชื่อโครงการ/พนักงานของ Tenant ปัจจุบันให้เลือก) */
export async function buildTemplateFile(ExcelJS, { properties, people, templates }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Horguard Force'
  const font = { name: 'Tahoma', size: 11 }
  const head = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1D21' } }
  const reqFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB83A30' } }

  // ── อ่านก่อน ──
  const rd = wb.addWorksheet('อ่านก่อน', { properties: { tabColor: { argb: 'FFB7791F' } } })
  rd.columns = [{ width: 22 }, { width: 18 }, { width: 12 }, { width: 70 }]
  const title = rd.addRow(['วิธีกรอกไฟล์นำเข้าตารางกะ — Horguard Force'])
  title.font = { ...font, bold: true, size: 14 }
  rd.addRow([])
  for (const line of [
    '1) ชีต "แม่แบบกะ" = สร้างแม่แบบกะใหม่ (ถ้ามีแม่แบบในระบบอยู่แล้ว ไม่ต้องกรอก)',
    '2) ชีต "จ่ายกะ" = จ่ายกะให้พนักงาน 1 แถวต่อ 1 คนต่อ 1 ช่วงวันที่ ระบบสร้างกะทุกวันที่ตรงกับ "วันที่มีกะ" ของแม่แบบ',
    '3) ห้ามเปลี่ยนชื่อชีตหรือหัวคอลัมน์ · แถวว่างจะถูกข้าม · ดูรหัสได้ที่ชีต "รายชื่อโครงการ" และ "รายชื่อพนักงาน"',
    '4) อัปโหลดแล้วระบบตรวจทุกแถวก่อน แสดงสรุปให้แก้บนเว็บหรือกลับไปแก้ในไฟล์ได้ ยังไม่บันทึกจนกว่าจะกดยืนยัน',
    '5) กะที่ซ้อนกับกะเดิมของคนเดียวกันจะถูกข้ามอัตโนมัติ · โครงการแบบ "ไม่จัดกะ" กรอกได้เฉพาะแม่แบบ ไม่ต้องจ่ายกะ',
  ]) rd.addRow([line]).font = font
  rd.addRow([])
  const th = rd.addRow(['ชีต / คอลัมน์', 'ตัวอย่าง', 'บังคับ', 'คำอธิบาย'])
  th.eachCell((c) => { c.font = head; c.fill = fill })
  const spec = [
    [SHEET_TPL, '', '', ''],
    ['รหัสโครงการ', 'KTB-LOTUS', 'ใช่', 'รหัสโครงการตามหน้า "โครงการ" (ดูชีต รายชื่อโครงการ)'],
    ['ชื่อกะ', 'กะกลางวัน', 'ใช่', 'ชื่อแม่แบบ ต้องไม่ซ้ำในโครงการเดียวกัน เพราะชีต "จ่ายกะ" อ้างถึงด้วยชื่อนี้'],
    ['เวลาเริ่ม', '07:00', 'ใช่', 'รูปแบบ ชม:นาที แบบ 24 ชั่วโมง'],
    ['เวลาเลิก', '19:00', 'ใช่', 'ถ้าเวลาเลิกน้อยกว่าเวลาเริ่ม (เช่น 19:00 → 07:00) ระบบถือว่าเป็นกะข้ามเที่ยงคืนเอง'],
    ['จำนวนคน', '2', 'ไม่', 'จำนวนคนที่ต้องมีในกะ (1–50) ค่าเริ่มต้น 1 · ใช้เตือนเมื่อคนไม่ครบ'],
    ['วันที่มีกะ', 'ทุกวัน', 'ไม่', 'ทุกวัน · จ-ศ · ส-อา · จ,อ,พ,พฤ,ศ (อา จ อ พ พฤ ศ ส) ค่าเริ่มต้น ทุกวัน'],
    [SHEET_ASG, '', '', ''],
    ['รหัสพนักงาน', 'SG-0042', 'ใช่', 'รหัสพนักงานตามหน้า "ผู้ใช้และสิทธิ์" (ดูชีต รายชื่อพนักงาน)'],
    ['รหัสโครงการ', 'KTB-LOTUS', 'ใช่', 'โครงการแบบ "จัดกะ" เท่านั้น'],
    ['ชื่อกะ', 'กะกลางวัน', 'ใช่', 'ชื่อแม่แบบที่มีในระบบ หรือที่กรอกในชีต "แม่แบบกะ" ของไฟล์นี้'],
    ['ตั้งแต่วันที่', '01/11/2026', 'ใช่', 'วัน/เดือน/ปี (ค.ศ. หรือ พ.ศ. ก็ได้) หรือ 2026-11-01'],
    ['ถึงวันที่', '30/11/2026', 'ไม่', 'ว่าง = วันเดียว · ไม่เกิน 93 วันต่อแถว · วันที่ผ่านไปแล้วจะถูกข้าม'],
  ]
  for (const r of spec) {
    const row = rd.addRow(r)
    row.font = font
    if (!r[1]) { row.getCell(1).font = { ...font, bold: true }; row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEEEB' } } }
  }

  // ── ชีตกรอก ──
  const addInput = (name, cols, widths, required) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = cols.map((h, i) => ({ header: h, width: widths[i] }))
    ws.getRow(1).eachCell((c, i) => { c.font = head; c.fill = required[i - 1] ? reqFill : fill; c.alignment = { horizontal: 'center' } })
    return ws
  }
  const wsT = addInput(SHEET_TPL, TPL_COLS, [18, 22, 12, 12, 11, 18], [1, 1, 1, 1, 0, 0])
  const wsA = addInput(SHEET_ASG, ASG_COLS, [16, 18, 22, 16, 16], [1, 1, 1, 1, 0])

  // ── รายชื่ออ้างอิง ──
  const wsP = wb.addWorksheet('รายชื่อโครงการ')
  wsP.columns = [{ header: 'รหัสโครงการ', width: 18 }, { header: 'ชื่อโครงการ', width: 40 }, { header: 'รูปแบบกะ', width: 12 }, { header: 'แม่แบบกะที่มีอยู่', width: 60 }]
  wsP.getRow(1).eachCell((c) => { c.font = head; c.fill = fill })
  for (const p of properties) {
    const names = templates.filter((t) => t.property_id === p.id).map((t) => `${t.name} (${String(t.start_time).slice(0, 5)}-${String(t.end_time).slice(0, 5)})`).join(', ')
    wsP.addRow([p.code, p.name, p.shift_mode === 'open' ? 'ไม่จัดกะ' : 'จัดกะ', names]).font = font
  }
  const wsU = wb.addWorksheet('รายชื่อพนักงาน')
  wsU.columns = [{ header: 'รหัสพนักงาน', width: 16 }, { header: 'ชื่อ-สกุล', width: 32 }, { header: 'บทบาท', width: 14 }]
  wsU.getRow(1).eachCell((c) => { c.font = head; c.fill = fill })
  for (const u of people) wsU.addRow([u.employee_code, u.full_name, u.role_th || u.role]).font = font

  // dropdown รหัสจากชีตอ้างอิง (500 แถวแรก)
  const pRange = `'รายชื่อโครงการ'!$A$2:$A$${Math.max(2, properties.length + 1)}`
  const uRange = `'รายชื่อพนักงาน'!$A$2:$A$${Math.max(2, people.length + 1)}`
  for (let r = 2; r <= 500; r++) {
    wsT.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [pRange] }
    wsT.getCell(`C${r}`).numFmt = '@'; wsT.getCell(`D${r}`).numFmt = '@'
    wsA.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [uRange] }
    wsA.getCell(`B${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [pRange] }
    wsA.getCell(`D${r}`).numFmt = '@'; wsA.getCell(`E${r}`).numFmt = '@'
  }
  return wb.xlsx.writeBuffer()
}
