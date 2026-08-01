// ภาพรวมวันนี้ — กะทั้งหมด / เข้าแล้ว / สาย / ยังไม่เข้า + รายการลงเวลาสด + filter จังหวัด/โครงการ
import { useEffect, useMemo, useState } from 'react'
import { list, todayRangeBkk, fmtTime } from '../lib/api'
import FilterChips from '../components/FilterChips.jsx'

export default function Dashboard() {
  const [shiftsAll, setShifts] = useState(null)
  const [attAll, setAtt] = useState([])
  const [provSel, setProvSel] = useState(new Set())
  const [propSel, setPropSel] = useState(new Set())
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [start, end] = todayRangeBkk()
        const [s, a] = await Promise.all([
          list(`shift_assignments?select=id,starts_at,ends_at,status,is_holiday_work,users!user_id(full_name,employee_code),properties(id,name,province)&starts_at=gte.${start}&starts_at=lt.${end}&status=neq.cancelled&order=starts_at`),
          list(`attendance?select=check_in_at,check_out_at,late_minutes,in_distance_m,is_mock_flag,users(full_name),properties(id,name,province)&check_in_at=gte.${start}&order=check_in_at.desc&limit=30`),
        ])
        setShifts(s); setAtt(a)
      } catch (e) { setErr(String(e.message || e)) }
    })()
  }, [])

  const provinces = useMemo(() => {
    if (!shiftsAll) return []
    const s = [...new Set([...shiftsAll, ...attAll].map((r) => r.properties?.province || 'ไม่ระบุ'))]
    return s.sort().map((v) => ({ value: v, label: v }))
  }, [shiftsAll, attAll])
  const propOptions = useMemo(() => {
    if (!shiftsAll) return []
    const m = new Map()
    for (const r of [...shiftsAll, ...attAll]) if (r.properties) m.set(r.properties.id, r.properties.name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
  }, [shiftsAll, attAll])

  const match = (r) => {
    const prov = r.properties?.province || 'ไม่ระบุ'
    if (provSel.size && !provSel.has(prov)) return false
    if (propSel.size && !propSel.has(r.properties?.id)) return false
    return true
  }

  if (err) return <div className="notice err">โหลดข้อมูลไม่สำเร็จ — {err}</div>
  if (!shiftsAll) return <p className="muted">กำลังโหลด…</p>

  const shifts = shiftsAll.filter(match)
  const att = attAll.filter(match)
  const total = shifts.length
  const checkedIn = shifts.filter((s) => s.status === 'checked_in').length
  const done = shifts.filter((s) => s.status === 'checked_out').length
  const waiting = shifts.filter((s) => s.status === 'scheduled').length
  const late = att.filter((a) => a.late_minutes > 0).length
  const flagged = att.filter((a) => a.is_mock_flag).length

  return (
    <div>
      {(provinces.length > 1 || propOptions.length > 1) && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 18 }}>
          <FilterChips label="จังหวัด" options={provinces} selected={provSel} onChange={setProvSel} />
          <FilterChips label="โครงการ" options={propOptions} selected={propSel} onChange={setPropSel} />
        </div>
      )}
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
