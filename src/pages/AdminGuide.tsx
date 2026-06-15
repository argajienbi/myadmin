import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle,
  ClipboardCheck,
  Database,
  HelpCircle,
  ListChecks,
  Search,
  Shield,
  Users,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import clsx from "clsx";

type GuideVisibilityRole = "owner" | "admin";

type GuideStep = {
  title: string;
  description: string;
};

type GuideSection = {
  id: string;
  title: string;
  menu: string;
  icon: React.ElementType;
  summary: string;
  steps: GuideStep[];
  notes?: string[];
  visibleFor?: GuideVisibilityRole[];
};

const guideSections: GuideSection[] = [
  {
    id: "alur-awal",
    title: "Alur awal setelah login",
    menu: "Dashboard / Setup Awal",
    icon: HomeIcon,
    summary: "Urutan dasar sebelum admin mulai mengelola presensi.",
    steps: [
      { title: "Cek mode akun", description: "Owner bisa memilih perusahaan, admin hanya mengelola company terkait." },
      { title: "Buka Setup Awal", description: "Pastikan data dasar siap." },
      { title: "Lengkapi master data", description: "Organisasi, kantor, radius, karyawan, jadwal kerja." },
      { title: "Uji aplikasi karyawan", description: "Login Flutter, cek radius, cek jadwal, test presensi." },
    ],
    notes: [
      "Jika dashboard kosong, cek perusahaan aktif/company_id.",
      "Penyebab absen gagal paling umum: kantor/radius belum lengkap, karyawan belum punya grup, atau jadwal belum diterapkan.",
    ]
  },
  {
    id: "organisasi",
    title: "Organisasi dan lokasi kantor",
    menu: "Organisasi",
    icon: Building2,
    summary: "Pengaturan struktur perusahaan dan lokasi geofence presensi.",
    steps: [
      { title: "Buat Area", description: "Tentukan area operasional perusahaan." },
      { title: "Buat Kantor", description: "Isi latitude, longitude, radius meter, pakai map picker." },
      { title: "Buat Departemen", description: "Kelompokkan karyawan berdasarkan departemen." },
      { title: "Buat Sub Departemen", description: "Buat struktur lebih spesifik jika diperlukan." },
      { title: "Buat Grup Karyawan", description: "Untuk penerapan jadwal massal yang lebih mudah." },
    ],
    notes: [
      "Radius kantor memengaruhi validasi presensi Flutter.",
      "Di luar radius, app menolak presensi meskipun jadwal benar.",
    ]
  },
  {
    id: "karyawan",
    title: "Karyawan",
    menu: "Karyawan",
    icon: Users,
    summary: "Pengelolaan data pegawai dan akses aplikasi.",
    steps: [
      { title: "Tambah karyawan", description: "Isi nama, email, password awal, NIP, HP, jabatan." },
      { title: "Lengkapi data penempatan", description: "Pilih kantor, departemen, sub departemen, grup." },
      { title: "Aktifkan akun", description: "Aktifkan akun via toggle jika data sudah benar." },
      { title: "Cek peringatan (badge)", description: "Periksa badge: aktif, pending, belum ada kantor, belum ada grup, belum ada jadwal." },
    ],
    notes: [
      "Karyawan tanpa group_id tidak mendapat jadwal grup.",
      "Email dan password awal dipakai login Flutter.",
    ]
  },
  {
    id: "jadwal-kerja",
    title: "Jadwal kerja rutin dan khusus",
    menu: "Jadwal Kerja",
    icon: Calendar,
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
      "Jika tidak ada jadwal aktif, Flutter menolak absen.",
    ]
  },
  {
    id: "jadwal-lembur",
    title: "Jadwal lembur",
    menu: "Jadwal Kerja → Jadwal Lembur",
    icon: ClipboardCheck,
    summary: "Membuat jadwal tambahan di luar jam kerja normal atau hari libur.",
    steps: [
      { title: "Buat grup lembur", description: "Klik tambah jadwal lembur." },
      { title: "Isi nama grup lembur", description: "Berikan nama yang deskriptif." },
      { title: "Pilih karyawan", description: "Centang satu/banyak karyawan yang akan lembur." },
      { title: "Pilih tanggal", description: "Pilih satu/banyak tanggal dari input kalender." },
      { title: "Jam kerja & window", description: "Isi jam kerja dan window check-in/check-out lembur tersebut." },
      { title: "Simpan jadwal", description: "Sistem menyimpan dan mengirim push notifikasi ref_type schedule ke target." },
    ],
    notes: [
      "Untuk lembur perorangan, buat grup berisi 1 karyawan.",
      "Jadwal lembur mengalahkan hari libur nasional untuk user target.",
      "Sistem harus hard block (menolak save) jika karyawan, tanggal, dan jam lembur bertabrakan dengan jadwal lembur sebelumnya.",
    ]
  },
  {
    id: "absensi",
    title: "Absensi",
    menu: "Absensi",
    icon: ListChecks,
    summary: "Melihat data presensi masuk dan keluar harian.",
    steps: [
      { title: "Gunakan filter tanggal", description: "Lihat data pada hari/periode spesifik." },
      { title: "Gunakan filter hierarki", description: "Filter data per kantor/departemen/sub departemen/grup." },
      { title: "Cek lokasi absensi", description: "Perhatikan status geofence (inside/outside) dan jarak dari titik koordinat (meter)." },
      { title: "Preview", description: "Cek foto selfie/lokasi peta jika perlu validasi manual." },
    ],
    notes: [
      "Jika karyawan mengaku sudah absen tetapi tidak terlihat, cek tanggal, filter, action type, dan pastikan devicenya memiliki koneksi internet.",
      "Attendance hasil kerja dari jadwal lembur memiliki \"schedule_source: overtime_schedule\" atau \"overtime_flag: true\".",
    ]
  },
  {
    id: "koreksi-absensi",
    title: "Koreksi Absensi",
    menu: "Koreksi Absensi",
    icon: CheckCircle,
    summary: "Memproses pengajuan perubahan data presensi dari karyawan.",
    steps: [
      { title: "Buka daftar koreksi", description: "Lihat data yang perlu ditindaklanjuti." },
      { title: "Periksa pengajuan", description: "Cek karyawan, tanggal absensi, alasan, dan data koreksi yang diajukan." },
      { title: "Tindak lanjut", description: "Setujui atau tolak pengajuan (bisa menyertakan catatan)." },
      { title: "Cek laporan", description: "Setelah disetujui, absensi akan diperbarui. Cek di menu Absensi dan Laporan." },
    ],
    notes: []
  },
  {
    id: "persetujuan",
    title: "Persetujuan",
    menu: "Persetujuan",
    icon: Shield,
    summary: "Menyetujui izin, sakit, cuti, atau presensi darurat via QR/Manual.",
    steps: [
      { title: "Pilih tab jenis persetujuan", description: "Pilih tab pengajuan jadwal atau tap QR/Manual." },
      { title: "Cek detail", description: "Periksa nama, tanggal, tipe, alasan, dan file lampiran." },
      { title: "Cek data lembur", description: "Khusus untuk lembur request, pastikan tanggal, jam, dan durasi sesuai." },
      { title: "Keputusan", description: "Setujui atau tolak. Jika ditolak, isi alasan penolakan." },
    ],
    notes: [
      "Sakit sebaiknya difilter dengan memeriksa bukti lampiran keterangan dokter/obat.",
      "Merespons (Setuju/Tolak) otomatis mengirim notifikasi dengan ref_type leave_request."
    ]
  },
  {
    id: "pengumuman",
    title: "Pengumuman",
    menu: "Pengumuman",
    icon: Bell,
    summary: "Broadcast informasi ke karyawan (Dashboard & Push Notification).",
    steps: [
      { title: "Buat pengumuman", description: "Isi title, body, tipe pemberitahuan, target penerima, dan pilih send_push aktif." },
      { title: "Pilih target", description: "Atur penerima apakah global, atau spesifik grup." },
      { title: "Publish", description: "Simpan pengumuman untuk ditampilkan." },
      { title: "Pantau pengiriman", description: "Lihat di Log Notifikasi jika push dikirimkan." },
    ],
    notes: [
      "Saat karyawan men-tap push pengumuman, target navigasinya adalah ref_type: announcement.",
      "Jika push queue tertahan/gagal, admin harus memantau log / error."
    ]
  },
  {
    id: "notifikasi",
    title: "Notifikasi",
    menu: "Pengaturan Notifikasi / Log Notifikasi",
    icon: AlertTriangle, // fallback icon since Log/Notification mapping can vary
    summary: "Pengaturan layanan notifikasi FCM dan pemantauan push yang dikirim ke device.",
    visibleFor: ["owner"],
    steps: [
      { title: "Buka Log Notifikasi", description: "Masuk ke menu Log Notifikasi (Settings)." },
      { title: "Pilih karyawan target", description: "Ketik atau cari nama/email karyawan." },
      { title: "Pilih jenis test", description: "Pilih scenario test: Pengumuman, Pengajuan, Riwayat Presensi, Jadwal Kerja." },
      { title: "Kirim Test Push", description: "Eksekusi pengiriman notifikasi test." },
      { title: "Cek status", description: "Lihat riwayat status queue dan cek device target." },
    ],
    notes: [
      "Untuk mengarahkan user membuka Detail Jadwal di Flutter, test push harus menggunakan ref_type schedule.",
      "Sebaiknya jangan gunakan ref_type test karena navigasi app mungkin tidak mengenali type tersebut."
    ]
  },
  {
    id: "laporan",
    title: "Laporan",
    menu: "Laporan",
    icon: Database,
    summary: "Melihat rekap kehadiran dan status karyawan dalam satu periode.",
    steps: [
      { title: "Pilih periode", description: "Tentukan rentang tanggal laporan." },
      { title: "Atur Filter", description: "Gunakan filter organisasi/karyawan untuk mempersempit jangkauan jika tersedia." },
      { title: "Cek rekapan", description: "Lihat status count hadir, terlambat, pulang awal, izin, sakit, cuti, absen lembur." },
      { title: "Cek perhitungan lembur", description: "Perbedakan lembur user request dan lembur dari jadwal lembur admin." },
    ],
    notes: [
      "Lembur terjadwal (assigned_overtime) dibaca murni dari attendance dengan schedule_source overtime_schedule atau overtime_flag true."
    ]
  },
  {
    id: "menu-owner",
    title: "Menu Owner (Terbatas)",
    menu: "Perusahaan / Admin PT / Audit Log / Kesehatan Database",
    icon: Shield,
    summary: "Menu khusus akun owner sistem untuk pengelolaan tenant dan tools lanjutan.",
    visibleFor: ["owner"],
    steps: [
      { title: "Kelola Perusahaan", description: "Melihat tenant/perusahaan terdaftar dan mengaturnya." },
      { title: "Kelola Admin PT", description: "Mendaftarkan dan memanage akun admin untuk spesifik perusahaan." },
      { title: "Cek Audit Log", description: "Melihat history action dari admin-admin platform." },
      { title: "Cek Kesehatan Database", description: "Memantau kepadatan database dan metrics RTDB." },
      { title: "Reset data dummy", description: "Melakukan reset data transaksi dengan aman saat sistem akan on-board." },
    ],
    notes: [
      "Reset database HANYA boleh dilakukan oleh owner.",
      "Sebagai pengamanan ekstra, owner wajib mengetik string \"RESET DATABASE\".",
      "Reset data TIDAK menghapus master data wajib seperti: users, companies, company_users, kantor, grup, timetable, shift.",
    ]
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting Umum",
    menu: "Semua menu",
    icon: HelpCircle,
    summary: "Bantuan cepat untuk menangani masalah operasional sehari-hari.",
    steps: [
      { title: "Data tidak muncul / Empty", description: "Cek company_id aktif di dropdown header, periksa rules Firebase RTDB, pastikan role admin Anda sesuai." },
      { title: "Akun karyawan tidak bisa absen (nol jadwal)", description: "Pastikan lokasi dalam radius (di menu Organisasi), cek status akun (aktif), user tergabung dalam grup, dan pastikan sudah di-assign jadwal kerja / tidak masuk hari libur." },
      { title: "Jadwal yang tampil salah", description: "Gunakan fitur Cek Jadwal Karyawan pada Jadwal Kerja untuk mendiagnostik sumber yang aktif (overtime vs holiday vs shift)." },
      { title: "Push tidak masuk HP", description: "Di Log Notifikasi cek antrian, token FCM, success_count, failed_count. Cek juga permission OS mobile, koneksi inet hp target, atau log Cloud Functions." },
      { title: "Database banyak data dummy pasca UAT", description: "Gunakan menu Kesehatan Database dan reset dengan akun Owner." },
    ],
    notes: []
  }
];

// Fallback if imported icon fails
function HomeIcon(props: any) {
  return <BookOpen {...props} />
}

type QuickFlow = {
  title: string;
  items: string[];
  visibleFor?: GuideVisibilityRole[];
};

const quickFlows: QuickFlow[] = [
  {
    title: "Setup operasional perusahaan",
    visibleFor: ["admin"],
    items: [
      "Buka Organisasi untuk melengkapi kantor, radius, departemen, dan grup.",
      "Buka Karyawan untuk menambahkan atau melengkapi data pegawai.",
      "Buka Jadwal Kerja untuk membuat jam kerja, pola shift, dan penerapan jadwal.",
      "Gunakan Cek Jadwal Karyawan sebelum menyimpulkan aplikasi rusak."
    ]
  },
  {
    title: "Setup perusahaan baru",
    visibleFor: ["owner"],
    items: [
      "Buka Perusahaan/Admin PT jika status Anda owner",
      "Buka Organisasi (buat Area dan Kantor)",
      "Buat Departemen, lalu Grup Karyawan",
      "Buka Karyawan dan tambah karyawan (lengkap)",
      "Buka Jadwal Kerja (buat jam kerja, shift, dan terapkan jadwal)",
      "Terakhir: Uji login di app Flutter dan test presence"
    ]
  },
  {
    title: "Membuat jadwal lembur di hari libur",
    items: [
      "Buka Jadwal Kerja",
      "Pilih tab / section Jadwal Lembur",
      "Isi nama grup (misal Lembur IT Support)",
      "Centang karyawan target",
      "Tambah / pilih tanggal",
      "Isi jam kerja spesifik & window valid absen (check-in/out)",
      "Klik Simpan dan cek push notif di hp target Flutter"
    ]
  },
  {
    title: "Mengecek kenapa user tidak bisa absen HP",
    items: [
      "Buka Jadwal Kerja",
      "Gunakan form Cek Jadwal Karyawan",
      "Pilih nama karyawan dan input tanggal spesifik",
      "Cek hasilnya: apakah teridentifikasi sbg libur (holiday), jadwal khusus, jadwal lembur, atau jadwal shift rutin kosong?",
      "Pastikan radius kantor di menu Organisasi memadai, status akun aktif"
    ]
  },
  {
    title: "Mengetes sistem push notification",
    visibleFor: ["owner"],
    items: [
      "Buka menu Log Notifikasi",
      "Pilih / ketik nama target karyawan spesifik",
      "Pilih jenis push test di dropdown (Pilih Jadwal Kerja misalnya)",
      "Kirim Test Push",
      "Pantau status tabel queue di dashboard",
      "Periksa HP/device target untuk memastikan toast masuk"
    ]
  }
];

type ImportantRule = {
  text: string;
  visibleFor?: GuideVisibilityRole[];
};

const importantRules: ImportantRule[] = [
  { text: "Isi Organisasi dan Kantor secara valid dengan map coordinate sebelum mengaktifkan presensi." },
  { text: "Pastikan karyawan masuk ke salah satu grup, ditugaskan kantor, dan status akun dicentang Aktif." },
  { text: "Selalu gunakan form 'Cek Jadwal Karyawan' sebelum menyimpulkan aplikasi rusak (troubleshooting jadwal)." },
  { text: "Jadwal Lembur harus di-setup untuk memaksa (force allow) user absen pada saat hari libur (nasional/perusahaan)." },
  { text: "Tahan / periksa diri jika membuat jadwal lembur agar tidak bertabrakan tanggal/jam di user yang sama." },
  { text: "Gunakan Log Notifikasi sebagai alat debug pertama jika push absen / lembur tampak tidak diterima user.", visibleFor: ["owner"] },
  { text: "Reset data dummy hanya bisa dilakukan owner dan transaksi penghapusan ini secara otomatis masuk ke Audit Log.", visibleFor: ["owner"] }
];

export const AdminGuide: React.FC = () => {
  const { userData } = useAuth();
  const isOwner = userData?.role === "owner";
  const guideRole: GuideVisibilityRole = isOwner ? "owner" : "admin";

  const roleAllowedSections = useMemo(() => {
    return guideSections.filter(section => {
      if (!section.visibleFor || section.visibleFor.length === 0) return true;
      return section.visibleFor.includes(guideRole);
    });
  }, [guideRole]);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState(roleAllowedSections[0]?.id || "");

  const activeSection = useMemo(() => {
    return roleAllowedSections.find(g => g.id === activeTab) || roleAllowedSections[0];
  }, [activeTab, roleAllowedSections]);

  React.useEffect(() => {
    if (roleAllowedSections.length === 0) return;
    if (!roleAllowedSections.some(section => section.id === activeTab)) {
      setActiveTab(roleAllowedSections[0].id);
    }
  }, [activeTab, roleAllowedSections]);

  const filteredSections = useMemo(() => {
    const source = roleAllowedSections;
    if (!search) return source;
    
    const lower = search.toLowerCase();
    return source.filter(sec => 
      sec.title.toLowerCase().includes(lower) || 
      sec.summary.toLowerCase().includes(lower) ||
      sec.menu.toLowerCase().includes(lower) ||
      sec.steps.some(st => st.title.toLowerCase().includes(lower) || st.description.toLowerCase().includes(lower)) ||
      (isOwner && sec.notes && sec.notes.some(n => n.toLowerCase().includes(lower)))
    );
  }, [search, roleAllowedSections]);

  const visibleQuickFlows = useMemo(() => {
    return quickFlows.filter(flow => {
      if (!flow.visibleFor || flow.visibleFor.length === 0) return true;
      return flow.visibleFor.includes(guideRole);
    });
  }, [guideRole]);

  const visibleImportantRules = useMemo(() => {
    return importantRules.filter(rule => {
      if (!rule.visibleFor || rule.visibleFor.length === 0) return true;
      return rule.visibleFor.includes(guideRole);
    });
  }, [guideRole]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto px-4 md:px-6 mt-4">
      
      {/* Header Panel */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-800 dark:from-blue-900 dark:to-indigo-950 rounded-2xl p-6 md:p-8 text-white shadow-md flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold row-auto flex items-center gap-3">
             <BookOpen className="w-8 h-8 text-blue-200" />
             Buku Petunjuk Admin Web
          </h1>
          <p className="mt-2 text-blue-100 max-w-xl text-sm md:text-base">
            Panduan Operasional Admin MyPresence. Pelajari tata cara manajemen absensi, pengaturan perangkat organisasi, jadwal kerja, hingga sistem keamanan data.
          </p>
        </div>
        <div className="hidden md:flex flex-col items-end text-right">
            <span className="text-xs uppercase tracking-wider font-bold text-blue-300">Akses Anda</span>
            <span className="bg-blue-600/50 backdrop-blur-sm border border-blue-400 px-3 py-1 rounded-full text-sm font-semibold mt-1">
              {isOwner ? "Owner" : "Admin Perusahaan"}
            </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row mt-6 gap-6 h-full overflow-hidden pb-6">
        
        {/* Sidebar Nav */}
        <div className="w-full md:w-80 flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
           <div className="relative sticky top-0 bg-slate-50 dark:bg-slate-900 z-10 p-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Cari kata kunci panduan..."
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 ring-blue-500 outline-none"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
           </div>

           <div className="flex flex-col gap-1.5 pb-20">
             {filteredSections.map(sec => {
               const Icon = sec.icon;
               const isActive = sec.id === activeTab;
               return (
                 <button 
                  key={sec.id}
                  onClick={() => setActiveTab(sec.id)}
                  className={clsx(
                    "text-left p-3 rounded-xl transition-all duration-200 group flex items-start gap-3",
                    isActive 
                      ? "bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800" 
                      : "bg-white dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300"
                  )}
                 >
                    <div className={clsx("p-2 rounded-lg", isActive ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-600 dark:group-hover:bg-blue-900")}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="pr-2">
                       <div className={clsx("font-semibold text-sm", isActive ? "text-blue-900 dark:text-blue-100" : "text-slate-700 dark:text-slate-200")}>{sec.title}</div>
                       <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{sec.menu}</div>
                    </div>
                 </button>
               )
             })}
             {filteredSections.length === 0 && (
               <div className="text-sm text-center py-8 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                 Panduan tidak ditemukan untuk akses Anda.
               </div>
             )}
           </div>
        </div>

        {/* Content Viewer */}
        <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-y-auto custom-scrollbar">
           {filteredSections.length === 0 && (
             <div className="p-8 text-center text-slate-400 text-sm">
               Panduan tidak ditemukan untuk akses Anda.
             </div>
           )}
           {filteredSections.length > 0 && activeSection && (
              <div className="p-6 md:p-8 max-w-3xl">
                  {/* Topic Header */}
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full text-xs font-semibold mb-4">
                     {activeSection.menu}
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{activeSection.title}</h2>
                  <p className="mt-2 text-slate-600 dark:text-slate-400 leading-relaxed text-sm md:text-base">
                    {activeSection.summary}
                  </p>

                  <div className="h-px bg-slate-100 dark:bg-slate-800 w-full my-6"></div>

                  <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-blue-500" />
                    Langkah Eksekusi
                  </h3>
                  
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[13px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 dark:before:via-slate-700 before:to-transparent">
                     {activeSection.steps.map((step, idx) => (
                       <div key={idx} className="relative flex items-start gap-4">
                          <div className="w-7 h-7 flex items-center justify-center bg-blue-100 dark:bg-blue-900/60 border-2 border-white dark:border-slate-900 text-blue-600 dark:text-blue-400 rounded-full font-bold text-xs shrink-0 z-10 shadow-sm">
                             {idx + 1}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{step.title}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                               {step.description}
                            </div>
                          </div>
                       </div>
                     ))}
                  </div>

                  {isOwner && activeSection.notes && activeSection.notes.length > 0 && (
                    <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/50 rounded-xl p-5">
                       <h4 className="font-bold text-sm text-yellow-800 dark:text-yellow-500 mb-3 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Catatan Penting
                       </h4>
                       <ul className="space-y-2">
                         {activeSection.notes.map((n, i) => (
                           <li key={i} className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-600/90 leading-relaxed">
                             <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-1.5 shrink-0" />
                             {n}
                           </li>
                         ))}
                       </ul>
                    </div>
                  )}

                  <div className="h-px bg-slate-100 dark:bg-slate-800 w-full my-8"></div>

                  {/* Supplemental sections shown at bottom of active guide */}
                  <div className="opacity-80">
                      <h3 className="text-xs uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-6">Pengetahuan Lanjutan Administrasi</h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
                         <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                            <h4 className="font-bold text-slate-700 dark:text-slate-200 text-sm mb-3">Aturan Operasional Utama</h4>
                            <ul className="space-y-2">
                              {visibleImportantRules.slice(0,4).map((rule, ri) => (
                                <li key={ri} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                                  <ChevronRight className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                                  <span className="leading-relaxed">{rule.text}</span>
                                </li>
                              ))}
                            </ul>
                         </div>

                         <div className="bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                            <h4 className="font-bold text-slate-700 dark:text-slate-200 text-sm mb-3">Alur Kerja Cepat</h4>
                            <div className="space-y-4">
                               {visibleQuickFlows.slice(0, 2).map((qf, i) => (
                                 <div key={i}>
                                   <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">{qf.title}</div>
                                   <span className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                                     {qf.items.slice(0,3).join(" → ")}...
                                   </span>
                                 </div>
                               ))}
                            </div>
                         </div>
                      </div>
                  </div>
              </div>
           )}
        </div>

      </div>
    </div>
  );
};
