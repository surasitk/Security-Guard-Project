// ตารางกะ — สร้างแม่แบบกะ + generate กะรายเดือนให้ยาม + ดูกะล่วงหน้า
import { useEffect, useState } from 'react'
import { list, insert, rpc, tenantId, fmtTime, fmtDate } from '../lib/api'

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

export default function Shifts() {
  const [templates, setTemplates] = useState([])
  const [guards, setGuards] = useState([])
  const [upcoming, setUpcoming] = useState(null)
  const [msg, setMsg] = useState(null)

  const [tForm, setTForm] = useState({ property_id: '', name: 'กะกลางวัน', start: '07:00', end: '19:00', cross: false, days: [0, 1, 2, 3, 4, 5, 6] })
  const [gForm, setGForm] = useState({ template_id: '', user_id: '', from: '', to: '' })
  const [properties, setProperties] = useState([])

  const load = async () => {
    try {
      const [t, g, p, u] = await Promise.all([
        list('shift_templates?select=*,properties(name)&is_active=is.true&order=name'),
        list('users?select=id,full_name,employee_code&role=in.(guard,shift_leader)&is_active=is.true&order=full_name'),
        list('properties?select=id,name&is_active=is.true&order=name'),
        list(`shift_assignments?select=id,starts_at,ends_at,status,is_holiday_work,users(full_name),properties(name)&starts_at=gte.${new Date().toISOString()}&status=neq.cancelled&order=starts_at&limit=50`),
      ])
      setTemplates(t); setGuards(g); setProperties(p); setUpcoming(u)
    } catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }
  useEffect(() => { load() }, [])

  async function addTemplate(e) {
    e.preventDefault(); setMsg(null)
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

      <div className="section-h"><h2>กะที่กำลังจะถึง</h2></div>
      {!upcoming ? <p className="muted">กำลังโหลด…</p> : upcoming.length === 0 ? <p className="muted">ยังไม่มีกะล่วงหน้า</p> : (
        <table className="grid">
          <thead><tr><th>วันที่</th><th>พนักงาน</th><th>โครงการ</th><th>เวลา</th><th>สถานะ</th></tr></thead>
          <tbody>
            {upcoming.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.starts_at)}{s.is_holiday_work ? ' · วันหยุด' : ''}</td>
                <td>{s.users?.full_name}</td>
                <td>{s.properties?.name}</td>
                <td>{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</td>
                <td><span className="badge">{s.status === 'scheduled' ? 'รอถึงกะ' : s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
