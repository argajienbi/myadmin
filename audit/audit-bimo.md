# Laporan Audit — Halaman Kelola + Sistem + Shell (myadmin redesain)

**Ruang lingkup yang dibaca tuntas:** 6 route Kelola, 6 route Sistem, seluruh `features/kelola-sistem/*` (api + page), `app-sidebar`, `notification-bell`, `admin.tsx`, `login/forgot/reset/verify-email`, `auth-context`, `firebase-permissions`, `role-access`, `company-scope`, `use-company`, `routeTree.gen.ts`, plus perbandingan dengan aplikasi lama (`~/workspace/myadmin-source-main`, main @31e4b9b). Read-only; tidak ada file diubah.

**Hasil ringkas:** 2 temuan RUSAK (keduanya merusak data secara diam-diam), 5 temuan SEBAGIAN, 8 CATATAN. Tidak ada TODO/FIXME, tidak ada tombol tanpa handler, tidak ada link mati (17/17 URL sidebar ada di `routeTree.gen.ts`).

---

## RUSAK

### 1. `transferEmployee` menghancurkan record karyawan — sekali pindah struktur, data karyawan hilang
- **File:** `apps/web/src/features/kelola-sistem/employees/api.ts:334-335`
- **Yang terjadi:** `updates[paths.userIndex(uid)] = patch` dan `updates[paths.companyUser(companyId, uid)] = patch`, dengan `patch` hanya berisi 6 field (5 id struktur + `updated_at`). Dalam multi-path `update()` RTDB, nilai objek pada sebuah path **menggantikan seluruh node** di path itu. Setelah klik "Pindahkan", node `users/{uid}` dan `company_users/{company}/{uid}` hanya berisi 6 field itu — nama, email, role, status_akun, position, NIP, no HP, foto, data wajah, perangkat, `created_at` semuanya terhapus. Karyawan praktis lenyap dari sistem (tidak bisa dicari by email, role hilang). Log transfer-nya sendiri sempat tertulis sebelum penghapusan, jadi kerusakannya tidak terlihat dari toast "berhasil".
- **Seharusnya:** tulis per-field (`${path}/area_id`, dst.) seperti yang dilakukan `setEmployeeStatus` di file yang sama (baris 212-215).
- **Vs aplikasi lama:** `Employees.tsx:430+` (`handleTransferEmployee`) hanya menulis field per-field di `company_users` dan **tidak menyentuh `users/{uid}` sama sekali**; plus menulis `last_transfer_id/at/reason` dan `updated_by` — semua itu juga hilang di redesain.
- **Perbaikan:** ubah ke path per-field di kedua node (atau hanya `company_users`, mengikuti aplikasi lama), dan kembalikan field `last_transfer_*`.

### 2. `updateEmployee` menghapus isi node user — sekali "Ubah Karyawan", email/role/foto/wajah/perangkat hilang
- **File:** `apps/web/src/features/kelola-sistem/employees/api.ts:184-185`
- **Yang terjadi:** pola yang sama persis seperti temuan 1 — `updates[paths.userIndex(uid)] = patch` dan `updates[paths.companyUser(...)] = patch`. `patch` hanya berisi 10 field (nama, nip, no_hp, position, status_akun, 5 id struktur, `updated_at`). Yang terhapus dari kedua node: `email`, `role`, `company_id`, `created_at`, `profile_completed`, `face_registered` (+`_at`), `device_id/name`, `qr_token/qr_active`, `photo_url/path`. Sekali admin menyimpan edit apa pun (mis. ganti jabatan), karyawan kehilangan email dan role — efek lanjutannya: tidak bisa login/dikenali, `findUserByEmail` di Pengaturan gagal menemukannya, data wajah & perangkat untuk absensi ikut lenyap. Toast tetap bilang "Data karyawan berhasil diubah."
- **Seharusnya:** tulis per-field, atau `update(ref(db, nodePath), patch)`.
- **Vs aplikasi lama:** `Employees.tsx:609+` (`handleSaveEdit`) memakai path per-field (`${cuPath}/nama_lengkap`, `${userPath}/position`, …) — merge, tidak ada yang hilang. Bukti pola benar ada di file yang sama: `setEmployeeStatus`, `resetEmployeeDevice`, `resetEmployeeFace` semuanya memakai path per-field.
- **Catatan:** `createEmployee` (baris 127-128) memakai pola yang sama tapi aman, karena node-nya baru dan `base` lengkap. `assignCompanyAdmin` (`company-admins/api.ts:64`) juga menimpa node `company_users` dengan isi record `users` — tapi itu sama persis dengan aplikasi lama (`CompanyAdmins.tsx:94-99`), jadi bukan regresi; hanya dicatat di bawah.

## SEBAGIAN

### 3. Pengaturan: field No HP selalu kosong — sekali Simpan profil, nomor HP tersimpan terhapus
- **File:** `apps/web/src/features/kelola-sistem/settings/page.tsx:75`
- **Yang terjadi:** saat sinkronisasi form, kode menulis `setNamaLengkap(firebaseUser?.nama_lengkap ?? "")` tapi `setNoHp("")` — tidak pernah mengambil `firebaseUser.no_hp`, padahal field itu ada di data (`firebase-types.ts:72`). `updateProfile` lalu menulis `no_hp: ""` ke `users/{uid}` (+ `company_users`). Admin membuka Pengaturan, mengubah nama saja, klik Simpan — nomor HP-nya hilang diam-diam. Setelah simpan + refetch, form di-reset lagi ke kosong.
- **Vs aplikasi lama:** `Settings.tsx:45` prefill `(userData)?.no_hp || ""`.
- **Perbaikan:** `setNoHp(firebaseUser?.no_hp ?? "")`.

### 4. `deactivateToken` hanya menulis Firestore — mirror RTDB tetap `active:true`
- **File:** `apps/web/src/features/kelola-sistem/notification-logs/api.ts:366-383`
- **Yang terjadi:** nonaktifkan token hanya `setDoc` Firestore (merge). Mirror RTDB `companies/{id}/users/{uid}/fcm_tokens/{token_id}` tidak disentuh.
- **Vs aplikasi lama:** `NotificationLogs.tsx ~498-513` (`handleDeactivateToken`, PATCH-08) menulis **keduanya** — Firestore merge + `update` RTDB dengan payload sama (`active:false`, `invalidated_at`, `invalid_reason: "manual_deactivation_by_admin"`).
- **Dampak:** tabel "Periksa Token" terlihat benar karena `fetchTokenHealth` (`api.ts:271-280`) membaca keduanya lalu mendeduplikasi per `token_id` (Firestore menang). Tapi pipeline push yang membaca mirror RTDB tetap menganggap token aktif — token yang sudah dinonaktifkan admin tetap bisa menerima push.
- **Perbaikan:** tulis juga ke RTDB seperti aplikasi lama.

### 5. Admin (non-owner) tidak bisa lagi membuka Pengaturan — tidak ada cara ganti sandi sendiri
- **File:** `apps/web/src/routes/admin.settings.tsx:14` + `apps/web/src/lib/firebase-permissions.ts:18-29`
- **Yang terjadi:** route meminta `settings/manage`, tapi `ADMIN_RESOURCES` tidak berisi `"settings"` — admin yang membuka URL langsung mendapat "Akses ditolak". Karena ubah sandi hanya ada di halaman ini, admin PT tidak punya cara apa pun mengganti sandinya sendiri.
- **Vs aplikasi lama:** route `/settings` **tidak digate** (`App.tsx:69`, hanya guard login) dan halaman Settings sendiri menangani non-owner (profil + ubah sandi + website/branding perusahaan sendiri, `Settings.tsx:478, 569`). Sidebar lama memang menyembunyikan menu Settings dari admin (`Layout.tsx:327`, `isOwner &&`), tapi URL langsung tetap bisa dibuka. Komentar di `firebase-permissions.ts` ("cerminan menu sidebar myadmin lama") keliru sebagai pembenaran gate route — menyembunyikan menu ≠ memblokir route.
- **Perbaikan:** izinkan admin ke halaman ini (mis. gate terpisah untuk profil/sandi sendiri) atau turunkan gate route; halaman Pengaturan sendiri sudah siap menampilkan website/branding perusahaan admin.

### 6. Lonceng notifikasi mati total untuk owner
- **File:** `apps/web/src/components/notification-bell.tsx:23-25`
- **Yang terjadi:** `companyId = profile?.company_id ?? ""`, `enabled = Boolean(companyId && uid)`. Profil owner bootstrap punya `company_id: ""` (`auth-context.tsx:144`), jadi query tidak pernah jalan — lonceng owner selamanya "Tidak ada notifikasi", badge tidak pernah muncul. Lapisan kedua: target notifikasi diambil dari `company_users`, dan owner tidak ada di sana, jadi tidak ada penulis yang pernah menulis ke inbox owner. Untuk admin lonceng berfungsi normal.
- **Perbaikan:** pakai perusahaan terpilih dari `useCompanyScope()` untuk owner, atau sembunyikan lonceng untuk owner.

### 7. Link "Lihat semua" di lonceng jalan buntu untuk admin
- **File:** `apps/web/src/components/notification-bell.tsx` (Link ke `/admin/notification-logs`) + `apps/web/src/routes/admin.notification-logs.tsx:68`
- **Yang terjadi:** lonceng tampil untuk semua admin (header `admin.tsx` tanpa gate), tapi route Log Notifikasi `ownerOnly` — sama seperti aplikasi lama (`App.tsx:65`). Admin yang mengklik "Lihat semua" mendarat di layar "Akses ditolak". Untuk owner link berfungsi.
- **Perbaikan:** sembunyikan link itu untuk non-owner.

## CATATAN

- **Komentar "SEAM SEMENTARA" sudah basi** — `settings/api.ts:8-13`: auth Firebase sudah mendarat, tapi `findUserByEmail` masih memindai seluruh node `users` untuk mencocokkan email. Berfungsi, tapi boros; UID sudah tersedia di `useAuth().currentUser.uid`.
- **`assignCompanyAdmin` menimpa node `company_users`** — `company-admins/api.ts:64`: sama persis dengan aplikasi lama, bukan regresi. Efek samping: field yang hanya ada di `company_users` (mis. `qr_token`, `qr_updated_at`, `last_transfer_*`) ikut terhapus saat tunjuk/ganti admin.
- **Stub 2FA tidak pernah tercapai tapi akan meledak bila tercapai** — `auth-context.tsx`: `verifyTwoFactor`/`verifyTwoFactorBackup` melempar error ("tidak dipakai pada login Firebase"), sementara `login-form.tsx` masih punya seluruh UI 2FA (challenge, QR, backup code). Aman hari ini karena `login()` selalu mengembalikan `requiresTwoFactor: false`; bila 2FA diaktifkan nanti, login rusak di langkah verifikasi.
- **Kode undangan tanpa cek keunikan** — `companies/api.ts:98`: `Math.random().toString(36).substring(2,8)` lalu `set()` menimpa bila bertabrakan. Sama persis dengan aplikasi lama (`Companies.tsx:532-544`), bukan regresi; peluang tabrakan kecil.
- **Header tabel tab Perizinan salah label** — `reports/page.tsx`: "Metode / Tipe", "Status / Jarak", "Jadwal / Lokasi" tidak cocok dengan isi (tipe, status, jam lembur). Kosmetik.
- **Guard dependensi Organisasi menghitung karyawan nonaktif sebagai "dipakai"** — `organization/api.ts` (`isActiveRecord` hanya cek `active !== false`, mengabaikan `status_akun` — isu yang sudah diketahui, bukan temuan baru). Efek tambahannya: entitas tidak bisa dinonaktifkan/dihapus selama masih ada karyawan berstatus nonaktif yang terikat.
- **Pola "adjusting state during render"** di `notification-settings/page.tsx` dan `settings/page.tsx` — pola React yang didokumentasikan, berfungsi; efek samping: setelah simpan + invalidate, form kembali ke data server (edit yang belum disimpan hilang).
- **Pesan error login berbahasa Inggris** — `login-form.tsx:57`: "Incorrect email or password." sementara aplikasi berbahasa Indonesia. Kosmetik.

## Yang terverifikasi BERFUNGSI (bukan temuan)
- **DatabaseHealth:** tombol reset benar-benar menghapus path yang dipilih + menulis audit `OWNER_DATABASE_RESET` (urutan benar: audit ditulis setelah hapus, jadi tidak ikut terhapus bila `audit_logs` dipilih). Scan + ringkasan + node terbesar jalan.
- **NotificationLogs:** retry antrean, hapus antrean, reset dedupe, 4 skenario test event, periksa token — semua memanggil Firebase.
- **NotificationSettings:** simpan + clamp menit + mirror legacy `pre_`/`missed_` — lengkap, sesuai aplikasi lama.
- **Reports:** Ambil Data (lean, maks 31 hari — error jelas bila lebih), Legacy Load (confirm + ketik LEGACY), export Excel/PDF + audit `EXPORT_REPORT` — lengkap.
- **Announcements:** buat/draf/terbit (push queue)/arsip/pulihkan — lengkap. Penjadwalan memang "Coming Soon" (disabled) juga di aplikasi lama — bukan kehilangan.
- **Audit:** filter + ekspor CSV — lengkap. **Companies:** buat/ubah/kode undangan/salin/cabut/website/branding/logo — lengkap. **Organization:** CRUD 5 entitas + guard dependensi + pola jam (reuse timetable) + hapus pola — lengkap, sama dengan aplikasi lama (termasuk hapus assignment + shift). **CompanyAdmins:** tunjuk/ganti/cabut — lengkap; "admin lama tidak didemosikan saat diganti" sama dengan aplikasi lama. **AdminGuide:** konten statis + pencarian + filter peran — lengkap.
- **Auth:** login Firebase, lupa sandi, reset sandi, verifikasi email — semua memanggil Firebase Auth. Gate `admin.tsx` menunggu profil settle (`settledStatus`) sehingga tidak ada flash "Akses ditolak" sesaat.
- **Gating route** cocok dengan aplikasi lama, kecuali Pengaturan (temuan 5). Owner-only: company-admins, notification-settings, notification-logs, audit, database-health — sama dengan `App.tsx` lama.

## 3 temuan paling serius
1. **`transferEmployee` (employees/api.ts:334-335)** — sekali pindah struktur, seluruh record karyawan (nama, email, role, status, foto, wajah, perangkat) hilang, tersisa 6 field. Ini yang paling merusak karena aksinya terlihat berhasil.
2. **`updateEmployee` (employees/api.ts:184-185)** — sekali ubah data karyawan, email/role/foto/wajah/perangkat hilang dari kedua node. Setiap edit rutin memicu ini.
3. **No HP terhapus tiap simpan profil (settings/page.tsx:75)** — sekali admin (termasuk owner) menyimpan profil, nomor HP-nya terhapus diam-diam; pasti terjadi pada pemakaian normal pertama.

Nyaris masuk 3 besar: `deactivateToken` tanpa mirror RTDB (temuan 4) dan gate Pengaturan yang mengunci admin (temuan 5).