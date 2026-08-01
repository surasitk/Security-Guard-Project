// F-Scan — สแกน QR จุดตรวจ (patrol checkpoint)
// เปิดจาก rich menu (?page=scan) หรือถูกเปิดพร้อม &code=... (สแกน QR จาก LINE) → auto submit
import { useEffect, useRef, useState } from 'react'
import liff from '@line/liff'
import { getUser, rpc, getPosition, deviceFingerprint, withTimeout } from '../lib/api'

const ERR_TH = {
  checkpoint_not_found: 'ไม่พบจุดตรวจนี้ หรือถูกปิดใช้งาน — ตรวจสอบ QR อีกครั้ง',
  no_active_shift_here: 'คุณยังไม่ได้เข้างานที่โครงการของจุดตรวจนี้ — เข้างานก่อนแล้วค่อยสแกน',
}

function extractCode(raw) {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const c = u.searchParams.get('code')
    if (c) return c.trim()
  } catch { /* ไม่ใช่ URL */ }
  const m = raw.match(/code=([A-Za-z0-9]+)/)
  if (m) return m[1]
  return raw.trim()  // สมมติเป็นรหัสดิบ
}

export default function Scan() {
  const user = getUser()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [msg, setMsg] = useState(null) // {type, text}
  const didAuto = useRef(false)

  async function submit(code) {
    if (!code) { setMsg({ type: 'err', text: 'ไม่พบรหัสจุดตรวจใน QR' }); return }
    setBusy(true); setMsg(null)
    let coords = null, fp = null
    try {
      setStep('กำลังหาตำแหน่ง…')
      try { coords = await withTimeout(getPosition(), 8000, 'gps') } catch { coords = null }
      try { fp = await deviceFingerprint() } catch { fp = null }
      setStep('กำลังบันทึกการสแกน…')
      const out = await rpc('scan_checkpoint', {
        p_code: code,
        p_lat: coords ? coords.latitude : null,
        p_lng: coords ? coords.longitude : null,
        p_selfie_url: null,
        p_device_fingerprint: fp,
        p_user_agent: navigator.userAgent,
      })
      if (out.ok) {
        const t = new Date(out.scanned_at || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        const nogps = coords ? '' : ' · ไม่มีพิกัด'
        setMsg({ type: 'ok', text: `✓ สแกนจุด "${out.checkpoint}" สำเร็จ ${t}${nogps}` })
      } else {
        setMsg({ type: 'err', text: ERR_TH[out.error] || `สแกนไม่สำเร็จ (${out.error})` })
      }
    } catch (e) {
      setMsg({ type: 'err', text: `สแกนไม่สำเร็จ (${String(e.message || e)}) — ลองใหม่` })
    } finally { setBusy(false); setStep('') }
  }

  // ถ้าเปิดมาพร้อม code ใน URL (สแกนจาก LINE) → ยิงเลย
  useEffect(() => {
    if (didAuto.current) return
    const code = new URLSearchParams(window.location.search).get('code')
    if (code) { didAuto.current = true; submit(code.trim()) }
  }, [])

  async function scanNow() {
    setMsg(null)
    try {
      if (!liff.isApiAvailable || !liff.scanCodeV2) throw new Error('unsupported')
      const res = await liff.scanCodeV2()
      const code = extractCode(res?.value)
      await submit(code)
    } catch (e) {
      const m = String(e?.message || e)
      setMsg({ type: 'err', text: m === 'unsupported'
        ? 'เครื่องนี้เปิดกล้องสแกนใน LINE ไม่ได้ — ใช้แอปกล้องสแกน QR แล้วเปิดลิงก์ หรือกรอกรหัสด้านล่าง'
        : `เปิดกล้องไม่สำเร็จ (${m})` })
    }
  }

  const [manual, setManual] = useState('')

  return (
    <div className="page">
      <p className="brand">GUARD OS</p>
      <h1>สแกนจุดตรวจ</h1>
      <p className="sub">{user?.full_name} · {user?.employee_code}</p>

      {busy && <div className="notice"><div className="bar"><span /></div>{step}</div>}
      {msg && <div className={`notice ${msg.type === 'err' ? 'err' : ''}`}>{msg.text}</div>}

      {!busy && (
        <>
          <button className="btn" onClick={scanNow}>สแกน QR จุดตรวจ</button>
          <div className="spacer" />
          <div className="card">
            <div className="k">กรอกรหัสจุดตรวจเอง (กรณีสแกนไม่ได้)</div>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="เช่น CP1A2B3C4D5E6F"
              style={{ marginTop: 8, textTransform: 'uppercase' }} />
            <button className="btn ghost" style={{ marginTop: 10 }} disabled={!manual.trim()}
              onClick={() => submit(manual.trim().toUpperCase())}>ยืนยันรหัส</button>
          </div>
        </>
      )}
    </div>
  )
}
