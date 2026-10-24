// แพ็กเกจของฉัน (เจ้าของ / แอดมิน) — แพ็กเกจปัจจุบัน การใช้งานเทียบเพดาน และประมาณการค่าบริการเดือนนี้ (tenant_usage)
import { useEffect, useState } from 'react'
import { rpc, errTh } from '../lib/api'
import { seeMoney } from '../lib/perm'
import { STATUS_TH, CYCLE_TH, baht, limitText, daysLeft } from '../lib/plans'
import { SkStats, SkCards } from '../components/Skeleton.jsx'
import UsageBars from '../components/UsageBars.jsx'

const LINE_OA = 'https://lin.ee/5e7WMZj'

export default function MyPlan() {
  const [u, setU] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    rpc('tenant_usage').then((o) => { if (o?.ok === false) throw new Error(o.error); setU(o) }).catch((e) => setErr(errTh(e)))
  }, [])
  const M = seeMoney()

  if (err) return <div className="notice err">{err}</div>
  if (!u) return <><SkStats n={4} /><SkCards n={3} h={48} /></>
  const p = u.plan || {}
  if (!p.id) return <div className="notice info">บริษัทของคุณยังไม่ได้กำหนดแพ็กเกจ — ติดต่อ Horguard ทาง <a href={LINE_OA} target="_blank" rel="noopener">LINE OA</a></div>
  const left = daysLeft(u.trial_ends_at)
  const b = u.billing || {}

  return (
    <div>
      <div className="card myplan-hero">
        <div>
          <div className="muted">แพ็กเกจปัจจุบัน</div>
          <div className="mp-name">{p.name}
            {u.status === 'trial' ? <span className={`badge ${left != null && left <= 7 ? 'warn' : 'solid'}`}>ทดลองใช้ · {left > 0 ? `เหลือ ${left} วัน` : 'หมดช่วงทดลองแล้ว'}</span>
              : <span className={`badge ${u.status === 'suspended' ? 'alert' : 'duty'}`}>{STATUS_TH[u.status] || u.status}</span>}
          </div>
          <div className="muted">{p.tagline}{M && p.price_monthly != null ? ` · ${baht(p.price_monthly)}/เดือน รวมผู้ใช้หน้างาน ${limitText(p.included_users, 'คน')} · คนเกินคนละ ${baht(p.overage_per_user)}` : ''}{u.billing_cycle ? ` · จ่าย${CYCLE_TH[u.billing_cycle]}` : ''}</div>
        </div>
        <a className="btn inline" href={LINE_OA} target="_blank" rel="noopener">ติดต่ออัปเกรด</a>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="n">{b.active_users ?? 0}</div><div className="l">ผู้ใช้หน้างานที่เข้างานเดือนนี้</div></div>
        <div className="stat"><div className="n">{limitText(b.included, '')}</div><div className="l">รวมอยู่ในแพ็กเกจ (คน)</div></div>
        <div className={`stat ${b.overage_users > 0 ? 'warn' : ''}`}><div className="n">{b.overage_users ?? 0}</div><div className="l">คนเกิน{M && b.overage_per_user != null ? ` (คนละ ${baht(b.overage_per_user)})` : ''}</div></div>
        {M && <div className="stat"><div className="n">{baht(b.estimate_monthly)}</div><div className="l">ประมาณการเดือนนี้ (ไม่รวม VAT)</div></div>}
      </div>

      {M && b.cheaper_plan && (
        <div className="notice info upsell">
          <b>อัปเกรดแล้วถูกกว่า:</b> ด้วยจำนวนผู้ใช้เดือนนี้ แพ็กเกจ <b>{b.cheaper_plan.name}</b> จะอยู่ที่ประมาณ {baht(b.cheaper_plan.estimate_monthly)}/เดือน
          (ตอนนี้ {baht(b.estimate_monthly)}) และได้เพดานสูงขึ้น — <a href={LINE_OA} target="_blank" rel="noopener">คุยกับ Horguard</a>
        </div>
      )}

      <div className="section-h"><h2>การใช้งานเทียบเพดาน</h2></div>
      <div className="card" style={{ padding: '18px 22px' }}><UsageBars data={u} /></div>
      <p className="hint">นับเฉพาะผู้ใช้หน้างาน (รปภ. หัวหน้ากะ สแปร์ สายตรวจ) ที่เข้างานอย่างน้อย 1 ครั้งในเดือน · เจ้าของ แอดมิน ผู้จัดการโซน และลูกค้าไม่นับ ·
        ถึงเพดานแล้วจะเพิ่มรายการใหม่ไม่ได้ (ข้อมูลเดิมใช้งานได้ตามปกติ) — อัปเกรดหรือซื้อเพิ่มรายตัวได้ เช่น +5 โครงการ</p>
    </div>
  )
}
