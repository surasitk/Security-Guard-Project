// โครงการ/ไซต์ — รายการ + เพิ่มใหม่พร้อมพิกัด geofence
import { useEffect, useState } from 'react'
import { list, insert, tenantId } from '../lib/api'

export default function Properties() {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', address: '', lat: '', lng: '', radius: '150', rate: '' })
  const [msg, setMsg] = useState(null)

  const load = () => list('properties?select=*&order=created_at.desc').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => { load() }, [])

  async function submit(e) {
    e.preventDefault(); setMsg(null)
    try {
      const row = {
        tenant_id: tenantId(),
        name: form.name.trim(),
        code: form.code.trim(),
        address: form.address.trim() || null,
        geofence_radius_m: Number(form.radius) || 150,
        billing_rate_per_guard_day: form.rate ? Number(form.rate) : null,
      }
      if (form.lat && form.lng) {
        row.center = { type: 'Point', coordinates: [Number(form.lng), Number(form.lat)] }
      }
      await insert('properties', row)
      setMsg({ t: 'ok', m: `เพิ่มโครงการ ${form.name} แล้ว` })
      setForm({ name: '', code: '', address: '', lat: '', lng: '', radius: '150', rate: '' })
      load()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <div className="section-h"><h2>เพิ่มโครงการ</h2></div>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label>ชื่อโครงการ *</label><input value={form.name} onChange={set('name')} required /></div>
          <div className="field"><label>รหัส *</label><input value={form.code} onChange={set('code')} placeholder="P001" required /></div>
          <div className="field"><label>ที่อยู่</label><input value={form.address} onChange={set('address')} /></div>
          <div className="field"><label>Latitude</label><input value={form.lat} onChange={set('lat')} placeholder="7.8804" inputMode="decimal" /></div>
          <div className="field"><label>Longitude</label><input value={form.lng} onChange={set('lng')} placeholder="98.3381" inputMode="decimal" /></div>
          <div className="field"><label>รัศมี geofence (เมตร)</label><input value={form.radius} onChange={set('radius')} inputMode="numeric" /></div>
          <div className="field"><label>อัตราเก็บลูกค้า/ยาม/วัน</label><input value={form.rate} onChange={set('rate')} inputMode="numeric" /></div>
          <button className="btn inline" type="submit">เพิ่มโครงการ</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>เอาพิกัดจาก Google Maps: กดค้างบนแผนที่ → ตัวเลข lat, lng จะขึ้นด้านบน</p>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>โครงการทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <p className="muted">กำลังโหลด…</p> : (
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>พิกัด</th><th>รัศมี</th><th>อัตรา/ยาม/วัน</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td>{p.center ? <span className="badge solid">ตั้งแล้ว</span> : <span className="badge">ยังไม่ตั้ง</span>}</td>
                <td>{p.geofence_radius_m} ม.</td>
                <td>{p.billing_rate_per_guard_day ? Number(p.billing_rate_per_guard_day).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
