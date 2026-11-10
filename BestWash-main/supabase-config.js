// =====================================================================
// supabase-config.js
// 1) Menghubungkan frontend BestWash ke project Supabase
// 2) Berisi fungsi bantu auth (BestWashAuth) yang dipakai halaman lain
//
// URUTAN MEMUAT SCRIPT (wajib):
//   CDN supabase-js  ->  supabase-config.js  ->  auth.js / guard.js / landing.js
// =====================================================================

// ---- ISI DUA BARIS INI dari Supabase: Project Settings -> API ----
const SUPABASE_URL = "https://jnkmaaowrjxfepdkadfi.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impua21hYW93cmp4ZmVwZGthZGZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2Mjc4MzksImV4cCI6MjEwODIwMzgzOX0.YBBOQJN-18s8dPvawPU_c-lECTm4C86P79tmJwAUWpY";
// Kunci anon/publishable AMAN ditaruh di frontend (keamanan data dijaga RLS).
// JANGAN PERNAH menaruh kunci "service_role" di sini.

// PENTING: jangan beri nama variabel "supabase" -> bentrok dengan library CDN.
let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  );
} catch (err) {
  console.error(
    "[BestWash] Library Supabase gagal dimuat (cek internet / ad-blocker):",
    err,
  );
}

// Penanda: sudah diisi DAN library berhasil dimuat?
const SUPABASE_READY =
  !SUPABASE_URL.includes("GANTI") &&
  !SUPABASE_ANON_KEY.includes("GANTI") &&
  supabaseClient !== null;

// Pesan yang cocok dengan penyebab ketidaksiapan
function supabaseNotReadyMessage() {
  if (supabaseClient === null)
    return "Library Supabase gagal dimuat. Periksa koneksi internet atau matikan ad-blocker, lalu refresh.";
  return "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di supabase-config.js";
}

if (!SUPABASE_READY) console.error("[BestWash] " + supabaseNotReadyMessage());

// Kunci localStorage ini SAMA dengan yang sudah dipakai dashboard.html & admin.html,
// jadi kedua halaman itu tetap berjalan tanpa perlu diubah banyak.
const LS_USER = "bestwash_user";
const LS_ROLE = "bestwash_role";

const BestWashAuth = {
  loggingOut: false,

  // Ambil parameter ?next=... dari URL, tapi hanya terima nama file .html lokal
  // (mencegah user dialihkan ke website lain). Aturannya sama dengan nextPage() di dashboard.
  safeNext(raw = new URLSearchParams(location.search).get("next")) {
    if (!raw || !/^[\w-]+\.html(\?[\w=&%.+-]*)?$/.test(raw)) return null;
    if (/^admin/i.test(raw)) return null; // user biasa tidak boleh diarahkan ke admin
    return raw;
  },

  // Sesi login Supabase saat ini (null jika belum login)
  async getSession() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  },

  isAdminLocal() {
    try {
      return localStorage.getItem(LS_ROLE) === "admin";
    } catch (e) {
      return false;
    }
  },

  setLocal(name, role) {
    try {
      localStorage.setItem(LS_USER, name);
      localStorage.setItem(LS_ROLE, role);
    } catch (e) {}
  },

  clearLocal() {
    try {
      localStorage.removeItem(LS_USER);
      localStorage.removeItem(LS_ROLE);
    } catch (e) {}
  },

  // Apakah sesi Supabase saat ini milik admin? (cek ke fungsi is_admin() di database)
  async isAdminSession() {
    try {
      const session = await this.getSession();
      if (!session) return false;
      const { data, error } = await supabaseClient.rpc("is_admin");
      return !error && data === true;
    } catch (e) {
      return false;
    }
  },

  // Salin username dari Supabase ke localStorage agar dashboard.html bisa membacanya
  async syncLocalUser(session) {
    session = session || (await this.getSession());
    if (!session) return null;
    const user = session.user;

    let username = null;
    try {
      const { data } = await supabaseClient
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      username = data && data.username;
    } catch (e) {}

    username =
      username ||
      (user.user_metadata && user.user_metadata.username) ||
      (user.email || "user").split("@")[0];

    this.setLocal(username, "user");
    return username;
  },

  // Keluar: hapus data lokal + akhiri sesi Supabase, lalu ke landing page
  async logout() {
    this.loggingOut = true;
    this.clearLocal();
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {}
    location.href = "landing_page.html";
  },
};
