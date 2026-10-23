// จุดตรวจ (QR) — สร้างจุดตรวจผูกกับโครงการ · สร้าง QR ให้พิมพ์ติดหน้างาน · รปภ.สแกนแล้วบันทึกเวลา
// ตารางเรียงได้ทุกคอลัมน์ (ค่าเริ่มต้น โครงการ → จุดตรวจ ก–ฮ, A–Z) · ค้นหาขั้นสูง · พิมพ์ QR ทั้งหมดที่กรองไว้ในครั้งเดียว
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { list, rpc, fmtDate, errTh } from '../lib/api'
import { useSort, byName, ResultLine } from '../lib/sortTable.jsx'

const LIFF_ID = import.meta.env.VITE_PATROL_LIFF_ID || '2010926067-2cuN81fZ'
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
const scanUrl = (code) => `https://liff.line.me/${LIFF_ID}?page=scan&code=${code}`

export default function Checkpoints() {
  const [rows, setRows] = useState(null)
  const [props, setProps] = useState([])
  const [propId, setPropId] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState(null) // { code, name, property, dataUrl }
  const [open, setOpen] = useState(false)
  const F0 = { q: '', province: '', prop: '', active: '', scans: '' }
  const [f, setF] = useState(F0)

  const load = () => list('v_checkpoints?select=*&order=property_name,name').then(setRows).catch((e) => setMsg({ t: 'err', m: errTh(e) }))
  useEffect(() => {
    load()
    list('v_properties?select=id,name,province&is_active=is.true').then((ps) => setProps(ps.sort((a, b) => byName(a.name, b.name)))).catch(() => {})
  }, [])

  async function create(e) {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      const out = await rpc('create_checkpoint', { p_property_id: propId, p_name: name.trim() })
      if (out.ok) {
        setMsg({ t: 'ok', m: `สร้างจุดตรวจ "${name}" แล้ว — กด "QR" เพื่อดูและพิมพ์` })
        setName(''); setOpen(false)
        load()
      } else setMsg({ t: 'err', m: errTh(out.error) })
    } catch (e2) { setMsg({ t: 'err', m: errTh(e2) }) } finally { setBusy(false) }
  }

  async function toggle(c) {
    setMsg(null)
    try {
      const o = await rpc('set_checkpoint_active', { p_id: c.id, p_active: !c.is_active })
      if (!o.ok) throw new Error(errTh(o.error))
      load()
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }) }
  }

  async function showQr(c) {
    const dataUrl = await QRCode.toDataURL(scanUrl(c.code), { margin: 1, width: 320, errorCorrectionLevel: 'M' })
    setQr({ code: c.code, name: c.name, property: c.property_name, dataUrl })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const card = (x) => `<div class="border"><h2>${esc(x.name)}</h2><p>${esc(x.property)}</p><img src="${x.dataUrl}"/><p>สแกนด้วย LINE เพื่อลงเวลาจุดตรวจ</p><p class="code">${x.code}</p></div>`
  function printCards(cards, title) {
    const w = window.open('', '_blank', 'width=720,height=800')
    if (!w) { setMsg({ t: 'err', m: 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup สำหรับเว็บนี้แล้วลองใหม่' }); return }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:-apple-system,'IBM Plex Sans Thai',sans-serif;text-align:center;padding:24px;color:#111;margin:0}
      h2{margin:0 0 4px;font-size:22px}p{margin:2px 0;color:#555}.code{font-family:monospace;letter-spacing:1px;margin-top:8px;color:#888;font-size:12px}
      img{margin:20px 0;width:300px;height:300px}.border{border:1px solid #ddd;border-radius:12px;padding:24px;display:inline-block;margin:12px;page-break-inside:avoid;break-inside:avoid}
      @media print{.border{margin:0 0 24px}}</style>
      </head><body>${cards.join('')}<script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }
  function printQr() { printCards([card(qr)], `QR ${qr.name}`) }
  async function printAll() {
    if (!sorted?.length) return
    if (sorted.length > 60 && !window.confirm(`พิมพ์ QR ${sorted.length} จุดในครั้งเดียว?`)) return
    setBusy(true)
    try {
      const cards = await Promise.all(sorted.filter((c) => c.is_active).map(async (c) =>
        card({ ...c, property: c.property_name, dataUrl: await QRCode.toDataURL(scanUrl(c.code), { margin: 1, width: 320, errorCorrectionLevel: 'M' }) })))
      if (!cards.length) { setMsg({ t: 'err', m: 'ไม่มีจุดตรวจที่เปิดใช้งานในรายการที่กรองไว้' }); return }
      printCards(cards, `QR จุดตรวจ ${cards.length} จุด`)
    } finally { setBusy(false) }
  }

  // ── ค้นหาขั้นสูง + เรียง ──
  const provOf = useMemo(() => Object.fromEntries(props.map((p) => [p.id, p.province || 'ไม่ระบุ'])), [props])
  const provinces = useMemo(() => [...new Set(props.map((p) => p.province || 'ไม่ระบุ'))].sort(byName), [props])
  const propOpts = useMemo(() => props.filter((p) => !f.province || (p.province || 'ไม่ระบุ') === f.province), [props, f.province])
  const setFv = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'province' ? { prop: '' } : {}) })
  const fActive = Object.values(f).some(Boolean)
  const filtered = useMemo(() => {
    if (!rows) return rows
    const q = f.q.trim().toLowerCase()
    return rows.filter((c) => {
      if (q && ![c.name, c.property_name, c.code].join(' ').toLowerCase().includes(q)) return false
      if (f.province && (provOf[c.property_id] || 'ไม่ระบุ') !== f.province) return false
      if (f.prop && c.property_id !== f.prop) return false
      if (f.active && (c.is_active ? 'on' : 'off') !== f.active) return false
      if (f.scans && ((Number(c.scans_24h) || 0) > 0 ? 'yes' : 'no') !== f.scans) return false
      return true
    })
  }, [rows, f, provOf])
  const SORT_COLS = useMemo(() => ({
    name: (c) => [c.name, c.property_name],
    prop: (c) => [c.property_name, c.name],
    prov: (c) => [provOf[c.property_id], c.property_name, c.name],
    scans: (c) => [Number(c.scans_24h) || 0, c.property_name],
    active: (c) => [c.is_active ? 0 : 1, c.property_name, c.name],
    created: (c) => (c.created_at ? new Date(c.created_at).getTime() : null),
  }), [provOf])
  const { sorted, th } = useSort(filtered, SORT_COLS, { key: 'prop', dir: 'asc' })

  return (
    <div>
      <div className="section-h">
        <h2>จุดตรวจทั้งหมด {rows ? `(${rows.length})` : ''}</h2>
        {!open && <button className="btn inline" onClick={() => { setOpen(true); setMsg(null) }}>+ เพิ่มจุดตรวจ</button>}
      </div>
      {open && (
        <form className="card sh-form" onSubmit={create} style={{ marginBottom: 16 }}>
          <div className="sh-form-h"><h3>เพิ่มจุดตรวจ</h3><button type="button" className="link-btn" onClick={() => setOpen(false)}>ปิด</button></div>
          <div className="form-grid">
            <div className="field"><label>โครงการ *</label>
              <select value={propId} onChange={(e) => setPropId(e.target.value)} required>
                <option value="">— เลือกโครงการ —</option>
                {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field"><label>ชื่อจุดตรวจ *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ประตูหน้า, ลานจอด B1, ชั้น 3" required />
            </div>
            <button className="btn inline" type="submit" disabled={busy || !propId}>{busy ? 'กำลังสร้าง…' : 'สร้างจุดตรวจ + QR'}</button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>สร้างแล้วกด "QR" ในตาราง เพื่อดู/พิมพ์ QR ไปติดหน้างาน — รปภ.เปิดเมนู "สแกนจุด" ใน LINE แล้วสแกน (ต้องเข้างานที่โครงการนั้นก่อน)</p>
        </form>
      )}
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      {qr && (
        <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
          <div className="section-h" style={{ marginTop: 0 }}>
            <h2 style={{ margin: 0 }}>{qr.name} · {qr.property}</h2>
            <button className="badge" onClick={() => setQr(null)}>ปิด</button>
          </div>
          <img src={qr.dataUrl} alt={`QR ${qr.name}`} style={{ width: 260, height: 260, margin: '12px auto' }} />
          <p className="muted" style={{ fontFamily: 'monospace' }}>{qr.code}</p>
          <button className="btn ghost" style={{ maxWidth: 200, margin: '10px auto 0' }} onClick={printQr}>พิมพ์ QR</button>
        </div>
      )}

      <div className="filters sh-filters">
        <div className="field grow"><label>ค้นหา</label><input value={f.q} onChange={setFv('q')} placeholder="ชื่อจุดตรวจ ชื่อโครงการ หรือรหัส QR" /></div>
        <div className="field"><label>จังหวัด</label>
          <select value={f.province} onChange={setFv('province')}><option value="">ทั้งหมด</option>{provinces.map((x) => <option key={x}>{x}</option>)}</select>
        </div>
        <div className="field"><label>โครงการ</label>
          <select value={f.prop} onChange={setFv('prop')}><option value="">ทั้งหมด</option>{propOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div className="field narrow"><label>สถานะ</label>
          <select value={f.active} onChange={setFv('active')}><option value="">ทั้งหมด</option><option value="on">ใช้งาน</option><option value="off">ปิดใช้</option></select>
        </div>
        <div className="field narrow"><label>สแกนใน 24 ชม.</label>
          <select value={f.scans} onChange={setFv('scans')}><option value="">ทั้งหมด</option><option value="yes">มีการสแกน</option><option value="no">ไม่มีการสแกน</option></select>
        </div>
        <div className="sh-actions">
          <button type="button" className="btn inline ghost" disabled={busy || !sorted?.length} onClick={printAll}>พิมพ์ QR ทั้งหมดที่แสดง</button>
        </div>
      </div>

      {!rows ? <p className="muted">กำลังโหลด…</p> : rows.length === 0 ? (
        <p className="muted">ยังไม่มีจุดตรวจ — กด "+ เพิ่มจุดตรวจ"</p>
      ) : (
        <>
          <ResultLine shown={sorted.length} total={rows.length} unit="จุด" active={fActive} onClear={() => setF(F0)} note="กดหัวคอลัมน์เพื่อเรียง" />
          {sorted.length === 0 ? <p className="muted">ไม่พบจุดตรวจตามตัวกรอง</p> : (
            <div className="table-wrap">
              <table className="grid dense">
                <thead><tr>
                  {th('name', 'จุดตรวจ')}{th('prop', 'โครงการ')}{th('prov', 'จังหวัด')}{th('scans', 'สแกน 24 ชม.', { className: 'num' })}{th('active', 'สถานะ')}{th('created', 'สร้างเมื่อ')}<th></th>
                </tr></thead>
                <tbody>
                  {sorted.map((c) => (
                    <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                      <td>{c.name}</td>
                      <td>{c.property_name}</td>
                      <td>{provOf[c.property_id] || '—'}</td>
                      <td className="num">{Number(c.scans_24h) > 0 ? <b>{c.scans_24h}</b> : <span className="muted">0</span>}</td>
                      <td>{c.is_active ? <span className="badge duty">ใช้งาน</span> : <span className="badge">ปิดใช้</span>}</td>
                      <td>{fmtDate(c.created_at)}</td>
                      <td className="row-act">
                        <button className="badge solid" style={{ border: 'none' }} onClick={() => showQr(c)}>QR</button>
                        <button className="badge" onClick={() => toggle(c)}>{c.is_active ? 'ปิดใช้' : 'เปิดใช้'}</button>
                      </td>
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
