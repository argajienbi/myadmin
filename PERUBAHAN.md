# Changelog dan Laporan Perubahan

Berdasarkan permintaan Anda, berikut adalah rincian semua pembaruan dan peningkatan yang telah ditambahkan ke dalam aplikasi **Admin Web MyPresensi**:

## 1. Fitur Dark/Light Mode
- **Implementasi**: Menambahkan tombol toggle (icon matahari/bulan) pada pojok kanan atas di bar navigasi (`Layout.tsx`). 
- **Persistensi State**: Terintegrasi penuh dengan seluruh komponen antarmuka lewat Tailwind CSS kelas `dark:` agar UI selalu menyesuaikan preferensi warna pengguna secara global.

## 2. Penanganan Error Firebase & Halaman Login
- **Error Bocor Dihilangkan**: Mengganti toast notifikasi bawaan Firebase yang terkadang menampilkan text kasar seperti `Firebase: Error (auth/invalid-credential)` menjadi pesan berbahasa Indonesia yang jauh lebih informatif dan mudah dipahami, misalnya *"Username atau password salah"*.
- **Pembaruan Halaman Login**: Membuat tata letak halaman `Login.tsx` lebih modern dan tidak monoton. Kami juga telah menambahkan informasi deskriptif tentang fungsi aplikasi (sebagai portal *Admin Web MyPresensi*) langsung di halaman login agar pengguna memahami konteks penggunaannya sebelum masuk.

## 3. Resolusi Error Auth Invalid Credential
- Secara khusus, error Firebase *(auth/invalid-credential)* kini telah ditangani (di-*catch*) di bagian try-catch proses login dan pendaftaran/pembaruan karyawan, dan diubah pesannya menjadi keterangan yang sangat ramah pengguna (user-friendly).

## 4. Fitur Tambahan (Penyempurnaan Sistem Administratif)
Selain fitur wajib, saya telah memastikan bahwa fungsionalitas pendukung untuk kebutuhan manajemen telah diperbaiki:
- Fitur **Koreksi Absensi Administratif** dengan format dan laporan yang presisi.
- Fitur pengecekan batas radius Absensi dengan integrasi _OpenStreetMap_.
- Konfirmasi penambahan karyawan yang tidak mendaftarkan Face ID akan memicu instruksi otomatis.

## 5. Implementasi ke Seluruh Kode & Dokumentasi
- Semua dari nomor 1 sampai 6 telah selesai diterapkan satu-persatu melalui proses refactoring di lebih dari 10 file yang berbeda (.tsx).
- File *markdown* (MD) ini dibuat sebagai catatan rilis khusus atas perubahan tersebut sesuai permintaan Anda.

## 6. Resolusi Tampilan UID & Progres Toast Universal
- **Penggantian UID menjadi Nama**: Sebelumnya, beberapa tabel seperti di *Riwayat Perubahan Jadwal (Schedules)*, *Audit Log (Audit)*, *Persetujuan (Approvals)*, *Koreksi Absensi*, dan laporan *CSV* seringkali hanya menampilkan gabungan *string uid acak* yang sulit dibaca. Sekarang, semua ID tersebut otomatis direlasikan ke data di *Users/CompanyUsers* untuk selalu memprioritaskan pemunculan **Nama Lengkap**.
- **Tombol Logout**: Tombol kelur (*Log Out*) sudah dipulihkan dan ditata ulang dengan posisi yang lebih mudah dijangkau pada komponen *Header / Layout*.
- **Toast Promise (Progres)*: Telah mengimplementasikan `toast.promise` *(react-hot-toast)* ke **seluruh** fungsi krusial yang membutuhkan proses asynchronous/beberapa detik. Antara lain:
  - Proses Login
  - Penambahan & Perubahan Data (Karyawan, Organisasi, Perusahaan, Timetable/Shift)
  - Persetujuan (Approve/Reject) untuk Izin dan Pendaftaran Perangkat (QR)
  - Penyuntingan Profil Settings
  - Proses Export ke CSV
  Ini membuat pengguna bisa melihat status *loading...* lalu indikator berhasil/gagal setelah data selesai diproses tanpa bingung.

---
Terima kasih, silakan jalankan aplikasi dan rasakan pengalaman admin web yang lebih responsif dan informatif!
