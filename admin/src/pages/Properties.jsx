// โครงการ/ไซต์ — ฟอร์มเดียวใช้ทั้งสร้างและแก้ไข · ที่อยู่ dropdown จังหวัด→อำเภอ→ตำบล + รหัสไปรษณีย์อัตโนมัติ
// + แผนที่ปักหมุด/ค้นหา (OpenStreetMap) ดึงพิกัดเข้าฟอร์มเอง
import { useEffect, useMemo, useRef, useState } from 'react'
import { list, insert, update, rpc, tenantId } from '../lib/api'
import { loadThaiAddress } from '../lib/thaiAddress'
import MapPicker from '../components/MapPicker.jsx'

const EMPTY = {
  name: '', code: '', provinceId: '', districtId: '', subId: '', postcode: '',
  address: '', lat: null, lng: null, radius: '150', rate: '',
}

export default function Properties() {
  const [rows, setRows] = useState(null)
  const [addr, setAddr] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [mapKey, setMapKey] = useState(0) // remount แผนที่เมื่อสลับสร้าง/แก้ไข
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [vendors, setVendors] = useState([])
  const [vendorSel, setVendorSel] = useState('')
  const formRef = useRef(null)

  const load = () => list('v_properties?select=*&is_active=is.true&order=created_at.desc').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => {
    load()
    loadThaiAddress().then(setAddr).catch(() => setMsg({ t: 'err', m: 'โหลดข้อมูลที่อยู่ไม่สำเร็จ — กรอกจังหวัดเป็นข้อความแทน' }))
    rpc('list_vendors').then((v) => { setVendors(v); setVendorSel(tenantId()) }).catch(() => {})
  }, [])

  const districts = useMemo(() => addr && form.provinceId ? addr.districts.filter((d) => d.p === Number(form.provinceId)) : [], [addr, form.provinceId])
  const subs = useMemo(() => addr && form.districtId ? addr.subs.filter((s) => s.d === Number(form.districtId)) : [], [addr, form.districtId])

  function pickSub(subId) {
    const s = addr.subs.find((x) => x.i === Number(subId))
    setForm((f) => ({ ...f, subId, postcode: s ? String(s.z) : '' }))
  }

  function namesFromForm() {
    if (!addr) return { province: null, district: null, subdistrict: null }
    return {
      province: addr.provinces.find((p) => p.i === Number(form.provinceId))?.n || null,
      district: addr.districts.find((d) => d.i === Number(form.districtId))?.n || null,
      subdistrict: addr.subs.find((s) => s.i === Number(form.subId))?.n || null,
    }
  }

  function startEdit(row) {
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
    setMapKey((k) => k + 1)
    setMsg(null)
    formRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null); setForm(EMPTY); setMapKey((k) => k + 1); setMsg(null)
  }

  async function submit(e) {
    e.preventDefault(); setMsg(null); setBusy(true)
    const names = namesFromForm()
    try {
      if (editingId) {
        const patch = {
          name: form.name.trim(), code: form.code.trim(),
          province: names.province, district: names.district, subdistrict: names.subdistrict,
          postcode: form.postcode || null, address: form.address.trim() || null,
          geofence_radius_m: Number(form.radius) || 150,
          billing_rate_per_guard_day: form.rate ? Number(form.rate) : null,
        }
        if (form.lat != null && form.lng != null) {
          patch.center = { type: 'Point', coordinates: [form.lng, form.lat] }
        }
        await update('properties', `id=eq.${editingId}`, patch)
        setMsg({ t: 'ok', m: 'บันทึกการแก้ไขแล้ว' })
        cancelEdit()
      } else if (vendors.length > 0 && vendorSel && vendorSel !== tenantId()) {
        const out = await rpc('create_property_for_vendor', {
          p_tenant_id: vendorSel, p_name: form.name.trim(), p_code: form.code.trim(),
          p_province: names.province || '', p_district: names.district || '', p_subdistrict: names.subdistrict || '',
          p_postcode: form.postcode || '', p_address: form.address.trim() || '',
          p_lat: form.lat, p_lng: form.lng,
          p_radius: Number(form.radius) || 150, p_rate: form.rate ? Number(form.rate) : null,
        })
        if (!out.ok) throw new Error(out.error)
        setMsg({ t: 'ok', m: `เพิ่มโครงการให้ ${vendors.find((v) => v.id === vendorSel)?.name} แล้ว` })
        setForm(EMPTY); setMapKey((k) => k + 1)
      } else {
        const row = {
          tenant_id: tenantId(), name: form.name.trim(), code: form.code.trim(),
          province: names.province, district: names.district, subdistrict: names.subdistrict,
          postcode: form.postcode || null, address: form.address.trim() || null,
          geofence_radius_m: Number(form.radius) || 150,
          billing_rate_per_guard_day: form.rate ? Number(form.rate) : null,
        }
        if (form.lat != null && form.lng != null) {
          row.center = { type: 'Point', coordinates: [form.lng, form.lat] }
        }
        await insert('properties', row)
        setMsg({ t: 'ok', m: `เพิ่มโครงการ ${form.name} แล้ว` })
        setForm(EMPTY); setMapKey((k) => k + 1)
      }
      load()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) } finally { setBusy(false) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <div className="section-h" ref={formRef}>
        <h2>{editingId ? `แก้ไขโครงการ: ${form.name}` : 'เพิ่มโครงการ'}</h2>
        {editingId && <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={cancelEdit}>ยกเลิกการแก้ไข</button>}
      </div>
      <form className="card" onSubmit={submit}>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          {!editingId && vendors.length > 0 && (
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

        <MapPicker key={mapKey} initLat={form.lat} initLng={form.lng}
          onPick={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />
        <p className="muted" style={{ margin: '8px 0 16px' }}>
          พิกัดที่เลือก: {form.lat != null ? `${form.lat}, ${form.lng}` : 'ยังไม่ได้ปักหมุด'}
        </p>

        <button className="btn inline" type="submit" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : editingId ? 'บันทึกการแก้ไข' : 'เพิ่มโครงการ'}
        </button>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>โครงการทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <p className="muted">กำลังโหลด…</p> : (
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
                <td><button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => startEdit(p)}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
