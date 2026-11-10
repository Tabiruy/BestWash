// =====================================================================
// orders-api.js -> CRUD pesanan ke Supabase (dipakai dashboard.html & admin.html)
// Urutan script: CDN supabase-js -> supabase-config.js -> orders-api.js -> guard.js
//
// Data disimpan di cache memori supaya kode tampilan lama (yang sinkron,
// mis. DB.orders()) tetap jalan. Cache diperbarui lewat Supabase Realtime.
// =====================================================================
// Pengaturan membership (dipakai dashboard.html)
const MEMBER = { hari: 30 };   // masa berlaku tiap paket membership

// Tingkat membership. diskon = % potongan biaya cucian, bonusPoin = % tambahan poin
// tiap pesanan selesai, prioritas = urutan pengerjaan (makin besar makin didahulukan).
const MEMBER_TIERS = {
  bronze: { id: "bronze", nama: "Bronze", fee: 30000,  diskon: 10, bonusPoin: 0,  prioritas: 1, prioLabel: "Prioritas laundry" },
  silver: { id: "silver", nama: "Silver", fee: 60000,  diskon: 15, bonusPoin: 25, prioritas: 2, prioLabel: "Prioritas tinggi" },
  gold:   { id: "gold",   nama: "Gold",   fee: 100000, diskon: 20, bonusPoin: 50, prioritas: 3, prioLabel: "Prioritas utama (dikerjakan paling dulu)" },
};
const tierOf = (id) => MEMBER_TIERS[id] || MEMBER_TIERS.bronze;
// Poin dari satu pesanan selesai: 1 poin per Rp1.000, ditambah bonus poin member saat memesan
const poinOrder = (o) => Math.floor(Math.floor((+o.total || 0) / 1000) * (100 + (+o.bonusPoin || 0)) / 100);

// Voucher diskon (persen) yang bisa ditukar dengan poin.
// Angka ini harus sama dengan fungsi redeem_voucher di supabase-migration.sql.
const VOUCHERS = [
  { poin: 1000, persen: 10 },
  { poin: 2000, persen: 20 },
  { poin: 2500, persen: 30 },
];

const OrdersAPI = (() => {
  let cache = [], sig = "", started = false;
  const listeners = [];
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  // baris database -> objek yang dipakai tampilan
  const fromRow = (r) => ({
    id: r.id, userId: r.user_id, user: r.username, nama: r.nama, hp: r.hp || "",
    paketId: r.paket_id, paket: r.paket, harga: +r.harga, berat: +r.berat,
    parfum: r.parfum || "", antar: r.antar, ongkir: +r.ongkir, biaya: +r.biaya,
    total: +r.total, alamat: r.alamat || "", catatan: r.catatan || "",
    status: r.status, selesaiAt: r.selesai_at, createdAt: r.created_at, updatedAt: r.updated_at,
    // kolom tambahan (lihat supabase-migration.sql)
    member: !!r.member, diskon: +r.diskon || 0, prioritas: !!r.prioritas,
    bayar: r.bayar || "Tunai", bayarStatus: r.bayar_status || "belum",
    memberTier: r.member_tier || (r.member ? "bronze" : ""), bonusPoin: +r.bonus_poin || 0,
    voucherPersen: +r.voucher_persen || 0, voucherId: r.voucher_id || "",
    jarak: r.jarak != null ? +r.jarak : null,
    lat: r.lat != null ? +r.lat : null, lng: r.lng != null ? +r.lng : null,
  });

  // objek tampilan -> kolom database (hanya field yang ada)
  const MAP = {
    user: "username", nama: "nama", hp: "hp", paketId: "paket_id", paket: "paket",
    harga: "harga", berat: "berat", parfum: "parfum", antar: "antar", ongkir: "ongkir",
    biaya: "biaya", total: "total", alamat: "alamat", catatan: "catatan",
    status: "status", createdAt: "created_at",
    member: "member", diskon: "diskon", prioritas: "prioritas", bayar: "bayar",
    bayarStatus: "bayar_status", jarak: "jarak", lat: "lat", lng: "lng",
    voucherPersen: "voucher_persen", voucherId: "voucher_id",
    memberTier: "member_tier", bonusPoin: "bonus_poin",
  };
  // field tambahan: kalau kolomnya belum ada di database, ringkasannya disimpan di catatan
  const EXTRA = ["member", "diskon", "prioritas", "bayar", "bayarStatus", "jarak", "lat", "lng", "voucherPersen", "voucherId", "memberTier", "bonusPoin"];
  const isMissingColumn = (e) => e && /column|schema cache/i.test(e.message || "");
  const toRow = (o) => {
    const r = {};
    Object.keys(MAP).forEach((k) => { if (o[k] !== undefined) r[MAP[k]] = o[k]; });
    return r;
  };

  async function refresh() {
    const { data, error } = await supabaseClient
      .from("orders").select("*").order("created_at", { ascending: false });
    if (error) return console.error("[BestWash] Gagal memuat pesanan:", error);
    const s = JSON.stringify(data);
    if (s === sig) return;            // tidak ada perubahan -> jangan render ulang
    sig = s; cache = data.map(fromRow); emit();
  }

  return {
    list: () => cache,
    onChange: (fn) => { listeners.push(fn); },
    refresh,

    // Mulai memuat + berlangganan perubahan realtime (otomatis dipanggil di bawah)
    async start() {
      if (started || !SUPABASE_READY) return;
      const session = await BestWashAuth.getSession();
      if (!session) return;
      started = true;
      await refresh();
      supabaseClient.channel("orders-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
        .subscribe();
      setInterval(refresh, 20000);    // cadangan jika koneksi realtime terputus
    },

    // CREATE. asAdmin=true: hubungkan pesanan ke akun pelanggan berdasarkan username
    async create(o, asAdmin) {
      const row = toRow(o);
      if (asAdmin) {
        const { data: uid } = await supabaseClient.rpc("user_id_by_username", { p_username: o.user });
        row.user_id = uid || null;
      }
      const { data, error } = await supabaseClient.from("orders").insert(row).select().single();
      if (error && isMissingColumn(error)) {
        // Database belum dimigrasi: simpan tanpa kolom baru, ringkasan ditaruh di catatan
        const plain = Object.assign({}, o);
        EXTRA.forEach((k) => { delete plain[k]; });
        const base = toRow(plain);
        if (row.user_id !== undefined) base.user_id = row.user_id;
        const meta = "[BestWash] Bayar: " + (o.bayar || "Tunai") + (o.member ? " | MEMBER " + tierOf(o.memberTier).nama + " (diskon " + o.diskon + "%, bonus poin +" + (o.bonusPoin || 0) + "%, prioritas)" : "") + (o.voucherPersen > 0 ? " | VOUCHER " + o.voucherPersen + "%" : "") + (o.jarak != null ? " | Jarak: " + o.jarak + " km" : "");
        base.catatan = ((o.catatan || "") + "\n" + meta).trim();
        const retry = await supabaseClient.from("orders").insert(base).select().single();
        if (retry.error) throw retry.error;
        await refresh();
        const out = fromRow(retry.data);
        EXTRA.forEach((k) => { if (o[k] !== undefined) out[k] = o[k]; });
        return out;
      }
      if (error) throw error;
      await refresh();
      return fromRow(data);
    },

    // UPDATE (admin). patch = field tampilan, mis. { status: 2 }
    async update(id, patch) {
      const { data, error } = await supabaseClient
        .from("orders").update(toRow(patch)).eq("id", id).select().single();
      if (error) throw error;
      await refresh();
      return fromRow(data);
    },

    // DELETE (admin)
    async remove(id) {
      const { data, error } = await supabaseClient.from("orders").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data.length) throw new Error("Tidak punya izin menghapus, atau pesanan tidak ditemukan.");
      await refresh();
    },
    async removeAll() {
      const { error } = await supabaseClient.from("orders").delete().neq("id", "");
      if (error) throw error;
      await refresh();
    },

    // User menandai pesanannya selesai (lewat fungsi complete_order di database)
    async complete(id) {
      const { error } = await supabaseClient.rpc("complete_order", { p_id: id });
      if (error) throw error;
      await refresh();
    },
  };
})();

// =====================================================================
// MemberAPI -> membership pelanggan (diskon + prioritas)
// Disimpan di tabel Supabase "memberships"; jika tabel belum dibuat,
// otomatis memakai localStorage browser (lihat supabase-migration.sql).
// =====================================================================
const MemberAPI = (() => {
  let cur = null;
  const lsKey = (u) => "bestwash_member_" + String(u).toLowerCase();
  return {
    current: () => cur,
    isActive: () => !!cur && new Date(cur.sampai) > new Date(),
    // Konfigurasi tingkat member yang sedang aktif (null jika bukan member)
    tier() { return this.isActive() ? tierOf(cur.tier) : null; },

    async load(username) {
      try {
        const s = await BestWashAuth.getSession();
        if (s) {
          const { data, error } = await supabaseClient.from("memberships").select("*").eq("user_id", s.user.id).maybeSingle();
          if (!error) { cur = data ? { mulai: data.mulai, sampai: data.sampai, metode: data.metode, tier: data.tier || "bronze" } : null; return cur; }
          console.warn("[BestWash] Tabel memberships belum siap, pakai penyimpanan lokal:", error.message);
        }
      } catch (e) {}
      try { const v = localStorage.getItem(lsKey(username)); cur = v ? JSON.parse(v) : null; } catch (e) { cur = null; }
      if (cur && !cur.tier) cur.tier = "bronze";
      return cur;
    },

    // Daftar / perpanjang MEMBER.hari hari. Tingkat sama -> masa berlaku diperpanjang;
    // tingkat berbeda -> paket diganti dan masa berlaku dihitung ulang mulai hari ini.
    async join(username, metode, tierId) {
      const tier = tierOf(tierId).id;
      const now = new Date();
      const sama = this.isActive() && tierOf(cur.tier).id === tier;
      const start = sama ? new Date(cur.sampai) : now;
      const rec = {
        mulai: sama ? cur.mulai : now.toISOString(),
        sampai: new Date(start.getTime() + MEMBER.hari * 864e5).toISOString(),
        metode, tier,
      };
      try {
        const s = await BestWashAuth.getSession();
        if (s) {
          const { error } = await supabaseClient.from("memberships").upsert(Object.assign({ user_id: s.user.id, updated_at: now.toISOString() }, rec));
          if (!error) { cur = rec; return rec; }
          console.warn("[BestWash] Gagal simpan membership ke Supabase, pakai lokal:", error.message);
        }
      } catch (e) {}
      try { localStorage.setItem(lsKey(username), JSON.stringify(rec)); } catch (e) {}
      cur = rec;
      return rec;
    },
  };
})();


// =====================================================================
// VoucherAPI -> voucher diskon hasil tukar poin
// Disimpan di tabel Supabase "vouchers" (dibuat/dipakai lewat fungsi
// redeem_voucher / use_voucher / release_voucher). Jika migrasinya belum
// dijalankan, otomatis memakai localStorage browser.
// =====================================================================
const VoucherAPI = (() => {
  let list = [], local = false;
  const lsKey = (u) => "bestwash_voucher_" + String(u).toLowerCase();
  const missing = (e) => e && /function|relation|schema cache|does not exist|could not find/i.test(e.message || "");
  const saveLocal = (u) => { try { localStorage.setItem(lsKey(u), JSON.stringify(list)); } catch (e) {} };
  const fromRow = (r) => ({ id: r.id, persen: +r.persen || 0, poin: +r.poin, status: r.status, createdAt: r.created_at });

  return {
    list: () => list,
    active: () => list.filter((v) => v.status === "aktif" && v.persen > 0),
    spent: () => list.reduce((t, v) => t + (+v.poin || 0), 0),

    async load(username) {
      try {
        const s = await BestWashAuth.getSession();
        if (s) {
          const { data, error } = await supabaseClient.from("vouchers").select("*").order("created_at", { ascending: false });
          if (!error) { local = false; list = data.map(fromRow); return list; }
          if (!missing(error)) console.warn("[BestWash] Gagal memuat voucher:", error.message);
          else console.warn("[BestWash] Tabel vouchers belum siap, pakai penyimpanan lokal:", error.message);
        }
      } catch (e) {}
      local = true;
      try { const v = localStorage.getItem(lsKey(username)); list = v ? JSON.parse(v) : []; } catch (e) { list = []; }
      return list;
    },

    // Tukar `tier.poin` poin dengan voucher. `earned` = total poin yang sudah didapat.
    async redeem(username, tier, earned) {
      if (!local) {
        const { data, error } = await supabaseClient.rpc("redeem_voucher", { p_poin: tier.poin });
        if (!error) { list.unshift(fromRow(data)); return list[0]; }
        if (!missing(error)) throw error;
        local = true;
      }
      if (earned - this.spent() < tier.poin) throw new Error("Poin tidak cukup");
      const v = { id: "L" + Date.now(), persen: tier.persen, poin: tier.poin, status: "aktif", createdAt: new Date().toISOString() };
      list.unshift(v); saveLocal(username);
      return v;
    },

    // Pakai voucher untuk pesanan -> mengembalikan persen potongan
    async use(id, username) {
      if (!local) {
        const { data, error } = await supabaseClient.rpc("use_voucher", { p_id: id });
        if (error) throw error;
        const v = list.find((x) => x.id === id); if (v) v.status = "terpakai";
        return +data;
      }
      const v = list.find((x) => x.id === id && x.status === "aktif");
      if (!v) throw new Error("Voucher tidak valid atau sudah dipakai");
      v.status = "terpakai"; saveLocal(username);
      return v.persen;
    },

    // Batalkan pemakaian (dipanggil jika pesanan gagal dibuat)
    async release(id, username) {
      const v = list.find((x) => x.id === id); if (v) v.status = "aktif";
      if (!local) { try { await supabaseClient.rpc("release_voucher", { p_id: id }); } catch (e) {} }
      else saveLocal(username);
    },
  };
})();

OrdersAPI.start();
