// Skeleton loading — โครงสีเทากระพริบเบาๆ แทนข้อความ "กำลังโหลด…" (ผู้ใช้เห็นรูปหน้าก่อนข้อมูลมา)
// ผู้ที่ตั้ง "ลดภาพเคลื่อนไหว" ในเครื่อง จะเห็นเป็นสีเทานิ่ง
export const SkLine = ({ w = '100%', h = 12, style }) => <span className="sk" style={{ width: w, height: h, ...style }} />

export function SkStats({ n = 4 }) {
  return (
    <div className="stat-row" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="stat"><SkLine w={44} h={26} /><SkLine w="70%" style={{ marginTop: 10 }} /></div>
      ))}
    </div>
  )
}

export function SkTable({ rows = 8, cols = 5, avatarCol = -1 }) {
  const widths = ['62%', '80%', '48%', '70%', '55%', '40%', '66%']
  return (
    <div className="table-wrap sk-table" role="status" aria-label="กำลังโหลดข้อมูล">
      <table className="grid dense">
        <thead><tr>{Array.from({ length: cols }, (_, c) => <th key={c}><SkLine w={c ? '50%' : '40%'} h={10} /></th>)}</tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>{Array.from({ length: cols }, (_, c) => (
              <td key={c}>{c === avatarCol ? <span className="sk sk-circle" /> : <SkLine w={widths[(r + c) % widths.length]} />}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkCards({ n = 4, h = 64 }) {
  return (
    <div role="status" aria-label="กำลังโหลดข้อมูล">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk-card" style={{ minHeight: h }}><SkLine w="55%" h={14} /><SkLine w="35%" h={10} style={{ marginTop: 8 }} /></div>
      ))}
    </div>
  )
}

/** ทั้งหน้า: ตัวเลขสรุป + ตาราง */
export const SkPage = ({ stats = 0, rows = 8, cols = 5, avatarCol }) => <>{stats > 0 && <SkStats n={stats} />}<SkTable rows={rows} cols={cols} avatarCol={avatarCol} /></>
