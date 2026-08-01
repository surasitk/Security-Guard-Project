// จุดตรวจ (QR) — สร้างจุดตรวจผูกกับโครงการ · สร้าง QR ให้พิมพ์ติดหน้างาน · ยามสแกนแล้วบันทึกเวลา
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { list, rpc, fmtDate } from '../lib/api'

const LIFF_ID = '2010926067-2cuN81fZ'
const scanUrl = (code) => `https://liff.line.me/${LIFF_ID}?page=scan&code=${code}`

export default function Checkpoints() {
  const [rows, setRows] = useState(null)
  const [props, setProps] = useState([])
  const [propId, setPropId] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState(null) // { code, name, property, dataUrl }

  const load = () => list('v_checkpoints?select=*&order=property_name,name').then(setRows).catch((e) => setMsg({ t: 'err', m: String(e.message) }))
  useEffect(() => {
    load()
    list('v_properties?select=id,name&is_active=is.true&order=name').then(setProps).catch(() => {})
  }, [])

  async function create(e) {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      const out = await rpc('create_checkpoint', { p_property_id: propId, p_name: name.trim() })
      if (out.ok) {
        setMsg({ t: 'ok', m: `สร้างจุดตรวจ "${name}" แล้ว — กด "QR" เพื่อดูและพิมพ์` })
        setName('')
        load()
      } else setMsg({ t: 'err', m: out.error })
    } catch (e2) { setMsg({ t: 'err', m: String(e2.message) }) } finally { setBusy(false) }
  }

  async function toggle(c) {
    setMsg(null)
    try {
      const o = await rpc('set_checkpoint_active', { p_id: c.id, p_active: !c.is_active })
      if (!o.ok) throw new Error(o.error)
      load()
    } catch (e) { setMsg({ t: 'err', m: String(e.message) }) }
  }

  async function showQr(c) {
    const dataUrl = await QRCode.toDataURL(scanUrl(c.code), { margin: 1, width: 320, errorCorrectionLevel: 'M' })
    setQr({ code: c.code, name: c.name, property: c.property_name, dataUrl })
  }

  function printQr() {
    const w = window.open('', '_blank', 'width=480,height=640')
    if (!w) { setMsg({ t: 'err', m: 'เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่' }); return }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR ${qr.name}</title>
      <style>body{font-family:-apple-system,'IBM Plex Sans Thai',sans-serif;text-align:center;padding:40px;color:#111}
      h2{margin:0 0 4px;font-size:22px}p{margin:2px 0;color:#555}.code{font-family:monospace;letter-spacing:1px;margin-top:8px;color:#888;font-size:12px}
      img{margin:24px 0;width:320px;height:320px}.border{border:1px solid #ddd;border-radius:12px;padding:28px;display:inline-block}</style>
      </head><body><div class="border"><h2>${qr.name}</h2><p>${qr.property}</p>
      <img src="${qr.dataUrl}"/><p>สแกนด้วย LINE เพื่อลงเวลาจุดตรวจ</p><p class="code">${qr.code}</p></div>
      <script>window.onload=function(){window.print()}</script></body></html>`)
    w.document.close()
  }

  const propName = useMemo(() => Object.fromEntries(props.map((p) => [p.id, p.name])), [props])

  return (
    <div>
      <div className="section-h"><h2>เพิ่มจุดตรวจ</h2></div>
      <form className="card" onSubmit={create}>
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
        <p className="muted" style={{ marginTop: 10 }}>สร้างแล้วกด "QR" ในตาราง เพื่อดู/พิมพ์ QR ไปติดหน้างาน — ยามเปิดเมนู "สแกนจุด" ใน LINE แล้วสแกน (ต้องเข้างานที่โครงการนั้นก่อน)</p>
      </form>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`}>{msg.m}</div>}

      {qr && (
        <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
          <div className="section-h" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{qr.name} · {qr.property}</h2>
            <button className="badge" style={{ cursor: 'pointer', background: 'none', fontFamily: 'var(--font)' }} onClick={() => setQr(null)}>ปิด</button>
          </div>
          <img src={qr.dataUrl} alt="QR" style={{ width: 260, height: 260, margin: '12px auto' }} />
          <p className="muted" style={{ fontFamily: 'monospace' }}>{qr.code}</p>
          <button className="btn ghost" style={{ maxWidth: 200, margin: '10px auto 0' }} onClick={printQr}>พิมพ์ QR</button>
        </div>
      )}

      <div className="section-h"><h2>จุดตรวจทั้งหมด {rows ? `(${rows.length})` : ''}</h2></div>
      {!rows ? <p className="muted">กำลังโหลด…</p> : rows.length === 0 ? (
        <p className="muted">ยังไม่มีจุดตรวจ — สร้างจากฟอร์มด้านบน</p>
      ) : (
        <table className="grid">
          <thead><tr><th>จุดตรวจ</th><th>โครงการ</th><th>สแกน 24 ชม.</th><th>สถานะ</th><th>สร้างเมื่อ</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5 }}>
                <td>{c.name}</td>
                <td>{c.property_name}</td>
                <td>{c.scans_24h}</td>
                <td>{c.is_active ? <span className="muted">ใช้งาน</span> : <span className="badge">ปิด</span>}</td>
                <td>{fmtDate(c.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="badge solid" style={{ cursor: 'pointer', border: 'none', fontFamily: 'var(--font)', marginRight: 6 }} onClick={() => showQr(c)}>QR</button>
                  <button className="badge" style={{ cursor: 'pointer', background: 'none', fontFamily: 'var(--font)' }} onClick={() => toggle(c)}>{c.is_active ? 'ปิด' : 'เปิด'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
