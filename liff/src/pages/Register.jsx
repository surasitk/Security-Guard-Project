// F1 — ลงทะเบียนผูกบัญชี LINE (ครั้งเดียวต่อ user) + PDPA consent
import { useState } from 'react'
import { register } from '../lib/api'

const CONSENT_VERSION = import.meta.env.VITE_CONSENT_VERSION || '2026-08-01'

const ERROR_TH = {
  no_matching_employee: 'ไม่พบข้อมูลพนักงานที่ตรงกัน — ตรวจรหัสพนักงานและเบอร์โทร หรือติดต่อธุรการ',
  line_already_bound: 'บัญชี LINE นี้ถูกผูกกับพนักงานอื่นแล้ว — ติดต่อธุรการ',
  consent_required: 'กรุณายอมรับข้อตกลงการใช้ข้อมูลก่อน',
}

export default function Register({ onDone }) {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setErr('')
    if (!code.trim() || !phone.trim()) { setErr('กรอกรหัสพนักงานและเบอร์โทรให้ครบ'); return }
    if (!consent) { setErr(ERROR_TH.consent_required); return }
    setBusy(true)
    try {
      const out = await register(code, phone, CONSENT_VERSION)
      if (out.ok) onDone()
      else setErr(ERROR_TH[out.error] || `ลงทะเบียนไม่สำเร็จ (${out.error})`)
    } catch {
      setErr('เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <p className="brand">GUARD OS</p>
      <h1>ลงทะเบียน</h1>
      <p className="sub">ผูกบัญชี LINE กับข้อมูลพนักงาน ทำครั้งเดียว</p>

      <div className="field">
        <label>รหัสพนักงาน</label>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="เช่น SG-0042" />
      </div>
      <div className="field">
        <label>เบอร์โทรที่แจ้งไว้กับบริษัท</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08x-xxx-xxxx" />
      </div>

      <label className="consent" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '20px 0' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 4 }} />
        <span>
          ข้าพเจ้ายินยอมให้บริษัทเก็บและใช้ข้อมูลส่วนบุคคล ได้แก่ รูปถ่ายยืนยันตัวตน
          และพิกัดตำแหน่งขณะปฏิบัติงาน เพื่อการลงเวลาทำงานและการตรวจสอบการปฏิบัติหน้าที่
          ตามนโยบายคุ้มครองข้อมูลส่วนบุคคล (ฉบับ {CONSENT_VERSION})
        </span>
      </label>

      {err && <div className="notice err">{err}</div>}

      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? 'กำลังลงทะเบียน…' : 'ลงทะเบียน'}
      </button>
    </div>
  )
}
