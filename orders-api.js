// =====================================================================
// orders-api.js -> CRUD pesanan ke Supabase (dipakai dashboard.html & admin.html)
// Urutan script: CDN supabase-js -> supabase-config.js -> orders-api.js -> guard.js
//
// Data disimpan di cache memori supaya kode tampilan lama (yang sinkron,
// mis. DB.orders()) tetap jalan. Cache diperbarui lewat Supabase Realtime.
// =====================================================================
// Pengaturan membership (dipakai dashboard.html)
const MEMBER = { fee: 30000, hari: 30, diskon: 10 };

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
  };
  // field tambahan: kalau kolomnya belum ada di database, ringkasannya disimpan di catatan
  const EXTRA = ["member", "diskon", "prioritas", "bayar", "bayarStatus", "jarak", "lat", "lng"];
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
        const meta = "[BestWash] Bayar: " + (o.bayar || "Tunai") + (o.member ? " | MEMBER (diskon " + o.diskon + "%, prioritas)" : "") + (o.jarak != null ? " | Jarak: " + o.jarak + " km" : "");
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

    async load(username) {
      try {
        const s = await BestWashAuth.getSession();
        if (s) {
          const { data, error } = await supabaseClient.from("memberships").select("*").eq("user_id", s.user.id).maybeSingle();
          if (!error) { cur = data ? { mulai: data.mulai, sampai: data.sampai, metode: data.metode } : null; return cur; }
          console.warn("[BestWash] Tabel memberships belum siap, pakai penyimpanan lokal:", error.message);
        }
      } catch (e) {}
      try { const v = localStorage.getItem(lsKey(username)); cur = v ? JSON.parse(v) : null; } catch (e) { cur = null; }
      return cur;
    },

    // Daftar / perpanjang MEMBER.hari hari
    async join(username, metode) {
      const now = new Date();
      const aktif = this.isActive();
      const start = aktif ? new Date(cur.sampai) : now;
      const rec = {
        mulai: aktif ? cur.mulai : now.toISOString(),
        sampai: new Date(start.getTime() + MEMBER.hari * 864e5).toISOString(),
        metode,
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

OrdersAPI.start();
