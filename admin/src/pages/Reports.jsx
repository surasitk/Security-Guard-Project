// รายงานเวลาเข้า-ออกงาน — ค้นหาตามโครงการ / ช่วงวันที่ / รายชื่อ แล้ว Export เป็น Excel ตามแบบฟอร์มของบริษัท
// แบบฟอร์ม: หัว "โครงการ …" · วันที่ · ชื่อ-สกุล · เวลาเข้างาน · เวลาออกงาน · สาย(นาที) · OT(นาที) · สรุปท้ายตาราง
// ข้อมูลมาจาก RPC report_attendance (สิทธิ์ตัดสินที่ฐานข้อมูล: หัวหน้ากะ/สายตรวจเห็นเฉพาะโครงการที่ผูกไว้)
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, errTh, listCached } from '../lib/api'
import { seeMoney } from '../lib/perm'

const bkkDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const firstOfMonth = () => `${bkkDate().slice(0, 8)}01`
const fmtD = (iso) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok' })
const fmtT = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : ''
// เวลาออกงานข้ามวัน (ควง/กะดึก) → ต่อท้าย (+1)
const outLabel = (r) => {
  if (!r.check_out_at) return ''
  const plus = bkkDate(new Date(r.check_out_at)) !== r.work_date ? ' (+1)' : ''
  return fmtT(r.check_out_at) + plus
}
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const KIND = { adhoc: 'เช็คอินโครงการ', emergency: 'ฉุกเฉิน', open: 'ตามช่วงกะ' }

function summarize(rows) {
  const worked = rows.filter((r) => r.check_in_at)
  const late = worked.filter((r) => r.late_minutes > 0)
  const ot = worked.filter((r) => r.ot_minutes > 0)
  return {
    total: rows.length,
    worked: worked.length,
    absent: rows.filter((r) => r.status === 'absent').length,
    lateCount: late.length,
    lateMin: late.reduce((s, r) => s + r.late_minutes, 0),
    otCount: ot.length,
    otMin: ot.reduce((s, r) => s + r.ot_minutes, 0),
    holiday: worked.filter((r) => r.is_holiday_work).length,
    amount: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
  }
}
// สรุปรายคน: จำนวนงาน (กะที่เข้างานจริง) และจำนวนเงิน
function perPerson(rows) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.user_id)) m.set(r.user_id, { name: r.full_name, code: r.employee_code, jobs: 0, amount: 0, noWage: false })
    const p = m.get(r.user_id)
    if (r.check_in_at) { p.jobs += 1; p.amount += Number(r.amount || 0); if (r.daily_wage == null) p.noWage = true }
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
const summaryLines = (s) => [
  ['กะทั้งหมด', `${s.total} กะ`],
  ['เข้างาน', `${s.worked} กะ`],
  ['ขาดงาน', `${s.absent} กะ`],
  ['มาสาย', `${s.lateCount} ครั้ง · รวม ${s.lateMin} นาที`],
  ['OT', `${s.otCount} ครั้ง · รวม ${s.otMin} นาที`],
  ['ทำงานวันหยุด', `${s.holiday} กะ`],
  ['จำนวนเงินรวม', `${money(s.amount)} บาท`],
].filter(([k]) => seeMoney() || k !== 'จำนวนเงินรวม')

export default function Reports() {
  const M = seeMoney()
  const [props, setProps] = useState([])
  const [people, setPeople] = useState([])
  const [f, setF] = useState({ property: '', from: firstOfMonth(), to: bkkDate(), user: '' })
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    listCached('properties?select=id,name,is_test&is_active=is.true&order=name').then(setProps).catch(() => {})
    listCached('users?select=id,full_name,employee_code,role&order=full_name').then(setPeople).catch(() => {})
  }, [])

  async function search(e) {
    e?.preventDefault(); setMsg(null)
    if (f.to < f.from) { setMsg({ t: 'err', m: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' }); return }
    const days = (Date.parse(f.to) - Date.parse(f.from)) / 86400000
    if (days > 92) { setMsg({ t: 'err', m: 'เลือกช่วงได้ไม่เกิน 93 วันต่อครั้ง' }); return }
    setBusy(true)
    try {
      setRows(await rpc('report_attendance', {
        p_from: f.from, p_to: f.to, p_property_id: f.property || null, p_user_id: f.user || null,
      }))
    } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }) } finally { setBusy(false) }
  }

  // แยกตามโครงการ (1 โครงการ = 1 ตาราง / 1 sheet)
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) {
      if (!m.has(r.property_id)) m.set(r.property_id, { name: r.property_name, rows: [] })
      m.get(r.property_id).rows.push(r)
    }
    return [...m.values()]
  }, [rows])

  const period = `${fmtD(f.from)} – ${fmtD(f.to)}`

  async function exportXlsx() {
    setBusy(true); setMsg(null)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Horguard Force'
      const used = new Set()
      const thin = { style: 'thin', color: { argb: 'FF000000' } }
      const box = { top: thin, left: thin, bottom: thin, right: thin }
      const font = { name: 'Tahoma', size: 11 }
      for (const g of groups) {
        let sheetName = g.name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'โครงการ'
        for (let i = 2; used.has(sheetName); i++) sheetName = `${sheetName.slice(0, 27)} (${i})`
        used.add(sheetName)
        const ws = wb.addWorksheet(sheetName, { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
        ws.columns = [{ width: 13 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 13 }, { width: 16 }].slice(0, M ? 7 : 6)

        ws.mergeCells(M ? 'A1:G1' : 'A1:F1')
        ws.getCell('A1').value = `โครงการ ${g.name}   (${period})`
        ws.getCell('A1').font = { ...font, bold: true }
        ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
        ws.getCell('A1').border = box
        const head = ws.addRow(['วันที่', 'ชื่อ-สกุล', 'เวลาเข้างาน', 'เวลาออกงาน', 'สาย(นาที)', 'OT(นาที)', 'จำนวนเงิน(บาท)'].slice(0, M ? 7 : 6))
        head.eachCell((c) => { c.font = { ...font, bold: true }; c.alignment = { horizontal: 'center' }; c.border = box })

        for (const r of g.rows) {
          const absent = r.status === 'absent'
          const row = ws.addRow([
            fmtD(r.work_date), r.full_name,
            absent ? 'ขาดงาน' : fmtT(r.check_in_at), absent ? '' : outLabel(r),
            absent ? '' : r.late_minutes, absent ? '' : r.ot_minutes,
            Number(r.amount || 0),
          ].slice(0, M ? 7 : 6))
          if (M) row.getCell(7).numFmt = '#,##0.00'
          row.eachCell({ includeEmpty: true }, (c, col) => {
            c.font = absent && col === 3 ? { ...font, color: { argb: 'FFB83A30' } } : font
            c.border = box
            c.alignment = { horizontal: col === 2 ? 'left' : col === 7 ? 'right' : 'center' }
          })
        }

        ws.addRow([])
        const sTitle = ws.addRow(['สรุป'])
        ws.mergeCells(`A${sTitle.number}:B${sTitle.number}`)
        sTitle.getCell(1).font = { ...font, bold: true }
        sTitle.getCell(1).alignment = { horizontal: 'center' }
        for (const [k, v] of summaryLines(summarize(g.rows))) {
          const r = ws.addRow([`${k} =`, v])
          r.getCell(1).font = font; r.getCell(2).font = font
          r.getCell(1).border = box; r.getCell(2).border = box
        }

        ws.addRow([])
        const pTitle = ws.addRow(['สรุปรายคน'])
        ws.mergeCells(`A${pTitle.number}:${M ? 'D' : 'C'}${pTitle.number}`)
        pTitle.getCell(1).font = { ...font, bold: true }
        pTitle.getCell(1).alignment = { horizontal: 'center' }
        const pHead = ws.addRow(['ลำดับ', 'ชื่อ-สกุล', 'จำนวนงาน', 'จำนวนเงิน(บาท)'].slice(0, M ? 4 : 3))
        pHead.eachCell((c) => { c.font = { ...font, bold: true }; c.alignment = { horizontal: 'center' }; c.border = box })
        const pp = perPerson(g.rows)
        pp.forEach((p, i) => {
          const r = ws.addRow([i + 1, p.name, p.jobs, p.amount].slice(0, M ? 4 : 3))
          if (M) r.getCell(4).numFmt = '#,##0.00'
          r.eachCell((c, col) => { c.font = font; c.border = box; c.alignment = { horizontal: col === 2 ? 'left' : col === 4 ? 'right' : 'center' } })
        })
        const tot = ws.addRow(['', 'รวม', pp.reduce((s, p) => s + p.jobs, 0), pp.reduce((s, p) => s + p.amount, 0)].slice(0, M ? 4 : 3))
        if (M) tot.getCell(4).numFmt = '#,##0.00'
        tot.eachCell({ includeEmpty: true }, (c, col) => { c.font = { ...font, bold: true }; c.border = box; c.alignment = { horizontal: col === 4 ? 'right' : 'center' } })
      }
      if (!groups.length) wb.addWorksheet('ไม่มีข้อมูล').addRow(['ไม่มีข้อมูลในช่วงที่เลือก'])
      const buf = await wb.xlsx.writeBuffer()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `รายงานเข้างาน_${f.from}_${f.to}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e2) { setMsg({ t: 'err', m: `Export ไม่สำเร็จ (${errTh(e2)})` }) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="section-h"><h2>ค้นหาขั้นสูง</h2></div>
      <form className="card" onSubmit={search}>
        <div className="form-grid">
          <div className="field"><label>ชื่อโครงการ</label>
            <select value={f.property} onChange={(e) => setF({ ...f, property: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {props.map((p) => <option key={p.id} value={p.id}>{p.is_test ? '🧪 ' : ''}{p.name}</option>)}
            </select>
          </div>
          <div className="field"><label>ตั้งแต่วันที่</label>
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required />
          </div>
          <div className="field"><label>ถึงวันที่</label>
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required />
          </div>
          <div className="field"><label>รายชื่อ</label>
            <select value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}>
              <option value="">ทั้งหมด</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.employee_code})</option>)}
            </select>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-start', gridColumn: '1 / -1' }}>
            <button className="btn inline" type="submit" disabled={busy}>{busy && !rows ? 'กำลังค้นหา…' : 'ค้นหา'}</button>
            <button className="btn inline ghost" type="button" onClick={exportXlsx} disabled={busy || !rows || !rows.length}>Export Excel</button>
          </div>
        </div>
        <p className="hint">สูงสุด 93 วันต่อครั้ง · OT = เวลาออกงานที่เกินเวลาจบกะ · กะที่ผ่านไปแล้วแต่ไม่มีการเข้างานนับเป็นขาดงาน{M ? ' · จำนวนเงิน = ค่าแรง/วันที่ตั้งไว้ในหน้าพนักงาน × กะที่เข้างาน' : ''}</p>
      </form>

      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      {rows && !rows.length && <p className="muted" style={{ marginTop: 18 }}>ไม่พบข้อมูลในช่วงที่เลือก</p>}

      {groups.map((g) => {
        const s = summarize(g.rows)
        return (
          <section key={g.name} className="report">
            <table className="grid report-table">
              <thead>
                <tr><th colSpan={M ? 7 : 6} className="report-title">โครงการ {g.name} <span>({period})</span></th></tr>
                <tr><th>วันที่</th><th>ชื่อ-สกุล</th><th>เวลาเข้างาน</th><th>เวลาออกงาน</th><th>สาย(นาที)</th><th>OT(นาที)</th>{M && <th>จำนวนเงิน(บาท)</th>}</tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => {
                  const absent = r.status === 'absent'
                  return (
                    <tr key={i}>
                      <td>{fmtD(r.work_date)}</td>
                      <td className="name">{r.full_name}{KIND[r.kind] && <span className="badge" style={{ marginLeft: 6 }}>{KIND[r.kind]}</span>}{r.is_holiday_work && !absent && <span className="badge warn" style={{ marginLeft: 6 }}>วันหยุด</span>}</td>
                      <td>{absent ? <span className="badge alert">ขาดงาน</span> : fmtT(r.check_in_at)}</td>
                      <td>{absent ? '' : (outLabel(r) || <span className="muted">ยังไม่ออก</span>)}</td>
                      <td className={r.late_minutes > 0 ? 'warn' : ''}>{absent ? '' : r.late_minutes}</td>
                      <td>{absent ? '' : r.ot_minutes}</td>
                      {M && <td className="num">{money(r.amount)}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <table className="grid report-sum">
              <thead><tr><th colSpan={2}>สรุป</th></tr></thead>
              <tbody>{summaryLines(s).map(([k, v]) => <tr key={k}><td>{k} =</td><td>{v}</td></tr>)}</tbody>
            </table>
            {(() => {
              const pp = perPerson(g.rows)
              return (
                <table className="grid report-people">
                  <thead>
                    <tr><th colSpan={M ? 4 : 3}>สรุปรายคน</th></tr>
                    <tr><th>ลำดับ</th><th>ชื่อ-สกุล</th><th>จำนวนงาน</th>{M && <th>จำนวนเงิน(บาท)</th>}</tr>
                  </thead>
                  <tbody>
                    {pp.map((p, i) => (
                      <tr key={p.name + i}>
                        <td>{i + 1}</td>
                        <td className="name">{p.name}{M && p.noWage && <span className="badge warn" style={{ marginLeft: 6 }}>ยังไม่ตั้งค่าแรง</span>}</td>
                        <td>{p.jobs}</td>
                        {M && <td className="num">{money(p.amount)}</td>}
                      </tr>
                    ))}
                    <tr className="total"><td></td><td className="name">รวม</td><td>{pp.reduce((a, p) => a + p.jobs, 0)}</td>{M && <td className="num">{money(pp.reduce((a, p) => a + p.amount, 0))}</td>}</tr>
                  </tbody>
                </table>
              )
            })()}
          </section>
        )
      })}
    </div>
  )
}
