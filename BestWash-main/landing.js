// =====================================================================
// landing.js  ->  dipakai di landing_page.html
// Klik kartu di section Price:
//   - sudah login  -> dashboard.html (form pesan) dengan paket terpilih
//   - belum login  -> login.html dulu, setelah login otomatis ke form pesan
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-paket]").forEach((card) => {
    const pesan = async () => {
      // data-paket = id layanan ("reguler", "setrika", "express")
      const tujuan = "dashboard.html?paket=" + encodeURIComponent(card.dataset.paket);

      let session = null;
      try {
        session = await BestWashAuth.getSession();
      } catch (e) {}

      if (session) {
        await BestWashAuth.syncLocalUser(session);
        location.href = tujuan + "#beranda";
      } else {
        location.href = "login.html?next=" + encodeURIComponent(tujuan);
      }
    };

    card.addEventListener("click", pesan);
    // Aksesibilitas: kartu juga bisa dipilih dengan keyboard (Enter / Spasi)
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pesan();
      }
    });
  });
});
