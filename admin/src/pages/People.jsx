// พนักงาน — รายชื่อ + เพิ่มพนักงานใหม่ + แก้ไขข้อมูล/ตำแหน่ง
// (ยามลงทะเบียน LINE เองภายหลังด้วยรหัสพนักงาน+เบอร์ — เลือกตำแหน่งเองไม่ได้ ตำแหน่งกำหนดจากหน้านี้เท่านั้น)
import { useEffect, useState } from 'react'
import { list, insert, update, rpc, tenantId } from '../lib/api'

const ROLES = [
  ['guard', 'ยาม'], ['shift_leader', 'หัวหน้ากะ'], ['supervisor', 'สายตรวจ/ผจก.โซน'],
  ['admin', 'ธุรการ/แอดมิน'], ['owner', 'เจ้าของ'], ['client', 'ลูกค้า'],
]
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']

export default function People() {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ employee_code: '', full_name: '', phone: '', role: 'guard', daily_wage: '', weekly_day_off: '' })
  const [msg, setMsg] = useState(null)
  const [edit, setEdit] = useState(null) // { id, role, phone, daily_wage }
  const [saving, setSaving] = useState(false)

  function startEdit(u) {
    setEdit({ id: u.id, role: u.role, phone: u.phone || '', daily_wage: u.daily_wage || '' })
  }

  async function saveEdit() {
    setSaving(true); setMsg(null)
    try {
      await update('users', `id=eq.${edit.id}`, {
        role: edit.role,
        phone: edit.phone.trim() || null,
        daily_wage: edit.daily_wage ? Number(edit.daily_wage) : null,
      })
      setMsg({ t: 'ok', m: 'บันทึกการแก้ไขแล้ว' })
      setEdit(null)
      load()
    } catch (e) { setMsg({ t: 'err', m: String(e.message) }) } finally { setSaving(false) }
  }

  const load = () => list('users?select=*&is_active=is.true&order=created_at.desc').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => { load() }, [])

  async function disableUser(u) {
    if (!window.confirm(`ปิดใช้งานพนักงาน "${u.full_name}"?`)) return
    try { const o = await rpc('set_user_active', { p_id: u.id, p_active: false }); if (!o.ok) throw new Error(o.error); load() }
    catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }

  async function submit(e) {
    e.preventDefault(); setMsg(null)
    try {
      await insert('users', {
        tenant_id: tenantId(),
        employee_code: form.employee_code.trim(),
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        role: form.role,
        daily_wage: form.daily_wage ? Number(form.daily_wage) : null,
        weekly_day_off: form.weekly_day_off === '' ? null : Number(form.weekly_day_off),
      })
      setMsg({ t: 'ok', m: `เพิ่ม ${form.full_name} แล้ว — ให้พนักงาน add เพื่อน OA แล้วลงทะเบียนด้วยรหัส ${form.employee_code} + เบอร์โทร` })
      setForm({ employee_code: '', full_name: '', phone: '', role: 'guard', daily_wage: '', weekly_day_off: '' })
      load()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <div className="section-h"><h2>เพิ่มพนักงาน</h2></div>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label>รหัสพนักงาน *</label><input value={form.employee_code} onChange={set('employee_code')} placeholder="SG-001" required /></div>
          <div className="field"><label>ชื่อ-สกุล *</label><input value={form.full_name} onChange={set('full_name')} required /></div>
          <div className="field"><label>เบอร์โทร</label><input value={form.phone} onChange={set('phone')} inputMode="tel" /></div>
          <div className="field"><label>บทบาท</label>
            <select value={form.role} onChange={set('role')}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="field"><label>ค่าแรง/วัน (บาท)</label><input value={form.daily_wage} onChange={set('daily_wage')} inputMode="numeric" /></div>
          <div className="field"><label>วันหยุดประจำสัปดาห์</label>
            <select value={form.weekly_day_off} onChange={set('weekly_day_off')}>
              <option value="">ไม่กำหนด</option>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <button className="btn inline" type="submit">เพิ่มพนักงาน</button>
        </div>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>พนักงานทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <p className="muted">กำลังโหลด…</p> : (
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>เบอร์</th><th>ค่าแรง/วัน</th><th>LINE</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => edit?.id === u.id ? (
              <tr key={u.id}>
                <td>{u.employee_code}</td>
                <td>{u.full_name}</td>
                <td>
                  <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} style={{ padding: 8 }}>
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} style={{ padding: 8, width: 130 }} inputMode="tel" /></td>
                <td><input value={edit.daily_wage} onChange={(e) => setEdit({ ...edit, daily_wage: e.target.value })} style={{ padding: 8, width: 90 }} inputMode="numeric" /></td>
                <td>{u.line_user_id ? <span className="badge solid">ผูกแล้ว</span> : <span className="badge">ยังไม่ผูก</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="badge solid" style={{ cursor: 'pointer', border: 'none', fontFamily: 'var(--font)', marginRight: 6 }} onClick={saveEdit} disabled={saving}>{saving ? '…' : 'บันทึก'}</button>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => setEdit(null)}>ยกเลิก</button>
                </td>
              </tr>
            ) : (
              <tr key={u.id}>
                <td>{u.employee_code}</td>
                <td>{u.full_name}</td>
                <td>{(ROLES.find(([v]) => v === u.role) || [u.role, u.role])[1]}</td>
                <td>{u.phone || '—'}</td>
                <td>{u.daily_wage ? Number(u.daily_wage).toLocaleString() : '—'}</td>
                <td>{u.line_user_id ? <span className="badge solid">ผูกแล้ว</span> : <span className="badge">ยังไม่ผูก</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none', marginRight: 6 }} onClick={() => startEdit(u)}>แก้ไข</button>
                  <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => disableUser(u)}>ปิดใช้</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
