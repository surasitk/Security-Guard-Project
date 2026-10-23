// ประกาศกลุ่ม — เลือกโครงการหรือจังหวัด แล้วส่งข้อความถึงทุกคนที่ประจำ/มีกะที่นั่น ผ่าน LINE OA (multicast)
// เช่น แจ้งน้ำท่วม การชุมนุม เปลี่ยนรหัสประตู
// ผู้รับ = ผูกกับโครงการ + มีกะในโครงการช่วง 30 วันก่อน–หลัง (ต้องผูก LINE แล้ว) · RPC broadcast_recipients / send_broadcast
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, callFn, fmtDate, fmtTime, errTh } from '../lib/api'

const TEMPLATES = [
  { k: 'น้ำท่วม', t: 'แจ้งเตือนน้ำท่วม: บริเวณ … มีน้ำท่วมขัง ให้เดินทางเผื่อเวลา หลีกเลี่ยงเส้นทาง … และดูแลทรัพย์สินชั้นล่างของโครงการ' },
  { k: 'การชุมนุม', t: 'แจ้งเตือนการชุมนุม: วันนี้มีการชุมนุมบริเวณ … ให้เพิ่มความระมัดระวัง ปิดทางเข้า-ออกรอง และรายงานสายตรวจทันทีหากมีเหตุผิดปกติ' },
  { k: 'เปลี่ยนรหัสประตู', t: 'แจ้งเปลี่ยนรหัสประตู: ตั้งแต่ … เป็นต้นไป รหัสประตู … เปลี่ยนเป็นรหัสใหม่ — สอบถามรหัสจากหัวหน้ากะ ห้ามส่งต่อรหัสทางแชท' },
]

export default function Broadcast() {
  const [props, setProps] = useState([])
  const [mode, setMode] = useState('property')   // property | province
  const [picked, setPicked] = useState([])
  const [message, setMessage] = useState('')
  const [rcpt, setRcpt] = useState(null)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const loadHistory = () => list('broadcasts?select=*,users:created_by(full_name)&order=created_at.desc&limit=20').then(setHistory).catch(() => {})
  useEffect(() => {
    list('properties?select=id,name,province,is_test&is_active=is.true&order=name').then(setProps).catch(() => {})
    loadHistory()
  }, [])

  const provinces = useMemo(() => [...new Set(props.map((p) => p.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')), [props])
  const args = mode === 'property' ? { p_property_ids: picked, p_provinces: [] } : { p_property_ids: [], p_provinces: picked }

  useEffect(() => {
    if (!picked.length) { setRcpt(null); return }
    let live = true
    rpc('broadcast_recipients', args).then((r) => live && setRcpt(r || [])).catch(() => live && setRcpt([]))
    return () => { live = false }
  }, [mode, picked.join(',')])

  const toggle = (v) => setPicked((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]))
  const options = mode === 'property' ? props.map((p) => ({ v: p.id, l: `${p.is_test ? '🧪 ' : ''}${p.name}` })) : provinces.map((p) => ({ v: p, l: p }))
  const withLine = (rcpt || []).filter((r) => r.has_line).length

  async function send(e) {
    e.preventDefault(); setMsg(null)
    if (!window.confirm(`ส่งประกาศถึง ${withLine} คนทาง LINE?`)) return
    setBusy(true)
    try {
      const out = await rpc('send_broadcast', { ...args, p_message: message })
      if (!out.ok) { setMsg({ t: 'err', m: { no_recipients: 'ยังไม่มีผู้รับที่ผูก LINE', empty_message: 'พิมพ์ข้อความก่อน', forbidden: 'บัญชีนี้ไม่มีสิทธิ์ส่งประกาศ' }[out.error] || errTh(out.error) }); return }
      const r = await callFn('notify-line', { notification_id: out.notification_id }).catch(() => null)
      setMsg(r?.ok ? { t: 'ok', m: `ส่งประกาศถึง ${r.recipients ?? out.recipients} คนแล้ว` } : { t: 'err', m: `บันทึกประกาศแล้ว แต่ส่ง LINE ไม่สำเร็จ — ${errTh(r?.error || 'failed to fetch')}` })
      setMessage(''); loadHistory()
    } finally { setBusy(false) }
  }

  return (
    <div>
      <form className="card" onSubmit={send}>
        <div className="field">
          <label>ส่งถึง</label>
          <div className="chips-row">
            <button type="button" className={`chip ${mode === 'property' ? 'on' : ''}`} onClick={() => { setMode('property'); setPicked([]) }}>ตามโครงการ</button>
            <button type="button" className={`chip ${mode === 'province' ? 'on' : ''}`} onClick={() => { setMode('province'); setPicked([]) }}>ตามจังหวัด/พื้นที่</button>
          </div>
        </div>
        <div className="field">
          <label>{mode === 'property' ? 'เลือกโครงการ' : 'เลือกจังหวัด'} <button type="button" className="link-btn" onClick={() => setPicked(picked.length === options.length ? [] : options.map((o) => o.v))}>{picked.length === options.length && options.length ? 'ล้าง' : 'เลือกทั้งหมด'}</button></label>
          <div className="prop-checks">
            {options.map((o) => (
              <label key={o.v} className={picked.includes(o.v) ? 'on' : ''}>
                <input type="checkbox" checked={picked.includes(o.v)} onChange={() => toggle(o.v)} />{o.l}
              </label>
            ))}
            {!options.length && <span className="muted">{mode === 'province' ? 'ยังไม่มีโครงการที่ระบุจังหวัด' : 'ยังไม่มีโครงการ'}</span>}
          </div>
        </div>
        <div className="field">
          <label>ข้อความ</label>
          <div className="chips-row" style={{ marginBottom: 8 }}>
            {TEMPLATES.map((t) => <button key={t.k} type="button" className="chip" onClick={() => setMessage(t.t)}>{t.k}</button>)}
          </div>
          <textarea className="input" rows={5} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="พิมพ์ประกาศที่ต้องการส่ง" required />
          <p className="hint">{message.length}/1500 ตัวอักษร · ข้อความส่งในนาม LINE OA ของบริษัท</p>
        </div>
        <div className="bc-foot">
          <div className="muted">
            {rcpt === null ? 'เลือกปลายทางเพื่อดูจำนวนผู้รับ' : <>ผู้รับ <b style={{ color: 'var(--ink)' }}>{withLine}</b> คน{rcpt.length > withLine ? ` · ยังไม่ผูก LINE ${rcpt.length - withLine} คน (ไม่ได้รับ)` : ''}</>}
          </div>
          <button className="btn inline" type="submit" disabled={busy || !withLine || !message.trim()}>{busy ? 'กำลังส่ง…' : 'ส่งประกาศทาง LINE'}</button>
        </div>
        {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`} style={{ marginTop: 14 }}>{msg.m}</div>}
      </form>

      <div className="section-h"><h2>ประวัติการส่ง</h2></div>
      {!history.length && <p className="muted">ยังไม่มีประกาศ</p>}
      {history.length > 0 && (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>เวลา</th><th>ข้อความ</th><th>ปลายทาง</th><th>ผู้รับ</th><th>ผู้ส่ง</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(h.created_at)} {fmtTime(h.created_at)}</td>
                  <td style={{ whiteSpace: 'pre-wrap', minWidth: 260 }}>{h.message}</td>
                  <td>{h.provinces?.length ? h.provinces.join(', ') : `${h.property_ids?.length || 0} โครงการ`}</td>
                  <td>{h.recipient_count}</td>
                  <td>{h.users?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
