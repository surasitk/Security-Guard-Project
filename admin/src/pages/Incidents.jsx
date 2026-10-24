// แจ้งเหตุ SOS แบบ Ticket — รายการ (เรียง/กรองได้) + รายละเอียด: ข้อมูลที่ รปภ. ส่งจาก LINE, แผนที่, รูป, เสียง,
// เปลี่ยนสถานะ + หมายเหตุ และประวัติว่าใครทำอะไรเมื่อไหร่ · รีเฟรชทุก 30 วิ · Export Excel (เวลารับเรื่อง/ปิดเรื่อง)
// ลิงก์ตรง: force.horguard.com/?sos=<id> (จากข้อความ LINE)
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { list, rpc, signedUrl, fmtTime, fmtDate, errTh } from '../lib/api'
import { canEdit } from '../lib/perm'
import { useSort, ResultLine } from '../lib/sortTable.jsx'
import Avatar from '../components/Avatar.jsx'
import { SkTable, SkStats } from '../components/Skeleton.jsx'

export const SOS_STATUS = {
  open: { th: 'รอรับเรื่อง', tone: 'alert' },
  ack: { th: 'รับเรื่องแล้ว', tone: 'warn' },
  on_site: { th: 'ถึงที่เกิดเหตุ', tone: 'warn' },
  closed: { th: 'ปิดเรื่อง', tone: 'duty' },
  false_alarm: { th: 'แจ้งผิด / ทดสอบ', tone: '' },
}
const ORDER = ['open', 'ack', 'on_site', 'closed', 'false_alarm']
const bkkDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgo = (n) => bkkDate(new Date(Date.now() - n * 86400000))
const mins = (m) => (m == null ? '—' : m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`)
const ticketNo = (id) => `#${String(id).slice(0, 6).toUpperCase()}`
const F0 = { from: daysAgo(30), to: bkkDate(), status: 'active', prop: '', q: '' }
const Badge = ({ s }) => <span className={`badge ${SOS_STATUS[s]?.tone || ''}`}>{SOS_STATUS[s]?.th || s}</span>

export default function Incidents({ sosId }) {
  const [f, setF] = useState(F0)
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(sosId || null)
  const [msg, setMsg] = useState(null)

  async function load() {
    try {
      const from = new Date(`${f.from}T00:00:00+07:00`).toISOString()
      const to = new Date(`${f.to}T23:59:59+07:00`).toISOString()
      setRows(await list(`v_incidents?select=*&created_at=gte.${from}&created_at=lte.${to}&order=created_at.desc&limit=1000`))
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }); setRows((r) => r || []) }
  }
  useEffect(() => { setRows(null); load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [f.from, f.to])

  const props = useMemo(() => [...new Map((rows || []).filter((r) => r.property_id).map((r) => [r.property_id, r.property_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'th')), [rows])
  const shown = useMemo(() => (rows || []).filter((r) => {
    if (f.status === 'active' && !['open', 'ack', 'on_site'].includes(r.status)) return false
    if (f.status && f.status !== 'active' && r.status !== f.status) return false
    if (f.prop && r.property_id !== f.prop) return false
    const q = f.q.trim().toLowerCase()
    if (q && !`${ticketNo(r.id)} ${r.full_name} ${r.employee_code} ${r.property_name} ${r.category} ${r.note}`.toLowerCase().includes(q)) return false
    return true
  }), [rows, f])
  const cols = useMemo(() => ({
    at: (r) => r.created_at, status: (r) => ORDER.indexOf(r.status), who: (r) => r.full_name, prop: (r) => r.property_name,
    ack: (r) => r.ack_minutes, close: (r) => r.close_minutes,
  }), [])
  const { sorted, th } = useSort(shown, cols, { key: 'at', dir: 'desc' })
  const cnt = useMemo(() => {
    const all = rows || []
    const acks = all.filter((r) => r.ack_minutes != null).map((r) => r.ack_minutes)
    return {
      open: all.filter((r) => r.status === 'open').length,
      working: all.filter((r) => ['ack', 'on_site'].includes(r.status)).length,
      closed: all.filter((r) => ['closed', 'false_alarm'].includes(r.status)).length,
      avgAck: acks.length ? Math.round(acks.reduce((a, b) => a + b, 0) / acks.length) : null,
    }
  }, [rows])

  async function exportXlsx() {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    const font = { name: 'TH Sarabun New', size: 14 }
    const ws = wb.addWorksheet('แจ้งเหตุ SOS')
    ws.columns = [{ width: 10 }, { width: 12 }, { width: 8 }, { width: 26 }, { width: 26 }, { width: 16 }, { width: 40 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 22 }]
    ws.addRow([`รายงานแจ้งเหตุ SOS ${f.from} ถึง ${f.to}`]).font = { ...font, bold: true }
    ws.addRow(['เลขที่', 'วันที่', 'เวลา', 'ผู้แจ้ง', 'โครงการ', 'ประเภท', 'รายละเอียด', 'สถานะ', 'รับเรื่อง (นาที)', 'ปิดเรื่อง (นาที)', 'ผู้รับเรื่อง', 'พิกัด']).font = { ...font, bold: true }
    for (const r of sorted) {
      ws.addRow([ticketNo(r.id), fmtDate(r.created_at), fmtTime(r.created_at), `${r.full_name} (${r.employee_code})`, r.property_name || '', r.category || '',
        r.note || '', SOS_STATUS[r.status]?.th || r.status, r.ack_minutes ?? '', r.close_minutes ?? '', r.ack_by_name || '',
        r.lat != null ? `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}` : '']).font = font
    }
    const buf = await wb.xlsx.writeBuffer()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    a.download = `แจ้งเหตุSOS_${f.from}_${f.to}.xlsx`; a.click()
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const selected = (rows || []).find((r) => r.id === sel)

  return (
    <div>
      {rows === null ? <SkStats n={4} /> : (
        <div className="stat-row">
          <div className={`stat ${cnt.open ? 'alert' : ''}`}><div className="n">{cnt.open}</div><div className="l">รอรับเรื่อง</div></div>
          <div className={`stat ${cnt.working ? 'warn' : ''}`}><div className="n">{cnt.working}</div><div className="l">กำลังดำเนินการ</div></div>
          <div className="stat"><div className="n">{cnt.closed}</div><div className="l">ปิดแล้ว (ช่วงที่เลือก)</div></div>
          <div className="stat"><div className="n">{cnt.avgAck == null ? '—' : `${cnt.avgAck}`}<small style={{ fontSize: 14, fontWeight: 500 }}>{cnt.avgAck == null ? '' : ' นาที'}</small></div><div className="l">เวลารับเรื่องเฉลี่ย</div></div>
        </div>
      )}

      <div className="card">
        <div className="form-grid">
          <div className="field"><label>สถานะ</label>
            <select value={f.status} onChange={set('status')}>
              <option value="active">ยังไม่ปิด (รอรับเรื่อง + กำลังดำเนินการ)</option>
              <option value="">ทั้งหมด</option>
              {ORDER.map((s) => <option key={s} value={s}>{SOS_STATUS[s].th}</option>)}
            </select>
          </div>
          <div className="field"><label>โครงการ</label>
            <select value={f.prop} onChange={set('prop')}><option value="">ทั้งหมด</option>{props.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          </div>
          <div className="field"><label>ตั้งแต่วันที่</label><input type="date" value={f.from} onChange={set('from')} /></div>
          <div className="field"><label>ถึงวันที่</label><input type="date" value={f.to} onChange={set('to')} /></div>
          <div className="field"><label>ค้นหา</label><input value={f.q} onChange={set('q')} placeholder="เลขที่ ชื่อ รหัส โครงการ หรือข้อความ" /></div>
          <button className="btn inline ghost" type="button" onClick={exportXlsx} disabled={!sorted?.length}>Export Excel</button>
        </div>
      </div>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <ResultLine shown={shown.length} total={rows?.length ?? 0} unit="เรื่อง" active={f.status !== 'active' || !!f.prop || !!f.q} onClear={() => setF({ ...F0, from: f.from, to: f.to })} note="กดแถวเพื่อดูรายละเอียดและอัปเดตสถานะ · รีเฟรชทุก 30 วิ" />
      {rows === null ? <SkTable rows={6} cols={7} avatarCol={2} /> : sorted.length === 0 ? <p className="muted">ไม่มีเรื่องแจ้งเหตุตามเงื่อนไข</p> : (
        <div className="table-wrap">
          <table className="grid dense sos-table">
            <thead><tr><th>เลขที่</th>{th('at', 'แจ้งเมื่อ')}<th aria-label="รูป"></th>{th('who', 'ผู้แจ้ง')}{th('prop', 'โครงการ')}<th>เรื่อง</th>{th('status', 'สถานะ')}{th('ack', 'รับเรื่องใน')}{th('close', 'ปิดใน')}</tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={`click ${r.status === 'open' ? 'sos-open' : ''} ${sel === r.id ? 'sel' : ''}`} onClick={() => setSel(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSel(r.id)}>
                  <td className="mono">{ticketNo(r.id)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)} {fmtTime(r.created_at)}</td>
                  <td className="av-cell"><Avatar src={r.user_photo} name={r.full_name} /></td>
                  <td>{r.full_name} <span className="muted">({r.employee_code})</span></td>
                  <td>{r.property_name || <span className="muted">ไม่ระบุ</span>}</td>
                  <td className="wrap-sm">{r.category || 'SOS'}{r.note ? <span className="muted"> · {r.note.slice(0, 40)}{r.note.length > 40 ? '…' : ''}</span> : ''}</td>
                  <td><Badge s={r.status} /></td>
                  <td>{mins(r.ack_minutes)}</td>
                  <td>{mins(r.close_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <Ticket key={selected.id} t={selected} onClose={() => setSel(null)} onChanged={load} />}
      {sel && rows && !selected && <div className="notice">ไม่พบเรื่อง {ticketNo(sel)} ในช่วงวันที่ที่เลือก — ขยายช่วงวันที่แล้วลองใหม่</div>}
    </div>
  )
}

function Ticket({ t, onClose, onChanged }) {
  const [events, setEvents] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [audio, setAudio] = useState(null)
  const [status, setStatus] = useState(t.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const mapRef = useRef(null)
  const edit = canEdit()

  const loadEvents = () => list(`v_incident_events?select=*&incident_id=eq.${t.id}&order=created_at`).then(setEvents).catch(() => setEvents([]))
  useEffect(() => { loadEvents() }, [t.id, t.updated_at])
  useEffect(() => {
    if (t.photo_url) signedUrl(t.photo_url).then(setPhoto).catch(() => {})
    if (t.audio_url) signedUrl(t.audio_url).then(setAudio).catch(() => {})
  }, [t.id])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  // แผนที่: จุดที่กด SOS (แดง) + จุดกลางโครงการ (เทา)
  useEffect(() => {
    if (!mapRef.current || (t.lat == null && t.site_lat == null)) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
    const pts = []
    if (t.site_lat != null) { L.marker([t.site_lat, t.site_lng], { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="sos-site"></div>' }) }).addTo(map).bindTooltip(t.property_name || 'โครงการ'); pts.push([t.site_lat, t.site_lng]) }
    if (t.lat != null) { L.marker([t.lat, t.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: '<div class="fm-sos"><b>!</b></div>' }), zIndexOffset: 1000 }).addTo(map).bindTooltip(`จุดที่กด SOS · ${t.full_name}`); pts.push([t.lat, t.lng]) }
    if (pts.length === 2) L.polyline(pts, { color: '#b83a30', weight: 2, dashArray: '4 6' }).addTo(map)
    if (pts.length === 1) map.setView(pts[0], 16); else map.fitBounds(pts, { padding: [36, 36], maxZoom: 17 })
    return () => map.remove()
  }, [t.id])

  async function save() {
    setBusy(true); setErr('')
    try {
      const o = await rpc('update_incident', { p_id: t.id, p_status: status !== t.status ? status : null, p_note: note.trim() || null })
      if (!o.ok) throw new Error(o.error === 'nothing_to_update' ? 'เลือกสถานะใหม่ หรือพิมพ์หมายเหตุก่อนบันทึก' : errTh(o.error))
      setNote(''); onChanged()
    } catch (e) { setErr(errTh(e)) } finally { setBusy(false) }
  }

  const evText = (e) => e.action === 'created' ? 'แจ้งเหตุ SOS จาก LINE'
    : e.action === 'status' ? <>เปลี่ยนสถานะ {e.from_status && <><Badge s={e.from_status} /> → </>}<Badge s={e.to_status} /></>
    : 'เพิ่มหมายเหตุ'

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="sos-h" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h">
          <div><div className="muted mono">{ticketNo(t.id)} · แจ้งเมื่อ {fmtDate(t.created_at)} {fmtTime(t.created_at)} น.</div>
            <h2 id="sos-h">🚨 {t.category || 'แจ้งเหตุ SOS'}</h2><Badge s={t.status} /></div>
          <button className="link-btn" onClick={onClose} aria-label="ปิด">ปิด ✕</button>
        </div>

        <div className="sos-who">
          <Avatar src={t.user_photo} name={t.full_name} size={44} />
          <div><b>{t.full_name}</b> <span className="muted">({t.employee_code})</span><div className="muted">{t.property_name || 'ไม่ระบุโครงการ'}{t.province ? ` · ${t.province}` : ''}</div></div>
          {t.phone && <a className="btn inline ghost sm" href={`tel:${t.phone}`}>โทร {t.phone}</a>}
        </div>

        <div className="sos-sec">
          <div className="fm-h">ข้อมูลที่ รปภ. ส่งมาจาก LINE</div>
          <p style={{ whiteSpace: 'pre-line' }}>{t.note || <span className="muted">ไม่ได้พิมพ์รายละเอียด</span>}</p>
          {photo && <a href={photo} target="_blank" rel="noreferrer"><img className="sos-photo" src={photo} alt="รูปจากที่เกิดเหตุ" /></a>}
          {audio && <audio controls src={audio} style={{ width: '100%', marginTop: 8 }} />}
          {!t.photo_url && !t.audio_url && <p className="muted">ไม่มีรูปหรือเสียงแนบ</p>}
        </div>

        <div className="sos-sec">
          <div className="fm-h">ตำแหน่ง</div>
          {t.lat == null && t.site_lat == null ? <p className="muted">ไม่ได้รับพิกัด</p> : <div ref={mapRef} className="sos-map" />}
          <p className="muted" style={{ marginTop: 6 }}>
            {t.lat != null ? <a href={`https://maps.google.com/?q=${t.lat},${t.lng}`} target="_blank" rel="noreferrer">เปิดใน Google Maps</a> : 'ไม่ได้รับพิกัดจากมือถือ'}
            {t.distance_m != null && ` · ห่างจากจุดกลางโครงการ ${t.distance_m >= 1000 ? `${(t.distance_m / 1000).toFixed(1)} กม.` : `${t.distance_m} ม.`}`}
          </p>
        </div>

        {edit && (
          <div className="sos-sec">
            <div className="fm-h">อัปเดตเรื่องนี้</div>
            <div className="sos-steps" role="radiogroup" aria-label="สถานะ">
              {ORDER.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={status === s} className={`sos-step ${status === s ? 'on' : ''} ${SOS_STATUS[s].tone}`} onClick={() => setStatus(s)}>{SOS_STATUS[s].th}</button>
              ))}
            </div>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="หมายเหตุ เช่น ส่งตัวสแปร์ไปแล้ว / แจ้งตำรวจแล้ว / ตรวจสอบแล้วเป็นการกดผิด" className="sos-note" />
            {err && <div className="notice err">{err}</div>}
            <button className="btn inline" onClick={save} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
          </div>
        )}

        <div className="sos-sec">
          <div className="fm-h">ประวัติ</div>
          {events === null ? <p className="muted">กำลังโหลด…</p> : (
            <ol className="sos-timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <Avatar src={e.actor_photo} name={e.actor_name || '?'} size={26} />
                  <div>
                    <div><b>{e.actor_name || 'ระบบ'}</b> · {evText(e)}</div>
                    {e.note && e.action !== 'created' && <div className="sos-ev-note">{e.note}</div>}
                    <small className="muted">{fmtDate(e.created_at)} {fmtTime(e.created_at)} น.</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  )
}
