// Guard OS — Edge Function: notify-line
// ส่งข้อความจากคิว line_notifications ไปหา Owner/Admin ของ Vendor ผ่าน LINE OA (Messaging API)
//
// Secret ที่ต้องตั้ง:
//   LINE_MESSAGING_TOKEN — Channel access token (long-lived) ของ OA @299nskem
//                          (OA ต้องเปิด Messaging API ภายใต้ provider "Guard OS" ตัวเดียวกับ LINE Login
//                           ไม่งั้น userId ของ Login กับ OA จะไม่ตรงกัน)
//
// POST { notification_id } — เรียกจากแอปยามหลังเช็คเอาต์ก่อนเวลา (ส่งซ้ำไม่ได้: มี sent_at กันไว้)
// POST { flush: true }     — ส่งทุกรายการที่ค้าง (ใช้ตอนเพิ่งตั้ง token หรือกับ cron ภายหลัง)
//
// ผู้รับ:
//   payload.to_user_ids        → ส่งถึงรายชื่อนี้ (dispatch / broadcast)
//   kind 'sos'                 → Owner/Admin + สายตรวจ/ผู้ช่วยสายตรวจที่ผูกกับโครงการ (ไม่มีโครงการ = สายตรวจทุกคน)
//   อื่นๆ                       → Owner/Admin ของ Vendor
// SOS แนบรูป (signed URL 7 วัน) และลิงก์ฟังเสียง

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const fmt = (ts: string) =>
  new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

const SIGN_TTL = 7 * 24 * 3600;
async function signed(path?: unknown): Promise<string | null> {
  if (!path || typeof path !== "string") return null;
  const { data } = await admin.storage.from("selfies").createSignedUrl(path, SIGN_TTL);
  return data?.signedUrl ?? null;
}
const mapLink = (lat: unknown, lng: unknown) =>
  lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : null;

type Msg = Record<string, unknown>;
async function messagesFor(n: { kind: string; payload: Record<string, unknown> }): Promise<Msg[]> {
  const p = n.payload as Record<string, string | number | null>;
  const text = (t: string) => ({ type: "text", text: t.slice(0, 4900) });
  if (n.kind === "early_checkout") {
    return [text([
      "⚠️ ออกงานก่อนเวลา",
      `${p.user_name} (${p.employee_code})`,
      `โครงการ: ${p.property_name}`,
      `ออกงาน ${fmt(String(p.checked_out_at))} · กะจบ ${fmt(String(p.shift_end))} (ก่อนเวลา ${p.early_minutes} นาที)`,
      `เหตุผล: ${p.reason}`,
    ].join("\n"))];
  }
  if (n.kind === "sos") {
    const photo = await signed(p.photo_path);
    const audio = await signed(p.audio_path);
    const map = mapLink(p.lat, p.lng);
    const out: Msg[] = [text([
      "🚨 SOS แจ้งเหตุด่วน",
      `${p.user_name} (${p.employee_code})${p.phone ? ` · โทร ${p.phone}` : ""}`,
      `โครงการ: ${p.property_name || "ไม่ระบุ"}`,
      p.category ? `ประเภท: ${p.category}` : "",
      p.note ? `รายละเอียด: ${p.note}` : "",
      `เวลา ${fmt(String(p.at))}`,
      map ? `📍 พิกัด: ${map}` : "📍 ไม่ได้รับพิกัด",
      audio ? `🎙️ ฟังเสียง: ${audio}` : "",
    ].filter(Boolean).join("\n"))];
    if (photo) out.push({ type: "image", originalContentUrl: photo, previewImageUrl: photo });
    return out;
  }
  if (n.kind === "dispatch") {
    const map = mapLink(p.lat, p.lng);
    return [text([
      "📣 คำสั่งเข้าประจำจุดด่วน",
      `ถึง: ${p.to_name}`,
      `โครงการ: ${p.property_name}`,
      p.address ? `ที่อยู่: ${p.address}` : "",
      p.note ? `หมายเหตุ: ${p.note}` : "",
      map ? `📍 นำทาง: ${map}` : "",
      `สั่งโดย ${p.by_name} · ${fmt(String(p.at))}`,
      "ถึงแล้วกดเช็คอินในแอป Guard OS",
    ].filter(Boolean).join("\n"))];
  }
  if (n.kind === "broadcast") {
    const names = (n.payload.property_names as string[] | undefined) || [];
    return [text([
      "📢 ประกาศ",
      String(p.message),
      "",
      `จาก ${p.sender_name}${names.length ? ` · ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` +${names.length - 5}` : ""}` : ""}`,
    ].join("\n"))];
  }
  if (n.kind === "ban") {
    return [text([
      "⛔ บัญชีของคุณถูกระงับการใช้งานชั่วคราว",
      `${p.to_name}${p.company ? ` · ${p.company}` : ""}`,
      p.until ? `ระงับถึง ${fmt(String(p.until))}` : "ระงับจนกว่าผู้ดูแลจะยกเลิก",
      p.reason ? `เหตุผล: ${p.reason}` : "",
      "ระหว่างนี้จะเข้าใช้ Horguard ไม่ได้ — สอบถามหัวหน้างานหรือแอดมินของบริษัท",
    ].filter(Boolean).join("\n"))];
  }
  if (n.kind === "unban") {
    return [text([
      "✅ บัญชีของคุณใช้งานได้ตามปกติแล้ว",
      `${p.to_name}`,
      "เปิดเมนูใน LINE OA เพื่อเข้าใช้งานได้เลย",
    ].join("\n"))];
  }
  return [text(`แจ้งเตือน Guard OS: ${n.kind}`)];
}

async function recipientsFor(n: Record<string, any>): Promise<string[]> {
  const ids = n.payload?.to_user_ids as string[] | undefined;
  let q;
  if (Array.isArray(ids) && ids.length) {
    q = admin.from("users").select("line_user_id").eq("tenant_id", n.tenant_id).in("id", ids);
    const { data } = await q.eq("is_active", true).not("line_user_id", "is", null);
    return [...new Set((data || []).map((u) => u.line_user_id as string))];
  }
  const { data: bosses } = await admin.from("users").select("line_user_id")
    .eq("tenant_id", n.tenant_id).in("role", ["owner", "admin"]).eq("is_active", true).not("line_user_id", "is", null);
  const out = (bosses || []).map((u) => u.line_user_id as string);
  if (n.kind === "sos") {
    let sup;
    if (n.property_id) {
      const { data: pm } = await admin.from("property_managers").select("user_id").eq("property_id", n.property_id);
      const uids = (pm || []).map((r) => r.user_id);
      sup = uids.length
        ? (await admin.from("users").select("line_user_id").in("id", uids)
          .in("role", ["zone_manager", "supervisor", "assistant_supervisor", "trainer"]).eq("is_active", true).not("line_user_id", "is", null)).data
        : [];
    } else {
      sup = (await admin.from("users").select("line_user_id").eq("tenant_id", n.tenant_id)
        .in("role", ["zone_manager", "supervisor", "assistant_supervisor", "trainer"]).eq("is_active", true).not("line_user_id", "is", null)).data;
    }
    for (const u of sup || []) out.push(u.line_user_id as string);
    // ผจก.โซนที่ไม่ได้ผูกโครงการ = ดูแลทุกโครงการ → ได้แจ้งเตือน SOS ทุกโครงการ
    const { data: zms } = await admin.from("users").select("id, line_user_id")
      .eq("tenant_id", n.tenant_id).eq("role", "zone_manager").eq("is_active", true).not("line_user_id", "is", null);
    if (zms?.length) {
      const { data: zpm } = await admin.from("property_managers").select("user_id").in("user_id", zms.map((z) => z.id));
      const assigned = new Set((zpm || []).map((r) => r.user_id));
      for (const z of zms) if (!assigned.has(z.id)) out.push(z.line_user_id as string);
    }
  }
  return [...new Set(out)];
}

async function sendOne(id: string): Promise<{ id: string; ok: boolean; error?: string; recipients?: number }> {
  const { data: n } = await admin.from("line_notifications").select("*").eq("id", id).maybeSingle();
  if (!n) return { id, ok: false, error: "not_found" };
  if (n.sent_at) return { id, ok: true, recipients: 0 };

  const token = Deno.env.get("LINE_MESSAGING_TOKEN");
  const fail = async (error: string) => {
    await admin.from("line_notifications").update({ error }).eq("id", id);
    return { id, ok: false, error };
  };
  if (!token) return await fail("missing_LINE_MESSAGING_TOKEN");

  const to = await recipientsFor(n);
  if (!to.length) return await fail("no_recipients");

  const messages = await messagesFor(n);
  for (let i = 0; i < to.length; i += 500) {
    const res = await fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: to.slice(i, i + 500), messages }),
    });
    if (!res.ok) return await fail(`line_${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  await admin.from("line_notifications").update({ sent_at: new Date().toISOString(), error: null }).eq("id", id);
  return { id, ok: true, recipients: to.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const { notification_id, flush } = await req.json();
    if (flush) {
      const { data: pending } = await admin.from("line_notifications").select("id")
        .is("sent_at", null).gte("created_at", new Date(Date.now() - 2 * 86400000).toISOString()).limit(50);
      const results = [];
      for (const p of pending || []) results.push(await sendOne(p.id));
      return json({ ok: true, results });
    }
    if (!notification_id) return json({ ok: false, error: "missing_notification_id" }, 400);
    return json(await sendOne(notification_id));
  } catch (e) {
    console.error("notify-line error:", e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
