import { useEffect, useState } from 'react'
import { initAuth, getUser } from './lib/api'
import Dashboard from './pages/Dashboard.jsx'
import Monitor from './pages/Monitor.jsx'
import People from './pages/People.jsx'
import Properties from './pages/Properties.jsx'
import Shifts from './pages/Shifts.jsx'

const TABS = [
  { key: 'dashboard', label: 'ภาพรวมวันนี้', el: Dashboard },
  { key: 'monitor', label: 'มอนิเตอร์', el: Monitor },
  { key: 'shifts', label: 'ตารางกะ', el: Shifts },
  { key: 'people', label: 'พนักงาน', el: People },
  { key: 'properties', label: 'โครงการ', el: Properties },
]

export default function App() {
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('dashboard')

  useEffect(() => {
    (async () => {
      try {
        const out = await initAuth()
        if (!out) return // กำลัง redirect ไป LINE Login
        if (out.error === 'not_registered') { setState('unregistered'); return }
        if (out.error) { setErr(out.error); setState('error'); return }
        if (!['owner', 'admin', 'supervisor'].includes(out.user.role)) { setState('forbidden'); return }
        setState('ready')
      } catch (e) { setErr(String(e.message || e)); setState('error') }
    })()
  }, [])

  if (state === 'loading') return <Center msg="กำลังเชื่อมต่อ…" />
  if (state === 'unregistered') return <Center msg="บัญชี LINE นี้ยังไม่ได้ลงทะเบียนในระบบ — ให้ผู้ดูแลเพิ่มคุณเป็นพนักงานก่อน แล้วลงทะเบียนผ่านแอปใน LINE" />
  if (state === 'forbidden') return <Center msg="บัญชีของคุณไม่มีสิทธิ์เข้าหลังบ้าน (ต้องเป็น owner / admin / supervisor)" />
  if (state === 'error') return <Center msg={`เชื่อมต่อไม่สำเร็จ — ${err}`} />

  const Active = TABS.find((t) => t.key === tab).el
  const user = getUser()

  return (
    <div className="admin-shell">
      <div className="topbar">
        <div>
          <p className="brand">GUARD OS — ADMIN</p>
          <h1>หลังบ้านระบบยาม</h1>
        </div>
        <p className="muted">{user.full_name} · {user.role}</p>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <Active />
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
