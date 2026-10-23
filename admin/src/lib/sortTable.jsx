// ตารางเรียงได้ — ใช้ร่วมกันทุกหน้า (มาตรฐานเดียวกับหน้าตารางกะ)
// · ข้อความ: ภาษาไทย ก–ฮ ก่อน แล้ว A–Z (ตัวเลขในชื่อเรียงแบบตัวเลข)
// · ค่าว่างอยู่ท้ายเสมอ ไม่ว่าเรียงขึ้นหรือลง · กดหัวคอลัมน์ซ้ำเพื่อสลับ ▲/▼
import { useMemo, useState } from 'react'

export const isThai = (s) => /^[฀-๿]/.test(String(s ?? '').trim())
export const byName = (a, b) => (isThai(b) - isThai(a)) || String(a ?? '').localeCompare(String(b ?? ''), 'th', { sensitivity: 'base', numeric: true })
const empty = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))

function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(b) - Number(a)
  return byName(a, b)
}

/**
 * cols: { key: (row) => ค่าที่ใช้เรียง }  (คืน array ได้ = เรียงหลายระดับ)
 * init: { key, dir: 'asc' | 'desc' }
 */
export function useSort(rows, cols, init) {
  const [s, setS] = useState(init)
  const sorted = useMemo(() => {
    if (!rows) return rows
    const get = cols[s.key]
    if (!get) return rows
    const sign = s.dir === 'desc' ? -1 : 1
    return [...rows].sort((x, y) => {
      const a = [].concat(get(x)), b = [].concat(get(y))
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const ea = empty(a[i]), eb = empty(b[i])
        if (ea || eb) { if (ea && eb) continue; return ea ? 1 : -1 }
        const c = cmp(a[i], b[i])
        if (c) return c * sign
      }
      return 0
    })
  }, [rows, s, cols])

  const th = (key, label, props = {}) => {
    const on = s.key === key
    return (
      <th key={key} {...props} className={`sortable ${on ? 'on' : ''} ${props.className || ''}`} aria-sort={on ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => setS(on ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })}>
          {label}<span className="sort-ic" aria-hidden="true">{on ? (s.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    )
  }
  return { sorted, th, sort: s, setSort: setS }
}

/** แถบค้นหาขั้นสูง: แสดงจำนวนผลลัพธ์ + ปุ่มล้างตัวกรอง */
export function ResultLine({ shown, total, unit, active, onClear, note }) {
  return (
    <p className="muted sh-count">
      {active ? `แสดง ${shown} จาก ${total} ${unit}` : `${total} ${unit}`}
      {note ? ` · ${note}` : ''}
      {active && <button type="button" className="link-btn" onClick={onClear}>ล้างตัวกรอง</button>}
    </p>
  )
}
