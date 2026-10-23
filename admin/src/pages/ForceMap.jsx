// แผนที่กำลังพลสด + dispatch
// · ทุกโครงการที่เห็นได้ (ค่าเริ่มต้น) หรือเลือกโครงการเดียว — ใครเช็กอินอยู่ไซต์ไหน ขาดกี่คน
// · ไซต์ที่คนขาด → แนะนำตัวสแปร์ / ครูฝึก / สายตรวจ / รปภ.ที่ว่างและอยู่ใกล้ที่สุด → ส่งคำสั่งทาง LINE
// · เหตุแจ้ง SOS ที่ยังไม่ปิด แสดงบนแผนที่ + รับเรื่อง/ปิดเรื่อง
// ข้อมูล: RPC force_map · dispatch_candidates · dispatch_person · v_incidents · set_incident_status (รีเฟรชทุก 30 วิ)
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { list, rpc, callFn, signedUrl, fmtTime, fmtDate, errTh } from '../lib/api'
import { ROLE_TH, KIND_TH, INCIDENT_TH, INCIDENT_TONE, th } from '../lib/labels'

const km = (m) => (m == null ? '—' : m < 1000 ? `${Math.round(m)} ม.` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} กม.`)
const tone = (s) => (s.missing > 0 || s.open_sos > 0 ? 'alert' : s.on_duty > 0 ? 'duty' : 'idle')

export default function ForceMap() {
  const [allProps, setAllProps] = useState([])
  const [filter, setFilter] = useState('')
  const [sites, setSites] = useState(null)
  const [incidents, setIncidents] = useState([])
  const [sel, setSel] = useState(null)
  const [cands, setCands] = useState(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState('')
  const [stamp, setStamp] = useState(null)
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const fitted = useRef('')

  useEffect(() => { list('properties?select=id,name&is_active=is.true&order=name').then(setAllProps).catch(() => {}) }, [])

  async function load() {
    try {
      const [s, inc] = await Promise.all([
        rpc('force_map', { p_property_id: filter || null }),
        list(`v_incidents?select=*&status=neq.closed&order=created_at.desc&limit=30${filter ? `&property_id=eq.${filter}` : ''}`).catch(() => []),
      ])
      setSites(s || []); setIncidents(inc || []); setStamp(new Date())
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }); setSites([]) }
  }
  useEffect(() => {
    setSites(null); load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [filter])

  // แผนที่
  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current, { zoomControl: true }).setView([13.75, 100.5], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current
    if (!map || !sites) return
    layer.clearLayers()
    const pts = []
    for (const s of sites) {
      if (s.lat == null) continue
      const t = tone(s)
      const icon = L.divIcon({
        className: '', iconSize: [34, 34], iconAnchor: [17, 17],
        html: `<div class="fm-pin ${t}${sel === s.property_id ? ' sel' : ''}">${s.on_duty}${s.expected ? `<small>/${s.expected}</small>` : ''}</div>`,
      })
      L.marker([s.lat, s.lng], { icon, title: s.property_name }).addTo(layer)
        .on('click', () => pick(s.property_id))
        .bindTooltip(`${s.property_name}${s.missing ? ` · ขาด ${s.missing}` : ''}`, { direction: 'top', offset: [0, -16] })
      pts.push([s.lat, s.lng])
    }
    for (const i of incidents) {
      if (i.lat == null) continue
      L.marker([i.lat, i.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="fm-sos"><b>!</b></div>' }), zIndexOffset: 1000 })
        .addTo(layer).bindTooltip(`SOS · ${i.full_name} · ${fmtTime(i.created_at)}`, { direction: 'top', offset: [0, -12] })
      pts.push([i.lat, i.lng])
    }
    const key = `${filter}|${pts.length}`
    if (pts.length && fitted.current !== key) {
      fitted.current = key
      if (pts.length === 1) map.setView(pts[0], 15); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 })
    }
  }, [sites, incidents, sel])

  async function pick(id) {
    setSel(id); setCands(null); setNote(''); setMsg(null)
    try { setCands(await rpc('dispatch_candidates', { p_property_id: id })) } catch { setCands([]) }
  }

  async function dispatch(c) {
    const site = sites.find((s) => s.property_id === sel)
    if (!window.confirm(`ส่งคำสั่งทาง LINE ให้ ${c.full_name} ไปประจำที่ ${site?.property_name}?`)) return
    setBusy(c.user_id); setMsg(null)
    try {
      const out = await rpc('dispatch_person', { p_property_id: sel, p_user_id: c.user_id, p_note: note || null })
      if (!out.ok) { setMsg({ t: 'err', m: out.error === 'user_no_line' ? `${c.full_name} ยังไม่ได้ผูก LINE — โทรแจ้งแทน${c.phone ? ` (${c.phone})` : ''}` : errTh(out.error) }); return }
      const r = await callFn('notify-line', { notification_id: out.notification_id }).catch(() => null)
      setMsg(r?.ok ? { t: 'ok', m: `ส่งคำสั่งให้ ${c.full_name} ทาง LINE แล้ว` } : { t: 'err', m: `บันทึกคำสั่งแล้ว แต่ส่ง LINE ไม่สำเร็จ — ${errTh(r?.error || 'failed to fetch')}` })
    } finally { setBusy('') }
  }

  async function setStatus(i, status) {
    setBusy(i.id)
    try { const out = await rpc('set_incident_status', { p_id: i.id, p_status: status }); if (!out.ok) setMsg({ t: 'err', m: errTh(out.error) }); await load() } finally { setBusy('') }
  }
  async function openFile(path) { try { window.open(await signedUrl(path), '_blank') } catch { setMsg({ t: 'err', m: 'เปิดไฟล์ไม่สำเร็จ' }) } }

  const totals = useMemo(() => (sites || []).reduce((a, s) => ({ on: a.on + s.on_duty, exp: a.exp + s.expected, miss: a.miss + s.missing, short: a.short + (s.missing > 0 ? 1 : 0) }), { on: 0, exp: 0, miss: 0, short: 0 }), [sites])
  const site = sites?.find((s) => s.property_id === sel)
  const ordered = [...(sites || [])].sort((a, b) => (b.missing - a.missing) || (b.open_sos - a.open_sos) || a.property_name.localeCompare(b.property_name, 'th'))

  return (
    <div>
      <div className="filters fm-filters">
        <div className="field" style={{ marginBottom: 0, minWidth: 240 }}>
          <label>โครงการ</label>
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setSel(null); setCands(null) }}>
            <option value="">ทุกโครงการ</option>
            {allProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <p className="muted">อัปเดต {stamp ? fmtTime(stamp) : '…'} · รีเฟรชอัตโนมัติทุก 30 วินาที</p>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="n">{totals.on}</div><div className="l">กำลังปฏิบัติงานตอนนี้</div></div>
        <div className="stat"><div className="n">{totals.exp}</div><div className="l">ต้องมีตามกะ/ช่วงกะ</div></div>
        <div className={`stat ${totals.miss ? 'alert' : ''}`}><div className="n">{totals.miss}</div><div className="l">ขาด · {totals.short} ไซต์</div></div>
        <div className={`stat ${incidents.length ? 'alert' : ''}`}><div className="n">{incidents.length}</div><div className="l">SOS ยังไม่ปิด</div></div>
      </div>

      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      {incidents.length > 0 && (
        <>
          <div className="section-h"><h2>เหตุแจ้ง SOS</h2></div>
          <div className="fm-sos-list">
            {incidents.map((i) => (
              <div key={i.id} className={`fm-sos-item ${i.status}`}>
                <div>
                  <b>{i.full_name}</b> <span className="muted">({i.employee_code}){i.phone ? ` · ${i.phone}` : ''}</span>
                  <div className="muted">{i.property_name || 'ไม่ระบุโครงการ'} · {fmtDate(i.created_at)} {fmtTime(i.created_at)}{i.category ? ` · ${i.category}` : ''}</div>
                  {i.note && <div style={{ marginTop: 4 }}>{i.note}</div>}
                </div>
                <div className="fm-sos-act">
                  <span className={`badge ${INCIDENT_TONE[i.status] || ''}`}>{th(INCIDENT_TH, i.status)}</span>
                  {i.lat != null && <a className="badge" href={`https://maps.google.com/?q=${i.lat},${i.lng}`} target="_blank" rel="noreferrer">แผนที่</a>}
                  {i.photo_url && <button className="badge" onClick={() => openFile(i.photo_url)}>รูป</button>}
                  {i.audio_url && <button className="badge" onClick={() => openFile(i.audio_url)}>เสียง</button>}
                  {i.status === 'open' && <button className="btn inline ghost sm" disabled={busy === i.id} onClick={() => setStatus(i, 'ack')}>รับเรื่อง</button>}
                  <button className="btn inline ghost sm" disabled={busy === i.id} onClick={() => setStatus(i, 'closed')}>ปิดเรื่อง</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="fm-grid">
        <div className="fm-map-wrap">
          <div ref={divRef} className="fm-map" />
          <div className="legend fm-legend">
            <span><i style={{ background: 'var(--duty)' }} />ครบ/มีคน</span>
            <span><i style={{ background: 'var(--alert)' }} />ขาดคน หรือมี SOS</span>
            <span><i style={{ background: '#b9bfc4' }} />ไม่มีกะตอนนี้</span>
          </div>
        </div>

        <div className="fm-side">
          {!site ? (
            <>
              <div className="section-h" style={{ marginTop: 0 }}><h2>ไซต์ทั้งหมด · {sites?.length ?? '…'}</h2></div>
              {sites === null && <p className="muted">กำลังโหลด…</p>}
              {sites?.length === 0 && <p className="muted">ไม่มีโครงการที่คุณดูแล</p>}
              <div className="fm-sites">
                {ordered.map((s) => (
                  <button key={s.property_id} className={`fm-site ${tone(s)}`} onClick={() => pick(s.property_id)}>
                    <span className="nm">{s.property_name}<small>{s.province || ''}{s.shift_mode === 'open' ? ' · ไม่จัดกะ' : ''}</small></span>
                    <span className="ct">{s.on_duty}{s.expected ? <small>/{s.expected}</small> : null}</span>
                    {s.missing > 0 && <span className="badge alert">ขาด {s.missing}</span>}
                    {s.open_sos > 0 && <span className="badge alert">SOS</span>}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button className="link-back" onClick={() => { setSel(null); setCands(null) }}>‹ ไซต์ทั้งหมด</button>
              <h2 className="fm-title">{site.property_name}</h2>
              <p className="muted">{site.on_duty} คนกำลังปฏิบัติงาน{site.expected ? ` จาก ${site.expected}` : ''}{site.missing ? ` · ขาด ${site.missing}` : ''}</p>

              <div className="fm-block">
                <div className="fm-h">อยู่เวรตอนนี้</div>
                {site.people.length === 0 && <p className="muted">ยังไม่มีใครเช็กอิน</p>}
                {site.people.map((p) => (
                  <div key={p.user_id} className="fm-person">
                    <span><b>{p.name}</b><small>{th(ROLE_TH, p.role)} · {th(KIND_TH, p.kind)}</small></span>
                    <span className="muted">ตั้งแต่ {fmtTime(p.since)}</span>
                  </div>
                ))}
              </div>

              <div className="fm-block">
                <div className="fm-h">ส่งคนไปแทน (ว่าง · ใกล้ที่สุดก่อน)</div>
                <input className="fm-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="หมายเหตุถึงคนที่ส่งไป (ไม่บังคับ) เช่น ไปแทนจุดประตู 2" />
                {cands === null && <p className="muted">กำลังหา…</p>}
                {cands?.length === 0 && <p className="muted">ไม่มีคนว่างที่ผูกกับโครงการนี้ — เพิ่มโครงการให้ตัวสแปร์ในหน้า "ผู้ใช้และสิทธิ์"</p>}
                {cands?.map((c, idx) => (
                  <div key={c.user_id} className="fm-person">
                    <span>
                      <b>{c.full_name}</b>{idx === 0 && <span className="badge duty" style={{ marginLeft: 6 }}>แนะนำ</span>}
                      <small>{th(ROLE_TH, c.role)} · {km(c.distance_m)}{c.location_source === 'last_seen' ? ' (ตำแหน่งล่าสุด)' : c.location_source === 'home_project' ? ' (จากโครงการที่ประจำ)' : ''}{!c.has_line ? ' · ยังไม่ผูก LINE' : ''}</small>
                    </span>
                    <button className="btn inline sm" disabled={!!busy || !c.has_line} onClick={() => dispatch(c)}>{busy === c.user_id ? 'กำลังส่ง…' : 'ส่งไป'}</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
