// Guard OS — Edge Function: auth-line
// F1 (ลงทะเบียน/ผูกบัญชี LINE) + F2 (mint Supabase JWT ทุกครั้งที่เปิด LIFF)
//
// Secrets ที่ต้องตั้ง (supabase secrets set):
//   LINE_CHANNEL_ID    — Channel ID ของ LINE Login channel (ที่ผูก LIFF)
//   GUARD_JWT_SECRET   — JWT secret ของโปรเจกต์ Supabase (Dashboard > Settings > API > JWT Secret)
//                        ใช้ HS256 mint token ให้ PostgREST ยอมรับ
//
// Endpoint เดียว POST:
//   { mode: "login",    id_token }                                → { ok, access_token, user }
//   { mode: "register", id_token, employee_code, phone,
//     consent_version }                                           → ผูกบัญชีแล้วคืน token เลย

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5";

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const TOKEN_TTL_SEC = 60 * 60; // 1 ชั่วโมง — LIFF ต่ออายุเงียบๆ ด้วย ID token เดิม (F2)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// service role client — ข้าม RLS ได้ ใช้เฉพาะใน function นี้
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type LineProfile = { sub: string; name?: string; picture?: string };

async function verifyLineIdToken(idToken: string): Promise<LineProfile | null> {
  const res = await fetch(LINE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: Deno.env.get("LINE_CHANNEL_ID")!,
    }),
  });
  if (!res.ok) return null;
  return await res.json();
}

async function mintJwt(user: {
  id: string;
  tenant_id: string;
  role: string;
}): Promise<string> {
  const secret = new TextEncoder().encode(Deno.env.get("GUARD_JWT_SECRET")!);
  return await new SignJWT({
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {
      tenant_id: user.tenant_id,
      user_id: user.id,
      user_role: user.role,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC)
    .sign(secret);
}

function publicUser(u: Record<string, unknown>) {
  return {
    id: u.id,
    full_name: u.full_name,
    role: u.role,
    employee_code: u.employee_code,
    photo_url: u.photo_url,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { mode, id_token, employee_code, phone, consent_version } = await req.json();
    if (!id_token) return json({ ok: false, error: "missing_id_token" }, 400);

    const profile = await verifyLineIdToken(id_token);
    if (!profile?.sub) return json({ ok: false, error: "invalid_line_token" }, 401);
    const lineUserId = profile.sub;

    if (mode === "register") {
      // F1: หา user ที่ employee_code + phone ตรง และยังไม่เคยผูก LINE
      if (!employee_code || !phone) {
        return json({ ok: false, error: "missing_employee_code_or_phone" }, 400);
      }
      if (!consent_version) {
        // PDPA: ต้องยินยอมก่อนผูกบัญชี (รีวิว 1.4)
        return json({ ok: false, error: "consent_required" }, 400);
      }

      const { data: existing } = await admin
        .from("users").select("id").eq("line_user_id", lineUserId).maybeSingle();
      if (existing) return json({ ok: false, error: "line_already_bound" }, 409);

      const { data: candidate } = await admin
        .from("users")
        .select("*")
        .eq("employee_code", employee_code.trim())
        .eq("phone", phone.trim())
        .is("line_user_id", null)
        .eq("is_active", true)
        .maybeSingle();
      if (!candidate) return json({ ok: false, error: "no_matching_employee" }, 404);

      const { error: bindErr } = await admin
        .from("users")
        .update({
          line_user_id: lineUserId,
          photo_url: candidate.photo_url ?? profile.picture ?? null,
          consent_version,
          consented_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);
      if (bindErr) return json({ ok: false, error: "bind_failed" }, 500);

      await admin.from("audit_logs").insert({
        tenant_id: candidate.tenant_id,
        actor_user_id: candidate.id,
        action: "line_account_bound",
        target_table: "users",
        target_id: candidate.id,
        after: { line_user_id: lineUserId, consent_version },
      });

      const token = await mintJwt(candidate);
      return json({ ok: true, access_token: token, user: publicUser(candidate) });
    }

    // mode === "login" (F2)
    const { data: user } = await admin
      .from("users")
      .select("*")
      .eq("line_user_id", lineUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (!user) return json({ ok: false, error: "not_registered" }, 404);

    const token = await mintJwt(user);
    return json({ ok: true, access_token: token, user: publicUser(user) });
  } catch (e) {
    console.error("auth-line error:", e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
