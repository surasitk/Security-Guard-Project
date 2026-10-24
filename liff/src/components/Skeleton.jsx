// Skeleton loading (Patrol) — โครงสีเทาแทน "กำลังโหลด…"
import Brand from './Brand.jsx'

export const SkLine = ({ w = '100%', h = 12, style }) => <span className="sk" style={{ width: w, height: h, ...style }} />

export function SkCards({ n = 3, h = 76 }) {
  return (
    <div role="status" aria-label="กำลังโหลดข้อมูล">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card sk-card" style={{ minHeight: h }}>
          <SkLine w="38%" h={11} /><SkLine w="72%" h={18} style={{ marginTop: 10 }} /><SkLine w="45%" h={11} style={{ marginTop: 8 }} />
        </div>
      ))}
    </div>
  )
}

/** ทั้งหน้า: โลโก้ + หัวข้อ + การ์ด (ระหว่างเชื่อมต่อ LINE / เปิดเมนู) */
export function SkPage({ cards = 3, map = false }) {
  return (
    <div className="page" role="status" aria-label="กำลังโหลด">
      <Brand />
      <SkLine w="62%" h={26} style={{ marginTop: 16 }} />
      <SkLine w="40%" h={12} style={{ margin: '10px 0 22px' }} />
      {map && <span className="sk" style={{ height: '38vh', minHeight: 220, borderRadius: 14, marginBottom: 14 }} />}
      <SkCards n={cards} />
    </div>
  )
}
