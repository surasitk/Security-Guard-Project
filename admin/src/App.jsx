import { useEffect, useState } from 'react'
import { initAuth, getUser, getVendor, getScope, setScope, switchVendor, list, rpc } from './lib/api'
import Dashboard from './pages/Dashboard.jsx'
import Monitor from './pages/Monitor.jsx'
import People from './pages/People.jsx'
import Properties from './pages/Properties.jsx'
import Checkpoints from './pages/Checkpoints.jsx'
import Shifts from './pages/Shifts.jsx'
import Vendors from './pages/Vendors.jsx'

const BASE_TABS = [
  { key: 'dashboard', label: 'ภาพรวมวันนี้', el: Dashboard },
  { key: 'monitor', label: 'มอนิเตอร์', el: Monitor },
  { key: 'shifts', label: 'ตารางกะ', el: Shifts },
  { key: 'people', label: 'ผู้ใช้และสิทธิ์', el: People },
  { key: 'properties', label: 'โครงการ', el: Properties },
  { key: 'checkpoints', label: 'จุดตรวจ (QR)', el: Checkpoints },
]
const VENDOR_TAB = { key: 'vendors', label: 'Vendors', el: Vendors }

export const ROLE_LABEL = {
  owner: 'เจ้าของ', admin: 'ธุรการ/แอดมิน', supervisor: 'สายตรวจ/ผจก.โซน',
  shift_leader: 'หัวหน้ากะ', guard: 'ยาม', client: 'ลูกค้า',
}
const ADMIN_ROLES = ['owner', 'admin', 'supervisor', 'shift_leader']

export default function App() {
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('dashboard')
  const [isPlatform, setIsPlatform] = useState(false)
  const [vendors, setVendors] = useState([])
  const [props, setProps] = useState([])
  const [scope, setScopeState] = useState(getScope())
  const [ctx, setCtx] = useState(0)        // เปลี่ยนเมื่อสลับ Vendor/โครงการ → หน้าโหลดข้อมูลใหม่
  const [switching, setSwitching] = useState(false)

  async function loadContext() {
    const ps = await list('properties?select=id,name&is_active=is.true&order=name').catch(() => [])
    setProps(ps)
    // โครงการที่จำไว้ไม่อยู่ใน Vendor นี้แล้ว → ล้าง
    if (getScope() && !ps.some((p) => p.id === getScope())) { setScope(''); setScopeState('') }
  }

  useEffect(() => {
    (async () => {
      try {
        const out = await initAuth()
        if (!out) return // กำลัง redirect ไป LINE Login
        if (out.error === 'not_registered') { setState('unregistered'); return }
        if (out.error) { setErr(out.error); setState('error'); return }
        const role = out.user.effective_role || out.user.role
        if (!ADMIN_ROLES.includes(role)) { setState('forbidden'); return }
        let pa = out.user.is_platform_admin
        if (pa === undefined) pa = await rpc('is_platform_admin').catch(() => false)
        setIsPlatform(!!pa)
        if (pa) rpc('list_vendors').then(setVendors).catch(() => {})
        await loadContext()
        setState('ready')
      } catch (e) { setErr(String(e.message || e)); setState('error') }
    })()
  }, [])

  async function onVendor(e) {
    setSwitching(true)
    try {
      const out = await switchVendor(e.target.value)
      if (out?.error) throw new Error(out.error)
      setScopeState('')
      await loadContext()
      setCtx((n) => n + 1)
    } catch (e2) { setErr(String(e2.message || e2)) } finally { setSwitching(false) }
  }

  function onScope(e) {
    setScope(e.target.value); setScopeState(e.target.value); setCtx((n) => n + 1)
  }

  if (state === 'loading') return <Center msg="กำลังเชื่อมต่อ…" />
  if (state === 'unregistered') return <Center msg="บัญชี LINE นี้ยังไม่ได้ลงทะเบียนในระบบ — ให้ผู้ดูแลเพิ่มคุณเป็นผู้ใช้ก่อน แล้วลงทะเบียนผ่านแอปใน LINE" />
  if (state === 'forbidden') return <Center msg="บัญชีของคุณไม่มีสิทธิ์เข้าหลังบ้าน (ต้องเป็นเจ้าของ / แอดมิน / สายตรวจ / หัวหน้ากะ)" />
  if (state === 'error') return <Center msg={`เชื่อมต่อไม่สำเร็จ — ${err}`} />

  const TABS = isPlatform ? [...BASE_TABS, VENDOR_TAB] : BASE_TABS
  const Active = (TABS.find((t) => t.key === tab) || TABS[0]).el
  const user = getUser()
  const vendor = getVendor()
  const role = user.effective_role || user.role
  const roleText = isPlatform ? 'Super Admin' : (ROLE_LABEL[role] || role)

  return (
    <div className="admin-shell">
      <div className="topbar">
        <div>
          <p className="brand">GUARD OS — ADMIN</p>
          <h1>หลังบ้านระบบยาม</h1>
        </div>
        <p className="muted">{user.full_name} · <span className={`badge ${isPlatform ? 'solid' : ''}`}>{roleText}</span></p>
      </div>

      <div className="context-bar">
        <div className="field ctx">
          <label>Vendor</label>
          {isPlatform && vendors.length ? (
            <select value={vendor?.id || ''} onChange={onVendor} disabled={switching}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.id === user.home_tenant_id ? ' (บริษัทของฉัน)' : ''}</option>)}
            </select>
          ) : <div className="ctx-static">{vendor?.name || '—'}</div>}
        </div>
        <div className="field ctx">
          <label>โครงการ</label>
          <select value={scope} onChange={onScope} disabled={switching}>
            <option value="">{['owner', 'admin'].includes(role) ? 'ทุกโครงการ' : 'ทุกโครงการที่ดูแล'} ({props.length})</option>
            {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {switching && <p className="muted" style={{ alignSelf: 'center' }}>กำลังสลับ…</p>}
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <Active key={`${tab}-${ctx}`} scope={scope} isPlatform={isPlatform} vendors={vendors} onContextChange={loadContext} />
    </div>
  )
}

function Center({ msg }) {
  return (
    <div className="page center">
      <div className="spacer" />
      <p className="brand">GUARD OS — ADMIN</p>
      <div className="spacer" />
      <p className="sub">{msg}</p>
    </div>
  )
}
