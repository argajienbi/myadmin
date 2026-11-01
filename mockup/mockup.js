// Mockup statis MyPresence Admin — interaksi demo saja, tanpa backend.
// - Toggle tema terang/gelap (token .dark dari template)
// - Tab filter di halaman Persetujuan
// - Modal detail persetujuan
(function () {
  "use strict";

  // Tema: simpan pilihan di localStorage, hormati prefers-color-scheme.
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem("mp-admin-theme"); } catch (e) { /* abaikan */ }
  if (saved === "dark" || (!saved && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    root.classList.add("dark");
  }
  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    var setIcon = function () {
      btn.innerHTML = '<i data-lucide="' + (root.classList.contains("dark") ? "moon" : "sun") + '"></i>';
      if (window.lucide) window.lucide.createIcons();
    };
    setIcon();
    btn.addEventListener("click", function () {
      var dark = root.classList.toggle("dark");
      try { localStorage.setItem("mp-admin-theme", dark ? "dark" : "light"); } catch (e) { /* abaikan */ }
      setIcon();
    });
  });

  // Tab filter: tombol [data-tab] menampilkan baris [data-type="..."].
  document.querySelectorAll("[data-tabs]").forEach(function (group) {
    var buttons = group.querySelectorAll("[data-tab]");
    var scope = document.querySelector(group.getAttribute("data-tabs"));
    if (!scope) return;
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        var tab = btn.getAttribute("data-tab");
        scope.querySelectorAll("[data-type]").forEach(function (row) {
          row.style.display = (tab === "semua" || row.getAttribute("data-type") === tab) ? "" : "none";
        });
        var empty = scope.querySelector("[data-empty]");
        if (empty) {
          var anyVisible = Array.prototype.some.call(
            scope.querySelectorAll("[data-type]"),
            function (row) { return row.style.display !== "none"; }
          );
          empty.style.display = anyVisible ? "none" : "";
        }
      });
    });
  });

  // Modal: [data-modal-open="<id>"] membuka, [data-modal-close] menutup.
  document.querySelectorAll("[data-modal-open]").forEach(function (opener) {
    opener.addEventListener("click", function () {
      var modal = document.getElementById(opener.getAttribute("data-modal-open"));
      if (modal) modal.classList.add("open");
    });
  });
  document.querySelectorAll(".modal-backdrop").forEach(function (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) backdrop.classList.remove("open");
    });
    backdrop.querySelectorAll("[data-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { backdrop.classList.remove("open"); });
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open").forEach(function (m) { m.classList.remove("open"); });
    }
  });

  // Ikon lucide (CDN). Kalau CDN tidak terjangkau, label teks tetap terbaca.
  if (window.lucide) window.lucide.createIcons();
})();
