import { useEffect, useState } from 'react'
import { initLiff, silentLogin, readParams } from './lib/api'
import Register from './pages/Register.jsx'
import Home from './pages/Home.jsx'
import Scan from './pages/Scan.jsx'
import Soon from './pages/Soon.jsx'

// อ่านหน้าเป้าหมายจาก ?page= (rich menu ยิงคนละลิงก์)
function targetPage() {
  const p = readParams().get('page')
  return ['scan', 'incident', 'leave'].includes(p) ? p : 'home'
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
        setErrMsg(String(e.message || e))
        setState('error')
      }
    })()
  }, [])

  if (state === 'loading') {
    return (
      <div className="page center">
        <div className="spacer" />
        <p className="brand">GUARD OS</p>
        <p className="muted">กำลังเชื่อมต่อ…</p>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="page">
        <p className="brand">GUARD OS</p>
        <div className="notice err">เชื่อมต่อไม่สำเร็จ — {errMsg}<br />ลองปิดแล้วเปิดใหม่ หรือติดต่อหัวหน้ากะ</div>
      </div>
    )
  }
  if (state === 'register') return <Register onDone={() => setState('ready')} />

  if (page === 'scan') return <Scan />
  if (page === 'incident') return <Soon title="แจ้งเหตุ" note="ระบบแจ้งเหตุ/บันทึกเหตุการณ์กำลังพัฒนา" />
  if (page === 'leave') return <Soon title="ขอลา" note="ระบบยื่นใบลา/อนุมัติกำลังพัฒนา" />
  return <Home />
}
