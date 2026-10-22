// PDPA — หน้าประกาศความเป็นส่วนตัว (migration 18)
//
// ใช้ 2 โหมด
//   <PrivacyGate status={...} onDone={fn} />   แสดงก่อนเข้าแอป เมื่อ status.acknowledged = false
//                                              (ครั้งแรก หรือ Notice ออกเวอร์ชันใหม่)
//   <PrivacyPage />                            หน้าโปรไฟล์ > ความเป็นส่วนตัว (?page=privacy)
//                                              ดูฉบับปัจจุบัน ประวัติที่เคยรับทราบ และให้/ถอน consent
//
// กติกา
//   - Notice = "รับทราบ" ไม่ใช่ความยินยอม · consent แต่ละเรื่องเป็น checkbox แยก ไม่ติ๊กไว้ก่อน ปฏิเสธได้
//   - บันทึกผ่าน RPC เท่านั้น เวลาจาก server
import { useEffect, useState } from 'react'
import { rpc } from '../lib/api'

const fmt = (ts) => new Date(ts).toLocaleString('th-TH', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function Summary({ notice, company }) {
  return (
    <>
      {company && (
        <p className="sub" style={{ marginBottom: 16 }}>
          ผู้ดูแลข้อมูลของคุณคือ <b>{company}</b> (นายจ้าง) โดยใช้ระบบ Horguard
        </p>
      )}
      {(notice.summary || []).map((s) => (
        <div key={s.title} className="card" style={{ padding: '14px 18px', marginBottom: 10 }}>
          <div className="k">{s.title}</div>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--ink-soft)' }}>{s.text}</p>
        </div>
      ))}
      <p className="muted" style={{ margin: '4px 0 18px' }}>
        <a href={notice.full_url} target="_blank" rel="noopener" style={{ color: 'var(--ink)' }}>อ่านฉบับเต็ม</a>
        {' · '}ฉบับ {notice.version}
      </p>
    </>
  )
}

function ConsentBox({ purpose, checked, onChange, disabled }) {
  return (
    <label className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 18px', marginBottom: 10, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 5, width: 20, height: 20, flex: 'none' }}
      />
      <span>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{purpose.title}</span>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.6, marginTop: 2 }}>{purpose.description}</span>
      </span>
    </label>
  )
}

/** หน้าบังคับรับทราบ — แสดงก่อนเข้าแอป */
export function PrivacyGate({ status, onDone }) {
  const { notice, company, purposes = [], is_first_time: first } = status
  // ไม่ติ๊กไว้ก่อน: ครั้งแรกเริ่มที่ false ทุกข้อ · เวอร์ชันใหม่ คงค่าที่เคยตอบไว้
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(purposes.map((p) => [p.code, first ? false : p.granted === true])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function accept() {
    setBusy(true); setErr('')
    try {
      const out = await rpc('acknowledge_privacy', {
        p_version: notice.version,
        p_consents: choices,
        p_user_agent: navigator.userAgent,
      })
      onDone(out)
    } catch (e) {
      setErr(String(e.message || e).includes('notice_outdated')
        ? 'มีประกาศฉบับใหม่กว่า กรุณาปิดแล้วเปิดแอปใหม่'
        : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <p className="brand">HORGUARD PATROL</p>
      <h1>{first ? 'ความเป็นส่วนตัวของคุณ' : 'ประกาศความเป็นส่วนตัวฉบับใหม่'}</h1>
      <p className="sub">
        {first
          ? 'ก่อนเริ่มใช้งาน อ่านสรุปสั้นๆ ว่าระบบเก็บและใช้ข้อมูลของคุณอย่างไร'
          : 'มีการปรับปรุงประกาศ กรุณาอ่านและกดรับทราบอีกครั้ง'}
      </p>
      {!first && notice.change_note && <div className="notice">สิ่งที่เปลี่ยน: {notice.change_note}</div>}

      <Summary notice={notice} company={company} />

      {purposes.length > 0 && (
        <>
          <p className="brand" style={{ margin: '8px 0 4px' }}>ตัวเลือกเพิ่มเติม (ไม่บังคับ)</p>
          <p className="muted" style={{ marginBottom: 10 }}>ไม่เลือกก็ใช้งานได้ตามปกติ และเปลี่ยนใจได้ทุกเมื่อในหน้าความเป็นส่วนตัว</p>
          {purposes.map((p) => (
            <ConsentBox key={p.code} purpose={p} checked={choices[p.code]} disabled={busy}
              onChange={(v) => setChoices((c) => ({ ...c, [p.code]: v }))} />
          ))}
        </>
      )}

      {err && <div className="notice err">{err}</div>}
      <div className="spacer" />
      <button className="btn" onClick={accept} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'รับทราบ'}</button>
    </div>
  )
}

/** หน้าโปรไฟล์ > ความเป็นส่วนตัว */
export function PrivacyPage() {
  const [status, setStatus] = useState(null)
  const [history, setHistory] = useState(null)
  const [saving, setSaving] = useState('')
  const [err, setErr] = useState('')
  const [confirmOff, setConfirmOff] = useState(null) // code ที่กำลังจะถอน

  async function load() {
    const [s, h] = await Promise.all([rpc('my_privacy_status'), rpc('my_privacy_history')])
    setStatus(s); setHistory(h)
  }
  useEffect(() => { load().catch(() => setErr('โหลดข้อมูลไม่สำเร็จ')) }, [])

  async function change(code, granted) {
    setSaving(code); setErr(''); setConfirmOff(null)
    try {
      const s = await rpc('set_consent', { p_purpose: code, p_granted: granted })
      setStatus(s)
      setHistory(await rpc('my_privacy_history'))
    } catch {
      setErr('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setSaving('')
    }
  }

  if (!status) {
    return <div className="page"><p className="brand">HORGUARD PATROL</p><p className="muted">{err || 'กำลังโหลด…'}</p></div>
  }

  return (
    <div className="page">
      <p className="brand">HORGUARD PATROL</p>
      <h1>ความเป็นส่วนตัว</h1>
      <p className="sub">
        {status.acknowledged_at ? `รับทราบฉบับปัจจุบันเมื่อ ${fmt(status.acknowledged_at)}` : 'ยังไม่ได้รับทราบฉบับปัจจุบัน'}
      </p>

      <Summary notice={status.notice} company={status.company} />

      {status.purposes.length > 0 && (
        <>
          <p className="brand" style={{ margin: '8px 0 10px' }}>ความยินยอมของคุณ</p>
          {status.purposes.map((p) => (
            <div key={p.code}>
              <ConsentBox purpose={p} checked={p.granted === true} disabled={!!saving}
                onChange={(v) => (v ? change(p.code, true) : setConfirmOff(p.code))} />
              {confirmOff === p.code && (
                <div className="notice" style={{ marginTop: -4 }}>
                  ถอนความยินยอมเรื่องนี้? มีผลทันที และไม่กระทบสิ่งที่ทำไปก่อนหน้า
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button className="btn" style={{ padding: 10, fontSize: 15 }} onClick={() => change(p.code, false)}>ถอนความยินยอม</button>
                    <button className="btn ghost" style={{ padding: 10, fontSize: 15, marginTop: 0 }} onClick={() => setConfirmOff(null)}>ยกเลิก</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {err && <div className="notice err">{err}</div>}

      {history && (
        <>
          <div className="spacer" />
          <p className="brand" style={{ marginBottom: 10 }}>ประวัติ</p>
          {history.acknowledgements.map((a) => (
            <div key={a.version} className="card" style={{ padding: '12px 18px', marginBottom: 8 }}>
              <div className="v" style={{ fontSize: 15 }}>
                รับทราบประกาศฉบับ {a.version}{a.is_current ? ' (ปัจจุบัน)' : ''}
              </div>
              <p className="muted" style={{ marginTop: 2 }}>
                {fmt(a.accepted_at)} · <a href={a.full_url} target="_blank" rel="noopener" style={{ color: 'var(--ink)' }}>เปิดอ่าน</a>
              </p>
            </div>
          ))}
          {history.consent_events.map((e, i) => (
            <div key={i} className="card" style={{ padding: '12px 18px', marginBottom: 8 }}>
              <div className="v" style={{ fontSize: 15 }}>{e.granted ? 'ยินยอม' : 'ไม่ยินยอม / ถอน'}: {e.title}</div>
              <p className="muted" style={{ marginTop: 2 }}>{fmt(e.recorded_at)} · {e.source === 'profile' ? 'จากหน้านี้' : 'ตอนรับทราบประกาศ'}</p>
            </div>
          ))}
        </>
      )}

      <p className="muted" style={{ marginTop: 18 }}>
        ต้องการขอสำเนา แก้ไข หรือลบข้อมูล ติดต่อฝ่ายบุคคลของบริษัท
      </p>
    </div>
  )
}
