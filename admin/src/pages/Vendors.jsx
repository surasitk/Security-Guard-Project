// Vendors — จัดการบริษัท รปภ. ที่ใช้ระบบ (เฉพาะเจ้าของแพลตฟอร์ม)
import { useEffect, useState } from 'react'
import { rpc, fmtDate } from '../lib/api'

export default function Vendors() {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ company: '', plan: 'basic', owner_name: '', owner_code: 'ADM-001', owner_phone: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => rpc('list_vendors').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => { load() }, [])

  async function submit(e) {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      const out = await rpc('create_vendor', {
        p_company: form.company.trim(),
        p_plan: form.plan,
        p_owner_name: form.owner_name.trim(),
        p_owner_code: form.owner_code.trim(),
        p_owner_phone: form.owner_phone.trim(),
      })
      if (out.ok) {
        setMsg({ t: 'ok', m: `สร้าง ${form.company} แล้ว — ส่งลิงก์ https://liff.line.me/2010926067-2cuN81fZ ให้ owner ของเขาลงทะเบียนด้วยรหัส ${form.owner_code} + เบอร์ ${form.owner_phone}` })
        setForm({ company: '', plan: 'basic', owner_name: '', owner_code: 'ADM-001', owner_phone: '' })
        load()
      } else setMsg({ t: 'err', m: out.error })
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) } finally { setBusy(false) }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <div className="section-h"><h2>เพิ่ม Vendor (บริษัท รปภ. ใหม่)</h2></div>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label>ชื่อบริษัท *</label><input value={form.company} onChange={set('company')} required /></div>
          <div className="field"><label>แพ็คเกจ</label>
            <select value={form.plan} onChange={set('plan')}><option value="basic">Basic</option><option value="pro">Pro</option></select>
          </div>
          <div className="field"><label>ชื่อ Owner ของบริษัท *</label><input value={form.owner_name} onChange={set('owner_name')} required /></div>
          <div className="field"><label>รหัสพนักงาน Owner *</label><input value={form.owner_code} onChange={set('owner_code')} required /></div>
          <div className="field"><label>เบอร์โทร Owner *</label><input value={form.owner_phone} onChange={set('owner_phone')} inputMode="tel" required /></div>
          <button className="btn inline" type="submit" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'สร้าง Vendor'}</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          สร้างแล้ว owner ของบริษัทนั้นลงทะเบียนผูก LINE ด้วยรหัส+เบอร์ที่ตั้งไว้ แล้วเข้าเว็บ admin นี้ได้เลย — เห็นเฉพาะข้อมูลบริษัทตัวเอง
        </p>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>Vendor ทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <p className="muted">กำลังโหลด…</p> : (
        <table className="grid">
          <thead><tr><th>บริษัท</th><th>แพ็คเกจ</th><th>โครงการ</th><th>พนักงาน</th><th>ผูก LINE แล้ว</th><th>สร้างเมื่อ</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td><span className={`badge ${v.plan === 'pro' ? 'solid' : ''}`}>{v.plan}</span></td>
                <td>{v.properties_count}</td>
                <td>{v.users_count}</td>
                <td>{v.line_linked_count}</td>
                <td>{fmtDate(v.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
