import { useEffect, useState } from 'react'
import { initAuth, getUser, getVendor, switchVendor, tenantId, errTh } from './lib/api'
import Dashboard from './pages/Dashboard.jsx'
import Monitor from './pages/Monitor.jsx'
import People from './pages/People.jsx'
import Properties from './pages/Properties.jsx'
import Checkpoints from './pages/Checkpoints.jsx'
import Shifts from './pages/Shifts.jsx'
import Vendors from './pages/Vendors.jsx'
import Reports from './pages/Reports.jsx'
import ForceMap from './pages/ForceMap.jsx'
import Broadcast from './pages/Broadcast.jsx'
import ClientDashboard from './pages/ClientDashboard.jsx'
import GpsReport from './pages/GpsReport.jsx'
import { rpc } from './lib/api'
import logoWhite from './assets/horguard-white.png'
import logoNavy from './assets/horguard-navy.png'

// ไอคอนเส้น 18px (วาดเอง — ไม่พึ่งไลบรารี)
const I = {
  dash: <path d="M3 13h7V3H3zM14 21h7v-8h-7zM3 21h7v-4H3zM14 9h7V3h-7z" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  cal: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></>,
  site: <><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6M4 21h16" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  org: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>,
  map: <><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  megaphone: <><path d="M3 10v4h3l7 4V6L6 10z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" /><path d="M12 7.5v3.5M12 13.6v.01" /></>,
  report: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6M10 9h2" /></>,
}
const Icon = ({ k }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[k]}</svg>

// เรียงตามหมวด: ปฏิบัติการ → วางแผนและตั้งค่า → รายงาน → ผู้ดูแลระบบ
const BASE_TABS = [
  { group: 'ปฏิบัติการ', key: 'dashboard', label: 'ภาพรวมวันนี้', icon: 'dash', desc: 'ใครอยู่เวร ใครยังไม่เข้า และสิ่งที่ต้องจัดการวันนี้', el: Dashboard },
  { group: 'ปฏิบัติการ', key: 'forcemap', label: 'แผนที่กำลังพล', icon: 'map', desc: 'ใครเช็กอินอยู่ไซต์ไหนตอนนี้ ไซต์ที่คนขาด และส่งตัวสแปร์ที่อยู่ใกล้ที่สุดไปแทน · เหตุแจ้ง SOS', el: ForceMap },
  { group: 'ปฏิบัติการ', key: 'monitor', label: 'มอนิเตอร์', icon: 'eye', desc: 'เหตุการณ์เข้า-ออกงาน 7 วันล่าสุด พร้อมรูปและพิกัด', el: Monitor },
  { group: 'ปฏิบัติการ', key: 'broadcast', label: 'ประกาศกลุ่ม', icon: 'megaphone', desc: 'ส่งข้อความถึงทุกคนในโครงการหรือจังหวัดที่เลือก ผ่าน LINE OA', el: Broadcast, noLeader: true },
  { group: 'วางแผนและตั้งค่า', key: 'shifts', label: 'ตารางกะ', icon: 'cal', desc: 'สร้างแม่แบบกะ จ่ายกะ และจัดการกะที่กำลังจะถึง', el: Shifts },
  { group: 'วางแผนและตั้งค่า', key: 'properties', label: 'โครงการ', icon: 'site', desc: 'ที่ตั้ง พิกัด และรัศมีเช็คอินของแต่ละโครงการ', el: Properties },
  { group: 'วางแผนและตั้งค่า', key: 'checkpoints', label: 'จุดตรวจ (QR)', icon: 'qr', desc: 'จุดเดินตรวจและ QR สำหรับติดหน้างาน', el: Checkpoints },
  { group: 'วางแผนและตั้งค่า', key: 'people', label: 'ผู้ใช้และสิทธิ์', icon: 'users', desc: 'ข้อมูลผู้ใช้ บทบาท โครงการที่ได้รับมอบหมาย และวันหยุด', el: People },
  { group: 'รายงาน', key: 'reports', label: 'รายงาน', icon: 'report', desc: 'รายงานเวลาเข้า-ออกงาน สาย และ OT ตามโครงการ ช่วงวันที่ และรายชื่อ — Export เป็น Excel', el: Reports },
  { group: 'รายงาน', key: 'gpsreport', label: 'พิกัดน่าสงสัย', icon: 'pin', desc: 'การเข้า-ออกงานที่ระบบสงสัยว่าใช้พิกัดปลอม (Fake GPS) พร้อมเหตุผล รูป และพิกัด — ตรวจแล้วบันทึกผล ปกติ / ยืนยันผิดปกติ · Export Excel', el: GpsReport, noLeader: true },
  { group: 'รายงาน', key: 'client', label: 'แดชบอร์ดลูกค้า', icon: 'chart', desc: 'SLA การเข้ากะ ความครอบคลุมการตรวจตรา เหตุที่แจ้ง และ heat map จุดตรวจ รายโครงการ', el: ClientDashboard },
]
const VENDOR_TAB = { group: 'ผู้ดูแลระบบ', key: 'vendors', label: 'Tenant ในระบบ', icon: 'org', desc: 'Tenant = บริษัท รปภ. ที่ใช้ Horguard (เฉพาะ Super Admin)', el: Vendors }
const ROLE_TH = { owner: 'เจ้าของ', admin: 'แอดมิน', zone_manager: 'ผู้จัดการโซน', supervisor: 'สายตรวจ', shift_leader: 'หัวหน้ากะ', client: 'ลูกค้า' }
// ผู้จัดการโซน: ดูได้อย่างเดียว เฉพาะเมนูเหล่านี้ (ไม่เห็นค่าแรง/เงิน)
const ZONE_TABS = ['dashboard', 'forcemap', 'shifts', 'checkpoints', 'reports', 'gpsreport']

export default function App() {
  const [state, setState] = useState('loading')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('dashboard')
  const [isPlatform, setIsPlatform] = useState(false)
  const [vendors, setVendors] = useState([])
  const [ctx, setCtx] = useState(0)          // เปลี่ยนเมื่อสลับ Tenant → หน้าโหลดข้อมูลใหม่
  const [switching, setSwitching] = useState(false)
  const [menu, setMenu] = useState(false)       // เมนูเลื่อน (iPad แนวตั้ง / มือถือ)

  useEffect(() => {
    (async () => {
      try {
        const out = await initAuth()
        if (!out) return // กำลัง redirect ไป LINE Login
        if (out.error === 'not_registered') { setState('unregistered'); return }
        if (out.error === 'account_disabled') { setState('disabled'); return }
        if (out.error) { setErr(errTh(out.error)); setState('error'); return }
        if (!['owner', 'admin', 'zone_manager', 'shift_leader', 'client'].includes(out.user.effective_role || out.user.role)) { setState('forbidden'); return }
        setState('ready')
        if (out.user.role === 'client') { setTab('client'); return }
        rpc('is_platform_admin').then((pa) => { setIsPlatform(pa); if (pa) rpc('list_vendors').then(setVendors).catch(() => {}) }).catch(() => {})
      } catch (e) { setErr(errTh(e, 'เข้าสู่ระบบไม่สำเร็จ')); setState('error') }
    })()
  }, [])

  if (state === 'loading') return <Center msg="กำลังเชื่อมต่อ…" />
  if (state === 'unregistered') return <Center msg="บัญชี LINE นี้ยังไม่ได้ลงทะเบียนในระบบ — ให้ผู้ดูแลเพิ่มคุณเป็นพนักงานก่อน แล้วลงทะเบียนผ่านแอปใน LINE" />
  if (state === 'disabled') return <Center msg="บัญชีนี้ถูกปิดใช้งานแล้ว และออกจากระบบทุกอุปกรณ์ — ติดต่อแอดมินของบริษัทหากต้องการใช้งานอีกครั้ง" />
  if (state === 'forbidden') return <Center msg="บัญชีของคุณไม่มีสิทธิ์เข้า Horguard Force (สำหรับเจ้าของ แอดมิน ผู้จัดการโซน หัวหน้ากะ และลูกค้า) — ใช้งานผ่านเมนูใน LINE ได้ตามปกติ" />
  if (state === 'error') return <Center msg={`เชื่อมต่อไม่สำเร็จ — ${err}`} />

  const user = getUser()
  const role = user.effective_role || user.role
  // ลูกค้าเห็นเฉพาะแดชบอร์ดลูกค้า (เมนูอื่นค่อยเปิดภายหลัง)
  const staffTabs = BASE_TABS.filter((t) => !(t.noLeader && role === 'shift_leader'))
  const TABS = role === 'client' ? BASE_TABS.filter((t) => t.key === 'client')
    : role === 'zone_manager' ? BASE_TABS.filter((t) => ZONE_TABS.includes(t.key))
    : isPlatform ? [...staffTabs, VENDOR_TAB] : staffTabs
  const Active = (TABS.find((t) => t.key === tab) || TABS[0]).el

  const current = TABS.find((t) => t.key === tab) || TABS[0]
  // Tenant ที่ใช้งานจริง = tenant ใน token (ไม่พึ่งค่าที่ฟังก์ชันส่งกลับ ป้องกันช่องเลือกแสดงไม่ตรงกับข้อมูล)
  const activeId = tenantId()
  const vendor = vendors.find((v) => v.id === activeId) || getVendor()
  const acting = isPlatform && activeId && user.home_tenant_id && activeId !== user.home_tenant_id
  async function onVendor(e) {
    setSwitching(true)
    try {
      const out = await switchVendor(e.target.value)
      if (out?.error) setErr(errTh(out.error))
      setCtx((n) => n + 1)
    } finally { setSwitching(false) }
  }
  return (
    <div className="shell">
      <header className="topbar">
        <button className="burger" aria-label="เปิดเมนู" aria-expanded={menu} onClick={() => setMenu(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <img src={logoWhite} alt="Horguard" />
        <span className="tb-title">{current.label}</span>
      </header>
      <div className={`side-backdrop ${menu ? 'open' : ''}`} onClick={() => setMenu(false)} />
      <aside className={`side ${menu ? 'open' : ''}`}>
        <div className="brand-logo"><img src={logoWhite} alt="Horguard" /><span>Horguard Force</span></div>
        <nav className="nav" aria-label="เมนูหลัก">
          {TABS.map((t, i) => (
            <div key={t.key} style={{ display: 'contents' }}>
              {TABS.length > 1 && t.group && t.group !== TABS[i - 1]?.group && <div className="group">{t.group}</div>}
              <button className={tab === t.key ? 'active' : ''} aria-current={tab === t.key ? 'page' : undefined} onClick={() => { setTab(t.key); setMenu(false); window.scrollTo(0, 0) }}>
                <Icon k={t.icon} />{t.label}
              </button>
            </div>
          ))}
        </nav>
        {isPlatform && vendors.length > 0 && (
          <div className="vendor-switch">
            <label htmlFor="vsw">กำลังจัดการ Tenant</label>
            <select id="vsw" value={activeId || ''} onChange={onVendor} disabled={switching}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.is_test ? '🧪 ' : ''}{v.name}{v.id === user.home_tenant_id ? ' (บริษัทของฉัน)' : ''}</option>)}
            </select>
          </div>
        )}
        <div className="me">
          <div className="av">{(user.full_name || '?').trim().charAt(0)}</div>
          <div className="who"><b>{user.full_name}</b>{isPlatform ? 'Super Admin' : (ROLE_TH[user.role] || user.role)}</div>
        </div>
      </aside>
      <main className="main">
        <div className="main-inner">
          <div className="page-head">
            <div><h1>{current.label}</h1><p>{current.desc}</p></div>
          </div>
          {role === 'zone_manager' && <div className="notice info" style={{ marginTop: 0 }}>สิทธิ์ผู้จัดการโซน: ดูข้อมูลได้อย่างเดียว · เห็นเฉพาะโครงการที่ได้รับมอบหมาย (ถ้าไม่ได้ผูกโครงการ เห็นทุกโครงการ)</div>}
          {acting && <div className="notice info" style={{ marginTop: 0 }}>คุณกำลังจัดการข้อมูลของ <b>{vendor?.name || "Tenant นี้"}</b> ในฐานะ Super Admin — ทุกการแก้ไขบันทึกในชื่อคุณ</div>}
          {switching ? <p className="muted">กำลังสลับ Tenant…</p> : <Active key={`${tab}-${ctx}`} isPlatform={isPlatform} vendors={vendors} />}
        </div>
      </main>
    </div>
  )
}

function Center({ msg }) {
  return (
    <div className="splash">
      <div><div className="brand-logo navy"><img src={logoNavy} alt="Horguard" /><span>Horguard Force</span></div><p>{msg}</p></div>
    </div>
  )
}
