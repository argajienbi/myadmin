import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { db } from "../firebase";
import { get, ref, set } from "firebase/database";
import { Save, Bell, Clock, MessageSquare, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export const NotificationSettings: React.FC = () => {
    const { userData } = useAuth();
    
    if (userData?.role !== "owner") {
      return (
        <div className="p-8">
          <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
            <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
              Akses khusus Owner
            </div>
            <p className="text-sm text-slate-500">
              Pengaturan dan log notifikasi hanya dapat dikelola oleh Owner.
            </p>
          </div>
        </div>
      );
    }
    
    const [targetCompanyId, setTargetCompanyId] = useState<string>("");

    const [settings, setSettings] = useState<any>({
        push_enabled: true,
        in_app_enabled: true,
        attendance_reminder_enabled: true,
        
        // Granular toggles (PATCH-07)
        reminder_check_in_pre_enabled: true,
        reminder_check_in_now_enabled: true,
        reminder_check_in_late_enabled: false,
        reminder_check_out_pre_enabled: true,
        reminder_check_out_now_enabled: true,
        reminder_check_out_late_enabled: false,

        // Legacy/Minutes linked toggles for backward compatibility
        pre_check_in_enabled: true,
        pre_check_in_minutes: 10,
        reminder_check_in_pre_minutes: 10,
        missed_check_in_enabled: true,
        missed_check_in_minutes: 10,
        reminder_check_in_now_window_minutes: 6,
        reminder_check_in_late_minutes: 10,
        
        pre_check_out_enabled: true,
        pre_check_out_minutes: 10,
        reminder_check_out_pre_minutes: 10,
        missed_check_out_enabled: true,
        missed_check_out_minutes: 10,
        reminder_check_out_now_window_minutes: 6,
        reminder_check_out_late_minutes: 10,
        
        reminder_scheduler_catchup_minutes: 6,

        // Categorised subscriptions
        announcement_push_enabled: true,
        approval_push_enabled: true,
        schedule_change_push_enabled: true,
        holiday_notice_push_enabled: true,
    });

    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!userData) return;
        const compId = userData.role === "owner" ? localStorage.getItem("admin_selected_company") || userData.company_id : userData.company_id;
        setTargetCompanyId(compId || "");
    }, [userData]);

    useEffect(() => {
        if (!targetCompanyId) return;

        const loadSettings = async () => {
            try {
                const docRef = ref(db, `companies/${targetCompanyId}/notification_settings/main`);
                const docSnap = await get(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.val() || {};
                    setSettings((prev: any) => ({
                        ...prev,
                        ...data,
                        // Synchronize if old values exist to make sure new fields are properly defaulted
                        reminder_check_in_pre_enabled: data.reminder_check_in_pre_enabled !== undefined ? data.reminder_check_in_pre_enabled : (data.pre_check_in_enabled ?? true),
                        reminder_check_in_now_enabled: data.reminder_check_in_now_enabled !== undefined ? data.reminder_check_in_now_enabled : true,
                        reminder_check_in_late_enabled: data.reminder_check_in_late_enabled !== undefined ? data.reminder_check_in_late_enabled : (data.missed_check_in_enabled ?? false),
                        
                        reminder_check_in_pre_minutes: data.reminder_check_in_pre_minutes ?? data.pre_check_in_minutes ?? 10,
                        reminder_check_in_now_window_minutes: data.reminder_check_in_now_window_minutes ?? 6,
                        reminder_check_in_late_minutes: data.reminder_check_in_late_minutes ?? data.missed_check_in_minutes ?? 10,

                        reminder_check_out_pre_enabled: data.reminder_check_out_pre_enabled !== undefined ? data.reminder_check_out_pre_enabled : (data.pre_check_out_enabled ?? true),
                        reminder_check_out_now_enabled: data.reminder_check_out_now_enabled !== undefined ? data.reminder_check_out_now_enabled : true,
                        reminder_check_out_late_enabled: data.reminder_check_out_late_enabled !== undefined ? data.reminder_check_out_late_enabled : (data.missed_check_out_enabled ?? false),
                        
                        reminder_check_out_pre_minutes: data.reminder_check_out_pre_minutes ?? data.pre_check_out_minutes ?? 10,
                        reminder_check_out_now_window_minutes: data.reminder_check_out_now_window_minutes ?? 6,
                        reminder_check_out_late_minutes: data.reminder_check_out_late_minutes ?? data.missed_check_out_minutes ?? 10,
                        
                        reminder_scheduler_catchup_minutes: data.reminder_scheduler_catchup_minutes ?? 6,
                    }));
                }
            } catch (err: any) {
                console.warn("Failed to load settings from RTDB", err);
            }
        };

        loadSettings();
    }, [targetCompanyId]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!targetCompanyId || !userData) return;

        setLoading(true);
        try {
            const normalized = {
                ...settings,
                attendance_reminder_enabled: Boolean(settings.attendance_reminder_enabled),

                reminder_check_in_pre_enabled: Boolean(settings.reminder_check_in_pre_enabled),
                reminder_check_in_now_enabled: Boolean(settings.reminder_check_in_now_enabled),
                reminder_check_in_late_enabled: Boolean(settings.reminder_check_in_late_enabled),

                reminder_check_out_pre_enabled: Boolean(settings.reminder_check_out_pre_enabled),
                reminder_check_out_now_enabled: Boolean(settings.reminder_check_out_now_enabled),
                reminder_check_out_late_enabled: Boolean(settings.reminder_check_out_late_enabled),

                reminder_check_in_pre_minutes: clampNumber(settings.reminder_check_in_pre_minutes, 10, 0, 120),
                reminder_check_in_now_window_minutes: clampNumber(settings.reminder_check_in_now_window_minutes, 6, 0, 30),
                reminder_check_in_late_minutes: clampNumber(settings.reminder_check_in_late_minutes, 10, 1, 180),

                reminder_check_out_pre_minutes: clampNumber(settings.reminder_check_out_pre_minutes, 10, 0, 120),
                reminder_check_out_now_window_minutes: clampNumber(settings.reminder_check_out_now_window_minutes, 6, 0, 30),
                reminder_check_out_late_minutes: clampNumber(settings.reminder_check_out_late_minutes, 10, 1, 240),

                reminder_scheduler_catchup_minutes: clampNumber(settings.reminder_scheduler_catchup_minutes, 6, 5, 30),

                updated_at: Date.now(),
                updated_by: userData.uid
            };

            const payload = {
                ...normalized,
                pre_check_in_enabled: normalized.reminder_check_in_pre_enabled,
                pre_check_in_minutes: normalized.reminder_check_in_pre_minutes,

                pre_check_out_enabled: normalized.reminder_check_out_pre_enabled,
                pre_check_out_minutes: normalized.reminder_check_out_pre_minutes,

                missed_check_in_enabled: normalized.reminder_check_in_late_enabled,
                missed_check_in_minutes: normalized.reminder_check_in_late_minutes,

                missed_check_out_enabled: normalized.reminder_check_out_late_enabled,
                missed_check_out_minutes: normalized.reminder_check_out_late_minutes,
            };

            const docRef = ref(db, `companies/${targetCompanyId}/notification_settings/main`);
            await set(docRef, payload);
            toast.success("Pengaturan notifikasi berhasil disimpan!");
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = (key: string) => {
        setSettings({ ...settings, [key]: !settings[key] });
    };

    const handleChange = (key: string, value: any) => {
       setSettings({ ...settings, [key]: value });
    };

    return (
        <div className="max-w-4xl space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm">
                <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Pengaturan Notifikasi</h1>
                <p className="text-sm text-slate-500 mt-1">Konfigurasi push notification dan granular pengingat untuk karyawan</p>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                {/* Global Toggles */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                       <h2 className="font-bold text-slate-805 text-slate-800 dark:text-slate-200 flex items-center gap-2 text-sm tracking-wide">
                           <Bell className="w-4 h-4 text-blue-500" /> Global Settings
                       </h2>
                    </div>
                    <div className="p-6 space-y-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.push_enabled} onChange={() => handleToggle('push_enabled')} className="mt-1 rounded text-blue-600 focus:ring-blue-500" />
                            <div>
                                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">Push Notification</div>
                                <div className="text-xs text-slate-500 mt-0.5">Izinkan pengiriman notifikasi ke perangkat (Android/iOS) karyawan.</div>
                            </div>
                        </label>
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.in_app_enabled} onChange={() => handleToggle('in_app_enabled')} className="mt-1 rounded text-blue-600 focus:ring-blue-500" />
                            <div>
                                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">Notifikasi Dalam Aplikasi</div>
                                <div className="text-xs text-slate-500 mt-0.5">Munculkan notifikasi di dalam menu Inbox pada aplikasi.</div>
                            </div>
                        </label>
                    </div>
                </div>

                {/* Scheduler Reminders (PATCH-07) */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                       <h2 className="font-bold text-slate-805 text-slate-800 dark:text-slate-200 flex items-center gap-2 text-sm tracking-wide">
                           <Clock className="w-4 h-4 text-purple-500" /> Pengingat Presensi Otomatis
                       </h2>
                    </div>
                    <div className="p-6 space-y-6">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" checked={settings.attendance_reminder_enabled} onChange={() => handleToggle('attendance_reminder_enabled')} className="mt-1 rounded text-blue-600 focus:ring-blue-500" />
                            <div>
                                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">Aktifkan Pengingat Presensi Otomatis</div>
                                <div className="text-xs text-slate-500 mt-0.5">Kirim pengingat berdasarkan jadwal kerja karyawan (Cloud Functions).</div>
                            </div>
                        </label>

                        {settings.attendance_reminder_enabled && (
                            <div className="pl-7 space-y-6 border-l-2 border-slate-100 dark:border-slate-800 ml-2">
                                {/* Granular Check-In Pre */}
                                <div className="bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm text-slate-800 dark:text-slate-200">
                                        <input type="checkbox" checked={settings.reminder_check_in_pre_enabled} onChange={() => handleToggle('reminder_check_in_pre_enabled')} className="rounded text-blue-600" />
                                        <span>Pengingat Sebelum Masuk</span>
                                    </label>
                                    <div className="text-xs text-slate-500 pl-6">Mengirimkan push notification kepada karyawan untuk bersiap-siap melakukan absen masuk.</div>
                                    <div className="flex items-center gap-2 pl-6">
                                        <input type="number" min="0" max="120" value={settings.reminder_check_in_pre_minutes} onChange={e => handleChange('reminder_check_in_pre_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" disabled={!settings.reminder_check_in_pre_enabled} />
                                        <span className="text-sm text-slate-500 font-medium">menit sebelum waktu mulai kerja</span>
                                    </div>
                                </div>

                                {/* Granular Check-In Now */}
                                <div className="bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm text-slate-800 dark:text-slate-200">
                                        <input type="checkbox" checked={settings.reminder_check_in_now_enabled} onChange={() => handleToggle('reminder_check_in_now_enabled')} className="rounded text-blue-600" />
                                        <span>Pengingat Tepat Waktu Masuk</span>
                                    </label>
                                    <div className="text-xs text-slate-500 pl-6">Mengirimkan pengingat tepat saat jam kerja dimulai.</div>
                                    <div className="flex items-center gap-2 pl-6">
                                        <input type="number" min="0" max="15" value={settings.reminder_check_in_now_window_minutes} onChange={e => handleChange('reminder_check_in_now_window_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" disabled={!settings.reminder_check_in_now_enabled} />
                                        <span className="text-sm text-slate-500 font-medium">jendela menit setelah jam masuk</span>
                                    </div>
                                </div>
                                
                                {/* Granular Check-In Late */}
                                <div className="bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm text-slate-800 dark:text-slate-200">
                                        <input type="checkbox" checked={settings.reminder_check_in_late_enabled} onChange={() => handleToggle('reminder_check_in_late_enabled')} className="rounded text-blue-600" />
                                        <span>Peringatan Telat Absen Masuk</span>
                                    </label>
                                    <div className="text-xs text-slate-500 pl-6">Mengirimkan peringatan jika lewat batas jam masuk saat karyawan belum melakukan pencatatan absensi.</div>
                                    <div className="flex items-center gap-2 pl-6">
                                        <input type="number" min="1" max="180" value={settings.reminder_check_in_late_minutes} onChange={e => handleChange('reminder_check_in_late_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" disabled={!settings.reminder_check_in_late_enabled} />
                                        <span className="text-sm text-slate-500 font-medium">menit setelah lewat waktu masuk</span>
                                    </div>
                                </div>

                                {/* Granular Check-Out Pre */}
                                <div className="bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm text-slate-800 dark:text-slate-200">
                                        <input type="checkbox" checked={settings.reminder_check_out_pre_enabled} onChange={() => handleToggle('reminder_check_out_pre_enabled')} className="rounded text-blue-600" />
                                        <span>Pengingat Sebelum Pulang</span>
                                    </label>
                                    <div className="text-xs text-slate-500 pl-6">Mengirimkan imbauan bahwa jadwal pulang kerja segera tiba agar bersiap-siap melakukan checkout.</div>
                                    <div className="flex items-center gap-2 pl-6">
                                        <input type="number" min="0" max="120" value={settings.reminder_check_out_pre_minutes} onChange={e => handleChange('reminder_check_out_pre_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" disabled={!settings.reminder_check_out_pre_enabled} />
                                        <span className="text-sm text-slate-500 font-medium">menit sebelum jam pulang (0 = tepat waktu)</span>
                                    </div>
                                </div>
                                
                                {/* Granular Check-Out Now */}
                                <div className="bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm text-slate-800 dark:text-slate-200">
                                        <input type="checkbox" checked={settings.reminder_check_out_now_enabled} onChange={() => handleToggle('reminder_check_out_now_enabled')} className="rounded text-blue-600" />
                                        <span>Pengingat Tepat Waktu Pulang</span>
                                    </label>
                                    <div className="text-xs text-slate-500 pl-6">Mengirimkan pengingat tepat saat jam kerja berakhir.</div>
                                    <div className="flex items-center gap-2 pl-6">
                                        <input type="number" min="0" max="15" value={settings.reminder_check_out_now_window_minutes} onChange={e => handleChange('reminder_check_out_now_window_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" disabled={!settings.reminder_check_out_now_enabled} />
                                        <span className="text-sm text-slate-500 font-medium">jendela menit setelah jam pulang</span>
                                    </div>
                                </div>

                                {/* Granular Check-Out Late */}
                                <div className="bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-lg border border-slate-100 dark:border-slate-800 space-y-3">
                                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm text-slate-800 dark:text-slate-200">
                                        <input type="checkbox" checked={settings.reminder_check_out_late_enabled} onChange={() => handleToggle('reminder_check_out_late_enabled')} className="rounded text-blue-600" />
                                        <span>Peringatan Lupa Absen Pulang</span>
                                    </label>
                                    <div className="text-xs text-slate-500 pl-6">Mengirimkan peringatan bahwa jam pulang kerja sudah sangat terlambat terlewat tetapi status check-out belum terisi.</div>
                                    <div className="flex items-center gap-2 pl-6">
                                        <input type="number" min="1" max="240" value={settings.reminder_check_out_late_minutes} onChange={e => handleChange('reminder_check_out_late_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" disabled={!settings.reminder_check_out_late_enabled} />
                                        <span className="text-sm text-slate-500 font-medium">menit batas akhir absen pulang</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Categorised Notifications */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                       <h2 className="font-bold text-slate-805 text-slate-800 dark:text-slate-200 flex items-center gap-2 text-sm tracking-wide">
                           <MessageSquare className="w-4 h-4 text-emerald-500" /> Kategori Notifikasi Aktif
                       </h2>
                    </div>
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <input type="checkbox" checked={settings.announcement_push_enabled} onChange={() => handleToggle('announcement_push_enabled')} className="rounded text-blue-600 focus:ring-blue-500" />
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Pengumuman & Broadcast</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <input type="checkbox" checked={settings.approval_push_enabled} onChange={() => handleToggle('approval_push_enabled')} className="rounded text-blue-600 focus:ring-blue-500" />
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Hasil Approval Cuti/Izin/Koreksi</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <input type="checkbox" checked={settings.schedule_change_push_enabled} onChange={() => handleToggle('schedule_change_push_enabled')} className="rounded text-blue-600 focus:ring-blue-500" />
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Perubahan Jadwal & Shift Kerja</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <input type="checkbox" checked={settings.holiday_notice_push_enabled} onChange={() => handleToggle('holiday_notice_push_enabled')} className="rounded text-blue-600 focus:ring-blue-500" />
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Pemberitahuan Hari Libur</span>
                        </label>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 shadow-sm rounded-lg border border-slate-200 dark:border-slate-800 p-6">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                        <Clock className="w-5 h-5 text-purple-600" />
                        Pengaturan Lanjutan Scheduler
                    </h2>
                    
                    <div className="space-y-4">
                        <div className="pl-7 space-y-3">
                            <label className="flex items-center gap-3">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Penyesuaian Waktu Scheduler (Catch-up Window)</span>
                            </label>
                            <div className="text-xs text-slate-500">
                                Waktu toleransi bagi scheduler cloud untuk mengeksekusi reminder yang mungkin terlewat. Angka minimal yang dianjurkan adalah 6 karena interval jalan scheduler adalah tiap 5 menit.
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="number" min="5" max="30" value={settings.reminder_scheduler_catchup_minutes} onChange={e => handleChange('reminder_scheduler_catchup_minutes', Number(e.target.value))} className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-sm text-slate-800 dark:text-slate-200" />
                                <span className="text-sm text-slate-500 font-medium">menit</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end p-4">
                    <button type="submit" disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 text-sm">
                        <Save className="w-5 h-5" /> {loading ? "Menyimpan..." : "Simpan Pengaturan"}
                    </button>
                </div>
            </form>
        </div>
    );
};
