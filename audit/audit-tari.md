# Laporan Audit — Halaman Utama MyAdmin Redesain

**Pelaksana:** Tari (auditor) + 3 sub-auditor paralel (Approvals, Absensi+Koreksi, Jadwal). **Metode:** baca tuntas `apps/web/src/routes/admin.{dashboard,approvals,attendance,corrections,schedules}.tsx`, seluruh `features/utama/*`, lib terkait, dan pembanding `~/workspace/myadmin-source-main` (main @31e4b9b) + `INVENTORY.md`/`MAPPING.md`. **Read-only, tidak ada file diubah.**

**Kabar baik dulu:** tidak ada tombol/link tanpa handler, tidak ada handler kosong/stub/placeholder, dan tidak ada TODO/FIXME di kelima halaman. Tidak ada navigasi ke route yang tidak ada di `routeTree.gen.ts`. Semua path RTDB yang dipakai cocok dengan aplikasi lama. **Empat klaim terberat saya cek ulang sendiri ke file sumber dan semuanya terkonfirmasi** (ditandai ✅ di bawah).

---

## A. Dashboard (temuan saya sendiri)

### A1. CATATAN — Kartu "Hari Libur Bulan Ini" tidak bisa diklik
- `features/utama/dashboard-page.tsx` (kartu libur, tanpa `onClick`). Aplikasi lama: kartu ini `goToSchedules({tab:"holidays"})` + keyboard handler (`Dashboard.tsx:685-687`). Seharusnya: klik → `/admin/schedules?tab=holiday`.

### A2. CATATAN — Kartu grafik Tren tidak bisa diklik
- `dashboard-page.tsx` (kartu tren, tanpa `onClick`). Aplikasi lama: klik → `goToReports({view:"trend",...})` (`Dashboard.tsx:653`). Catatan: target `?view=trend` juga belum ada di halaman Reports redesain, jadi ini bukan sekadar tambah onClick.

### A3. CATATAN — Kartu "Terlambat Hari Ini" tidak bisa diklik
- `dashboard-page.tsx` (kartu terlambat, tanpa `onClick`). Aplikasi lama: kartu "Papan Kedisiplinan" → `goToReports({view:"discipline"})` (`Dashboard.tsx:802`). Sama seperti A2, target view-nya belum ada di Reports redesain.

### A4. CATATAN — Tombol "Ekspor Laporan" bukan ekspor
- `dashboard-page.tsx`: tombol itu hanya `<Link>` ke `/admin/reports`, bukan mengunduh file. Aplikasi lama tidak punya tombol ini, jadi bukan regresi — tapi labelnya menyesatkan; seharusnya "Lihat Laporan" atau benar-benar mengekspor.

### Dashboard yang bersih
Semua path data (`dashboardSummary`, `pendingApprovalSummary`, `attendanceRecent`, `companyUsers`, `offices`, `departments`, `employeeGroups`, `holidays`, `scheduleSpecials`) cocok dengan aplikasi lama; `lib/rtdb-lean-service.ts` bersih (hanya throw validasi). Kartu "Belum Absen" → `/admin/reports` tanpa param adalah item deep-link yang sudah diketahui — tidak diulangi.

---

## B. Persetujuan (`features/utama/approvals-page.tsx`, 1.259 baris)

### B1. SEBAGIAN ✅ — Baris QR tampil sebagai "Karyawan" / NIP "-"
- `format.ts:13-19` — `employeeName()` hanya memeriksa `user_name || nama_lengkap || employee_name || name`, fallback `"Karyawan"`; field `target_name` tidak termasuk. `approvals-page.tsx:991-997` memakai helper ini untuk **semua** jenis termasuk QR; ekspor CSV (`:913-914`) ikut berisi "Karyawan". Seharusnya: baris QR menampilkan `target_name`, seperti aplikasi lama (`Approvals.tsx:974` di tabel, `:1190` di modal). Nama helper dan kantor target/helper juga tidak tampil di mana pun — hanya dipakai di pesan notifikasi (`:674`) dan payload tulis (`:624`).

### B2. SEBAGIAN — Informasi audit QR hilang dari modal detail
- `approvals-page.tsx:100-118` — daftar QR hanya menampilkan teks `di luar radius X m` bila di luar radius; modal detail (`:1119-1259`) hanya dl generik + kartu foto + kartu lampiran. Tidak ada: nama helper & kantor, status radius dalam/luar lengkap (meter), tautan Google Maps, spek foto, peringatan mock-location, risk level. Aplikasi lama punya kolom Target User, Didaftarkan Oleh, "Lihat Lokasi" (`Approvals.tsx:963-964, 1005`) dan di modal "Dalam/Luar Radius (X m / Y m)" + "⚠️ Lokasi Palsu Terdeteksi!" (`:1225`). Ini inti pemeriksaan fraud QR; datanya tetap ditulis ke record absensi (`:521-525` menyalin `mock_location_detected`), hanya tidak pernah ditampilkan — admin menyetujui secara buta.

### B3. SEBAGIAN ✅ — Tab tidak bereaksi saat navigasi dalam halaman yang sama
- `approvals-page.tsx:173-177` — `tab` diinisialisasi sekali dari `initialTab` via `useState`, tanpa `useEffect` sinkronisasi. Jika sudah berada di `/admin/approvals` lalu mengklik kartu Dashboard "Izin/Sakit/Cuti" (`dashboard-page.tsx:700-705`, `search: { tab: "izin", ... }`), tab tidak berpindah. Aplikasi lama memakai `useEffect` atas `searchParams` (`Approvals.tsx:119-124`). Filter `status=pending` tidak terkena karena `queryStatus` diturunkan langsung dari prop tiap render (`:188`). Tambahan: nilai tab lama `?tab=leave|qr|correction` kini jatuh ke "semua" karena hanya `izin|qr|koreksi` yang dikenali.

### B4. SEBAGIAN — Param `date` divalidasi route tapi dibuang
- `routes/admin.approvals.tsx:12-15,24` — `validateSearch` menerima `date`, tapi komponen hanya menerima `initialTab` dan `initialStatus`; `date` tidak diteruskan dan `ApprovalsPage` tidak punya filter tanggal. Kartu Dashboard mengirim `date: selectedDate` (`dashboard-page.tsx:700-705`) — diam-diam diabaikan. Aplikasi lama juga tidak memakai `date`, tapi komentar route (`admin.approvals.tsx:2`) mengklaim deep-link `?tab=...&date=...` didukung. Deep-link mati.

### B5. SEBAGIAN — Owner tidak bisa ganti perusahaan dari halaman Persetujuan
- Aplikasi lama punya dropdown "Pilih Perusahaan" (`Approvals.tsx:792-800`). Redesain tidak merender pemilih perusahaan, padahal `useCompany()` menyediakan `setCompanyId`/`selectCompany` (`lib/use-company.ts`); halaman lain melakukannya (organization `:114,395`, reports `:118,416`, audit `:34`). Owner terkunci pada perusahaan pertama/pilihan `localStorage` terakhir dan harus pindah halaman untuk menggantinya.

### B6. SEBAGIAN — Tidak ada status loading; daftar kosong palsu saat data dimuat
- `approvals-page.tsx:931` — guard hanya `if (!userData && !companyLoading)`; `:971` — saat ketiga listener belum mengembalikan data, tabel langsung menampilkan "Tidak ada pengajuan pada tab ini." Tidak ada skeleton/indikator muat (grep `loading` hanya menemukan `companyLoading` di `:166` dan teks toast `:892`). Aplikasi lama menampilkan "Memuat data persetujuan..." (`Approvals.tsx:807`) plus kotak diagnosis error. Error muat di redesain hanya lewat toast `onError`, tanpa tampilan persisten.

### B7. SEBAGIAN — Detail lembur dan rentang tanggal izin menyusut
- `format.ts:74-81` — `durationLabel()` hanya membaca `start_date || date` dan `end_date`; `approvals-page.tsx` hanya membaca `date || tanggal || start_date`. Field `date_start / tanggal_mulai / date_end / tanggal_selesai` tidak dibaca. Aplikasi lama punya fallback lengkap (`Approvals.tsx:57-58`) dan untuk lembur menampilkan `overtime_date`, jam mulai–selesai, durasi menit (`:883-887`). Di redesain tidak ada satu pun field `overtime_*` pengajuan yang dibaca. Bila record izin memakai `date_start`, kolom Detail/Tanggal menampilkan "-" atau tanggal fallback dari `created_at`.

### B8. SEBAGIAN — Koreksi `masuk_pulang`: hanya separuh (masuk) yang tampil
- `approvals-page.tsx:122-133` — `requestDetailText()` untuk `masuk_pulang` hanya menampilkan jam Masuk; `:1119` dan `:353-360` — modal hanya punya satu pasang lama→baru (`detailOldTime/detailNewTime` diisi check-in kecuali `corrType === "pulang"`). Aplikasi lama menampilkan baris Masuk **dan** Pulang di tabel (`Approvals.tsx:1084-1090`) dan di detail (`:1293-1299`). Admin tidak bisa memeriksa jam pulang yang diajukan untuk koreksi gabungan.

### B9. SEBAGIAN — Kolom Lampiran dan peringatan bukti sakit hilang dari tabel izin
- Aplikasi lama punya kolom Lampiran per baris izin (tombol buka lampiran) plus peringatan "Bukti sakit wajib untuk data baru" bila `attachment_required`/sakit tanpa file (`Approvals.tsx:915`, `attachmentSource` di `:60`). Redesain: tabel tanpa kolom Lampiran; lampiran izin hanya terlihat di dalam modal, dan kartu keduanya berjudul hardcoded "Lampiran Koreksi" (`approvals-page.tsx:1182`) — label salah untuk pengajuan izin. Tidak ada lagi modal preview gambar dengan penanganan gagal muat seperti `previewAttachment` lama; redesain hanya memberi tautan "Buka lampiran".

### B10. CATATAN — "Data lama" koreksi kini dibaca dari record live, bukan snapshot
- Aplikasi lama menampilkan `old_attendance` / `old_attendance_snapshot` dari record koreksi (`Approvals.tsx:1306-1322`). Redesain membaca record absensi saat ini (`approvals-page.tsx:315-360`) untuk mengisi "Tercatat". Bila record berubah setelah pengajuan dibuat, yang tampil nilai terkini, bukan snapshot saat pengajuan — jejak audit "apa yang diajukan terhadap apa" hilang bila record sudah berubah. Bisa dianggap perbaikan, tapi perubahan perilaku.

### B11. CATATAN — Fix bug 2b diterapkan benar, dengan satu celah forward-compat
- `approvals-page.tsx:712-832` — `buildRecord()` melakukan `...existing` (mempertahankan `photo_url/photo_path` lama) dan menulis lampiran hanya ke `correction_attachment_url/path` dari `attachment_url/path` (`:827-832`). Sesuai `FIX-approvals-2b.md`; tidak ada penimpaan `photo_url` di file ini. Celah: `buildRecord` tidak pernah membaca `actionReq.correction_attachment_url/path`, sementara `openDetail` justru membacanya lebih dulu (`:336-351`) — tampilan mendukungnya tapi aksi setujui akan membuangnya bila suatu saat pengajuan membawa lampiran di field tersebut. Saat ini tidak ada data live yang memakai field itu (grep di repo lama = 0), jadi celah masa depan, bukan bug aktif.

### B12. CATATAN — Inkonsistensi kecil di `confirmAction`
- `approvals-page.tsx:454` — cabang QR menulis `admin_note` tanpa `trim()`, sementara izin/koreksi memakai `noteText` yang sudah di-trim (kosmetik). `:698-700` — cabang koreksi membaca `corrType` hanya dari `correction_type`, tanpa fallback `corr_type` seperti `openDetail` (`:327`) dan `requestDetailText` (`:122`); record yang memakai `corr_type` akan diproses sebagai "masuk". Aplikasi lama juga hanya memakai `correction_type` (`Approvals.tsx:535`), jadi inkonsistensi internal redesain, bukan regresi.

### Persetujuan yang bersih
Semua tombol (Detail, Tutup, Tolak, Setujui, Ekspor CSV, tab) punya handler; tidak ada `TODO/FIXME/XXX`, handler kosong, atau `console.error`. Tidak ada `Link/navigate` di halaman ini; route `/admin/approvals` ada di `routeTree.gen.ts:162,374-377`. Path RTDB (`leave_requests`, `qr_attendance_requests`, `attendance_corrections`, `company_users`, `attendance/{company}/{uid}/{date}/{masuk|pulang}`) identik dengan lama. Aksi tulis Setujui/Tolak ketiga jenis memanggil `update()` RTDB + `writeAuditLog` + `createNotification` (`:365-905`); tolak wajib isi alasan; double-submit dijaga `processingRef` + `savingAction`; status dicek ulang sebelum tulis. Persetujuan izin tidak membuat record absensi — sama seperti lama, bukan regresi. Ekspor CSV berfungsi (fitur baru; lama tidak punya ekspor di halaman ini). Perbaikan vs lama: `statusLabel` baru mengembalikan "Menunggu" untuk pending; lama mengembalikan "Selesai" untuk status apa pun yang bukan approved/rejected.

---

## C. Absensi (`features/utama/attendance-page.tsx`)

### C1. SEBAGIAN — Pencarian tidak lagi mencakup NIP / kantor / departemen / grup
- `attendance-page.tsx:195-205` — pencarian hanya mencocokkan nama karyawan dan `dateKey`. Aplikasi lama (`Attendance.tsx`, `filteredData`) mencari di `user_name, nip, record_date, office_name, department_name, sub_department_name, group_name`. Placeholder-nya sendiri masih "Cari nama karyawan atau tanggal..." dan NIP ditampilkan di tabel (~baris 560-an) tapi tidak bisa dicari.

### C2. SEBAGIAN — Filter Status kehilangan opsi izin/sakit/cuti/alpha/libur; "Hadir" tidak lagi mencakup `approved`
- `attendance-page.tsx:226-248` (logika), `:491-499` (opsi hanya Hadir/Terlambat/Luar Radius/Pulang Cepat). Aplikasi lama punya opsi Hadir/Terlambat/Izin/Sakit/Cuti/Alpha/Libur, dan "Hadir" mencocokkan `success/approved/valid/on_time/tepat_waktu`. Di redesain, record yang hanya punya `status: "approved"` tanpa `attendance_status` tidak masuk filter "Hadir" (cabang `:226` hanya menerima `hadir`/`success`/kosong), dan status izin/sakit/cuti/alpha/libur sama sekali tidak bisa difilter.

### C3. SEBAGIAN — Tampilan lokasi/peta hilang total
- `attendance-page.tsx:617-678` (dialog Detail). Aplikasi lama punya tombol "Lokasi" per baris + modal berisi latitude, longitude, jarak, radius office, dan tautan "Buka di OpenStreetMap" (`Attendance.tsx:505-512` + modal lokasi). Di redesain, dialog Detail hanya menampilkan foto, jadwal, office, status, jarak/radius, sumber — **tidak ada koordinat dan tidak ada tautan peta**, padahal data `latitude`/`longitude` ikut terbawa di row (spread `recObj` di `rtdb-lean-service.ts`). Admin bisa melihat badge "Luar Radius" tapi tidak bisa memverifikasi lokasi klaim tersebut.

### C4. SEBAGIAN — Filter Aksi kehilangan opsi lembur
- `attendance-page.tsx:410-417` (hanya Masuk/Pulang). Aplikasi lama punya `lembur_masuk`/`lembur_pulang`. `isCheckIn`/`isCheckOut` (`attendance-utils.ts`) memang menggabungkan lembur ke Masuk/Pulang, tapi lembur tidak bisa difilter secara khusus. Dampak rendah — klasifikasi tidak rusak, hanya granularitas filter berkurang.

### C5. CATATAN — Sub-departemen tidak dimuat/ditampilkan sama sekali
- `attendance-page.tsx` (tidak ada pemanggilan `paths.subDepartments`); bandingkan `Attendance.tsx` lama (filter + kolom "Sub"). Diakui sebagai deviasi di komentar header baris 1-8 ("mockup hanya punya 8 filter") — disengaja, tapi tetap kehilangan informasi yang dulu ada di tabel.

### C6. CATATAN — Auto-load menggantikan tombol "Ambil Data" + tidak ada Reset Filters
- `attendance-page.tsx:168-182` (effect auto-load tiap ganti tanggal). Aplikasi lama sengaja tidak auto-load ("Data tidak disinkron otomatis untuk menghemat bandwidth RTDB") dan punya tombol "Ambil Data" + "Reset Filters". Redesain memuat otomatis saat mount dan setiap perubahan tanggal (rentang s.d. 31 hari = s.d. 31 request `attendance_by_date` per perubahan). Validasi rentang sudah ditangani (`assertSafeDateRange` → toast error, `:175-179`). Perilaku disengaja dan lebih nyaman, tapi biaya baca RTDB naik; tidak ada tombol reset filter.

### C7. CATATAN — Search params hanya dibaca sekali saat mount
- `attendance-page.tsx:105-137` (`useState(search.…)` sebagai initializer). Bila sudah berada di `/admin/attendance` lalu bernavigasi lagi ke route yang sama dengan param berbeda, filter tidak ikut berubah. Dampak rendah: tidak ada navigasi internal semacam itu dari halaman ini; deep-link dari Dashboard (`dashboard-page.tsx:652-675,880,921-939`) selalu me-mount baru dan paramnya (`status: "hadir"/"terlambat"`, `action: "masuk"`, `search: <nama>`) semuanya valid dan dipakai.

### C8. CATATAN — Foto: perbaikan diam-diam, tanpa fallback
- `attendance-page.tsx:280-288` membaca `photo_url`/`photo_path`. Aplikasi lama membaca `foto_url`/`foto_path` (`Attendance.tsx:493-495`), padahal penulis data (Approvals lama `:609,679`) menulis `photo_url`/`photo_path` — jadi foto di halaman lama kemungkinan memang tidak pernah tampil. Redesain memakai field yang benar dan foto tampil di dialog. Tidak ada fallback ke `foto_url`; tidak ditemukan penulis `foto_url` di repo lama, jadi risikonya rendah.

### Absensi yang bersih
Ekspor CSV berfungsi (`exportCsv` `:289-327`, `downloadCsv` di `format.ts:114-131`, mengekspor baris terfilter). Dialog Detail menampilkan foto via `getFileUrl` (tahan string kosong, `firebase.ts:108-111`). Filter Metode/Kantor/Departemen/Grup/Geofence semuanya bekerja dan memakai data master yang benar. Pemilih perusahaan owner bukan hilang — pindah ke shell global via `useCompany` (`admin_selected_company`). Semua 11 search param route Absensi divalidasi (`routes/admin.attendance.tsx:11-24`) dan dipakai. Path RTDB (`attendance_by_date`, `attendance/{c}/{uid}/{date}/{action}`, `attendance_corrections/{c}`) cocok dengan lama dan INVENTORY.md.

---

## D. Koreksi Absensi (`features/utama/corrections-page.tsx`)

### D1. SEBAGIAN ✅ — Penulisan koreksi tidak lagi atomik (regresi dari aplikasi lama)
- `corrections-page.tsx:336-393` — redesain memakai **4 tulis berurutan yang terpisah**: `set(correctionRef)` `:336`, `set(recordPath)` `:354`, `writeAuditLog` `:372`, `createNotification` `:381`. Aplikasi lama menyimpan koreksi + record absensi + audit log dalam **satu** `update()` multi-path atomik (`AttendanceCorrections.tsx`, `saveCorrection`, `update(ref(db), updates)` di `:230`). Jika `set` record gagal setelah koreksi ter-push (atau sebaliknya), data menjadi setengah: entri koreksi tercatat tapi absensi tidak terkoreksi, atau absensi berubah tanpa jejak koreksi. Tidak ada rollback/kompensasi.

### D2. SEBAGIAN — Opsi Status Absensi form tinggal 3 dari 6
- `corrections-page.tsx:620-622` (hanya Hadir/Terlambat/Luar Radius). Form lama punya Hadir/Terlambat/**Izin/Sakit/Cuti**/Luar Radius (`AttendanceCorrections.tsx`, select `attendance_status`). Redesain tidak bisa menginput koreksi berstatus izin, sakit, atau cuti.

### D3. CATATAN — Prefill dari masalah tidak mengisi waktu/status yang masuk akal
- `corrections-page.tsx:282-290` — `prefillFromProblem` hanya mengisi karyawan/tanggal/tipe/alasan; waktu tetap default `07:58` dan status tetap `hadir` — untuk masalah "Pulang lebih awal" (check_out) default 07:58 jelas salah konteks. Aplikasi lama mengosongkan `new_value` (wajib diisi admin). Terkait: setelah simpan, masalah dihapus dari daftar hanya bila `p.issue === formReason.trim()` (`:395`) — bila admin mengubah teks alasan sebelum simpan, masalah basi tetap tampil sampai reload.

### D4. CATATAN — Form tidak di-reset setelah simpan
- `corrections-page.tsx:400-401` (hanya `setFormReason("")` + `setFormFile(null)`). Karyawan/tanggal/tipe/waktu/status tetap terisi setelah "Koreksi berhasil disimpan". Aplikasi lama menutup modal dan mengosongkan `formData`. Risiko: klik "Simpan Koreksi" kedua kali tanpa sadar akan menduplikasi entri riwayat koreksi (record absensi sama tertimpa nilai identik, tapi `push` koreksi baru tercatat).

### D5. CATATAN — Deteksi masalah: N request per karyawan + urutan tak tentu
- `corrections-page.tsx:130-270` — deteksi memakai satu `get(attendance/{c}/{uid}/{today})` per karyawan aktif (plus `resolveScheduleForUser` per karyawan yang masing-masing melakukan beberapa `get`), versus aplikasi lama satu bulk `get(attendanceRoot)` untuk seluruh karyawan. Untuk ~200 karyawan aktif, setiap buka halaman = ratusan baca RTDB. Selain itu `Promise.all` + `found.push` membuat urutan daftar masalah nondeterministik; lama diurutkan per UID. Dampak: biaya/latensi, bukan kerusakan fungsi.

### D6. CATATAN — Field `correction_id` hilang dari dalam record koreksi
- `corrections-page.tsx:336-353` — aplikasi lama menulis `correction_id` di dalam `correctionData`; redesain hanya menulisnya di record absensi (`correction_id: correctionId`, `:366`), tidak di record koreksinya. Tidak ditemukan pembaca field tersebut di repo (termasuk `approvals-page.tsx`), jadi dampak saat ini rendah — tapi format data berubah dari lama.

### Koreksi yang bersih
Form submit benar-benar menyimpan: koreksi + timpa record + audit + notifikasi, dan lampiran masuk `correction_attachment_url/path`, **tidak pernah** ke `photo_url` (inti fix bug 2b dijaga, `:321-335`). Deteksi masalah menangani **kedua** bentuk kunci aksi (`check_in`/`masuk`, dst. via `pickAction` `:66-75`) — perbaikan atas lama yang melewatkan record `masuk`/`pulang` dari approval QR. Tidak ada false positive libur: `resolveScheduleForUser` baru sudah mengembalikan `todayActive: false` saat libur (`schedule-data.ts:356-364`), sehingga pengecekan `scheduleReady && todayActive` (`:236-246`) sudah benar tanpa perlu cek `schedule_source === "holiday"` seperti lama. Riwayat koreksi terurut `created_at` desc, dibaca live via `manualListen` (`:250-278`); gate permission memakai resource `approvals` yang **ada** di katalog (`packages/contracts/src/permissions.ts:20,52-53`). Tidak ada pengajuan koreksi dari karyawan yang hilang — aplikasi lama juga hanya punya input admin + daftar masalah (persetujuan pengajuan ada di halaman Approvals, bukan di sini).

---

## E. Jadwal Kerja (`features/utama/schedules-page.tsx` 2.059 baris, `schedule-data.ts` 1.071, `schedules-forms.tsx` 842)

### E1. RUSAK ✅ — Resolver jadwal tidak pernah mengenali lembur yang dibuat halaman ini
- `schedules-forms.tsx:437-440` (save overtime): yang ditulis justru `mode: "group"`, `target_type: "group"`, `target_uids: {uid: true}` — tanpa `type` dan tanpa `target_id`. `schedule-data.ts:302-326` (`resolveScheduleForUser`): pencocokan lembur mensyaratkan `item.type === "user"/"group"` dan `item.target_id === uid / group_id`. Maka `matchUser`/`matchGroup` selalu false, `selectedOvertime` selalu null. **Saya verifikasi sendiri:** save menulis `date_start`/`date_end` (tanggal pertama/terakhir yang dipilih) sehingga cek tanggal resolver bisa lolos — yang fatal hanya pencocokan target. Akibat: karyawan yang dijadwalkan lembur — termasuk lembur di hari libur — oleh resolver dianggap libur (`schedule-data.ts:356-364`, cabang holiday menang karena `selectedOvertime` null) atau tanpa jadwal. Resolver ini dipakai halaman Approvals/presensi, jadi lembur tidak berlaku di jalur absensi. Kontradiksi internal: `diagnoseEmployeeSchedule` memakai `target_uids` + `dates` (`schedule-data.ts:~640-660`, via `dateMatchesItem`/`targetMatchesUid`) sehingga diagnostik berkata "Jadwal Lembur Aktif" sementara resolver berkata libur/tanpa jadwal. Catatan kejujuran: bug ini **diwarisi dari aplikasi lama** (resolver lama `scheduleResolver.ts:102-103` dan save lama `Schedules.tsx:1040-1055` punya format yang sama) — bukan diperkenalkan redesain, tapi tetap rusak di produksi dan kini terdokumentasi.

### E2. RUSAK — Hapus & nonaktifkan tidak mengirim notifikasi (regresi dari lama)
- `schedules-forms.tsx:791-816` (`toggleScheduleActive`) dan `:817-842` (`deleteScheduleItem`): hanya `update`/`set(null)` + `writeScheduleChangeLog` + toast. Tidak ada pemanggilan `sendScheduleChangeNotifications`. Pembanding lama: `Schedules.tsx:1274-1370` (toggle mengirim notifikasi per tab: timetable/shift/assignment/special/overtime/holiday) dan `:1457-1555` (delete mengirim "Jam Kerja Dihapus", "Pola Shift Dihapus", "Penerapan Jadwal Dihapus", dst. ke karyawan terdampak). Akibat: karyawan tidak tahu jadwalnya dihapus/dinonaktifkan. Save (`schedules-forms.tsx:507-680`) masih mengirim notifikasi — hanya toggle/delete yang bisu. Semua pemanggilan `sendScheduleChangeNotifications` di file ini hanya dari jalur save (baris 519, 545, 575, 605, 631, 656).

### E3. RUSAK — Edit Hari Libur tidak bisa dijangkau dari UI
- `schedules-page.tsx:1481` — satu-satunya pemanggil `openForm("holiday")` adalah tombol "Tambah Hari Libur" (tanpa item). Tabel libur (`:1500-1540`) hanya punya tombol **Hapus**, tanpa Edit dan tanpa Nonaktifkan. Padahal logika edit libur lengkap dan hidup di `schedules-forms.tsx:118-124` (`defaultFormData` holiday, `id = item.date`), `:473-492` (hapus node tanggal lama bila tanggal diubah; `manual_override` untuk `source === "google_calendar"`). Semua itu kode mati via UI. Akibat turunan: libur `google_calendar` yang seharusnya bisa di-override manual tidak bisa diedit; libur nonaktif (mis. dari aplikasi lama) tidak bisa diaktifkan kembali kecuali hapus + tambah ulang.

### E4. SEBAGIAN — Jadwal Khusus & Hari Libur tidak bisa dinonaktifkan sama sekali
- Form `special` (`schedules-page.tsx:~440-520`) dan `holiday` (`:~410-440`) **tidak punya checkbox "Aktif"** — checkbox itu hanya ada di timetable (`:208`), shift (`:280`), assignment (`:404`), overtime (`:653`). Tabel keduanya juga tidak punya tombol toggle. Komentar header `schedules-page.tsx:8` mengklaim "penonaktifan tab lain tetap bisa lewat checkbox 'Aktif' di form edit" — klaim ini **salah** untuk holiday & special. `toggleScheduleActive` (`schedules-forms.tsx:791`) mendukung semua tab, tapi halaman hanya memanggilnya untuk timetable (`schedules-page.tsx:1199`). Special yang terlanjur `active: false` tidak bisa diaktifkan kembali lewat UI mana pun (edit pun mempertahankannya karena `defaultFormData` menyebar `...item`).

### E5. SEBAGIAN — Jam Kerja & Pola Shift tidak bisa dihapus
- Timetable (`schedules-page.tsx:1191-1215`): hanya Edit + Aktifkan/Nonaktifkan. Shift (`:1368`): hanya Edit. Tidak ada tombol Hapus; `setDeleteTarget` hanya dipanggil untuk assignment/holiday/special/overtime (`:1454, :1534, :1633, :1727`). Lama (`Schedules.tsx:1457-1555` + tabel tiap tab): Hapus tersedia untuk keenam tab. Komentar header halaman menyebut ini mengikuti mockup — jadi disengaja per mockup, tapi tetap kehilangan fungsi vs aplikasi lama: timetable/shift yatim hanya bisa dinonaktifkan, tidak pernah dibersihkan.

### E6. SEBAGIAN — Mode shift "Senin–Minggu" menyesatkan; preset & perbaikan shift hilang
- `schedules-page.tsx:229-240`: Select "Mode Hari Kerja" hanya berisi `custom` dan `full_week`; memilih `full_week` hanya mengubah string mode, **tidak mencentang 7 hari dan tidak mengisi timetable**. Simpan lalu gagal: `schedules-forms.tsx:295-305` melempar "Mode Senin-Minggu wajib mengaktifkan semua hari". Lama punya tombol preset "Aktifkan Senin–Minggu / Senin–Jumat / Kosongkan Hari" (`Schedules.tsx:2472-2488`, `applyShiftPreset` `:1379-1407`, mengisi fallback timetable otomatis) dan tombol tabel "Set Senin-Minggu" (`:2083`, `repairShiftToFullWeek` `:1409-1455` + log `REPAIR_SHIFT_FULL_WEEK`). Keduanya hilang. Mode `weekday` (Senin–Jumat) hilang dari Select; shift lama bermode `weekday` dipertahankan mentah oleh `defaultFormData` (`schedules-forms.tsx:97`), sehingga Select menampilkan nilai tanpa opsi yang cocok (trigger kosong).

### E7. SEBAGIAN — Deep-link `?tab=` setengah jalan
- `routes/admin.schedules.tsx:2` mendokumentasikan `?tab=ringkasan|...`, tapi id tab sebenarnya `summary` (`schedules-page.tsx:676-680`); `?tab=ringkasan` hanya "kebetulan benar" karena fallback ke summary. Tidak ada alias seperti aplikasi lama (`Schedules.tsx:583-602`: `holidays`/`hari_libur` → holiday, `timetables` → timetable, `shifts`, `assignments`, `specials`). `?tab=holidays` jatuh diam-diam ke Ringkasan. `schedules-page.tsx:683-685`: `initialTab` hanya dipakai sebagai initializer `useState` — tidak ada efek sinkronisasi bila search param berubah saat halaman sudah termuat; klik tab (`UtamaTabs`, `ui.tsx:~88-120`) hanya `setTab` lokal dan **tidak pernah menulis URL**, jadi tab tidak bisa dibagikan/di-bookmark setelah diklik dan tombol back tidak mengganti tab. Tidak ada satupun tautan masuk `?tab=` di redesain (hanya sidebar `/admin/schedules` polos, `app-sidebar.tsx:65`).

### E8. SEBAGIAN — Diagnostik: warna menyesatkan, data diambil tapi tidak ditampilkan
- `schedules-page.tsx:1787-1792`: warna hasil hanya dari `diagnosticResult.ok` (hijau vs kuning). "Hari Libur" dan "Hari Libur Rutin" punya `ok: true, canAttend: false` (`schedule-data.ts:651,680`) sehingga tampil hijau "sukses" persis seperti "Jadwal Siap". Lama membedakan tiga warna dari `canAttend`/`ok` (`Schedules.tsx:1991`). `officeName` dan `dayKey` dihitung di `diagnoseEmployeeSchedule` (`schedule-data.ts:616-625`) tapi **tidak pernah dirender** di halaman (daftar `<dl>` hanya Karyawan, Sumber, Jadwal aktif, Jendela check-in/out, "Hari libur?"). "Hari libur?" (`schedules-page.tsx:1836`) diturunkan dari `status === "Hari Libur"` saja — lembur di hari libur dilaporkan sebagai "Tidak — hari kerja biasa". Dropdown karyawan diagnostik hanya karyawan aktif (`getActiveEmployees`); lama memakai semua karyawan.

### E9. SEBAGIAN — Peringatan Ringkasan & kolom Libur dari lama hilang
- Ringkasan lama (`Schedules.tsx:1910-1950`): peringatan karyawan tanpa grup, karyawan tanpa kantor, dan pola shift tidak lengkap (hari aktif tanpa timetable). Redesain (`schedules-page.tsx:~1010-1110`) hanya menampilkan 4 kartu angka + penerapan hari ini — ketiga peringatan hilang. Tabel libur lama (`Schedules.tsx:2196-2225`): kolom Status Pembayaran (Paid/Unpaid) + badge "Override Manual"; form lama (`:2584-2605`): field Keterangan/Note + checkbox Paid Holiday. Redesain (`schedules-page.tsx:1500-1540`, form `:~410-440`): hanya tanggal/judul/sumber (Google Calendar vs Manual) — libur hasil override manual salah label "Manual", dan `paid`/`note` tidak bisa diisi untuk libur baru (nilai lama yang tersimpan ikut tersebar lewat `...item` tapi tidak terlihat/diubah).

### E10. CATATAN — Inkonsistensi ketat/longgar soal `active` di resolver vs diagnostik
- Resolver: libur harus `active === true` (`schedule-data.ts:299`); overtime/assignment/special dilewati bila `!item.active` (`:310, :461`) — record lama tanpa field `active` dianggap **nonaktif**. Diagnostik/summary/daftar memakai `active !== false` — record yang sama dianggap **aktif**. Diwarisi dari lama (resolver lama sama ketatnya), tapi divergensinya nyata: satu record bisa "libur" menurut diagnostik dan "bukan libur" menurut resolver.

### E11. CATATAN — `schedules-forms.tsx:787` "Tab tidak mendukung operasi ini": praktis tidak pernah terpicu
- `scheduleItemPath` melempar itu hanya untuk tab `summary`/`diagnostic`/`logs`. Via UI tidak ada jalurnya: toggle hanya dipanggil untuk timetable (`schedules-page.tsx:1199`), `deleteTarget` hanya untuk assignment/holiday/special/overtime. Jadi throw ini kode defensif mati, bukan bug hidup. Namun ada laten di sebelahnya: `saveScheduleItem` (`schedules-forms.tsx:236-253`) **tidak** memakai `scheduleItemPath` — untuk tab summary/diagnostic/logs, `listPath` tetap `""` dan cabang else akan `push(ref(db, ""))` alias menulis ke root RTDB. Saat ini tidak terjangkau karena `openForm` hanya dipanggil dengan 6 tab CRUD, tapi tidak ada penjaga eksplisit di `saveScheduleItem`.

### E12. CATATAN — Tabel lembur kehilangan konteks; master karyawan/grup hanya di-fetch sekali
- Tabel lembur (`schedules-page.tsx:1680-1740`) hanya menampilkan `target_count` + rentang tanggal pertama–terakhir; lama menampilkan nama karyawan (s.d. 3), jam kerja, note, dan chip tiap tanggal (s.d. 4). Rentang pertama–terakhir menyesatkan bila tanggal lembur tidak berurutan. Karyawan/grup dimuat sekali via `get` (`schedules-page.tsx:802-803`), bukan listen seperti 7 koleksi jadwal (`:740-800`): perubahan karyawan/grup saat halaman terbuka tidak terlihat sampai refresh; bila fetch gagal, data perusahaan sebelumnya tetap tampil (hanya toast error).

### Jadwal yang bersih
Tidak ada TODO/FIXME/stub/handler kosong di ketiga file (grep kosong; satu-satunya `console.warn` di `schedule-data.ts:1066` disertai `toast.error` nyata; `console.info` di `:~1035` hanya untuk nol target notifikasi). Semua tombol di halaman punya handler; semua form tambah/edit 6 tab memanggil `saveScheduleItem` yang menulis Firebase (`set`/`push`/`update`). Tidak ada `Link`/`href`/`navigate` di dalam `schedules-page.tsx`; satu-satunya route `/admin/schedules` ada di `routeTree.gen.ts:465-468` dan sidebar (`app-sidebar.tsx:65`). Tidak ada tautan mati. Path RTDB (`timetables/`, `shifts/`, `schedule_assignments/`, `holidays/{company}/{date}`, `schedule_specials/`, `overtime_schedules/`, `schedule_change_logs/`) semuanya cocok dengan `firebase-paths.ts` dan `INVENTORY.md:40,61`. Kunci hari `monday..sunday` konsisten (`SHIFT_DAY_KEYS`, `schedule-data.ts:19-26`). Semua 9 tab berfungsi (ringkasan/timetable/shift/assignment/holiday/special/overtime/diagnostic/logs): masing-masing merender dan membaca datanya; tidak ada tab kosong. Export: tidak ada di aplikasi lama maupun redesain — bukan regresi.

---

## F. Pola lintas halaman (temuan sintesis saya)

1. **State tidak sinkron dengan search param saat navigasi dalam halaman yang sama** — muncul di 3 halaman: Approvals tab (B3), Attendance filter (C7), Schedules tab (E7). Semuanya memakai `useState(initial...)` tanpa `useEffect` sinkronisasi. Satu pola perbaikan (mis. `useEffect` atas prop search, seperti aplikasi lama) menutup ketiganya sekaligus.
2. **Bukti verifikasi geofence hilang** — Approvals QR kehilangan info audit lokasi (B2) dan Attendance kehilangan koordinat + tautan peta (C3). Dua halaman yang justru menampilkan badge "Luar Radius" sama-sama tidak memberi admin cara memverifikasi klaim lokasi itu.
3. **Filter menyusut vs aplikasi lama** — pencarian Absensi tanpa NIP/kantor (C1), filter Status tanpa izin/sakit/cuti/alpha/libur (C2), form Koreksi tanpa status izin/sakit/cuti (D2), filter Aksi tanpa lembur (C4). Bukan tombol mati, tapi kemampuan menyaring yang dulu ada.

---

## 3 temuan paling serius

1. **Resolver lembur tidak pernah cocok (E1, RUSAK)** — lembur yang dibuat lewat halaman Jadwal tidak berlaku di jalur resolusi jadwal efektif (presensi/approvals), dan diagnostik di halaman yang sama mengklaim sebaliknya. Ini bug perilaku inti: admin mengira lembur sudah dijadwalkan, sistem menganggap karyawan libur/tanpa jadwal. Diwarisi dari aplikasi lama, tapi kini terdokumentasi dan terverifikasi — perbaikannya di satu sisi saja (samakan format tulis dengan format baca resolver, atau sebaliknya) menutupnya.
2. **Penulisan koreksi tidak atomik (D1, SEBAGIAN)** — 4 tulis Firebase berurutan menggantikan 1 `update()` multi-path atomik di aplikasi lama. Kegagalan di tengah jalan meninggalkan data setengah (koreksi tanpa perubahan absensi, atau sebaliknya) tanpa jejak yang konsisten — untuk fitur yang intinya adalah koreksi data resmi, ini risiko integritas tertinggi di antara temuan SEBAGIAN.
3. **Baris QR tampil "Karyawan" + info audit QR hilang (B1 + B2, SEBAGIAN)** — identitas pengaju QR tidak terlihat di tabel, modal detail, maupun CSV ekspor, dan admin tidak bisa memeriksa peringatan lokasi palsu, status radius, tautan peta, atau spek foto. Persetujuan QR — yang alasan utamanya adalah verifikasi kehadiran — kini dilakukan secara buta.

**Nyaris masuk 3 besar (keduanya RUSAK):** hapus & nonaktifkan jadwal tanpa notifikasi (E2, regresi nyata — karyawan tidak tahu jadwalnya berubah) dan edit Hari Libur tidak bisa dijangkau dari UI (E3, logika edit lengkap tapi kode mati).

**Yang sudah diketahui dan sengaja tidak dilaporkan ulang:** ikon PWA pwa-192/512 hilang; `usePublicSettings` masih memanggil API NestJS; deep-link `?view=belum_absen` belum ada target; Google Calendar sync tidak dibawa (dicatat di footer Schedules).