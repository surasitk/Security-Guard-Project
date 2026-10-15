// ภาพรวมวันนี้ — กะทั้งหมด / เข้าแล้ว / สาย / ยังไม่เข้า + รายการลงเวลาสด + filter จังหวัด/โครงการ
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, todayRangeBkk, fmtTime } from '../lib/api'
import FilterChips from '../components/FilterChips.jsx'

export default function Dashboard() {
  const [shiftsAll, setShifts] = useState(null)
  const [attAll, setAtt] = useState([])
  const [provSel, setProvSel] = useState(new Set())
  const [propSel, setPropSel] = useState(new Set())
  const [err, setErr] = useState('')
  const [stuck, setStuck] = useState([])
  const [reload, setReload] = useState(0)

  useEffect(() => {
    (async () => {
      try {
        const [start, end] = todayRangeBkk()
        const [s, a] = await Promise.all([
          list(`shift_assignments?select=id,starts_at,ends_at,status,kind,is_holiday_work,users!user_id(full_name,employee_code),properties(id,name,province)&starts_at=gte.${start}&starts_at=lt.${end}&status=neq.cancelled&order=starts_at`),
          list(`attendance?select=check_in_at,check_out_at,late_minutes,early_leave_minutes,early_reason,flag_reason,in_distance_m,is_mock_flag,users(full_name),properties(id,name,province)&check_in_at=gte.${start}&order=check_in_at.desc&limit=30`),
        ])
        setShifts(s); setAtt(a)
        const cutoff = new Date(Date.now() - 3600 * 1000).toISOString()
        setStuck(await list(`shift_assignments?select=id,starts_at,ends_at,kind,users!user_id(full_name,employee_code),properties(name)&status=eq.checked_in&ends_at=lt.${cutoff}&order=ends_at`).catch(() => []))
      } catch (e) { setErr(String(e.message || e)) }
    })()
  }, [reload])

  async function closeShift(x) {
    const note = window.prompt(`ปิดกะของ ${x.users?.full_name} (ลืมเช็คเอาต์)\nบันทึกหมายเหตุ (ไม่บังคับ):`, 'ลืมเช็คเอาต์')
    if (note === null) return
    try { const o = await rpc('admin_close_assignment', { p_assignment_id: x.id, p_note: note }); if (!o.ok) throw new Error(o.error); setReload((n) => n + 1) }
    catch (e) { setErr(String(e.message || e)) }
  }

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
  const now = Date.now()
  // สถานะที่คำนวณ ณ ตอนนี้ (ยังไม่มี cron มาตี absent จริงใน DB — คำนวณฝั่งจอไปก่อน)
  const derive = (s) => {
    if (s.status !== 'scheduled') return s.status
    if (now > new Date(s.ends_at).getTime()) return 'absent'       // เลยเวลาเลิกกะแล้วไม่เข้า = ขาด
    if (now >= new Date(s.starts_at).getTime()) return 'overdue'    // เลยเวลาเริ่มแล้วยังไม่เข้า
    return 'scheduled'
  }
  const total = shifts.length
  const checkedIn = shifts.filter((s) => s.status === 'checked_in').length
  const done = shifts.filter((s) => s.status === 'checked_out').length
  const absent = shifts.filter((s) => derive(s) === 'absent').length
  const waiting = shifts.filter((s) => ['scheduled', 'overdue'].includes(derive(s))).length
  const late = att.filter((a) => a.late_minutes > 0).length
  const flagged = att.filter((a) => a.is_mock_flag || a.flag_reason).length

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
        <div className="stat"><div className="n">{absent}</div><div className="l">ขาดงาน</div></div>
        <div className="stat"><div className="n">{late}</div><div className="l">เข้าสาย</div></div>
        <div className="stat"><div className="n">{flagged}</div><div className="l">ธงตรวจสอบ</div></div>
      </div>

      {stuck.length > 0 && (
        <>
          <div className="section-h"><h2>ลืมเช็คเอาต์ (เกิน 1 ชม. หลังจบกะ) · {stuck.length}</h2></div>
          <table className="grid">
            <thead><tr><th>พนักงาน</th><th>โครงการ</th><th>กะ</th><th></th></tr></thead>
            <tbody>
              {stuck.map((x) => (
                <tr key={x.id}>
                  <td>{x.users?.full_name} <span className="muted">({x.users?.employee_code})</span></td>
                  <td>{x.properties?.name}{x.kind !== 'scheduled' ? <span className="badge" style={{ marginLeft: 6 }}>{KIND[x.kind]}</span> : null}</td>
                  <td>{new Date(x.starts_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })} {fmtTime(x.starts_at)}–{fmtTime(x.ends_at)}</td>
                  <td><button className="badge solid" style={{ cursor: 'pointer', border: 'none', fontFamily: 'var(--font)' }} onClick={() => closeShift(x)}>ปิดกะ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="section-h"><h2>กะวันนี้</h2></div>
      {total === 0 ? <p className="muted">ยังไม่มีกะวันนี้ — สร้างจากแท็บ "ตารางกะ"</p> : (
        <table className="grid">
          <thead><tr><th>พนักงาน</th><th>โครงการ</th><th>เวลา</th><th>สถานะ</th></tr></thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>{s.users?.full_name} <span className="muted">({s.users?.employee_code})</span></td>
                <td>{s.properties?.name}{s.is_holiday_work ? ' · วันหยุด' : ''}{s.kind && s.kind !== 'scheduled' ? <span className="badge" style={{ marginLeft: 6 }}>{KIND[s.kind]}</span> : null}</td>
                <td>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</td>
                <td><Status s={derive(s)} /></td>
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
                <td>{fmtTime(a.check_out_at)}{a.early_leave_minutes > 0 && <span className="muted"> (ก่อนเวลา {a.early_leave_minutes} น.)</span>}</td>
                <td>
                  {a.early_reason && <div>เหตุผล: {a.early_reason}</div>}
                  {(a.is_mock_flag || a.flag_reason)
                    ? (a.flag_reason || 'mock_gps').split(',').map((f) => <span key={f} className="badge" style={{ marginRight: 4 }}>{FLAG[f] || f}</span>)
                    : (!a.early_reason && <span className="muted">ปกติ</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const KIND = { adhoc: 'เช็คอินโครงการ', emergency: 'ฉุกเฉิน' }
const FLAG = {
  no_gps: 'ไม่มีพิกัด', mock_gps_suspected: 'สงสัย GPS ปลอม', kiosk_wrong_property: 'เครื่องผิดโครงการ',
  emergency: 'เข้างานฉุกเฉิน', early_checkout: 'ออกก่อนเวลา', closed_by_admin: 'ผู้ดูแลปิดกะ', auto_closed_admin: 'ปิดโดยระบบ',
}

function Status({ s }) {
  const map = { scheduled: 'รอเข้างาน', overdue: 'เลยเวลาเริ่ม', checked_in: 'กำลังปฏิบัติงาน', checked_out: 'ออกงานแล้ว', absent: 'ขาดงาน' }
  return <span className={`badge ${s === 'checked_in' ? 'solid' : ''}`} style={s === 'absent' ? { fontWeight: 600 } : undefined}>{map[s] || s}</span>
}
