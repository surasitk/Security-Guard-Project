// Multi-select filter แบบชิป — ไม่เลือกเลย = แสดงทั้งหมด
export default function FilterChips({ label, options, selected, onChange }) {
  if (!options.length) return null
  function toggle(v) {
    const next = new Set(selected)
    next.has(v) ? next.delete(v) : next.add(v)
    onChange(next)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <span className="muted" style={{ minWidth: 64 }}>{label}</span>
      <button
        className={`badge ${selected.size === 0 ? 'solid' : ''}`}
        style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: selected.size === 0 ? undefined : 'none' }}
        onClick={() => onChange(new Set())}
      >ทั้งหมด</button>
      {options.map((o) => (
        <button key={o.value}
          className={`badge ${selected.has(o.value) ? 'solid' : ''}`}
          style={{ cursor: 'pointer', fontFamily: 'var(--font)', background: selected.has(o.value) ? undefined : 'none' }}
          onClick={() => toggle(o.value)}
        >{o.label}</button>
      ))}
    </div>
  )
}
