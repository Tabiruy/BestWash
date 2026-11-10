document.addEventListener("DOMContentLoaded", () => {
  // 1. Toggle Mobile Menu (Navbar)
  const menuBtn = document.getElementById("menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("hidden");
      mobileMenu.classList.toggle("flex");
    });
  }

  // 2. Toggle Visibility Password (Khusus Halaman Login)
  const togglePassword = document.getElementById("toggle-password");
  const passwordInput = document.getElementById("password");

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", () => {
      const type =
        passwordInput.getAttribute("type") === "password" ? "text" : "password";
      passwordInput.setAttribute("type", type);
    });
  }

  // 3. Animasi Scroll (Fade-Up Effect) menggunakan IntersectionObserver
  const fadeUpElements = document.querySelectorAll(".fade-up");

  if (fadeUpElements.length > 0) {
    const observerOptions = {
      root: null,
      rootMargin: "0px 0px -50px 0px", // Animasi aktif sedikit sebelum elemen benar-benar sampai di paling bawah
      threshold: 0.15, // Elemen terlihat 15% baru mentrigger animasi
    };

    const scrollObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("show");
          // Jika ingin animasi hanya berjalan sekali saat pertama discroll, un-comment baris di bawah:
          // observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    fadeUpElements.forEach((el) => scrollObserver.observe(el));
  }
});
