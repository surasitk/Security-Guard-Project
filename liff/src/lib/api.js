// Guard OS LIFF — API client
// F2: token เก็บใน memory เท่านั้น (ไม่ใช้ localStorage) หมดอายุ → ขอใหม่เงียบๆ ด้วย LINE ID token
import liff from '@line/liff'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = `${SUPABASE_URL}/functions/v1/auth-line`

let accessToken = null
let currentUser = null

export function getUser() { return currentUser }

/** ID token ของ LINE มีอายุ ~1 ชม. — ถ้าหมดอายุต้องบังคับ login ใหม่ */
function idTokenFresh() {
  try {
    const d = liff.getDecodedIDToken()
    return d && d.exp * 1000 > Date.now() + 60_000
  } catch { return false }
}

export function forceRelogin() {
  try { liff.logout() } catch { /* ignore */ }
  liff.login({ redirectUri: window.location.href })
}

export async function initLiff() {
  await liff.init({ liffId: import.meta.env.VITE_LIFF_ID })
  if (!liff.isLoggedIn()) { liff.login(); return }
  if (!idTokenFresh()) forceRelogin()
}

async function callAuth(body) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

/** login เงียบๆ — คืน true ถ้าผูกบัญชีแล้ว, false ถ้ายังไม่ลงทะเบียน */
export async function silentLogin() {
  const idToken = liff.getIDToken()
  const out = await callAuth({ mode: 'login', id_token: idToken })
  if (out.ok) { sessionStorage.removeItem('guardos_relogin'); accessToken = out.access_token; currentUser = out.user; return true }
  if (out.error === 'not_registered') return false
  if (out.error === 'invalid_line_token' && !sessionStorage.getItem('guardos_relogin')) {
    sessionStorage.setItem('guardos_relogin', '1')
    forceRelogin()
    return new Promise(() => {}) // กำลัง redirect — ค้างสถานะโหลดไว้
  }
  throw new Error(out.error || 'auth_failed')
}

export async function register(employeeCode, phone, consentVersion) {
  const idToken = liff.getIDToken()
  const out = await callAuth({
    mode: 'register', id_token: idToken,
    employee_code: employeeCode, phone, consent_version: consentVersion,
  })
  if (out.ok) { accessToken = out.access_token; currentUser = out.user }
  return out
}

/** เรียก PostgREST/RPC ด้วย token ที่ mint แล้ว — retry 1 ครั้งถ้า token หมดอายุ */
async function authedFetch(path, options = {}, retried = false) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  })
  if (res.status === 401 && !retried) {
    await silentLogin()
    return authedFetch(path, options, true)
  }
  return res
}

export async function list(pathWithQuery) {
  const res = await authedFetch(`/rest/v1/${pathWithQuery}`)
  if (!res.ok) throw new Error(`GET ${pathWithQuery} → ${res.status}`)
  return res.json()
}

export async function rpc(fn, args = {}) {
  const res = await authedFetch(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`rpc_${fn}_failed_${res.status}`)
  return res.json()
}

/** บีบอัดรูปฝั่ง client ~200KB ก่อนอัปโหลด (ตามเอกสาร F3) */
export async function compressImage(file, maxDim = 1024, quality = 0.7) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function uploadSelfie(blob) {
  const tenantPath = await tenantFolder()
  const date = new Date().toISOString().slice(0, 10)
  const name = `${tenantPath}/${date}/${crypto.randomUUID()}.jpg`
  const res = await authedFetch(`/storage/v1/object/selfies/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  })
  if (!res.ok) throw new Error('selfie_upload_failed')
  return name
}

async function tenantFolder() {
  // tenant_id อยู่ใน JWT payload (base64) — ใช้ระบุ path อัปโหลดตาม storage policy
  const payload = JSON.parse(atob(accessToken.split('.')[1]))
  return payload.app_metadata.tenant_id
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

/** device fingerprint แบบเบา (Sprint 1) — canvas + UA + screen */
export async function deviceFingerprint() {
  const data = [navigator.userAgent, screen.width, screen.height, navigator.language].join('|')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
