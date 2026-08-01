// โครงการ/ไซต์ — CRUD มาตรฐาน: list มีปุ่มแก้ไข/ปิดใช้ · กด "เพิ่ม" หรือ "แก้ไข" → ฟอร์มเต็มจอ (ซ่อน list)
// ที่อยู่ dropdown จังหวัด→อำเภอ→ตำบล + รหัสไปรษณีย์อัตโนมัติ · แผนที่ปักหมุด/ค้นหา · เขียนพิกัดผ่าน RPC (เสถียร)
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, tenantId } from '../lib/api'
import { loadThaiAddress } from '../lib/thaiAddress'
import MapPicker from '../components/MapPicker.jsx'

const EMPTY = {
  name: '', code: '', provinceId: '', districtId: '', subId: '', postcode: '',
  address: '', lat: null, lng: null, radius: '150', rate: '',
}

export default function Properties() {
  const [rows, setRows] = useState(null)
  const [addr, setAddr] = useState(null)
  const [vendors, setVendors] = useState([])
  const [mode, setMode] = useState('list') // 'list' | 'create' | 'edit'
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [vendorSel, setVendorSel] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => list('v_properties?select=*&is_active=is.true&order=created_at.desc').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => {
    load()
    loadThaiAddress().then(setAddr).catch(() => setMsg({ t: 'err', m: 'โหลดข้อมูลที่อยู่ไม่สำเร็จ' }))
    rpc('list_vendors').then((v) => { setVendors(v); setVendorSel(tenantId()) }).catch(() => {})
  }, [])

  const districts = useMemo(() => addr && form.provinceId ? addr.districts.filter((d) => d.p === Number(form.provinceId)) : [], [addr, form.provinceId])
  const subs = useMemo(() => addr && form.districtId ? addr.subs.filter((s) => s.d === Number(form.districtId)) : [], [addr, form.districtId])

  function pickSub(subId) {
    const s = addr.subs.find((x) => x.i === Number(subId))
    setForm((f) => ({ ...f, subId, postcode: s ? String(s.z) : '' }))
  }
  function names() {
    if (!addr) return { p: '', d: '', s: '' }
    return {
      p: addr.provinces.find((x) => x.i === Number(form.provinceId))?.n || '',
      d: addr.districts.find((x) => x.i === Number(form.districtId))?.n || '',
      s: addr.subs.find((x) => x.i === Number(form.subId))?.n || '',
    }
  }

  function openCreate() {
    setMode('create'); setEditingId(null); setForm(EMPTY); setVendorSel(tenantId()); setMsg(null)
  }
  function openEdit(row) {
    const p = addr?.provinces.find((x) => x.n === row.province)
    const d = addr?.districts.find((x) => x.n === row.district && (!p || x.p === p.i))
    const s = addr?.subs.find((x) => x.n === row.subdistrict && (!d || x.d === d.i))
    setEditingId(row.id)
    setForm({
      name: row.name, code: row.code,
      provinceId: p ? String(p.i) : '', districtId: d ? String(d.i) : '', subId: s ? String(s.i) : '',
      postcode: row.postcode || '', address: row.address || '',
      lat: row.lat, lng: row.lng,
      radius: String(row.geofence_radius_m || 150), rate: row.billing_rate_per_guard_day || '',
    })
    setMode('edit'); setMsg(null)
  }
  function backToList() { setMode('list'); setMsg(null); load() }

  async function submit(e) {
    e.preventDefault(); setMsg(null); setBusy(true)
    const n = names()
    try {
      const out = await rpc('save_property', {
        p_id: editingId,
        p_tenant_id: mode === 'create' && vendors.length ? vendorSel : tenantId(),
        p_name: form.name.trim(), p_code: form.code.trim(),
        p_province: n.p, p_district: n.d, p_subdistrict: n.s,
        p_postcode: form.postcode || '', p_address: form.address.trim(),
        p_lat: form.lat, p_lng: form.lng,
        p_radius: Number(form.radius) || 150, p_rate: form.rate ? Number(form.rate) : null,
      })
      if (!out.ok) throw new Error(out.error)
      backToList()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) } finally { setBusy(false) }
  }

  async function disable(row) {
    if (!window.confirm(`ปิดใช้งานโครงการ "${row.name}"? (กะที่ผูกไว้ยังอยู่ แต่โครงการจะไม่แสดงในรายการ)`)) return
    try { const o = await rpc('set_property_active', { p_id: row.id, p_active: false }); if (!o.ok) throw new Error(o.error); load() }
    catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // ---------- FORM (create/edit) ----------
  if (mode !== 'list') {
    return (
      <div>
        <div className="section-h">
          <h2>{mode === 'edit' ? `แก้ไขโครงการ: ${form.name}` : 'เพิ่มโครงการใหม่'}</h2>
          <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={backToList}>← กลับ</button>
        </div>
        <form className="card" onSubmit={submit}>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            {mode === 'create' && vendors.length > 0 && (
              <div className="field"><label>Vendor (บริษัทเจ้าของโครงการ)</label>
                <select value={vendorSel} onChange={(e) => setVendorSel(e.target.value)}>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div className="field"><label>ชื่อโครงการ *</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="field"><label>รหัส *</label><input value={form.code} onChange={set('code')} placeholder="P001" required /></div>
            <div className="field"><label>จังหวัด</label>
              <select value={form.provinceId} onChange={(e) => setForm({ ...form, provinceId: e.target.value, districtId: '', subId: '', postcode: '' })} disabled={!addr}>
                <option value="">{addr ? '— เลือกจังหวัด —' : 'กำลังโหลด…'}</option>
                {addr?.provinces.map((p) => <option key={p.i} value={p.i}>{p.n}</option>)}
              </select>
            </div>
            <div className="field"><label>อำเภอ/เขต</label>
              <select value={form.districtId} onChange={(e) => setForm({ ...form, districtId: e.target.value, subId: '', postcode: '' })} disabled={!form.provinceId}>
                <option value="">— เลือก —</option>
                {districts.map((d) => <option key={d.i} value={d.i}>{d.n}</option>)}
              </select>
            </div>
            <div className="field"><label>ตำบล/แขวง</label>
              <select value={form.subId} onChange={(e) => pickSub(e.target.value)} disabled={!form.districtId}>
                <option value="">— เลือก —</option>
                {subs.map((s) => <option key={s.i} value={s.i}>{s.n}</option>)}
              </select>
            </div>
            <div className="field"><label>รหัสไปรษณีย์ (อัตโนมัติ)</label><input value={form.postcode} readOnly style={{ background: 'var(--paper)' }} /></div>
            <div className="field"><label>ที่อยู่ (เลขที่/ถนน/ซอย)</label><input value={form.address} onChange={set('address')} /></div>
            <div className="field"><label>รัศมี geofence (เมตร)</label><input value={form.radius} onChange={set('radius')} inputMode="numeric" /></div>
            <div className="field"><label>อัตราเก็บลูกค้า/ยาม/วัน</label><input value={form.rate} onChange={set('rate')} inputMode="numeric" /></div>
          </div>

          <MapPicker initLat={form.lat} initLng={form.lng} onPick={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />
          <p className="muted" style={{ margin: '8px 0 16px' }}>พิกัดที่เลือก: {form.lat != null ? `${form.lat}, ${form.lng}` : 'ยังไม่ได้ปักหมุด'}</p>

          {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`} style={{ marginBottom: 12 }}>{msg.m}</div>}
          <button className="btn inline" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : mode === 'edit' ? 'บันทึกการแก้ไข' : 'เพิ่มโครงการ'}</button>
        </form>
      </div>
    )
  }

  // ---------- LIST ----------
  return (
    <div>
      <div className="section-h">
        <h2>โครงการทั้งหมด {rows ? `(${rows.length})` : ''}</h2>
        <button className="btn inline" style={{ padding: '10px 20px' }} onClick={openCreate}>+ เพิ่มโครงการ</button>
      </div>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}
      {!rows ? <p className="muted">กำลังโหลด…</p> : rows.length === 0 ? <p className="muted">ยังไม่มีโครงการ — กด "เพิ่มโครงการ"</p> : (
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>ที่ตั้ง</th><th>พิกัด</th><th>รัศมี</th><th>อัตรา/ยาม/วัน</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td>{[p.subdistrict, p.district, p.province, p.postcode].filter(Boolean).join(' · ') || '—'}</td>
                <td>{p.lat != null
                  ? <a href={`https://maps.google.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)' }}>แผนที่</a>
                  : <span className="badge">ยังไม่ตั้ง</span>}</td>
                <td>{p.geofence_radius_m} ม.</td>
                <td>{p.billing_rate_per_guard_day ? Number(p.billing_rate_per_guard_day).toLocaleString() : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none', marginRight: 6 }} onClick={() => openEdit(p)}>แก้ไข</button>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => disable(p)}>ปิดใช้</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
