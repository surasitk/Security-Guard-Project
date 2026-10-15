// ตารางกะ — สร้างแม่แบบกะ + generate กะรายเดือนให้ยาม + ดูกะล่วงหน้า
import { useEffect, useState } from 'react'
import { list, insert, update, rpc, tenantId, fmtTime, fmtDate } from '../lib/api'

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

export default function Shifts() {
  const [templates, setTemplates] = useState([])
  const [guards, setGuards] = useState([])
  const [upcoming, setUpcoming] = useState(null)
  const [msg, setMsg] = useState(null)

  const [tForm, setTForm] = useState({ property_id: '', name: 'กะกลางวัน', start: '07:00', end: '19:00', cross: false, days: [0, 1, 2, 3, 4, 5, 6] })
  const [gForm, setGForm] = useState({ template_id: '', user_id: '', from: '', to: '' })
  const [properties, setProperties] = useState([])
  // จัดการกะที่กำลังจะถึง: กรอง + เลือกหลายแถว → ยกเลิก / เปลี่ยนคน
  const [fUser, setFUser] = useState('')
  const [fProp, setFProp] = useState('')
  const [sel, setSel] = useState(new Set())
  const [swapTo, setSwapTo] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [t, g, p, u] = await Promise.all([
        list('shift_templates?select=*,properties(name)&is_active=is.true&order=name'),
        list('users?select=id,full_name,employee_code&role=in.(guard,shift_leader)&is_active=is.true&order=full_name'),
        list('properties?select=id,name&is_active=is.true&order=name'),
        list(`shift_assignments?select=id,starts_at,ends_at,status,is_holiday_work,user_id,property_id,users!user_id(full_name),properties(name)&starts_at=gte.${new Date().toISOString()}&status=neq.cancelled&order=starts_at&limit=500`),
      ])
      setTemplates(t); setGuards(g); setProperties(p); setUpcoming(u); setSel(new Set())
    } catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }
  useEffect(() => { load() }, [])

  function overlaps(a1, a2, b1, b2) {
    // เทียบเวลาแบบสตริง HH:MM — พอสำหรับเตือนเบื้องต้น (กะข้ามเที่ยงคืนไม่นับ)
    return a1 < b2 && b1 < a2
  }

  async function addTemplate(e) {
    e.preventDefault(); setMsg(null)
    const dup = templates.find((t) => t.property_id === tForm.property_id
      && t.name.trim() === tForm.name.trim()
      && String(t.start_time).slice(0, 5) === tForm.start
      && String(t.end_time).slice(0, 5) === tForm.end)
    if (dup) { setMsg({ t: 'err', m: 'มีแม่แบบชื่อ/เวลานี้ในโครงการนี้อยู่แล้ว' }); return }
    const olap = templates.find((t) => t.property_id === tForm.property_id
      && !t.crosses_midnight && !tForm.cross
      && overlaps(tForm.start, tForm.end, String(t.start_time).slice(0, 5), String(t.end_time).slice(0, 5)))
    if (olap && !window.confirm(`เวลาเหลื่อมกับแม่แบบ "${olap.name}" (${String(olap.start_time).slice(0, 5)}-${String(olap.end_time).slice(0, 5)}) ในโครงการเดียวกัน\n\nถ้าเป็นคนละจุดประจำการ (เช่น ประตูหน้า/ลานจอด) กด OK เพื่อสร้างต่อ`)) return
    try {
      await insert('shift_templates', {
        tenant_id: tenantId(),
        property_id: tForm.property_id,
        name: tForm.name,
        start_time: tForm.start,
        end_time: tForm.end,
        crosses_midnight: tForm.cross,
        days_of_week: tForm.days,
      })
      setMsg({ t: 'ok', m: `สร้างแม่แบบ "${tForm.name}" แล้ว` })
      load()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) }
  }

  async function generate(e) {
    e.preventDefault(); setMsg(null)
    try {
      const out = await rpc('generate_assignments', {
        p_template_id: gForm.template_id,
        p_user_id: gForm.user_id,
        p_date_from: gForm.from,
        p_date_to: gForm.to,
      })
      if (out.ok) setMsg({ t: 'ok', m: `สร้างกะแล้ว ${out.created} กะ${out.skipped_overlap ? ` (ข้าม ${out.skipped_overlap} กะที่ซ้อน)` : ''}` })
      else setMsg({ t: 'err', m: out.error })
      load()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) }
  }

  const shown = (upcoming || []).filter((s) => (!fUser || s.user_id === fUser) && (!fProp || s.property_id === fProp))
  const selectable = shown.filter((s) => s.status === 'scheduled')
  const allOn = selectable.length > 0 && selectable.every((s) => sel.has(s.id))
  function toggleRow(id) { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n) }
  function toggleAll() { setSel(allOn ? new Set() : new Set(selectable.map((s) => s.id))) }
  const people = [...new Map((upcoming || []).map((s) => [s.user_id, s.users?.full_name])).entries()]
  const places = [...new Map((upcoming || []).map((s) => [s.property_id, s.properties?.name])).entries()]

  async function cancelSelected() {
    const ids = [...sel]
    if (!window.confirm(`ยกเลิก ${ids.length} กะที่เลือก? (กะจะหายจากตารางและแอปยาม แต่ยังเก็บประวัติไว้)`)) return
    setBusy(true); setMsg(null)
    try {
      await update('shift_assignments', `id=in.(${ids.join(',')})&status=eq.scheduled`, { status: 'cancelled' })
      setMsg({ t: 'ok', m: `ยกเลิกแล้ว ${ids.length} กะ` })
      load()
    } catch (e) { setMsg({ t: 'err', m: String(e.message) }) } finally { setBusy(false) }
  }

  async function swapSelected() {
    const ids = [...sel]
    const who = guards.find((g) => g.id === swapTo)
    if (!who || !window.confirm(`เปลี่ยน ${ids.length} กะที่เลือกให้ ${who.full_name} รับแทน?`)) return
    setBusy(true); setMsg(null)
    const res = await Promise.allSettled(ids.map((id) =>
      update('shift_assignments', `id=eq.${id}&status=eq.scheduled`, { user_id: swapTo })))
    const fail = res.filter((r) => r.status === 'rejected').length
    setMsg(fail
      ? { t: 'err', m: `เปลี่ยนสำเร็จ ${ids.length - fail} กะ · ไม่สำเร็จ ${fail} กะ (มักเพราะ ${who.full_name} มีกะเวลาเดียวกันอยู่แล้ว)` }
      : { t: 'ok', m: `เปลี่ยนให้ ${who.full_name} แล้ว ${ids.length} กะ` })
    setBusy(false); setSwapTo(''); load()
  }

  function toggleDay(i) {
    setTForm((f) => ({ ...f, days: f.days.includes(i) ? f.days.filter((d) => d !== i) : [...f.days, i].sort() }))
  }

  return (
    <div>
      <div className="section-h"><h2>1) แม่แบบกะ (ต่อโครงการ)</h2></div>
      <form className="card" onSubmit={addTemplate}>
        <div className="form-grid">
          <div className="field"><label>โครงการ *</label>
            <select value={tForm.property_id} onChange={(e) => setTForm({ ...tForm, property_id: e.target.value })} required>
              <option value="">— เลือก —</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field"><label>ชื่อกะ</label><input value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} /></div>
          <div className="field"><label>เริ่ม</label><input type="time" value={tForm.start} onChange={(e) => setTForm({ ...tForm, start: e.target.value })} /></div>
          <div className="field"><label>เลิก</label><input type="time" value={tForm.end} onChange={(e) => setTForm({ ...tForm, end: e.target.value })} /></div>
          <div className="field"><label>ข้ามเที่ยงคืน</label>
            <select value={tForm.cross ? '1' : '0'} onChange={(e) => setTForm({ ...tForm, cross: e.target.value === '1' })}>
              <option value="0">ไม่ข้าม</option><option value="1">ข้าม (กะดึก)</option>
            </select>
          </div>
          <div className="field"><label>วันที่มีกะ</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DOW.map((d, i) => (
                <button type="button" key={i} onClick={() => toggleDay(i)}
                  className={`badge ${tForm.days.includes(i) ? 'solid' : ''}`} style={{ cursor: 'pointer', fontFamily: 'var(--font)' }}>{d}</button>
              ))}
            </div>
          </div>
          <button className="btn inline" type="submit">สร้างแม่แบบ</button>
        </div>
      </form>

      {templates.length > 0 && (
        <table className="grid" style={{ marginTop: 14 }}>
          <thead><tr><th>โครงการ</th><th>ชื่อกะ</th><th>เวลา</th><th>วันที่มีกะ</th><th></th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.properties?.name}</td>
                <td>{t.name}{t.crosses_midnight ? ' · ข้ามคืน' : ''}</td>
                <td>{String(t.start_time).slice(0, 5)}–{String(t.end_time).slice(0, 5)}</td>
                <td>{(t.days_of_week || []).length === 7 ? 'ทุกวัน' : (t.days_of_week || []).map((d) => DOW[d]).join(' ')}</td>
                <td>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }}
                    onClick={async () => {
                      if (!window.confirm(`ปิดใช้แม่แบบ "${t.name}"? (กะที่สร้างไปแล้วไม่หาย)`)) return
                      try { await update('shift_templates', `id=eq.${t.id}`, { is_active: false }); load() }
                      catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
                    }}>ปิดใช้</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-h"><h2>2) จ่ายกะให้พนักงาน</h2></div>
      <form className="card" onSubmit={generate}>
        <div className="form-grid">
          <div className="field"><label>แม่แบบกะ *</label>
            <select value={gForm.template_id} onChange={(e) => setGForm({ ...gForm, template_id: e.target.value })} required>
              <option value="">— เลือก —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.properties?.name} · {t.name} ({String(t.start_time).slice(0, 5)}-{String(t.end_time).slice(0, 5)})</option>)}
            </select>
          </div>
          <div className="field"><label>พนักงาน *</label>
            <select value={gForm.user_id} onChange={(e) => setGForm({ ...gForm, user_id: e.target.value })} required>
              <option value="">— เลือก —</option>
              {guards.map((g) => <option key={g.id} value={g.id}>{g.full_name} ({g.employee_code})</option>)}
            </select>
          </div>
          <div className="field"><label>ตั้งแต่วันที่ *</label><input type="date" value={gForm.from} onChange={(e) => setGForm({ ...gForm, from: e.target.value })} required /></div>
          <div className="field"><label>ถึงวันที่ *</label><input type="date" value={gForm.to} onChange={(e) => setGForm({ ...gForm, to: e.target.value })} required /></div>
          <button className="btn inline" type="submit">สร้างกะ</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>ระบบกันกะซ้อนอัตโนมัติ และติ๊กกะวันหยุด (OT 2.5x) จากวันหยุดบริษัท + วันหยุดประจำสัปดาห์ของพนักงาน</p>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>กะที่กำลังจะถึง {upcoming ? `(${shown.length})` : ''}</h2></div>
      {upcoming && upcoming.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <div className="field"><label>กรองพนักงาน</label>
              <select value={fUser} onChange={(e) => { setFUser(e.target.value); setSel(new Set()) }}>
                <option value="">ทุกคน</option>{people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </div>
            <div className="field"><label>กรองโครงการ</label>
              <select value={fProp} onChange={(e) => { setFProp(e.target.value); setSel(new Set()) }}>
                <option value="">ทุกโครงการ</option>{places.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </div>
          </div>
          {sel.size > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <strong style={{ alignSelf: 'center' }}>เลือก {sel.size} กะ</strong>
              <button className="btn inline" onClick={cancelSelected} disabled={busy}>ยกเลิกกะที่เลือก</button>
              <div className="field" style={{ margin: 0, minWidth: 220 }}>
                <label>หรือเปลี่ยนให้คนอื่นรับแทน</label>
                <select value={swapTo} onChange={(e) => setSwapTo(e.target.value)}>
                  <option value="">— เลือกพนักงาน —</option>
                  {guards.map((g) => <option key={g.id} value={g.id}>{g.full_name} ({g.employee_code})</option>)}
                </select>
              </div>
              <button className="btn inline ghost" onClick={swapSelected} disabled={busy || !swapTo}>เปลี่ยนคน</button>
              <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none', alignSelf: 'center' }} onClick={() => setSel(new Set())}>ล้างที่เลือก</button>
            </div>
          )}
        </div>
      )}
      {!upcoming ? <p className="muted">กำลังโหลด…</p> : shown.length === 0 ? <p className="muted">ยังไม่มีกะล่วงหน้า</p> : (
        <table className="grid">
          <thead><tr>
            <th style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={toggleAll} title="เลือกทั้งหมดที่แสดง" /></th>
            <th>วันที่</th><th>พนักงาน</th><th>โครงการ</th><th>เวลา</th><th>สถานะ</th>
          </tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} style={sel.has(s.id) ? { background: 'var(--paper)' } : undefined}>
                <td><input type="checkbox" checked={sel.has(s.id)} disabled={s.status !== 'scheduled'} onChange={() => toggleRow(s.id)} /></td>
                <td>{fmtDate(s.starts_at)}{s.is_holiday_work ? ' · วันหยุด' : ''}</td>
                <td>{s.users?.full_name}</td>
                <td>{s.properties?.name}</td>
                <td>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</td>
                <td><span className="badge">{s.status === 'scheduled' ? 'รอถึงกะ' : s.status === 'checked_in' ? 'กำลังปฏิบัติงาน' : s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
