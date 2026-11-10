// =====================================================================
// guard.js  ->  proteksi halaman
// Pasang di <head> (setelah supabase-config.js):
//   dashboard.html :  <script src="guard.js" data-role="user"></script>
//   admin.html     :  <script src="guard.js" data-role="admin"></script>
//
// Catatan: ini perlindungan TAMPILAN (UX). Keamanan data yang sebenarnya
// dijaga oleh Row Level Security (RLS) di Supabase.
// =====================================================================
(function () {
  const role = document.currentScript.dataset.role || "user";

  // Sembunyikan halaman sampai pengecekan selesai (supaya isi dashboard
  // tidak sempat "berkedip" untuk orang yang belum login)
  document.documentElement.style.visibility = "hidden";
  const show = () => {
    document.documentElement.style.visibility = "";
  };

  async function check() {
    try {
      // ---------- Halaman ADMIN ----------
      if (role === "admin") {
        if (await BestWashAuth.isAdminSession()) return show();
        return location.replace("login.html?admin=1");
      }

      // ---------- Halaman USER (dashboard) ----------
      const session = await BestWashAuth.getSession();
      if (!session) {
        BestWashAuth.clearLocal();
        // simpan tujuan (termasuk ?paket=...) supaya setelah login kembali ke sini
        const next =
          BestWashAuth.safeNext("dashboard.html" + location.search) ||
          "dashboard.html";
        return location.replace("login.html?next=" + encodeURIComponent(next));
      }

      show();

      // Datang dari kartu harga? Gulir otomatis ke formulir pemesanan
      if (new URLSearchParams(location.search).get("paket")) {
        const scroll = () =>
          setTimeout(() => {
            const form = document.getElementById("form-pesan");
            if (form) form.scrollIntoView({ behavior: "smooth" });
          }, 200);
        if (document.readyState === "loading")
          document.addEventListener("DOMContentLoaded", scroll);
        else scroll();
      }

      // Logout dari tab lain / sesi berakhir -> tendang ke halaman login
      supabaseClient.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT" && !BestWashAuth.loggingOut) {
          BestWashAuth.clearLocal();
          location.replace("login.html");
        }
      });
    } catch (err) {
      console.error("[BestWash] Gagal cek login:", err);
      location.replace("login.html");
    }
  }

  // Tombol "Back" setelah logout bisa menampilkan halaman dari cache browser.
  // Paksa muat ulang supaya pengecekan di atas berjalan lagi.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });

  check();
})();
