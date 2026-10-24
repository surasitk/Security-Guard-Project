// รายงานพิกัดน่าสงสัย (สงสัยใช้ Fake GPS) — ระบบไม่บล็อก แต่รวบรวมให้เจ้าหน้าที่ตรวจและตัดสินเอง
// ข้อมูล: gps_suspicions (ระบบติดธงตอนเข้า/ออกงาน + รอบตรวจทุกชั่วโมง) · ผลตรวจ: RPC review_gps_suspicion
import { useEffect, useMemo, useState } from 'react'
import { list, rpc, signedUrl, fmtTime, fmtDate, errTh, listCached } from '../lib/api'
import { canEdit } from '../lib/perm'
import { useSort, byName, ResultLine } from '../lib/sortTable.jsx'
import { GPS_STATUS_TH, GPS_STATUS_TONE, th } from '../lib/labels'
import { SkTable } from '../components/Skeleton.jsx'

const bkkDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const daysAgo = (n) => bkkDate(new Date(Date.now() - n * 86400000))
const PHASE_TH = { in: 'เข้างาน', out: 'ออกงาน' }
const F0 = { from: daysAgo(30), to: bkkDate(), prop: '', status: '', q: '' }

export default function GpsReport() {
  const [f, setF] = useState(F0)
  const [rows, setRows] = useState(null)
  const [att, setAtt] = useState({})
  const [props, setProps] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState({})          // id → ข้อความหมายเหตุที่กำลังพิมพ์
  const edit = canEdit()

  useEffect(() => { listCached('properties?select=id,name&is_active=is.true&order=name').then(setProps).catch(() => {}) }, [])

  async function load() {
    setMsg(null); setRows(null)
    try {
      const from = new Date(`${f.from}T00:00:00+07:00`).toISOString()
      const to = new Date(`${f.to}T23:59:59+07:00`).toISOString()
      const rs = await list(`gps_suspicions?select=*,users!gps_suspicions_user_id_fkey(full_name,employee_code,phone),properties(name,province),reviewer:users!gps_suspicions_reviewed_by_fkey(full_name)&event_at=gte.${from}&event_at=lte.${to}&order=event_at.desc&limit=1000`)
      setRows(rs)
      const ids = [...new Set(rs.map((r) => r.attendance_id))]
      const m = {}
      for (let i = 0; i < ids.length; i += 80) {
        const part = await list(`v_attendance_log?select=id,in_lat,in_lng,out_lat,out_lng,in_selfie_url,out_selfie_url,in_distance_m,out_distance_m&id=in.(${ids.slice(i, i + 80).join(',')})`).catch(() => [])
        for (const a of part) m[a.id] = a
      }
      setAtt(m)
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }); setRows([]) }
  }
  useEffect(() => { load() }, [f.from, f.to])

  const shown = useMemo(() => (rows || []).filter((r) => {
    if (f.prop && r.property_id !== f.prop) return false
    if (f.status && r.status !== f.status) return false
    const q = f.q.trim().toLowerCase()
    if (q && !`${r.users?.full_name} ${r.users?.employee_code} ${r.properties?.name}`.toLowerCase().includes(q)) return false
    return true
  }), [rows, f])

  const sortCols = useMemo(() => ({
    at: (r) => r.event_at, who: (r) => [r.users?.full_name, r.properties?.name],
    score: (r) => r.score, status: (r) => ['pending', 'confirmed', 'normal'].indexOf(r.status),
  }), [])
  const { sorted, th: sth } = useSort(shown, sortCols, { key: 'at', dir: 'desc' })

  // สรุปรายคน (เรียงจากจำนวนครั้งมากสุด) — ใช้ตัดสินใจว่าใครต้องคุย/ติดตาม
  const people = useMemo(() => {
    const m = new Map()
    for (const r of shown) {
      const k = r.user_id
      if (!m.has(k)) m.set(k, { name: r.users?.full_name, code: r.users?.employee_code, n: 0, pending: 0, confirmed: 0, last: r.event_at })
      const p = m.get(k); p.n += 1
      if (r.status === 'pending') p.pending += 1
      if (r.status === 'confirmed') p.confirmed += 1
      if (r.event_at > p.last) p.last = r.event_at
    }
    return [...m.values()].sort((a, b) => b.n - a.n || byName(a.name, b.name))
  }, [shown])
  const cnt = useMemo(() => ({
    all: shown.length,
    pending: shown.filter((r) => r.status === 'pending').length,
    confirmed: shown.filter((r) => r.status === 'confirmed').length,
    normal: shown.filter((r) => r.status === 'normal').length,
  }), [shown])

  async function review(r, status) {
    setBusy(r.id)
    try {
      const o = await rpc('review_gps_suspicion', { p_id: r.id, p_status: status, p_note: note[r.id] ?? r.review_note ?? null })
      if (!o.ok) throw new Error(errTh(o.error))
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status, review_note: note[r.id] ?? x.review_note, reviewed_at: new Date().toISOString() } : x)))
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }) } finally { setBusy('') }
  }

  async function openSelfie(path) {
    try { window.open(await signedUrl(path), '_blank') } catch { setMsg({ t: 'err', m: 'เปิดรูปไม่สำเร็จ' }) }
  }

  async function exportXlsx() {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    const font = { name: 'TH Sarabun New', size: 14 }
    const ws = wb.addWorksheet('พิกัดน่าสงสัย')
    ws.columns = [{ width: 12 }, { width: 8 }, { width: 10 }, { width: 26 }, { width: 26 }, { width: 8 }, { width: 70 }, { width: 16 }, { width: 30 }, { width: 22 }]
    ws.addRow([`รายงานพิกัดน่าสงสัย ${f.from} ถึง ${f.to}`]).font = { ...font, bold: true }
    const head = ws.addRow(['วันที่', 'เวลา', 'เหตุการณ์', 'พนักงาน', 'โครงการ', 'คะแนน', 'เหตุผล', 'สถานะ', 'หมายเหตุผู้ตรวจ', 'พิกัด'])
    head.font = { ...font, bold: true }
    for (const r of sorted) {
      const a = att[r.attendance_id] || {}
      const lat = r.phase === 'in' ? a.in_lat : a.out_lat, lng = r.phase === 'in' ? a.in_lng : a.out_lng
      ws.addRow([fmtDate(r.event_at), fmtTime(r.event_at), PHASE_TH[r.phase], `${r.users?.full_name || ''} (${r.users?.employee_code || ''})`,
        r.properties?.name || '', r.score, (r.reasons || []).join(' · '), th(GPS_STATUS_TH, r.status), r.review_note || '',
        lat != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '']).font = font
    }
    const ps = wb.addWorksheet('สรุปรายคน')
    ps.columns = [{ width: 30 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }]
    ps.addRow(['พนักงาน', 'จำนวนครั้ง', 'รอตรวจ', 'ยืนยันผิดปกติ', 'ล่าสุด']).font = { ...font, bold: true }
    for (const p of people) ps.addRow([`${p.name} (${p.code})`, p.n, p.pending, p.confirmed, fmtDate(p.last)]).font = font
    const buf = await wb.xlsx.writeBuffer()
    const el = document.createElement('a')
    el.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    el.download = `พิกัดน่าสงสัย_${f.from}_${f.to}.xlsx`
    el.click()
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const active = f.prop || f.status || f.q

  return (
    <div>
      <div className="notice info" style={{ marginTop: 0 }}>
        LINE ตรวจแอปปลอมพิกัดโดยตรงไม่ได้ ระบบจึงไม่บล็อกการลงเวลา แต่ดูลักษณะที่ผิดปกติแล้วติดธงไว้ให้ตรวจ — กรุณาดูรูปเซลฟี่และพิกัดประกอบก่อนตัดสิน
      </div>

      <div className="card">
        <div className="form-grid">
          <div className="field"><label>ตั้งแต่วันที่</label><input type="date" value={f.from} onChange={set('from')} /></div>
          <div className="field"><label>ถึงวันที่</label><input type="date" value={f.to} onChange={set('to')} /></div>
          <div className="field"><label>โครงการ</label>
            <select value={f.prop} onChange={set('prop')}><option value="">ทั้งหมด</option>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </div>
          <div className="field"><label>สถานะ</label>
            <select value={f.status} onChange={set('status')}><option value="">ทั้งหมด</option>{Object.entries(GPS_STATUS_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label>ค้นหา</label><input value={f.q} onChange={set('q')} placeholder="ชื่อ รหัสพนักงาน หรือโครงการ" /></div>
          <button className="btn inline ghost" type="button" onClick={exportXlsx} disabled={!sorted?.length}>Export Excel</button>
        </div>
      </div>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      <div className="stat-row" style={{ marginTop: 16 }}>
        <div className="stat"><div className="n">{cnt.all}</div><div className="l">รายการทั้งหมด</div></div>
        <div className={`stat ${cnt.pending ? 'warn' : ''}`}><div className="n">{cnt.pending}</div><div className="l">รอตรวจ</div></div>
        <div className={`stat ${cnt.confirmed ? 'alert' : ''}`}><div className="n">{cnt.confirmed}</div><div className="l">ยืนยันผิดปกติ</div></div>
        <div className="stat"><div className="n">{cnt.normal}</div><div className="l">ตรวจแล้ว ปกติ</div></div>
      </div>

      {people.length > 0 && (
        <>
          <div className="section-h"><h2>สรุปรายคน</h2></div>
          <div className="table-wrap">
            <table className="grid dense">
              <thead><tr><th>พนักงาน</th><th>จำนวนครั้ง</th><th>รอตรวจ</th><th>ยืนยันผิดปกติ</th><th>ล่าสุด</th></tr></thead>
              <tbody>{people.slice(0, 20).map((p) => (
                <tr key={p.code}><td>{p.name} <span className="muted">({p.code})</span></td><td><b>{p.n}</b></td><td>{p.pending || '—'}</td><td>{p.confirmed ? <span className="badge alert">{p.confirmed}</span> : '—'}</td><td>{fmtDate(p.last)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <div className="section-h"><h2>รายการ</h2></div>
      <ResultLine shown={shown.length} total={rows?.length ?? 0} unit="รายการ" active={!!active} onClear={() => setF({ ...F0, from: f.from, to: f.to })} note="กดหัวคอลัมน์เพื่อเรียง" />
      {rows === null ? <SkTable rows={5} cols={5} /> : sorted.length === 0 ? <p className="muted">ไม่พบรายการน่าสงสัยในช่วงนี้</p> : (
        <div className="table-wrap">
          <table className="grid dense">
            <thead><tr>{sth('at', 'เวลา')}{sth('who', 'พนักงาน / โครงการ')}{sth('score', 'คะแนน')}<th>เหตุผลที่สงสัย</th>{sth('status', edit ? 'สถานะ / ผลการตรวจ' : 'สถานะ')}</tr></thead>
            <tbody>
              {sorted.map((r) => {
                const a = att[r.attendance_id] || {}
                const lat = r.phase === 'in' ? a.in_lat : a.out_lat, lng = r.phase === 'in' ? a.in_lng : a.out_lng
                const selfie = r.phase === 'in' ? a.in_selfie_url : a.out_selfie_url
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.event_at)} {fmtTime(r.event_at)}
                      <div><span className={`badge ${r.phase === 'in' ? 'solid' : ''}`}>{PHASE_TH[r.phase]}</span></div></td>
                    <td><b>{r.users?.full_name}</b> <span className="muted">({r.users?.employee_code})</span><div className="muted">{r.properties?.name}</div></td>
                    <td><b>{r.score}</b></td>
                    <td style={{ minWidth: 260, whiteSpace: 'normal' }}>
                      {(r.reasons || []).map((x, i) => <div key={i}>• {x}</div>)}
                      <div style={{ marginTop: 6 }}>
                        {lat != null && <a className="badge" href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer">ดูพิกัด</a>}{' '}
                        {selfie && <button className="badge" onClick={() => openSelfie(selfie)}>ดูรูปเซลฟี่</button>}
                      </div>
                    </td>
                    <td style={{ minWidth: 200, whiteSpace: 'normal' }}>
                      <span className={`badge ${GPS_STATUS_TONE[r.status] || ''}`}>{th(GPS_STATUS_TH, r.status)}</span>
                      {r.reviewer?.full_name && r.status !== 'pending' && <small className="muted"> โดย {r.reviewer.full_name}</small>}
                      {!edit && r.review_note && <small className="muted" style={{ display: 'block' }}>{r.review_note}</small>}
                      {edit && (
                        <div style={{ marginTop: 6 }}>
                          <input value={note[r.id] ?? r.review_note ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="หมายเหตุ (ไม่บังคับ)" style={{ padding: 6, marginBottom: 6, width: '100%' }} />
                          <button className="badge" disabled={busy === r.id} onClick={() => review(r, 'normal')}>ปกติ</button>{' '}
                          <button className="badge alert" disabled={busy === r.id} onClick={() => review(r, 'confirmed')}>ยืนยันผิดปกติ</button>
                          {r.status !== 'pending' && <> <button className="link-btn" disabled={busy === r.id} onClick={() => review(r, 'pending')}>ย้อนเป็นรอตรวจ</button></>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
