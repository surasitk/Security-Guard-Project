import { lazy, Suspense, useEffect, useState } from 'react'
import { initLiff, silentLogin, readParams, errTh, wasKicked, relogin } from './lib/api'
import Register from './pages/Register.jsx'
import Home from './pages/Home.jsx'
import Scan from './pages/Scan.jsx'
import Incident from './pages/Incident.jsx'
const ForceMap = lazy(() => import('./pages/ForceMap.jsx'))   // โหลดแผนที่เฉพาะคนที่เปิดเมนูนี้
import Brand from './components/Brand.jsx'
import { SkPage } from './components/Skeleton.jsx'

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
      if (wasKicked()) { setState('kicked'); return }
      try {
        await initLiff()
        const registered = await silentLogin()
        setState(registered ? 'ready' : 'register')
      } catch (e) {
        setErrMsg(errTh(e, 'เข้าสู่ระบบไม่สำเร็จ'))
        setState(['account_banned', 'account_disabled'].includes(e?.code) ? 'blocked' : 'error')
      }
    })()
  }, [])

  if (state === 'loading') return <SkPage cards={readParams().get('page') === 'map' ? 4 : 2} map={readParams().get('page') === 'map'} />
  if (state === 'error') {
    return (
      <div className="page">
        <Brand />
        <div className="notice err">เชื่อมต่อไม่สำเร็จ — {errMsg}<br />ลองปิดแล้วเปิดใหม่ หรือติดต่อหัวหน้ากะ</div>
      </div>
    )
  }
  if (state === 'blocked') {   // ถูกแบน / ปิดใช้ — แสดงเหตุผลและเวลาสิ้นสุด
    return (
      <div className="page">
        <Brand />
        <div className="card fmp-deny" role="alert" style={{ marginTop: 16 }}>
          <div className="v">ใช้งานไม่ได้ในขณะนี้</div>
          <p className="muted" style={{ whiteSpace: 'pre-line' }}>{errMsg}</p>
          <p className="muted" style={{ marginTop: 8 }}>สอบถามหัวหน้างานหรือแอดมินของบริษัท</p>
        </div>
      </div>
    )
  }
  if (state === 'kicked') {
    return (
      <div className="page">
        <Brand />
        <div className="card fmp-deny" role="alert" style={{ marginTop: 16 }}>
          <div className="v">คุณถูกออกจากระบบโดยผู้ดูแล</div>
          <p className="muted">กรุณาเข้าสู่ระบบด้วย LINE อีกครั้งเพื่อใช้งานต่อ</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={relogin}>เข้าสู่ระบบด้วย LINE</button>
        </div>
      </div>
    )
  }
  if (state === 'register') return <Register onDone={() => setState('ready')} />

  if (page === 'scan') return <Scan />
  if (page === 'incident') return <Incident />
  if (page === 'map') return <Suspense fallback={<SkPage cards={4} map />}><ForceMap /></Suspense>
  return <Home />
}
