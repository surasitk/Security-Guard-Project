// Guard OS — Edge Function: place-search
// ค้นหาสถานที่ด้วย Google Places API (New) — Text Search สำหรับปักหมุดโครงการในหน้า Admin
//
// Secret ที่ต้องตั้ง: GOOGLE_MAPS_API_KEY (เก็บฝั่งเซิร์ฟเวอร์เท่านั้น ไม่อยู่ในหน้าเว็บ)
// โควตาฟรี: Text Search Pro 5,000 ครั้ง/เดือน (ใช้เฉพาะตอนสร้าง/แก้โครงการ)
//
// POST { q } → { ok, results: [{ name, address, lat, lng }] }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const { q } = await req.json();
    const query = String(q || "").trim().slice(0, 200);
    if (!query) return json({ ok: false, error: "missing_q" }, 400);
    const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!key) return json({ ok: false, error: "missing_key" });

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "th", regionCode: "TH", maxResultCount: 6 }),
    });
    if (!res.ok) return json({ ok: false, error: `google_${res.status}`, detail: (await res.text()).slice(0, 300) });
    const data = await res.json();
    const results = (data.places || []).map((p: Record<string, any>) => ({
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
    })).filter((r: { lat?: number }) => typeof r.lat === "number");
    return json({ ok: true, results });
  } catch (e) {
    console.error("place-search error:", e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
