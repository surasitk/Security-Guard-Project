// ภาพรวมวันนี้ — กะทั้งหมด / เข้าแล้ว / สาย / ยังไม่เข้า + รายการลงเวลาสด
// ค้นหาขั้นสูง (ชื่อ · จังหวัด · โครงการ · สถานะ) ใช้กับตัวเลขสรุปและทุกตาราง · ทุกตารางกดหัวคอลัมน์เพื่อเรียง (ไทย ก–ฮ ก่อน A–Z)
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, todayRangeBkk, fmtTime, errTh, listCached } from '../lib/api'
import { canEdit, seeMoney } from '../lib/perm'
import { useSort, byName, ResultLine } from '../lib/sortTable.jsx'
import { STATUS_TH, STATUS_TONE, KIND_TH, flagList, th } from '../lib/labels'
import { SkPage } from '../components/Skeleton.jsx'
const STATUS_RANK = { overdue: 0, absent: 1, scheduled: 2, checked_in: 3, checked_out: 4 }
const t = (ts) => (ts ? new Date(ts).getTime() : null)

export default function Dashboard() {
  const [shiftsAll, setShifts] = useState(null)
  const [attAll, setAtt] = useState([])
  const [props, setProps] = useState([])
  const F0 = { q: '', province: '', prop: '', status: '' }
  const [f, setF] = useState(F0)
  const [err, setErr] = useState('')
  const [stuck, setStuck] = useState([])
  const [reload, setReload] = useState(0)
  const [coverage, setCoverage] = useState([])      // โครงการแบบไม่จัดกะ: ช่วงกะตอนนี้ ต้องมีกี่คน อยู่เวรกี่คน

  useEffect(() => {
    (async () => {
      try {
        const [start, end] = todayRangeBkk()
        const [s, a] = await Promise.all([
          list(`shift_assignments?select=id,starts_at,ends_at,status,kind,is_holiday_work,users!user_id(full_name,employee_code),properties!inner(id,name,province,is_test)&properties.is_test=is.false&starts_at=gte.${start}&starts_at=lt.${end}&status=neq.cancelled&order=starts_at`),
          list(`attendance?select=check_in_at,check_out_at,late_minutes,early_leave_minutes,early_reason,flag_reason,in_distance_m,is_mock_flag,users(full_name,employee_code),properties!inner(id,name,province,is_test)&properties.is_test=is.false&check_in_at=gte.${start}&order=check_in_at.desc&limit=300`),
        ])
        setShifts(s); setAtt(a)
        listCached('properties?select=id,name,province&is_active=is.true&is_test=is.false').then(setProps).catch(() => {})
        setCoverage(await rpc('open_coverage').catch(() => []))
        const cutoff = new Date(Date.now() - 3600 * 1000).toISOString()
        setStuck(await list(`shift_assignments?select=id,starts_at,ends_at,kind,users!user_id(full_name,employee_code),properties(id,name,province)&status=eq.checked_in&ends_at=lt.${cutoff}&order=ends_at`).catch(() => []))
      } catch (e) { setErr(errTh(e)) }
    })()
  }, [reload])

  async function closeShift(x) {
    const note = window.prompt(`ปิดกะของ ${x.users?.full_name} (ลืมเช็คเอาต์)\nบันทึกหมายเหตุ (ไม่บังคับ):`, 'ลืมเช็คเอาต์')
    if (note === null) return
    try { const o = await rpc('admin_close_assignment', { p_assignment_id: x.id, p_note: note }); if (!o.ok) throw new Error(errTh(o.error)); setReload((n) => n + 1) }
    catch (e) { setErr(errTh(e)) }
  }

  // ── ค้นหาขั้นสูง ──
  const provOf = useMemo(() => Object.fromEntries(props.map((p) => [p.id, p.province || 'ไม่ระบุ'])), [props])
  const provinces = useMemo(() => [...new Set(props.map((p) => p.province || 'ไม่ระบุ'))].sort(byName), [props])
  const propOptions = useMemo(() => props.filter((p) => !f.province || (p.province || 'ไม่ระบุ') === f.province).sort((a, b) => byName(a.name, b.name)), [props, f.province])
  const setFv = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'province' ? { prop: '' } : {}) })
  const fActive = Object.values(f).some(Boolean)
  const q = f.q.trim().toLowerCase()
  // r: { pid, province, text }
  const pass = (pid, province, text) => {
    if (f.province && (province || provOf[pid] || 'ไม่ระบุ') !== f.province) return false
    if (f.prop && pid !== f.prop) return false
    if (q && !String(text || '').toLowerCase().includes(q)) return false
    return true
  }
  const match = (r) => pass(r.properties?.id, r.properties?.province, `${r.users?.full_name} ${r.users?.employee_code} ${r.properties?.name}`)
  const now = Date.now()
  // สถานะที่คำนวณ ณ ตอนนี้ (ยังไม่มี cron มาตี absent จริงใน DB — คำนวณฝั่งจอไปก่อน)
  const derive = (s) => {
    if (s.status !== 'scheduled') return s.status
    if (now > new Date(s.ends_at).getTime()) return 'absent'       // เลยเวลาเลิกกะแล้วไม่เข้า = ขาด
    if (now >= new Date(s.starts_at).getTime()) return 'overdue'    // เลยเวลาเริ่มแล้วยังไม่เข้า
    return 'scheduled'
  }
  const shifts = useMemo(() => (shiftsAll || []).filter(match), [shiftsAll, f, provOf])
  const shiftRows = useMemo(() => shifts.filter((s) => !f.status || derive(s) === f.status), [shifts, f.status])
  const att = useMemo(() => attAll.filter(match), [attAll, f, provOf])
  const cov = useMemo(() => coverage.filter((c) => pass(c.property_id, null, `${c.property_name} ${c.slot_name}`)), [coverage, f, provOf])
  const stuckF = useMemo(() => stuck.filter(match), [stuck, f, provOf])

  const covSort = useSort(cov, useMemo(() => ({
    name: (c) => c.property_name, slot: (c) => [t(c.slot_start), c.property_name],
    duty: (c) => [c.on_duty / Math.max(1, c.headcount), c.property_name],
    status: (c) => [c.short ? 0 : c.on_duty >= c.headcount ? 2 : 1, c.property_name],
  }), []), { key: 'status', dir: 'asc' })
  const stuckSort = useSort(stuckF, useMemo(() => ({
    who: (x) => x.users?.full_name, prop: (x) => x.properties?.name, time: (x) => t(x.ends_at),
  }), []), { key: 'time', dir: 'asc' })
  const shiftSort = useSort(shiftRows, useMemo(() => ({
    who: (s) => s.users?.full_name, prop: (s) => [s.properties?.name, t(s.starts_at)],
    time: (s) => [t(s.starts_at), s.properties?.name], status: (s) => [STATUS_RANK[derive(s)] ?? 9, t(s.starts_at)],
  }), [shiftsAll]), { key: 'time', dir: 'asc' })
  const attSort = useSort(att, useMemo(() => ({
    who: (a) => a.users?.full_name, prop: (a) => a.properties?.name, in: (a) => t(a.check_in_at), out: (a) => t(a.check_out_at),
    note: (a) => [(a.is_mock_flag || a.flag_reason || a.early_reason) ? 0 : 1, -t(a.check_in_at)],
  }), []), { key: 'in', dir: 'desc' })

  if (err) return <div className="notice err">โหลดข้อมูลไม่สำเร็จ — {err}</div>
  if (!shiftsAll) return <SkPage stats={4} rows={6} cols={4} />

  const total = shifts.length
  const checkedIn = shifts.filter((s) => s.status === 'checked_in').length
  const done = shifts.filter((s) => s.status === 'checked_out').length
  const absent = shifts.filter((s) => derive(s) === 'absent').length
  const overdue = shifts.filter((s) => derive(s) === 'overdue').length
  const waitOnTime = shifts.filter((s) => derive(s) === 'scheduled').length
  const late = att.filter((a) => a.late_minutes > 0).length
  const flagged = att.filter((a) => a.is_mock_flag || a.flag_reason).length

  return (
    <div>
      <div className="filters sh-filters">
        <div className="field grow"><label>ค้นหา</label><input value={f.q} onChange={setFv('q')} placeholder="ชื่อพนักงาน รหัส หรือชื่อโครงการ" /></div>
        <div className="field"><label>จังหวัด</label>
          <select value={f.province} onChange={setFv('province')}><option value="">ทั้งหมด</option>{provinces.map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <div className="field"><label>โครงการ</label>
          <select value={f.prop} onChange={setFv('prop')}><option value="">ทั้งหมด</option>{propOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div className="field"><label>สถานะกะ</label>
          <select value={f.status} onChange={setFv('status')}>
            <option value="">ทั้งหมด</option><option value="checked_in">กำลังปฏิบัติงาน</option><option value="overdue">เลยเวลาเริ่ม</option>
            <option value="scheduled">รอเข้างาน</option><option value="absent">ขาดงาน</option><option value="checked_out">ออกงานแล้ว</option>
          </select>
        </div>
        {fActive && <div className="sh-actions"><button className="link-btn" onClick={() => setF(F0)}>ล้างตัวกรอง</button></div>}
      </div>
      <section className="board" aria-label="สถานะเวรวันนี้">
        <div className="board-top">
          <div className="big">{checkedIn}<small>คนกำลังปฏิบัติงาน จากกะวันนี้ {total} กะ</small></div>
          <span className="muted">อัปเดต {fmtTime(new Date().toISOString())} น.</span>
        </div>
        {total > 0 && (
          <div className="dutybar" role="img" aria-label={`ปฏิบัติงาน ${checkedIn} · ออกแล้ว ${done} · รอเข้า ${waitOnTime} · เลยเวลาเริ่ม ${overdue} · ขาด ${absent}`}>
            <span className="on" style={{ width: `${checkedIn / total * 100}%` }} />
            <span className="done" style={{ width: `${done / total * 100}%` }} />
            <span className="late" style={{ width: `${overdue / total * 100}%` }} />
            <span className="wait" style={{ width: `${waitOnTime / total * 100}%` }} />
            <span className="absent" style={{ width: `${absent / total * 100}%` }} />
          </div>
        )}
        <div className="legend">
          <span><i style={{ background: 'var(--duty)' }} />กำลังปฏิบัติงาน<b>{checkedIn}</b></span>
          <span><i style={{ background: 'var(--ink)' }} />ออกงานแล้ว<b>{done}</b></span>
          <span><i style={{ background: 'var(--warn)' }} />เลยเวลาเริ่ม<b>{overdue}</b></span>
          <span><i style={{ background: '#b9bfc4' }} />รอเข้างาน<b>{waitOnTime}</b></span>
          <span><i style={{ background: 'var(--alert)' }} />ขาดงาน<b>{absent}</b></span>
        </div>
      </section>
      <div className="stat-row">
        <div className={`stat ${late ? 'warn' : ''}`}><div className="n">{late}</div><div className="l">เข้าสายวันนี้</div></div>
        <div className={`stat ${flagged ? 'warn' : ''}`}><div className="n">{flagged}</div><div className="l">รายการติดธงตรวจสอบ</div></div>
        <div className={`stat ${stuckF.length ? 'alert' : ''}`}><div className="n">{stuckF.length}</div><div className="l">ลืมเช็คเอาต์ รอปิดกะ</div></div>
        {coverage.length > 0 && (
          <div className={`stat ${cov.some((c) => c.short) ? 'alert' : ''}`}><div className="n">{cov.filter((c) => c.short).length}</div><div className="l">จุดที่คนไม่ครบตอนนี้</div></div>
        )}
      </div>

      {coverage.length > 0 && (
        <>
          <div className="section-h"><h2>โครงการแบบไม่จัดกะ · ช่วงกะตอนนี้</h2></div>
          <ResultLine shown={cov.length} total={coverage.length} unit="ช่วงกะ" active={fActive} onClear={() => setF(F0)} note={`ขาดคน ${cov.filter((c) => c.short).length} จุด · กดหัวคอลัมน์เพื่อเรียง`} />
          {cov.length > 0 && (
            <div className="table-wrap">
              <table className="grid">
                <thead><tr>{covSort.th('name', 'โครงการ')}{covSort.th('slot', 'ช่วงกะ')}{covSort.th('duty', 'อยู่เวร / ต้องมี')}{covSort.th('status', 'สถานะ')}</tr></thead>
                <tbody>
                  {covSort.sorted.map((c) => (
                    <tr key={`${c.property_id}-${c.slot_start}`}>
                      <td>{c.property_name}</td>
                      <td>{c.slot_name} · {fmtTime(c.slot_start)}–{fmtTime(c.slot_end)}</td>
                      <td><b>{c.on_duty}</b> / {c.headcount} คน</td>
                      <td>{c.short ? <span className="badge alert">ขาด {c.headcount - c.on_duty} คน</span>
                        : c.on_duty >= c.headcount ? <span className="badge duty">ครบ</span>
                        : <span className="badge warn">รอเข้างาน</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {stuckF.length > 0 && (
        <>
          <div className="section-h"><h2>ลืมเช็คเอาต์ (เกิน 1 ชม. หลังจบกะ) · {stuckF.length}</h2></div>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr>{stuckSort.th('who', 'พนักงาน')}{stuckSort.th('prop', 'โครงการ')}{stuckSort.th('time', 'กะ')}{canEdit() && <th></th>}</tr></thead>
              <tbody>
                {stuckSort.sorted.map((x) => (
                  <tr key={x.id}>
                    <td>{x.users?.full_name} <span className="muted">({x.users?.employee_code})</span></td>
                    <td>{x.properties?.name}{x.kind !== 'scheduled' ? <span className="badge" style={{ marginLeft: 6 }}>{KIND[x.kind]}</span> : null}</td>
                    <td>{new Date(x.starts_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })} {fmtTime(x.starts_at)}–{fmtTime(x.ends_at)}</td>
                    {canEdit() && <td className="row-act"><button className="badge solid" style={{ border: 'none' }} onClick={() => closeShift(x)}>ปิดกะ</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-h"><h2>กะวันนี้</h2></div>
      {total === 0 ? <p className="muted">{fActive ? 'ไม่พบกะตามตัวกรอง' : 'ยังไม่มีกะวันนี้ — สร้างจากแท็บ "ตารางกะ"'}</p> : (
        <>
          <ResultLine shown={shiftRows.length} total={shiftsAll.length} unit="กะ" active={fActive} onClear={() => setF(F0)} note="กดหัวคอลัมน์เพื่อเรียง" />
          {shiftRows.length > 0 && (
            <div className="table-wrap">
              <table className="grid">
                <thead><tr>{shiftSort.th('who', 'พนักงาน')}{shiftSort.th('prop', 'โครงการ')}{shiftSort.th('time', 'เวลา')}{shiftSort.th('status', 'สถานะ')}</tr></thead>
                <tbody>
                  {shiftSort.sorted.map((s) => (
                    <tr key={s.id}>
                      <td>{s.users?.full_name} <span className="muted">({s.users?.employee_code})</span></td>
                      <td>{s.properties?.name}{s.is_holiday_work ? ' · วันหยุด' : ''}{s.kind && s.kind !== 'scheduled' ? <span className="badge warn" style={{ marginLeft: 6 }}>{KIND[s.kind]}</span> : null}</td>
                      <td>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</td>
                      <td><Status s={derive(s)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="section-h"><h2>การลงเวลาวันนี้</h2></div>
      {att.length === 0 ? <p className="muted">{fActive && attAll.length ? 'ไม่พบการลงเวลาตามตัวกรอง' : 'ยังไม่มีการลงเวลาวันนี้'}</p> : (
        <>
          <ResultLine shown={att.length} total={attAll.length} unit="รายการ" active={fActive} onClear={() => setF(F0)} note="ล่าสุดอยู่บน · กดหัวคอลัมน์เพื่อเรียง" />
          <div className="table-wrap">
            <table className="grid">
              <thead><tr>{attSort.th('who', 'พนักงาน')}{attSort.th('prop', 'โครงการ')}{attSort.th('in', 'เข้า')}{attSort.th('out', 'ออก')}{attSort.th('note', 'หมายเหตุ')}</tr></thead>
              <tbody>
                {attSort.sorted.map((a, i) => (
                  <tr key={i}>
                    <td>{a.users?.full_name}</td>
                    <td>{a.properties?.name}</td>
                    <td>{fmtTime(a.check_in_at)}{a.late_minutes > 0 && <span className="muted"> (สาย {a.late_minutes} น.)</span>}</td>
                    <td>{fmtTime(a.check_out_at)}{a.early_leave_minutes > 0 && <span className="muted"> (ก่อนเวลา {a.early_leave_minutes} น.)</span>}</td>
                    <td>
                      {a.early_reason && <div>เหตุผล: {a.early_reason}</div>}
                      {(a.is_mock_flag || a.flag_reason)
                        ? flagList(a.flag_reason, a.is_mock_flag).map((fl) => <span key={fl.code} className={`badge ${fl.tone}`} style={{ marginRight: 4 }}>{fl.label}</span>)
                        : (!a.early_reason && <span className="muted">ปกติ</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const KIND = KIND_TH

function Status({ s }) {
  return <span className={`badge ${STATUS_TONE[s] || ''}`}>{th(STATUS_TH, s, 'ไม่ทราบสถานะ')}</span>
}
