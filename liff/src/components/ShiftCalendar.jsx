// ปฏิทินกะรายเดือน (แอป LINE)
// · ยาม/สายตรวจ/Super Admin: เห็นเฉพาะกะของตัวเอง
// · เจ้าของ/แอดมิน Vendor และลูกค้าเจ้าของโครงการ: เห็นกะทุกคนในโครงการของตน (กรองตามโครงการได้)
// ข้อมูลมาจาก RPC my_calendar(from, to) — สิทธิ์ตัดสินที่ฐานข้อมูล
import { useEffect, useMemo, useState } from 'react'
import { rpc } from '../lib/api'

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const STATUS = {
  scheduled: { t: 'รอเข้างาน', c: '' },
  checked_in: { t: 'กำลังปฏิบัติงาน', c: 'duty' },
  checked_out: { t: 'เสร็จแล้ว', c: 'ink' },
  absent: { t: 'ขาดงาน', c: 'alert' },
}
const KIND = { adhoc: 'เช็คอินโครงการ', emergency: 'ฉุกเฉิน', open: 'ตามช่วงกะ' }

// วันที่ตามเวลาไทย (YYYY-MM-DD) — กะนับตามวันที่เริ่มกะ
const bkk = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const pad = (n) => String(n).padStart(2, '0')
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

export default function ShiftCalendar({ wide = false }) {
  const today = bkk(Date.now())
  const [ym, setYm] = useState(() => ({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 }))
  const [rows, setRows] = useState(null)
  const [day, setDay] = useState(today)
  const [prop, setProp] = useState('')
  const [failed, setFailed] = useState(false)

  const first = `${ym.y}-${pad(ym.m + 1)}-01`
  const daysIn = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate()
  const last = `${ym.y}-${pad(ym.m + 1)}-${pad(daysIn)}`

  useEffect(() => {
    let live = true
    setRows(null)
    rpc('my_calendar', { p_from: first, p_to: last })
      .then((r) => { if (live) setRows(r || []) })
      .catch(() => { if (live) { setRows([]); setFailed(true) } })
    return () => { live = false }
  }, [first, last])

  const projects = useMemo(() => [...new Map((rows || []).map((r) => [r.property_id, r.property_name])).entries()], [rows])
  const showsOthers = wide || (rows || []).some((r) => !r.is_mine)
  const shown = (rows || []).filter((r) => !prop || r.property_id === prop)
  const byDay = {}
  for (const r of shown) (byDay[bkk(r.starts_at)] ||= []).push(r)

  function move(delta) {
    const d = new Date(Date.UTC(ym.y, ym.m + delta, 1))
    setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() })
    setDay(delta === 0 ? today : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`)
  }

  if (failed) return null   // ฐานข้อมูลยังไม่มีปฏิทิน (ยังไม่รัน migration 17)

  const lead = new Date(Date.UTC(ym.y, ym.m, 1)).getUTCDay()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${ym.y}-${pad(ym.m + 1)}-${pad(i + 1)}`)]
  const list = byDay[day] || []

  return (
    <section className="cal" aria-label="ปฏิทินกะ">
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={() => move(-1)} aria-label="เดือนก่อน">‹</button>
        <div className="cal-title">
          <b>{MONTH[ym.m]} {ym.y + 543}</b>
          <span>{showsOthers ? 'กะในโครงการของคุณ' : 'กะของคุณ'}</span>
        </div>
        <button type="button" className="cal-nav" onClick={() => move(1)} aria-label="เดือนถัดไป">›</button>
      </div>

      {showsOthers && projects.length > 1 && (
        <div className="chips cal-filter">
          <button type="button" className={`chip ${!prop ? 'on' : ''}`} onClick={() => setProp('')}>ทุกโครงการ</button>
          {projects.map(([id, name]) => (
            <button key={id} type="button" className={`chip ${prop === id ? 'on' : ''}`} onClick={() => setProp(id)}>{name}</button>
          ))}
        </div>
      )}

      <div className="cal-grid" role="grid">
        {DOW.map((d, i) => <div key={d} className={`cal-dow ${i === 0 || i === 6 ? 'we' : ''}`}>{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`x${i}`} />
          const items = byDay[d] || []
          const mine = items.filter((r) => r.is_mine)
          const cls = ['cal-day', d === today && 'today', d === day && 'sel', d < today && 'past', items.length && 'has'].filter(Boolean).join(' ')
          return (
            <button key={d} type="button" className={cls} onClick={() => setDay(d)} aria-pressed={d === day}
              aria-label={`${+d.slice(8)} ${MONTH[ym.m]} ${items.length ? `${items.length} กะ` : 'ไม่มีกะ'}`}>
              <span className="n">{+d.slice(8)}</span>
              {showsOthers
                ? items.length > 0 && <span className="cnt">{items.length}</span>
                : <span className="dots">{mine.slice(0, 3).map((r) => <i key={r.assignment_id} className={STATUS[r.status]?.c || ''} />)}</span>}
            </button>
          )
        })}
      </div>

      <div className="cal-list">
        <p className="cal-list-h">
          {new Date(`${day}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' })}
          {rows && <span> · {list.length ? `${list.length} กะ` : 'ไม่มีกะ'}</span>}
        </p>
        {rows === null && <p className="muted">กำลังโหลด…</p>}
        {list.map((r) => (
          <div key={r.assignment_id} className={`cal-item ${r.status}`}>
            <div className="t">{fmtTime(r.starts_at)}<small>{fmtTime(r.ends_at)}</small></div>
            <div className="b">
              <b>{showsOthers ? r.user_name : r.property_name}{r.is_mine && showsOthers ? ' (คุณ)' : ''}</b>
              <span>{showsOthers ? r.property_name : ''}{r.is_holiday_work ? `${showsOthers ? ' · ' : ''}วันหยุด (OT)` : ''}{KIND[r.kind] ? ` · ${KIND[r.kind]}` : ''}</span>
            </div>
            <span className={`pill ${STATUS[r.status]?.c || ''}`}>{STATUS[r.status]?.t || r.status}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
