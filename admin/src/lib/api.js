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

export async function initAuth() {
  await liff.init({ liffId: import.meta.env.VITE_LIFF_ID })
  if (!liff.isLoggedIn()) { liff.login(); return null }
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ mode: 'login', id_token: liff.getIDToken() }),
  })
  const out = await res.json()
  if (!out.ok) return { error: out.error }
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
