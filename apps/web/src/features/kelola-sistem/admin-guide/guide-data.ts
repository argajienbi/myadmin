/**
 * Isi Buku Petunjuk — disalin verbatim dari guideSections di
 * AdminGuide.tsx myadmin lama (14 seksi), hanya ikon diubah dari komponen
 * Lucide menjadi string agar bisa dipetakan ke import lucide-react di page.
 * Teks, urutan, dan filter peran (visibleFor) TIDAK diubah.
 */
export interface GuideStep {
  title: string
  description: string
  visibleFor?: ("owner" | "admin")[]
}

export interface GuideNote {
  text: string
  visibleFor?: ("owner" | "admin")[]
}

export interface GuideSection {
  id: string
  title: string
  menu: string
  icon: string
  summary: string
  steps: GuideStep[]
  notes?: (string | GuideNote)[]
  visibleFor?: ("owner" | "admin")[]
}

export const guideSections: GuideSection[] = [
  {
    id: "alur-awal",
    title: "Alur awal setelah login",
    menu: "Dashboard / Setup Awal",
    icon: "HomeIcon",
    summary: "Urutan dasar sebelum admin mulai mengelola presensi.",
    steps: [
      { title: "Cek mode akun", description: "Owner bisa memilih perusahaan aktif. Admin PT hanya mengelola perusahaan yang terhubung dengan akunnya." },
      { title: "Buka Setup Awal", description: "Pastikan data dasar siap." },
      { title: "Lengkapi master data", description: "Organisasi, kantor, radius, karyawan, jadwal kerja." },
      { title: "Uji aplikasi karyawan", description: "Login aplikasi karyawan, cek radius, cek jadwal, dan uji presensi." },
    ],
    notes: [
      "Jika dashboard kosong, cek perusahaan aktif dan pastikan akun terhubung ke perusahaan yang benar.",
      "Penyebab absen gagal paling umum: kantor/radius belum lengkap, karyawan belum punya grup, atau jadwal belum diterapkan.",
    ]
  },
  {
    id: "perusahaan-admin",
    title: "Profil Perusahaan",
    menu: "Perusahaan",
    icon: "Building2",
    summary: "Pengelolaan profil perusahaan dari sudut pandang Admin PT.",
    visibleFor: ["admin"],
    steps: [
      { title: "Buka menu Perusahaan", description: "Admin PT hanya melihat perusahaan yang terhubung dengan akunnya." },
      { title: "Edit nama perusahaan", description: "Perbarui nama perusahaan jika ada koreksi penulisan atau perubahan identitas." },
      { title: "Atur branding/logo", description: "Upload atau ganti logo perusahaan untuk tampilan ID Card dan identitas aplikasi." },
      { title: "Atur website", description: "Isi URL website perusahaan dan domain yang diizinkan." },
      { title: "Buat kode undangan", description: "Generate kode undangan untuk pendaftaran karyawan ke perusahaan Anda." }
    ],
    notes: [
      "Admin PT tidak bisa menambah perusahaan baru.",
      "Admin PT tidak bisa melihat perusahaan lain.",
      "Admin PT tidak bisa menonaktifkan, memulihkan, atau menghapus perusahaan.",
      "Jika data perusahaan tidak tampil, pastikan akun admin sudah memiliki company_id."
    ]
  },
  {
    id: "organisasi",
    title: "Organisasi dan lokasi kantor",
    menu: "Organisasi",
    icon: "Building2",
    summary: "Pengaturan struktur perusahaan dan lokasi geofence presensi.",
    steps: [
      { title: "Buat Area", description: "Tentukan area operasional perusahaan." },
      { title: "Buat Kantor", description: "Isi latitude, longitude, radius meter, pakai map picker." },
      { title: "Buat Departemen", description: "Kelompokkan karyawan berdasarkan departemen." },
      { title: "Buat Grup Karyawan", description: "Untuk penerapan jadwal massal yang lebih mudah." },
    ],
    notes: [
      "Radius kantor memengaruhi validasi presensi aplikasi karyawan.",
      "Di luar radius, aplikasi menolak presensi meskipun jadwal benar.",
    ]
  },
  {
    id: "karyawan",
    title: "Karyawan",
    menu: "Karyawan",
    icon: "Users",
    summary: "Pengelolaan data pegawai dan akses aplikasi.",
    steps: [
      { title: "Tambah karyawan", description: "Isi nama, email, password awal, NIP, HP, jabatan." },
      { title: "Lengkapi data penempatan", description: "Pilih kantor, departemen, dan grup karyawan." },
      { title: "Aktifkan akun", description: "Aktifkan akun via toggle jika data sudah benar." },
      { title: "Cek peringatan (badge)", description: "Periksa badge: aktif, pending, belum ada kantor, belum ada grup, belum ada jadwal." },
    ],
    notes: [
      "Karyawan tanpa group_id tidak mendapat jadwal grup.",
      "Email dan password awal dipakai login aplikasi karyawan.",
    ]
  },
  {
    id: "jadwal-kerja",
    title: "Jadwal kerja rutin dan khusus",
    menu: "Jadwal Kerja",
    icon: "Calendar",
    summary: "Konfigurasi jam kerja, pola shift, dan hari libur nasional.",
    steps: [
      { title: "Buat Jam Kerja", description: "Tentukan work_start/end, check-in window, check-out window, toleransi." },
      { title: "Buat Pola Shift", description: "Tentukan hari kerja dan timetable tiap hari (Senin-Minggu)." },
      { title: "Terapkan Jadwal", description: "Pilih target user/grup, pilih shift, tanggal mulai/selesai." },
      { title: "Kelola Hari Libur", description: "Bisa input manual atau sync Google Calendar jika tersedia." },
      { title: "Buat Jadwal Khusus", description: "Override jadwal rutin user/grup di tanggal tertentu." },
      { title: "Cek Jadwal Karyawan", description: "Gunakan fitur diagnostik untuk memverifikasi sumber jadwal." },
    ],
    notes: [
      "Prioritas: Jadwal Lembur > Jadwal Khusus > Hari Libur > Jadwal Rutin.",
      "Jika tidak ada jadwal aktif, aplikasi karyawan menolak absen.",
    ]
  },
  {
    id: "jadwal-lembur",
    title: "Jadwal lembur",
    menu: "Jadwal Kerja → Jadwal Lembur",
    icon: "ClipboardCheck",
    summary: "Membuat jadwal tambahan di luar jam kerja normal atau hari libur bagi karyawan.",
    steps: [
      { title: "Buat grup lembur", description: "Klik tambah jadwal lembur." },
      { title: "Isi nama grup lembur", description: "Berikan nama yang deskriptif, misalnya 'Lembur IT Support'." },
      { title: "Pilih karyawan", description: "Centang satu atau banyak karyawan yang akan lembur." },
      { title: "Pilih tanggal", description: "Pilih satu atau banyak tanggal dari input kalender." },
      { title: "Jam kerja & window", description: "Isi jam kerja dan window check-in/check-out lembur tersebut." },
      { title: "Simpan jadwal", description: "Sistem menyimpan jadwal dan mengirim notifikasi perangkat ke karyawan target." },
    ],
    notes: [
      "Untuk lembur perorangan, buat grup berisi 1 karyawan.",
      "Jadwal lembur mengalahkan hari libur nasional untuk karyawan target.",
      "Sistem akan menolak penyimpanan jika karyawan, tanggal, dan jam lembur bertabrakan dengan jadwal lembur sebelumnya di user yang sama.",
    ]
  },
  {
    id: "absensi",
    title: "Absensi",
    menu: "Absensi",
    icon: "ListChecks",
    summary: "Melihat data presensi masuk dan keluar harian karyawan.",
    steps: [
      { title: "Gunakan filter tanggal", description: "Lihat data pada hari atau periode spesifik." },
      { title: "Gunakan filter hierarki", description: "Filter data per kantor, departemen, grup, atau karyawan." },
      { title: "Cek lokasi absensi", description: "Perhatikan status geofence (didalam/diluar radius) dan jarak dari titik koordinat kantor (meter)." },
      { title: "Preview", description: "Cek foto selfie atau lokasi peta jika perlu validasi manual." },
    ],
    notes: [
      "Jika karyawan mengaku sudah absen tetapi tidak terlihat, cek tanggal, filter, jenis aksi, dan pastikan perangkatnya memiliki koneksi internet.",
      "Data kehadiran hasil kerja dari jadwal lembur memiliki penanda khusus di kolom jadwal.",
    ]
  },
  {
    id: "koreksi-absensi",
    title: "Koreksi Absensi",
    menu: "Koreksi Absensi",
    icon: "CheckCircle",
    summary: "Memproses pengajuan perubahan data presensi dari karyawan.",
    steps: [
      { title: "Buka daftar koreksi", description: "Lihat data pengajuan yang perlu ditindaklanjuti." },
      { title: "Periksa pengajuan", description: "Cek karyawan, tanggal absensi, alasan, dan data koreksi yang diajukan." },
      { title: "Tindak lanjut", description: "Setujui atau tolak pengajuan (bisa menyertakan catatan tambahan)." },
      { title: "Cek laporan", description: "Setelah disetujui, absensi akan diperbarui. Cek di menu Absensi dan Laporan." },
    ],
    notes: []
  },
  {
    id: "persetujuan",
    title: "Persetujuan Sakit / Cuti / Izin",
    menu: "Persetujuan",
    icon: "Shield",
    summary: "Menyetujui izin, sakit, cuti, atau presensi darurat karyawan.",
    steps: [
      { title: "Pilih tab jenis persetujuan", description: "Pilih tab pengajuan jadwal atau persetujuan dokumen pendukung." },
      { title: "Cek detail", description: "Periksa nama, tanggal, tipe pengajuan, alasan, dan file lampiran pendukung." },
      { title: "Cek data lembur", description: "Khusus pengajuan lembur, periksa kembali kecocokan durasi dan tanggal." },
      { title: "Keputusan", description: "Setujui atau tolak pengajuan, letakkan alasan jika ditolak." },
    ],
    notes: [
      "Sakit sebaiknya diverifikasi dengan memeriksa bukti foto dokumen atau surat dokter.",
      "Setuju atau tolak pengajuan akan otomatis mengirimkan notifikasi perangkat ke karyawan bersangkutan."
    ]
  },
  {
    id: "pengumuman",
    title: "Pengumuman",
    menu: "Pengumuman",
    icon: "Bell",
    summary: "Broadcast informasi ke karyawan melalui dashboard dan notifikasi perangkat.",
    steps: [
      { title: "Buat pengumuman", description: "Isi judul, isi berita, tipe pemberitahuan, target penerima, dan centang pilihan pengiriman notifikasi." },
      { title: "Pilih target", description: "Atur penerima apakah global ke seluruh entitas, atau spesifik grup tertentu." },
      { title: "Publish", description: "Simpan pengumuman untuk ditampilkan di beranda aplikasi karyawan." },
      { title: "Pantau pengiriman", description: "Lihat di Log Notifikasi jika pengiriman sedang berjalan." },
    ],
    notes: [
      "Saat karyawan membuka notifikasi pengumuman, sistem akan membuka detail pengumuman terkait.",
      "Jika antrean notifikasi tertahan/gagal, admin dapat memantau status di panel notifikasi."
    ]
  },
  {
    id: "notifikasi",
    title: "Notifikasi Perangkat",
    menu: "Pengaturan Notifikasi / Log Notifikasi",
    icon: "AlertTriangle",
    summary: "Pengaturan notifikasi perangkat dan pemantauan pengiriman ke karyawan.",
    visibleFor: ["owner"],
    steps: [
      { title: "Buka Log Notifikasi", description: "Masuk ke menu Log Notifikasi (Settings)." },
      { title: "Pilih karyawan target", description: "Ketik atau cari nama/email karyawan." },
      { title: "Pilih jenis test", description: "Pilih scenario test: Pengumuman, Pengajuan, Riwayat Presensi, Jadwal Kerja." },
      { title: "Kirim Test Notifikasi", description: "Eksekusi pengiriman notifikasi test." },
      { title: "Cek status", description: "Lihat riwayat status antrean dan cek device target." },
    ],
    notes: [
      "Untuk mengarahkan user membuka Detail Jadwal di aplikasi karyawan, test notifikasi harus memakai jenis Jadwal Kerja.",
      "Sebaiknya jangan gunakan jenis pengujian umum demi menjaga stabilitas pembacaan aplikasi karyawan."
    ]
  },
  {
    id: "laporan",
    title: "Laporan",
    menu: "Laporan",
    icon: "Database",
    summary: "Melihat rekap kehadiran dan status karyawan dalam satu periode tertentu.",
    steps: [
      { title: "Pilih periode", description: "Tentukan rentang tanggal laporan." },
      { title: "Atur Filter", description: "Gunakan filter organisasi/karyawan untuk mempersempit jangkauan." },
      { title: "Cek rekapan", description: "Lihat status jumlah hari hadir, terlambat, pulang cepat, izin, sakit, cuti, serta akumulasi jam lembur." },
      { title: "Cek perhitungan lembur", description: "Pahami perbedaan rekapan lembur yang disetujui dari permohonan mandiri vs lembur terjadwal." },
    ],
    notes: [
      "Lembur terjadwal dibaca murni dari transaksi kehadiran yang cocok dengan setup jadwal lembur yang dibuat admin."
    ]
  },
  {
    id: "menu-owner",
    title: "Menu Owner dan Tools Lanjutan",
    menu: "Perusahaan / Admin PT / Audit Log / Kesehatan Data",
    icon: "Shield",
    summary: "Menu khusus owner untuk mengelola semua perusahaan, admin PT, audit, dan alat pemeliharaan data.",
    visibleFor: ["owner"],
    steps: [
      { title: "Kelola semua perusahaan", description: "Owner dapat melihat semua perusahaan, menambah perusahaan baru, serta mengelola status perusahaan." },
      { title: "Kelola Admin PT", description: "Mendaftarkan dan mengatur akun admin untuk perusahaan tertentu." },
      { title: "Cek Audit Log", description: "Melihat riwayat aksi owner dan admin dalam sistem." },
      { title: "Cek Kesehatan Data", description: "Memantau kepadatan data dan penyimpanan aplikasi." },
      { title: "Reset data dummy", description: "Melakukan reset data transaksi dengan aman saat sistem akan on-board." }
    ],
    notes: [
      "Menu ini hanya tampil untuk owner/system owner.",
      "Admin PT tetap bisa membuka menu Perusahaan, tetapi hanya untuk perusahaan miliknya sendiri.",
      "Reset data hanya boleh dilakukan oleh owner.",
      "Reset data tidak menghapus master data wajib seperti users, companies, company_users, kantor, grup, jam kerja, dan shift."
    ]
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting Umum",
    menu: "Semua menu",
    icon: "HelpCircle",
    summary: "Bantuan cepat untuk menangani masalah operasional sehari-hari.",
    steps: [
      { title: "Data tidak muncul / Empty", description: "Cek perusahaan aktif, pastikan akun admin terhubung ke perusahaan yang benar, dan pastikan role admin sesuai." },
      { title: "Akun karyawan tidak bisa absen (nol jadwal)", description: "Pastikan lokasi dalam radius (di menu Organisasi), cek status akun (aktif), user tergabung dalam grup, dan pastikan sudah di-assign jadwal kerja / tidak masuk hari libur." },
      { title: "Jadwal yang tampil salah", description: "Gunakan fitur Cek Jadwal Karyawan pada Jadwal Kerja untuk mendiagnostik sumber yang aktif (overtime vs holiday vs shift)." },
      { title: "Notifikasi tidak masuk HP", description: "Di Log Notifikasi cek antrean pengiriman, status perangkat, jumlah berhasil/gagal. Cek juga izin notifikasi HP, koneksi internet, atau log layanan otomatis." },
      {
        title: "Data dummy pasca UAT",
        description: "Gunakan menu Kesehatan Data dan reset dengan akun owner.",
        visibleFor: ["owner"]
      },
    ],
    notes: []
  }
];
