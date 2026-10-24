// Cloudflare Worker "horguard-apps" — force./patrol.horguard.com → GitHub Pages (/Security-Guard-Project/admin|app/)
// แคช: /assets/* (ชื่อไฟล์มี hash) เก็บ 1 ปี · HTML เช็คของใหม่ทุกครั้ง (deploy แล้วเห็นทันที) · ไฟล์อื่น 1 วัน
export default {
  async fetch(req) {
    const u = new URL(req.url);
    const m = { "force.horguard.com": "admin", "patrol.horguard.com": "app" };
    const a = m[u.hostname];
    if (!a) return new Response("Not found", { status: 404 });
    const b = "/Security-Guard-Project/";
    let p = u.pathname;
    if (!p.startsWith(b)) p = b + a + p;

    const isAsset = p.includes("/assets/");
    const isHtml = p.endsWith("/") || p.endsWith(".html") || !/\.[a-z0-9]+$/i.test(p);
    const r = await fetch("https://surasitk.github.io" + p + u.search, {
      redirect: "manual",
      cf: isAsset ? { cacheEverything: true, cacheTtl: 31536000 } : isHtml ? { cacheTtl: 0 } : { cacheEverything: true, cacheTtl: 86400 },
    });

    const h = new Headers(r.headers);
    const l = h.get("location");
    if (l) h.set("location", l.replace("https://surasitk.github.io" + b + a, "https://" + u.hostname).replace("https://surasitk.github.io", "https://" + u.hostname));
    if (r.status === 200) {
      if (isAsset) h.set("Cache-Control", "public, max-age=31536000, immutable");
      else if (isHtml) h.set("Cache-Control", "no-cache");
      else h.set("Cache-Control", "public, max-age=86400");
    }
    return new Response(r.body, { status: r.status, headers: h });
  },
};
