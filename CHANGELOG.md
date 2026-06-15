# CHANGELOG - Update Fitur Admin Web MyPresensi

Berikut adalah 6 penambahan fitur yang dilakukan pada Admin Web:

1. **Export Laporan (CSV)**:  
   Terdapat pada menu `Laporan` yang kini memiliki kemampuan merekap data absensi per filter secara riil dan disajikan ke dalam tabel Excel/CSV yang bisa langsung diunduh, lengkap dengan rekam otomatis ke sistem Audit Log.

2. **Dashboard Interactive Charts (Recharts)**:  
   Sistem penambahan statistik analitik di Dashboard menggunakan komponen Charts (Grafik) via pustaka `recharts`. Sekarang di halaman _Dashboard_ terdapat Grafik Bar & Garis yang menggambarkan pola tingkat kehadiran (Hadir & Terlambat) selama 7 hari atau seminggu terakhir.

3. **Halaman Pengaturan Profil Admin**:  
   Dihadirkan menu `Settings` baru, dapat diakses dari Sidebar atau dropdown klik pada Inisial nama di pojok kanan atas Header (Topbar). Di halaman ini, Admin/Owner bisa mengubah Profil Diri (Nama & HP) dan Manajemen kata sandi (Password).

4. **Filter Lanjutan Pada Laporan**:  
   Fitur filter presisi tinggi telah ditambahkan ke halaman `Reports`. Kini HR / Admin dapat mem-filter data lintas kriteria: Tanggal Range, Status Kehadiran, Cabang, hingga Radius (Di luar/Di Dalam Radius).

5. **Akses Aksesibilitas Modern UI/UX (Dropdown Profile)**:  
   Bagian Navbar/Header atas ditingkatkan lagi, alih-alih meletakkan tombol Logout datar, kini menggunakan "Profile Picture" inisial nama, lengkap dengan menu Dropdown yang melayang untuk kemudahan _Settings_ dan _Logout_. Tema yang digunakan disesuaikan agar cocok untuk Mode Gelap dan Terang.

6. **Informasi Ekstra pada Login & Validasi Error Login**:  
   Sesuai arahan, halaman Login dibuat modern dan memuat deskripsi layanan. Respons terhadap _toast_ notifikasi error telah disesuaikan menjadi Bahasa Indonesia dan mudah dimengerti, menggantikan _Alert_ bawaan Firebase yang monoton. (Sudah dilakukan pada sesi sebelumnya).
