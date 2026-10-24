// ส่งข้อความถึง Tenant (เฉพาะ Super Admin) — เขียนข้อความ · ข้อความที่ส่งแล้ว (สถิติการอ่าน ถอน) · แจ้งเตือนอัตโนมัติล่าสุด (migration 36)
import { useEffect, useMemo, useState } from 'react'
import { rpc, errTh } from '../lib/api'
import { CAT, CAT_KEYS, ROLE_TH, SEND_ROLES, LINE_OA, CatIcon, CatTag, HighTag, mailTime, fullTime } from '../lib/inbox.jsx'
import { SkCards, SkTable } from '../components/Skeleton.jsx'

const MAX_BODY = 2000
const BLANK = { mode: 'all', plans: [], tenants: [], roles: ['owner', 'admin'], category: 'announcement', priority: 'normal', title: '', body: '', cta_label: '', cta_url: '', expires: '' }

export default function InboxSend() {
  const [tab, setTab] = useState('compose')
  const [meta, setMeta] = useState(null)      // admin_list_plans → plans + tenants
  const [camps, setCamps] = useState(null)
  const [msg, setMsg] = useState(null)

  const loadCamps = () => rpc('admin_inbox_campaigns').then((o) => { if (o?.ok === false) throw new Error(o.error); setCamps(o) }).catch((e) => setMsg({ t: 'err', m: errTh(e) }))
  useEffect(() => {
    rpc('admin_list_plans').then((o) => { if (o?.ok === false) throw new Error(o.error); setMeta(o) }).catch((e) => setMsg({ t: 'err', m: errTh(e) }))
    loadCamps()
  }, [])

  return (
    <div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'compose'} className={tab === 'compose' ? 'on' : ''} onClick={() => setTab('compose')}>เขียนข้อความ</button>
        <button role="tab" aria-selected={tab === 'sent'} className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>ข้อความที่ส่งแล้ว{camps ? ` (${camps.campaigns.length})` : ''}</button>
      </div>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`} style={{ marginTop: 0 }}>{msg.m}</div>}
      {tab === 'compose'
        ? (!meta ? <SkCards n={3} h={90} /> : <Compose meta={meta} onSent={(m) => { setMsg({ t: 'ok', m }); loadCamps(); setTab('sent') }} />)
        : (!camps || !meta ? <SkTable rows={4} cols={6} /> : <Sent camps={camps} meta={meta} onChanged={(m) => { setMsg({ t: 'ok', m }); loadCamps() }} onErr={(m) => setMsg({ t: 'err', m })} />)}
    </div>
  )
}

/* ─────────────── เขียนข้อความ ─────────────── */
function Compose({ meta, onSent }) {
  const [f, setF] = useState(BLANK)
  const [tq, setTq] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] })
  const active = meta.tenants.filter((t) => t.is_active)

  const targets = useMemo(() => (
    f.mode === 'all' ? active
      : f.mode === 'plan' ? active.filter((t) => f.plans.includes(t.plan_id))
        : active.filter((t) => f.tenants.includes(t.tenant_id))
  ), [f.mode, f.plans, f.tenants, active])

  const target = f.mode === 'all' ? { all: true } : f.mode === 'plan' ? { plan_ids: f.plans } : { tenant_ids: f.tenants }
  const ready = targets.length > 0 && f.roles.length > 0 && f.title.trim() && f.body.trim()

  async function send() {
    setBusy(true); setErr('')
    try {
      const o = await rpc('admin_inbox_send', { p: {
        target, roles: f.roles, category: f.category, priority: f.priority, title: f.title.trim(), body: f.body.trim(),
        cta_label: f.cta_label.trim() || null, cta_url: f.cta_url.trim() || null,
        expires_at: f.expires ? `${f.expires}T23:59:59+07:00` : null,
      } })
      if (!o.ok) throw new Error(o.error === 'no_target' ? 'ไม่มี Tenant ที่ตรงกับผู้รับที่เลือก' : o.error === 'title_body_required' ? 'กรุณากรอกหัวข้อและข้อความ' : o.error)
      setConfirm(false); setF(BLANK)
      onSent(`ส่ง "${f.title.trim()}" ถึง ${o.tenants} Tenant แล้ว — ถอนได้ในแท็บข้อความที่ส่งแล้ว`)
    } catch (e) { setErr(errTh(e)) } finally { setBusy(false) }
  }

  const tf = tq.trim().toLowerCase()
  return (
    <div className="cmp">
      <div className="card cmp-form">
        <h3 className="cmp-h">1. ผู้รับ</h3>
        <div className="cmp-modes" role="radiogroup" aria-label="ส่งถึง">
          {[['all', 'ทุก Tenant', `${active.length} บริษัทที่เปิดใช้งาน`], ['plan', 'ตามแพ็กเกจ', 'เลือกได้หลายแพ็กเกจ'], ['tenant', 'เลือก Tenant', 'ค้นหาและเลือกรายบริษัท']].map(([k, l, d]) => (
            <button key={k} type="button" role="radio" aria-checked={f.mode === k} className={`cmp-mode ${f.mode === k ? 'on' : ''}`} onClick={() => setF({ ...f, mode: k })}><b>{l}</b><span>{d}</span></button>
          ))}
        </div>
        {f.mode === 'plan' && (
          <div className="cmp-pick">
            {meta.plans.map((p) => {
              const n = active.filter((t) => t.plan_id === p.id).length
              return <label key={p.id} className="chk"><input type="checkbox" checked={f.plans.includes(p.id)} onChange={() => toggle('plans', p.id)} />{p.name} · {n} บริษัท</label>
            })}
          </div>
        )}
        {f.mode === 'tenant' && (
          <div className="cmp-tenants">
            <input className="cell-in" value={tq} onChange={(e) => setTq(e.target.value)} placeholder="ค้นหาชื่อบริษัทหรือรหัสนำหน้า เช่น SN" aria-label="ค้นหา Tenant" />
            <div className="cmp-tlist">
              {active.filter((t) => !tf || `${t.name} ${t.code_prefix || ''}`.toLowerCase().includes(tf)).map((t) => (
                <label key={t.tenant_id} className="chk"><input type="checkbox" checked={f.tenants.includes(t.tenant_id)} onChange={() => toggle('tenants', t.tenant_id)} />
                  <span>{t.name}{t.code_prefix && <span className="muted"> · {t.code_prefix}</span>}{t.plan_id && <span className="muted"> · {meta.plans.find((p) => p.id === t.plan_id)?.name || t.plan_id}</span>}</span></label>
              ))}
            </div>
          </div>
        )}
        <div className="field" style={{ marginTop: 14 }}><label>บทบาทที่จะเห็นข้อความ</label>
          <div className="chk-row" style={{ marginTop: 4 }}>
            {SEND_ROLES.map((r) => <label key={r} className="chk"><input type="checkbox" checked={f.roles.includes(r)} onChange={() => toggle('roles', r)} />{ROLE_TH[r]}</label>)}
          </div>
          {f.roles.includes('supervisor') && <p className="hint">สายตรวจใช้งานผ่าน LINE อย่างเดียว จะเห็นข้อความเมื่อมีกล่องข้อความใน Patrol</p>}
        </div>
        <div className={`cmp-est ${targets.length ? '' : 'none'}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-11 11M22 2l-7 20-4-9-9-4z" /></svg>
          {targets.length ? <>ส่งถึง <b>{targets.length} Tenant</b> · {f.roles.length ? f.roles.map((r) => ROLE_TH[r]).join(', ') : 'ยังไม่ได้เลือกบทบาท'}</> : 'ยังไม่ได้เลือกผู้รับ'}
        </div>

        <h3 className="cmp-h">2. เนื้อหา</h3>
        <div className="form-grid">
          <div className="field"><label>ประเภท</label>
            <select value={f.category} onChange={set('category')}>{CAT_KEYS.map((k) => <option key={k} value={k}>{CAT[k].label}</option>)}</select></div>
          <div className="field"><label>ความสำคัญ</label>
            <div className="seg sm" role="radiogroup">
              {[['normal', 'ปกติ'], ['high', 'สำคัญ']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.priority === k} className={f.priority === k ? 'on' : ''} onClick={() => setF({ ...f, priority: k })}>{l}</button>)}
            </div></div>
          <div className="field wide"><label>หัวข้อ</label><input value={f.title} onChange={set('title')} maxLength={150} placeholder="เช่น ปิดปรับปรุงระบบ 2 พ.ย. 01:00–03:00 น." /></div>
          <div className="field wide"><label>ข้อความ</label><textarea className="input" rows={6} value={f.body} maxLength={MAX_BODY} onChange={set('body')} />
            <div className="hint" style={{ textAlign: 'right' }}>{f.body.length.toLocaleString('th-TH')} / {MAX_BODY.toLocaleString('th-TH')} ตัวอักษร</div></div>
        </div>

        <h3 className="cmp-h">3. ปุ่มลิงก์และวันหมดอายุ <span className="muted">(ไม่บังคับ)</span></h3>
        <div className="form-grid">
          <div className="field"><label>ข้อความบนปุ่ม</label><input value={f.cta_label} onChange={set('cta_label')} placeholder="ติดต่อทีม Horguard" /></div>
          <div className="field"><label>ลิงก์</label>
            <input list="cta-presets" value={f.cta_url} onChange={set('cta_url')} placeholder={LINE_OA} />
            <datalist id="cta-presets"><option value={LINE_OA}>LINE OA</option><option value="force:myplan">หน้าแพ็กเกจของฉัน</option><option value="force:reports">หน้ารายงาน</option></datalist></div>
          <div className="field"><label>ซ่อนข้อความหลังวันที่</label><input type="date" value={f.expires} onChange={set('expires')} /></div>
        </div>
        <p className="hint">ลิงก์ force:myplan เปิดหน้า "แพ็กเกจของฉัน" ใน Force · ลิงก์ http(s) เปิดในแท็บใหม่</p>
        {err && <div className="notice err">{err}</div>}
        <div className="modal-foot">
          <span className="hint grow">ส่งแล้วถอนข้อความได้ภายหลังที่แท็บ "ข้อความที่ส่งแล้ว"</span>
          <button className="btn inline" disabled={!ready} onClick={() => setConfirm(true)}>ส่งข้อความ</button>
        </div>
      </div>

      <aside className="card cmp-prev" aria-label="ตัวอย่าง">
        <h3 className="cmp-h" style={{ marginTop: 0 }}>ตัวอย่างในกล่องข้อความของ Tenant</h3>
        <p className="muted" style={{ marginTop: -6 }}>อัปเดตตามที่พิมพ์ทันที</p>
        <Preview f={f} />
      </aside>

      {confirm && (
        <div className="modal-back" onClick={() => !busy && setConfirm(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cf-h" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h"><h2 id="cf-h">ยืนยันส่งข้อความ</h2><button className="link-btn" onClick={() => setConfirm(false)} disabled={busy}>ปิด</button></div>
            <p><b>{f.title}</b></p>
            <ul className="cf-list">
              <li>ส่งถึง <b>{targets.length} Tenant</b>{targets.length <= 6 ? `: ${targets.map((t) => t.name).join(', ')}` : ''}</li>
              <li>บทบาท: {f.roles.map((r) => ROLE_TH[r]).join(', ')}</li>
              <li>ประเภท: {CAT[f.category].label}{f.priority === 'high' ? ' · สำคัญ' : ''}{f.expires ? ` · ซ่อนหลัง ${new Date(`${f.expires}T00:00:00+07:00`).toLocaleDateString('th-TH', { dateStyle: 'medium' })}` : ''}</li>
            </ul>
            <p className="muted">ข้อความจะเข้ากล่องข้อความของผู้รับทันที</p>
            {err && <div className="notice err">{err}</div>}
            <div className="modal-foot"><span className="grow" />
              <button className="btn inline ghost" onClick={() => setConfirm(false)} disabled={busy}>ยกเลิก</button>
              <button className="btn inline" onClick={send} disabled={busy}>{busy ? 'กำลังส่ง…' : 'ยืนยันส่ง'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Preview({ f }) {
  const title = f.title.trim() || 'หัวข้อข้อความ'
  const body = f.body.trim() || 'ข้อความจะแสดงตรงนี้'
  return (
    <div className="cmp-preview">
      <div className="ibx-item unread static">
        <span className={`ibx-ico ${CAT[f.category]?.tone || ''}`}><CatIcon c={f.category} /></span>
        <span className="ibx-mid">
          <span className="ibx-row1"><b>{title}</b><time>ตอนนี้</time></span>
          <span className="ibx-snip">{body}</span>
          <span className="ibx-tags"><CatTag c={f.category} />{f.priority === 'high' && <HighTag />}</span>
        </span>
      </div>
      <div className="cmp-prev-read">
        <span className="ibx-tags"><CatTag c={f.category} />{f.priority === 'high' && <HighTag />}</span>
        <h4>{title}</h4>
        <div className="muted">ทีม Horguard · ส่งถึง {f.roles.map((r) => ROLE_TH[r]).join(', ') || '—'}</div>
        <p>{body}</p>
        {f.cta_url.trim() && <span className="btn inline sm">{f.cta_label.trim() || 'เปิดลิงก์'}</span>}
      </div>
    </div>
  )
}

/* ─────────────── ข้อความที่ส่งแล้ว ─────────────── */
function Sent({ camps, meta, onChanged, onErr }) {
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const list = camps.campaigns || []
  const since = Date.now() - 30 * 86400000
  const recent = list.filter((c) => new Date(c.created_at).getTime() >= since)
  const recips = recent.reduce((s, c) => s + (c.recipients || 0), 0)
  const reads = recent.reduce((s, c) => s + (c.read || 0), 0)
  const planName = (id) => meta.plans.find((p) => p.id === id)?.name || id
  const tenantName = (id) => meta.tenants.find((t) => t.tenant_id === id)?.name || 'Tenant'
  const targetText = (t) => (t?.all ? 'ทุก Tenant' : t?.plan_ids ? `แพ็กเกจ ${t.plan_ids.map(planName).join(', ')}` : t?.tenant_ids ? t.tenant_ids.map(tenantName).join(', ') : '—')
  const pct = (c) => (c.recipients ? Math.round(((c.read || 0) / c.recipients) * 100) : 0)
  const cur = list.find((c) => c.id === open)

  async function retract() {
    setBusy(true)
    try {
      const o = await rpc('admin_inbox_retract', { p_campaign: cur.id })
      if (!o.ok) throw new Error(o.error)
      setOpen(null); setSure(false); onChanged(`ถอน "${cur.title}" แล้ว — ข้อความหายจากกล่องข้อความของทุก Tenant`)
    } catch (e) { onErr(errTh(e)) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="stat-row">
        <div className="stat"><div className="n">{recent.length}</div><div className="l">ข้อความที่ส่ง (30 วัน)</div></div>
        <div className="stat"><div className="n">{recips.toLocaleString('th-TH')}</div><div className="l">ผู้รับรวม (คน)</div></div>
        <div className="stat"><div className="n">{recips ? `${Math.round((reads / recips) * 100)}%` : '—'}</div><div className="l">อ่านแล้วเฉลี่ย</div></div>
      </div>
      {!list.length ? <p className="muted">ยังไม่เคยส่งข้อความ</p> : (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>ข้อความ</th><th>ส่งถึง</th><th>Tenant</th><th>ผู้รับ</th><th>อ่านแล้ว</th><th>ส่งเมื่อ</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="click" onClick={() => { setOpen(c.id); setSure(false) }}>
                  <td style={{ minWidth: 240 }}><b>{c.title}</b><div className="ibx-tags" style={{ marginTop: 4 }}><CatTag c={c.category} />{c.priority === 'high' && <HighTag />}</div></td>
                  <td style={{ minWidth: 140 }}>{targetText(c.target)}</td>
                  <td>{c.tenant_count}</td>
                  <td>{c.recipients}</td>
                  <td style={{ minWidth: 120 }}><div className="ub-top" style={{ marginBottom: 3 }}><span>{c.read || 0}/{c.recipients}</span><b>{pct(c)}%</b></div><div className="ub-bar"><i style={{ width: `${pct(c)}%` }} /></div></td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{mailTime(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-h"><h2>แจ้งเตือนอัตโนมัติล่าสุด</h2><span className="muted">ระบบส่งเองเมื่อแพ็กเกจใกล้เต็ม/เต็ม ผู้ใช้เกิน หรือทดลองใช้ใกล้หมด</span></div>
      <div className="card sys-list">
        {!(camps.system_recent || []).length ? <p className="muted" style={{ margin: 0 }}>ยังไม่มีแจ้งเตือนอัตโนมัติ</p>
          : camps.system_recent.slice(0, 12).map((s, i) => (
            <div key={i} className="sys-row"><CatTag c={s.category} /><b>{s.tenant}</b><span className="grow">{s.title}</span><span className="muted">{mailTime(s.created_at)}</span></div>
          ))}
      </div>

      {cur && (
        <div className="drawer-back" onClick={() => !busy && setOpen(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="sd-h" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-h"><div className="muted">รายละเอียดข้อความ</div><button className="link-btn" onClick={() => setOpen(null)} disabled={busy}>ปิด ✕</button></div>
            <div className="ibx-tags"><CatTag c={cur.category} />{cur.priority === 'high' && <HighTag />}</div>
            <h2 id="sd-h" className="ibx-title">{cur.title}</h2>
            <p className="muted">ส่งโดย {cur.sender_name || 'Super Admin'} · {fullTime(cur.created_at)}<br />
              ถึง {targetText(cur.target)} · บทบาท {(cur.roles || []).map((r) => ROLE_TH[r] || r).join(', ')}{cur.expires_at ? ` · ซ่อนหลัง ${new Date(cur.expires_at).toLocaleDateString('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' })}` : ''}</p>
            <div className="ibx-body">{cur.body}</div>
            {cur.cta_url && <p className="muted">ปุ่ม: {cur.cta_label || 'เปิดลิงก์'} → {cur.cta_url}</p>}
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table className="grid">
                <thead><tr><th>Tenant</th><th style={{ textAlign: 'right' }}>อ่านแล้ว (คน)</th></tr></thead>
                <tbody>{(cur.tenants || []).map((t) => <tr key={t.tenant_id}><td>{t.name}</td><td style={{ textAlign: 'right' }}><b>{t.read}</b></td></tr>)}</tbody>
              </table>
            </div>
            <p className="hint">อ่านแล้วรวม {cur.read || 0} จากผู้รับ {cur.recipients} คน ({pct(cur)}%)</p>
            <p className="muted" style={{ marginTop: 16 }}>ถอนข้อความแล้ว ข้อความจะหายจากกล่องข้อความของทุก Tenant ทันที (บันทึกไว้ในประวัติการทำรายการ)</p>
            {!sure ? <button className="btn inline danger" onClick={() => setSure(true)} disabled={busy}>ถอนข้อความ</button>
              : <div className="actions" style={{ justifyContent: 'flex-start' }}>
                  <button className="btn inline danger" onClick={retract} disabled={busy}>{busy ? 'กำลังถอน…' : 'ยืนยันถอนข้อความ'}</button>
                  <button className="btn inline ghost" onClick={() => setSure(false)} disabled={busy}>ยกเลิก</button>
                </div>}
          </aside>
        </div>
      )}
    </>
  )
}
