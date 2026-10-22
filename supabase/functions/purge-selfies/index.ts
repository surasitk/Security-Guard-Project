// Horguard — Edge Function: purge-selfies
// ลบรูป selfie ที่หมดระยะเก็บ (เรียกโดย pg_cron ทุกคืน · ดู migration 16)
//
// ยืนยันผู้เรียก: header `Authorization: Bearer <cron_secret>` → เทียบกับ Vault ผ่าน RPC verify_cron_secret
// (ไม่ต้องตั้ง secret ใน Edge Function เพิ่ม)
//
// Deploy:  supabase functions deploy purge-selfies --no-verify-jwt --project-ref ybghyacwfdlezanewvgn
//          หรือ Dashboard → Edge Functions → Deploy new function → Via Editor (ปิด Verify JWT)
//
// ทดสอบแบบไม่ลบจริง: POST body {"dry_run": true} → คืนรายชื่อไฟล์ที่จะถูกลบ

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BATCH = 500;        // ไฟล์ต่อรอบ
const MAX_ROUNDS = 20;    // กันวนนานเกิน (สูงสุด 10,000 ไฟล์ต่อคืน ที่เหลือคืนถัดไปลบต่อ)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function alertLine(text: string) {
  // ส่งเข้า LINE ผ่านฟังก์ชันใน DB (migration 17) — ถ้ายังไม่ได้รัน migration 17 ก็ข้ามเงียบๆ
  try {
    await admin.rpc("ops_send_line", { p_key: "purge-selfies-error", p_text: text });
  } catch (_) { /* ignore */ }
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const { data: valid } = given
    ? await admin.rpc("verify_cron_secret", { p_secret: given })
    : { data: false };
  if (valid !== true) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dry_run === true;
  } catch (_) { /* body ว่างได้ */ }

  let deleted = 0;
  let cleared = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data, error } = await admin.rpc("selfie_purge_candidates", { p_limit: BATCH });
      if (error) throw new Error(`candidates: ${error.message}`);
      const paths = (data ?? []).map((r: { path: string }) => r.path);
      if (paths.length === 0) break;

      if (dryRun) {
        return json({ ok: true, dry_run: true, would_delete: paths.length, sample: paths.slice(0, 20) });
      }

      const { data: removed, error: rmErr } = await admin.storage.from("selfies").remove(paths);
      if (rmErr) throw new Error(`storage.remove: ${rmErr.message}`);

      // เคลียร์ path เฉพาะไฟล์ที่ Storage ยืนยันว่าลบแล้ว
      const gone = (removed ?? []).map((o: { name: string }) => o.name);
      if (gone.length === 0) break; // กันวนไม่รู้จบถ้าลบไม่สำเร็จสักไฟล์

      const { data: refs, error: markErr } = await admin.rpc("selfie_purge_mark", {
        p_paths: gone,
        p_note: `round ${round + 1}`,
      });
      if (markErr) throw new Error(`mark: ${markErr.message}`);

      deleted += gone.length;
      cleared += (refs as number) ?? 0;
      if (paths.length < BATCH) break;
    }
    return json({ ok: true, deleted, refs_cleared: cleared });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await alertLine(`⚠️ Horguard: ลบรูปเก่าไม่สำเร็จ\n${msg}\nลบไปแล้ว ${deleted} ไฟล์ก่อนเกิดปัญหา`);
    return json({ ok: false, error: msg, deleted }, 500);
  }
});
