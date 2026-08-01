// F3 — เข้างาน / ออกงาน: ถ่ายรูป → อัปโหลด → ขอ GPS (ถ้าไม่ได้ ให้เข้างานแบบไม่มีพิกัด+ติดธง) → RPC
import { useEffect, useRef, useState } from 'react'
import {
  getUser, rpc, list, getPosition, compressImage, uploadSelfie, deviceFingerprint, withTimeout,
} from '../lib/api'

const ERROR_TH = {
  not_your_assignment: 'กะนี้ไม่ใช่ของคุณ',
  wrong_status: 'กะนี้ลงเวลาไปแล้ว',
  outside_time_window: 'อยู่นอกช่วงเวลาของกะ',
  not_checked_in: 'ยังไม่ได้ลงเวลาเข้างานของกะนี้',
  device_blocked: 'เครื่องนี้ถูกระงับการใช้งาน — ติดต่อหัวหน้ากะ',
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (ts) => new Date(ts).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Home() {
  const user = getUser()
  const [shifts, setShifts] = useState(null)
  const [upcoming, setUpcoming] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [msg, setMsg] = useState(null)          // {type:'ok'|'err', text}
  const [gpsFallback, setGpsFallback] = useState(null) // { action, selfiePath, fp } เมื่อ GPS ล้มเหลว
  const fileRef = useRef(null)
  const pendingAction = useRef(null)

  async function loadShifts() {
    const rows = await rpc('my_current_assignments')
    setShifts(rows)
    setSelected(rows.length === 1 ? rows[0] : null)
    const now = new Date().toISOString()
    const week = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const up = await list(`shift_assignments?select=id,starts_at,ends_at,is_holiday_work,status,properties(name)&starts_at=gt.${now}&starts_at=lt.${week}&status=eq.scheduled&order=starts_at&limit=15`)
    setUpcoming(up.filter((u) => !rows.some((r) => r.assignment_id === u.id)))
  }
  useEffect(() => { loadShifts().catch(() => setShifts([])) }, [])

  function startAction(action) {
    setMsg(null); setGpsFallback(null)
    pendingAction.current = action
    fileRef.current.click()
  }

  // ยิง RPC จริง — coords อาจเป็น null (เข้างานแบบไม่มีพิกัด)
  async function doSubmit(action, selfiePath, fp, coords) {
    setStep('กำลังบันทึกเวลา…'); setBusy(true)
    try {
      const out = action === 'in'
        ? await rpc('check_in', {
            p_assignment_id: selected.assignment_id,
            p_lat: coords ? coords.latitude : null, p_lng: coords ? coords.longitude : null,
            p_selfie_url: selfiePath, p_device_fingerprint: fp, p_user_agent: navigator.userAgent, p_gps_is_mock: false,
          })
        : await rpc('check_out', {
            p_assignment_id: selected.assignment_id,
            p_lat: coords ? coords.latitude : null, p_lng: coords ? coords.longitude : null, p_selfie_url: selfiePath,
          })
      if (out.ok) {
        setGpsFallback(null)
        if (action === 'in') {
          const late = out.late_minutes > 0 ? ` (สาย ${out.late_minutes} นาที)` : ' ตรงเวลา'
          const nogps = out.no_gps ? ' · ไม่มีพิกัด — หัวหน้าจะตรวจสอบ' : ''
          setMsg({ type: 'ok', text: `✓ เข้างานสำเร็จ ${fmtTime(new Date().toISOString())}${late}${nogps}` })
        } else {
          setMsg({ type: 'ok', text: `✓ ออกงานสำเร็จ ${fmtTime(new Date().toISOString())}` })
        }
        await loadShifts()
      } else if (out.error === 'outside_geofence') {
        setMsg({ type: 'err', text: `คุณอยู่ห่างพื้นที่ ${Math.round(out.distance_m)} เมตร — เข้าใกล้จุดปฏิบัติงานแล้วลองใหม่` })
      } else {
        setMsg({ type: 'err', text: ERROR_TH[out.error] || `ไม่สำเร็จ (${out.error})` })
      }
    } catch (e) {
      setMsg({ type: 'err', text: `บันทึกไม่สำเร็จ (${String(e.message || e)}) — ลองใหม่` })
    } finally { setBusy(false); setStep('') }
  }

  async function onSelfie(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selected) return
    const action = pendingAction.current
    setBusy(true); setMsg(null); setGpsFallback(null)
    let selfiePath, fp
    try {
      setStep('กำลังเตรียมรูป…')
      const blob = await withTimeout(compressImage(file), 15000, 'compress')
      setStep('กำลังอัปโหลดรูป…')
      selfiePath = await withTimeout(uploadSelfie(blob), 30000, 'upload')
      fp = await deviceFingerprint()
    } catch (err) {
      const m = String(err?.message || err)
      setMsg({ type: 'err', text: m === 'timeout:upload' ? 'อัปโหลดรูปช้าเกินไป — สัญญาณเน็ตอ่อน ลองใหม่' : `เตรียมรูปไม่สำเร็จ (${m})` })
      setBusy(false); setStep(''); return
    }
    // รูปพร้อมแล้ว → ลองขอ GPS แบบเร็ว
    setStep('กำลังหาตำแหน่ง…')
    try {
      const coords = await withTimeout(getPosition(), 12000, 'gps')
      await doSubmit(action, selfiePath, fp, coords)
    } catch (err) {
      // GPS ล้มเหลว → ไม่ error ทิ้ง แต่ให้ทางเลือกเข้างานแบบไม่มีพิกัด (รูปอัปแล้ว)
      setBusy(false); setStep('')
      setGpsFallback({ action, selfiePath, fp })
      setMsg({ type: 'err', text: 'หาตำแหน่งไม่ได้ (อยู่ในอาคาร/สัญญาณอ่อน) — กดปุ่มด้านล่างเพื่อเข้างานโดยไม่มีพิกัด ระบบจะติดธงให้หัวหน้าตรวจสอบ' })
    }
  }

  return (
    <div className="page">
      <p className="brand">GUARD OS</p>
      <h1>สวัสดี {user?.full_name}</h1>
      <p className="sub">รหัสพนักงาน {user?.employee_code}</p>

      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onSelfie} />

      {shifts === null && <p className="muted">กำลังโหลดกะ…</p>}

      {shifts?.length === 0 && (
        <div className="card">
          <div className="k">กะของคุณ</div>
          <div className="v">ไม่มีกะในช่วงเวลานี้</div>
          <p className="muted" style={{ marginTop: 8 }}>หากคิดว่าข้อมูลผิด ติดต่อหัวหน้ากะ</p>
        </div>
      )}

      {shifts?.map((s) => (
        <div key={s.assignment_id} className="card" onClick={() => setSelected(s)}
          style={{ cursor: 'pointer', borderColor: selected?.assignment_id === s.assignment_id ? 'var(--ink)' : 'var(--line)', borderWidth: selected?.assignment_id === s.assignment_id ? 2 : 1 }}>
          <div className="k">{s.status === 'checked_in' ? '● กำลังปฏิบัติงาน' : 'กะที่กำลังจะถึง'}</div>
          <div className="v">{s.property_name}{s.unit_name ? ` · ${s.unit_name}` : ''}</div>
          <p className="muted" style={{ marginTop: 6 }}>
            {fmtTime(s.starts_at)} – {fmtTime(s.ends_at)}{s.checked_in_at && ` · เข้างาน ${fmtTime(s.checked_in_at)}`}
          </p>
        </div>
      ))}

      {busy && <div className="notice"><div className="bar"><span /></div>{step}</div>}
      {msg && <div className={`notice ${msg.type === 'err' ? 'err' : ''}`}>{msg.text}</div>}

      {gpsFallback && !busy && (
        <button className="btn ghost" onClick={() => doSubmit(gpsFallback.action, gpsFallback.selfiePath, gpsFallback.fp, null)}>
          {gpsFallback.action === 'in' ? 'เข้างานโดยไม่มีพิกัด' : 'ออกงานโดยไม่มีพิกัด'}
        </button>
      )}

      {selected && selected.status === 'scheduled' && !gpsFallback && (
        <button className="btn" onClick={() => startAction('in')} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'เข้างาน (ถ่ายรูปยืนยัน)'}
        </button>
      )}
      {selected && selected.status === 'checked_in' && !gpsFallback && (
        <button className="btn" onClick={() => startAction('out')} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'ออกงาน (ถ่ายรูปยืนยัน)'}
        </button>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="spacer" />
          <p className="brand" style={{ marginBottom: 8 }}>กะล่วงหน้า 7 วัน</p>
          {upcoming.map((u) => (
            <div key={u.id} className="card" style={{ padding: '14px 18px', marginBottom: 8 }}>
              <div className="v" style={{ fontSize: 15 }}>{fmtDay(u.starts_at)}{u.is_holiday_work ? ' · วันหยุด (OT)' : ''}</div>
              <p className="muted" style={{ marginTop: 4 }}>{u.properties?.name} · {fmtTime(u.starts_at)}–{fmtTime(u.ends_at)}</p>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
