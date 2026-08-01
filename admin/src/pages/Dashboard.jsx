// ภาพรวมวันนี้ — กะทั้งหมด / เข้าแล้ว / สาย / ยังไม่เข้า + รายการลงเวลาสด
import { useEffect, useState } from 'react'
import { list, todayRangeBkk, fmtTime } from '../lib/api'

export default function Dashboard() {
  const [shifts, setShifts] = useState(null)
  const [att, setAtt] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [start, end] = todayRangeBkk()
        const [s, a] = await Promise.all([
          list(`shift_assignments?select=id,starts_at,ends_at,status,is_holiday_work,users(full_name,employee_code),properties(name)&starts_at=gte.${start}&starts_at=lt.${end}&status=neq.cancelled&order=starts_at`),
          list(`attendance?select=check_in_at,check_out_at,late_minutes,in_distance_m,is_mock_flag,users(full_name),properties(name)&check_in_at=gte.${start}&order=check_in_at.desc&limit=30`),
        ])
        setShifts(s); setAtt(a)
      } catch (e) { setErr(String(e.message || e)) }
    })()
  }, [])

  if (err) return <div className="notice err">โหลดข้อมูลไม่สำเร็จ — {err}</div>
  if (!shifts) return <p className="muted">กำลังโหลด…</p>

  const total = shifts.length
  const checkedIn = shifts.filter((s) => s.status === 'checked_in').length
  const done = shifts.filter((s) => s.status === 'checked_out').length
  const waiting = shifts.filter((s) => s.status === 'scheduled').length
  const late = att.filter((a) => a.late_minutes > 0).length
  const flagged = att.filter((a) => a.is_mock_flag).length

  return (
    <div>
      <div className="stat-row">
        <div className="stat"><div className="n">{total}</div><div className="l">กะวันนี้</div></div>
        <div className="stat"><div className="n">{checkedIn}</div><div className="l">กำลังปฏิบัติงาน</div></div>
        <div className="stat"><div className="n">{done}</div><div className="l">ออกงานแล้ว</div></div>
        <div className="stat"><div className="n">{waiting}</div><div className="l">ยังไม่เข้างาน</div></div>
        <div className="stat"><div className="n">{late}</div><div className="l">เข้าสาย</div></div>
        <div className="stat"><div className="n">{flagged}</div><div className="l">ธงตรวจสอบ</div></div>
      </div>

      <div className="section-h"><h2>กะวันนี้</h2></div>
      {total === 0 ? <p className="muted">ยังไม่มีกะวันนี้ — สร้างจากแท็บ "ตารางกะ"</p> : (
        <table className="grid">
          <thead><tr><th>พนักงาน</th><th>โครงการ</th><th>เวลา</th><th>สถานะ</th></tr></thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>{s.users?.full_name} <span className="muted">({s.users?.employee_code})</span></td>
                <td>{s.properties?.name}{s.is_holiday_work ? ' · วันหยุด' : ''}</td>
                <td>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</td>
                <td><Status s={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-h"><h2>การลงเวลาล่าสุด</h2></div>
      {att.length === 0 ? <p className="muted">ยังไม่มีการลงเวลาวันนี้</p> : (
        <table className="grid">
          <thead><tr><th>พนักงาน</th><th>โครงการ</th><th>เข้า</th><th>ออก</th><th>หมายเหตุ</th></tr></thead>
          <tbody>
            {att.map((a, i) => (
              <tr key={i}>
                <td>{a.users?.full_name}</td>
                <td>{a.properties?.name}</td>
                <td>{fmtTime(a.check_in_at)}{a.late_minutes > 0 && <span className="muted"> (สาย {a.late_minutes} น.)</span>}</td>
                <td>{fmtTime(a.check_out_at)}</td>
                <td>{a.is_mock_flag ? <span className="badge">ตรวจสอบ</span> : <span className="muted">ปกติ</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Status({ s }) {
  const map = { scheduled: 'รอเข้างาน', checked_in: 'กำลังปฏิบัติงาน', checked_out: 'ออกงานแล้ว', absent: 'ขาด' }
  return <span className={`badge ${s === 'checked_in' ? 'solid' : ''}`}>{map[s] || s}</span>
}
