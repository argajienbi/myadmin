# Daftar Revisi Desain — PR #2 (Redesain MyAdmin)

Status: DRAF disusun Uti atas penilaian desain (1 Nov 2026), menunggu persetujuan Arga sebelum diposting ke PR #2 (https://github.com/argajienbi/myadmin/pull/2). PR tetap DITAHAN — jangan merge sebelum daftar ini disetujui.

Acuan yang tidak berubah: mockup di `mockup/` tetap kunci desain; semua fungsi lama dipertahankan (badge notifikasi, schedule, location, attendance flow, quick menu, pengumuman); token saat ini — primer teal `#0b7a8c`, sidebar `#0b2b33`, coral `#f2523f` (tile logo saja), radius 10px, font Plus Jakarta Sans + JetBrains Mono.

## R1 — Identitas brand & logo (prioritas tinggi; butuh input Arga)

Masalah: tampilan masih terasa template admin generik. Logo resmi belum ada; ikon PWA `pwa-192x192`/`pwa-512x512` yang direferensikan `vite.config` tidak ada di repo (lama maupun redesign), jadi manifest mengarah ke file kosong.

Usulan:
- Arga menyediakan logo MyPresence final (file/sumber resmi) — jangan difabrikasi.
- Generate ikon PWA 192/512 + favicon dari logo itu, letakkan di `apps/web/public/`.
- Coral `#f2523f` dihidupkan sebagai aksen sekunder terbatas (indikator mendesak, badge notifikasi, elemen logo) agar brand punya dua warna yang dikenali, bukan teal sendirian.

Kriteria selesai: ikon tampil di manifest & hasil build, tidak ada referensi ikon 404, logo tampil konsisten di sidebar dan halaman login.

## R2 — Putuskan mode gelap: satu bahasa tampilan (prioritas tinggi; keputusan Arga)

Masalah: sidebar gelap `#0b2b33` + konten terang + toggle tema tersedia, tetapi keputusan "dark sebagai default" (pertanyaan mockup Q4) tidak pernah diambil — hasilnya kesan setengah gelap.

Usulan (pilih salah satu, dicatat sebagai keputusan):
- (a) Full dark sebagai default (toggle tetap ada untuk light), menyelaraskan sidebar dan konten; atau
- (b) Full light sebagai default dan sidebar dibuat terang juga.
- Rekomendasi Uti: (a) — admin sering dibuka malam hari dari HP; referensi pembanding (template Pane) membuktikan full dark konsisten terasa lebih menyatu.

Kriteria selesai: keputusan tercatat di dokumen ini; token `.dark`/`light` di `packages/ui/src/styles/globals.css` diaudit agar tidak ada elemen tertinggal tema lain (badge, kartu, panel) di mode terpilih.

## R3 — Tekankan antrean persetujuan di Dashboard (prioritas tinggi)

Masalah: Approval Pending — pekerjaan harian terpenting admin — tampil setara 5 kartu ringkasan warisan desain lama; penekanannya adalah pertanyaan mockup Q3 yang belum diputuskan. Dashboard belum menjawab "apa yang harus dibereskan sekarang".

Usulan:
- Kartu Approval Pending menjadi kartu prioritas pertama di Dashboard: lebih besar, aksen coral untuk angka antrean, tautan langsung ke halaman Persetujuan (memakai deep-link yang sudah ada).
- Tambahkan ringkasan "perlu tindakan" ringkas (menunggu persetujuan, koreksi menunggu, belum absen hari ini) di atas kartu statistik umum.
- Grafik tren presensi 30 hari dan 5 kartu ringkasan dipertahankan, digeser ke bawah seksi prioritas.

Kriteria selesai: dari Dashboard, antrean persetujuan terlihat tanpa scroll di layar HP dan desktop; tidak ada fungsi/kartu lama yang hilang.

## R4 — Pola tampilan mobile untuk halaman Kelola (prioritas sedang)

Masalah: desain desktop-first; tabel padat (Karyawan, Absensi, Jadwal) tidak nyaman di layar HP — padahal admin utama bekerja dari HP.

Usulan:
- Di bawah breakpoint `md`, tabel Kelola berubah menjadi daftar kartu (nama + status + 1–2 data kunci + aksi utama), tabel penuh tetap di desktop.
- Sidebar menjadi drawer/rail ikon di mobile; target sentuh minimum 40px untuk aksi utama.
- Berlaku bertahap: Karyawan dan Absensi dulu, lalu Jadwal dan Laporan.

Kriteria selesai: halaman Karyawan & Absensi dapat dipakai penuh dari HP (360px) tanpa scroll horizontal.

## R5 — Micro-interaction & feedback aksi (prioritas sedang)

Masalah: feedback aksi sebatas toast standar template; tidak ada bahasa gerak khas, sehingga keberhasilan aksi kurang terasa pasti.

Usulan (ponytail — pakai yang sudah ada, tanpa library baru):
- Toast sukses dengan ikon + label aksi spesifik (mis. "Disetujui — Absensi Andika"), konsisten di semua mutasi (persetujuan, koreksi, pengumuman).
- Transisi status pada kartu/baris yang berubah (fade/highlight singkat) memakai utilitas Tailwind/animate yang sudah tersedia di template.
- Status simpan pada form Pengaturan menunjukkan "Menyimpan… → Tersimpan" di tempat (inline), bukan hanya toast.

Kriteria selesai: tiga alur utama (setujui pengajuan, proses koreksi, simpan pengaturan) memberi feedback visual yang spesifik dan konsisten.

## Di luar daftar ini (sudah tercatat terpisah, bukan revisi desain)

- `usePublicSettings` masih memanggil API NestJS — urusan integrasi, bukan desain.
- Deep-link Dashboard → Laporan `?view=belum_absen` belum ada target — urusan routing/fungsi.
- `isActiveRecord` mengabaikan `status_akun` — urusan logika data, perlu keputusan terpisah.
- Fix Approvals 2b wajib tetap dibawa (sudah ada di `FIX-approvals-2b.md`).

## Urutan pengerjaan yang disarankan

1. Keputusan Arga: R2 (pilih a/b) dan logo untuk R1.
2. R3 (dampak harian terbesar, murni tampilan).
3. R1 (setelah logo diterima), R4, R5.
4. Verifikasi per item: typecheck/lint/build 0 error + cek visual halaman terdampak, lalu update PR #2.
