// พนักงาน — รายชื่อ + เพิ่มพนักงานใหม่ (ยามลงทะเบียน LINE เองภายหลังด้วยรหัสพนักงาน+เบอร์)
import { useEffect, useState } from 'react'
import { list, insert, tenantId } from '../lib/api'

const ROLES = [
  ['guard', 'ยาม'], ['shift_leader', 'หัวหน้ากะ'], ['supervisor', 'สายตรวจ/ผจก.โซน'],
  ['admin', 'ธุรการ/แอดมิน'], ['owner', 'เจ้าของ'], ['client', 'ลูกค้า'],
]
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']

export default function People() {
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ employee_code: '', full_name: '', phone: '', role: 'guard', daily_wage: '', weekly_day_off: '' })
  const [msg, setMsg] = useState(null)

  const load = () => list('users?select=*&order=created_at.desc').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => { load() }, [])

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
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>เบอร์</th><th>ค่าแรง/วัน</th><th>LINE</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.employee_code}</td>
                <td>{u.full_name}</td>
                <td>{(ROLES.find(([v]) => v === u.role) || [u.role, u.role])[1]}</td>
                <td>{u.phone || '—'}</td>
                <td>{u.daily_wage ? Number(u.daily_wage).toLocaleString() : '—'}</td>
                <td>{u.line_user_id ? <span className="badge solid">ผูกแล้ว</span> : <span className="badge">ยังไม่ผูก</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
