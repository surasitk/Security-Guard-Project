// รูปโปรไฟล์วงกลมเล็ก — ใช้รูป LINE (ขนาดย่อจาก server ของ LINE) · ไม่มีรูป/โหลดไม่ได้ = ตัวอักษรแรกของชื่อ
// loading="lazy": โหลดเฉพาะแถวที่เลื่อนมาเห็น · เบราว์เซอร์จำรูปไว้ คนเดิมหลายแถวโหลดครั้งเดียว
import { useState } from 'react'

const small = (u) => (u && u.startsWith('https://profile.line-scdn.net/') && !/\/(small|large)$/.test(u) ? `${u}/small` : u)

export default function Avatar({ src, name, size = 28, title }) {
  const [bad, setBad] = useState(false)
  const s = !bad && src ? small(src) : null
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) }
  return s
    ? <img className="av" src={s} alt="" width={size} height={size} style={style} loading="lazy" decoding="async" referrerPolicy="no-referrer" title={title || name} onError={() => setBad(true)} />
    : <span className="av av-txt" style={style} title={title || name} aria-hidden="true">{(name || '?').trim().charAt(0)}</span>
}
