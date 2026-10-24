// แดชบอร์ดลูกค้า (รายโครงการ) — SLA การเข้ากะ · ความครอบคลุมการตรวจตรา · จำนวนเหตุ · heat map จุดตรวจ
// ผู้ใช้ประเภท "ลูกค้า" เห็นเฉพาะเมนูนี้ และเฉพาะโครงการของตน · ทีมงานเห็นทุกโครงการที่ดูแล (ใช้พรีวิวก่อนส่งให้ลูกค้า)
// ข้อมูล: RPC client_projects() · client_dashboard(property, from, to)
import { useEffect, useState } from 'react'
import { rpc, fmtDate, fmtTime, errTh } from '../lib/api'
import { INCIDENT_TH, INCIDENT_TONE, th } from '../lib/labels'
import { SkPage } from '../components/Skeleton.jsx'

const bkkDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgo = (n) => bkkDate(new Date(Date.now() - n * 86400000))
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const dd = (iso) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })

export default function ClientDashboard() {
  const [projects, setProjects] = useState(null)
  const [f, setF] = useState({ property: '', from: daysAgo(29), to: bkkDate() })
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    rpc('client_projects').then((r) => {
      setProjects(r || [])
      if (r?.length) setF((x) => ({ ...x, property: r[0].property_id }))
    }).catch((e) => { setProjects([]); setErr(errTh(e)) })
  }, [])

  useEffect(() => {
    if (!f.property) return
    if (f.to < f.from) { setErr('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'); return }
    let live = true
    setData(null); setErr('')
    rpc('client_dashboard', { p_property_id: f.property, p_from: f.from, p_to: f.to })
      .then((d) => { if (!live) return; if (d?.ok) setData(d); else setErr(d?.error === 'forbidden' ? 'ไม่มีสิทธิ์ดูโครงการนี้' : errTh(d?.error)) })
      .catch((e) => live && setErr(errTh(e)))
    return () => { live = false }
  }, [f.property, f.from, f.to])

  if (projects === null) return <SkPage stats={4} rows={5} cols={4} />
  if (!projects.length) return <div className="notice">ยังไม่มีโครงการที่ผูกกับบัญชีนี้ — ติดต่อบริษัท รปภ. ของคุณ</div>

  const s = data?.shifts
  const cp = data?.checkpoints
  const days = data?.daily || []
  const covDays = days.map((d) => pct(d.cp_scanned, cp?.count)).filter((x) => x !== null)
  const coverage = covDays.length ? Math.round(covDays.reduce((a, b) => a + b, 0) / covDays.length) : null
  const sla = s ? pct(s.on_time, s.total) : null
  const attend = s ? pct(s.attended, s.total) : null
  const heatMax = Math.max(1, ...(cp?.heat || []).flatMap((h) => h.hours))

  return (
    <div>
      <div className="filters cd-filters">
        <div className="field"><label>โครงการ</label>
          <select value={f.property} onChange={(e) => setF({ ...f, property: e.target.value })}>
            {projects.map((p) => <option key={p.property_id} value={p.property_id}>{p.property_name}</option>)}
          </select>
        </div>
        <div className="field"><label>ตั้งแต่วันที่</label><input type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="field"><label>ถึงวันที่</label><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div className="chips-row cd-quick">
          {[[6, '7 วัน'], [29, '30 วัน'], [89, '90 วัน']].map(([n, l]) => (
            <button key={n} type="button" className={`chip ${f.from === daysAgo(n) && f.to === bkkDate() ? 'on' : ''}`} onClick={() => setF({ ...f, from: daysAgo(n), to: bkkDate() })}>{l}</button>
          ))}
        </div>
      </div>

      {err && <div className="notice err">{err}</div>}
      {!data && !err && <SkPage stats={4} rows={5} cols={4} />}

      {data && (
        <>
          <div className="stat-row">
            <Tile n={sla} unit="%" l="SLA เข้ากะตรงเวลา" sub={`${s.on_time}/${s.total} กะ (สายไม่เกิน 5 นาที)`} good={95} ok={85} />
            <Tile n={attend} unit="%" l="อัตราการเข้ากะ" sub={`ขาด ${s.absent} · สาย ${s.late} กะ`} good={98} ok={90} />
            <Tile n={coverage} unit="%" l="ความครอบคลุมการตรวจ" sub={cp.count ? `${cp.count} จุดตรวจ · สแกน ${cp.scans.toLocaleString()} ครั้ง` : 'ยังไม่มีจุดตรวจ'} good={90} ok={70} />
            <div className={`stat ${data.incidents.open ? 'alert' : ''}`}>
              <div className="n">{data.incidents.total}</div>
              <div className="l">เหตุที่แจ้ง{data.incidents.open ? ` · ยังไม่ปิด ${data.incidents.open}` : ''}</div>
            </div>
          </div>

          <div className="section-h"><h2>รายวัน</h2>
            <div className="legend"><span><i style={{ background: 'var(--ink)' }} />เข้ากะตรงเวลา</span><span><i style={{ background: 'var(--duty)' }} />จุดตรวจที่สแกน</span></div>
          </div>
          <div className="cd-trend card">
            {days.map((d) => {
              const a = pct(d.on_time, d.total), c = pct(d.cp_scanned, cp.count)
              return (
                <div key={d.d} className="cd-day" title={`${dd(d.d)} · ตรงเวลา ${d.on_time}/${d.total} · จุดตรวจ ${d.cp_scanned}/${cp.count}`}>
                  <div className="bars">
                    <span className="b1" style={{ height: `${a ?? 0}%`, opacity: a === null ? 0.15 : 1 }} />
                    <span className="b2" style={{ height: `${c ?? 0}%`, opacity: c === null ? 0.15 : 1 }} />
                  </div>
                  <small>{days.length <= 31 || +d.d.slice(8) % 5 === 1 ? +d.d.slice(8) : ''}</small>
                </div>
              )
            })}
          </div>

          <div className="section-h"><h2>Heat map จุดตรวจ · จำนวนสแกนตามชั่วโมง</h2></div>
          {!cp.heat.length ? <p className="muted">ยังไม่มีจุดตรวจในโครงการนี้</p> : (
            <div className="table-wrap card cd-heat-wrap">
              <table className="cd-heat">
                <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h}>{String(h).padStart(2, '0')}</th>)}<th>รวม</th></tr></thead>
                <tbody>
                  {cp.heat.map((row) => (
                    <tr key={row.id}>
                      <th className="nm">{row.name}</th>
                      {row.hours.map((n, h) => (
                        <td key={h} title={`${row.name} · ${String(h).padStart(2, '0')}:00 · ${n} ครั้ง`}
                          style={{ background: n ? `rgba(30,127,85,${0.12 + 0.88 * (n / heatMax)})` : undefined, color: n / heatMax > 0.55 ? '#fff' : undefined }}>
                          {n || ''}
                        </td>
                      ))}
                      <td className={`tot ${row.total ? '' : 'zero'}`}>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="section-h"><h2>เหตุล่าสุด</h2></div>
          {!data.incidents.latest.length ? <p className="muted">ไม่มีเหตุแจ้งในช่วงนี้</p> : (
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>เวลา</th><th>ประเภท</th><th>รายละเอียด</th><th>สถานะ</th></tr></thead>
                <tbody>
                  {data.incidents.latest.map((i, k) => (
                    <tr key={k}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.at)} {fmtTime(i.at)}</td>
                      <td>{i.category || 'SOS'}</td>
                      <td>{i.note || '—'}</td>
                      <td><span className={`badge ${INCIDENT_TONE[i.status] || ''}`}>{th(INCIDENT_TH, i.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ n, unit, l, sub, good, ok }) {
  const cls = n === null ? '' : n >= good ? 'good' : n >= ok ? 'warn' : 'alert'
  return (
    <div className={`stat ${cls}`}>
      <div className="n">{n === null ? '—' : `${n}${unit}`}</div>
      <div className="l">{l}</div>
      <div className="l" style={{ fontSize: 12.5 }}>{sub}</div>
    </div>
  )
}
