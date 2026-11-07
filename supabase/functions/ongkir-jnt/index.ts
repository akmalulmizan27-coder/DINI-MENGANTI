// Supabase Edge Function: ongkir-jnt
// Proxy ke API RajaOngkir (Komerce) untuk cek ongkir kurir J&T.
// Secret yang dibutuhkan:  RAJAONGKIR_KEY
// Develop Program By Nurman Catra

const BASE = "https://rajaongkir.komerce.id/api/v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("RAJAONGKIR_KEY");
  if (!key) return json({ ok: false, error: "RAJAONGKIR_KEY belum diset" }, 200);

  try {
    const body = await req.json();

    // 1) cari kota/kecamatan tujuan
    if (body.action === "search") {
      const q = String(body.q || "").trim();
      if (q.length < 3) return json({ ok: true, data: [] });
      const r = await fetch(`${BASE}/destination/domestic-destination?search=${encodeURIComponent(q)}&limit=10&offset=0`, {
        headers: { key },
      });
      const d = await r.json();
      return json({ ok: r.ok, data: d.data || [], error: r.ok ? null : d?.meta?.message });
    }

    // 2) hitung ongkir J&T
    if (body.action === "cost") {
      const form = new URLSearchParams({
        origin: String(body.origin),
        destination: String(body.destination),
        weight: String(Math.max(1, Math.round(body.weight || 1000))),
        courier: "jnt",
        price: "lowest",
      });
      const r = await fetch(`${BASE}/calculate/domestic-cost`, {
        method: "POST",
        headers: { key, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const d = await r.json();
      const data = (d.data || []).map((x: any) => ({
        service: x.service, description: x.description, cost: x.cost, etd: x.etd,
      }));
      return json({ ok: r.ok, data, error: r.ok ? null : d?.meta?.message });
    }

    return json({ ok: false, error: "action tidak dikenal" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
