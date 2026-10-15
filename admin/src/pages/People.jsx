// ผู้ใช้และสิทธิ์ (โปรไฟล์ผู้ใช้) — ข้อมูลทั่วไป · บทบาท · โครงการที่ได้รับมอบหมาย · วันหยุดประจำสัปดาห์ · Super Admin
// ยามลงทะเบียน LINE เองภายหลังด้วยรหัสพนักงาน+เบอร์ — บทบาทกำหนดจากหน้านี้เท่านั้น
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, tenantId, getUser } from '../lib/api'

const ROLES = [
  ['guard', 'ยาม', 'เข้า-ออกงานตามกะ และเข้างานฉุกเฉินได้ในโครงการที่มีชื่อ (ไม่เกิน 5 โครงการ) · ไม่เข้าหลังบ้าน'],
  ['shift_leader', 'หัวหน้ากะ', 'เหมือนยาม และเข้าหลังบ้านได้เฉพาะโครงการที่ผูกไว้ (ไม่เกิน 10)'],
  ['assistant_supervisor', 'ผู้ช่วยสายตรวจ', 'เช็คอิน/เอาต์ได้ทุกโครงการที่ผูกไว้แม้ไม่มีกะ (ไม่เกิน 10) · ไม่เข้าหลังบ้าน'],
  ['supervisor', 'สายตรวจ/ผจก.โซน', 'เช็คอิน/เอาต์ได้ทุกโครงการที่ผูกไว้แม้ไม่มีกะ (ไม่เกิน 10) · เข้าหลังบ้านเห็นเฉพาะโครงการที่ผูกไว้'],
  ['admin', 'ธุรการ/แอดมิน', 'จัดการได้ทุกโครงการของ Vendor นี้'],
  ['owner', 'เจ้าของ', 'สิทธิ์สูงสุดของ Vendor นี้ เห็นและจัดการทุกโครงการ'],
  ['client', 'ลูกค้า', 'เห็นเฉพาะโครงการที่ผูกไว้ (พอร์ทัลลูกค้าเปิดใน Sprint 4)'],
]
const LIMIT = { guard: 5, shift_leader: 10, assistant_supervisor: 10, supervisor: 10, client: 10 }
const SCOPED = Object.keys(LIMIT)
const DAY_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']
const ERR = {
  forbidden: 'ไม่มีสิทธิ์จัดการ Vendor นี้',
  owner_requires_owner: 'ตั้งบทบาท "เจ้าของ" ได้เฉพาะเจ้าของหรือ Super Admin',
  platform_admin_requires_platform_admin: 'ตั้ง Super Admin ได้เฉพาะ Super Admin',
  cannot_remove_own_platform_admin: 'ถอดสิทธิ์ Super Admin ของตัวเองไม่ได้',
  cannot_change_own_role: 'เปลี่ยนบทบาทของตัวเองไม่ได้',
  last_owner: 'Vendor ต้องมีเจ้าของอย่างน้อย 1 คน',
  duplicate_employee_code: 'รหัสพนักงานนี้มีอยู่แล้วใน Vendor นี้',
  property_not_in_vendor: 'โครงการที่เลือกไม่ใช่ของ Vendor นี้',
  invalid_role: 'บทบาทไม่ถูกต้อง',
  not_found: 'ไม่พบผู้ใช้',
  project_limit_exceeded: 'ผูกโครงการเกินจำนวนที่บทบาทนี้กำหนด',
}
const roleLabel = (r) => (ROLES.find(([v]) => v === r) || [r, r])[1]
const EMPTY = { id: null, tenant_id: '', employee_code: '', full_name: '', phone: '', role: 'guard', daily_wage: '', days_off: [], property_ids: [], platform_admin: false }

export default function People({ isPlatform = false, vendors = [] }) {
  const [rows, setRows] = useState(null)
  const [access, setAccess] = useState({})       // user_id → { property_ids, is_platform_admin }
  const [propsByVendor, setPropsByVendor] = useState({})
  const [form, setForm] = useState(null)         // null = ซ่อนฟอร์ม
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const me = getUser()
  const myRole = me.effective_role || me.role
  const canOwner = isPlatform || myRole === 'owner'

  async function load() {
    try {
      const [us, acc] = await Promise.all([
        list('users?select=*&is_active=is.true&order=created_at.desc'),
        rpc('list_user_access', { p_tenant_id: tenantId() }).catch(() => []),
      ])
      setRows(us)
      setAccess(Object.fromEntries((acc || []).map((a) => [a.user_id, a])))
    } catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }
  async function loadProps(tid) {
    if (!tid || propsByVendor[tid]) return
    const ps = await rpc('list_properties_for_tenant', { p_tenant_id: tid }).catch(() => [])
    setPropsByVendor((m) => ({ ...m, [tid]: ps || [] }))
  }
  useEffect(() => { load(); loadProps(tenantId()) }, [])
  useEffect(() => { if (form?.tenant_id) loadProps(form.tenant_id) }, [form?.tenant_id])

  const propName = useMemo(() => Object.fromEntries((propsByVendor[tenantId()] || []).map((p) => [p.id, p.name])), [propsByVendor])

  function openCreate() { setMsg(null); setForm({ ...EMPTY, tenant_id: tenantId() }) }
  function openEdit(u) {
    setMsg(null)
    const a = access[u.id] || {}
    setForm({
      id: u.id, tenant_id: u.tenant_id, employee_code: u.employee_code || '', full_name: u.full_name || '',
      phone: u.phone || '', role: u.role, daily_wage: u.daily_wage ?? '', days_off: u.weekly_days_off || (u.weekly_day_off != null ? [u.weekly_day_off] : []),
      property_ids: a.property_ids || [], platform_admin: !!a.is_platform_admin,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      const out = await rpc('save_user', {
        p_id: form.id,
        p_tenant_id: form.tenant_id,
        p_employee_code: form.employee_code,
        p_full_name: form.full_name,
        p_phone: form.phone,
        p_role: form.role,
        p_daily_wage: form.daily_wage === '' ? null : Number(form.daily_wage),
        p_weekly_days_off: form.days_off,
        p_property_ids: SCOPED.includes(form.role) ? form.property_ids : [],
        p_platform_admin: isPlatform ? form.platform_admin : null,
      })
      if (!out.ok) throw new Error(ERR[out.error] || out.error)
      const otherVendor = form.tenant_id !== tenantId()
      const vName = vendors.find((v) => v.id === form.tenant_id)?.name
      setMsg({
        t: 'ok',
        m: form.id ? `บันทึก ${form.full_name} แล้ว`
          : `เพิ่ม ${form.full_name}${otherVendor ? ` ใน ${vName}` : ''} แล้ว — ให้ผู้ใช้เพิ่มเพื่อน OA แล้วลงทะเบียนด้วยรหัส ${form.employee_code} + เบอร์โทร${otherVendor ? ' (สลับ Vendor ด้านบนเพื่อดูในรายชื่อ)' : ''}`,
      })
      setForm(null); load()
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) } finally { setBusy(false) }
  }

  async function disableUser(u) {
    if (!window.confirm(`ปิดใช้งาน "${u.full_name}"?`)) return
    try { const o = await rpc('set_user_active', { p_id: u.id, p_active: false }); if (!o.ok) throw new Error(ERR[o.error] || o.error); load() }
    catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const limit = form ? (LIMIT[form.role] || 0) : 0
  const toggleProp = (id) => {
    if (form.property_ids.includes(id)) return setForm({ ...form, property_ids: form.property_ids.filter((x) => x !== id) })
    if (form.property_ids.length >= limit) return
    setForm({ ...form, property_ids: [...form.property_ids, id] })
  }
  const toggleDay = (d) => setForm({ ...form, days_off: form.days_off.includes(d) ? form.days_off.filter((x) => x !== d) : [...form.days_off, d].sort() })
  const roleOptions = ROLES.filter(([v]) => v !== 'owner' || canOwner)
  const formProps = form ? (propsByVendor[form.tenant_id] || []) : []
  const roleDesc = form ? (ROLES.find(([v]) => v === form.role) || [])[2] : ''

  return (
    <div>
      <div className="section-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{form ? (form.id ? `แก้ไขผู้ใช้: ${form.full_name}` : 'เพิ่มผู้ใช้') : 'ผู้ใช้และสิทธิ์'}</h2>
        {!form && <button className="btn inline" onClick={openCreate}>+ เพิ่มผู้ใช้</button>}
      </div>

      {form && (
        <form className="card" onSubmit={save}>
          <div className="form-grid">
            <div className="field"><label>Vendor (บริษัท)</label>
              {isPlatform && !form.id ? (
                <select value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value, property_ids: [] })}>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              ) : <input value={vendors.find((v) => v.id === form.tenant_id)?.name || 'บริษัทปัจจุบัน'} disabled />}
            </div>
            <div className="field"><label>รหัสพนักงาน *</label><input value={form.employee_code} onChange={set('employee_code')} placeholder="SG-001" required /></div>
            <div className="field"><label>ชื่อ-สกุล *</label><input value={form.full_name} onChange={set('full_name')} required /></div>
            <div className="field"><label>เบอร์โทร</label><input value={form.phone} onChange={set('phone')} inputMode="tel" /></div>
            <div className="field"><label>ค่าแรง/วัน (บาท)</label><input value={form.daily_wage} onChange={set('daily_wage')} inputMode="numeric" /></div>
            <div className="form-sep">บทบาทและสิทธิ์</div>
            <div className="field wide"><label>บทบาท *</label>
              <select value={form.role} onChange={set('role')}>{roleOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <p className="hint">{roleDesc}</p>
            </div>
            <div className="form-sep">วันหยุดประจำสัปดาห์</div>
            <div className="field wide"><label>เลือกได้หลายวัน</label>
              <div className="prop-checks">
                {DAYS.map((d, i) => (
                  <label key={i} className={form.days_off.includes(i) ? 'on' : ''}>
                    <input type="checkbox" checked={form.days_off.includes(i)} onChange={() => toggleDay(i)} />{d}
                  </label>
                ))}
              </div>
              <p className="hint">กะที่ตรงวันหยุดจะติดธง OT วันหยุด (2.5x) ตอนจ่ายกะ</p>
            </div>
            <div className="form-sep">โครงการและสิทธิ์พิเศษ</div>
            {SCOPED.includes(form.role) && (
              <div className="field wide">
                <label>โครงการที่ได้รับมอบหมาย ({form.property_ids.length}/{limit})</label>
                {formProps.length ? (
                  <div className="prop-checks">
                    {formProps.map((p) => (
                      <label key={p.id} className={form.property_ids.includes(p.id) ? 'on' : ''} style={!form.property_ids.includes(p.id) && form.property_ids.length >= limit ? { opacity: 0.45 } : undefined}>
                        <input type="checkbox" checked={form.property_ids.includes(p.id)} disabled={!form.property_ids.includes(p.id) && form.property_ids.length >= limit} onChange={() => toggleProp(p.id)} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                ) : <p className="hint">Vendor นี้ยังไม่มีโครงการ — สร้างในแท็บโครงการก่อน</p>}
                {!form.property_ids.length && formProps.length > 0 && <p className="hint">ยังไม่ได้เลือก — ผู้ใช้จะไม่เห็นโครงการใดเลย</p>}
              </div>
            )}

            {isPlatform && (
              <label className="consent" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', gridColumn: '1 / -1' }}>
                <input type="checkbox" checked={form.platform_admin} onChange={(e) => setForm({ ...form, platform_admin: e.target.checked })} style={{ marginTop: 4 }} disabled={form.id === me.id} />
                <span><b>Super Admin</b> — เห็นและสลับดูได้ทุก Vendor สร้าง Vendor ใหม่ และตั้ง Super Admin คนอื่นได้ ควรให้เฉพาะทีมเจ้าของแพลตฟอร์ม</span>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button className="btn inline" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : (form.id ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ใช้')}</button>
            <button className="btn inline ghost" type="button" onClick={() => setForm(null)}>ยกเลิก</button>
          </div>
        </form>
      )}
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="section-h"><h2>ผู้ใช้ทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <p className="muted">กำลังโหลด…</p> : (
        <table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อ</th><th>บทบาท</th><th>โครงการ</th><th>วันหยุด</th><th>เบอร์</th><th>LINE</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => {
              const a = access[u.id] || {}
              const scoped = SCOPED.includes(u.role)
              return (
                <tr key={u.id}>
                  <td>{u.employee_code}</td>
                  <td>{u.full_name}</td>
                  <td>
                    {roleLabel(u.role)}
                    {a.is_platform_admin && <> <span className="badge solid">Super Admin</span></>}
                  </td>
                  <td className="muted">
                    {scoped ? ((a.property_ids || []).map((id) => propName[id]).filter(Boolean).join(', ') || 'ยังไม่ผูก')
                      : (['owner', 'admin'].includes(u.role) ? 'ทุกโครงการ' : '—')}
                  </td>
                  <td>{(u.weekly_days_off || []).length ? u.weekly_days_off.map((d) => DAY_SHORT[d]).join(' ') : '—'}</td>
                  <td>{u.phone || '—'}</td>
                  <td>{u.line_user_id ? <span className="badge solid">ผูกแล้ว</span> : <span className="badge">ยังไม่ผูก</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none', marginRight: 6 }} onClick={() => openEdit(u)}>แก้ไข</button>
                    {u.id !== me.id && <button className="badge" style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: 'none' }} onClick={() => disableUser(u)}>ปิดใช้</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
