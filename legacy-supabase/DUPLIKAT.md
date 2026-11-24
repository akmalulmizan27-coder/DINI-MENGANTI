# Panduan Duplikat Aplikasi Warung Dini

Develop Program (MIZAN&NORMAN)

## Isi folder
| File / folder | Fungsi |
|---|---|
| `index.html` | Seluruh aplikasi (tampilan member + admin) |
| `schema-lengkap.sql` | **Database lengkap** — jalankan sekali di project Supabase baru |
| `schema.sql` | Riwayat skema lama (catatan saja, pakai `schema-lengkap.sql`) |
| `supabase/functions/ongkir-jnt/index.ts` | Server cek ongkir & lacak resi J&T (RajaOngkir/Komerce) |
| `demo-db.js` | Mode demo tanpa database (data di browser) |
| `manifest.json`, `sw.js`, `icons/` | PWA (bisa di-install / dibuat APK) |
| `.well-known/assetlinks.json` | Verifikasi APK — **hapus / ganti** untuk aplikasi baru |
| `fonts/`, `logo.jpg`, `banner-bg.jpg`, `daftar-member.png` | Aset tampilan (logo & banner bisa diganti dari Admin → Pengaturan) |
| `qris.jpg` | QRIS toko lama — **ganti** dengan QRIS toko baru (atau upload dari Admin → Pengaturan) |

## Langkah duplikat
1. **Supabase baru** → SQL Editor → jalankan `schema-lengkap.sql`.
2. **Edit `index.html`** (bagian KONFIGURASI di atas script):
   - `SUPABASE_URL` dan `SUPABASE_ANON_KEY` → milik project baru (Project Settings → API, pakai publishable/anon key).
   - `DEMO_MODE = false`.
   - Cari `@dinimenganti.com` (login pakai ID) → ganti domain bila perlu.
   - Cari `bit.ly/warungdini` → ganti link pendek toko baru (atau isi dari Admin → Pengaturan).
3. **Ganti aset:** `qris.jpg`, `logo.jpg`, `banner-bg.jpg`, `icons/` (192/512/maskable), nama di `manifest.json`.
4. **Hapus** `.well-known/assetlinks.json` (punya APK lama) — buat baru lewat PWABuilder bila ingin APK.
5. **Upload ke GitHub** (repo baru) → **Cloudflare Workers & Pages** → Import repo (tanpa build command, output `/`).
6. **Supabase → Authentication:**
   - Sign In / Providers → Email → matikan *Confirm email* (agar member langsung masuk).
   - URL Configuration → Site URL & Redirect URLs = alamat web baru (`https://…/**`).
7. **Buat admin** — lihat bagian paling bawah `schema-lengkap.sql`.
8. Login admin → **Pengaturan**: nama toko, slogan, WA, alamat & koordinat, bank, QRIS, logo, banner, tarif J&T.
9. (Opsional) **Ongkir J&T otomatis:** deploy `supabase/functions/ongkir-jnt` (verify JWT aktif), set secret `RAJAONGKIR_KEY`, lalu pilih kecamatan asal di Pengaturan.
