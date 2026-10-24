// ตัวอย่างการ์ดราคาแบบเดียวกับหน้าเว็บ horguard.com/#pricing — ใช้ในหน้า Super Admin ก่อนบันทึก
import { useState } from 'react'
import { LIMITS, baht, limitText, yearlyPrice } from '../lib/plans'

export default function PricingPreview({ plans, content, addons }) {
  const [yearly, setYearly] = useState(false)
  const c = content || {}
  const labels = c.limit_labels || {}
  const shown = (plans || []).filter((p) => p.is_public && p.is_active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const mf = Number(c.months_free_yearly) || 0
  return (
    <div className="pp">
      <div className="pp-head">
        <h3>{c.title || 'ราคา'}</h3>
        {c.subtitle && <p>{c.subtitle}</p>}
        <div className="pp-toggle" role="group" aria-label="รอบบิล">
          <button type="button" className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>รายเดือน</button>
          <button type="button" className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>รายปี{mf ? ` · ลด ${mf} เดือน` : ''}</button>
        </div>
      </div>
      {!shown.length ? <p className="muted">ยังไม่มีแพ็กเกจที่ตั้ง "แสดงบนเว็บ"</p> : (
        <div className="pp-grid">
          {shown.map((p) => {
            const y = yearlyPrice(p, mf)
            return (
              <div key={p.id} className={`pp-card ${p.highlight ? 'hi' : ''}`}>
                {p.badge && <span className="pp-badge">{p.badge}</span>}
                <div className="pp-name">{p.name}</div>
                {p.tagline && <div className="pp-tag">{p.tagline}</div>}
                <div className="pp-price">
                  {p.price_monthly == null || p.price_monthly === '' ? <b>ติดต่อฝ่ายขาย</b>
                    : yearly && y != null ? <><b>{baht(y)}</b><span>/ปี</span></>
                      : <><b>{baht(p.price_monthly)}</b><span>/เดือน</span></>}
                </div>
                <div className="pp-sub">รวม {limitText(p.included_users, 'คน')} · คนเกิน {baht(p.overage_per_user)}/คน</div>
                <ul>{(p.features || []).map((f, i) => <li key={i}>{f}</li>)}</ul>
                <details>
                  <summary>เพดานทั้งหมด</summary>
                  <dl>{LIMITS.map((l) => <div key={l.k}><dt>{labels[l.k] || l.label}</dt><dd>{limitText(p.limits?.[l.k], l.unit)}</dd></div>)}
                    <div><dt>{labels.own_line_oa || 'LINE OA แบรนด์ตัวเอง'}</dt><dd>{p.limits?.own_line_oa ? '✓' : '–'}</dd></div>
                    {p.support_text && <div><dt>Support</dt><dd>{p.support_text}</dd></div>}
                  </dl>
                </details>
                <div className="pp-cta">{p.cta_label || 'ขอดูเดโม'}</div>
                <div className="pp-setup">ค่าเริ่มระบบ {p.setup_fee != null && p.setup_fee !== '' ? baht(p.setup_fee) : (p.setup_fee_note || '—')}</div>
              </div>
            )
          })}
        </div>
      )}
      {(c.notes?.length || c.vat_note || c.counting_rule) && (
        <div className="pp-notes">
          {c.vat_note && <span>{c.vat_note}</span>}
          {(c.notes || []).map((n, i) => <span key={i}>{n}</span>)}
          {c.counting_rule && <p>{c.counting_rule}</p>}
        </div>
      )}
      {addons?.filter((a) => a.is_public).length > 0 && (
        <div className="pp-addons"><b>ซื้อเพิ่มรายตัว</b>
          {addons.filter((a) => a.is_public).map((a) => <span key={a.id || a.name}>{a.name} {baht(a.price)}/{a.unit || 'เดือน'}</span>)}
        </div>
      )}
    </div>
  )
}
