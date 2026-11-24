# Warung Sembako Dini

Katalog belanja + member poin untuk Warung Sembako Dini. Sejak 24 Nov 2026 berjalan **penuh di Cloudflare**
(Worker + D1 + KV), tidak lagi memakai Supabase.

| Folder / file | Isi |
|---|---|
| `public/` | tampilan web (index.html, d1-client.js, sw.js, gambar, ikon, PWA) |
| `src/index.js` | Worker API: login, data, pesanan, poin, hadiah, ongkir J&T, upload foto |
| `wrangler.toml` | konfigurasi: Worker `dini-menganti`, D1 `dini-db`, KV `dini-files` |
| `legacy-supabase/` | arsip versi lama (Supabase), tidak dipakai lagi |

Deploy otomatis: setiap push ke GitHub → Cloudflare Workers Builds (`npx wrangler deploy`).

## Pengaturan di dashboard Cloudflare
Worker `dini-menganti` → Settings → Variables and Secrets:
- `RAJAONGKIR_KEY` (Secret) → API key RajaOngkir Komerce untuk ongkir otomatis J&T. Tanpa ini checkout memakai tarif manual per kota.

## Catatan pindahan dari Supabase
- Semua member, poin, pesanan, produk, pengaturan sudah dipindah ke D1.
- Password member lama tidak bisa dipindah (terenkripsi di Supabase). Member yang login akan diarahkan ke **Lupa password → WhatsApp admin**; admin klik **Reset PW** di menu Member & Poin untuk memberi password sementara.
- Login admin tetap: ID `DINIMENGANTI`.
- Foto produk, video iklan & logo masih di penyimpanan Supabase. Setelah kuota Supabase pulih, buka **Produk → Pindahkan foto** (sekali) supaya semua pindah ke Cloudflare. Iklan video dinonaktifkan sementara; aktifkan lagi di menu Iklan setelah foto dipindah.
