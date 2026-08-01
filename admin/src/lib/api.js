// Guard OS Admin — API client (LINE Login ผ่าน LIFF ใช้ได้ทั้งเดสก์ท็อป/มือถือ)
import liff from '@line/liff'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = `${SUPABASE_URL}/functions/v1/auth-line`

let accessToken = null
let currentUser = null

export function getUser() { return currentUser }
export function tenantId() {
  return JSON.parse(atob(accessToken.split('.')[1])).app_metadata.tenant_id
}

/** ID token ของ LINE มีอายุ ~1 ชม. — ถ้าหมดอายุต้องบังคับ login ใหม่ */
function idTokenFresh() {
  try {
    const d = liff.getDecodedIDToken()
    return d && d.exp * 1000 > Date.now() + 60_000
  } catch { return false }
}

function forceRelogin() {
  try { liff.logout() } catch { /* ignore */ }
  liff.login({ redirectUri: window.location.href })
}

export async function initAuth() {
  await liff.init({ liffId: import.meta.env.VITE_LIFF_ID })
  if (!liff.isLoggedIn()) { liff.login(); return null }
  if (!idTokenFresh()) { forceRelogin(); return null }
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ mode: 'login', id_token: liff.getIDToken() }),
  })
  const out = await res.json()
  if (!out.ok) {
    // token ใช้ไม่ได้ทั้งที่ยังไม่หมดอายุ → ลอง login ใหม่ 1 ครั้ง (กัน loop ด้วย sessionStorage)
    if (out.error === 'invalid_line_token' && !sessionStorage.getItem('guardos_relogin')) {
      sessionStorage.setItem('guardos_relogin', '1')
      forceRelogin()
      return null
    }
    return { error: out.error }
  }
  sessionStorage.removeItem('guardos_relogin')
  accessToken = out.access_token
  currentUser = out.user
  return { user: out.user }
}

async function authed(path, options = {}, retried = false) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (res.status === 401 && !retried) { await initAuth(); return authed(path, options, true) }
  return res
}

export async function list(pathWithQuery) {
  const res = await authed(`/rest/v1/${pathWithQuery}`)
  if (!res.ok) throw new Error(`GET ${pathWithQuery} → ${res.status}`)
  return res.json()
}

export async function insert(table, row) {
  const res = await authed(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message || `insert ${table} → ${res.status}`)
  return body
}

export async function update(table, filter, patch) {
  const res = await authed(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`update ${table} → ${res.status}`)
}

export async function rpc(fn, args = {}) {
  const res = await authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.message || `rpc ${fn} → ${res.status}`)
  return body
}

/** สร้างลิงก์ชั่วคราวสำหรับดูรูปใน Storage (หมดอายุ 10 นาที) */
export async function signedUrl(path) {
  const res = await authed(`/storage/v1/object/sign/selfies/${path}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 600 }),
  })
  const body = await res.json()
  if (!res.ok || !body.signedURL) throw new Error('sign_failed')
  return `${SUPABASE_URL}/storage/v1${body.signedURL}`
}

/** วันนี้ตามเวลาไทย คืน ISO ช่วง [start, end) */
export function todayRangeBkk() {
  const now = new Date()
  const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
  const start = new Date(bkk); start.setHours(0, 0, 0, 0)
  const offsetMs = bkk.getTime() - now.getTime()
  const startUtc = new Date(start.getTime() - offsetMs)
  const endUtc = new Date(startUtc.getTime() + 24 * 3600 * 1000)
  return [startUtc.toISOString(), endUtc.toISOString()]
}

export const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '—'
export const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' }) : '—'
