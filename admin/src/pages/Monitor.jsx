// Monitoring — log เหตุการณ์ทั้งหมด (เข้า/ออกงาน + พิกัด + รูป + ธงผิดปกติ + การแก้ไขระบบ)
// filter จังหวัด/โครงการแบบ multi-select · Sprint 2 จะเพิ่ม patrol scans + incidents เข้า log เดียวกัน
import { useEffect, useMemo, useState } from 'react'
import { list, signedUrl, fmtTime, fmtDate } from '../lib/api'
import FilterChips from '../components/FilterChips.jsx'

const DAYS_BACK = 7

export default function Monitor() {
  const [rows, setRows] = useState(null)
  const [users, setUsers] = useState({})
  const [props, setProps] = useState({})
  const [audit, setAudit] = useState([])
  const [provSel, setProvSel] = useState(new Set())
  const [propSel, setPropSel] = useState(new Set())
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const since = new Date(Date.now() - DAYS_BACK * 24 * 3600 * 1000).toISOString()
        const [logs, us, ps] = await Promise.all([
          list(`v_attendance_log?check_in_at=gte.${since}&order=check_in_at.desc&limit=200`),
          list('users?select=id,full_name,employee_code'),
          list('properties?select=id,name,province'),
        ])
        setRows(logs)
        setUsers(Object.fromEntries(us.map((u) => [u.id, u])))
        setProps(Object.fromEntries(ps.map((p) => [p.id, p])))
        try {
          setAudit(await list('audit_logs?select=action,target_table,created_at,actor_user_id&order=created_at.desc&limit=30'))
        } catch { /* supervisor มองไม่เห็น audit — ข้าม */ }
      } catch (e) { setErr(String(e.message || e)) }
    })()
  }, [])

  // แปลง attendance → รายการเหตุการณ์ (เข้า/ออก แยกบรรทัด) เรียงเวลาใหม่→เก่า
  const events = useMemo(() => {
    if (!rows) return []
    const ev = []
    for (const r of rows) {
      const p = props[r.property_id]
      const base = { user: users[r.user_id], prop: p, row: r }
      if (r.check_in_at) ev.push({ ...base, type: 'in', at: r.check_in_at, lat: r.in_lat, lng: r.in_lng, selfie: r.in_selfie_url, dist: r.in_distance_m })
      if (r.check_out_at) ev.push({ ...base, type: 'out', at: r.check_out_at, lat: r.out_lat, lng: r.out_lng, selfie: r.out_selfie_url, dist: r.out_distance_m })
    }
    return ev.sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [rows, users, props])

  const provinces = useMemo(() => {
    const s = [...new Set(Object.values(props).map((p) => p.province || 'ไม่ระบุ'))]
    return s.sort().map((v) => ({ value: v, label: v }))
  }, [props])
  const propOptions = useMemo(
    () => Object.values(props).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name })),
    [props],
  )

  const filtered = events.filter((e) => {
    const prov = e.prop?.province || 'ไม่ระบุ'
    if (provSel.size && !provSel.has(prov)) return false
    if (propSel.size && !propSel.has(e.prop?.id)) return false
    return true
  })

  async function openSelfie(path) {
    try { window.open(await signedUrl(path), '_blank') }
    catch { alert('เปิดรูปไม่สำเร็จ') }
  }

  if (err) return <div className="notice err">โหลดข้อมูลไม่สำเร็จ — {err}</div>
  if (!rows) return <p className="muted">กำลังโหลด…</p>

  return (
    <div>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 18 }}>
        <FilterChips label="จังหวัด" options={provinces} selected={provSel} onChange={setProvSel} />
        <FilterChips label="โครงการ" options={propOptions} selected={propSel} onChange={setPropSel} />
      </div>

      <div className="section-h"><h2>เหตุการณ์ {DAYS_BACK} วันล่าสุด ({filtered.length})</h2></div>
      {filtered.length === 0 ? <p className="muted">ไม่มีเหตุการณ์ตามเงื่อนไขที่เลือก</p> : (
        <table className="grid">
          <thead><tr><th>เวลา</th><th>เหตุการณ์</th><th>พนักงาน</th><th>โครงการ</th><th>พิกัด</th><th>รูป</th><th>หมายเหตุ</th></tr></thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.at)} {fmtTime(e.at)}</td>
                <td><span className={`badge ${e.type === 'in' ? 'solid' : ''}`}>{e.type === 'in' ? 'เข้างาน' : 'ออกงาน'}</span></td>
                <td>{e.user?.full_name || '—'}</td>
                <td>{e.prop?.name || '—'}{e.prop?.province ? ` · ${e.prop.province}` : ''}</td>
                <td>
                  {e.lat != null ? (
                    <a href={`https://maps.google.com/?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>
                      แผนที่{e.dist > 0 ? ` (${Math.round(e.dist)} ม.)` : ''}
                    </a>
                  ) : '—'}
                </td>
                <td>{e.selfie ? <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => openSelfie(e.selfie)}>ดูรูป</button> : '—'}</td>
                <td>
                  {e.type === 'in' && e.row.late_minutes > 0 && <span className="muted">สาย {e.row.late_minutes} น. </span>}
                  {e.type === 'out' && e.row.early_leave_minutes > 0 && <span className="muted">ออกก่อน {e.row.early_leave_minutes} น. </span>}
                  {e.row.is_mock_flag && <span className="badge">ตรวจสอบ GPS</span>}
                  {e.row.flag_reason && <span className="muted"> {e.row.flag_reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {audit.length > 0 && (
        <>
          <div className="section-h"><h2>การแก้ไขระบบล่าสุด</h2></div>
          <table className="grid">
            <thead><tr><th>เวลา</th><th>การกระทำ</th><th>ตาราง</th><th>โดย</th></tr></thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.created_at)} {fmtTime(a.created_at)}</td>
                  <td>{a.action}</td>
                  <td>{a.target_table || '—'}</td>
                  <td>{users[a.actor_user_id]?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
