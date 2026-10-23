// ตารางกะ — แบ่งเป็นแท็บ: แม่แบบกะ · จ่ายกะ · กะที่กำลังจะถึง · นำเข้าจาก Excel
// · เรียงโครงการ ก–ฮ แล้ว A–Z · ในโครงการเรียงกะตามเวลาเข้า เช้า → ดึก (กลางวันก่อนกลางคืน)
// · ค้นหาขั้นสูง: ข้อความ · จังหวัด · รูปแบบกะ · ช่วงกะ · เวลาเข้า (แม่แบบ) / พนักงาน · วันที่ · สถานะ (กะที่กำลังจะถึง)
import { useEffect, useMemo, useRef, useState } from 'react'
import { list, insert, update, rpc, tenantId, fmtTime, fmtDate, getUser, errTh } from '../lib/api'
import { buildTemplateFile, readWorkbook, toPayload, TPL_COLS, ASG_COLS } from '../lib/shiftImport'
import { STATUS_TH as STATUS_ALL, th } from '../lib/labels'

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const ROLE_TH = { guard: 'รปภ.', shift_leader: 'หัวหน้ากะ', spare: 'ตัวสแปร์', trainer: 'ครูฝึก', supervisor: 'สายตรวจ', assistant_supervisor: 'ผู้ช่วยสายตรวจ' }
const STATUS_TH = { ...STATUS_ALL, scheduled: 'รอถึงกะ' }

// ── เรียงลำดับ ──
const isThai = (s) => /^[฀-๿]/.test(String(s || '').trim())
const byName = (a, b) => (isThai(b) - isThai(a)) || String(a || '').localeCompare(String(b || ''), 'th', { sensitivity: 'base', numeric: true })
const hm = (t) => String(t || '').slice(0, 5)
const mins = (t) => { const [h, m] = hm(t).split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const dayKey = (t) => (mins(t) - 300 + 1440) % 1440          // วันเริ่มที่ 05:00 → กะเช้าก่อน กะดึกท้าย
const isNight = (start) => { const h = Math.floor(mins(start) / 60); return h < 5 || h >= 17 }
const bkkHM = (ts) => new Date(new Date(ts).getTime() + 7 * 3600 * 1000).toISOString().slice(11, 16)
const bkkDate = (ts) => new Date(new Date(ts).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const addDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
const daysLabel = (d) => (d || []).length === 7 ? 'ทุกวัน' : (d || []).map((x) => DOW[x]).join(' ')

export default function Shifts() {
  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [guards, setGuards] = useState([])
  const [people, setPeople] = useState([])
  const [properties, setProperties] = useState([])
  const [upcoming, setUpcoming] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = async () => {
    try {
      const [t, g, p, u, all] = await Promise.all([
        list('shift_templates?select=*,properties(name,code,province,is_test,shift_mode)&is_active=is.true'),
        list('users?select=id,full_name,employee_code,role&role=in.(guard,shift_leader)&is_active=is.true'),
        list('properties?select=id,name,code,province,is_test,shift_mode&is_active=is.true'),
        list(`shift_assignments?select=id,starts_at,ends_at,status,is_holiday_work,user_id,property_id,users!user_id(full_name,employee_code),properties(name,province)&starts_at=gte.${new Date().toISOString()}&status=neq.cancelled&order=starts_at&limit=2000`),
        list('users?select=id,full_name,employee_code,role&role=not.in.(owner,admin,client)&is_active=is.true'),
      ])
      setTemplates(t); setGuards(g.sort((a, b) => byName(a.full_name, b.full_name)))
      setProperties(p.sort((a, b) => byName(a.name, b.name))); setUpcoming(u)
      setPeople(all.sort((a, b) => byName(a.full_name, b.full_name)))
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }) }
  }
  useEffect(() => { load() }, [])

  const tabs = [
    ['templates', `แม่แบบกะ (${templates.length})`],
    ['assign', 'จ่ายกะ'],
    ['upcoming', `กะที่กำลังจะถึง${upcoming ? ` (${upcoming.length})` : ''}`],
    ['import', 'นำเข้าจาก Excel'],
  ]

  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(null) }}>{l}</button>
        ))}
      </div>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}
      {tab === 'templates' && <TemplatesTab templates={templates} properties={properties} reload={load} setMsg={setMsg} />}
      {tab === 'assign' && <AssignTab templates={templates} guards={guards} reload={load} setMsg={setMsg} />}
      {tab === 'upcoming' && <UpcomingTab upcoming={upcoming} guards={guards} reload={load} setMsg={setMsg} />}
      {tab === 'import' && <ImportTab templates={templates} properties={properties} people={people} reload={load} setMsg={setMsg} onDone={() => setTab('upcoming')} />}
    </div>
  )
}

// ═══════════════════════════ แม่แบบกะ ═══════════════════════════
const EMPTY_T = { property_id: '', name: 'กะกลางวัน', start: '07:00', end: '19:00', cross: false, days: [0, 1, 2, 3, 4, 5, 6], headcount: 1 }

function TemplatesTab({ templates, properties, reload, setMsg }) {
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [tForm, setTForm] = useState(EMPTY_T)
  const [applyFuture, setApplyFuture] = useState(true)
  const [f, setF] = useState({ q: '', province: '', mode: '', period: '', from: '', to: '' })
  const formRef = useRef(null)

  const provinces = useMemo(() => [...new Set(properties.map((p) => p.province).filter(Boolean))].sort(byName), [properties])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return templates.filter((t) => {
      const p = t.properties || {}
      if (q && !`${p.name} ${p.code} ${t.name}`.toLowerCase().includes(q)) return false
      if (f.province && p.province !== f.province) return false
      if (f.mode && (p.shift_mode === 'open' ? 'open' : 'scheduled') !== f.mode) return false
      if (f.period && (isNight(t.start_time) ? 'night' : 'day') !== f.period) return false
      if (f.from && mins(t.start_time) < mins(f.from)) return false
      if (f.to && mins(t.start_time) > mins(f.to)) return false
      return true
    })
  }, [templates, f])

  // จัดกลุ่มตามโครงการ: โครงการ ก–ฮ → A–Z · กะในโครงการ เช้า → ดึก
  const groups = useMemo(() => {
    const m = new Map()
    for (const t of filtered) {
      if (!m.has(t.property_id)) m.set(t.property_id, { p: t.properties || {}, items: [] })
      m.get(t.property_id).items.push(t)
    }
    return [...m.values()]
      .sort((a, b) => byName(a.p.name, b.p.name))
      .map((g) => ({ ...g, items: g.items.sort((a, b) => (dayKey(a.start_time) - dayKey(b.start_time)) || byName(a.name, b.name)) }))
  }, [filtered])

  function startNew() { setEditId(null); setTForm(EMPTY_T); setOpen(true); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 50) }
  function startEdit(t) {
    setMsg(null); setEditId(t.id); setApplyFuture(true); setOpen(true)
    setTForm({ property_id: t.property_id, name: t.name, start: hm(t.start_time), end: hm(t.end_time), cross: !!t.crosses_midnight, days: t.days_of_week || [], headcount: t.headcount || 1 })
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }
  function close() { setOpen(false); setEditId(null); setTForm(EMPTY_T) }
  const toggleDay = (i) => setTForm((x) => ({ ...x, days: x.days.includes(i) ? x.days.filter((d) => d !== i) : [...x.days, i].sort() }))
  // เวลาเลิก ≤ เวลาเริ่ม = ข้ามเที่ยงคืนอัตโนมัติ
  const setTime = (k, v) => setTForm((x) => { const n = { ...x, [k]: v }; n.cross = mins(n.end) <= mins(n.start); return n })

  async function save(e) {
    e.preventDefault(); setMsg(null)
    if (!tForm.days.length) { setMsg({ t: 'err', m: 'เลือกวันที่มีกะอย่างน้อย 1 วัน' }); return }
    if (editId) {
      const before = templates.find((t) => t.id === editId)
      try {
        await update('shift_templates', `id=eq.${editId}`, { name: tForm.name, start_time: tForm.start, end_time: tForm.end, crosses_midnight: tForm.cross, days_of_week: tForm.days, headcount: Number(tForm.headcount) || 1 })
        let moved = 0, failed = 0
        const changed = before && (hm(before.start_time) !== tForm.start || hm(before.end_time) !== tForm.end || !!before.crosses_midnight !== tForm.cross)
        if (applyFuture && changed) {
          const fut = await list(`shift_assignments?select=id,starts_at&template_id=eq.${editId}&status=eq.scheduled&starts_at=gte.${new Date().toISOString()}`)
          const res = await Promise.allSettled(fut.map((a) => {
            const d = bkkDate(a.starts_at)
            return update('shift_assignments', `id=eq.${a.id}&status=eq.scheduled`, { starts_at: `${d}T${tForm.start}:00+07:00`, ends_at: `${tForm.cross ? addDay(d) : d}T${tForm.end}:00+07:00` })
          }))
          moved = res.filter((r) => r.status === 'fulfilled').length; failed = res.length - moved
        }
        setMsg({ t: failed ? 'err' : 'ok', m: `บันทึกแม่แบบ "${tForm.name}" แล้ว${moved ? ` · ปรับเวลากะที่จ่ายไว้ ${moved} กะ` : ''}${failed ? ` · ปรับไม่สำเร็จ ${failed} กะ (ชนกับกะอื่นของคนเดิม)` : ''}` })
        close(); reload()
      } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }) }
      return
    }
    const dup = templates.find((t) => t.property_id === tForm.property_id && t.name.trim() === tForm.name.trim())
    if (dup) { setMsg({ t: 'err', m: `โครงการนี้มีกะชื่อ "${tForm.name}" อยู่แล้ว — ตั้งชื่อไม่ให้ซ้ำ (ไฟล์นำเข้าอ้างถึงกะด้วยชื่อ)` }); return }
    try {
      await insert('shift_templates', { tenant_id: tenantId(), property_id: tForm.property_id, name: tForm.name.trim(), start_time: tForm.start, end_time: tForm.end, crosses_midnight: tForm.cross, days_of_week: tForm.days, headcount: Number(tForm.headcount) || 1 })
      setMsg({ t: 'ok', m: `สร้างแม่แบบ "${tForm.name}" แล้ว` }); close(); reload()
    } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }) }
  }

  async function deactivate(t) {
    if (!window.confirm(`ปิดใช้แม่แบบ "${t.name}" ของ ${t.properties?.name}? (กะที่สร้างไปแล้วไม่หาย)`)) return
    try { await update('shift_templates', `id=eq.${t.id}`, { is_active: false }); reload() } catch (e) { setMsg({ t: 'err', m: errTh(e) }) }
  }

  const active = Object.values(f).some(Boolean)
  return (
    <div>
      <div className="filters sh-filters">
        <div className="field grow"><label>ค้นหา</label><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="ชื่อโครงการ รหัส หรือชื่อกะ" /></div>
        <div className="field"><label>จังหวัด</label>
          <select value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}><option value="">ทั้งหมด</option>{provinces.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <div className="field"><label>รูปแบบกะ</label>
          <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="">ทั้งหมด</option><option value="scheduled">จัดกะ</option><option value="open">ไม่จัดกะ</option></select>
        </div>
        <div className="field"><label>ช่วงกะ</label>
          <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}><option value="">ทั้งหมด</option><option value="day">กลางวัน (เข้า 05:00–16:59)</option><option value="night">กลางคืน (เข้า 17:00–04:59)</option></select>
        </div>
        <div className="field range"><label>เวลาเข้า (ช่วง)</label>
          <div className="time-range"><input type="time" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="เวลาเข้าตั้งแต่" /><span>–</span><input type="time" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="เวลาเข้าถึง" /></div>
        </div>
        <div className="sh-actions">
          {active && <button className="link-btn" onClick={() => setF({ q: '', province: '', mode: '', period: '', from: '', to: '' })}>ล้างตัวกรอง</button>}
          <button className="btn inline" onClick={startNew}>+ เพิ่มแม่แบบกะ</button>
        </div>
      </div>

      {open && (
        <form className="card sh-form" onSubmit={save} ref={formRef}>
          <div className="sh-form-h">
            <h3>{editId ? `แก้ไขแม่แบบ: ${templates.find((t) => t.id === editId)?.properties?.name} · ${templates.find((t) => t.id === editId)?.name}` : 'เพิ่มแม่แบบกะ'}</h3>
            <button type="button" className="link-btn" onClick={close}>ปิด</button>
          </div>
          <div className="form-grid">
            <div className="field"><label>โครงการ *</label>
              <select value={tForm.property_id} onChange={(e) => setTForm({ ...tForm, property_id: e.target.value })} required disabled={!!editId}>
                <option value="">— เลือก —</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.is_test ? '🧪 ' : ''}{p.name}{p.shift_mode === 'open' ? ' · ไม่จัดกะ' : ''}</option>)}
              </select>
            </div>
            <div className="field"><label>ชื่อกะ *</label><input value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} required /></div>
            <div className="field"><label>เวลาเข้า</label><input type="time" value={tForm.start} onChange={(e) => setTime('start', e.target.value)} required /></div>
            <div className="field"><label>เวลาออก {tForm.cross && <span className="badge warn" style={{ marginLeft: 4 }}>ข้ามเที่ยงคืน</span>}</label><input type="time" value={tForm.end} onChange={(e) => setTime('end', e.target.value)} required /></div>
            <div className="field"><label>จำนวนคนที่ต้องมี</label><input type="number" min="1" max="50" value={tForm.headcount} onChange={(e) => setTForm({ ...tForm, headcount: e.target.value })} /></div>
            <div className="field"><label>วันที่มีกะ</label>
              <div className="dow-pick">
                {DOW.map((d, i) => <button type="button" key={i} onClick={() => toggleDay(i)} className={tForm.days.includes(i) ? 'on' : ''} aria-pressed={tForm.days.includes(i)}>{d}</button>)}
              </div>
            </div>
          </div>
          {editId && (
            <label className="sh-check">
              <input type="checkbox" checked={applyFuture} onChange={(e) => setApplyFuture(e.target.checked)} />
              ปรับเวลาของกะที่จ่ายไปแล้ว (ตั้งแต่วันนี้ และยังไม่เข้างาน) ให้ตรงกับเวลาใหม่ด้วย
            </label>
          )}
          <div className="actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn inline ghost" onClick={close}>ยกเลิก</button>
            <button className="btn inline" type="submit">{editId ? 'บันทึกการแก้ไข' : 'สร้างแม่แบบ'}</button>
          </div>
        </form>
      )}

      <p className="muted sh-count">{filtered.length} แม่แบบ ใน {groups.length} โครงการ · เรียงโครงการ ก–ฮ, A–Z และเวลาเข้า เช้า → ดึก</p>
      {groups.length === 0 ? <p className="muted">ไม่พบแม่แบบกะ{active ? 'ตามตัวกรอง' : ' — กด "+ เพิ่มแม่แบบกะ" หรือนำเข้าจาก Excel'}</p> : (
        <div className="table-wrap">
          <table className="grid sh-table">
            <thead><tr><th>ชื่อกะ</th><th>ช่วง</th><th>เวลาเข้า – ออก</th><th>คน</th><th>วันที่มีกะ</th><th></th></tr></thead>
            <tbody>
              {groups.map((g) => [
                <tr key={`g-${g.p.code}`} className="sh-group">
                  <td colSpan={6}>
                    <b>{g.p.is_test ? '🧪 ' : ''}{g.p.name}</b>
                    <span className="muted"> · {g.p.code}{g.p.province ? ` · ${g.p.province}` : ''}</span>
                    {g.p.shift_mode === 'open' && <span className="badge duty" style={{ marginLeft: 8 }}>ไม่จัดกะ</span>}
                    <span className="muted" style={{ float: 'right' }}>{g.items.length} กะ</span>
                  </td>
                </tr>,
                ...g.items.map((t) => (
                  <tr key={t.id}>
                    <td className="sh-name">{t.name}</td>
                    <td>{isNight(t.start_time) ? <span className="badge sh-night">กลางคืน</span> : <span className="badge sh-day">กลางวัน</span>}</td>
                    <td className="num-t">{hm(t.start_time)} – {hm(t.end_time)}{t.crosses_midnight ? <small className="muted"> (+1)</small> : ''}</td>
                    <td>{t.headcount || 1}</td>
                    <td>{daysLabel(t.days_of_week)}</td>
                    <td className="row-act">
                      <button className="badge" onClick={() => startEdit(t)}>แก้ไข</button>
                      <button className="badge" onClick={() => deactivate(t)}>ปิดใช้</button>
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════ จ่ายกะ ═══════════════════════════
function AssignTab({ templates, guards, reload, setMsg }) {
  const [g, setG] = useState({ template_id: '', user_id: '', from: '', to: '' })
  const me = getUser()
  const opts = useMemo(() => templates.filter((t) => t.properties?.shift_mode !== 'open')
    .sort((a, b) => byName(a.properties?.name, b.properties?.name) || (dayKey(a.start_time) - dayKey(b.start_time))), [templates])
  const tpl = templates.find((t) => t.id === g.template_id)
  const assignable = tpl?.properties?.is_test ? [{ id: me.id, full_name: me.full_name, employee_code: me.employee_code, self: true }] : guards.filter((x) => x.id !== me.id)

  async function submit(e) {
    e.preventDefault(); setMsg(null)
    try {
      const out = await rpc('generate_assignments', { p_template_id: g.template_id, p_user_id: g.user_id, p_date_from: g.from, p_date_to: g.to })
      setMsg(out.ok ? { t: 'ok', m: `สร้างกะแล้ว ${out.created} กะ${out.skipped_overlap ? ` (ข้าม ${out.skipped_overlap} กะที่ซ้อน)` : ''}` } : { t: 'err', m: errTh(out.error) })
      reload()
    } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <div className="form-grid">
        <div className="field wide"><label>แม่แบบกะ *</label>
          <select value={g.template_id} onChange={(e) => setG({ ...g, template_id: e.target.value, user_id: '' })} required>
            <option value="">— เลือก —</option>
            {opts.map((t) => <option key={t.id} value={t.id}>{t.properties?.is_test ? '🧪 ' : ''}{t.properties?.name} · {t.name} ({hm(t.start_time)}–{hm(t.end_time)})</option>)}
          </select>
        </div>
        <div className="field"><label>พนักงาน *</label>
          <select value={g.user_id} onChange={(e) => setG({ ...g, user_id: e.target.value })} required>
            <option value="">— เลือก —</option>
            {assignable.map((x) => <option key={x.id} value={x.id}>{x.full_name} ({x.employee_code}){x.self ? ' · ตัวคุณ (ทดสอบ)' : ''}</option>)}
          </select>
        </div>
        <div className="field"><label>ตั้งแต่วันที่ *</label><input type="date" value={g.from} onChange={(e) => setG({ ...g, from: e.target.value })} required /></div>
        <div className="field"><label>ถึงวันที่ *</label><input type="date" value={g.to} min={g.from} onChange={(e) => setG({ ...g, to: e.target.value })} required /></div>
      </div>
      <div className="actions" style={{ marginTop: 14 }}><button className="btn inline" type="submit">สร้างกะ</button></div>
      <p className="hint">ระบบกันกะซ้อนอัตโนมัติ และติ๊กกะวันหยุด (OT 2.5x) จากวันหยุดบริษัท + วันหยุดประจำสัปดาห์ของพนักงาน · จ่ายกะหลายคนพร้อมกันใช้แท็บ "นำเข้าจาก Excel" · โครงการแบบไม่จัดกะไม่ต้องจ่ายกะ</p>
    </form>
  )
}

// ═══════════════════════════ กะที่กำลังจะถึง ═══════════════════════════
function UpcomingTab({ upcoming, guards, reload, setMsg }) {
  const [f, setF] = useState({ q: '', user: '', prop: '', from: '', to: '', period: '', status: '' })
  const [sel, setSel] = useState(new Set())
  const [swapTo, setSwapTo] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = upcoming || []
  const people = useMemo(() => [...new Map(rows.map((s) => [s.user_id, s.users?.full_name])).entries()].sort((a, b) => byName(a[1], b[1])), [rows])
  const places = useMemo(() => [...new Map(rows.map((s) => [s.property_id, s.properties?.name])).entries()].sort((a, b) => byName(a[1], b[1])), [rows])

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows.filter((s) => {
      if (q && !`${s.users?.full_name} ${s.users?.employee_code} ${s.properties?.name}`.toLowerCase().includes(q)) return false
      if (f.user && s.user_id !== f.user) return false
      if (f.prop && s.property_id !== f.prop) return false
      const d = bkkDate(s.starts_at)
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
      if (f.period && (isNight(bkkHM(s.starts_at)) ? 'night' : 'day') !== f.period) return false
      if (f.status && s.status !== f.status) return false
      return true
    }).sort((a, b) => bkkDate(a.starts_at).localeCompare(bkkDate(b.starts_at))
      || (dayKey(bkkHM(a.starts_at)) - dayKey(bkkHM(b.starts_at)))
      || byName(a.properties?.name, b.properties?.name) || byName(a.users?.full_name, b.users?.full_name))
  }, [rows, f])

  const selectable = shown.filter((s) => s.status === 'scheduled')
  const allOn = selectable.length > 0 && selectable.every((s) => sel.has(s.id))
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n) }
  const setFilter = (k, v) => { setF({ ...f, [k]: v }); setSel(new Set()) }

  async function cancelSelected() {
    const ids = [...sel]
    if (!window.confirm(`ยกเลิก ${ids.length} กะที่เลือก? (กะจะหายจากตารางและแอปยาม แต่ยังเก็บประวัติไว้)`)) return
    setBusy(true); setMsg(null)
    try { await update('shift_assignments', `id=in.(${ids.join(',')})&status=eq.scheduled`, { status: 'cancelled' }); setMsg({ t: 'ok', m: `ยกเลิกแล้ว ${ids.length} กะ` }); setSel(new Set()); reload() }
    catch (e) { setMsg({ t: 'err', m: errTh(e) }) } finally { setBusy(false) }
  }
  async function swapSelected() {
    const ids = [...sel]; const who = guards.find((x) => x.id === swapTo)
    if (!who || !window.confirm(`เปลี่ยน ${ids.length} กะที่เลือกให้ ${who.full_name} รับแทน?`)) return
    setBusy(true); setMsg(null)
    const res = await Promise.allSettled(ids.map((id) => update('shift_assignments', `id=eq.${id}&status=eq.scheduled`, { user_id: swapTo })))
    const fail = res.filter((r) => r.status === 'rejected').length
    setMsg(fail ? { t: 'err', m: `เปลี่ยนสำเร็จ ${ids.length - fail} กะ · ไม่สำเร็จ ${fail} กะ (มักเพราะ ${who.full_name} มีกะเวลาเดียวกันอยู่แล้ว)` } : { t: 'ok', m: `เปลี่ยนให้ ${who.full_name} แล้ว ${ids.length} กะ` })
    setBusy(false); setSwapTo(''); setSel(new Set()); reload()
  }

  if (!upcoming) return <p className="muted">กำลังโหลด…</p>
  const active = Object.values(f).some(Boolean)
  return (
    <div>
      <div className="filters sh-filters">
        <div className="field grow"><label>ค้นหา</label><input value={f.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="ชื่อ รหัสพนักงาน หรือโครงการ" /></div>
        <div className="field"><label>พนักงาน</label><select value={f.user} onChange={(e) => setFilter('user', e.target.value)}><option value="">ทุกคน</option>{people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        <div className="field"><label>โครงการ</label><select value={f.prop} onChange={(e) => setFilter('prop', e.target.value)}><option value="">ทุกโครงการ</option>{places.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        <div className="field range wide-r"><label>ช่วงวันที่</label>
          <div className="time-range"><input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} aria-label="ตั้งแต่วันที่" /><span>–</span><input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} aria-label="ถึงวันที่" /></div>
        </div>
        <div className="field narrow"><label>ช่วงกะ</label><select value={f.period} onChange={(e) => setFilter('period', e.target.value)}><option value="">ทั้งหมด</option><option value="day">กลางวัน</option><option value="night">กลางคืน</option></select></div>
        <div className="field narrow"><label>สถานะ</label><select value={f.status} onChange={(e) => setFilter('status', e.target.value)}><option value="">ทั้งหมด</option><option value="scheduled">รอถึงกะ</option><option value="checked_in">กำลังปฏิบัติงาน</option></select></div>
        {active && <div className="sh-actions"><button className="link-btn" onClick={() => { setF({ q: '', user: '', prop: '', from: '', to: '', period: '', status: '' }); setSel(new Set()) }}>ล้างตัวกรอง</button></div>}
      </div>

      {sel.size > 0 && (
        <div className="card sh-bulk">
          <strong>เลือก {sel.size} กะ</strong>
          <button className="btn inline sm" onClick={cancelSelected} disabled={busy}>ยกเลิกกะที่เลือก</button>
          <span className="muted">หรือเปลี่ยนให้</span>
          <select value={swapTo} onChange={(e) => setSwapTo(e.target.value)} className="sh-swap">
            <option value="">— เลือกพนักงาน —</option>
            {guards.filter((x) => x.id !== getUser().id).map((x) => <option key={x.id} value={x.id}>{x.full_name} ({x.employee_code})</option>)}
          </select>
          <button className="btn inline ghost sm" onClick={swapSelected} disabled={busy || !swapTo}>เปลี่ยนคน</button>
          <button className="link-btn" onClick={() => setSel(new Set())}>ล้างที่เลือก</button>
        </div>
      )}

      <p className="muted sh-count">{shown.length} กะ · เรียงตามวันที่ แล้วเวลาเข้า เช้า → ดึก แล้วโครงการ ก–ฮ{rows.length >= 2000 ? ' · แสดงสูงสุด 2,000 กะแรก' : ''}</p>
      {shown.length === 0 ? <p className="muted">{active ? 'ไม่พบกะตามตัวกรอง' : 'ยังไม่มีกะล่วงหน้า'}</p> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(selectable.map((s) => s.id)))} title="เลือกทั้งหมดที่แสดง" /></th>
              <th>วันที่</th><th>เวลาเข้า – ออก</th><th>ช่วง</th><th>โครงการ</th><th>พนักงาน</th><th>สถานะ</th>
            </tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={sel.has(s.id) ? 'sel' : ''}>
                  <td><input type="checkbox" checked={sel.has(s.id)} disabled={s.status !== 'scheduled'} onChange={() => toggle(s.id)} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.starts_at)}{s.is_holiday_work && <span className="badge warn" style={{ marginLeft: 6 }}>วันหยุด</span>}</td>
                  <td className="num-t">{fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}</td>
                  <td>{isNight(bkkHM(s.starts_at)) ? <span className="badge sh-night">กลางคืน</span> : <span className="badge sh-day">กลางวัน</span>}</td>
                  <td>{s.properties?.name}</td>
                  <td>{s.users?.full_name} <span className="muted">{s.users?.employee_code}</span></td>
                  <td><span className={`badge ${s.status === 'checked_in' ? 'duty' : ''}`}>{th(STATUS_TH, s.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════ นำเข้าจาก Excel ═══════════════════════════
const blankT = () => ({ row: null, property_code: '', name: '', start: '07:00', end: '19:00', headcount: 1, days_text: 'ทุกวัน' })
const blankA = () => ({ row: null, employee_code: '', property_code: '', template_name: '', date_from: '', date_to: '' })

function ImportTab({ templates, properties, people, reload, setMsg, onDone }) {
  const [data, setData] = useState(null)          // { templates, assignments } ที่อ่าน/แก้แล้ว
  const [result, setResult] = useState(null)      // ผลตรวจจาก import_shifts(dry run)
  const [view, setView] = useState('idle')        // idle | summary | edit | confirm
  const [busy, setBusy] = useState('')
  const [fileName, setFileName] = useState('')
  const fileRef = useRef(null)

  async function downloadTemplate() {
    setBusy('กำลังสร้างแบบฟอร์ม…')
    try {
      const { default: ExcelJS } = await import('exceljs')
      const buf = await buildTemplateFile(ExcelJS, {
        properties: properties.filter((p) => !p.is_test), templates,
        people: people.map((u) => ({ ...u, role_th: th(ROLE_TH, u.role) })),
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = 'แบบฟอร์มนำเข้าตารางกะ.xlsx'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } catch (e) { setMsg({ t: 'err', m: `สร้างแบบฟอร์มไม่สำเร็จ (${errTh(e)})` }) } finally { setBusy('') }
  }

  async function validate(d) {
    setBusy('กำลังตรวจข้อมูลทุกแถว…')
    try {
      const out = await rpc('import_shifts', { p_data: toPayload(d), p_commit: false })
      if (!out.ok) { setMsg({ t: 'err', m: out.error === 'forbidden' ? 'นำเข้าได้เฉพาะเจ้าของหรือแอดมินของบริษัท' : errTh(out.error) }); return false }
      setResult(out); return true
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }); return false } finally { setBusy('') }
  }

  async function onFile(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setMsg(null); setFileName(file.name); setBusy('กำลังอ่านไฟล์…')
    try {
      const { default: ExcelJS } = await import('exceljs')
      const d = await readWorkbook(ExcelJS, file)
      if (!d.templates.length && !d.assignments.length) { setMsg({ t: 'err', m: 'ไฟล์ไม่มีข้อมูล — กรอกในชีต "แม่แบบกะ" หรือ "จ่ายกะ" แล้วอัปโหลดใหม่' }); setBusy(''); return }
      setData(d)
      if (await validate(d)) setView('summary')
    } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }); setBusy('') }
  }

  async function revalidate() { if (await validate(data)) setView('summary') }

  async function commit() {
    setBusy('กำลังนำเข้า…')
    try {
      const out = await rpc('import_shifts', { p_data: toPayload(data), p_commit: true })
      if (!out.ok) { setMsg({ t: 'err', m: errTh(out.error) }); return }
      const s = out.summary
      setMsg({ t: 'ok', m: `นำเข้าเรียบร้อย · สร้างแม่แบบใหม่ ${s.templates_created} · สร้างกะ ${s.shifts_created} กะ${s.shifts_skipped ? ` · ข้ามกะที่ซ้อน ${s.shifts_skipped}` : ''}${s.rows_error ? ` · ข้ามแถวที่ผิด ${s.rows_error} แถว` : ''}` })
      reset(); reload(); onDone()
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }) } finally { setBusy('') }
  }

  function reset() { setData(null); setResult(null); setView('idle'); setFileName('') }

  // รวมผลตรวจ
  const resT = new Map((result?.templates || []).map((r) => [r.row, r]))
  const resA = new Map((result?.assignments || []).map((r) => [r.row, r]))
  const all = [...(result?.templates || []).map((r) => ({ ...r, sheet: 'แม่แบบกะ' })), ...(result?.assignments || []).map((r) => ({ ...r, sheet: 'จ่ายกะ' }))]
  const cnt = { total: all.length, ok: all.filter((r) => r.status === 'ok').length, warn: all.filter((r) => r.status === 'warn').length, err: all.filter((r) => r.status === 'error').length }
  const importable = cnt.ok + cnt.warn
  const newTpl = (result?.templates || []).filter((r) => r.status !== 'error' && r.action === 'create').length
  const shifts = result?.summary?.shifts || 0
  const issues = all.filter((r) => r.status !== 'ok')

  // แก้บนเว็บ: ใส่เลขแถวชั่วคราวให้แถวใหม่ (ผลตรวจผูกกับเลขแถว)
  const nextRow = () => Math.max(1, ...(data?.templates || []).map((t) => t.row || 0), ...(data?.assignments || []).map((a) => a.row || 0)) + 1
  const setT = (i, k, v) => setData((d) => ({ ...d, templates: d.templates.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }))
  const setA = (i, k, v) => setData((d) => ({ ...d, assignments: d.assignments.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }))
  const tplNames = (code) => {
    const p = properties.find((x) => x.code === code)
    const fromSys = p ? templates.filter((t) => t.property_id === p.id).map((t) => t.name) : []
    const fromFile = (data?.templates || []).filter((t) => t.property_code === code).map((t) => t.name)
    return [...new Set([...fromSys, ...fromFile].filter(Boolean))].sort(byName)
  }
  const propOpts = properties.filter((p) => !p.is_test)

  return (
    <div>
      <div className="imp-steps">
        <div className="card imp-step">
          <span className="imp-n">1</span>
          <div>
            <h3>ดาวน์โหลดแบบฟอร์ม</h3>
            <p className="muted">ไฟล์ Excel มีชีต <b>อ่านก่อน</b> อธิบายทุกช่อง ชีต <b>แม่แบบกะ</b> และ <b>จ่ายกะ</b> สำหรับกรอก พร้อมรายชื่อโครงการและพนักงานของบริษัทนี้ให้เลือกจาก dropdown</p>
            <button className="btn inline ghost" onClick={downloadTemplate} disabled={!!busy}>ดาวน์โหลดแบบฟอร์ม (.xlsx)</button>
          </div>
        </div>
        <div className="card imp-step">
          <span className="imp-n">2</span>
          <div>
            <h3>อัปโหลดไฟล์ที่กรอกแล้ว</h3>
            <p className="muted">ระบบตรวจทุกแถวก่อน แล้วแสดงสรุปให้แก้บนเว็บหรือกลับไปแก้ในไฟล์ได้ ยังไม่บันทึกอะไรจนกว่าจะกดยืนยัน</p>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={onFile} />
            <button className="btn inline" onClick={() => fileRef.current?.click()} disabled={!!busy}>เลือกไฟล์ .xlsx</button>
            {fileName && <span className="muted" style={{ marginLeft: 10 }}>{fileName}</span>}
          </div>
        </div>
      </div>
      {busy && <div className="notice"><div className="bar"><span /></div>{busy}</div>}

      {/* ── แก้บนเว็บ ── */}
      {view === 'edit' && data && (
        <div className="imp-editor">
          <div className="section-h"><h2>แก้ไขข้อมูลก่อนนำเข้า</h2>
            <div className="actions"><button className="btn inline ghost" onClick={reset}>ยกเลิกทั้งหมด</button><button className="btn inline" onClick={revalidate} disabled={!!busy}>ตรวจอีกครั้ง</button></div>
          </div>
          <h3 className="imp-sub">แม่แบบกะ ({data.templates.length})</h3>
          <div className="table-wrap"><table className="grid imp-grid">
            <thead><tr><th>แถว</th>{TPL_COLS.map((c) => <th key={c}>{c}</th>)}<th>ผลตรวจ</th><th /></tr></thead>
            <tbody>{data.templates.map((t, i) => { const r = resT.get(t.row); return (
              <tr key={i} className={r?.status === 'error' ? 'bad' : ''}>
                <td className="muted">{t.row}</td>
                <td><select value={t.property_code} onChange={(e) => setT(i, 'property_code', e.target.value)}><option value="">—</option>{t.property_code && !propOpts.some((p) => p.code === t.property_code) && <option value={t.property_code}>{t.property_code} (ไม่พบในระบบ)</option>}{propOpts.map((p) => <option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}</select></td>
                <td><input value={t.name} onChange={(e) => setT(i, 'name', e.target.value)} /></td>
                <td><input type="time" value={t.start || ''} onChange={(e) => setT(i, 'start', e.target.value)} /></td>
                <td><input type="time" value={t.end || ''} onChange={(e) => setT(i, 'end', e.target.value)} /></td>
                <td><input type="number" min="1" max="50" value={t.headcount} onChange={(e) => setT(i, 'headcount', e.target.value)} style={{ width: 70 }} /></td>
                <td><input value={t.days_text} onChange={(e) => setT(i, 'days_text', e.target.value)} placeholder="ทุกวัน · จ-ศ" /></td>
                <td><RowStatus r={r} /></td>
                <td><button className="link-btn" onClick={() => setData((d) => ({ ...d, templates: d.templates.filter((_, j) => j !== i) }))}>ลบ</button></td>
              </tr>) })}</tbody>
          </table></div>
          <button className="link-btn" onClick={() => setData((d) => ({ ...d, templates: [...d.templates, { ...blankT(), row: nextRow() }] }))}>+ เพิ่มแถวแม่แบบ</button>

          <h3 className="imp-sub">จ่ายกะ ({data.assignments.length})</h3>
          <div className="table-wrap"><table className="grid imp-grid">
            <thead><tr><th>แถว</th>{ASG_COLS.map((c) => <th key={c}>{c}</th>)}<th>ผลตรวจ</th><th /></tr></thead>
            <tbody>{data.assignments.map((a, i) => { const r = resA.get(a.row); return (
              <tr key={i} className={r?.status === 'error' ? 'bad' : ''}>
                <td className="muted">{a.row}</td>
                <td><select value={a.employee_code} onChange={(e) => setA(i, 'employee_code', e.target.value)}><option value="">—</option>{a.employee_code && !people.some((u) => u.employee_code === a.employee_code) && <option value={a.employee_code}>{a.employee_code} (ไม่พบในระบบ)</option>}{people.map((u) => <option key={u.id} value={u.employee_code}>{u.employee_code} · {u.full_name}</option>)}</select></td>
                <td><select value={a.property_code} onChange={(e) => setA(i, 'property_code', e.target.value)}><option value="">—</option>{a.property_code && !propOpts.some((p) => p.code === a.property_code && p.shift_mode !== 'open') && <option value={a.property_code}>{a.property_code} (ใช้ไม่ได้)</option>}{propOpts.filter((p) => p.shift_mode !== 'open').map((p) => <option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}</select></td>
                <td><select value={a.template_name} onChange={(e) => setA(i, 'template_name', e.target.value)}><option value="">—</option>{[...new Set([a.template_name, ...tplNames(a.property_code)].filter(Boolean))].map((n) => <option key={n}>{n}</option>)}</select></td>
                <td><input type="date" value={a.date_from || ''} onChange={(e) => setA(i, 'date_from', e.target.value)} /></td>
                <td><input type="date" value={a.date_to || ''} onChange={(e) => setA(i, 'date_to', e.target.value)} /></td>
                <td><RowStatus r={r} shifts /></td>
                <td><button className="link-btn" onClick={() => setData((d) => ({ ...d, assignments: d.assignments.filter((_, j) => j !== i) }))}>ลบ</button></td>
              </tr>) })}</tbody>
          </table></div>
          <button className="link-btn" onClick={() => setData((d) => ({ ...d, assignments: [...d.assignments, { ...blankA(), row: nextRow() }] }))}>+ เพิ่มแถวจ่ายกะ</button>
          <div className="actions" style={{ marginTop: 16 }}><button className="btn inline ghost" onClick={reset}>ยกเลิกทั้งหมด</button><button className="btn inline" onClick={revalidate} disabled={!!busy}>ตรวจอีกครั้ง</button></div>
        </div>
      )}

      {/* ── สรุปผลตรวจ ── */}
      {view === 'summary' && result && (
        <Modal onClose={() => setView('edit')} title="สรุปผลตรวจไฟล์" wide>
          <p className="muted" style={{ marginTop: -4 }}>{fileName} · ตรวจ {cnt.total} แถว</p>
          <div className="imp-tiles">
            <div className="stat"><div className="n">{cnt.ok}</div><div className="l">ผ่าน</div></div>
            <div className={`stat ${cnt.warn ? 'warn' : ''}`}><div className="n">{cnt.warn}</div><div className="l">ผ่าน แต่มีคำเตือน</div></div>
            <div className={`stat ${cnt.err ? 'alert' : ''}`}><div className="n">{cnt.err}</div><div className="l">ผิดพลาด (จะไม่นำเข้า)</div></div>
            <div className="stat good"><div className="n">{shifts.toLocaleString()}</div><div className="l">กะที่จะสร้าง · แม่แบบใหม่ {newTpl}</div></div>
          </div>
          {issues.length > 0 ? (
            <div className="imp-issues">
              <table className="grid">
                <thead><tr><th>ชีต</th><th>แถว</th><th>รายการ</th><th>ปัญหา</th></tr></thead>
                <tbody>{issues.sort((a, b) => (a.status === 'error' ? 0 : 1) - (b.status === 'error' ? 0 : 1) || a.row - b.row).map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.sheet}</td>
                    <td>{r.row}</td>
                    <td>{r.sheet === 'จ่ายกะ' ? `${r.user_name || '—'} · ${r.property_name || '—'}` : (r.property_name || '—')}</td>
                    <td>{r.errors.map((e, j) => <div key={`e${j}`} className="imp-err">✕ {e}</div>)}{r.warnings.map((w, j) => <div key={`w${j}`} className="imp-warn">! {w}</div>)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : <div className="notice">ข้อมูลถูกต้องทุกแถว</div>}
          <div className="modal-foot">
            <button className="btn inline ghost" onClick={() => setView('edit')}>แก้ไขบนเว็บ</button>
            <button className="btn inline ghost" onClick={() => { reset(); setMsg({ t: 'ok', m: 'ยกเลิกแล้ว — แก้ในไฟล์แล้วอัปโหลดใหม่ได้เลย' }) }}>ยกเลิก ไปแก้ในไฟล์</button>
            <span className="grow" />
            <button className="btn inline" disabled={!importable || !!busy} onClick={() => setView('confirm')}>{cnt.err ? `ตกลง นำเข้าเฉพาะแถวที่ผ่าน (${importable})` : 'ตกลง นำเข้า'}</button>
          </div>
        </Modal>
      )}

      {/* ── ยืนยันอีกครั้ง ── */}
      {view === 'confirm' && result && (
        <Modal onClose={() => setView('summary')} title="ยืนยันการนำเข้า">
          <p>ระบบจะบันทึกข้อมูลต่อไปนี้ทันที:</p>
          <ul className="imp-confirm">
            <li>สร้างแม่แบบกะใหม่ <b>{newTpl}</b> แม่แบบ</li>
            <li>สร้างกะ <b>{shifts.toLocaleString()}</b> กะ ให้พนักงานจาก {(result.assignments || []).filter((r) => r.status !== 'error').length} แถว</li>
            {cnt.err > 0 && <li className="imp-err">ข้ามแถวที่ผิดพลาด {cnt.err} แถว</li>}
          </ul>
          <p className="muted">กะที่สร้างแล้วยกเลิกได้ที่แท็บ "กะที่กำลังจะถึง" · พนักงานจะเห็นกะในแอปทันที</p>
          <div className="modal-foot">
            <button className="btn inline ghost" onClick={() => setView('summary')} disabled={!!busy}>กลับไปดูสรุป</button>
            <span className="grow" />
            <button className="btn inline" onClick={commit} disabled={!!busy}>{busy ? 'กำลังนำเข้า…' : 'ยืนยัน นำเข้า'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function RowStatus({ r, shifts }) {
  if (!r) return <span className="muted">ยังไม่ตรวจ</span>
  if (r.status === 'error') return <div className="imp-err">{r.errors.join(' · ')}</div>
  return (
    <div>
      <span className={`badge ${r.status === 'warn' ? 'warn' : 'duty'}`}>{r.status === 'warn' ? 'ผ่าน (มีคำเตือน)' : 'ผ่าน'}{shifts ? ` · ${r.shifts} กะ` : ''}</span>
      {r.warnings.map((w, j) => <div key={j} className="imp-warn">{w}</div>)}
    </div>
  )
}

function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h2>{title}</h2><button className="link-btn" onClick={onClose} aria-label="ปิด">ปิด</button></div>
        {children}
      </div>
    </div>
  )
}
