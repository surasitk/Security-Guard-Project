// แพ็กเกจและราคา (เฉพาะ Super Admin) — migration 35
// 1) แพ็กเกจ: ราคา เพดาน และข้อความบนเว็บ (plans = CMS) · 2) Tenant: กำหนดแพ็กเกจ/สถานะ/เพดานเฉพาะราย · 3) หน้าเว็บ: ข้อความหน้า #pricing + ซื้อเพิ่ม
import { useEffect, useState } from 'react'
import { rpc, errTh, fmtDate } from '../lib/api'
import { LIMITS, STATUS_TH, CYCLE_TH, baht, limitText, yearlyPrice, daysLeft } from '../lib/plans'
import { SkCards, SkTable } from '../components/Skeleton.jsx'
import PricingPreview from '../components/PricingPreview.jsx'
import UsageBars from '../components/UsageBars.jsx'

const SITE_URL = 'https://horguard.com/#pricing'
const num = (v) => (v === '' || v == null ? null : Number(v))

export default function Packages() {
  const [tab, setTab] = useState('plans')
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState(null)
  const [editPlan, setEditPlan] = useState(null)
  const [editTenant, setEditTenant] = useState(null)

  const load = () => rpc('admin_list_plans').then((o) => {
    if (o?.ok === false) throw new Error(o.error)
    setData(o)
  }).catch((e) => setMsg({ t: 'err', m: errTh(e) }))
  useEffect(() => { load() }, [])
  const done = (m) => { setMsg({ t: 'ok', m }); load() }

  return (
    <div>
      <div className="tabs" role="tablist">
        {[['plans', 'แพ็กเกจ'], ['tenants', 'Tenant'], ['site', 'หน้าเว็บ (CMS)']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(null) }}>{l}</button>
        ))}
      </div>
      {msg && <div className={`notice ${msg.t === 'err' ? 'err' : ''}`} style={{ marginTop: 0 }}>{msg.m}</div>}
      {!data ? (tab === 'tenants' ? <SkTable rows={3} cols={7} /> : <SkCards n={3} />)
        : tab === 'plans' ? <PlansTab data={data} onEdit={setEditPlan} />
          : tab === 'tenants' ? <TenantsTab data={data} onEdit={setEditTenant} />
            : <SiteTab data={data} onSaved={done} onErr={(m) => setMsg({ t: 'err', m })} />}
      {editPlan && <PlanEditor plan={editPlan} data={data} onClose={() => setEditPlan(null)} onSaved={(m) => { setEditPlan(null); done(m) }} />}
      {editTenant && <TenantPlanModal row={editTenant} data={data} onClose={() => setEditTenant(null)} onSaved={(m) => { setEditTenant(null); done(m) }} />}
    </div>
  )
}

/* ─────────────── 1) แพ็กเกจ ─────────────── */
function PlansTab({ data, onEdit }) {
  const mf = data.content?.months_free_yearly ?? 2
  return (
    <>
      <div className="section-h">
        <h2>แพ็กเกจทั้งหมด ({data.plans.length})</h2>
        <button className="btn inline sm" onClick={() => onEdit({ __new: true, id: '', name: '', limits: {}, features: [], is_public: true, is_active: true, sort_order: (data.plans.length + 1) * 10 })}>+ เพิ่มแพ็กเกจ</button>
      </div>
      <p className="muted" style={{ marginTop: -4 }}>ทุกแพ็กเกจได้ฟีเจอร์ครบเท่ากัน ต่างกันที่จำนวนผู้ใช้หน้างานและเพดานการใช้งาน · ราคาไม่รวม VAT · แก้แล้วหน้าเว็บอัปเดตทันที</p>
      <div className="pkg-grid">
        {data.plans.map((p) => (
          <div key={p.id} className={`pkg-card ${p.highlight ? 'hi' : ''} ${p.is_active ? '' : 'off'}`}>
            <div className="pkg-top">
              <div><div className="pkg-name">{p.name}{p.badge && <span className="badge solid" style={{ marginLeft: 8 }}>{p.badge}</span>}</div>
                <div className="muted">{p.tagline || '—'}</div></div>
              <span className="badge">{p.id}</span>
            </div>
            <div className="pkg-price"><b>{p.price_monthly == null ? 'ติดต่อฝ่ายขาย' : baht(p.price_monthly)}</b>{p.price_monthly != null && <span>/เดือน · ปีละ {baht(yearlyPrice(p, mf))}</span>}</div>
            <div className="pkg-meta">รวม {limitText(p.included_users, 'คน')} · คนเกินคนละ {baht(p.overage_per_user)} · ค่าเริ่มระบบ {p.setup_fee != null ? baht(p.setup_fee) : (p.setup_fee_note || '—')}</div>
            <dl className="pkg-limits">
              {LIMITS.map((l) => <div key={l.k}><dt>{l.label}</dt><dd>{limitText(p.limits?.[l.k], l.unit)}</dd></div>)}
              <div><dt>LINE OA แบรนด์ตัวเอง</dt><dd>{p.limits?.own_line_oa ? '✓' : '–'}</dd></div>
              <div><dt>Support</dt><dd>{p.support_text || '—'}</dd></div>
            </dl>
            <div className="pkg-foot">
              <span className="muted">{p.tenant_count} Tenant</span>
              {p.is_public ? <span className="badge duty">แสดงบนเว็บ</span> : <span className="badge">ซ่อนจากเว็บ</span>}
              {!p.is_active && <span className="badge warn">ปิดใช้</span>}
              <span className="grow" />
              <button className="btn inline sm ghost" onClick={() => onEdit(p)}>แก้ไข</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function LimitInput({ k, unit, value, onChange, planValue, mode }) {
  // mode 'plan' = แก้แพ็กเกจ (ค่า/ไม่จำกัด) · 'override' = ค่าเฉพาะ Tenant (ใช้ค่าแพ็กเกจ/ค่า/ไม่จำกัด)
  const state = mode === 'override' ? (value === undefined ? 'plan' : value === null ? 'unlimited' : 'value')
    : (value == null ? 'unlimited' : 'value')
  return (
    <div className="lim-in">
      {mode === 'override' ? (
        <select value={state} onChange={(e) => onChange(e.target.value === 'plan' ? undefined : e.target.value === 'unlimited' ? null : (planValue ?? 0))} aria-label={`รูปแบบ ${k}`}>
          <option value="plan">ใช้ค่าของแพ็กเกจ ({limitText(planValue, unit)})</option>
          <option value="value">กำหนดเอง</option>
          <option value="unlimited">ไม่จำกัด</option>
        </select>
      ) : (
        <label className="chk"><input type="checkbox" checked={state === 'unlimited'} onChange={(e) => onChange(e.target.checked ? null : 0)} />ไม่จำกัด</label>
      )}
      {state === 'value' && <input type="number" min="0" step="1" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} aria-label={k} />}
      {state === 'value' && <span className="muted">{unit}</span>}
    </div>
  )
}

function PlanEditor({ plan, data, onClose, onSaved }) {
  const isNew = !!plan.__new
  const [p, setP] = useState(() => ({
    ...plan, limits: { ...(plan.limits || {}) },
    featuresText: (plan.features || []).join('\n'),
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const setLim = (k, v) => setP({ ...p, limits: { ...p.limits, [k]: v } })
  const mf = data.content?.months_free_yearly ?? 2

  async function save(e) {
    e.preventDefault(); setErr('')
    if (isNew && data.plans.some((x) => x.id === p.id.trim().toLowerCase())) { setErr('มีรหัสแพ็กเกจนี้แล้ว'); return }
    setBusy(true)
    try {
      const limits = {}
      for (const l of LIMITS) limits[l.k] = p.limits[l.k] == null ? null : Number(p.limits[l.k])
      limits.own_line_oa = !!p.limits.own_line_oa
      const o = await rpc('admin_save_plan', { p: {
        id: p.id.trim().toLowerCase(), name: p.name, tagline: p.tagline || null,
        price_monthly: num(p.price_monthly), price_yearly: num(p.price_yearly), setup_fee: num(p.setup_fee), setup_fee_note: p.setup_fee_note || null,
        included_users: num(p.included_users), overage_per_user: num(p.overage_per_user),
        limits, features: p.featuresText.split('\n').map((s) => s.trim()).filter(Boolean),
        support_text: p.support_text || null, badge: p.badge || null, highlight: !!p.highlight,
        cta_label: p.cta_label || null, cta_url: p.cta_url || null, sort_order: num(p.sort_order) ?? 0,
        is_public: !!p.is_public, is_active: !!p.is_active,
      } })
      if (!o.ok) throw new Error(o.error)
      onSaved(`บันทึกแพ็กเกจ ${p.name} แล้ว — หน้าเว็บใช้ราคาใหม่ทันที`)
    } catch (e2) { setErr(errTh(e2)) } finally { setBusy(false) }
  }

  return (
    <div className="drawer-back" onClick={() => !busy && onClose()}>
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="pe-h" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={save}>
          <div className="drawer-h">
            <div><div className="muted">แพ็กเกจ</div><h2 id="pe-h">{isNew ? 'เพิ่มแพ็กเกจ' : `แก้ไข ${plan.name}`}</h2>
              {!isNew && <span className="muted">{plan.tenant_count} Tenant ใช้แพ็กเกจนี้ — เพดานใหม่มีผลทันที</span>}</div>
            <button type="button" className="link-btn" onClick={onClose} disabled={busy}>ปิด ✕</button>
          </div>

          <fieldset className="pe-sec"><legend>ข้อมูลหลัก</legend>
            <div className="form-grid">
              <div className="field"><label>รหัส (slug) *</label><input value={p.id} onChange={set('id')} disabled={!isNew} pattern="[a-z0-9_\-]{2,30}" placeholder="เช่น business" required /></div>
              <div className="field"><label>ชื่อ *</label><input value={p.name || ''} onChange={set('name')} required /></div>
              <div className="field wide"><label>คำโปรย</label><input value={p.tagline || ''} onChange={set('tagline')} placeholder="สำหรับบริษัท 50–300 คน" /></div>
              <div className="field"><label>ลำดับ</label><input type="number" value={p.sort_order ?? ''} onChange={set('sort_order')} /></div>
            </div>
          </fieldset>

          <fieldset className="pe-sec"><legend>ราคา (บาท ไม่รวม VAT)</legend>
            <div className="form-grid">
              <div className="field"><label>รายเดือน</label><input type="number" min="0" value={p.price_monthly ?? ''} onChange={set('price_monthly')} placeholder="ว่าง = ติดต่อฝ่ายขาย" /></div>
              <div className="field"><label>รายปี</label><input type="number" min="0" value={p.price_yearly ?? ''} onChange={set('price_yearly')} placeholder={`ว่าง = ${baht(yearlyPrice({ price_monthly: p.price_monthly }, mf))}`} /></div>
              <div className="field"><label>รวมผู้ใช้หน้างาน (คน)</label><input type="number" min="0" value={p.included_users ?? ''} onChange={set('included_users')} /></div>
              <div className="field"><label>คนเกิน คิดเพิ่มคนละ</label><input type="number" min="0" value={p.overage_per_user ?? ''} onChange={set('overage_per_user')} /></div>
              <div className="field"><label>ค่าเริ่มระบบ</label><input type="number" min="0" value={p.setup_fee ?? ''} onChange={set('setup_fee')} /></div>
              <div className="field"><label>หมายเหตุค่าเริ่มระบบ</label><input value={p.setup_fee_note || ''} onChange={set('setup_fee_note')} placeholder="ตามขอบเขตงาน" /></div>
            </div>
            {num(p.price_monthly) != null && num(p.included_users) ? <p className="hint">เฉลี่ยต่อคน ~{baht(Math.round(num(p.price_monthly) / num(p.included_users)))}</p> : null}
          </fieldset>

          <fieldset className="pe-sec"><legend>เพดานการใช้งาน</legend>
            <div className="lim-list">
              {LIMITS.map((l) => (
                <div key={l.k} className="lim-row">
                  <div><b>{l.label}</b>{l.hint && <div className="muted">{l.hint}</div>}</div>
                  <LimitInput k={l.k} unit={l.unit} value={p.limits[l.k]} onChange={(v) => setLim(l.k, v)} mode="plan" />
                </div>
              ))}
              <div className="lim-row"><div><b>LINE OA แบรนด์ตัวเอง</b></div>
                <label className="chk"><input type="checkbox" checked={!!p.limits.own_line_oa} onChange={(e) => setLim('own_line_oa', e.target.checked)} />มี</label></div>
            </div>
          </fieldset>

          <fieldset className="pe-sec"><legend>หน้าเว็บไซต์</legend>
            <div className="form-grid">
              <div className="field wide"><label>จุดเด่น (หนึ่งบรรทัดต่อหนึ่งข้อ)</label><textarea className="input" rows={7} value={p.featuresText} onChange={set('featuresText')} /></div>
              <div className="field wide"><label>Support</label><input value={p.support_text || ''} onChange={set('support_text')} /></div>
              <div className="field"><label>ป้าย (badge)</label><input value={p.badge || ''} onChange={set('badge')} placeholder="แนะนำ" /></div>
              <div className="field"><label>ข้อความปุ่ม</label><input value={p.cta_label || ''} onChange={set('cta_label')} placeholder="ขอดูเดโม" /></div>
              <div className="field wide"><label>ลิงก์ปุ่ม</label><input type="url" value={p.cta_url || ''} onChange={set('cta_url')} placeholder="ว่าง = LINE OA ของ Horguard" /></div>
            </div>
            <div className="chk-row">
              <label className="chk"><input type="checkbox" checked={!!p.highlight} onChange={set('highlight')} />เน้นการ์ดนี้</label>
              <label className="chk"><input type="checkbox" checked={!!p.is_public} onChange={set('is_public')} />แสดงบนเว็บ</label>
              <label className="chk"><input type="checkbox" checked={!!p.is_active} onChange={set('is_active')} />เปิดใช้ (กำหนดให้ Tenant ได้)</label>
            </div>
          </fieldset>

          {err && <div className="notice err">{err}</div>}
          <div className="modal-foot">
            <span className="grow" />
            <button type="button" className="btn inline ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
            <button type="submit" className="btn inline" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกแพ็กเกจ'}</button>
          </div>
        </form>
      </aside>
    </div>
  )
}

/* ─────────────── 2) Tenant ─────────────── */
function TenantsTab({ data, onEdit }) {
  const plan = (id) => data.plans.find((p) => p.id === id)
  return (
    <>
      <div className="section-h"><h2>แพ็กเกจของแต่ละ Tenant ({data.tenants.length})</h2></div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>Tenant</th><th>แพ็กเกจ</th><th>สถานะ</th><th>รอบบิล</th><th>ผู้ใช้หน้างาน</th><th>โครงการ</th><th>เพดานเฉพาะราย</th><th></th></tr></thead>
          <tbody>
            {data.tenants.map((t) => {
              const p = plan(t.plan_id)
              const left = daysLeft(t.trial_ends_at)
              const fu = p?.limits?.max_field_users
              const pr = p?.limits?.max_properties
              const ov = Object.keys(t.overrides || {}).length
              return (
                <tr key={t.tenant_id} style={{ opacity: t.is_active ? 1 : 0.55 }}>
                  <td><b>{t.name}</b>{t.code_prefix && <span className="badge" style={{ marginLeft: 8 }}>{t.code_prefix}</span>}{t.note && <div className="muted">{t.note}</div>}</td>
                  <td>{p ? <span className={`badge ${p.highlight ? 'solid' : ''}`}>{p.name}</span> : <span className="badge warn">ยังไม่กำหนด</span>}</td>
                  <td>{t.status === 'trial' ? <span className={`badge ${left != null && left <= 7 ? 'warn' : ''}`}>ทดลองใช้ · {left != null ? (left > 0 ? `เหลือ ${left} วัน` : 'หมดแล้ว') : '—'}</span>
                    : t.status === 'suspended' ? <span className="badge alert">ระงับ</span> : t.status ? <span className="badge duty">ใช้งาน</span> : '—'}</td>
                  <td>{CYCLE_TH[t.billing_cycle] || '—'}</td>
                  <td className={fu != null && t.field_users >= fu ? 'alert-txt' : ''}>{t.field_users}{fu != null ? ` / ${fu}` : ''}</td>
                  <td className={pr != null && t.properties >= pr ? 'alert-txt' : ''}>{t.properties}{pr != null ? ` / ${pr}` : ''}</td>
                  <td>{ov ? <span className="badge">{ov} รายการ</span> : <span className="muted">—</span>}</td>
                  <td><button className="btn inline sm ghost" onClick={() => onEdit(t)}>เปลี่ยนแพ็กเกจ</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Tenant ใหม่ได้ทดลองใช้ {data.plans.find((p) => p.id === data.content?.trial_plan)?.name || 'Business'} {data.content?.trial_days || 30} วันอัตโนมัติ · ตัวเลขสีแดง = ถึงเพดานแล้ว</p>
    </>
  )
}

function TenantPlanModal({ row, data, onClose, onSaved }) {
  const [f, setF] = useState({
    plan: row.plan_id || data.content?.trial_plan || 'business', status: row.status || 'active', cycle: row.billing_cycle || 'monthly',
    trial: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString().slice(0, 10) : '',
    overrides: { ...(row.overrides || {}) }, note: row.note || '',
  })
  const [usage, setUsage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { rpc('tenant_usage', { p_tenant: row.tenant_id }).then(setUsage).catch(() => setUsage({ ok: false })) }, [row.tenant_id])
  const plan = data.plans.find((p) => p.id === f.plan)
  const setOv = (k, v) => { const o = { ...f.overrides }; if (v === undefined) delete o[k]; else o[k] = v; setF({ ...f, overrides: o }) }

  async function save() {
    setErr('')
    if (f.status === 'trial' && !f.trial) { setErr('กรุณาเลือกวันสิ้นสุดการทดลองใช้'); return }
    setBusy(true)
    try {
      const o = await rpc('admin_set_tenant_plan', {
        p_tenant: row.tenant_id, p_plan: f.plan, p_status: f.status, p_billing_cycle: f.cycle,
        p_trial_ends_at: f.status === 'trial' ? `${f.trial}T23:59:59+07:00` : null,
        p_overrides: f.overrides, p_note: f.note.trim() || null,
      })
      if (!o.ok) throw new Error(o.error)
      onSaved(`${row.name}: ${plan?.name || f.plan} · ${STATUS_TH[f.status]} — มีผลทันที`)
    } catch (e) { setErr(errTh(e)) } finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onClick={() => !busy && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="tp-h" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><h2 id="tp-h">แพ็กเกจของ {row.name}</h2><button className="link-btn" onClick={onClose} disabled={busy}>ปิด</button></div>
        <div className="tp-cols">
          <div>
            <div className="form-grid">
              <div className="field"><label>แพ็กเกจ</label>
                <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
                  {data.plans.filter((p) => p.is_active || p.id === row.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.price_monthly == null ? 'ติดต่อฝ่ายขาย' : `${baht(p.price_monthly)}/เดือน`}</option>)}
                </select></div>
              <div className="field"><label>สถานะ</label>
                <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {Object.entries(STATUS_TH).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
              <div className="field"><label>รอบบิล</label>
                <select value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value })}>
                  {Object.entries(CYCLE_TH).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
              {f.status === 'trial' && <div className="field"><label>ทดลองใช้ถึงวันที่</label><input type="date" value={f.trial} onChange={(e) => setF({ ...f, trial: e.target.value })} /></div>}
            </div>
            {f.status === 'suspended' && <div className="notice warn">สถานะระงับใช้บันทึกสถานะบิล — ยังไม่ปิดการใช้งานของ Tenant อัตโนมัติ (ปิด Tenant ได้ที่เมนู Tenant ในระบบ)</div>}
            <h3 className="sub-h">เพดานเฉพาะราย <span className="muted">(เช่น ซื้อ +5 โครงการ)</span></h3>
            <div className="lim-list">
              {LIMITS.map((l) => (
                <div key={l.k} className="lim-row">
                  <div><b>{l.label}</b></div>
                  <LimitInput k={l.k} unit={l.unit} value={f.overrides[l.k]} planValue={plan?.limits?.[l.k]} onChange={(v) => setOv(l.k, v)} mode="override" />
                </div>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}><label>หมายเหตุ</label><textarea className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น ซื้อ +5 โครงการ ตั้งแต่ พ.ย. 2569" /></div>
          </div>
          <div className="tp-usage">
            <h3 className="sub-h" style={{ marginTop: 0 }}>การใช้งานตอนนี้</h3>
            {!usage ? <SkCards n={1} /> : usage.ok === false ? <p className="muted">โหลดข้อมูลการใช้งานไม่ได้</p> : (
              <>
                <div className="stat-row" style={{ marginBottom: 12 }}>
                  <div className="stat"><div className="n">{usage.billing.active_users}</div><div className="l">ผู้ใช้หน้างานที่เข้างานเดือนนี้</div></div>
                  <div className="stat"><div className="n">{baht(usage.billing.estimate_monthly)}</div><div className="l">ประมาณการเดือนนี้ ({usage.plan?.name})</div></div>
                </div>
                <UsageBars data={usage} />
                <p className="hint">เพดานด้านบนเป็นค่าที่ใช้อยู่ตอนนี้ — เปลี่ยนแพ็กเกจแล้วกดบันทึก ตัวเลขจะอัปเดต</p>
              </>
            )}
          </div>
        </div>
        {err && <div className="notice err">{err}</div>}
        <div className="modal-foot">
          <span className="muted">อัปเดตล่าสุด {row.updated_at ? fmtDate(row.updated_at) : '—'}</span>
          <span className="grow" />
          <button className="btn inline ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn inline" onClick={save} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────── 3) หน้าเว็บ (CMS) ─────────────── */
function SiteTab({ data, onSaved, onErr }) {
  const c0 = data.content || {}
  const [c, setC] = useState(() => ({ ...c0, notesText: (c0.notes || []).join('\n'), limit_labels: { ...(c0.limit_labels || {}) } }))
  const [addons, setAddons] = useState(() => data.addons.map((a) => ({ ...a })))
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value })
  const content = () => {
    const { notesText, ...rest } = c
    return { ...rest, months_free_yearly: num(c.months_free_yearly) ?? 0, trial_days: num(c.trial_days) ?? 30, notes: notesText.split('\n').map((s) => s.trim()).filter(Boolean) }
  }

  async function saveContent() {
    setBusy(true)
    try {
      const o = await rpc('admin_save_site_content', { p_key: 'pricing', p_value: content() })
      if (!o.ok) throw new Error(o.error)
      onSaved('บันทึกข้อความหน้าราคาแล้ว — หน้าเว็บอัปเดตทันที')
    } catch (e) { onErr(errTh(e)) } finally { setBusy(false) }
  }
  async function saveAddon(a, del = false) {
    setBusy(true)
    try {
      const o = await rpc('admin_save_addon', { p: { ...a, delete: del, price: num(a.price), limit_delta: num(a.limit_delta), sort_order: num(a.sort_order) ?? 0 } })
      if (!o.ok) throw new Error(o.error)
      onSaved(del ? `ลบ ${a.name} แล้ว` : `บันทึก ${a.name} แล้ว`)
    } catch (e) { onErr(errTh(e)) } finally { setBusy(false) }
  }
  const setA = (i, k, v) => setAddons(addons.map((a, j) => (j === i ? { ...a, [k]: v } : a)))

  return (
    <>
      <div className="section-h"><h2>ข้อความหน้าราคา</h2><a className="btn inline sm ghost" href={SITE_URL} target="_blank" rel="noopener">เปิดหน้าเว็บ ↗</a></div>
      <div className="card" style={{ padding: '20px 22px' }}>
        <div className="form-grid">
          <div className="field wide"><label>หัวข้อ</label><input value={c.title || ''} onChange={set('title')} /></div>
          <div className="field wide"><label>คำอธิบาย</label><textarea className="input" rows={2} value={c.subtitle || ''} onChange={set('subtitle')} /></div>
          <div className="field"><label>หมายเหตุ VAT</label><input value={c.vat_note || ''} onChange={set('vat_note')} /></div>
          <div className="field"><label>จ่ายรายปี ลด (เดือน)</label><input type="number" min="0" max="11" value={c.months_free_yearly ?? ''} onChange={set('months_free_yearly')} /></div>
          <div className="field"><label>ทดลองใช้ (วัน)</label><input type="number" min="0" value={c.trial_days ?? ''} onChange={set('trial_days')} /></div>
          <div className="field"><label>แพ็กเกจทดลองของ Tenant ใหม่</label>
            <select value={c.trial_plan || 'business'} onChange={set('trial_plan')}>{data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field wide"><label>วิธีนับผู้ใช้</label><textarea className="input" rows={2} value={c.counting_rule || ''} onChange={set('counting_rule')} /></div>
          <div className="field wide"><label>เงื่อนไขเสริม (หนึ่งบรรทัดต่อหนึ่งข้อ)</label><textarea className="input" rows={3} value={c.notesText} onChange={set('notesText')} /></div>
        </div>
        <h3 className="sub-h">ชื่อเพดานที่แสดงในตารางเปรียบเทียบ</h3>
        <div className="form-grid">
          {[...LIMITS.map((l) => [l.k, l.label]), ['own_line_oa', 'LINE OA แบรนด์ตัวเอง']].map(([k, def]) => (
            <div key={k} className="field"><label>{def}</label><input value={c.limit_labels[k] ?? ''} placeholder={def} onChange={(e) => setC({ ...c, limit_labels: { ...c.limit_labels, [k]: e.target.value } })} /></div>
          ))}
        </div>
        <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
          <button className="btn inline" onClick={saveContent} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกข้อความ'}</button>
        </div>
      </div>

      <div className="section-h"><h2>ซื้อเพิ่มรายตัว (Add-on)</h2>
        <button className="btn inline sm" onClick={() => setAddons([...addons, { name: '', price: '', unit: 'เดือน', is_public: true, sort_order: (addons.length + 1) * 10 }])}>+ เพิ่ม</button></div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>ชื่อ</th><th>รายละเอียด</th><th>ราคา</th><th>ต่อ</th><th>เพิ่มเพดาน</th><th>บนเว็บ</th><th></th></tr></thead>
          <tbody>
            {addons.map((a, i) => (
              <tr key={a.id || `n${i}`}>
                <td><input className="cell-in" value={a.name} onChange={(e) => setA(i, 'name', e.target.value)} placeholder="+5 โครงการ" /></td>
                <td><input className="cell-in" value={a.description || ''} onChange={(e) => setA(i, 'description', e.target.value)} /></td>
                <td><input className="cell-in num" type="number" min="0" value={a.price ?? ''} onChange={(e) => setA(i, 'price', e.target.value)} /></td>
                <td><input className="cell-in sm" value={a.unit || ''} onChange={(e) => setA(i, 'unit', e.target.value)} /></td>
                <td><div className="addon-lim">
                  <select className="cell-in" value={a.limit_key || ''} onChange={(e) => setA(i, 'limit_key', e.target.value)}>
                    <option value="">—</option>{LIMITS.map((l) => <option key={l.k} value={l.k}>{l.label}</option>)}
                  </select>
                  {a.limit_key && <input className="cell-in num" type="number" value={a.limit_delta ?? ''} onChange={(e) => setA(i, 'limit_delta', e.target.value)} placeholder="+จำนวน" />}
                </div></td>
                <td><input type="checkbox" checked={!!a.is_public} onChange={(e) => setA(i, 'is_public', e.target.checked)} aria-label="แสดงบนเว็บ" /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn inline sm" onClick={() => saveAddon(a)} disabled={busy || !a.name.trim()}>บันทึก</button>
                  {a.id && <button className="btn inline sm ghost" style={{ marginLeft: 6 }} onClick={() => saveAddon(a, true)} disabled={busy}>ลบ</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Add-on เป็นรายการแสดงบนเว็บ — เมื่อลูกค้าซื้อจริง ให้ไปเพิ่มเพดานเฉพาะรายในแท็บ Tenant</p>

      <div className="section-h"><h2>ตัวอย่างบนเว็บ</h2><span className="muted">แสดงตามค่าที่กรอก (ยังไม่บันทึกก็เห็น)</span></div>
      <PricingPreview plans={data.plans} content={content()} addons={addons} />
    </>
  )
}
