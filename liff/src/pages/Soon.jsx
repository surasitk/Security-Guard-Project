// หน้า placeholder สำหรับฟีเจอร์ที่กำลังจะมา (แจ้งเหตุ / ขอลา)
export default function Soon({ title, note }) {
  return (
    <div className="page">
      <p className="brand">GUARD OS</p>
      <h1>{title}</h1>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="k">เร็วๆ นี้</div>
        <div className="v">{note}</div>
        <p className="muted" style={{ marginTop: 8 }}>ระหว่างนี้ หากมีเหตุด่วน ติดต่อหัวหน้ากะโดยตรง</p>
      </div>
    </div>
  )
}
