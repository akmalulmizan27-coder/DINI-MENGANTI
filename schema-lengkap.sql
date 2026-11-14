-- =====================================================================
-- WARUNG DINI — SKEMA DATABASE LENGKAP (versi terbaru, sekali jalan)
-- Untuk project Supabase BARU: SQL Editor → tempel semua → Run.
-- Develop Program (MIZAN&NORMAN)
-- =====================================================================

-- ---------------- TABEL ----------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nama text not null default '',
  no_hp text default '',
  alamat text default '',
  kota text default '',
  kecamatan text default '',
  kodepos text default '',
  role text not null default 'member' check (role in ('admin','member')),
  poin integer not null default 0,
  wajib_ganti_pw boolean not null default false,
  boleh_dp boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigint generated always as identity primary key,
  nama text not null,
  kategori text default 'Umum',
  deskripsi text default '',
  harga integer not null default 0 check (harga >= 0),               -- harga per PACK
  harga_slof integer check (harga_slof is null or harga_slof >= 0),
  harga_ball integer check (harga_ball is null or harga_ball >= 0),
  isi_slof integer not null default 10 check (isi_slof > 0),         -- pack per slof
  isi_ball integer not null default 100 check (isi_ball > 0),        -- pack per ball
  berat_gram integer not null default 100 check (berat_gram > 0),    -- berat per pack
  stok integer not null default 0,                                   -- stok dalam pack
  foto_url text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence if not exists public.order_kode_seq;

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  kode text unique not null,
  member_id uuid not null references public.profiles(id) on delete cascade,
  items jsonb not null default '[]',
  subtotal integer not null default 0,
  berat_gram integer not null default 0,
  kurir text not null default 'J&T',
  layanan text default 'EZ',
  ongkir integer not null default 0,
  etd text default '',
  total integer not null default 0,
  penerima_nama text not null,
  penerima_hp text not null,
  penerima_alamat text not null,
  penerima_kota text default '',
  penerima_kecamatan text default '',
  penerima_kodepos text default '',
  tujuan_id text default '',
  catatan text default '',
  metode_bayar text not null default 'qris' check (metode_bayar in ('qris','transfer')),
  dp_persen integer not null default 0 check (dp_persen in (0,10,20,30,40,50)),
  dp_nominal integer not null default 0 check (dp_nominal >= 0),
  status_bayar text not null default 'belum' check (status_bayar in ('belum','dp','lunas')),
  status text not null default 'menunggu'
    check (status in ('menunggu','dikonfirmasi','dikirim','selesai','batal')),
  resi text default '',
  dicetak_at timestamptz,
  created_at timestamptz not null default now(),
  constraint orders_selesai_wajib_lunas check (status <> 'selesai' or status_bayar = 'lunas')
);

create table if not exists public.point_logs (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null,
  saldo_akhir integer not null,
  keterangan text default '',
  oleh uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.rewards (
  id bigint generated always as identity primary key,
  nama text not null,
  deskripsi text default '',
  poin integer not null check (poin > 0),
  stok integer not null default 0,
  foto_url text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.redemptions (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles(id) on delete cascade,
  reward_id bigint not null references public.rewards(id),
  reward_nama text not null,
  poin integer not null,
  status text not null default 'menunggu' check (status in ('menunggu','disetujui','ditolak')),
  catatan_admin text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.tarif_manual (
  id bigint generated always as identity primary key,
  kota text not null unique,
  tarif_per_kg integer not null,
  etd text default '2-3 hari'
);

create table if not exists public.settings (
  key text primary key,
  value text default ''
);

create table if not exists public.popups (
  id bigint generated always as identity primary key,
  judul text not null default '',
  gambar_url text not null,               -- gambar atau video (.mp4/.webm)
  link text default '',                   -- '', 'produk:ID', atau https://...
  teks_tombol text default '',
  aktif boolean not null default true,
  mulai date,
  selesai date,
  urutan integer not null default 0,
  posisi text not null default 'popup' check (posisi in ('popup','baris')),
  created_at timestamptz not null default now()
);

-- ---------------- PENGATURAN AWAL (ganti lewat Admin → Pengaturan) ----------------
insert into public.settings(key,value) values
 ('nama_toko','NAMA TOKO'),
 ('slogan','Lengkap, murah, ramah.'),
 ('wa_toko','6281234567890'),
 ('hp_toko','081234567890'),
 ('alamat_toko','Alamat toko'),
 ('toko_lat',''), ('toko_lng',''),
 ('origin_id',''),              -- ID kecamatan asal (RajaOngkir/Komerce)
 ('origin_nama',''),
 ('tarif_default_per_kg','15000'),
 ('logo_url',''), ('banner_url',''), ('qris_url',''),
 ('bank_nama',''), ('bank_norek',''), ('bank_atas_nama',''),
 ('link_pendek','')
on conflict (key) do nothing;

-- ---------------- FUNGSI BANTU ----------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, nama, no_hp)
  values (new.id, coalesce(new.raw_user_meta_data->>'nama',''), coalesce(new.raw_user_meta_data->>'no_hp',''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- member tidak boleh mengubah role / poin / akses DP miliknya sendiri
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and current_setting('app.bypass', true) is distinct from 'on' then
    new.role := old.role;
    new.poin := old.poin;
    new.boleh_dp := old.boleh_dp;
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------------- POIN & HADIAH ----------------
create or replace function public.admin_adjust_points(p_member uuid, p_delta integer, p_ket text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_saldo integer;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  update public.profiles set poin = poin + p_delta where id = p_member returning poin into v_saldo;
  if v_saldo is null then raise exception 'Member tidak ditemukan'; end if;
  if v_saldo < 0 then raise exception 'Saldo poin tidak boleh minus'; end if;
  insert into public.point_logs(member_id, delta, saldo_akhir, keterangan, oleh)
  values (p_member, p_delta, v_saldo, coalesce(p_ket,''), auth.uid());
  return v_saldo;
end $$;

create or replace function public.redeem_reward(p_reward bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare r public.rewards; v_saldo integer; v_id bigint;
begin
  select * into r from public.rewards where id = p_reward and aktif for update;
  if r.id is null then raise exception 'Hadiah tidak tersedia'; end if;
  if r.stok <= 0 then raise exception 'Stok hadiah habis'; end if;
  select poin into v_saldo from public.profiles where id = auth.uid() for update;
  if v_saldo is null then raise exception 'Silakan login'; end if;
  if v_saldo < r.poin then raise exception 'Poin tidak cukup'; end if;
  perform set_config('app.bypass','on',true);
  update public.profiles set poin = poin - r.poin where id = auth.uid() returning poin into v_saldo;
  update public.rewards set stok = stok - 1 where id = r.id;
  insert into public.redemptions(member_id, reward_id, reward_nama, poin)
  values (auth.uid(), r.id, r.nama, r.poin) returning id into v_id;
  insert into public.point_logs(member_id, delta, saldo_akhir, keterangan, oleh)
  values (auth.uid(), -r.poin, v_saldo, 'Tukar hadiah: '||r.nama, auth.uid());
  return v_id;
end $$;

create or replace function public.admin_process_redemption(p_id bigint, p_status text, p_catatan text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.redemptions; v_saldo integer;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select * into d from public.redemptions where id = p_id for update;
  if d.id is null or d.status <> 'menunggu' then raise exception 'Penukaran sudah diproses'; end if;
  if p_status not in ('disetujui','ditolak') then raise exception 'Status tidak valid'; end if;
  update public.redemptions set status = p_status, catatan_admin = coalesce(p_catatan,'') where id = p_id;
  if p_status = 'ditolak' then
    update public.profiles set poin = poin + d.poin where id = d.member_id returning poin into v_saldo;
    update public.rewards set stok = stok + 1 where id = d.reward_id;
    insert into public.point_logs(member_id, delta, saldo_akhir, keterangan, oleh)
    values (d.member_id, d.poin, v_saldo, 'Pengembalian poin (penukaran ditolak): '||d.reward_nama, auth.uid());
  end if;
end $$;

-- ---------------- PESANAN ----------------
-- p_items: [{"id":1,"qty":2,"satuan":"pack|slof|ball"}]
-- p_kirim: {nama,hp,alamat,kota,kecamatan,kodepos,tujuan_id,layanan,ongkir,etd,catatan,metode_bayar,dp_persen}
create or replace function public.create_order(p_items jsonb, p_kirim jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare it jsonb; pr public.products; v_items jsonb := '[]'; v_sub integer := 0; v_berat integer := 0;
        v_qty integer; v_kode text; v_ongkir integer; v_sat text; v_isi integer; v_harga integer; v_metode text;
        v_dp integer; v_total integer;
begin
  if auth.uid() is null then raise exception 'Silakan login'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  v_metode := case when p_kirim->>'metode_bayar' = 'transfer' then 'transfer' else 'qris' end;
  v_dp := coalesce(nullif(p_kirim->>'dp_persen','')::int, 0);
  if v_dp not in (0,10,20,30,40,50) then raise exception 'Pilihan DP tidak valid'; end if;
  for it in select * from jsonb_array_elements(p_items) order by (value->>'id')::bigint loop
    v_qty := greatest((it->>'qty')::int, 1);
    v_sat := lower(coalesce(it->>'satuan','pack'));
    select * into pr from public.products where id = (it->>'id')::bigint and aktif for update;
    if pr.id is null then raise exception 'Produk tidak tersedia'; end if;
    if v_sat = 'slof' then v_isi := pr.isi_slof; v_harga := pr.harga_slof;
    elsif v_sat = 'ball' then v_isi := pr.isi_ball; v_harga := pr.harga_ball;
    else v_sat := 'pack'; v_isi := 1; v_harga := pr.harga; end if;
    if v_harga is null or v_harga <= 0 then raise exception '% tidak dijual per %', pr.nama, upper(v_sat); end if;
    if pr.stok < v_qty * v_isi then raise exception 'Stok % tidak cukup (sisa % pack)', pr.nama, pr.stok; end if;
    update public.products set stok = stok - v_qty * v_isi where id = pr.id;
    v_items := v_items || jsonb_build_object('id',pr.id,'nama',pr.nama,'satuan',v_sat,'isi',v_isi,'harga',v_harga,'qty',v_qty,'berat',pr.berat_gram * v_isi);
    v_sub := v_sub + v_harga * v_qty;
    v_berat := v_berat + pr.berat_gram * v_isi * v_qty;
  end loop;
  v_ongkir := coalesce((p_kirim->>'ongkir')::int, 0);
  v_total := v_sub + v_ongkir;
  v_kode := 'ORD' || to_char(now() at time zone 'Asia/Jakarta','YYMMDD') || lpad((nextval('public.order_kode_seq') % 100000)::text,5,'0');
  insert into public.orders(kode, member_id, items, subtotal, berat_gram, layanan, ongkir, etd, total,
    penerima_nama, penerima_hp, penerima_alamat, penerima_kota, penerima_kecamatan, penerima_kodepos, tujuan_id, catatan,
    metode_bayar, dp_persen, dp_nominal)
  values (v_kode, auth.uid(), v_items, v_sub, v_berat,
    coalesce(p_kirim->>'layanan','EZ'), v_ongkir, coalesce(p_kirim->>'etd',''), v_total,
    p_kirim->>'nama', p_kirim->>'hp', p_kirim->>'alamat', coalesce(p_kirim->>'kota',''),
    coalesce(p_kirim->>'kecamatan',''), coalesce(p_kirim->>'kodepos',''),
    coalesce(p_kirim->>'tujuan_id',''), coalesce(p_kirim->>'catatan',''),
    v_metode, v_dp, case when v_dp > 0 then (ceil(v_total * v_dp / 100.0 / 100.0) * 100)::int else 0 end);
  return v_kode;
end $$;

create or replace function public.cancel_order(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; it jsonb;
begin
  select * into o from public.orders where id = p_id for update;
  if o.id is null then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.member_id <> auth.uid() and not public.is_admin() then raise exception 'Tidak diizinkan'; end if;
  if o.status not in ('menunggu','dikonfirmasi') then raise exception 'Pesanan sudah dikirim'; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    update public.products set stok = stok + (it->>'qty')::int * coalesce((it->>'isi')::int, 1) where id = (it->>'id')::bigint;
  end loop;
  update public.orders set status = 'batal' where id = p_id;
end $$;

-- DP hanya untuk member yang diberi akses admin
create or replace function public.cek_akses_dp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dp_persen > 0 and not coalesce((select boleh_dp from public.profiles where id = new.member_id), false) then
    raise exception 'Fitur DP belum diaktifkan untuk akun Anda. Hubungi admin toko.';
  end if;
  return new;
end $$;
drop trigger if exists trg_cek_akses_dp on public.orders;
create trigger trg_cek_akses_dp before insert on public.orders for each row execute function public.cek_akses_dp();

-- ---------------- RESET PASSWORD OLEH ADMIN ----------------
create or replace function public.admin_reset_password(p_member uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_pw text := ''; v_huruf text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; i int;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  if p_member = auth.uid() then raise exception 'Gunakan menu Ganti password untuk akun sendiri'; end if;
  if not exists (select 1 from auth.users where id = p_member) then raise exception 'Member tidak ditemukan'; end if;
  for i in 1..8 loop v_pw := v_pw || substr(v_huruf, 1 + floor(random() * length(v_huruf))::int, 1); end loop;
  update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')), updated_at = now() where id = p_member;
  update public.profiles set wajib_ganti_pw = true where id = p_member;
  return v_pw;
end $$;

create or replace function public.admin_email_member(p_member uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then (select email from auth.users where id = p_member) end;
$$;

-- ---------------- HAK EKSEKUSI FUNGSI ----------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_profile() from public, anon, authenticated;
revoke execute on function public.cek_akses_dp() from public, anon, authenticated;
revoke execute on function public.admin_adjust_points(uuid,integer,text) from public, anon;
revoke execute on function public.admin_process_redemption(bigint,text,text) from public, anon;
revoke execute on function public.cancel_order(bigint) from public, anon;
revoke execute on function public.create_order(jsonb,jsonb) from public, anon;
revoke execute on function public.redeem_reward(bigint) from public, anon;
revoke execute on function public.admin_reset_password(uuid) from public, anon;
revoke execute on function public.admin_email_member(uuid) from public, anon;
grant execute on function public.admin_adjust_points(uuid,integer,text) to authenticated;
grant execute on function public.admin_process_redemption(bigint,text,text) to authenticated;
grant execute on function public.cancel_order(bigint) to authenticated;
grant execute on function public.create_order(jsonb,jsonb) to authenticated;
grant execute on function public.redeem_reward(bigint) to authenticated;
grant execute on function public.admin_reset_password(uuid) to authenticated;
grant execute on function public.admin_email_member(uuid) to authenticated;

-- ---------------- INDEX ----------------
create index if not exists idx_orders_member on public.orders(member_id);
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_point_logs_member on public.point_logs(member_id, created_at desc);
create index if not exists idx_point_logs_oleh on public.point_logs(oleh);
create index if not exists idx_red_member on public.redemptions(member_id);
create index if not exists idx_red_reward on public.redemptions(reward_id);
create index if not exists idx_products_aktif_nama on public.products(aktif, nama);

-- ---------------- RLS (KEAMANAN DATA) ----------------
alter table public.profiles     enable row level security;
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.point_logs   enable row level security;
alter table public.rewards      enable row level security;
alter table public.redemptions  enable row level security;
alter table public.tarif_manual enable row level security;
alter table public.settings     enable row level security;
alter table public.popups       enable row level security;

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles for update using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists p_orders_sel on public.orders;
create policy p_orders_sel on public.orders for select using (member_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists p_orders_adm on public.orders;
create policy p_orders_adm on public.orders for update using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists p_logs_sel on public.point_logs;
create policy p_logs_sel on public.point_logs for select using (member_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists p_red_sel on public.redemptions;
create policy p_red_sel on public.redemptions for select using (member_id = (select auth.uid()) or (select public.is_admin()));

-- tabel publik (baca semua/aktif, tulis hanya admin)
do $$
declare t text; c text;
begin
  for t, c in select * from (values ('products','aktif'),('rewards','aktif'),('popups','aktif'),('tarif_manual','true'),('settings','true')) v(t,c) loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for select using (%s or (select public.is_admin()))', t||'_sel', t, c);
    execute format('create policy %I on public.%I for insert with check ((select public.is_admin()))', t||'_ins', t);
    execute format('create policy %I on public.%I for update using ((select public.is_admin())) with check ((select public.is_admin()))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete using ((select public.is_admin()))', t||'_del', t);
  end loop;
end $$;

-- ---------------- STORAGE (foto produk, hadiah, iklan, logo, QRIS) ----------------
insert into storage.buckets(id, name, public) values ('foto','foto', true) on conflict (id) do nothing;
drop policy if exists p_foto_read on storage.objects;
create policy p_foto_read on storage.objects for select using (bucket_id = 'foto');
drop policy if exists p_foto_write on storage.objects;
create policy p_foto_write on storage.objects for insert with check (bucket_id = 'foto' and public.is_admin());
drop policy if exists p_foto_del on storage.objects;
create policy p_foto_del on storage.objects for delete using (bucket_id = 'foto' and public.is_admin());

-- ---------------- REALTIME (notifikasi pesanan baru di admin) ----------------
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when others then null; end $$;

-- =====================================================================
-- MEMBUAT ADMIN — pilih salah satu:
-- (a) Daftar lewat web, lalu:
--     update public.profiles set role='admin'
--     where id = (select id from auth.users where email='EMAIL_ADMIN@contoh.com');
-- (b) Admin login pakai ID (tanpa email asli): web mengubah ID "NAMAID" menjadi
--     "namaid@dinimenganti.com". Buat user itu di Authentication → Users → Add user
--     (centang Auto Confirm), lalu jalankan query (a) dengan email tsb.
--     Ganti domain "@dinimenganti.com" di index.html (fungsi login) bila perlu.
-- =====================================================================
