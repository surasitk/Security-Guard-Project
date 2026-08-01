// ชุดข้อมูลที่อยู่ไทย (77 จังหวัด / 930 อำเภอ / 7,452 ตำบล+รหัสไปรษณีย์)
// bundle ไว้ใน public/thai-address.json — โหลดครั้งเดียวแล้ว cache
let cache = null
export async function loadThaiAddress() {
  if (cache) return cache
  const res = await fetch(`${import.meta.env.BASE_URL}thai-address.json`)
  if (!res.ok) throw new Error('address_data_failed')
  cache = await res.json()
  return cache
}
