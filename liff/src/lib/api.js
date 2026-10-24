// Guard OS LIFF — API client
// F2: token เก็บใน memory เท่านั้น (ไม่ใช้ localStorage) หมดอายุ → ขอใหม่เงียบๆ ด้วย LINE ID token
import { errTh } from './errors'
export { errTh }
// เน็ตหลุด/ต่อไม่ได้ → ข้อความไทย (แทน 'Failed to fetch')
const safeFetch = (u, o) => fetch(u, o).catch((e) => { throw new Error(errTh(e)) })
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
  const res = await safeFetch(FN_URL, {
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
  const err = new Error(out.error === 'account_banned' ? banText(out) : errTh(out.error || 'auth_failed'))
  err.code = out.error
  throw err
}

const banText = (o) => `บัญชีของคุณถูกระงับการใช้งานชั่วคราว${o.until ? ` ถึง ${new Date(o.until).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })} น.` : ' จนกว่าผู้ดูแลจะยกเลิก'}${o.reason ? `\nเหตุผล: ${o.reason}` : ''}`

const KICK_KEY = 'hg_kicked'
export const wasKicked = () => { try { return !!sessionStorage.getItem(KICK_KEY) } catch { return false } }
/** ถูกดีดออก → ต้องกดเข้าสู่ระบบด้วย LINE ใหม่ */
export function relogin() {
  try { sessionStorage.removeItem(KICK_KEY) } catch { /* ignore */ }
  try { liff.logout() } catch { /* ignore */ }
  liff.login({ redirectUri: window.location.href })
}

/** ผู้ใช้ถูกปิดใช้งาน/แบน/ดีดออก → ทิ้ง token แล้วโหลดใหม่ (หน้าแรกจะแสดงเหตุผล) */
function kickOut(kicked = false) {
  if (kicked) { try { sessionStorage.setItem(KICK_KEY, '1') } catch { /* ignore */ } try { liff.logout() } catch { /* ignore */ } }
  accessToken = null; currentUser = null
  window.location.reload()
  return new Promise(() => {})
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
    if (b?.code === 'account_disabled' || b?.code === 'account_banned') return kickOut()
    if (b?.code === 'session_revoked') return kickOut(true)
    if (!retried) {
      try { await silentLogin() } catch (e) { if (e.code === 'account_disabled' || e.code === 'account_banned') return kickOut(); throw e }
      return authedFetch(path, options, true)
    }
  }
  return res
}

export async function list(pathWithQuery) {
  const res = await authedFetch(`/rest/v1/${pathWithQuery}`)
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(errTh(b?.message || `failed_${res.status}`)) }
  return res.json()
}

export async function rpc(fn, args = {}) {
  const res = await authedFetch(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  })
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(errTh(b?.message || `failed_${res.status}`)) }
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
      img.onload = resolve; img.onerror = () => reject(new Error(errTh('image_decode_failed')))
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
  if (!blob) throw new Error(errTh('compress_failed'))
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
  if (!res.ok) throw new Error(errTh('selfie_upload_failed'))
  return name
}

/** อัปโหลดรูป/เสียงแจ้งเหตุ → bucket selfies/<tenant>/incidents/<date>/… (สิทธิ์ตามโฟลเดอร์ tenant) */
export async function uploadMedia(blob, ext, contentType) {
  const tenantPath = await tenantFolder()
  const date = new Date().toISOString().slice(0, 10)
  const name = `${tenantPath}/incidents/${date}/${crypto.randomUUID()}.${ext}`
  const res = await authedFetch(`/storage/v1/object/selfies/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: blob,
  })
  if (!res.ok) throw new Error(errTh('media_upload_failed'))
  return name
}

async function tenantFolder() {
  // tenant_id อยู่ใน JWT payload (base64) — ใช้ระบุ path อัปโหลดตาม storage policy
  const payload = JSON.parse(atob(accessToken.split('.')[1]))
  return payload.app_metadata.tenant_id
}

const plainPos = (pos) => ({
  latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy,
  altitude: pos.coords.altitude, altitudeAccuracy: pos.coords.altitudeAccuracy,
  speed: pos.coords.speed, heading: pos.coords.heading, timestamp: pos.timestamp,
})

export function getPosition(opts) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no_geolocation')); return }
    // enableHighAccuracy:false → ใช้ wifi/เสาสัญญาณ เร็วและได้ในอาคาร (ไม่รอ GPS ดาวเทียม)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(plainPos(pos)),
      (err) => reject(err),
      opts || { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  })
}

/**
 * หลักฐานพิกัด (ตรวจ Fake GPS ฝั่ง server): ค่าที่ใช้ลงเวลา + อ่านใหม่อีก 2 ครั้งห่างกัน ~1.5 วิ
 * ทำหลังลงเวลาสำเร็จแล้ว ไม่รอผล — ล้มเหลวก็ไม่กระทบการเข้า/ออกงาน
 */
export async function sendGpsEvidence(phase, first) {
  try {
    const toS = (c) => ({ lat: c.latitude, lng: c.longitude, acc: c.accuracy, alt: c.altitude, alt_acc: c.altitudeAccuracy,
                          speed: c.speed, heading: c.heading, ts: c.timestamp ?? Date.now() })
    const samples = first ? [toS(first)] : []
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try { samples.push(toS(await getPosition({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }))) } catch { /* ข้าม */ }
    }
    if (samples.length) await rpc('submit_gps_evidence', { p_phase: phase, p_samples: samples })
  } catch { /* ไม่กระทบผู้ใช้ */ }
}

/**
 * ระดับ รปภ. (รปภ. · หัวหน้ากะ · ตัวสแปร์) ลงเวลา/สแกนจุดตรวจได้เฉพาะมือถือ — บล็อก iPad, แท็บเล็ต และคอมพิวเตอร์
 * SOS ใช้ได้ทุกเครื่อง · Super Admin ได้รับยกเว้น (ทดสอบจากคอม) · คืนข้อความไทย หรือ null ถ้าใช้ได้
 */
const GUARD_LEVEL = ['guard', 'shift_leader', 'spare']
export function deviceBlockReason() {
  try {
    if (currentUser?.is_platform_admin) return null
    // บังคับเฉพาะระดับ รปภ. — เจ้าหน้าที่ระดับสูง (เจ้าของ แอดมิน ผจก.โซน สายตรวจ ครูฝึก ผู้ช่วยสายตรวจ) ใช้ iPad ได้
    if (!GUARD_LEVEL.includes(currentUser?.role)) return null
    const ua = navigator.userAgent || ''
    const os = typeof liff.getOS === 'function' ? liff.getOS() : null
    const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    const androidTablet = /Android/.test(ua) && !/Mobile/.test(ua)
    if (iPad || androidTablet) return 'ลงเวลาบน iPad หรือแท็บเล็ตไม่ได้ — กรุณาใช้มือถือของคุณ'
    if (os === 'web' || !/Android|iPhone|iPod/.test(ua)) return 'ลงเวลาบนคอมพิวเตอร์ไม่ได้ — กรุณาเปิดเมนูจาก LINE ในมือถือของคุณ'
    return null
  } catch { return null }
}

/** device fingerprint แบบเบา (Sprint 1) — canvas + UA + screen */
export async function deviceFingerprint() {
  const data = [navigator.userAgent, screen.width, screen.height, navigator.language].join('|')
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

/** แจ้ง Owner/Admin ทาง LINE OA (คิวจาก check_out ก่อนเวลา) — ยิงแล้วไม่ต้องรอผล */
export async function notifyLine(notificationId) {
  try {
    await authedFetch('/functions/v1/notify-line', {
      method: 'POST',
      body: JSON.stringify({ notification_id: notificationId }),
    })
  } catch { /* คิวยังอยู่ในฐานข้อมูล ส่งซ้ำภายหลังได้ */ }
}
