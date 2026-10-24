// กล่องข้อความ — ประกาศจากทีม Horguard และการแจ้งเตือนสำคัญของบริษัท (migration 36)
// จอใหญ่: รายการ + ช่องอ่าน · มือถือ/แท็บเล็ตแนวตั้ง: รายการ → แตะเพื่ออ่าน → ย้อนกลับ
import { useEffect, useMemo, useState } from 'react'
import { rpc, errTh } from '../lib/api'
import { CAT, CAT_KEYS, ROLE_TH, LINE_OA, CatIcon, CatTag, HighTag, mailTime, fullTime } from '../lib/inbox.jsx'
import { LIMITS } from '../lib/plans'
import { SkCards } from '../components/Skeleton.jsx'

const BOXES = [['inbox', 'ทั้งหมด'], ['unread', 'ยังไม่อ่าน'], ['archived', 'เก็บแล้ว']]

export default function Inbox({ onNav, onUnread }) {
  const [box, setBox] = useState('inbox')
  const [rows, setRows] = useState(null)
  const [counts, setCounts] = useState({})
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [msg, setMsg] = useState(null)

  async function load(b = box) {
    try {
      const [list, all, unread] = await Promise.all([
        rpc('inbox_list', { p_box: b }), rpc('inbox_list', { p_box: 'inbox' }), rpc('inbox_list', { p_box: 'unread' }),
      ])
      setRows(list)
      setCounts({ inbox: all.length, unread: unread.length })
      return list
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }); setRows([]); return [] }
  }
  useEffect(() => { setRows(null); setSel(null); load(box) }, [box]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (rows || []).filter((r) => (!cat || r.category === cat)
    && (!q.trim() || `${r.title} ${r.body}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, cat, q])
  const current = (rows || []).find((r) => r.id === sel)

  async function mark(ids, read, archive) {
    try {
      await rpc('inbox_mark', { p_ids: ids, p_read: read, p_archive: archive })
      const list = await load()
      onUnread?.()
      if (archive != null) setSel(null)
      else if (!list.some((r) => r.id === sel)) setSel(null)
    } catch (e) { setMsg({ t: 'err', m: errTh(e) }) }
  }
  async function open(r) {
    setSel(r.id)
    if (!r.read_at) {
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, read_at: new Date().toISOString() } : x)))
      try { await rpc('inbox_mark', { p_ids: [r.id], p_read: true, p_archive: null }); onUnread?.(); setCounts((c) => ({ ...c, unread: Math.max(0, (c.unread || 1) - 1) })) } catch { /* ไม่สำคัญ */ }
    }
  }
  async function readAll() {
    try { await rpc('inbox_mark_all_read'); await load(); onUnread?.(); setMsg({ t: 'ok', m: 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด' }) } catch (e) { setMsg({ t: 'err', m: errTh(e) }) }
  }
  function cta(url) {
    if (!url) return
    if (url.startsWith('force:')) onNav?.(url.slice(6))
    else window.open(url, '_blank', 'noopener')
  }

  return (
    <div className={`ibx ${current ? 'reading' : ''}`}>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`} style={{ marginTop: 0 }}>{msg.m}</div>}
      <div className="ibx-wrap">
        <section className="ibx-list" aria-label="รายการข้อความ">
          <div className="ibx-tools">
            <div className="seg" role="tablist">
              {BOXES.map(([k, l]) => (
                <button key={k} role="tab" aria-selected={box === k} className={box === k ? 'on' : ''} onClick={() => setBox(k)}>
                  {l}{k !== 'archived' && counts[k] != null ? ` ${counts[k]}` : ''}
                </button>
              ))}
            </div>
            <div className="chips-row ibx-cats">
              <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>ทุกประเภท</button>
              {CAT_KEYS.filter((k) => (rows || []).some((r) => r.category === k)).map((k) => (
                <button key={k} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => setCat(cat === k ? '' : k)}>{CAT[k].label}</button>
              ))}
            </div>
            <div className="ibx-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาหัวข้อหรือเนื้อหา" aria-label="ค้นหาข้อความ" />
            </div>
            {box !== 'archived' && counts.unread > 0 && <button className="link-btn ibx-readall" onClick={readAll}>อ่านทั้งหมดแล้ว</button>}
          </div>
          {!rows ? <div style={{ padding: 14 }}><SkCards n={5} h={58} /></div>
            : !shown.length ? <Empty box={box} filtered={!!(cat || q)} />
              : (
                <ul className="ibx-items">
                  {shown.map((r) => (
                    <li key={r.id}>
                      <button className={`ibx-item ${sel === r.id ? 'sel' : ''} ${r.read_at ? '' : 'unread'}`} onClick={() => open(r)}>
                        <span className={`ibx-ico ${CAT[r.category]?.tone || ''}`}><CatIcon c={r.category} /></span>
                        <span className="ibx-mid">
                          <span className="ibx-row1"><b>{r.title}</b><time>{mailTime(r.created_at)}</time></span>
                          <span className="ibx-snip">{r.body}</span>
                          <span className="ibx-tags"><CatTag c={r.category} />{r.priority === 'high' && <HighTag />}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
        </section>

        <section className="ibx-read" aria-label="อ่านข้อความ">
          {!current ? <div className="ibx-none"><CatIcon c="announcement" /><p>เลือกข้อความทางซ้ายเพื่ออ่าน</p></div> : (
            <article>
              <div className="ibx-read-top">
                <button className="link-btn ibx-back" onClick={() => setSel(null)}>‹ กลับ</button>
                <span className="ibx-tags"><CatTag c={current.category} />{current.priority === 'high' && <HighTag />}</span>
                <span className="grow" />
                {!current.archived_at && <button className="btn inline sm ghost" onClick={() => mark([current.id], false, null)}>ยังไม่อ่าน</button>}
                <button className="btn inline sm ghost" onClick={() => mark([current.id], null, !current.archived_at)}>{current.archived_at ? 'ย้ายกลับ' : 'เก็บ'}</button>
              </div>
              <h2 className="ibx-title">{current.title}</h2>
              <div className="ibx-from">
                <span className="ibx-av"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13h4l1.5 3h5L16 13h4M4 13l2-8h12l2 8v6H4z" /></svg></span>
                <div><b>{current.sender}</b><div className="muted">{fullTime(current.created_at)}{current.roles ? ` · ถึง ${current.roles.map((r) => ROLE_TH[r] || r).join(', ')}` : ''}</div></div>
              </div>
              <div className="ibx-body">{current.body}</div>
              <LimitCard meta={current.meta} />
              {(current.cta_url || ['plan', 'billing'].includes(current.category)) && (
                <div className="ibx-cta">
                  {current.cta_url && <button className="btn inline" onClick={() => cta(current.cta_url)}>{current.cta_label || 'เปิดลิงก์'}</button>}
                  {current.cta_url !== LINE_OA && ['plan', 'billing'].includes(current.category) && <a className="btn inline ghost" href={LINE_OA} target="_blank" rel="noopener">ติดต่อทีม Horguard</a>}
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  )
}

function LimitCard({ meta }) {
  if (!meta?.limit_key || meta.limit == null) return null
  const l = LIMITS.find((x) => x.k === meta.limit_key)
  const pct = Math.min(100, Math.round((Number(meta.count) / Number(meta.limit)) * 100))
  const full = Number(meta.count) >= Number(meta.limit)
  return (
    <div className={`ibx-limit ${full ? 'full' : 'near'}`}>
      <div className="ub-top"><b>{l?.label || meta.limit_key}</b><b>{meta.count} / {Number(meta.limit)}</b></div>
      <div className="ub-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="muted">{full ? 'ปิดใช้รายการเดิม หรืออัปเกรด/ซื้อเพิ่มเพื่อเพิ่มรายการใหม่' : 'ใกล้ถึงเพดานของแพ็กเกจ — วางแผนอัปเกรดล่วงหน้าได้'}</div>
    </div>
  )
}

function Empty({ box, filtered }) {
  return (
    <div className="ibx-empty">
      <CatIcon c="announcement" />
      <b>{filtered ? 'ไม่พบข้อความที่ตรงกับตัวกรอง' : box === 'unread' ? 'อ่านครบทุกข้อความแล้ว' : box === 'archived' ? 'ยังไม่มีข้อความที่เก็บไว้' : 'ยังไม่มีข้อความ'}</b>
      <p className="muted">{box === 'inbox' && !filtered ? 'ประกาศจากทีม Horguard และการแจ้งเตือนสำคัญของบริษัทจะมาที่นี่' : ''}</p>
    </div>
  )
}
