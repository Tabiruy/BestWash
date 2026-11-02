// =====================================================================
// orders-api.js -> CRUD pesanan ke Supabase (dipakai dashboard.html & admin.html)
// Urutan script: CDN supabase-js -> supabase-config.js -> orders-api.js -> guard.js
//
// Data disimpan di cache memori supaya kode tampilan lama (yang sinkron,
// mis. DB.orders()) tetap jalan. Cache diperbarui lewat Supabase Realtime.
// =====================================================================
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
  });

  // objek tampilan -> kolom database (hanya field yang ada)
  const MAP = {
    user: "username", nama: "nama", hp: "hp", paketId: "paket_id", paket: "paket",
    harga: "harga", berat: "berat", parfum: "parfum", antar: "antar", ongkir: "ongkir",
    biaya: "biaya", total: "total", alamat: "alamat", catatan: "catatan",
    status: "status", createdAt: "created_at",
  };
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

OrdersAPI.start();
