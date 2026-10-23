import { lazy, Suspense, useEffect, useState } from 'react'
import { initLiff, silentLogin, readParams, errTh } from './lib/api'
import Register from './pages/Register.jsx'
import Home from './pages/Home.jsx'
import Scan from './pages/Scan.jsx'
import Incident from './pages/Incident.jsx'
const ForceMap = lazy(() => import('./pages/ForceMap.jsx'))   // โหลดแผนที่เฉพาะคนที่เปิดเมนูนี้
import Brand from './components/Brand.jsx'

// อ่านหน้าเป้าหมายจาก ?page= (rich menu ยิงคนละลิงก์)
function targetPage() {
  const p = readParams().get('page')
  // 'leave' (ปุ่ม "แจ้งลา" เดิมใน rich menu) เปลี่ยนเป็นแผนที่กำลังพล — เปลี่ยนแค่รูป rich menu ก็ใช้ได้
  if (p === 'leave' || p === 'map') return 'map'
  return ['scan', 'incident'].includes(p) ? p : 'home'
}

export default function App() {
  const [state, setState] = useState('loading') // loading | register | ready | error
  const [errMsg, setErrMsg] = useState('')
  const page = targetPage()

  useEffect(() => {
    (async () => {
      try {
        await initLiff()
        const registered = await silentLogin()
        setState(registered ? 'ready' : 'register')
      } catch (e) {
        setErrMsg(errTh(e, 'เข้าสู่ระบบไม่สำเร็จ'))
        setState('error')
      }
    })()
  }, [])

  if (state === 'loading') {
    return (
      <div className="page center">
        <div className="spacer" />
        <Brand />
        <p className="muted">กำลังเชื่อมต่อ…</p>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="page">
        <Brand />
        <div className="notice err">เชื่อมต่อไม่สำเร็จ — {errMsg}<br />ลองปิดแล้วเปิดใหม่ หรือติดต่อหัวหน้ากะ</div>
      </div>
    )
  }
  if (state === 'register') return <Register onDone={() => setState('ready')} />

  if (page === 'scan') return <Scan />
  if (page === 'incident') return <Incident />
  if (page === 'map') return <Suspense fallback={<div className="page center"><div className="spacer" /><Brand /><p className="muted">กำลังโหลดแผนที่…</p></div>}><ForceMap /></Suspense>
  return <Home />
}
