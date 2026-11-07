# Katalog Toko + Member Poin

Develop Program By Nurman Catra

Aplikasi web katalog (gaya e-commerce) dengan:
- **Admin (toko)**: kelola produk & foto, pesanan, member, poin manual (+/−), katalog hadiah, persetujuan penukaran, pengaturan toko, tarif J&T manual, cetak label paket.
- **Member**: daftar & login, keranjang, checkout dengan ongkir J&T, kirim pesanan ke WhatsApp toko, riwayat pesanan & resi, saldo/riwayat poin, tukar poin dengan hadiah.

## Alur pesanan
1. Member checkout → pesanan tersimpan (status **menunggu**, stok dipotong) → WhatsApp toko otomatis terbuka dengan detail pesanan.
2. Admin dapat notifikasi realtime → **Konfirmasi** → label 100×150 mm tercetak otomatis (bisa diatur: mati / saat konfirmasi / saat pesanan baru masuk).
3. Admin input **resi J&T** → status **dikirim** (member melihat resi di "Pesanan Saya").
4. **Selesai** → admin bisa tambah poin manual (tombol "+Poin" di baris pesanan atau menu Member & Poin).

## Setup
1. Buat project Supabase → SQL Editor → jalankan `schema.sql`.
2. Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di bagian atas `index.html`.
3. Daftar akun lewat aplikasi, lalu jadikan admin:
   ```sql
   update public.profiles set role='admin'
   where id = (select id from auth.users where email='email-admin@contoh.com');
   ```
4. (Opsional) Ongkir J&T otomatis via RajaOngkir (Komerce):
   - Daftar di https://collaborator.komerce.id → ambil API key **Shipping Cost**.
   - Deploy function: `supabase functions deploy ongkir-jnt --no-verify-jwt`
   - Set secret: `supabase secrets set RAJAONGKIR_KEY=xxxx`
   - Di Pengaturan admin, cari & pilih kecamatan asal toko.
   Tanpa API key, checkout memakai **tarif manual per kota** (diisi di Pengaturan).
5. Hosting `index.html`: Cloudflare Pages / GitHub Pages / Netlify (file statis).

## Catatan cetak label
- Ukuran 100×150 mm (printer thermal). Di dialog print pilih ukuran kertas 100×150 / A6, margin none.
- Resi J&T muncul sebagai barcode bila sudah diinput; bila belum, ada kolom kosong untuk resi dari counter J&T.
- Untuk resi otomatis dari sistem J&T dibutuhkan akun **J&T Open API (VIP/Merchant)** — bisa ditambahkan ke Edge Function nanti.
