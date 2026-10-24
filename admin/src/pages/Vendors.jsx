// Vendors — จัดการบริษัท รปภ. ที่ใช้ระบบ (เฉพาะเจ้าของแพลตฟอร์ม) · สร้าง + แก้ไข inline + เปิด/ปิด
import { useEffect, useState } from 'react'
import { rpc, fmtDate, errTh } from '../lib/api'
import { SkTable } from '../components/Skeleton.jsx'

export default function Vendors() {
  const [rows, setRows] = useState(null)
  const BLANK = { name_th: '', name_en: '', plan: 'basic', owner_name: '', owner_phone: '' }
  const [form, setForm] = useState(BLANK)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null) // { id, name, plan, is_active }
  const [saving, setSaving] = useState(false)

  const load = () => rpc('list_vendors').then(setRows).catch((e) => setMsg({ t: 'err', m: errTh(e) }))
  useEffect(() => { load() }, [])

  async function submit(e) {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      const out = await rpc('create_vendor', {
        p_name_th: form.name_th.trim(), p_name_en: form.name_en.trim(), p_plan: form.plan,
        p_owner_name: form.owner_name.trim(), p_owner_phone: form.owner_phone.trim(),
      })
      if (out.ok) {
        setMsg({ t: 'ok', m: `สร้าง ${form.name_th} แล้ว · ตัวอักษรนำหน้ารหัสพนักงาน ${out.prefix} — ส่งลิงก์ https://liff.line.me/${import.meta.env.VITE_PATROL_LIFF_ID || '2010926067-2cuN81fZ'} ให้ owner ลงทะเบียนด้วยรหัส ${out.owner_code} + เบอร์ ${form.owner_phone}` })
        setForm(BLANK)
        load()
      } else setMsg({ t: 'err', m: errTh(out.error) })
    } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }) } finally { setBusy(false) }
  }

  async function saveEdit() {
    setSaving(true); setMsg(null)
    try {
      const o = await rpc('update_vendor', { p_tenant_id: edit.id, p_name: edit.name.trim(), p_name_en: edit.name_en.trim(), p_plan: edit.plan, p_is_active: edit.is_active })
      if (!o.ok) throw new Error(errTh(o.error))
      setMsg({ t: 'ok', m: 'บันทึกแล้ว' }); setEdit(null); load()
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }) } finally { setSaving(false) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <div className="section-h"><h2>เพิ่ม Tenant (บริษัท รปภ. ใหม่)</h2></div>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label>ชื่อ Tenant ภาษาไทย *</label><input value={form.name_th} onChange={set('name_th')} placeholder="บริษัท … จำกัด" required /></div>
          <div className="field"><label>ชื่อ Tenant ภาษาอังกฤษ *</label><input value={form.name_en} onChange={set('name_en')} placeholder="… Security Co., Ltd." pattern="[^A-Za-z]*[A-Za-z].*" title="ต้องมีตัวอักษร A–Z" required /></div>
          <div className="field"><label>แพ็คเกจ</label>
            <select value={form.plan} onChange={set('plan')}><option value="basic">Basic</option><option value="pro">Pro</option></select>
          </div>
          <div className="field"><label>ชื่อ-สกุล Owner *</label><input value={form.owner_name} onChange={set('owner_name')} required /></div>
          <div className="field"><label>รหัสพนักงาน Owner</label><input value="สร้างอัตโนมัติ (…-000)" disabled /></div>
          <div className="field"><label>เบอร์โทร Owner *</label><input value={form.owner_phone} onChange={set('owner_phone')} inputMode="tel" required /></div>
          <button className="btn inline" type="submit" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'สร้าง Tenant'}</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>ตัวอักษรนำหน้ารหัสพนักงาน = ตัวแรกของชื่อภาษาอังกฤษ + สุ่มอีก 1 ตัว (ไม่ซ้ำ Tenant อื่น) · Owner ได้รหัส …-000 เสมอ ผู้ใช้ที่ Tenant สร้างต่อจะได้ -001, -002 … อัตโนมัติ · owner ลงทะเบียน LINE ด้วยรหัส + เบอร์ แล้วเข้าเว็บนี้ได้ — เห็นเฉพาะข้อมูลบริษัทตัวเอง · เบอร์โทรต้องไม่ซ้ำกับผู้ใช้ที่ยังใช้งานอยู่</p>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>Tenant ทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <SkTable rows={3} cols={8} /> : (
        <table className="grid">
          <thead><tr><th>บริษัท</th><th>รหัส</th><th>แพ็คเกจ</th><th>สถานะ</th><th>โครงการ</th><th>พนักงาน</th><th>ผูก LINE</th><th>สร้างเมื่อ</th><th></th></tr></thead>
          <tbody>
            {rows.map((v) => edit?.id === v.id ? (
              <tr key={v.id}>
                <td>
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="ชื่อไทย" style={{ padding: 8, width: 180, display: 'block', marginBottom: 4 }} />
                  <input value={edit.name_en} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} placeholder="ชื่ออังกฤษ" style={{ padding: 8, width: 180 }} />
                </td>
                <td>{v.code_prefix || '—'}</td>
                <td>
                  <select value={edit.plan} onChange={(e) => setEdit({ ...edit, plan: e.target.value })} style={{ padding: 8 }}>
                    <option value="basic">basic</option><option value="pro">pro</option>
                  </select>
                </td>
                <td>
                  <select value={edit.is_active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, is_active: e.target.value === '1' })} style={{ padding: 8 }}>
                    <option value="1">ใช้งาน</option><option value="0">ปิด</option>
                  </select>
                </td>
                <td>{v.properties_count}</td><td>{v.users_count}</td><td>{v.line_linked_count}</td><td>{fmtDate(v.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="badge solid" style={{ cursor: 'pointer', border: 'none', fontFamily: 'var(--font)', marginRight: 6 }} onClick={saveEdit} disabled={saving}>{saving ? '…' : 'บันทึก'}</button>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => setEdit(null)}>ยกเลิก</button>
                </td>
              </tr>
            ) : (
              <tr key={v.id} style={{ opacity: v.is_active ? 1 : 0.5 }}>
                <td>{v.name}{v.is_test && <span className="badge warn" style={{ marginLeft: 8 }}>ทดสอบ · เห็นเฉพาะ Super Admin</span>}{v.name_en && <div className="muted">{v.name_en}</div>}</td>
                <td>{v.code_prefix ? <span className="badge">{v.code_prefix}</span> : '—'}</td>
                <td><span className={`badge ${v.plan === 'pro' ? 'solid' : ''}`}>{v.plan}</span></td>
                <td>{v.is_active ? <span className="muted">ใช้งาน</span> : <span className="badge">ปิด</span>}</td>
                <td>{v.properties_count}</td><td>{v.users_count}</td><td>{v.line_linked_count}</td><td>{fmtDate(v.created_at)}</td>
                <td><button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }}
                  onClick={() => setEdit({ id: v.id, name: v.name, name_en: v.name_en || '', plan: v.plan, is_active: v.is_active })}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
