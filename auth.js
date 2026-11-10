// =====================================================================
// auth.js  ->  dipakai di login.html dan register.html
// =====================================================================

// Admin = akun Supabase biasa yang user_id-nya terdaftar di tabel public.admins.
// Di form login: ketik username "admin" + password akun tersebut.
const ADMIN_USERNAME = "admin";
const ADMIN_EMAIL = "prawiratamaannaafi@gmail.com"; // email akun admin di Supabase

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  if (!loginForm && !registerForm) return;

  const $ = (id) => document.getElementById(id);
  const alertBox = $("auth-alert");
  const nextPage = BestWashAuth.safeNext(); // mis. "dashboard.html?paket=reguler"

  // ---------- Fungsi bantu tampilan ----------
  function showAlert(message, type) {
    if (!alertBox) return alert(message);
    alertBox.textContent = message;
    alertBox.className =
      "rounded-xl px-4 py-3 text-sm font-semibold " +
      (type === "success"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-red-100 text-red-700");
  }

  function hideAlert() {
    if (alertBox) alertBox.className = "hidden";
  }

  function setLoading(button, loading) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = loading;
    button.textContent = loading ? "Memproses..." : button.dataset.label;
    button.classList.toggle("opacity-70", loading);
  }

  // Ubah pesan error Supabase (bahasa Inggris) jadi bahasa Indonesia
  function translateError(err) {
    const msg = ((err && err.message) || "").toLowerCase();
    if (msg.includes("invalid login credentials"))
      return "Username/email atau password salah.";
    if (msg.includes("email not confirmed"))
      return "Email belum diverifikasi. Cek inbox/spam emailmu.";
    if (msg.includes("already registered"))
      return "Email sudah terdaftar. Silakan login.";
    if (msg.includes("database error saving new user"))
      return "Username sudah dipakai atau formatnya tidak valid.";
    if (msg.includes("otp") && (msg.includes("expired") || msg.includes("invalid")))
      return "Kode salah atau sudah kedaluwarsa.";
    if (msg.includes("different from the old password"))
      return "Password baru tidak boleh sama dengan password lama.";
    if (msg.includes("rate limit") || msg.includes("security purposes"))
      return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
    if (msg.includes("rate limit"))
      return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
    if (msg.includes("failed to fetch"))
      return "Tidak bisa terhubung ke server. Periksa koneksi internetmu.";
    if (msg.includes("get_email_by_username"))
      return "Setup database belum lengkap. Jalankan SQL di Supabase dulu (langkah 4 pada panduan).";
    return (
      "Terjadi kesalahan: " + ((err && err.message) || "silakan coba lagi.")
    );
  }

  // Bawa parameter ?next= saat pindah antara halaman Sign In <-> Sign Up
  if (nextPage) {
    const qs = "?next=" + encodeURIComponent(nextPage);
    const toRegister = document.querySelector('a[href="register.html"]');
    const toLogin = document.querySelector('a[href="login.html"]');
    if (toRegister) toRegister.href = "register.html" + qs;
    if (toLogin) toLogin.href = "login.html" + qs;
  }

  // =====================================================================
  // LOGIN
  // =====================================================================
  if (loginForm) {
    const params = new URLSearchParams(location.search);

    // Pesan setelah user selesai mendaftar
    const registered = params.get("registered");
    if (registered === "confirm") {
      showAlert(
        "Pendaftaran berhasil! Cek emailmu untuk verifikasi, lalu login.",
        "success",
      );
    } else if (registered) {
      showAlert("Pendaftaran berhasil! Silakan login.", "success");
    }

    // Sudah login sebelumnya? Langsung arahkan (kecuali dipaksa ke form login admin)
    if (SUPABASE_READY && !params.get("admin")) {
      BestWashAuth.getSession().then(async (session) => {
        if (!session) return;
        await BestWashAuth.syncLocalUser(session);
        location.replace(nextPage || "dashboard.html");
      });
    }

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideAlert();

      const username = $("username").value.trim();
      const password = $("password").value;

      // ---- 1) Admin: login Supabase pakai ADMIN_EMAIL, lalu dicek lewat tabel admins ----
      if (username.toLowerCase() === ADMIN_USERNAME) {
        if (!SUPABASE_READY) return showAlert(supabaseNotReadyMessage());
        const btn = loginForm.querySelector('button[type="submit"]');
        setLoading(btn, true);
        try {
          const { error } = await supabaseClient.auth.signInWithPassword({
            email: ADMIN_EMAIL,
            password,
          });
          if (error) throw error;
          if (!(await BestWashAuth.isAdminSession())) {
            await supabaseClient.auth.signOut();
            return showAlert("Akun ini belum terdaftar sebagai admin.");
          }
          BestWashAuth.setLocal("admin", "admin");
          location.href = "admin.html";
        } catch (err) {
          showAlert(translateError(err));
        } finally {
          setLoading(btn, false);
        }
        return;
      }

      // ---- 2) User biasa wajib lewat Supabase ----
      if (!SUPABASE_READY) return showAlert(supabaseNotReadyMessage());

      const button = loginForm.querySelector('button[type="submit"]');
      setLoading(button, true);

      try {
        // login lewat Supabase Auth
        // Supabase login memakai email, jadi username diubah dulu jadi email
        // lewat fungsi SQL get_email_by_username (dibuat di langkah 4).
        let email = username;
        if (!username.includes("@")) {
          const { data, error } = await supabaseClient.rpc(
            "get_email_by_username",
            { p_username: username },
          );
          if (error) throw error;
          email = data;
        }
        if (!email) return showAlert("Username/email atau password salah.");

        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        await BestWashAuth.syncLocalUser(data.session);
        location.href = nextPage || "dashboard.html";
      } catch (err) {
        showAlert(translateError(err));
      } finally {
        setLoading(button, false);
      }
    });
  }

  // =====================================================================
  // LUPA PASSWORD (modal di login.html)
  // Alur: email/username -> kode OTP dikirim ke email -> kode + password baru
  // Catatan: template email "Reset Password" di Supabase harus memuat {{ .Token }}
  // =====================================================================
  if (loginForm) {
    const modal = $("forgot-modal");
    const card = $("forgot-card");
    const step1 = $("forgot-step-1");
    const step2 = $("forgot-step-2");
    const err1 = $("forgot-error-1");
    const err2 = $("forgot-error-2");
    const idInput = $("forgot-id");
    const otpInput = $("forgot-otp");
    const newPass = $("forgot-new-password");
    const confirmPass = $("forgot-confirm-password");
    const sendBtn = $("btn-forgot-send");
    const resetBtn = $("btn-forgot-reset");
    const resendBtn = $("btn-forgot-resend");

    let resetEmail = ""; // email tujuan kode
    let cooldownTimer = null;

    const showErr = (el, msg) => {
      el.textContent = msg;
      el.classList.remove("hidden");
    };
    const hideErr = (el) => el.classList.add("hidden");

    function openModal() {
      step1.classList.remove("hidden");
      step2.classList.add("hidden");
      hideErr(err1);
      hideErr(err2);
      idInput.value = $("username").value.trim();
      modal.classList.remove("opacity-0", "pointer-events-none");
      card.classList.remove("scale-95");
      card.classList.add("scale-100");
      idInput.focus();
    }

    function closeModal() {
      modal.classList.add("opacity-0", "pointer-events-none");
      card.classList.remove("scale-100");
      card.classList.add("scale-95");
      otpInput.value = newPass.value = confirmPass.value = "";
      clearInterval(cooldownTimer);
    }

    // Tombol "Kirim ulang kode" dikunci 60 dtk (batas kirim email Supabase)
    function startCooldown(seconds = 60) {
      clearInterval(cooldownTimer);
      let left = seconds;
      resendBtn.disabled = true;
      resendBtn.textContent = "Kirim ulang kode (" + left + " dtk)";
      cooldownTimer = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(cooldownTimer);
          resendBtn.disabled = false;
          resendBtn.textContent = "Kirim ulang kode";
        } else {
          resendBtn.textContent = "Kirim ulang kode (" + left + " dtk)";
        }
      }, 1000);
    }

    // Ubah input (email / username) menjadi email
    async function resolveEmail(value) {
      if (value.includes("@")) return value;
      if (value.toLowerCase() === ADMIN_USERNAME) return ADMIN_EMAIL;
      const { data, error } = await supabaseClient.rpc(
        "get_email_by_username",
        { p_username: value },
      );
      if (error) throw error;
      return data;
    }

    async function sendCode(target) {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(target);
      if (error) throw error;
      resetEmail = target;
      startCooldown();
    }

    $("forgot-link").addEventListener("click", openModal);
    $("btn-forgot-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    // Langkah 1: kirim kode ke email
    sendBtn.addEventListener("click", async () => {
      hideErr(err1);
      const value = idInput.value.trim();
      if (!value) return showErr(err1, "Isi email atau username dulu.");
      if (!SUPABASE_READY) return showErr(err1, supabaseNotReadyMessage());

      setLoading(sendBtn, true);
      try {
        const target = await resolveEmail(value);
        if (!target)
          return showErr(err1, "Akun dengan username/email itu tidak ditemukan.");
        await sendCode(target);
        $("forgot-email-shown").textContent = target;
        step1.classList.add("hidden");
        step2.classList.remove("hidden");
        otpInput.focus();
      } catch (err) {
        showErr(err1, translateError(err));
      } finally {
        setLoading(sendBtn, false);
      }
    });

    // Kirim ulang kode
    resendBtn.addEventListener("click", async () => {
      hideErr(err2);
      resendBtn.disabled = true;
      try {
        await sendCode(resetEmail);
      } catch (err) {
        resendBtn.disabled = false;
        showErr(err2, translateError(err));
      }
    });

    // Langkah 2: verifikasi kode lalu simpan password baru
    resetBtn.addEventListener("click", async () => {
      hideErr(err2);
      const token = otpInput.value.trim();
      const pass = newPass.value;

      if (!/^\d{6,10}$/.test(token))
        return showErr(err2, "Masukkan kode verifikasi dari emailmu (angka).");
      if (pass.length < 6)
        return showErr(err2, "Password minimal 6 karakter.");
      if (pass !== confirmPass.value)
        return showErr(err2, "Konfirmasi password tidak sama.");

      setLoading(resetBtn, true);
      try {
        // Kode benar -> Supabase membuka sesi sementara untuk ganti password
        const { error: errOtp } = await supabaseClient.auth.verifyOtp({
          email: resetEmail,
          token,
          type: "recovery",
        });
        if (errOtp) throw errOtp;

        const { error: errUpd } = await supabaseClient.auth.updateUser({
          password: pass,
        });
        if (errUpd) throw errUpd;

        // Selesai: keluar dari sesi sementara, minta user login dengan password baru
        await supabaseClient.auth.signOut();
        BestWashAuth.clearLocal();
        closeModal();
        $("password").value = "";
        showAlert("Password berhasil diubah. Silakan login.", "success");
      } catch (err) {
        showErr(err2, translateError(err));
      } finally {
        setLoading(resetBtn, false);
      }
    });
  }

  // =====================================================================
  // REGISTER
  // =====================================================================
  if (registerForm) {
    const otpModal = document.getElementById("otp-modal");
    const otpCard = document.getElementById("otp-card");
    const verifyBtn = document.getElementById("btn-verify-otp");
    const otpInput = document.getElementById("otp-input");
    const otpError = document.getElementById("otp-error");

    let pendingEmail = ""; // Menyimpan email untuk verifikasi OTP nanti

    // Fungsi untuk menutup modal OTP
    const closeModal = () => {
      otpModal.classList.add("opacity-0", "pointer-events-none");
      otpCard.classList.remove("scale-100");
      otpCard.classList.add("scale-95");
    };

    // 1. Submit form register awal (Kirim Kode ke Email)
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideAlert();

      if (!SUPABASE_READY) return showAlert("Supabase belum siap.");

      const username = document.getElementById("username").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const noTelp = document
        .getElementById("telp")
        .value.replace(/[\s-]/g, "");

      // Validasi dasar
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username))
        return showAlert(
          "Username 3-20 karakter: huruf, angka, underscore (_).",
        );
      if (username.toLowerCase() === ADMIN_USERNAME)
        return showAlert('Username "admin" tidak boleh dipakai.');
      if (password.length < 6) return showAlert("Password minimal 6 karakter.");

      const button = registerForm.querySelector('button[type="submit"]');
      setLoading(button, true);

      try {
        // Cek apakah username sudah dipakai
        const { data: dipakai, error: errCek } = await supabaseClient.rpc(
          "get_email_by_username",
          { p_username: username },
        );
        if (errCek) throw errCek;
        if (dipakai)
          return showAlert("Username sudah dipakai, pilih yang lain.");

        // Daftar ke Supabase (Supabase akan mengirimkan email OTP otomatis)
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { username, no_telp: noTelp } },
        });

        if (error) throw error;
        if (
          data.user &&
          data.user.identities &&
          data.user.identities.length === 0
        ) {
          return showAlert("Email sudah terdaftar. Silakan login.");
        }

        // Simpan email sementara lalu munculkan Modal OTP
        pendingEmail = email;
        otpModal.classList.remove("opacity-0", "pointer-events-none");
        otpCard.classList.remove("scale-95");
        otpCard.classList.add("scale-100");
      } catch (err) {
        showAlert(translateError(err));
      } finally {
        setLoading(button, false);
      }
    });

    // 2. Tutup pop-up jika mengklik area gelap di sekitarnya
    otpModal.addEventListener("click", (e) => {
      // Pastikan yang diklik adalah background gelap (modal), bukan isi dalam card
      if (e.target === otpModal) {
        closeModal();
      }
    });

    // 3. Proses Verifikasi Kode OTP (Buat Akun)
    verifyBtn.addEventListener("click", async () => {
      const token = otpInput.value.trim();

      if (token.length !== 8) {
        otpError.textContent = "Kode harus 8 digit angka.";
        otpError.classList.remove("hidden");
        return;
      }

      verifyBtn.textContent = "Memverifikasi...";
      verifyBtn.disabled = true;

      try {
        // Verifikasi OTP ke Supabase
        const { data, error } = await supabaseClient.auth.verifyOtp({
          email: pendingEmail,
          token: token,
          type: "signup", // Menandakan bahwa ini OTP untuk pembuatan akun
        });

        if (error) throw error;

        // OTP Valid -> Akun Terbuat dan langsung login
        closeModal();

        // Jika berhasil, logout sementara lalu arahkan ke login agar pengguna masuk manual
        await supabaseClient.auth.signOut();
        location.href = "login.html?registered=1";
      } catch (error) {
        otpError.textContent = "Kode OTP salah atau sudah kedaluwarsa.";
        otpError.classList.remove("hidden");
      } finally {
        verifyBtn.textContent = "Verifikasi & Buat Akun";
        verifyBtn.disabled = false;
      }
    });
  }
});
