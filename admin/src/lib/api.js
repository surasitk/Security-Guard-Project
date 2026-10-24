// Guard OS Admin — API client (LINE Login ผ่าน LIFF ใช้ได้ทั้งเดสก์ท็อป/มือถือ)
import liff from '@line/liff'
import { errTh } from './errors'
export { errTh }
// เน็ตหลุด/ต่อไม่ได้ → ข้อความไทย (แทน 'Failed to fetch')
const safeFetch = (u, o) => fetch(u, o).catch((e) => { throw new Error(errTh(e)) })

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = `${SUPABASE_URL}/functions/v1/auth-line`

let accessToken = null
let currentUser = null
let currentVendor = null
const ACT_KEY = 'guardos_act_tenant'   // Tenant ที่ Super Admin เลือกไว้ (จำข้ามการรีเฟรช)
function store(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* ignore */ } }
function recall(k) { try { return localStorage.getItem(k) || '' } catch { return '' } }
export function getVendor() { return currentVendor }
/** Super Admin สลับ Tenant → ขอ token ใหม่ของ Tenant นั้น (สิทธิ์เจ้าของ) */
export async function switchVendor(id) { store(ACT_KEY, id); clearCache(); return initAuth() }

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
  const res = await safeFetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ mode: 'login', id_token: liff.getIDToken(), act_tenant_id: recall(ACT_KEY) || undefined }),
  })
  const out = await res.json()
  // Tenant ที่จำไว้ใช้ไม่ได้แล้ว → กลับบริษัทตัวเอง
  if (!out.ok && ['forbidden_switch_vendor', 'vendor_not_found'].includes(out.error) && recall(ACT_KEY)) {
    store(ACT_KEY, '')
    return initAuth()
  }
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
  currentVendor = out.vendor || null
  return { user: out.user, vendor: currentVendor }
}

async function authed(path, options = {}, retried = false) {
  const res = await safeFetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (res.status === 401) {
    const b = await res.clone().json().catch(() => null)
    if (b?.code === 'account_disabled') return kickOut()
    if (!retried) {
      const out = await initAuth()
      if (out?.error === 'account_disabled') return kickOut()
      return authed(path, options, true)
    }
  }
  return res
}

/** ผู้ใช้ถูกปิดใช้งาน → ทิ้ง token แล้วโหลดหน้าใหม่ (จะเจอหน้าจอ "บัญชีถูกปิดใช้งาน") */
function kickOut() {
  accessToken = ''; currentUser = null; clearCache()
  window.location.reload()
  return new Promise(() => {})
}

export async function list(pathWithQuery) {
  const res = await authed(`/rest/v1/${pathWithQuery}`)
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(errTh(b?.message || b?.code || `failed_${res.status}`)) }
  return res.json()
}

// ── แคชข้อมูลอ้างอิง (รายชื่อโครงการ/พนักงานสำหรับช่องเลือก) ─────────────────
// เปิดหน้าแล้วได้ทันทีจากที่จำไว้ (sessionStorage ของแท็บนี้) แล้วโหลดใหม่เบื้องหลังเก็บไว้ใช้ครั้งถัดไป
// ไม่ใช้กับข้อมูลสด (ใครอยู่เวร แผนที่ SOS เวลาเข้า-ออก) · แก้ข้อมูลใดๆ = ล้างแคชทั้งหมด · แยกตาม Tenant
const CACHE_TTL = 10 * 60 * 1000
const CACHE_PREFIX = 'hgc:'
const cacheKey = (path) => { try { return `${CACHE_PREFIX}${tenantId()}:${path}` } catch { return null } }
export function clearCache() {
  try { Object.keys(sessionStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => sessionStorage.removeItem(k)) } catch { /* ignore */ }
}
export async function listCached(pathWithQuery) {
  const k = cacheKey(pathWithQuery)
  const fresh = list(pathWithQuery).then((d) => {
    try { if (k) sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d })) } catch { /* เต็ม/ปิดไว้ — ข้าม */ }
    return d
  })
  try {
    const c = k && JSON.parse(sessionStorage.getItem(k) || 'null')
    if (c && Date.now() - c.t < CACHE_TTL) { fresh.catch(() => {}); return c.d }
  } catch { /* ignore */ }
  return fresh
}

export async function insert(table, row) {
  clearCache()
  const res = await authed(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errTh(body?.message || `failed_${res.status}`))
  return body
}

export async function update(table, filter, patch) {
  clearCache()
  const res = await authed(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(errTh(b?.message || `failed_${res.status}`)) }
}

const WRITE_RPC = /^(save_|set_|create_|update_|import_|generate_|admin_close|dispatch_person|send_broadcast|review_)/
export async function rpc(fn, args = {}) {
  if (WRITE_RPC.test(fn)) clearCache()
  const res = await authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errTh(body?.message || `failed_${res.status}`))
  return body
}

/** เรียก Edge Function (ใช้ token ของผู้ใช้) */
export async function callFn(name, body) {
  const res = await authed(`/functions/v1/${name}`, { method: 'POST', body: JSON.stringify(body) })
  const out = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errTh(out?.error || `failed_${res.status}`))
  return out
}

/** สร้างลิงก์ชั่วคราวสำหรับดูรูปใน Storage (หมดอายุ 10 นาที) */
export async function signedUrl(path) {
  const res = await authed(`/storage/v1/object/sign/selfies/${path}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 600 }),
  })
  const body = await res.json()
  if (!res.ok || !body.signedURL) throw new Error(errTh('sign_failed'))
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
