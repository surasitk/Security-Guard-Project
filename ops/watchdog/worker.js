// Horguard — Cloudflare Worker: horguard-watchdog
// ตัวเฝ้าระวังภายนอก เช็กทุก 5 นาที แล้วแจ้งเข้า LINE OA เมื่อระบบล่ม/ค้าง และเมื่อกลับมาปกติ
// (ชั้นที่ 2 ของระบบแจ้งเตือน — ทำงานได้แม้ Supabase ล่มทั้งก้อน)
//
// ตั้งค่าใน Cloudflare → Workers → horguard-watchdog → Settings
//   Variables (plain):  SUPABASE_URL, SUPABASE_ANON_KEY (publishable key — ไม่ใช่ความลับ)
//   Secrets:            LINE_CHANNEL_TOKEN, OPS_LINE_USER_IDS (คั่นด้วย comma)
//   KV binding:         STATE  (สร้าง KV namespace ชื่อ horguard-watchdog)
//   Trigger:            Cron */5 * * * *

const SLOW_MS = 8000;        // ตอบช้ากว่านี้ = ค้าง
const TIMEOUT_MS = 15000;
const FAILS_BEFORE_ALERT = 2; // ต้องพังติดกัน 2 รอบ (≈10 นาที) ถึงเตือน กันสะดุดชั่วคราว
const REMIND_EVERY_MIN = 180; // ยังพังอยู่ เตือนซ้ำทุก 3 ชม.

function checks(env) {
  return [
    { key: "web",    name: "เว็บ horguard.com",         url: "https://horguard.com/" },
    { key: "force",  name: "Horguard Force",            url: "https://force.horguard.com/" },
    { key: "patrol", name: "Horguard Patrol",           url: "https://patrol.horguard.com/" },
    { key: "db",     name: "ฐานข้อมูล (Supabase)",       url: `${env.SUPABASE_URL}/rest/v1/rpc/ops_ping`,
      init: { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: "{}" } },
    { key: "login",  name: "ระบบล็อกอิน (auth-line)",    url: `${env.SUPABASE_URL}/functions/v1/auth-line`,
      init: { method: "OPTIONS" } },
  ];
}

async function probe(c) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(c.url, { ...(c.init || {}), signal: ctrl.signal, redirect: "manual", cf: { cacheTtl: 0 } });
    const ms = Date.now() - t0;
    if (res.status >= 500) return { ok: false, why: `HTTP ${res.status}`, ms };
    if (res.status >= 400 && c.key !== "login") return { ok: false, why: `HTTP ${res.status}`, ms };
    if (ms > SLOW_MS) return { ok: false, why: `ตอบช้า ${(ms / 1000).toFixed(1)} วินาที`, ms };
    return { ok: true, ms };
  } catch (e) {
    return { ok: false, why: e.name === "AbortError" ? `ไม่ตอบภายใน ${TIMEOUT_MS / 1000} วินาที` : String(e.message || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function pushLine(env, text) {
  const ids = (env.OPS_LINE_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  await Promise.all(ids.map((to) =>
    fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${(env.LINE_CHANNEL_TOKEN || "").trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    })));
}

function bkk(d = new Date()) {
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

async function run(env) {
  const results = await Promise.all(checks(env).map(async (c) => ({ c, r: await probe(c) })));
  const now = Date.now();
  const down = [], recovered = [];

  for (const { c, r } of results) {
    const k = `state:${c.key}`;
    const s = (await env.STATE.get(k, "json")) || { fails: 0, alerted: false, since: null, lastSent: 0 };
    if (r.ok) {
      if (s.alerted) recovered.push({ c, s });
      await env.STATE.put(k, JSON.stringify({ fails: 0, alerted: false, since: null, lastSent: 0 }));
      continue;
    }
    s.fails += 1;
    s.since = s.since || now;
    const due = s.fails >= FAILS_BEFORE_ALERT && (!s.alerted || now - s.lastSent > REMIND_EVERY_MIN * 60000);
    if (due) {
      down.push({ c, r, s });
      s.alerted = true;
      s.lastSent = now;
    }
    await env.STATE.put(k, JSON.stringify(s));
  }

  if (down.length) {
    const lines = down.map(({ c, r, s }) =>
      `• ${c.name}: ${r.why} (เริ่ม ${bkk(new Date(s.since))})`).join("\n");
    await pushLine(env, `🔴 Horguard ระบบมีปัญหา\n${lines}\n\nเช็กแล้วเมื่อ ${bkk()}`);
  }
  if (recovered.length) {
    const lines = recovered.map(({ c, s }) =>
      `• ${c.name} (ล่มไป ${Math.max(1, Math.round((now - s.since) / 60000))} นาที)`).join("\n");
    await pushLine(env, `✅ Horguard กลับมาปกติ\n${lines}`);
  }
  return results.map(({ c, r }) => ({ key: c.key, ok: r.ok, ms: r.ms, why: r.why || null }));
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // เปิด URL ของ worker เพื่อดูสถานะล่าสุด (ไม่ส่ง LINE) · ?test=line เพื่อทดสอบส่งข้อความ
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.searchParams.get("test") === "line" && u.searchParams.get("key") === env.LINE_CHANNEL_TOKEN?.slice(-8)) {
      await pushLine(env, `🧪 Horguard watchdog ทดสอบส่งข้อความ ${bkk()}`);
      return new Response("sent");
    }
    const results = await Promise.all(checks(env).map(async (c) => ({ key: c.key, ...(await probe(c)) })));
    return new Response(JSON.stringify({ at: bkk(), results }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
