// F3 — เข้างาน / ออกงาน
// · กะปกติ: เช็คอินได้ก่อนเวลา 45 นาที · เช็คเอาต์ได้ถึง 1 ชม. หลังจบกะ · ออกก่อนเวลาต้องใส่เหตุผล (แจ้ง Admin ทาง LINE)
// · สายตรวจ/ผู้ช่วยสายตรวจ: เช็คอินได้แม้ไม่มีกะ → เลือกโครงการที่ได้รับมอบหมาย → ยืนยัน
// · รปภ./หัวหน้ากะ: เข้างานฉุกเฉิน (แทนคน) ในโครงการที่มีชื่อ
// · ต้องเช็คเอาต์ก่อน ถึงเช็คอินใหม่ได้
// ขั้นตอนบันทึก: ถ่ายรูป → อัปโหลด → ขอ GPS (ไม่ได้ = บันทึกแบบไม่มีพิกัด+ติดธง) → RPC
import { useEffect, useRef, useState } from 'react'
import {
  getUser, rpc, list, getPosition, compressImage, uploadSelfie, deviceFingerprint, withTimeout, notifyLine, errTh, sendGpsEvidence,
} from '../lib/api'
import ShiftCalendar from '../components/ShiftCalendar.jsx'
import Brand from '../components/Brand.jsx'
import { SkCards } from '../components/Skeleton.jsx'

const ERROR_TH = {
  not_your_assignment: 'กะนี้ไม่ใช่ของคุณ',
  wrong_status: 'กะนี้ลงเวลาไปแล้ว',
  outside_time_window: 'ยังไม่ถึงเวลา — เช็คอินได้ก่อนเริ่มกะไม่เกิน 45 นาที',
  not_checked_in: 'ยังไม่ได้ลงเวลาเข้างานของกะนี้',
  device_blocked: 'เครื่องนี้ถูกระงับการใช้งาน — ติดต่อหัวหน้ากะ',
  already_checked_in: 'คุณยังไม่ได้เช็คเอาต์งานก่อนหน้า — เช็คเอาต์ก่อนแล้วค่อยเช็คอินใหม่',
  use_scheduled_shift: 'คุณมีกะตามตารางช่วงนี้ — ใช้ปุ่มเข้างานของกะนั้นแทน',
  not_member_of_project: 'คุณไม่ได้รับมอบหมายในโครงการนี้',
  checkout_window_closed: 'เลยเวลาเช็คเอาต์แล้ว (เกิน 1 ชม. หลังจบกะ) — ติดต่อหัวหน้าให้ปิดกะ',
  reason_required: 'กรุณาใส่เหตุผลที่ออกก่อนเวลา',
  next_shift_too_soon: 'กะถัดไปของคุณใกล้เริ่มแล้ว — รอเข้างานตามกะ',
  role_not_allowed: 'ตำแหน่งของคุณใช้เช็คอินแบบนี้ไม่ได้',
  property_not_found: 'ไม่พบโครงการนี้ หรือถูกปิดใช้งาน',
  platform_admin_test_only: 'Super Admin เข้างานได้เฉพาะโครงการทดสอบ',
  no_slot_now: 'ตอนนี้ยังไม่ถึงช่วงกะของโครงการ — เข้าได้ก่อนเริ่มช่วงกะ 45 นาที',
  no_slots_defined: 'โครงการนี้ยังไม่ได้ตั้งช่วงกะ — ติดต่อผู้ดูแล',
  project_not_open_mode: 'โครงการนี้ใช้การจัดกะล่วงหน้า — รอหัวหน้าจ่ายกะให้',
  overlaps_existing_shift: 'ช่วงเวลานี้ชนกับกะอื่นของคุณ',
}
const REASONS = ['ป่วย / ไม่สบาย', 'ธุระด่วนทางบ้าน', 'หัวหน้าสั่งให้ออก', 'สลับกะกับเพื่อนแล้ว']
const FIELD_ROLES = ['supervisor', 'assistant_supervisor', 'trainer', 'spare']   // เช็คอินได้แม้ไม่มีกะ
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (ts) => new Date(ts).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })
const KIND_LABEL = { adhoc: 'เช็คอินโครงการ', emergency: 'เข้างานฉุกเฉิน', open: 'ตามช่วงกะ' }
const ROLE_TH = { guard: 'รปภ.', shift_leader: 'หัวหน้ากะ', zone_manager: 'ผู้จัดการโซน', supervisor: 'สายตรวจ', assistant_supervisor: 'ผู้ช่วยสายตรวจ', trainer: 'ครูฝึก', spare: 'ตัวสแปร์', admin: 'แอดมิน', owner: 'เจ้าของ', client: 'ลูกค้า' }

export default function Home() {
  const user = getUser()
  const isField = FIELD_ROLES.includes(user?.role)
  const [isPlatform, setIsPlatform] = useState(false)    // Super Admin: เข้างานได้เฉพาะโครงการทดสอบ
  const canEmergency = ['guard', 'shift_leader'].includes(user?.role) || isPlatform

  const [shifts, setShifts] = useState(null)
  const [projects, setProjects] = useState([])
  const [calKey, setCalKey] = useState(0)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [msg, setMsg] = useState(null)               // {type:'ok'|'err', text}
  const [gpsFallback, setGpsFallback] = useState(null)
  // ขั้นตอนบนจอ: null | 'pick' (เลือกโครงการ) | 'confirm' | 'reason' (เหตุผลออกก่อนเวลา)
  const [flow, setFlow] = useState(null)
  const [pickProp, setPickProp] = useState(null)
  const [flowMode, setFlowMode] = useState('adhoc')     // 'adhoc' (ไม่มีกะ/ฉุกเฉิน) | 'open' (โครงการไม่จัดกะ)
  const [reason, setReason] = useState('')
  const fileRef = useRef(null)
  const pending = useRef(null)                       // { type:'in'|'out'|'adhoc', assignment, property, reason }

  async function load() {
    const [rows, projs] = await Promise.all([
      rpc('my_current_assignments'),
      rpc('my_projects').catch(() => []),
    ])
    setShifts(rows); setProjects(projs || [])
    const cur = rows.find((r) => r.status === 'checked_in')
    setSelected(cur || (rows.length === 1 ? rows[0] : null))
    setCalKey((k) => k + 1)
  }
  useEffect(() => {
    load().catch(() => setShifts([]))
    rpc('is_platform_admin').then((v) => setIsPlatform(!!v)).catch(() => {})
  }, [])

  const current = shifts?.find((s) => s.status === 'checked_in') || null
  const scheduled = (shifts || []).filter((s) => s.status === 'scheduled')
  const pastDeadline = current && current.checkout_deadline && new Date() > new Date(current.checkout_deadline)
  const isEarly = current && current.kind === 'scheduled' && new Date() < new Date(current.ends_at)

  function openCamera(action) {
    setMsg(null); setGpsFallback(null)
    pending.current = action
    fileRef.current.click()
  }

  function startCheckout() {
    if (isEarly) { setReason(''); setFlow('reason'); return }
    openCamera({ type: 'out', assignment: current })
  }

  async function doSubmit(action, selfiePath, fp, coords) {
    setStep('กำลังบันทึกเวลา…'); setBusy(true)
    const lat = coords ? coords.latitude : null
    const lng = coords ? coords.longitude : null
    try {
      let out
      if (action.type === 'in') {
        out = await rpc('check_in', {
          p_assignment_id: action.assignment.assignment_id, p_lat: lat, p_lng: lng,
          p_selfie_url: selfiePath, p_device_fingerprint: fp, p_user_agent: navigator.userAgent, p_gps_is_mock: false,
        })
      } else if (action.type === 'adhoc' || action.type === 'open') {
        out = await rpc(action.type === 'open' ? 'open_check_in' : 'adhoc_check_in', {
          p_property_id: action.property.property_id, p_lat: lat, p_lng: lng,
          p_selfie_url: selfiePath, p_device_fingerprint: fp, p_user_agent: navigator.userAgent, p_gps_is_mock: false,
        })
      } else {
        out = await rpc('check_out', {
          p_assignment_id: action.assignment.assignment_id, p_lat: lat, p_lng: lng,
          p_selfie_url: selfiePath, p_reason: action.reason || null,
        })
      }
      if (out.ok) {
        if (coords) sendGpsEvidence(action.type === 'out' ? 'out' : 'in', coords)   // เบื้องหลัง ไม่รอ
        setGpsFallback(null); setFlow(null); setPickProp(null)
        const t = fmtTime(new Date().toISOString())
        const nogps = out.no_gps ? ' · ไม่มีพิกัด — หัวหน้าจะตรวจสอบ' : ''
        if (action.type === 'in') {
          const late = out.late_minutes > 0 ? ` (สาย ${out.late_minutes} นาที)` : ' ตรงเวลา'
          setMsg({ type: 'ok', text: `✓ เข้างานสำเร็จ ${t}${late}${nogps}` })
        } else if (action.type === 'open') {
          const late = out.late_minutes > 0 ? ` (สาย ${out.late_minutes} นาที)` : ' ตรงเวลา'
          setMsg({ type: 'ok', text: `✓ เข้างาน${out.slot ? `กะ${out.slot}` : ''}ที่ ${out.property} ${t}${late}${nogps}` })
        } else if (action.type === 'adhoc') {
          setMsg({ type: 'ok', text: `✓ ${out.kind === 'emergency' ? 'เข้างานฉุกเฉิน' : 'เช็คอิน'}ที่ ${out.property} สำเร็จ ${t}${nogps}` })
        } else {
          if (out.notification_id) notifyLine(out.notification_id)
          setMsg({ type: 'ok', text: out.early_leave_minutes > 0
            ? `✓ ออกงานสำเร็จ ${t} (ก่อนเวลา ${out.early_leave_minutes} นาที) · แจ้งผู้ดูแลแล้ว`
            : `✓ ออกงานสำเร็จ ${t}` })
        }
        await load()
      } else if (out.error === 'outside_geofence') {
        setMsg({ type: 'err', text: `คุณอยู่ห่างพื้นที่ ${Math.round(out.distance_m)} เมตร — เข้าใกล้จุดปฏิบัติงานแล้วลองใหม่` })
      } else {
        setMsg({ type: 'err', text: ERROR_TH[out.error] || errTh(out.error) })
        if (out.error === 'checkout_window_closed' || out.error === 'already_checked_in') load().catch(() => {})
      }
    } catch (e) {
      setMsg({ type: 'err', text: `บันทึกไม่สำเร็จ (${errTh(e)}) — ลองใหม่` })
    } finally { setBusy(false); setStep('') }
  }

  async function onSelfie(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const action = pending.current
    if (!file || !action) return
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
      setMsg({ type: 'err', text: m === 'timeout:upload' ? 'อัปโหลดรูปช้าเกินไป — สัญญาณเน็ตอ่อน ลองใหม่' : `เตรียมรูปไม่สำเร็จ — ${errTh(err, 'ถ่ายรูปใหม่อีกครั้ง')}` })
      setBusy(false); setStep(''); return
    }
    setStep('กำลังหาตำแหน่ง…')
    try {
      const coords = await withTimeout(getPosition(), 12000, 'gps')
      await doSubmit(action, selfiePath, fp, coords)
    } catch {
      setBusy(false); setStep('')
      setGpsFallback({ action, selfiePath, fp })
      setMsg({ type: 'err', text: 'หาตำแหน่งไม่ได้ (อยู่ในอาคาร/สัญญาณอ่อน) — กดปุ่มด้านล่างเพื่อบันทึกโดยไม่มีพิกัด ระบบจะติดธงให้หัวหน้าตรวจสอบ' })
    }
  }

  const openProjects = projects.filter((p) => p.shift_mode === 'open')
  const schedProjects = projects.filter((p) => p.shift_mode !== 'open')
  const flowList = flowMode === 'open' ? openProjects : isField ? projects : schedProjects
  const flowTitle = flowMode === 'open' ? 'เข้างานตามช่วงกะ' : isField ? 'เช็คอินโครงการ' : isPlatform ? 'เข้างานทดสอบ' : 'เข้างานฉุกเฉิน'
  function startFlow(mode, list) {
    setMsg(null); setFlowMode(mode)
    if (list.length === 1) { setPickProp(list[0]); setFlow('confirm') } else { setPickProp(null); setFlow('pick') }
  }

  return (
    <div className="page">
      <div className="hello">
        <div>
          <Brand />
          <h1>สวัสดี {user?.full_name}</h1>
          <p className="sub">รหัสพนักงาน {user?.employee_code}</p>
        </div>
        <span className="pill role">{isPlatform ? 'Super Admin' : (ROLE_TH[user?.role] || 'พนักงาน')}</span>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onSelfie} />

      {shifts === null && <SkCards n={2} />}

      {current && (
        <div className="card duty on">
          <span className="pill duty">กำลังปฏิบัติงาน</span>
          {current.kind !== 'scheduled' && <span className="pill warn" style={{ marginLeft: 6 }}>{KIND_LABEL[current.kind] || 'นอกตาราง'}</span>}
          <div className="v">{current.property_name}{current.unit_name ? ` · ${current.unit_name}` : ''}</div>
          <p className="when">เข้างาน {fmtTime(current.checked_in_at)} น.{current.kind === 'scheduled' && ` · กะ ${fmtTime(current.starts_at)}–${fmtTime(current.ends_at)}`}</p>
          {current.kind === 'scheduled' && <p className="muted" style={{ marginTop: 4 }}>เช็คเอาต์ได้ถึง {fmtTime(current.checkout_deadline)} น.</p>}
          {current.kind === 'open' && <p className="muted" style={{ marginTop: 4 }}>ควงต่อได้ถึง {fmtDay(current.ends_at)} {fmtTime(current.ends_at)} น. · ออกงานเมื่อเลิกงานจริง</p>}
        </div>
      )}

      {!current && scheduled.map((s) => (
        <div key={s.assignment_id} role="button" tabIndex={0} onClick={() => setSelected(s)} onKeyDown={(e) => e.key === 'Enter' && setSelected(s)}
          className={`card duty ${selected?.assignment_id === s.assignment_id ? 'selected' : ''}`} style={{ cursor: 'pointer' }}>
          <span className="pill">กะของคุณวันนี้</span>
          <div className="v">{s.property_name}{s.unit_name ? ` · ${s.unit_name}` : ''}</div>
          <p className="when">{fmtTime(s.starts_at)} – {fmtTime(s.ends_at)} น.</p>
        </div>
      ))}

      {shifts && !current && scheduled.length === 0 && !flow && (
        <div className="card duty">
          <span className="pill">ตอนนี้</span>
          <div className="v">ไม่มีกะในช่วงเวลานี้</div>
          <p className="muted" style={{ marginTop: 8 }}>
            {isField ? (projects.length ? 'กด "เช็คอินโครงการ" ด้านล่างเพื่อเริ่มงาน' : 'ยังไม่ได้รับมอบหมายโครงการ — ติดต่อผู้ดูแล')
              : openProjects.length ? 'โครงการของคุณไม่ต้องรอจ่ายกะ — กด "เข้างาน · ตามช่วงกะ" ด้านล่างเมื่อถึงเวลา'
              : 'เช็คอินได้ก่อนเริ่มกะ 45 นาที · หากคิดว่าข้อมูลผิด ติดต่อหัวหน้ากะ'}
          </p>
        </div>
      )}

      {busy && <div className="notice info"><div className="bar"><span /></div>{step}</div>}
      {msg && <div className={`notice ${msg.type === 'err' ? 'err' : ''}`}>{msg.text}</div>}

      <div className="dock" hidden={!(gpsFallback && !busy) && !(!gpsFallback && !flow && current) && !(!gpsFallback && !flow && !current && selected?.status === 'scheduled')}>
      {gpsFallback && !busy && (
        <button className="btn ghost" onClick={() => doSubmit(gpsFallback.action, gpsFallback.selfiePath, gpsFallback.fp, null)}>
          {gpsFallback.action.type === 'out' ? 'ออกงานโดยไม่มีพิกัด' : 'เข้างานโดยไม่มีพิกัด'}
        </button>
      )}
      {!gpsFallback && !flow && current && (
        pastDeadline
          ? <div className="notice err">เลยเวลาเช็คเอาต์แล้ว (เกิน 1 ชม. หลังจบกะ) — ติดต่อหัวหน้าให้ปิดกะ</div>
          : <button className="btn" onClick={startCheckout} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : isEarly ? 'ออกงานก่อนเวลา · ถ่ายรูปยืนยัน' : 'ออกงาน · ถ่ายรูปยืนยัน'}
            </button>
      )}
      {!gpsFallback && !flow && !current && selected?.status === 'scheduled' && (
        <button className="btn duty" onClick={() => openCamera({ type: 'in', assignment: selected })} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'เข้างาน · ถ่ายรูปยืนยัน'}
        </button>
      )}
      </div>

      {flow === 'reason' && current && (
        <div className="card">
          <span className="pill warn">ออกงานก่อนเวลา</span>
          <div className="v" style={{ marginTop: 8 }}>กะจบ {fmtTime(current.ends_at)} น.</div>
          <p className="muted">เลือกหรือพิมพ์เหตุผล ระบบจะส่งให้ผู้ดูแลทาง LINE</p>
          <div className="chips">
            {REASONS.map((r) => (
              <button key={r} type="button" className={`chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ออกก่อนเวลา" />
          <button className="btn" disabled={!reason.trim() || busy} onClick={() => openCamera({ type: 'out', assignment: current, reason: reason.trim() })}>
            ยืนยันออกงาน · ถ่ายรูป
          </button>
          <button className="btn ghost" onClick={() => setFlow(null)}>ยกเลิก</button>
        </div>
      )}

      {!current && !gpsFallback && (openProjects.length > 0 || (isField && projects.length > 0) || (canEmergency && schedProjects.length > 0)) && (
        <>
          {!flow && (
            <>
              {openProjects.length > 0 && !isField && (
                <>
                  <button className="btn duty" onClick={() => startFlow('open', openProjects)} disabled={busy}>เข้างาน · ตามช่วงกะ</button>
                  <p className="muted" style={{ marginTop: 6 }}>โครงการแบบไม่จัดกะ: เข้าได้ก่อนเริ่มช่วงกะ 45 นาที · ควงต่อได้ถึง 24 ชม.</p>
                </>
              )}
              {isField && projects.length > 0 && (
                <button className="btn duty" onClick={() => startFlow('adhoc', projects)} disabled={busy}>เช็คอินโครงการ</button>
              )}
              {!isField && canEmergency && schedProjects.length > 0 && (
                <>
                  <div className="spacer" />
                  <button className="btn ghost" onClick={() => startFlow('adhoc', schedProjects)} disabled={busy}>
                    {isPlatform ? 'เข้างานทดสอบ (โครงการ Test)' : 'เข้างานฉุกเฉิน (แทนคน)'}
                  </button>
                  <p className="muted" style={{ marginTop: 6 }}>{isPlatform ? 'Super Admin ลองเข้า-ออกงานแบบรปภ.ได้ในโครงการทดสอบ — ข้อมูลไม่ปนกับลูกค้าและไม่นับในรายงาน' : 'ใช้เมื่อหัวหน้าเรียกให้มาแทนคนที่ขาด ในโครงการที่คุณมีชื่อ'}</p>
                </>
              )}
            </>
          )}
          {flow === 'pick' && (
            <div className="card">
              <span className="pill">{flowTitle}</span>
              <div className="v" style={{ margin: '8px 0 12px' }}>เลือกโครงการ</div>
              {flowList.map((p) => (
                <label key={p.property_id} className="choice">
                  <input type="radio" name="proj" checked={pickProp?.property_id === p.property_id} onChange={() => setPickProp(p)} />
                  <span>{p.property_name}{p.province ? <span className="muted"> · {p.province}</span> : null}</span>
                </label>
              ))}
              <button className="btn" disabled={!pickProp} onClick={() => setFlow('confirm')}>ถัดไป</button>
              <button className="btn ghost" onClick={() => setFlow(null)}>ยกเลิก</button>
            </div>
          )}
          {flow === 'confirm' && pickProp && (
            <div className="card">
              <span className="pill">ยืนยัน{flowTitle}</span>
              <div className="v" style={{ marginTop: 8 }}>{pickProp.property_name}</div>
              <p className="muted" style={{ margin: '6px 0 12px' }}>
                {flowMode === 'open' ? 'ระบบจับเข้าช่วงกะที่กำลังจะเริ่มหรือกำลังดำเนินอยู่ และนับสายจากเวลาเริ่มช่วงกะ · ควงต่อได้ถึง 24 ชม. โดยไม่ต้องกดใหม่'
                  : isField ? 'เวลาเข้างานบันทึกตามเวลาเซิร์ฟเวอร์ · ต้องเช็คเอาต์ก่อนไปเช็คอินโครงการถัดไป'
                  : 'ระบบจะบันทึกเป็นการเข้างานฉุกเฉิน และแสดงให้ผู้ดูแลเห็นในหน้าภาพรวม'}
              </p>
              <button className="btn" disabled={busy} onClick={() => openCamera({ type: flowMode, property: pickProp })}>ยืนยันเข้างาน · ถ่ายรูป</button>
              {flowList.length > 1 ? <button className="btn ghost" onClick={() => setFlow('pick')}>เปลี่ยนโครงการ</button>
                : <button className="btn ghost" onClick={() => setFlow(null)}>ยกเลิก</button>}
            </div>
          )}
        </>
      )}

      <p className="section-title">ตารางกะ</p>
      <ShiftCalendar key={calKey} />
    </div>
  )
}
