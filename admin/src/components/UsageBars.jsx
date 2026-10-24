// แถบการใช้งานเทียบเพดานแพ็กเกจ จากผล tenant_usage()
import { LIMITS, limitText } from '../lib/plans'

export default function UsageBars({ data }) {
  if (!data) return null
  const lim = data.limits || {}
  const use = data.usage || {}
  return (
    <div className="ub">
      {LIMITS.filter((l) => !l.info).map((l) => {
        const max = lim[l.k]
        const used = Number(use[l.k] || 0)
        const pct = max == null ? 0 : max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100))
        const tone = max == null ? '' : pct >= 100 ? 'full' : pct >= 80 ? 'near' : ''
        return (
          <div key={l.k} className={`ub-row ${tone}`}>
            <div className="ub-top">
              <span>{l.label}{l.k === 'max_checkpoints_per_property' && <small> (โครงการที่มีมากที่สุด)</small>}</span>
              <b>{used.toLocaleString('th-TH')} / {max == null ? 'ไม่จำกัด' : `${Number(max).toLocaleString('th-TH')} ${l.unit}`}</b>
            </div>
            <div className="ub-bar" aria-hidden="true"><i style={{ width: max == null ? '100%' : `${pct}%` }} className={max == null ? 'inf' : ''} /></div>
          </div>
        )
      })}
      <div className="ub-info">
        {LIMITS.filter((l) => l.info).map((l) => <span key={l.k}>{l.label}: <b>{limitText(lim[l.k], l.unit)}</b></span>)}
      </div>
    </div>
  )
}
