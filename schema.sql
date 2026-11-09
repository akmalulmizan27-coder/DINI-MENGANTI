-- =====================================================================
-- KATALOG TOKO + MEMBER POIN  |  Develop Program By Nurman Catra
-- Jalankan sekali di Supabase SQL Editor
-- =====================================================================

-- ---------- TABEL ----------
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
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id bigint generated always as identity primary key,
  nama text not null,
  kategori text default 'Umum',
  deskripsi text default '',
  harga integer not null default 0 check (harga >= 0),
  berat_gram integer not null default 100 check (berat_gram > 0),
  stok integer not null default 0,
  foto_url text default '',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

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
  status text not null default 'menunggu'
    check (status in ('menunggu','dikonfirmasi','dikirim','selesai','batal')),
  resi text default '',
  dicetak_at timestamptz,
  created_at timestamptz not null default now()
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

-- tarif manual J&T (cadangan bila API ongkir belum diset)
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

insert into public.settings(key,value) values
 ('nama_toko','Toko Saya'),
 ('wa_toko','6281945507050'),
 ('alamat_toko','Jl. Contoh No. 1, Surabaya'),
 ('hp_toko','081945507050'),
 ('origin_id',''),          -- ID kota/kecamatan asal (RajaOngkir/Komerce)
 ('origin_nama','Surabaya'),
 ('tarif_default_per_kg','12000')
on conflict (key) do nothing;

create sequence if not exists public.order_kode_seq;

-- ---------- HELPER ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- profil otomatis saat daftar
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, nama, no_hp)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nama',''),
          coalesce(new.raw_user_meta_data->>'no_hp',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- member tidak boleh ubah role/poin sendiri
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and current_setting('app.bypass', true) is distinct from 'on' then
    new.role := old.role;
    new.poin := old.poin;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------- RPC ----------
-- admin tambah / kurangi poin manual
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

-- member tukar hadiah (poin langsung dipotong, status menunggu)
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

-- admin proses penukaran (ditolak = poin & stok dikembalikan)
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

-- member buat pesanan (harga & berat dihitung di server)
-- p_items: [{"id":1,"qty":2}, ...]  p_kirim: data penerima + ongkir
create or replace function public.create_order(p_items jsonb, p_kirim jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare it jsonb; pr public.products; v_items jsonb := '[]'; v_sub integer := 0; v_berat integer := 0;
        v_qty integer; v_kode text; v_ongkir integer;
begin
  if auth.uid() is null then raise exception 'Silakan login'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  for it in select * from jsonb_array_elements(p_items) order by (value->>'id')::bigint loop
    v_qty := greatest((it->>'qty')::int, 1);
    select * into pr from public.products where id = (it->>'id')::bigint and aktif for update;
    if pr.id is null then raise exception 'Produk tidak tersedia'; end if;
    if pr.stok < v_qty then raise exception 'Stok % tidak cukup (sisa %)', pr.nama, pr.stok; end if;
    update public.products set stok = stok - v_qty where id = pr.id;
    v_items := v_items || jsonb_build_object('id',pr.id,'nama',pr.nama,'harga',pr.harga,'qty',v_qty,'berat',pr.berat_gram);
    v_sub := v_sub + pr.harga * v_qty;
    v_berat := v_berat + pr.berat_gram * v_qty;
  end loop;
  v_ongkir := coalesce((p_kirim->>'ongkir')::int, 0);
  v_kode := 'ORD' || to_char(now() at time zone 'Asia/Jakarta','YYMMDD') || lpad((nextval('public.order_kode_seq') % 100000)::text,5,'0');
  insert into public.orders(kode, member_id, items, subtotal, berat_gram, layanan, ongkir, etd, total,
    penerima_nama, penerima_hp, penerima_alamat, penerima_kota, penerima_kecamatan, penerima_kodepos,
    tujuan_id, catatan)
  values (v_kode, auth.uid(), v_items, v_sub, v_berat,
    coalesce(p_kirim->>'layanan','EZ'), v_ongkir, coalesce(p_kirim->>'etd',''), v_sub + v_ongkir,
    p_kirim->>'nama', p_kirim->>'hp', p_kirim->>'alamat', coalesce(p_kirim->>'kota',''),
    coalesce(p_kirim->>'kecamatan',''), coalesce(p_kirim->>'kodepos',''),
    coalesce(p_kirim->>'tujuan_id',''), coalesce(p_kirim->>'catatan',''));
  return v_kode;
end $$;

-- member batalkan pesanan yang masih menunggu (stok kembali)
create or replace function public.cancel_order(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; it jsonb;
begin
  select * into o from public.orders where id = p_id for update;
  if o.id is null then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.member_id <> auth.uid() and not public.is_admin() then raise exception 'Tidak diizinkan'; end if;
  if o.status not in ('menunggu','dikonfirmasi') then raise exception 'Pesanan sudah dikirim'; end if;
  for it in select * from jsonb_array_elements(o.items) loop
    update public.products set stok = stok + (it->>'qty')::int where id = (it->>'id')::bigint;
  end loop;
  update public.orders set status = 'batal' where id = p_id;
end $$;

-- ---------- HAK EKSEKUSI FUNGSI ----------
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_profile() from public, anon, authenticated;
revoke execute on function public.admin_adjust_points(uuid,integer,text) from public, anon;
revoke execute on function public.admin_process_redemption(bigint,text,text) from public, anon;
revoke execute on function public.cancel_order(bigint) from public, anon;
revoke execute on function public.create_order(jsonb,jsonb) from public, anon;
revoke execute on function public.redeem_reward(bigint) from public, anon;
grant execute on function public.admin_adjust_points(uuid,integer,text) to authenticated;
grant execute on function public.admin_process_redemption(bigint,text,text) to authenticated;
grant execute on function public.cancel_order(bigint) to authenticated;
grant execute on function public.create_order(jsonb,jsonb) to authenticated;
grant execute on function public.redeem_reward(bigint) to authenticated;

-- ---------- RLS ----------
alter table public.profiles     enable row level security;
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.point_logs   enable row level security;
alter table public.rewards      enable row level security;
alter table public.redemptions  enable row level security;
alter table public.tarif_manual enable row level security;
alter table public.settings     enable row level security;

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles for update using (id = auth.uid() or public.is_admin());

drop policy if exists p_products_sel on public.products;
create policy p_products_sel on public.products for select using (aktif or public.is_admin());
drop policy if exists p_products_adm on public.products;
create policy p_products_adm on public.products for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_orders_sel on public.orders;
create policy p_orders_sel on public.orders for select using (member_id = auth.uid() or public.is_admin());
drop policy if exists p_orders_adm on public.orders;
create policy p_orders_adm on public.orders for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_logs_sel on public.point_logs;
create policy p_logs_sel on public.point_logs for select using (member_id = auth.uid() or public.is_admin());

drop policy if exists p_rewards_sel on public.rewards;
create policy p_rewards_sel on public.rewards for select using (aktif or public.is_admin());
drop policy if exists p_rewards_adm on public.rewards;
create policy p_rewards_adm on public.rewards for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_red_sel on public.redemptions;
create policy p_red_sel on public.redemptions for select using (member_id = auth.uid() or public.is_admin());

drop policy if exists p_tarif_sel on public.tarif_manual;
create policy p_tarif_sel on public.tarif_manual for select using (true);
drop policy if exists p_tarif_adm on public.tarif_manual;
create policy p_tarif_adm on public.tarif_manual for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_set_sel on public.settings;
create policy p_set_sel on public.settings for select using (true);
drop policy if exists p_set_adm on public.settings;
create policy p_set_adm on public.settings for all using (public.is_admin()) with check (public.is_admin());

-- ---------- IKLAN POPUP ----------
create table if not exists public.popups (
  id bigint generated always as identity primary key,
  judul text not null default '', gambar_url text not null, link text default '', teks_tombol text default '',
  aktif boolean not null default true, mulai date, selesai date, urutan integer not null default 0,
  posisi text not null default 'popup' check (posisi in ('popup','baris')),
  created_at timestamptz not null default now()
);
alter table public.popups enable row level security;
drop policy if exists p_popups_sel on public.popups;
create policy p_popups_sel on public.popups for select using (aktif or public.is_admin());
drop policy if exists p_popups_adm on public.popups;
create policy p_popups_adm on public.popups for all using (public.is_admin()) with check (public.is_admin());

-- ---------- STORAGE (foto produk & hadiah) ----------
insert into storage.buckets(id, name, public) values ('foto','foto', true) on conflict (id) do nothing;
drop policy if exists p_foto_read on storage.objects;
create policy p_foto_read on storage.objects for select using (bucket_id = 'foto');
drop policy if exists p_foto_write on storage.objects;
create policy p_foto_write on storage.objects for insert with check (bucket_id = 'foto' and public.is_admin());
drop policy if exists p_foto_del on storage.objects;
create policy p_foto_del on storage.objects for delete using (bucket_id = 'foto' and public.is_admin());

-- ---------- REALTIME (notifikasi pesanan baru di admin) ----------
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when others then null; end $$;

-- =====================================================================
-- JADIKAN ADMIN: daftar dulu lewat aplikasi, lalu jalankan:
-- update public.profiles set role='admin'
--   where id = (select id from auth.users where email='EMAIL_ADMIN@contoh.com');
-- =====================================================================

-- =====================================================================
-- PERBAIKAN SETELAH TES BEBAN (100-300 pesanan bersamaan)
-- =====================================================================
-- Kode pesanan pakai sequence supaya tidak pernah kembar
create sequence if not exists public.order_kode_seq;
-- (fungsi create_order versi terbaru: kode = 'ORD' || YYMMDD || nextval(order_kode_seq) 5 digit,
--  dan produk dikunci berurutan id supaya pesanan bersamaan tidak saling menunggu/deadlock)

create index if not exists idx_orders_member on public.orders(member_id);
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_point_logs_member on public.point_logs(member_id, created_at desc);
create index if not exists idx_point_logs_oleh on public.point_logs(oleh);
create index if not exists idx_red_member on public.redemptions(member_id);
create index if not exists idx_red_reward on public.redemptions(reward_id);
create index if not exists idx_products_aktif_nama on public.products(aktif, nama);
-- Policy RLS memakai (select auth.uid()) / (select public.is_admin()) agar dihitung sekali per query,
-- dan policy admin dipisah per aksi (insert/update/delete) — lihat migrasi "perf_dan_fix_kode_order".

-- =====================================================================
-- HARGA BERTINGKAT PACK / SLOF / BALL  (stok dihitung dalam PACK)
-- =====================================================================
alter table public.products
  add column if not exists harga_slof integer check (harga_slof is null or harga_slof >= 0),
  add column if not exists harga_ball integer check (harga_ball is null or harga_ball >= 0),
  add column if not exists isi_slof integer not null default 10 check (isi_slof > 0),
  add column if not exists isi_ball integer not null default 100 check (isi_ball > 0);
-- create_order menerima item {id, qty, satuan:'pack'|'slof'|'ball'}: harga sesuai satuan,
-- stok dipotong qty × isi (pack), item pesanan menyimpan satuan & isi.
-- cancel_order mengembalikan stok qty × isi. (lihat migrasi "harga_bertingkat_pack_slof_ball")
