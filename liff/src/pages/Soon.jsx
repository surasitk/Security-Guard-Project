// หน้า placeholder สำหรับฟีเจอร์ที่กำลังจะมา (แจ้งเหตุ / ขอลา)
import Brand from '../components/Brand.jsx'
export default function Soon({ title, note }) {
  return (
    <div className="page">
      <Brand />
      <h1>{title}</h1>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="k">เร็วๆ นี้</div>
        <div className="v">{note}</div>
        <p className="muted" style={{ marginTop: 8 }}>ระหว่างนี้ หากมีเหตุด่วน ติดต่อหัวหน้ากะโดยตรง</p>
      </div>
    </div>
  )
}
