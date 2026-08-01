import { useEffect, useState } from 'react'
import { initLiff, silentLogin } from './lib/api'
import Register from './pages/Register.jsx'
import Home from './pages/Home.jsx'

export default function App() {
  const [state, setState] = useState('loading') // loading | register | home | error
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    (async () => {
      try {
        await initLiff()
        const registered = await silentLogin()
        setState(registered ? 'home' : 'register')
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
  if (state === 'register') return <Register onDone={() => setState('home')} />
  return <Home />
}
