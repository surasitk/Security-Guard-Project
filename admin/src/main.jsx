import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './theme.css'
import './admin.css'

// ป้ายบอกว่ากำลังใช้ระบบทดสอบ (เฉพาะ build --mode staging) — กันสับสนกับระบบจริง
const ENV_LABEL = import.meta.env.VITE_ENV_LABEL
if (ENV_LABEL) {
  document.title = `[${ENV_LABEL}] ${document.title}`
  const tag = document.createElement('div')
  tag.textContent = ENV_LABEL
  tag.setAttribute('aria-hidden', 'true')
  tag.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;background:#b7791f;color:#fff;font:600 11px/1 sans-serif;letter-spacing:.12em;padding:4px 12px 5px;border-radius:0 0 8px 8px;pointer-events:none'
  document.body.appendChild(tag)
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
