// แผนที่กำลังพล (LINE OA → ?page=map) — ดูอย่างเดียว
// สิทธิ์: เจ้าของ · แอดมิน · ผู้จัดการโซน · ครูฝึก (ฐานข้อมูลกรองโครงการตามสิทธิ์ซ้ำอีกชั้นใน force_map)
// · ผจก.โซนเห็นโครงการที่ผูก (ไม่ผูกเลย = ทุกโครงการ) · ครูฝึกเห็นเฉพาะโครงการที่ผูก
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getUser, rpc, errTh } from '../lib/api'
import Brand from '../components/Brand.jsx'

export const MAP_ROLES = ['owner', 'admin', 'zone_manager', 'trainer']
const ROLE_TH = { guard: 'รปภ.', shift_leader: 'หัวหน้ากะ', zone_manager: 'ผู้จัดการโซน', supervisor: 'สายตรวจ', assistant_supervisor: 'ผู้ช่วยสายตรวจ', trainer: 'ครูฝึก', spare: 'ตัวสแปร์', admin: 'แอดมิน', owner: 'เจ้าของ' }
const KIND_TH = { scheduled: 'ตามตารางกะ', adhoc: 'เช็คอินโครงการ', emergency: 'ฉุกเฉิน', open: 'ตามช่วงกะ' }
const tone = (s) => (s.missing > 0 || s.open_sos > 0 ? 'alert' : s.on_duty > 0 ? 'duty' : 'idle')
const hm = (t) => new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

export default function ForceMap() {
  const user = getUser()
  const allowed = MAP_ROLES.includes(user?.role)
  if (!allowed) return <NoAccess />
  return <MapView />
}

export function NoAccess() {
  return (
    <div className="page">
      <Brand />
      <h1>แผนที่กำลังพล</h1>
      <div className="card fmp-deny" role="alert">
        <div className="fmp-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
        </div>
        <div className="v">คุณไม่มีสิทธิ์เข้าถึงเมนูนี้</div>
        <p className="muted">เมนูนี้สำหรับ เจ้าของ แอดมิน ผู้จัดการโซน และครูฝึก — หากต้องใช้งาน ติดต่อแอดมินของบริษัท</p>
      </div>
    </div>
  )
}

function MapView() {
  const [sites, setSites] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [stamp, setStamp] = useState(null)
  const divRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null), fitted = useRef(false)

  async function load() {
    try { setSites((await rpc('force_map', { p_property_id: null })) || []); setStamp(new Date()); setErr('') }
    catch (e) { setErr(errTh(e)); setSites((s) => s || []) }
  }
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current, { zoomControl: false, attributionControl: true }).setView([13.75, 100.5], 6)
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
      const icon = L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 16],
        html: `<div class="fmp-pin ${tone(s)}">${s.on_duty}${s.expected ? `<small>/${s.expected}</small>` : ''}</div>` })
      L.marker([s.lat, s.lng], { icon, title: s.property_name }).addTo(layer).on('click', () => {
        setOpen(s.property_id)
        document.getElementById(`fmp-${s.property_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      pts.push([s.lat, s.lng])
    }
    if (pts.length && !fitted.current) {
      fitted.current = true
      if (pts.length === 1) map.setView(pts[0], 15); else map.fitBounds(pts, { padding: [28, 28], maxZoom: 15 })
    }
  }, [sites])

  const ordered = useMemo(() => [...(sites || [])].sort((a, b) =>
    (b.missing + b.open_sos * 10) - (a.missing + a.open_sos * 10) || a.property_name.localeCompare(b.property_name, 'th')), [sites])
  const tot = useMemo(() => (sites || []).reduce((t, s) => ({ on: t.on + s.on_duty, exp: t.exp + s.expected, miss: t.miss + s.missing, sos: t.sos + s.open_sos }), { on: 0, exp: 0, miss: 0, sos: 0 }), [sites])

  return (
    <div className="page fmp">
      <Brand />
      <h1>แผนที่กำลังพล</h1>
      <p className="sub">{ROLE_TH[getUser()?.role] || ''} · {stamp ? `อัปเดต ${hm(stamp)} น. (ทุก 30 วิ)` : 'กำลังโหลด…'}</p>

      <div className="fmp-stats">
        <div><b>{tot.on}</b><span>อยู่เวร</span></div>
        <div><b>{tot.exp}</b><span>ต้องมี</span></div>
        <div className={tot.miss ? 'alert' : ''}><b>{tot.miss}</b><span>ขาด</span></div>
        <div className={tot.sos ? 'alert' : ''}><b>{tot.sos}</b><span>SOS</span></div>
      </div>

      <div ref={divRef} className="fmp-map" />
      <div className="fmp-legend"><span><i className="duty" />มีคน/ครบ</span><span><i className="alert" />ขาด หรือ SOS</span><span><i />ไม่มีกะตอนนี้</span></div>

      {err && <div className="notice err">{err}</div>}
      {sites?.length === 0 && !err && <p className="muted">ยังไม่มีโครงการที่คุณดูแล</p>}

      <div className="fmp-list">
        {ordered.map((s) => (
          <div key={s.property_id} id={`fmp-${s.property_id}`} className={`card fmp-site ${tone(s)} ${open === s.property_id ? 'open' : ''}`}>
            <button className="fmp-row" onClick={() => setOpen(open === s.property_id ? null : s.property_id)} aria-expanded={open === s.property_id}>
              <span className="nm">{s.property_name}<small>{s.province || ''}{s.shift_mode === 'open' ? ' · ไม่จัดกะ' : ''}</small></span>
              {s.missing > 0 && <span className="pill alert">ขาด {s.missing}</span>}
              {s.open_sos > 0 && <span className="pill alert">SOS</span>}
              <span className="ct">{s.on_duty}{s.expected ? <small>/{s.expected}</small> : null}</span>
            </button>
            {open === s.property_id && (
              <div className="fmp-people">
                {s.people.length === 0 ? <p className="muted">ยังไม่มีใครเช็กอิน</p> : s.people.map((p) => (
                  <div key={p.user_id} className="fmp-person">
                    <span><b>{p.name}</b><small>{ROLE_TH[p.role] || 'พนักงาน'} · {KIND_TH[p.kind] || 'อื่นๆ'} · ตั้งแต่ {hm(p.since)}</small></span>
                    {p.phone && <a className="fmp-call" href={`tel:${p.phone}`} aria-label={`โทรหา ${p.name}`}>โทร</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
