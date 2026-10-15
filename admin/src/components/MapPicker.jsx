// แผนที่ปักหมุดตำแหน่งโครงการ — แผนที่ OpenStreetMap (Leaflet, ฟรี)
// ค้นหา: ① วางพิกัด/ลิงก์ Google Maps → ปักทันที ② Google Places (ผ่าน edge function place-search)
//        ③ ถ้ายังไม่ได้ตั้ง Google key → Photon + Nominatim (ฟรี)
// คลิกบนแผนที่หรือเลือกผลค้นหา → ส่ง lat/lng กลับผ่าน onPick
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { callFn } from '../lib/api'

// "7.8804, 98.3381" · ลิงก์ Google Maps แบบ .../@7.88,98.33,17z หรือ ?q=7.88,98.33 หรือ !3d7.88!4d98.33
export function parseCoords(text) {
  const t = String(text).trim()
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/]
  for (const re of pats) {
    const m = t.match(re)
    if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng } }
  }
  return null
}

async function freeSearch(q) {
  try {   // Photon — หาสถานที่/ร้าน/อาคารได้ดีกว่า Nominatim
    const r = await fetch(`https://photon.komoot.io/api/?limit=6&lat=13.75&lon=100.5&q=${encodeURIComponent(q)}`)
    const d = await r.json()
    const out = (d.features || []).filter((f) => f.properties?.countrycode === 'TH').map((f) => ({
      name: f.properties.name || f.properties.street || '',
      address: [f.properties.street, f.properties.district, f.properties.city, f.properties.state].filter(Boolean).join(' '),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    }))
    if (out.length) return out
  } catch { /* ลองต่อ */ }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=th&q=${encodeURIComponent(q)}`,
    { headers: { 'Accept-Language': 'th' } })
  return (await r.json()).map((x) => ({ name: x.display_name.split(',')[0], address: x.display_name, lat: +x.lat, lng: +x.lon }))
}

export default function MapPicker({ initLat, initLng, onPick }) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  function place(lat, lng, notify = true) {
    const map = mapRef.current
    if (!map) return
    if (markerRef.current) markerRef.current.remove()
    markerRef.current = L.circleMarker([lat, lng], {
      radius: 9, color: '#111111', weight: 3, fillColor: '#111111', fillOpacity: 0.85,
    }).addTo(map)
    if (notify) onPick(Number(lat.toFixed(7)), Number(lng.toFixed(7)))
  }

  useEffect(() => {
    if (mapRef.current) return
    const hasInit = initLat != null && initLng != null
    const map = L.map(divRef.current, { attributionControl: true })
      .setView([hasInit ? initLat : 7.8804, hasInit ? initLng : 98.3381], hasInit ? 16 : 10)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    map.on('click', (e) => place(e.latlng.lat, e.latlng.lng))
    mapRef.current = map
    if (hasInit) place(initLat, initLng, false)
    setTimeout(() => map.invalidateSize(), 200)
    return () => { map.remove(); mapRef.current = null }
  }, [])

  const [note, setNote] = useState('')

  async function search(e) {
    e?.preventDefault?.()
    const text = q.trim()
    if (!text) return
    setNote(''); setResults([])
    const c = parseCoords(text)
    if (c) { mapRef.current.setView([c.lat, c.lng], 17); place(c.lat, c.lng); setNote('ปักหมุดจากพิกัดแล้ว'); return }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(text)) {
      setNote('ลิงก์ย่อของ Google Maps อ่านพิกัดไม่ได้ — เปิดลิงก์ในเบราว์เซอร์แล้ว copy ลิงก์เต็มจากแถบที่อยู่ หรือกดค้างที่หมุดใน Google Maps แล้ว copy ตัวเลขพิกัดมาวาง')
      return
    }
    setSearching(true)
    try {
      let list = []
      let via = 'google'
      try {
        const out = await callFn('place-search', { q: text })
        if (out?.ok) list = out.results
        else via = 'free'
      } catch { via = 'free' }
      if (via === 'free') list = await freeSearch(text)
      setResults(list)
      if (!list.length) setNote('ไม่พบสถานที่นี้ — ลองพิมพ์ชื่อสั้นลง/ใส่จังหวัด หรือวางพิกัด/ลิงก์จาก Google Maps แทน หรือคลิกบนแผนที่เพื่อปักเอง')
    } catch { setNote('ค้นหาไม่สำเร็จ — ลองใหม่ หรือวางพิกัด/ลิงก์จาก Google Maps แทน') } finally { setSearching(false) }
  }

  function pickResult(r) {
    mapRef.current.setView([r.lat, r.lng], 17)
    place(r.lat, r.lng)
    setResults([]); setNote(`ปักหมุดที่ ${r.name || 'ตำแหน่งที่เลือก'} แล้ว — ลากแผนที่/คลิกเพื่อขยับให้ตรงประตูทางเข้า`)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อสถานที่ · หรือวางพิกัด / ลิงก์ Google Maps"
          onKeyDown={(e) => { if (e.key === 'Enter') search(e) }} style={{ flex: 1 }} />
        <button type="button" className="btn inline" style={{ padding: '10px 18px' }} onClick={search} disabled={searching}>
          {searching ? '…' : 'ค้นหา'}
        </button>
      </div>
      {results.length > 0 && (
        <div className="card" style={{ padding: 8, marginBottom: 8 }}>
          {results.map((r, i) => (
            <div key={i} onClick={() => pickResult(r)}
              style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14 }}>
              <b style={{ fontWeight: 600 }}>{r.name}</b>{r.address && <span className="muted" style={{ display: 'block' }}>{r.address}</span>}
            </div>
          ))}
        </div>
      )}
      {note && <p className="hint" style={{ margin: '0 0 8px' }}>{note}</p>}
      <div ref={divRef} style={{ height: 320, borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }} />
      <p className="muted" style={{ marginTop: 6 }}>คลิกบนแผนที่เพื่อปักหมุดตำแหน่งโครงการ — พิกัดจะถูกบันทึกเป็นจุดศูนย์กลาง geofence</p>
    </div>
  )
}
