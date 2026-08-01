// แผนที่ปักหมุดตำแหน่งโครงการ — OpenStreetMap (Leaflet) + ค้นหาสถานที่ (Nominatim)
// คลิกบนแผนที่หรือเลือกผลค้นหา → ส่ง lat/lng กลับผ่าน onPick
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

  async function search(e) {
    e.preventDefault()
    if (!q.trim()) return
    setSearching(true); setResults([])
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=th&q=${encodeURIComponent(q)}`,
        { headers: { 'Accept-Language': 'th' } })
      setResults(await r.json())
    } catch { setResults([]) } finally { setSearching(false) }
  }

  function pickResult(r) {
    const lat = Number(r.lat), lng = Number(r.lon)
    mapRef.current.setView([lat, lng], 17)
    place(lat, lng)
    setResults([])
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาสถานที่ เช่น Juicharoen Palace ภูเก็ต"
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
              {r.display_name}
            </div>
          ))}
        </div>
      )}
      <div ref={divRef} style={{ height: 320, borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }} />
      <p className="muted" style={{ marginTop: 6 }}>คลิกบนแผนที่เพื่อปักหมุดตำแหน่งโครงการ — พิกัดจะถูกบันทึกเป็นจุดศูนย์กลาง geofence</p>
    </div>
  )
}
