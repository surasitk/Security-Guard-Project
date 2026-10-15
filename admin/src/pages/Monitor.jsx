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
  const [tpls, setTpls] = useState({})
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
          setAudit(await list(`audit_logs?select=id,action,target_table,target_id,after,created_at,actor_user_id&created_at=gte.${since}&order=created_at.desc&limit=500`))
          setTpls(Object.fromEntries((await list('shift_templates?select=id,name,properties(name)').catch(() => [])).map((t) => [t.id, t])))
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
      <div className="filters">
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
          <div className="section-h"><h2>การแก้ไขระบบ 7 วันล่าสุด</h2><span className="muted">จัดกลุ่มตามผู้ทำ · กดเพื่อดูรายละเอียด</span></div>
          <AuditByActor audit={audit} users={users} tpls={tpls} />
        </>
      )}
    </div>
  )
}

// ── การแก้ไขระบบ: กลุ่มตามผู้ทำ → กดขยายดูแต่ละรายการ ──
const ACTION_TH = {
  generate_assignments: 'จ่ายกะ', create_user: 'เพิ่มผู้ใช้', update_user: 'แก้ไขผู้ใช้',
  line_account_bound: 'ผูกบัญชี LINE', create_vendor: 'สร้างบริษัท', update_vendor: 'แก้ไขบริษัท',
  admin_close_assignment: 'ปิดกะ (ลืมเช็คเอาต์)', create_checkpoint: 'สร้างจุดตรวจ', save_property: 'บันทึกโครงการ',
}
const ROLE_TH = { owner: 'เจ้าของ', admin: 'แอดมิน', supervisor: 'สายตรวจ', assistant_supervisor: 'ผู้ช่วยสายตรวจ', shift_leader: 'หัวหน้ากะ', guard: 'ยาม', client: 'ลูกค้า' }
const dmy = (d) => d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : ''

function describe(a, users, tpls) {
  const x = a.after || {}
  const who = (id) => users[id]?.full_name || 'ผู้ใช้ที่ถูกลบ'
  switch (a.action) {
    case 'generate_assignments': {
      const t = tpls[x.template_id]
      const range = x.from === x.to ? dmy(x.from) : `${dmy(x.from)} – ${dmy(x.to)}`
      return `ให้ ${who(x.user_id)} · ${t ? `${t.properties?.name || ''} ${t.name}` : 'แม่แบบกะ'} · ${range} · สร้าง ${x.created ?? 0} กะ${x.skipped_overlap ? ` (ข้าม ${x.skipped_overlap} กะที่ซ้อน)` : ''}`
    }
    case 'create_user': case 'update_user':
      return `${who(a.target_id)} · ${ROLE_TH[x.role] || x.role || ''}${x.properties?.length ? ` · ${x.properties.length} โครงการ` : ''}${x.platform_admin ? ' · Super Admin' : ''}`
    case 'line_account_bound': return 'ผูกบัญชี LINE กับข้อมูลพนักงาน'
    case 'create_vendor': return `${x.company || ''}${x.owner_code ? ` · owner ${x.owner_code}` : ''}`
    case 'admin_close_assignment': return x.note ? `หมายเหตุ: ${x.note}` : 'ปิดกะแทนพนักงาน'
    default: return a.target_table || ''
  }
}

function AuditByActor({ audit, users, tpls }) {
  const [open, setOpen] = useState(() => new Set())
  const groups = useMemo(() => {
    const m = new Map()
    for (const a of audit) {
      const k = a.actor_user_id || 'system'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(a)
    }
    return [...m.entries()].map(([actor, items]) => {
      const counts = {}
      for (const a of items) counts[a.action] = (counts[a.action] || 0) + 1
      return { actor, items, counts, last: items[0].created_at }
    }).sort((a, b) => b.last.localeCompare(a.last))
  }, [audit])
  const toggle = (k) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })

  return (
    <div className="audit">
      {groups.map((g) => {
        const isOpen = open.has(g.actor)
        const name = g.actor === 'system' ? 'ระบบ' : (users[g.actor]?.full_name || 'ผู้ใช้ที่ถูกลบ')
        return (
          <div key={g.actor} className={`audit-group ${isOpen ? 'open' : ''}`}>
            <button className="audit-head" onClick={() => toggle(g.actor)} aria-expanded={isOpen}>
              <span className="av">{name.trim().charAt(0)}</span>
              <span className="who"><b>{name}</b><span className="muted">{g.items.length} รายการ · ล่าสุด {fmtDate(g.last)} {fmtTime(g.last)}</span></span>
              <span className="sum">
                {Object.entries(g.counts).sort((a, b) => b[1] - a[1]).map(([act, n]) => (
                  <span key={act} className="badge">{ACTION_TH[act] || act} ×{n}</span>
                ))}
              </span>
              <svg className="chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
            {isOpen && (
              <ul className="audit-items">
                {g.items.map((a) => (
                  <li key={a.id || a.created_at}>
                    <span className="t">{fmtDate(a.created_at)} {fmtTime(a.created_at)}</span>
                    <span className="act">{ACTION_TH[a.action] || a.action}</span>
                    <span className="d">{describe(a, users, tpls)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
