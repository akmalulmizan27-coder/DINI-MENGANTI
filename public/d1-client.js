/* =====================================================================
   d1-client.js — klien kecil pengganti supabase-js untuk backend
   Cloudflare Worker + D1 (lihat src/index.js). API-nya dibuat mirip
   supabase-js supaya kode aplikasi (index.html) hampir tidak berubah:
     sb.from('tabel').select().eq().order().limit()…  sb.rpc()  sb.auth.*
     sb.storage.from('foto').upload()/getPublicUrl()  sb.functions.invoke()
     sb.channel().on('postgres_changes', {table:'orders', event:'INSERT'}, cb)  → polling 15 detik
   ===================================================================== */
(function () {
  const KUNCI_SESI = 'dini_sesi';
  const listeners = new Set();
  let sesi = null;
  try { sesi = JSON.parse(localStorage.getItem(KUNCI_SESI) || 'null'); } catch {}
  if (sesi && sesi.expires_at && sesi.expires_at < Date.now() / 1000) sesi = null;

  const simpanSesi = s => { sesi = s; try { s ? localStorage.setItem(KUNCI_SESI, JSON.stringify(s)) : localStorage.removeItem(KUNCI_SESI); } catch {} };
  const kabari = (ev, s) => listeners.forEach(cb => { try { cb(ev, s); } catch (e) { console.error(e); } });
  const errObj = (message, status) => ({ message: message || 'Terjadi kesalahan', status });

  async function panggil(url, body, opt = {}) {
    const headers = opt.headers || { 'Content-Type': 'application/json' };
    if (sesi?.access_token) headers.Authorization = 'Bearer ' + sesi.access_token;
    let r;
    try { r = await fetch(url, { method: 'POST', headers, body: opt.raw ? body : JSON.stringify(body ?? {}) }); }
    catch (e) { return { data: null, error: errObj('Tidak ada koneksi internet') }; }
    let j = null; try { j = await r.json(); } catch {}
    if (r.status === 401 && sesi && !url.includes('/api/auth/login')) { simpanSesi(null); kabari('SIGNED_OUT', null); }
    if (!r.ok || j?.error) return { data: null, error: errObj(j?.error?.message || `HTTP ${r.status}`, r.status) };
    return { data: j?.data !== undefined ? j.data : j, error: null };
  }

  /* ---------------- query builder ---------------- */
  class Query {
    constructor(table) { this.q = { table, op: 'select', select: '*', filters: [], order: [] }; this.mode = null; }
    select(cols = '*') { if (this.q.op === 'select') this.q.select = cols; return this; }
    insert(values) { this.q.op = 'insert'; this.q.values = values; return this; }
    upsert(values, opt = {}) { this.q.op = 'upsert'; this.q.values = values; if (opt.onConflict) this.q.onConflict = opt.onConflict; return this; }
    update(values) { this.q.op = 'update'; this.q.values = values; return this; }
    delete() { this.q.op = 'delete'; return this; }
    _f(op, col, val) { this.q.filters.push({ op, col, val }); return this; }
    eq(c, v) { return this._f('eq', c, v); }
    neq(c, v) { return this._f('neq', c, v); }
    gt(c, v) { return this._f('gt', c, v); }
    gte(c, v) { return this._f('gte', c, v); }
    lt(c, v) { return this._f('lt', c, v); }
    lte(c, v) { return this._f('lte', c, v); }
    in(c, v) { return this._f('in', c, v); }
    is(c, v) { return this._f('is', c, v); }
    order(col, opt = {}) { this.q.order.push({ col, asc: opt.ascending !== false }); return this; }
    limit(n) { this.q.limit = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    async _run() {
      const r = await panggil('/api/db', this.q);
      if (r.error) return r;
      let d = r.data;
      if (this.q.op !== 'select' && this.q.op !== 'insert' && this.q.op !== 'upsert') d = null;
      if (this.mode === 'single') { if (!Array.isArray(r.data) || r.data.length !== 1) return { data: null, error: errObj('Data tidak ditemukan') }; d = r.data[0]; }
      if (this.mode === 'maybe') d = Array.isArray(r.data) ? (r.data[0] ?? null) : null;
      return { data: d, error: null };
    }
    then(res, rej) { return this._run().then(res, rej); }
  }

  /* ---------------- realtime → polling ---------------- */
  class Channel {
    constructor() { this.h = []; this.t = null; this.lastId = null; }
    on(_type, filter, cb) { this.h.push({ filter, cb }); return this; }
    subscribe() {
      const tick = async () => {
        if (!sesi) return;
        for (const { filter, cb } of this.h) {
          if (filter?.event !== 'INSERT' || !filter?.table) continue;
          if (this.lastId === null) {
            const r = await new Query(filter.table).select('id').order('id', { ascending: false }).limit(1);
            this.lastId = r.data?.[0]?.id || 0; continue;
          }
          const r = await new Query(filter.table).select('*').gt('id', this.lastId).order('id');
          for (const row of r.data || []) { this.lastId = Math.max(this.lastId, row.id); cb({ new: row, eventType: 'INSERT' }); }
        }
      };
      tick(); this.t = setInterval(tick, 15000);
      return this;
    }
    stop() { clearInterval(this.t); }
  }

  /* ---------------- klien ---------------- */
  function createClient() {
    return {
      from: t => new Query(t),
      rpc: (fn, args) => panggil('/api/rpc/' + fn, args || {}),
      channel: () => new Channel(),
      removeChannel: ch => ch?.stop?.(),
      functions: {
        invoke: async (_nama, opt = {}) => {
          const r = await panggil('/api/ongkir', opt.body || {});
          return r.error ? r : { data: r.data, error: null };
        },
      },
      storage: {
        from: () => ({
          upload: (path, file, opt = {}) => panggil('/api/upload?path=' + encodeURIComponent(path), file, { raw: true, headers: { 'Content-Type': opt.contentType || file.type || 'application/octet-stream' } }),
          getPublicUrl: path => ({ data: { publicUrl: location.origin + '/files/' + String(path).replace(/^\/+/, '') } }),
        }),
      },
      auth: {
        getSession: async () => ({ data: { session: sesi }, error: null }),
        onAuthStateChange: cb => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
        signInWithPassword: async ({ email, password }) => {
          const r = await panggil('/api/auth/login', { email, password });
          if (r.error) return { data: {}, error: r.error };
          simpanSesi(r.data.session); kabari('SIGNED_IN', sesi);
          return { data: r.data, error: null };
        },
        signUp: async ({ email, password, options = {} }) => {
          const r = await panggil('/api/auth/signup', { email, password, ...(options.data || {}) });
          if (r.error) return { data: {}, error: r.error };
          simpanSesi(r.data.session); kabari('SIGNED_IN', sesi);
          return { data: r.data, error: null };
        },
        signOut: async () => { simpanSesi(null); kabari('SIGNED_OUT', null); return { error: null }; },
        updateUser: async ({ password }) => {
          const r = await panggil('/api/auth/password', { password });
          if (r.error) return { data: {}, error: r.error };
          simpanSesi(r.data.session); kabari('USER_UPDATED', sesi);
          return { data: r.data, error: null };
        },
        resetPasswordForEmail: async () => ({ data: null, error: errObj('Reset lewat email tidak tersedia. Minta reset password ke admin toko via WhatsApp.') }),
      },
      importFoto: () => panggil('/api/import-foto', {}),
    };
  }
  window.supabase = { createClient };
})();
