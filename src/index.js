// =====================================================================
// Warung Sembako Dini — Cloudflare Worker API (D1 + KV)
//   /api/auth/*   login, daftar, ganti password (token HMAC, tanpa Supabase)
//   /api/db       baca/tulis tabel dengan aturan akses (pengganti RLS)
//   /api/rpc/*    proses bisnis: pesanan, poin, hadiah, reset password
//   /api/ongkir   cek ongkir / cari kota / lacak resi J&T (RajaOngkir Komerce)
//   /api/upload   upload foto & video (disimpan di KV)   →  /files/<path>
//   selain itu    file statis dari folder public/
// Binding wajib (wrangler.toml): DB (D1), FILES (KV), ASSETS (static)
// Secret: RAJAONGKIR_KEY (untuk ongkir otomatis J&T). JWT_SECRET opsional (bila kosong dibuat otomatis di KV)
// =====================================================================

const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h } });
const err = (message, s = 400) => json({ error: { message } }, s);
class HttpError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- crypto
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

async function hashPassword(pw, saltB64, iter = 10000) {   // 10rb iterasi: aman untuk batas CPU Worker gratis
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${b64(salt)}$${b64(bits)}`;
}
async function cekPassword(pw, stored) {
  if (!String(stored).startsWith('pbkdf2$')) return false;
  const [, iter, salt, hash] = String(stored).split('$');
  const h = await hashPassword(pw, salt, +iter);
  const a = h.split('$')[3], b = hash || '';
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// kunci tanda tangan sesi: secret JWT_SECRET bila diisi, kalau tidak dibuat acak sekali & disimpan di KV
let RAHASIA = null;
async function rahasia(env) {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 16) return env.JWT_SECRET;
  if (RAHASIA) return RAHASIA;
  let v = await env.FILES.get('__jwt_secret');
  if (!v) { v = b64(crypto.getRandomValues(new Uint8Array(48))); await env.FILES.put('__jwt_secret', v); }
  return (RAHASIA = v);
}
async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(await rahasia(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))));
}
const UMUR_SESI = 60 * 60 * 24 * 30; // 30 hari
async function buatSesi(env, user) {
  const exp = Math.floor(Date.now() / 1000) + UMUR_SESI;
  const body = b64url(JSON.stringify({ sub: user.id, ver: user.pw_ver, exp }));
  return { access_token: `${body}.${await hmac(env, body)}`, expires_at: exp, user: { id: user.id, email: user.email } };
}
async function bacaSesi(req, env) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t.includes('.')) return null;
  const [body, sig] = t.split('.');
  if (sig !== await hmac(env, body)) return null;
  let p; try { p = JSON.parse(unb64url(body)); } catch { return null; }
  if (!p.exp || p.exp < Date.now() / 1000) return null;
  const u = await env.DB.prepare('SELECT a.id, a.email, a.pw_ver, p.role FROM auth_users a LEFT JOIN profiles p ON p.id = a.id WHERE a.id = ?').bind(p.sub).first();
  if (!u || u.pw_ver !== p.ver) return null;
  return { id: u.id, email: u.email, role: u.role || 'member', admin: u.role === 'admin' };
}

// ---------------------------------------------------------------- tabel & aturan akses (pengganti RLS)
// read:  'public' (semua), 'aktif' (publik hanya yg aktif), 'own:<kolom>' (pemilik), 'admin'
// write: 'admin' | 'own' | 'none'
const TABEL = {
  profiles:     { read: 'own:id',        insert: 'none',  update: 'own:id', del: 'none',  bool: ['wajib_ganti_pw', 'boleh_dp'], kunci: ['id', 'role', 'poin', 'boleh_dp', 'email', 'created_at'] },
  products:     { read: 'aktif',         insert: 'admin', update: 'admin',  del: 'admin', bool: ['aktif'] },
  orders:       { read: 'own:member_id', insert: 'none',  update: 'admin',  del: 'none',  json: ['items'] },
  point_logs:   { read: 'own:member_id', insert: 'none',  update: 'none',   del: 'none' },
  rewards:      { read: 'aktif',         insert: 'admin', update: 'admin',  del: 'admin', bool: ['aktif'] },
  redemptions:  { read: 'own:member_id', insert: 'none',  update: 'none',   del: 'none' },
  tarif_manual: { read: 'public',        insert: 'admin', update: 'admin',  del: 'admin', pk: 'kota' },
  settings:     { read: 'public',        insert: 'admin', update: 'admin',  del: 'admin', pk: 'key' },
  popups:       { read: 'aktif',         insert: 'admin', update: 'admin',  del: 'admin', bool: ['aktif'] },
};
const KOLOM = {};
async function kolom(env, t) {
  if (!KOLOM[t]) KOLOM[t] = (await env.DB.prepare(`PRAGMA table_info(${t})`).all()).results.map(c => c.name);
  return KOLOM[t];
}
const ID = /^[a-z_][a-z0-9_]*$/;
function encodeVal(cfg, k, v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
function decodeRow(cfg, r) {
  if (!r) return r;
  for (const k of cfg.bool || []) if (k in r && r[k] !== null) r[k] = !!r[k];
  for (const k of cfg.json || []) if (typeof r[k] === 'string') { try { r[k] = JSON.parse(r[k]); } catch {} }
  return r;
}

async function apiDb(req, env, user) {
  const q = await req.json();
  const cfg = TABEL[q.table];
  if (!cfg) throw new HttpError('Tabel tidak dikenal');
  const cols = await kolom(env, q.table);
  const cek = c => { if (!ID.test(c) || !cols.includes(c)) throw new HttpError(`Kolom tidak dikenal: ${c}`); return c; };
  const admin = !!user?.admin;

  // ---------- filter dari klien
  const where = [], args = [];
  for (const f of q.filters || []) {
    const c = `t.${cek(f.col)}`;
    const v = encodeVal(cfg, f.col, f.val);
    switch (f.op) {
      case 'eq':  where.push(`${c} = ?`);  args.push(v); break;
      case 'neq': where.push(`${c} <> ?`); args.push(v); break;
      case 'gt':  where.push(`${c} > ?`);  args.push(v); break;
      case 'gte': where.push(`${c} >= ?`); args.push(v); break;
      case 'lt':  where.push(`${c} < ?`);  args.push(v); break;
      case 'lte': where.push(`${c} <= ?`); args.push(v); break;
      case 'in': {
        const arr = Array.isArray(f.val) ? f.val : [];
        if (!arr.length) { where.push('0'); break; }
        where.push(`${c} IN (${arr.map(() => '?').join(',')})`); args.push(...arr.map(x => encodeVal(cfg, f.col, x))); break;
      }
      case 'is':  where.push(f.val === null ? `${c} IS NULL` : `${c} = ?`); if (f.val !== null) args.push(v); break;
      default: throw new HttpError('Filter tidak didukung');
    }
  }
  // ---------- aturan akses baris
  const aturanBaca = () => {
    if (admin) return;
    if (cfg.read === 'public') return;
    if (cfg.read === 'aktif') { where.push('t.aktif = 1'); return; }
    if (cfg.read.startsWith('own:')) { if (!user) where.push('0'); else { where.push(`t.${cfg.read.slice(4)} = ?`); args.push(user.id); } return; }
    where.push('0');
  };
  const izinTulis = rule => {
    if (rule === 'admin') { if (!admin) throw new HttpError('Hanya admin', 403); return; }
    if (rule.startsWith('own:')) {
      if (!user) throw new HttpError('Silakan login', 401);
      if (!admin) { where.push(`t.${rule.slice(4)} = ?`); args.push(user.id); }
      return;
    }
    throw new HttpError('Tidak diizinkan', 403);
  };
  const W = () => where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const bersihkan = obj => {
    const o = {};
    for (const [k, v] of Object.entries(obj || {})) {
      cek(k);
      if (!admin && cfg.kunci?.includes(k)) continue;   // kolom terlindungi (role, poin, akses DP, email)
      o[k] = encodeVal(cfg, k, v);
    }
    return o;
  };

  if (q.op === 'select') {
    aturanBaca();
    // kolom & relasi profiles(nama,no_hp,…)
    let sel = [], join = '', embed = null;
    const raw = String(q.select || '*');
    const m = raw.match(/profiles\(([^)]*)\)/);
    for (const part of raw.replace(/,?\s*profiles\([^)]*\)/, '').split(',').map(s => s.trim()).filter(Boolean)) {
      sel.push(part === '*' ? 't.*' : `t.${cek(part)}`);
    }
    if (!sel.length) sel.push('t.*');
    if (m) {
      if (!cols.includes('member_id')) throw new HttpError('Relasi tidak didukung');
      const pc = await kolom(env, 'profiles');
      embed = m[1].split(',').map(s => s.trim()).filter(c => ['nama', 'no_hp', 'poin', 'email', 'kota'].includes(c) && pc.includes(c));
      join = ' LEFT JOIN profiles pr ON pr.id = t.member_id';
      sel.push(...embed.map(c => `pr.${c} AS __pr_${c}`));
    }
    let sql = `SELECT ${sel.join(', ')} FROM ${q.table} t${join}${W()}`;
    if (q.order?.length) sql += ' ORDER BY ' + q.order.map(o => `t.${cek(o.col)} ${o.asc === false ? 'DESC' : 'ASC'}`).join(', ');
    if (q.limit) { sql += ' LIMIT ?'; args.push(Math.min(+q.limit || 0, 5000)); }
    const rows = (await env.DB.prepare(sql).bind(...args).all()).results.map(r => {
      if (embed) { r.profiles = {}; for (const c of embed) { r.profiles[c] = r[`__pr_${c}`]; delete r[`__pr_${c}`]; } }
      return decodeRow(cfg, r);
    });
    return rows;
  }

  if (q.op === 'insert' || q.op === 'upsert') {
    izinTulis(cfg.insert);
    const list = (Array.isArray(q.values) ? q.values : [q.values]).map(bersihkan);
    const stmts = list.map(o => {
      const ks = Object.keys(o);
      if (!ks.length) throw new HttpError('Data kosong');
      let sql = `INSERT INTO ${q.table} (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`;
      if (q.op === 'upsert') {
        const pk = q.onConflict ? cek(q.onConflict) : (cfg.pk || 'id');
        const up = ks.filter(k => k !== pk);
        sql += up.length ? ` ON CONFLICT(${pk}) DO UPDATE SET ${up.map(k => `${k} = excluded.${k}`).join(', ')}` : ` ON CONFLICT(${pk}) DO NOTHING`;
      }
      return env.DB.prepare(sql + ' RETURNING *').bind(...ks.map(k => o[k]));
    });
    const res = await env.DB.batch(stmts);
    return res.flatMap(r => r.results || []).map(r => decodeRow(cfg, r));
  }

  if (q.op === 'update') {
    izinTulis(cfg.update);
    if (!(q.filters || []).length) throw new HttpError('Update wajib pakai filter');
    const o = bersihkan(q.values);
    const ks = Object.keys(o);
    if (!ks.length) return [];
    const sql = `UPDATE ${q.table} AS t SET ${ks.map(k => `${k} = ?`).join(', ')}${W()} RETURNING *`;
    const rows = (await env.DB.prepare(sql).bind(...ks.map(k => o[k]), ...args).all()).results;
    return rows.map(r => decodeRow(cfg, r));
  }

  if (q.op === 'delete') {
    izinTulis(cfg.del);
    if (!(q.filters || []).length) throw new HttpError('Hapus wajib pakai filter');
    await env.DB.prepare(`DELETE FROM ${q.table} AS t${W()}`).bind(...args).run();
    return [];
  }
  throw new HttpError('Operasi tidak dikenal');
}

// ---------------------------------------------------------------- RPC (proses bisnis)
const wajibLogin = u => { if (!u) throw new HttpError('Silakan login', 401); };
const wajibAdmin = u => { if (!u?.admin) throw new HttpError('Hanya admin', 403); };
const setting = async (env, k) => (await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first())?.value ?? null;
const tglJakarta = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.toISOString().slice(2, 10).replace(/-/g, ''); };

const RPC = {
  async create_order(env, u, { p_items, p_kirim = {} }) {
    wajibLogin(u);
    if (!Array.isArray(p_items) || !p_items.length) throw new HttpError('Keranjang kosong');
    const metode = p_kirim.metode_bayar === 'transfer' ? 'transfer' : 'qris';
    const dp = parseInt(p_kirim.dp_persen || 0, 10) || 0;
    if (![0, 10, 20, 30, 40, 50].includes(dp)) throw new HttpError('Pilihan DP tidak valid');
    const prof = await env.DB.prepare('SELECT poin, boleh_dp FROM profiles WHERE id = ?').bind(u.id).first();
    if (!prof) throw new HttpError('Profil tidak ditemukan');
    if (dp > 0 && !prof.boleh_dp) throw new HttpError('Fitur DP belum diaktifkan untuk akun Anda. Hubungi admin toko.');

    const stmts = [env.DB.prepare(`UPDATE counters SET value = value + 1 WHERE name = 'order_kode'`)];
    const items = []; let sub = 0, berat = 0;
    const butuh = {};
    for (const it of [...p_items].sort((a, b) => a.id - b.id)) {
      const qty = Math.max(parseInt(it.qty, 10) || 1, 1);
      let sat = String(it.satuan || 'pack').toLowerCase();
      const pr = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND aktif = 1').bind(+it.id).first();
      if (!pr) throw new HttpError('Produk tidak tersedia');
      let isi, harga;
      if (sat === 'slof') { isi = pr.isi_slof; harga = pr.harga_slof; }
      else if (sat === 'ball') { isi = pr.isi_ball; harga = pr.harga_ball; }
      else { sat = 'pack'; isi = 1; harga = pr.harga; }
      if (!harga || harga <= 0) throw new HttpError(`${pr.nama} tidak dijual per ${sat.toUpperCase()}`);
      butuh[pr.id] = (butuh[pr.id] || 0) + qty * isi;
      if (pr.stok < butuh[pr.id]) throw new HttpError(`Stok ${pr.nama} tidak cukup (sisa ${pr.stok} pack)`);
      stmts.push(env.DB.prepare('UPDATE products SET stok = stok - ? WHERE id = ?').bind(qty * isi, pr.id));
      items.push({ id: pr.id, nama: pr.nama, satuan: sat, isi, harga, qty, berat: pr.berat_gram * isi });
      sub += harga * qty; berat += pr.berat_gram * isi * qty;
    }
    const ongkir = Math.max(parseInt(p_kirim.ongkir || 0, 10) || 0, 0);

    // tukar poin jadi potongan harga: 1 poin = Rp1, minimal belanja, semua poin dipakai
    let poin = 0;
    if (p_kirim.pakai_poin === true || p_kirim.pakai_poin === 'true') {
      if ((await setting(env, 'poin_potongan_aktif')) !== '1') throw new HttpError('Program tukar poin sedang tidak aktif');
      const min = parseInt(await setting(env, 'poin_min_belanja'), 10) || 100000;
      if (sub < min) throw new HttpError(`Tukar poin hanya untuk belanja minimal Rp${min.toLocaleString('id-ID')}`);
      poin = Math.min(prof.poin || 0, sub + ongkir);
    }
    const total = sub + ongkir - poin;
    const dpNominal = dp > 0 ? Math.ceil(total * dp / 100 / 100) * 100 : 0;
    const K = `(SELECT 'ORD' || ? || printf('%05d', value % 100000) FROM counters WHERE name = 'order_kode')`;
    const tg = tglJakarta();
    stmts.push(env.DB.prepare(`INSERT INTO orders (kode, member_id, items, subtotal, berat_gram, layanan, ongkir, etd, total,
        penerima_nama, penerima_hp, penerima_alamat, penerima_kota, penerima_kecamatan, penerima_kodepos, tujuan_id, catatan,
        metode_bayar, dp_persen, dp_nominal, poin_dipakai, potongan_poin)
      VALUES (${K}, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?)`).bind(tg, u.id, JSON.stringify(items), sub, berat,
      String(p_kirim.layanan || 'EZ'), ongkir, String(p_kirim.etd || ''), total,
      String(p_kirim.nama || ''), String(p_kirim.hp || ''), String(p_kirim.alamat || ''), String(p_kirim.kota || ''),
      String(p_kirim.kecamatan || ''), String(p_kirim.kodepos || ''), String(p_kirim.tujuan_id || ''), String(p_kirim.catatan || ''),
      metode, dp, dpNominal, poin, poin));
    if (poin > 0) {
      stmts.push(env.DB.prepare('UPDATE profiles SET poin = poin - ? WHERE id = ?').bind(poin, u.id));
      stmts.push(env.DB.prepare(`INSERT INTO point_logs (member_id, delta, saldo_akhir, keterangan, oleh)
        SELECT ?, ?, poin, 'Tukar poin jadi potongan harga pesanan ' || ${K}, ? FROM profiles WHERE id = ?`).bind(u.id, -poin, tg, u.id, u.id));
    }
    stmts.push(env.DB.prepare(`SELECT ${K} AS kode`).bind(tg));
    const res = await env.DB.batch(stmts);
    return res[res.length - 1].results[0].kode;
  },

  async cancel_order(env, u, { p_id }) {
    wajibLogin(u);
    const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(+p_id).first();
    if (!o) throw new HttpError('Pesanan tidak ditemukan');
    if (o.member_id !== u.id && !u.admin) throw new HttpError('Tidak diizinkan', 403);
    if (!['menunggu', 'dikonfirmasi'].includes(o.status)) throw new HttpError('Pesanan sudah dikirim');
    const stmts = [env.DB.prepare('INSERT INTO proses_sekali (ref) VALUES (?)').bind(`batal:${o.id}`)];
    for (const it of JSON.parse(o.items || '[]')) {
      stmts.push(env.DB.prepare('UPDATE products SET stok = stok + ? WHERE id = ?').bind((+it.qty || 0) * (+it.isi || 1), +it.id));
    }
    if (o.poin_dipakai > 0) {
      stmts.push(env.DB.prepare('UPDATE profiles SET poin = poin + ? WHERE id = ?').bind(o.poin_dipakai, o.member_id));
      stmts.push(env.DB.prepare(`INSERT INTO point_logs (member_id, delta, saldo_akhir, keterangan, oleh)
        SELECT ?, ?, poin, ?, ? FROM profiles WHERE id = ?`).bind(o.member_id, o.poin_dipakai, `Poin dikembalikan, pesanan ${o.kode} dibatalkan`, u.id, o.member_id));
    }
    stmts.push(env.DB.prepare(`UPDATE orders SET status = 'batal' WHERE id = ?`).bind(o.id));
    await env.DB.batch(stmts);
    return null;
  },

  async redeem_reward(env, u, { p_reward }) {
    wajibLogin(u);
    const r = await env.DB.prepare('SELECT * FROM rewards WHERE id = ? AND aktif = 1').bind(+p_reward).first();
    if (!r) throw new HttpError('Hadiah tidak tersedia');
    if (r.stok <= 0) throw new HttpError('Stok hadiah habis');
    const p = await env.DB.prepare('SELECT poin FROM profiles WHERE id = ?').bind(u.id).first();
    if (!p || p.poin < r.poin) throw new HttpError('Poin tidak cukup');
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE profiles SET poin = poin - ? WHERE id = ?').bind(r.poin, u.id),
      env.DB.prepare('UPDATE rewards SET stok = stok - 1 WHERE id = ?').bind(r.id),
      env.DB.prepare('INSERT INTO redemptions (member_id, reward_id, reward_nama, poin) VALUES (?,?,?,?) RETURNING id').bind(u.id, r.id, r.nama, r.poin),
      env.DB.prepare(`INSERT INTO point_logs (member_id, delta, saldo_akhir, keterangan, oleh) SELECT ?, ?, poin, ?, ? FROM profiles WHERE id = ?`)
        .bind(u.id, -r.poin, `Tukar hadiah: ${r.nama}`, u.id, u.id),
    ]);
    return res[2].results[0].id;
  },

  async admin_process_redemption(env, u, { p_id, p_status, p_catatan }) {
    wajibAdmin(u);
    const d = await env.DB.prepare('SELECT * FROM redemptions WHERE id = ?').bind(+p_id).first();
    if (!d || d.status !== 'menunggu') throw new HttpError('Penukaran sudah diproses');
    if (!['disetujui', 'ditolak'].includes(p_status)) throw new HttpError('Status tidak valid');
    const stmts = [
      env.DB.prepare('INSERT INTO proses_sekali (ref) VALUES (?)').bind(`tukar:${d.id}`),
      env.DB.prepare('UPDATE redemptions SET status = ?, catatan_admin = ? WHERE id = ?').bind(p_status, String(p_catatan || ''), d.id),
    ];
    if (p_status === 'ditolak') {
      stmts.push(env.DB.prepare('UPDATE profiles SET poin = poin + ? WHERE id = ?').bind(d.poin, d.member_id));
      stmts.push(env.DB.prepare('UPDATE rewards SET stok = stok + 1 WHERE id = ?').bind(d.reward_id));
      stmts.push(env.DB.prepare(`INSERT INTO point_logs (member_id, delta, saldo_akhir, keterangan, oleh) SELECT ?, ?, poin, ?, ? FROM profiles WHERE id = ?`)
        .bind(d.member_id, d.poin, `Pengembalian poin (penukaran ditolak): ${d.reward_nama}`, u.id, d.member_id));
    }
    await env.DB.batch(stmts);
    return null;
  },

  async admin_adjust_points(env, u, { p_member, p_delta, p_ket }) {
    wajibAdmin(u);
    const delta = parseInt(p_delta, 10);
    if (!delta) throw new HttpError('Jumlah poin tidak valid');
    const p = await env.DB.prepare('SELECT poin FROM profiles WHERE id = ?').bind(p_member).first();
    if (!p) throw new HttpError('Member tidak ditemukan');
    if (p.poin + delta < 0) throw new HttpError('Saldo poin tidak boleh minus');
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE profiles SET poin = poin + ? WHERE id = ? RETURNING poin').bind(delta, p_member),
      env.DB.prepare(`INSERT INTO point_logs (member_id, delta, saldo_akhir, keterangan, oleh) SELECT ?, ?, poin, ?, ? FROM profiles WHERE id = ?`)
        .bind(p_member, delta, String(p_ket || ''), u.id, p_member),
    ]);
    return res[0].results[0].poin;
  },

  async admin_reset_password(env, u, { p_member }) {
    wajibAdmin(u);
    if (p_member === u.id) throw new HttpError('Gunakan menu Ganti password untuk akun sendiri');
    const ada = await env.DB.prepare('SELECT id FROM auth_users WHERE id = ?').bind(p_member).first();
    if (!ada) throw new HttpError('Member tidak ditemukan');
    const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const acak = crypto.getRandomValues(new Uint8Array(8));
    const pw = [...acak].map(x => huruf[x % huruf.length]).join('');
    await env.DB.batch([
      env.DB.prepare('UPDATE auth_users SET pass_hash = ?, pw_ver = pw_ver + 1 WHERE id = ?').bind(await hashPassword(pw), p_member),
      env.DB.prepare('UPDATE profiles SET wajib_ganti_pw = 1 WHERE id = ?').bind(p_member),
    ]);
    return pw;
  },

  async admin_email_member(env, u, { p_member }) {
    wajibAdmin(u);
    return (await env.DB.prepare('SELECT email FROM auth_users WHERE id = ?').bind(p_member).first())?.email || null;
  },
};

// ---------------------------------------------------------------- auth
async function apiAuth(path, req, env) {
  if (path === 'signup' && req.method === 'POST') {
    const { email, password, nama, no_hp } = await req.json();
    const em = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(em)) throw new HttpError('Email tidak valid');
    if (String(password || '').length < 6) throw new HttpError('Password minimal 6 karakter');
    if (await env.DB.prepare('SELECT 1 FROM auth_users WHERE email = ?').bind(em).first()) throw new HttpError('Email sudah terdaftar');
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO auth_users (id, email, pass_hash) VALUES (?,?,?)').bind(id, em, await hashPassword(password)),
      env.DB.prepare('INSERT INTO profiles (id, nama, no_hp, email) VALUES (?,?,?,?)').bind(id, String(nama || '').trim(), String(no_hp || '').trim(), em),
    ]);
    return { user: { id, email: em }, session: await buatSesi(env, { id, email: em, pw_ver: 1 }) };
  }
  if (path === 'login' && req.method === 'POST') {
    const { email, password } = await req.json();
    const u = await env.DB.prepare('SELECT * FROM auth_users WHERE email = ?').bind(String(email || '').trim().toLowerCase()).first();
    if (u && u.pass_hash === 'legacy') throw new HttpError('Akun Anda sudah dipindah ke sistem baru. Klik "Lupa password?" lalu minta password baru ke admin lewat WhatsApp.');
    if (!u || !(await cekPassword(String(password || ''), u.pass_hash))) throw new HttpError('Invalid login credentials');
    const session = await buatSesi(env, u);
    return { user: session.user, session };
  }
  if (path === 'password' && req.method === 'POST') {
    const u = await bacaSesi(req, env); wajibLogin(u);
    const { password } = await req.json();
    if (String(password || '').length < 6) throw new HttpError('Password minimal 6 karakter');
    const r = await env.DB.prepare('UPDATE auth_users SET pass_hash = ?, pw_ver = pw_ver + 1 WHERE id = ? RETURNING id, email, pw_ver')
      .bind(await hashPassword(password), u.id).first();
    const session = await buatSesi(env, r);
    return { user: session.user, session };
  }
  if (path === 'user') {
    const u = await bacaSesi(req, env);
    if (!u) throw new HttpError('Sesi berakhir, silakan masuk lagi', 401);
    return { user: { id: u.id, email: u.email } };
  }
  throw new HttpError('Tidak ditemukan', 404);
}

// ---------------------------------------------------------------- ongkir J&T (RajaOngkir Komerce)
const RO = 'https://rajaongkir.komerce.id/api/v1';
async function apiOngkir(req, env) {
  const key = env.RAJAONGKIR_KEY;
  if (!key) return { ok: false, error: 'RAJAONGKIR_KEY belum diset' };
  const body = await req.json();
  if (body.action === 'search') {
    const q = String(body.q || '').trim();
    if (q.length < 3) return { ok: true, data: [] };
    const r = await fetch(`${RO}/destination/domestic-destination?search=${encodeURIComponent(q)}&limit=10&offset=0`, { headers: { key } });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, data: d.data || [], error: r.ok ? null : d?.meta?.message };
  }
  if (body.action === 'cost') {
    const form = new URLSearchParams({ origin: String(body.origin), destination: String(body.destination), weight: String(Math.max(1, Math.round(body.weight || 1000))), courier: 'jnt', price: 'lowest' });
    const r = await fetch(`${RO}/calculate/domestic-cost`, { method: 'POST', headers: { key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, data: (d.data || []).map(x => ({ service: x.service, description: x.description, cost: x.cost, etd: x.etd })), error: r.ok ? null : d?.meta?.message };
  }
  if (body.action === 'track') {
    const awb = String(body.awb || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{6,30}$/.test(awb)) return { ok: false, error: 'Nomor resi tidak valid' };
    const qs = new URLSearchParams({ awb, courier: 'jnt' });
    const r = await fetch(`${RO}/track/waybill?${qs}`, { method: 'POST', headers: { key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && !!d?.data, data: d?.data || null, error: r.ok ? null : d?.meta?.message || `HTTP ${r.status}` };
  }
  return { ok: false, error: 'action tidak dikenal' };
}

// ---------------------------------------------------------------- file (foto / video) di KV
const MAKS_FILE = 24 * 1024 * 1024; // batas KV 25 MB per file
const amanPath = p => String(p || '').replace(/^\/+/, '').replace(/[^A-Za-z0-9._\/-]/g, '_').replace(/\.\.+/g, '.');
async function simpanFile(env, path, body, type) {
  if (body.byteLength > MAKS_FILE) throw new HttpError('File terlalu besar (maks. 24 MB)');
  await env.FILES.put(path, body, { metadata: { type: type || 'application/octet-stream' } });
  return `/files/${path}`;
}
async function apiUpload(req, env, u) {
  wajibAdmin(u);
  const path = amanPath(new URL(req.url).searchParams.get('path')).replace(/^_+/, '');
  if (!path) throw new HttpError('Path kosong');
  const body = await req.arrayBuffer();
  return { path, publicUrl: await simpanFile(env, path, body, req.headers.get('Content-Type')) };
}
async function serveFile(req, env, path) {
  if (!path || path.startsWith('__')) return new Response('Tidak ditemukan', { status: 404 });   // kunci internal tidak boleh dibaca
  const { value, metadata } = await env.FILES.getWithMetadata(path, { type: 'arrayBuffer' });
  if (!value) return new Response('Tidak ditemukan', { status: 404 });
  const type = metadata?.type || 'application/octet-stream', size = value.byteLength;
  const h = { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' };
  const range = req.headers.get('Range');
  const m = range && range.match(/bytes=(\d*)-(\d*)/);
  if (m) {   // dukung Range agar video MP4 bisa diputar di iPhone/Safari
    let a = m[1] === '' ? size - (+m[2]) : +m[1], b = m[1] !== '' && m[2] !== '' ? +m[2] : size - 1;
    a = Math.max(0, a); b = Math.min(size - 1, b);
    return new Response(value.slice(a, b + 1), { status: 206, headers: { ...h, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1) } });
  }
  return new Response(value, { headers: { ...h, 'Content-Length': String(size) } });
}
// pindahkan foto/video lama (URL luar, mis. Supabase) ke penyimpanan KV sendiri
async function apiImportFoto(env, u) {
  wajibAdmin(u);
  const hasil = { dipindah: 0, gagal: [] };
  const sumber = [
    ...(await env.DB.prepare(`SELECT 'products' t, id, 'foto_url' c, foto_url url FROM products WHERE foto_url LIKE 'http%'
      UNION ALL SELECT 'rewards', id, 'foto_url', foto_url FROM rewards WHERE foto_url LIKE 'http%'
      UNION ALL SELECT 'popups', id, 'gambar_url', gambar_url FROM popups WHERE gambar_url LIKE 'http%'`).all()).results,
    ...(await env.DB.prepare(`SELECT 'settings' t, key id, 'value' c, value url FROM settings WHERE key IN ('logo_url','banner_url','qris_url','logo_url_lama') AND value LIKE 'http%'`).all()).results,
  ];
  hasil.sisa = Math.max(0, sumber.length - 40);   // batas subrequest Worker gratis: proses 40 file per klik
  for (const s of sumber.slice(0, 40)) {
    try {
      const r = await fetch(s.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const nama = amanPath(decodeURIComponent(new URL(s.url).pathname.split('/').slice(-2).join('/')));
      const url = await simpanFile(env, `impor/${nama}`, await r.arrayBuffer(), r.headers.get('Content-Type'));
      const kunci = s.t === 'settings' ? 'key' : 'id';
      if (s.t === 'settings' && s.id === 'logo_url_lama') {
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('logo_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(url),
          env.DB.prepare(`DELETE FROM settings WHERE key = 'logo_url_lama'`),
        ]);
      } else {
        await env.DB.prepare(`UPDATE ${s.t} SET ${s.c} = ? WHERE ${kunci} = ?`).bind(url, s.id).run();
      }
      hasil.dipindah++;
    } catch (e) { hasil.gagal.push(`${s.t} ${s.id}: ${e.message}`); }
  }
  return hasil;
}

// ---------------------------------------------------------------- pesan error D1 → bahasa manusia
function pesanD1(e) {
  const m = String(e?.message || e);
  if (/proses_sekali/.test(m)) return 'Sudah diproses sebelumnya';
  if (/CHECK constraint failed: stok/.test(m)) return 'Stok tidak cukup';
  if (/CHECK constraint failed: poin/.test(m)) return 'Poin tidak cukup';
  if (/status <> 'selesai'|status_bayar/.test(m)) return 'Pesanan belum lunas, tidak bisa diselesaikan';
  if (/UNIQUE constraint failed: tarif_manual\.kota/.test(m)) return 'Kota sudah ada';
  if (/UNIQUE constraint failed: auth_users\.email/.test(m)) return 'Email sudah terdaftar';
  if (/CHECK constraint failed/.test(m)) return 'Data tidak valid';
  return m.replace(/^D1_ERROR:\s*/, '');
}

// aplikasi Android (TWA) Warung Dini
const ASSETLINKS = [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'dev.workers.akmalulmizan27.dini_menganti.twa',
  sha256_cert_fingerprints: ['2E:F2:32:EC:1C:67:F5:7F:71:D9:43:2B:C6:BE:14:41:71:D4:E7:3E:68:65:D3:09:C0:B9:1F:25:0F:7B:5C:7F'] } }];

// ---------------------------------------------------------------- router
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/files/')) return await serveFile(req, env, decodeURIComponent(p.slice(7)));
      if (p === '/.well-known/assetlinks.json') return json(ASSETLINKS, 200, { 'Cache-Control': 'public, max-age=3600' });
      if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

      if (p.startsWith('/api/auth/')) return json(await apiAuth(p.slice(10), req, env));
      const user = await bacaSesi(req, env);
      if (!user && /^Bearer\s+\S/i.test(req.headers.get('Authorization') || '')) throw new HttpError('Sesi berakhir, silakan masuk lagi', 401);
      if (p === '/api/db' && req.method === 'POST') return json({ data: await apiDb(req, env, user) });
      if (p.startsWith('/api/rpc/') && req.method === 'POST') {
        const fn = RPC[p.slice(9)];
        if (!fn) throw new HttpError('Fungsi tidak dikenal', 404);
        return json({ data: await fn(env, user, await req.json().catch(() => ({}))) });
      }
      if (p === '/api/ongkir' && req.method === 'POST') return json(await apiOngkir(req, env));
      if (p === '/api/upload' && req.method === 'POST') return json({ data: await apiUpload(req, env, user) });
      if (p === '/api/import-foto' && req.method === 'POST') return json({ data: await apiImportFoto(env, user) });
      throw new HttpError('Tidak ditemukan', 404);
    } catch (e) {
      if (e instanceof HttpError) return err(e.message, e.status);
      console.error(e);
      return err(pesanD1(e), 400);
    }
  },
};
