// Guard OS LIFF — API client
// F2: token เก็บใน memory เท่านั้น (ไม่ใช้ localStorage) หมดอายุ → ขอใหม่เงียบๆ ด้วย LINE ID token
import liff from '@line/liff'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const FN_URL = `${SUPABASE_URL}/functions/v1/auth-line`

let accessToken = null
let currentUser = null

export function getUser() { return currentUser }

/** อ่าน query param แบบทนทาน — LIFF บางกรณีห่อ deep-link ไว้ใน liff.state */
export function readParams() {
  const p = new URLSearchParams(window.location.search)
  const state = p.get('liff.state')
  if (state) {
    const inner = new URLSearchParams(state.startsWith('?') ? state.slice(1) : state)
    for (const [k, v] of inner) if (!p.has(k)) p.set(k, v)
  }
  return p
}

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

/** รัน promise พร้อมเพดานเวลา — กันหน้าค้างเงียบ */
export function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ])
}

/** บีบอัดรูปฝั่ง client ให้เล็ก (~40-80KB) — selfie ไม่ต้องคมมาก ขอแค่ยืนยันตัวตน+อัปโหลดเร็ว */
export async function compressImage(file, maxDim = 640, quality = 0.5) {
  let width, height, source
  try {
    const bitmap = await createImageBitmap(file)
    width = bitmap.width; height = bitmap.height; source = bitmap
  } catch {
    // fallback: iOS/เครื่องเก่าที่ createImageBitmap ไม่รองรับไฟล์จากกล้อง
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve; img.onerror = () => reject(new Error('image_decode_failed'))
      img.src = url
    })
    width = img.naturalWidth; height = img.naturalHeight; source = img
    URL.revokeObjectURL(url)
  }
  const scale = Math.min(1, maxDim / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('compress_failed')
  return blob
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
    if (!navigator.geolocation) { reject(new Error('no_geolocation')); return }
    // enableHighAccuracy:false → ใช้ wifi/เสาสัญญาณ เร็วและได้ในอาคาร (ไม่รอ GPS ดาวเทียม)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  })
}

/** device fingerprint แบบเบา (Sprint 1) — canvas + UA + screen */
export async function deviceFingerprint() {
  const data = [navigator.userAgent, screen.width, screen.height, navigator.language].join('|')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
