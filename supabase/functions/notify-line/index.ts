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

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const fmt = (ts: string) =>
  new Date(ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

function messageFor(n: { kind: string; payload: Record<string, unknown> }): string {
  const p = n.payload as Record<string, string | number>;
  if (n.kind === "early_checkout") {
    return [
      "⚠️ ออกงานก่อนเวลา",
      `${p.user_name} (${p.employee_code})`,
      `โครงการ: ${p.property_name}`,
      `ออกงาน ${fmt(String(p.checked_out_at))} · กะจบ ${fmt(String(p.shift_end))} (ก่อนเวลา ${p.early_minutes} นาที)`,
      `เหตุผล: ${p.reason}`,
    ].join("\n");
  }
  return `แจ้งเตือน Guard OS: ${n.kind}`;
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

  // ผู้รับ: Owner/Admin ของ Vendor ที่ผูก LINE แล้ว
  const { data: users } = await admin
    .from("users").select("line_user_id")
    .eq("tenant_id", n.tenant_id).in("role", ["owner", "admin"]).eq("is_active", true)
    .not("line_user_id", "is", null);
  const to = [...new Set((users || []).map((u) => u.line_user_id as string))];
  if (!to.length) return await fail("no_recipients");

  const res = await fetch("https://api.line.me/v2/bot/message/multicast", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: messageFor(n) }] }),
  });
  if (!res.ok) return await fail(`line_${res.status}: ${(await res.text()).slice(0, 200)}`);
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
