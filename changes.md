# Laporan Perubahan (Patch.md Implementation)

Berikut adalah daftar perubahan yang telah dilakukan sesuai dengan instruksi `patch.md`, perbaikan pada halaman UI terkait, dan penanganan bug UID yang bocor.

## 1. Pembaruan Tipe Data (`src/types.ts`)
- Menambahkan tipe `SubDepartment` untuk melengkapi struktur hirarki organisasi.
- Mengubah interface `UserIndex`, `CompanyUser` dan entitas lain untuk mendukung bidang data `photo_url`, `photo_path`, `qr_token`, `qr_active`, dan `qr_updated_at`.
- Semua data model disinkronkan dengan payload terbaru yang dibutuhkan oleh modul sistem absensi.

## 2. Peningkatan Fitur Karyawan (`src/pages/Employees.tsx`)
- Mengintegrasikan bidang opsional **Sub Department**, **Employee Group**, dan tampilan struktur organisasi yang lebih mendetail di dalam tabel (Office, Dept, Sub-Dept, Group).
- Membuat helper komponen `EmployeeAvatar` untuk merender foto profil karyawan secara otomatis dengan menggunakan fungsi `getFileUrl()`. Jika foto tidak tersedia, avatar akan di-fallback ke inisial nama.
- Memperbarui payload form pembuatan (`Tambah Karyawan`) dan `Edit Karyawan` hingga melampirkan referensi Sub-Department agar tidak tertinggal.

## 3. Integrasi Persetujuan Absensi (`src/pages/Approvals.tsx`)
- Melakukan modifikasi pada alur penyetujuan QR (QR Attendance Action).
- Memastikan presisi payload dengan memasukkan variabel spesifik: membaca `date` atau `tanggal`, dan `time` atau `waktu`.
- Memberikan prioritas untuk source absensi agar terekam sebagai `source: "admin_web"`, lalu menyesuaikan label status menjadi `approved` dan `validation_status: "approved"` demi mencegah duplikasi yang tidak diharapkan.
- Memberikan status rekaman Geofencing berdasarkan `distance_meter` dan `radius_meter` untuk mendeteksi apakah absensi dilakukan di *"inside"* radius atau *"outside"*.
- Melakukan penyisipan parameter `proxy_request_id` dan trigger audit log.

## 4. Pembaruan Tabel Laporan Kehadiran (`src/pages/Attendance.tsx`)
- Sinkronisasi dengan kompatibilitas data lama ("backward compatibility") saat membaca tanggal absensi dengan menggunakan skema pencarian data: `rec.date || rec.tanggal || record_date`.
- Membaca rekaman waktu absensi via `rec.time || rec.waktu || '00:00:00'`.
- Menyesuaikan fungsi pencarian dan sistem filter serta render kolom menggunakan waktu yang lebih aman tersebut.
- Tetap memunculkan status badge **Approved** bagi rekaman absensi yang sebelumnya disetujui (mempertimbangkan status lama `success`).

## 5. Perbaikan Bug UI & Privasi (`src/pages/CompanyAdmins.tsx` & `src/pages/Companies.tsx`)
- **Menghilangkan Kebocoran UID:** Pada data pengguna yang hilang atau belum dikaitkan dengan profil yang terisi penuh, informasi sensitif seperti *User UID* yang ada di UI tabel `CompanyAdmins` telah disembunyikan. Kini akan menampilkan placeholder ramah pengguna seperti *"Data Tidak Ditemukan"* atau *"Tanpa Nama"*.
- Mengembalikan kemudahan identifikasi `Admin PT` tanpa memperlihatkan UID secara mentah pada halaman daftar perusahaan (`Companies.tsx`), dengan membatasi status tampilannya menjadi "Ter-assign" atau "Belum di assign".

## 6. Integrasi `react-hot-toast`
- Menerapkan `toast.promise` secara konsisten pada seluruh operasi yang menghasilkan asinkronisasi atau mutasi data (penyimpanan, update asssignments, approval actions, dsb.).
- Memastikan notifikasi state memuat informasi yang interaktif.

Prosedur patching ini dapat digunakan sebagai langkah migrasi penuh sesuai requirement pada panduan spesifikasi `patch.md`.
