// F-SOS — แจ้งเหตุด่วน (rich menu ?page=incident)
// กด SOS → นับถอยหลัง 3 วิ (ยกเลิกได้) → ส่งพิกัด + รูป + เสียง (ถ้าแนบไว้) → push LINE ถึงสายตรวจ/เจ้าของทันที
// แนบรูป/เสียง/ประเภท/ข้อความได้ก่อนกด แต่ไม่บังคับ — เหตุด่วนกดปุ่มเดียวก็ส่งได้
import { useEffect, useRef, useState } from 'react'
import { getUser, rpc, getPosition, compressImage, uploadMedia, withTimeout, notifyLine } from '../lib/api'

const CATS = ['บุกรุก', 'ไฟไหม้', 'ทะเลาะวิวาท', 'บาดเจ็บ/ป่วย', 'ทรัพย์สินเสียหาย', 'อื่นๆ']
const MAX_SEC = 15
const ERR_TH = {
  too_frequent: 'เพิ่งส่งแจ้งเหตุไปเมื่อครู่ — รอสักครู่แล้วส่งซ้ำได้',
  forbidden: 'ไม่มีสิทธิ์แจ้งเหตุ — ลองปิดแล้วเปิดแอปใหม่',
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''
}
const extOf = (mime) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm')

export default function Incident() {
  const user = getUser()
  const [projects, setProjects] = useState([])
  const [prop, setProp] = useState('')
  const [cat, setCat] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState(null)      // { blob, url }
  const [audio, setAudio] = useState(null)      // { blob, url, mime, sec }
  const [rec, setRec] = useState(null)          // { sec }
  const [count, setCount] = useState(null)      // นับถอยหลัง 3..1
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [done, setDone] = useState(null)
  const recRef = useRef(null)
  const timerRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    rpc('my_projects').then((r) => setProjects(r || [])).catch(() => {})
    return () => { clearInterval(timerRef.current); recRef.current?.stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  // นับถอยหลังก่อนส่ง
  useEffect(() => {
    if (count === null) return
    if (count === 0) { setCount(null); send(); return }
    const t = setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [count])

  async function onPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const blob = await compressImage(f, 1280, 0.7)
      setPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch { setMsg({ type: 'err', text: 'เปิดรูปไม่สำเร็จ ลองถ่ายใหม่' }) }
  }

  async function startRec() {
    setMsg(null)
    const mime = pickMime()
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      setMsg({ type: 'err', text: 'เครื่องนี้อัดเสียงในแอปไม่ได้ — พิมพ์รายละเอียดแทน' }); return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks = []
      const started = Date.now()
      mr.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data)
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        clearInterval(timerRef.current)
        const type = mr.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunks, { type })
        setRec(null)
        if (blob.size) setAudio({ blob, url: URL.createObjectURL(blob), mime: type, sec: Math.round((Date.now() - started) / 1000) })
      }
      mr.stream = stream
      recRef.current = mr
      mr.start()
      setRec({ sec: 0 })
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000)
        setRec({ sec: s })
        if (s >= MAX_SEC && mr.state === 'recording') mr.stop()
      }, 250)
    } catch {
      setMsg({ type: 'err', text: 'ไม่ได้รับอนุญาตใช้ไมโครโฟน — อนุญาตใน LINE แล้วลองใหม่' })
    }
  }
  const stopRec = () => { if (recRef.current?.state === 'recording') recRef.current.stop() }

  async function send() {
    if (rec) stopRec()
    setMsg(null)
    let coords = null, photoPath = null, audioPath = null
    try {
      setBusy('กำลังหาตำแหน่ง…')
      try { coords = await withTimeout(getPosition(), 8000, 'gps') } catch { coords = null }
      if (photo) {
        setBusy('กำลังส่งรูป…')
        try { photoPath = await withTimeout(uploadMedia(photo.blob, 'jpg', 'image/jpeg'), 20000, 'photo') } catch { photoPath = null }
      }
      if (audio) {
        setBusy('กำลังส่งเสียง…')
        try { audioPath = await withTimeout(uploadMedia(audio.blob, extOf(audio.mime), audio.mime.split(';')[0]), 20000, 'audio') } catch { audioPath = null }
      }
      setBusy('กำลังแจ้งสายตรวจ…')
      const out = await rpc('report_sos', {
        p_property_id: prop || null,
        p_lat: coords ? coords.latitude : null,
        p_lng: coords ? coords.longitude : null,
        p_photo_url: photoPath, p_audio_url: audioPath,
        p_category: cat || null, p_note: note.trim() || null,
      })
      if (!out?.ok) { setMsg({ type: 'err', text: ERR_TH[out?.error] || `ส่งไม่สำเร็จ (${out?.error})` }); return }
      if (out.notification_id) await notifyLine(out.notification_id)
      setDone({
        at: new Date(), gps: !!coords,
        lost: [(photo && !photoPath) && 'รูป', (audio && !audioPath) && 'เสียง'].filter(Boolean),
      })
      setPhoto(null); setAudio(null); setNote(''); setCat('')
    } catch (e) {
      setMsg({ type: 'err', text: `ส่งไม่สำเร็จ (${String(e.message || e)}) — กดอีกครั้ง หรือโทรหาหัวหน้ากะ` })
    } finally { setBusy('') }
  }

  if (done) {
    return (
      <div className="page">
        <p className="brand">GUARD OS</p>
        <div className="sos-done">
          <div className="sos-check">✓</div>
          <h1>ส่งแจ้งเหตุแล้ว</h1>
          <p className="sub">{done.at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. · แจ้งสายตรวจและเจ้าของทาง LINE แล้ว</p>
          {!done.gps && <div className="notice">ไม่ได้รับพิกัด — แจ้งตำแหน่งทางโทรศัพท์เพิ่มเติม</div>}
          {done.lost.length > 0 && <div className="notice">ส่ง{done.lost.join('และ')}ไม่สำเร็จ — ข้อความแจ้งเหตุไปถึงแล้ว</div>}
          <p className="muted">อยู่ในที่ปลอดภัย และรอการติดต่อกลับ</p>
        </div>
        <button className="btn ghost" onClick={() => setDone(null)}>แจ้งเหตุเพิ่มเติม</button>
      </div>
    )
  }

  const sending = !!busy
  return (
    <div className="page">
      <p className="brand">GUARD OS</p>
      <h1>แจ้งเหตุ</h1>
      <p className="sub">{user?.full_name} · {user?.employee_code}</p>

      {msg && <div className={`notice ${msg.type === 'err' ? 'err' : ''}`}>{msg.text}</div>}

      <div className="sos-wrap">
        {count !== null ? (
          <>
            <button className="sos-btn counting" onClick={() => { setCount(null); send() }} aria-label="ส่งทันที">
              <span className="big">{count}</span><span>แตะเพื่อส่งทันที</span>
            </button>
            <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setCount(null)}>ยกเลิก</button>
          </>
        ) : (
          <button className="sos-btn" disabled={sending} onClick={() => setCount(3)} aria-label="ส่ง SOS">
            {sending ? <><span className="mid">กำลังส่ง</span><span>{busy}</span></> : <><span className="big">SOS</span><span>แตะเพื่อแจ้งเหตุด่วน</span></>}
          </button>
        )}
        <p className="muted center" style={{ marginTop: 12 }}>ส่งพิกัดของคุณ{photo ? ' + รูป' : ''}{audio ? ' + เสียง' : ''} ถึงสายตรวจและเจ้าของทันที</p>
      </div>

      <div className="section-title">แนบข้อมูล (ไม่บังคับ)</div>
      <div className="sos-attach">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
        {photo ? (
          <div className="sos-media">
            <img src={photo.url} alt="รูปที่แนบ" />
            <button className="chip" onClick={() => setPhoto(null)} disabled={sending}>ลบรูป</button>
          </div>
        ) : (
          <button className="sos-tile" onClick={() => fileRef.current?.click()} disabled={sending}>📷<span>ถ่ายรูป</span></button>
        )}
        {rec ? (
          <button className="sos-tile rec" onClick={stopRec}>⏺<span>หยุด {rec.sec}/{MAX_SEC} วิ</span></button>
        ) : audio ? (
          <div className="sos-media">
            <audio src={audio.url} controls preload="metadata" />
            <button className="chip" onClick={() => setAudio(null)} disabled={sending}>ลบเสียง ({audio.sec} วิ)</button>
          </div>
        ) : (
          <button className="sos-tile" onClick={startRec} disabled={sending}>🎙️<span>อัดเสียง {MAX_SEC} วิ</span></button>
        )}
      </div>

      <div className="chips">
        {CATS.map((c) => (
          <button key={c} type="button" className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? '' : c)} disabled={sending}>{c}</button>
        ))}
      </div>
      <div className="field">
        <label>รายละเอียด</label>
        <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น มีคนปีนรั้วด้านหลังอาคาร B" disabled={sending} />
      </div>
      {projects.length > 1 && (
        <div className="field">
          <label>โครงการ</label>
          <select value={prop} onChange={(e) => setProp(e.target.value)} disabled={sending}>
            <option value="">อัตโนมัติ (โครงการที่เข้างานอยู่)</option>
            {projects.map((p) => <option key={p.property_id} value={p.property_id}>{p.property_name}</option>)}
          </select>
        </div>
      )}
      <p className="muted">เหตุร้ายแรงถึงชีวิต โทร 191 (ตำรวจ) · 199 (ดับเพลิง) · 1669 (การแพทย์ฉุกเฉิน) ก่อน</p>
    </div>
  )
}
