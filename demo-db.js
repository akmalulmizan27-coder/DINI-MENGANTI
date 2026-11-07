/* =====================================================================
   DEMO DB — pengganti Supabase untuk mode demo (tanpa server).
   Data disimpan di localStorage browser. Meniru subset API supabase-js
   yang dipakai index.html, supaya nanti tinggal diganti ke backend
   Cloudflare (Worker + D1) tanpa mengubah tampilan.
   Develop Program By Nurman Catra
   ===================================================================== */
(function () {
  const KEY = 'demo_db_v1', SKEY = 'demo_session', EKEY = 'demo_evt';
  const uid = () => 'u-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const now = () => new Date().toISOString();
  const PK = { settings: 'key' };

  function seed() {
    const adminId = 'u-admin', memId = 'u-member';
    const t = now();
    const prod = (id, nama, kategori, harga, berat, stok, deskripsi, emoji) =>
      ({ id, nama, kategori, harga, berat_gram: berat, stok, deskripsi, foto_url: svgFoto(emoji, nama), aktif: true, created_at: t });
    return {
      seq: { products: 9, orders: 1, point_logs: 3, rewards: 5, redemptions: 1, tarif_manual: 7 },
      users: [
        { id: adminId, email: 'admin@demo.com', password: 'admin123' },
        { id: memId, email: 'member@demo.com', password: 'member123' },
      ],
      files: {},
      profiles: [
        { id: adminId, nama: 'Admin Toko', no_hp: '081200000001', alamat: '', kota: '', kecamatan: '', kodepos: '', role: 'admin', poin: 0, created_at: t },
        { id: memId, nama: 'Budi Member', no_hp: '081200000002', alamat: 'Jl. Raya Menganti No. 10', kota: 'Gresik', kecamatan: 'Menganti', kodepos: '61174', role: 'member', poin: 150, created_at: t },
      ],
      products: [
        prod(1, 'Kopi Bubuk Robusta 250 g', 'Minuman', 35000, 270, 40, 'Kopi robusta giling halus, aroma kuat.', '☕'),
        prod(2, 'Teh Celup Melati 25 pcs', 'Minuman', 12000, 80, 60, 'Teh melati wangi, isi 25 kantong.', '🍵'),
        prod(3, 'Gula Aren Cair 500 ml', 'Bahan Dapur', 28000, 650, 25, 'Gula aren asli tanpa pengawet.', '🍯'),
        prod(4, 'Keripik Singkong Pedas', 'Camilan', 15000, 200, 50, 'Keripik singkong renyah bumbu pedas manis.', '🥔'),
        prod(5, 'Sambal Bawang Botol', 'Bahan Dapur', 22000, 300, 30, 'Sambal bawang homemade, level pedas sedang.', '🌶️'),
        prod(6, 'Kerupuk Udang 500 g', 'Camilan', 40000, 520, 20, 'Kerupuk udang mentah, tinggal goreng.', '🦐'),
        prod(7, 'Madu Hutan 350 ml', 'Kesehatan', 75000, 480, 15, 'Madu hutan murni.', '🐝'),
        prod(8, 'Tas Belanja Kanvas', 'Lainnya', 30000, 150, 4, 'Tas kanvas tebal, bisa dicuci.', '👜'),
      ],
      orders: [],
      point_logs: [
        { id: 1, member_id: memId, delta: 100, saldo_akhir: 100, keterangan: 'Bonus member baru', oleh: adminId, created_at: t },
        { id: 2, member_id: memId, delta: 50, saldo_akhir: 150, keterangan: 'Belanja bulan ini', oleh: adminId, created_at: t },
      ],
      rewards: [
        { id: 1, nama: 'Gantungan Kunci', deskripsi: 'Merchandise toko', poin: 50, stok: 20, foto_url: svgFoto('🔑', 'Gantungan Kunci'), aktif: true, created_at: t },
        { id: 2, nama: 'Mug Keramik', deskripsi: 'Mug logo toko', poin: 200, stok: 10, foto_url: svgFoto('☕', 'Mug'), aktif: true, created_at: t },
        { id: 3, nama: 'Voucher Belanja Rp25.000', deskripsi: 'Potongan pesanan berikutnya', poin: 300, stok: 15, foto_url: svgFoto('🎟️', 'Voucher'), aktif: true, created_at: t },
        { id: 4, nama: 'Kaos Toko', deskripsi: 'Ukuran M / L / XL', poin: 500, stok: 5, foto_url: svgFoto('👕', 'Kaos'), aktif: true, created_at: t },
      ],
      redemptions: [],
      tarif_manual: [
        { id: 1, kota: 'Gresik', tarif_per_kg: 8000, etd: '1-2 hari' },
        { id: 2, kota: 'Surabaya', tarif_per_kg: 8000, etd: '1-2 hari' },
        { id: 3, kota: 'Sidoarjo', tarif_per_kg: 9000, etd: '1-2 hari' },
        { id: 4, kota: 'Malang', tarif_per_kg: 12000, etd: '2-3 hari' },
        { id: 5, kota: 'Jakarta', tarif_per_kg: 18000, etd: '2-4 hari' },
        { id: 6, kota: 'Bandung', tarif_per_kg: 19000, etd: '2-4 hari' },
      ],
      settings: [
        { key: 'nama_toko', value: 'DINI MENGANTI' },
        { key: 'wa_toko', value: '6281945507050' },
        { key: 'alamat_toko', value: 'Menganti, Gresik' },
        { key: 'hp_toko', value: '081945507050' },
        { key: 'origin_id', value: '' },
        { key: 'origin_nama', value: 'Menganti, Gresik' },
        { key: 'tarif_default_per_kg', value: '15000' },
      ],
    };
  }
  function svgFoto(emoji, txt) {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#fdeee9"/><text x="150" y="165" font-size="120" text-anchor="middle" dominant-baseline="middle">${emoji}</text><text x="150" y="270" font-size="20" fill="#c2441f" text-anchor="middle" font-family="Arial">${String(txt).slice(0, 24)}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }

  let DB;
  const load = () => { try { DB = JSON.parse(localStorage.getItem(KEY)); } catch { DB = null; } if (!DB) { DB = seed(); save(); } upgrade(); return DB; };
  // ganti nilai bawaan lama (data demo yang sudah tersimpan di browser)
  const upgrade = () => { let ch = false; for (const [k, lama, baru] of [['wa_toko', '6281234567890', '6281945507050'], ['hp_toko', '081234567890', '081945507050']]) { const r = DB.settings.find(x => x.key === k); if (r && r.value === lama) { r.value = baru; ch = true; } } if (ch) save(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { throw new Error('Penyimpanan browser penuh (foto terlalu besar?)'); } };
  const session = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } };
  const me = () => { const s = session(); return s ? DB.profiles.find(p => p.id === s.user.id) : null; };
  const isAdmin = () => me()?.role === 'admin';
  const err = m => ({ data: null, error: { message: m } });
  const clone = x => JSON.parse(JSON.stringify(x));

  /* ---------- query builder ---------- */
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.one = null; }
    select(cols = '*') { if (this.op === 'select') this.cols = cols; this.ret = true; return this; }
    eq(c, v) { this.f.push(r => r[c] === v); return this; }
    in(c, a) { this.f.push(r => a.includes(r[c])); return this; }
    is(c, v) { this.f.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    insert(r) { this.op = 'insert'; this.payload = r; return this; }
    update(r) { this.op = 'update'; this.payload = r; return this; }
    upsert(r, o = {}) { this.op = 'upsert'; this.payload = r; this.conf = o.onConflict; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { try { res(this.exec()); } catch (e) { res(err(e.message)); } }
    exec() {
      load();
      const T = DB[this.t]; if (!T) return err('Tabel tidak ada: ' + this.t);
      const pk = PK[this.t] || 'id';
      const match = r => this.f.every(fn => fn(r));
      const adminOnly = ['products', 'rewards', 'tarif_manual', 'settings'];
      if (this.op !== 'select') {
        if (adminOnly.includes(this.t) && !isAdmin()) return err('Hanya admin');
        if (this.t === 'orders' && !isAdmin()) return err('Hanya admin');
      }
      if (this.op === 'insert') {
        const rows = [].concat(this.payload).map(r => { const n = { ...r }; if (pk === 'id' && n.id == null) n.id = DB.seq[this.t]++; n.created_at = n.created_at || now(); return n; });
        T.push(...rows); save(); return { data: clone(rows), error: null };
      }
      if (this.op === 'upsert') {
        const k = this.conf || pk;
        for (const r of [].concat(this.payload)) {
          const ex = T.find(x => x[k] === r[k]);
          if (ex) Object.assign(ex, r); else { const n = { ...r }; if (pk === 'id' && n.id == null) n.id = DB.seq[this.t]++; T.push(n); }
        }
        save(); return { data: null, error: null };
      }
      if (this.op === 'update') {
        const rows = T.filter(match);
        for (const r of rows) {
          const p = { ...this.payload };
          if (this.t === 'profiles') {
            if (!isAdmin()) { if (r.id !== session()?.user.id) continue; delete p.role; delete p.poin; }
          }
          Object.assign(r, p);
        }
        save(); return { data: clone(rows), error: null };
      }
      if (this.op === 'delete') {
        const used = this.t === 'products' ? DB.orders.some(o => o.items.some(i => T.filter(match).some(p => p.id === i.id)))
          : this.t === 'rewards' ? DB.redemptions.some(d => T.filter(match).some(r => r.id === d.reward_id)) : false;
        if (used) return err('Data sudah dipakai di pesanan/penukaran — nonaktifkan saja');
        DB[this.t] = T.filter(r => !match(r)); save(); return { data: null, error: null };
      }
      // select (dengan "RLS" sederhana)
      let rows = T.filter(match);
      const s = session();
      if (['orders', 'point_logs', 'redemptions'].includes(this.t) && !isAdmin()) rows = rows.filter(r => r.member_id === s?.user.id);
      if (this.t === 'profiles' && !isAdmin()) rows = rows.filter(r => r.id === s?.user.id);
      rows = clone(rows);
      if (this.cols && this.cols.includes('profiles(')) rows.forEach(r => { const p = DB.profiles.find(x => x.id === r.member_id); r.profiles = p ? { nama: p.nama, no_hp: p.no_hp, poin: p.poin } : null; });
      if (this.ord) { const [c, asc] = this.ord; rows.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.lim) rows = rows.slice(0, this.lim);
      if (this.one) { if (!rows.length && this.one === 'single') return err('Data tidak ditemukan'); return { data: rows[0] || null, error: null }; }
      return { data: rows, error: null };
    }
  }

  /* ---------- RPC (logika sama dengan fungsi SQL) ---------- */
  const log = (member_id, delta, saldo, ket) => DB.point_logs.push({ id: DB.seq.point_logs++, member_id, delta, saldo_akhir: saldo, keterangan: ket || '', oleh: session()?.user.id, created_at: now() });
  const RPC = {
    create_order({ p_items, p_kirim }) {
      const s = session(); if (!s) throw new Error('Silakan login');
      if (!p_items.length) throw new Error('Keranjang kosong');
      let sub = 0, berat = 0; const items = [];
      for (const it of p_items) {
        const p = DB.products.find(x => x.id === it.id && x.aktif); const q = Math.max(1, +it.qty);
        if (!p) throw new Error('Produk tidak tersedia');
        if (p.stok < q) throw new Error(`Stok ${p.nama} tidak cukup (sisa ${p.stok})`);
      }
      for (const it of p_items) {
        const p = DB.products.find(x => x.id === it.id); const q = Math.max(1, +it.qty);
        p.stok -= q; items.push({ id: p.id, nama: p.nama, harga: p.harga, qty: q, berat: p.berat_gram });
        sub += p.harga * q; berat += p.berat_gram * q;
      }
      const d = new Date(), kode = 'ORD' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      const ongkir = +p_kirim.ongkir || 0;
      const o = { id: DB.seq.orders++, kode, member_id: s.user.id, items, subtotal: sub, berat_gram: berat, kurir: 'J&T', layanan: p_kirim.layanan || 'EZ', ongkir, etd: p_kirim.etd || '', total: sub + ongkir,
        penerima_nama: p_kirim.nama, penerima_hp: p_kirim.hp, penerima_alamat: p_kirim.alamat, penerima_kota: p_kirim.kota || '', penerima_kecamatan: p_kirim.kecamatan || '', penerima_kodepos: p_kirim.kodepos || '',
        tujuan_id: p_kirim.tujuan_id || '', catatan: p_kirim.catatan || '', status: 'menunggu', resi: '', dicetak_at: null, created_at: now() };
      DB.orders.push(o);
      setTimeout(() => localStorage.setItem(EKEY, JSON.stringify({ t: Date.now(), order: o })), 0);
      return kode;
    },
    cancel_order({ p_id }) {
      const o = DB.orders.find(x => x.id === p_id); if (!o) throw new Error('Pesanan tidak ditemukan');
      if (o.member_id !== session()?.user.id && !isAdmin()) throw new Error('Tidak diizinkan');
      if (!['menunggu', 'dikonfirmasi'].includes(o.status)) throw new Error('Pesanan sudah dikirim');
      o.items.forEach(i => { const p = DB.products.find(x => x.id === i.id); if (p) p.stok += i.qty; });
      o.status = 'batal';
    },
    admin_adjust_points({ p_member, p_delta, p_ket }) {
      if (!isAdmin()) throw new Error('Hanya admin');
      const p = DB.profiles.find(x => x.id === p_member); if (!p) throw new Error('Member tidak ditemukan');
      if (p.poin + p_delta < 0) throw new Error('Saldo poin tidak boleh minus');
      p.poin += p_delta; log(p.id, p_delta, p.poin, p_ket); return p.poin;
    },
    redeem_reward({ p_reward }) {
      const r = DB.rewards.find(x => x.id === p_reward && x.aktif); if (!r) throw new Error('Hadiah tidak tersedia');
      if (r.stok <= 0) throw new Error('Stok hadiah habis');
      const p = me(); if (!p) throw new Error('Silakan login');
      if (p.poin < r.poin) throw new Error('Poin tidak cukup');
      p.poin -= r.poin; r.stok -= 1;
      const id = DB.seq.redemptions++;
      DB.redemptions.push({ id, member_id: p.id, reward_id: r.id, reward_nama: r.nama, poin: r.poin, status: 'menunggu', catatan_admin: '', created_at: now() });
      log(p.id, -r.poin, p.poin, 'Tukar hadiah: ' + r.nama); return id;
    },
    admin_process_redemption({ p_id, p_status, p_catatan }) {
      if (!isAdmin()) throw new Error('Hanya admin');
      const d = DB.redemptions.find(x => x.id === p_id);
      if (!d || d.status !== 'menunggu') throw new Error('Penukaran sudah diproses');
      d.status = p_status; d.catatan_admin = p_catatan || '';
      if (p_status === 'ditolak') {
        const p = DB.profiles.find(x => x.id === d.member_id); const r = DB.rewards.find(x => x.id === d.reward_id);
        p.poin += d.poin; if (r) r.stok += 1; log(p.id, d.poin, p.poin, 'Pengembalian poin (penukaran ditolak): ' + d.reward_nama);
      }
    },
  };

  /* ---------- auth ---------- */
  const listeners = [];
  const emit = ev => { const s = session(); listeners.forEach(fn => { try { fn(ev, s); } catch {} }); };
  const auth = {
    async getSession() { return { data: { session: session() }, error: null }; },
    onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email, password }) {
      load(); const u = DB.users.find(x => x.email.toLowerCase() === String(email).toLowerCase() && x.password === password);
      if (!u) return err('Invalid login credentials');
      const s = { user: { id: u.id, email: u.email } }; localStorage.setItem(SKEY, JSON.stringify(s)); emit('SIGNED_IN');
      return { data: { session: s, user: s.user }, error: null };
    },
    async signUp({ email, password, options }) {
      load(); if (DB.users.some(x => x.email.toLowerCase() === String(email).toLowerCase())) return err('Email sudah terdaftar');
      if (String(password).length < 6) return err('Password minimal 6 karakter');
      const id = uid(); DB.users.push({ id, email, password });
      const m = options?.data || {};
      DB.profiles.push({ id, nama: m.nama || '', no_hp: m.no_hp || '', alamat: '', kota: '', kecamatan: '', kodepos: '', role: 'member', poin: 0, created_at: now() });
      save();
      const s = { user: { id, email } }; localStorage.setItem(SKEY, JSON.stringify(s)); emit('SIGNED_IN');
      return { data: { session: s, user: s.user }, error: null };
    },
    async signOut() { localStorage.removeItem(SKEY); emit('SIGNED_OUT'); return { error: null }; },
    async resetPasswordForEmail() { return err('Mode demo: reset password belum tersedia'); },
    async updateUser({ password }) {
      load(); const u = DB.users.find(x => x.id === session()?.user.id); if (!u) return err('Silakan login');
      u.password = password; save(); return { data: {}, error: null };
    },
  };

  /* ---------- storage (foto diperkecil → data URL) ---------- */
  const shrink = file => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {
      const k = Math.min(1, 500 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.75)); };
      img.onerror = rej; img.src = fr.result; };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
  const storage = { from: () => ({
    async upload(path, file) { try { load(); DB.files[path] = await shrink(file); save(); return { data: { path }, error: null }; } catch (e) { return err(e.message || 'Upload gagal'); } },
    getPublicUrl(path) { load(); return { data: { publicUrl: DB.files[path] || '' } }; },
  }) };

  /* ---------- realtime antar-tab (admin & member di tab berbeda) ---------- */
  function channel() {
    let cb = null; const h = e => { if (e.key === EKEY && e.newValue && cb) { try { cb({ new: JSON.parse(e.newValue).order }); } catch {} } };
    const ch = { on(_t, _f, fn) { cb = fn; return ch; }, subscribe() { window.addEventListener('storage', h); return ch; }, _off() { window.removeEventListener('storage', h); } };
    return ch;
  }

  window.DemoDB = {
    createClient() {
      load();
      return {
        from: t => new Q(t),
        async rpc(name, args) { load(); try { const d = RPC[name](args || {}); save(); return { data: d ?? null, error: null }; } catch (e) { load(); return err(e.message); } },
        auth, storage,
        functions: { async invoke() { return { data: { ok: false, error: 'Mode demo: API ongkir belum aktif' }, error: null }; } },
        channel, removeChannel(ch) { ch?._off?.(); },
      };
    },
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); localStorage.removeItem('cart'); location.hash = '#/katalog'; location.reload(); },
  };

  // banner info demo
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof DEMO_MODE === 'undefined' || !DEMO_MODE) return;
    const b = document.createElement('div');
    b.style.cssText = 'background:#1f2430;color:#fff;font-size:12.5px;padding:6px 12px;text-align:center';
    b.innerHTML = 'MODE DEMO — data tersimpan di browser ini. Admin: <b>admin@demo.com / admin123</b> · Member: <b>member@demo.com / member123</b> · <a href="#" style="color:#fbbf24" onclick="if(confirm(\'Reset semua data demo?\'))DemoDB.reset();return false">Reset data demo</a>';
    document.body.prepend(b);
  });
})();
