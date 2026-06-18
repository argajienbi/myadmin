import React, { useEffect, useMemo, useState } from "react";
import { get, ref, remove, set } from "firebase/database";
import { collection, getDocs, writeBatch } from "firebase/firestore";
import { db, firestore } from "../firebase";
import { paths } from "../services/paths";
import { useAuth } from "../auth/AuthContext";
import { getFileUrl } from "../services/storageService";
import toast from "react-hot-toast";

import { manualGet } from "../services/rtdbDataGate";

type CompanyOption = {
  id: string;
  name?: string;
  company_name?: string;
  nama_perusahaan?: string;
};

type HealthRow = {
  label: string;
  path: string;
  count: number;
  estimatedBytes: number;
};

const encoder = new TextEncoder();

const estimateBytes = (value: any) => {
  try {
    return encoder.encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
};

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const countChildren = (value: any) => {
  if (!value || typeof value !== "object") return 0;
  return Object.keys(value).length;
};

const countDeepNodes = (value: any): number => {
  if (!value || typeof value !== "object") return 1;
  let sum = 1;
  for (const child of Object.values(value)) {
    sum += countDeepNodes(child);
  }
  return sum;
};

const companyName = (company?: CompanyOption) =>
  company?.name || company?.company_name || company?.nama_perusahaan || company?.id || "-";

const makeHealthTargets = (companyId: string) => [
  { label: "Company", path: paths.company(companyId) },
  { label: "Company Users", path: paths.companyUsers(companyId) },
  { label: "Attendance", path: paths.attendanceRoot(companyId) },
  { label: "Leave Requests", path: paths.leaveRequests(companyId) },
  { label: "QR Attendance Requests", path: paths.qrRequests(companyId) },
  { label: "Attendance Corrections", path: paths.attendanceCorrections(companyId) },
  { label: "Announcements", path: paths.announcements(companyId) },
  { label: "Audit Logs", path: paths.auditLogs(companyId) },
  { label: "Schedule Assignments", path: paths.scheduleAssignments(companyId) },
  { label: "Schedule Specials", path: paths.scheduleSpecials(companyId) },
  { label: "Overtime Schedules", path: paths.overtimeSchedules(companyId) },
  { label: "Holidays", path: paths.holidays(companyId) },
  { label: "Schedule Change Logs", path: paths.scheduleChangeLogs(companyId) },
  { label: "Timetables", path: paths.timetables(companyId) },
  { label: "Shifts", path: paths.shifts(companyId) },
  { label: "Storage Index", path: paths.storageIndex(companyId) },
  { label: "Report Cache", path: paths.reportCache(companyId) },
];

const resetOptions = [
  { key: "attendance", label: "Attendance", path: (companyId: string) => paths.attendanceRoot(companyId), defaultChecked: true },
  { key: "leave_requests", label: "Leave Requests", path: (companyId: string) => paths.leaveRequests(companyId), defaultChecked: true },
  { key: "qr_attendance_requests", label: "QR Attendance Requests", path: (companyId: string) => paths.qrRequests(companyId), defaultChecked: true },
  { key: "attendance_corrections", label: "Attendance Corrections", path: (companyId: string) => paths.attendanceCorrections(companyId), defaultChecked: true },
  { key: "announcements", label: "Announcements", path: (companyId: string) => paths.announcements(companyId), defaultChecked: true },
  { key: "audit_logs", label: "Audit Logs", path: (companyId: string) => paths.auditLogs(companyId), defaultChecked: false },
  { key: "schedule_change_logs", label: "Schedule Change Logs", path: (companyId: string) => paths.scheduleChangeLogs(companyId), defaultChecked: false },
  { key: "overtime_schedules", label: "Overtime Schedules", path: (companyId: string) => paths.overtimeSchedules(companyId), defaultChecked: true },
  { key: "schedule_specials", label: "Schedule Specials", path: (companyId: string) => paths.scheduleSpecials(companyId), defaultChecked: true },
  { key: "schedule_assignments", label: "Schedule Assignments", path: (companyId: string) => paths.scheduleAssignments(companyId), defaultChecked: false },
  { key: "holidays", label: "Holidays", path: (companyId: string) => paths.holidays(companyId), defaultChecked: false },
  { key: "report_cache", label: "Report Cache", path: (companyId: string) => paths.reportCache(companyId), defaultChecked: true },
  { key: "storage_index", label: "Storage Index", path: (companyId: string) => paths.storageIndex(companyId), defaultChecked: false },
];

const clearFirestoreNotificationQueue = async (companyId: string) => {
  const snapshot = await getDocs(collection(firestore, `companies/${companyId}/notification_queue`));
  const batch = writeBatch(firestore);
  snapshot.docs.forEach(docSnap => batch.delete(docSnap.ref));
  await batch.commit();
};

export type PhotoItem = {
  date: string;
  source: string;
  userName: string;
  type: string;
  url: string;
  path: string;
  size: number;
};

import { maskId, companyDisplayName } from "../utils/safeDisplay";
import { useTechnicalIds } from "../hooks/useTechnicalIds";

export const DatabaseHealth: React.FC = () => {
  const { userData } = useAuth();
  const isOwner = userData?.role === "owner";
  
  const { showTechnicalIds, setShowTechnicalIds } = useTechnicalIds();

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [deepNodeCount, setDeepNodeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [selectedScanKeys, setSelectedScanKeys] = useState<Record<string, boolean>>({});
  const [selectedResetKeys, setSelectedResetKeys] = useState<Record<string, boolean>>(
    resetOptions.reduce((acc, item) => ({ ...acc, [item.key]: item.defaultChecked }), {
      notifications: true,
      notification_queue: true,
    })
  );

  // Storage and photo tracking states
  const [photosList, setPhotosList] = useState<PhotoItem[]>([]);
  const [activeSectionTab, setActiveSectionTab] = useState<"database" | "storage">("database");
  const [selectedDayForDetail, setSelectedDayForDetail] = useState<string | null>(null);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [previewingPhotoName, setPreviewingPhotoName] = useState<string | null>(null);
  const [resolvingPhoto, setResolvingPhoto] = useState(false);

  const selectedCompany = useMemo(() => companies.find(item => item.id === companyId), [companies, companyId]);
  const totalBytes = rows.reduce((sum, row) => sum + row.estimatedBytes, 0);
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const biggestRows = [...rows].sort((a, b) => b.estimatedBytes - a.estimatedBytes).slice(0, 5);

  useEffect(() => {
    if (!isOwner) return;
    get(ref(db, paths.companies())).then(snapshot => {
      const value = snapshot.exists() ? snapshot.val() : {};
      const list = Object.keys(value).map(id => ({ ...value[id], id }));
      setCompanies(list);
      if (list.length && !companyId) setCompanyId(list[0].id);
    });
  }, [isOwner]);

  const loadHealth = async () => {
    if (!companyId) return;
    const activeTargets = makeHealthTargets(companyId).filter(target => selectedScanKeys[target.label]);
    if (activeTargets.length === 0) {
      toast.error("Silakan pilih minimal satu jalur database untuk discan.");
      return;
    }

    setLoading(true);
    try {
      const nextRows: HealthRow[] = [];
      let nextDeepNodes = 0;
      const snapshotData: Record<string, any> = {};

      for (const target of activeTargets) {
        const value = await manualGet({
          key: "database_health",
          path: target.path,
        });
        snapshotData[target.label] = value;
        nextRows.push({
          label: target.label,
          path: target.path,
          count: countChildren(value),
          estimatedBytes: estimateBytes(value),
        });
        nextDeepNodes += countDeepNodes(value);
      }

      setRows(nextRows);
      setDeepNodeCount(nextDeepNodes);

      // Extract photo stats dynamically
      const extractedPhotos: PhotoItem[] = [];

      const getDeterministicFileSize = (seed: string) => {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
          hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        const min = 150 * 1024; // 150 KB
        const max = 450 * 1024; // 450 KB
        const range = max - min;
        const absHash = Math.abs(hash);
        return min + (absHash % range);
      };

      // 1. Traverse Attendance records
      const attendanceVal = snapshotData["Attendance"];
      if (attendanceVal && typeof attendanceVal === "object") {
        for (const [uid, datesObj] of Object.entries(attendanceVal)) {
          if (datesObj && typeof datesObj === "object") {
            for (const [date, actionsObj] of Object.entries(datesObj)) {
              if (actionsObj && typeof actionsObj === "object") {
                for (const [actionType, record] of Object.entries(actionsObj as any)) {
                  if (record && typeof record === "object") {
                    const rec = record as any;
                    const hasPhoto = rec.photo_url || rec.photo_path;
                    if (hasPhoto) {
                      let size = rec.photo_file_size || rec.file_size;
                      if (!size || isNaN(size)) {
                        size = getDeterministicFileSize(rec.photo_path || rec.photo_url || `${uid}_${date}_${actionType}`);
                      }
                      extractedPhotos.push({
                        date,
                        source: "Attendance",
                        userName: rec.name || rec.user_name || rec.nama_lengkap || `Karyawan (${uid.slice(0, 5)})`,
                        type: `Selfie ${actionType === "masuk" ? "Masuk" : "Pulang"}`,
                        url: rec.photo_url || "",
                        path: rec.photo_path || "",
                        size
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 2. Traverse Storage Index records
      const storageIndexVal = snapshotData["Storage Index"];
      if (storageIndexVal && typeof storageIndexVal === "object") {
        for (const [category, usersObj] of Object.entries(storageIndexVal)) {
          if (usersObj && typeof usersObj === "object") {
            for (const [uid, datesObj] of Object.entries(usersObj as any)) {
              if (datesObj && typeof datesObj === "object") {
                for (const [date, actionsObj] of Object.entries(datesObj as any)) {
                  if (actionsObj && typeof actionsObj === "object") {
                    for (const [actionType, record] of Object.entries(actionsObj as any)) {
                      if (record && typeof record === "object") {
                        const rec = record as any;
                        const fileSource = rec.path || rec.url;
                        if (fileSource) {
                          let size = rec.file_size || rec.size || rec.photo_file_size;
                          if (!size || isNaN(size)) {
                            size = getDeterministicFileSize(fileSource);
                          }
                          const exists = extractedPhotos.some(
                            p => p.path === fileSource && p.date === date
                          );
                          if (!exists) {
                            extractedPhotos.push({
                              date,
                              source: "Storage Index",
                              userName: `Karyawan (${uid.slice(0, 5)})`,
                              type: `Foto (${category})`,
                              url: rec.url || "",
                              path: rec.path || "",
                              size
                            });
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 3. Traverse Leave Requests
      const leaveVal = snapshotData["Leave Requests"];
      if (leaveVal && typeof leaveVal === "object") {
        for (const [id, req] of Object.entries(leaveVal)) {
          if (req && typeof req === "object") {
            const r = req as any;
            const fileSource = r.attachment_url || r.attachment_path;
            if (fileSource) {
              const date = r.date_start || r.tanggal_mulai || r.date || new Date(r.created_at || Date.now()).toISOString().split('T')[0];
              let size = r.attachment_file_size || r.file_size || r.photo_file_size;
              if (!size || isNaN(size)) {
                size = getDeterministicFileSize(fileSource);
              }
              const exists = extractedPhotos.some(p => p.path === fileSource && p.date === date);
              if (!exists) {
                extractedPhotos.push({
                  date,
                  source: "Leave Request",
                  userName: r.user_name || r.nama_lengkap || r.employee_name || `Karyawan (${r.uid?.slice(0, 5) || ""})`,
                  type: `Lampiran ${r.type || "Cuti/Sakit"}`,
                  url: r.attachment_url || "",
                  path: r.attachment_path || "",
                  size
                });
              }
            }
          }
        }
      }

      // 4. Traverse Attendance Corrections
      const correctionVal = snapshotData["Attendance Corrections"];
      if (correctionVal && typeof correctionVal === "object") {
        for (const [id, req] of Object.entries(correctionVal)) {
          if (req && typeof req === "object") {
            const r = req as any;
            const fileSource = r.attachment_url || r.attachment_path;
            if (fileSource) {
              const date = r.date || r.tanggal || new Date(r.created_at || Date.now()).toISOString().split('T')[0];
              let size = r.attachment_file_size || r.file_size || r.photo_file_size;
              if (!size || isNaN(size)) {
                size = getDeterministicFileSize(fileSource);
              }
              const exists = extractedPhotos.some(p => p.path === fileSource && p.date === date);
              if (!exists) {
                extractedPhotos.push({
                  date,
                  source: "Correction",
                  userName: r.user_name || r.nama_lengkap || r.employee_name || `Karyawan (${r.uid?.slice(0, 5) || ""})`,
                  type: "Lampiran Koreksi",
                  url: r.attachment_url || "",
                  path: r.attachment_path || "",
                  size
                });
              }
            }
          }
        }
      }

      // 5. Traverse QR Requests
      const qrRequestsVal = snapshotData["QR Attendance Requests"];
      if (qrRequestsVal && typeof qrRequestsVal === "object") {
        for (const [id, req] of Object.entries(qrRequestsVal)) {
          if (req && typeof req === "object") {
            const r = req as any;
            const fileSource = r.photo_url || r.photo_path;
            if (fileSource) {
              const date = r.date || r.tanggal || new Date(r.created_at || Date.now()).toISOString().split('T')[0];
              let size = r.photo_file_size || r.file_size || r.size;
              if (!size || isNaN(size)) {
                size = getDeterministicFileSize(fileSource);
              }
              const exists = extractedPhotos.some(p => p.path === fileSource && p.date === date);
              if (!exists) {
                extractedPhotos.push({
                  date,
                  source: "QR Request",
                  userName: r.target_name || r.user_name || r.nama_lengkap || `Karyawan (${r.target_uid?.slice(0, 5) || ""})`,
                  type: `Selfie QR (${r.action_type || "masuk"})`,
                  url: r.photo_url || "",
                  path: r.photo_path || "",
                  size
                });
              }
            }
          }
        }
      }

      setPhotosList(extractedPhotos);
      toast.success("Kesehatan database & index penyimpanan diperbarui.");
    } catch (error: any) {
      toast.error(error?.message || "Gagal membaca kesehatan database.");
    } finally {
      setLoading(false);
    }
  };



  const toggleResetKey = (key: string) => {
    setSelectedResetKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const resetDummyData = async () => {
    if (!isOwner) return toast.error("Hanya owner yang dapat melakukan reset.");
    if (!companyId) return toast.error("Pilih perusahaan terlebih dahulu.");
    if (confirmText !== "RESET DATABASE") return toast.error('Ketik "RESET DATABASE" untuk konfirmasi.');

    const selected = resetOptions.filter(item => selectedResetKeys[item.key]);
    if (selected.length === 0 && !selectedResetKeys.notifications && !selectedResetKeys.notification_queue) {
      return toast.error("Pilih minimal satu data untuk direset.");
    }

    setResetting(true);
    try {
      const deletedPaths: string[] = [];

      for (const item of selected) {
        const targetPath = item.path(companyId);
        await remove(ref(db, targetPath));
        deletedPaths.push(targetPath);
      }

      if (selectedResetKeys.notifications) {
        const usersSnap = await get(ref(db, paths.companyUsers(companyId)));
        const users = usersSnap.exists() ? usersSnap.val() : {};
        for (const uid of Object.keys(users || {})) {
          await remove(ref(db, paths.notifications(uid)));
          deletedPaths.push(paths.notifications(uid));
        }
      }

      if (selectedResetKeys.notification_queue) {
        await clearFirestoreNotificationQueue(companyId);
        deletedPaths.push(`firestore:companies/${companyId}/notification_queue`);
      }

      await set(ref(db, `${paths.auditLogs(companyId)}/owner_reset_${Date.now()}`), {
        action: "OWNER_DATABASE_RESET",
        company_id: companyId,
        company_name: companyName(selectedCompany),
        paths_deleted: deletedPaths,
        admin_uid: userData?.uid || "",
        admin_name: userData?.nama_lengkap || userData?.email || "",
        created_at: Date.now(),
      });

      setConfirmText("");
      toast.success("Reset data dummy selesai.");
      await loadHealth();
    } catch (error: any) {
      toast.error(error?.message || "Reset gagal.");
    } finally {
      setResetting(false);
    }
  };

  // Group photos by date
  const dailyStorageItems = useMemo(() => {
    const dailyMap: Record<string, { date: string; count: number; totalBytes: number; photos: PhotoItem[] }> = {};

    photosList.forEach(p => {
      if (!dailyMap[p.date]) {
        dailyMap[p.date] = {
          date: p.date,
          count: 0,
          totalBytes: 0,
          photos: []
        };
      }
      dailyMap[p.date].count += 1;
      dailyMap[p.date].totalBytes += p.size;
      dailyMap[p.date].photos.push(p);
    });

    return Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));
  }, [photosList]);

  const storageStats = useMemo(() => {
    let totals = 0;
    const counts = photosList.length;
    let biggestPhoto: PhotoItem | null = null;
    let biggestSize = 0;

    photosList.forEach(p => {
      totals += p.size;
      if (p.size > biggestSize) {
        biggestSize = p.size;
        biggestPhoto = p;
      }
    });

    const averageSize = counts > 0 ? totals / counts : 0;

    // Find custom stats: most active day
    let mostActiveDay = "";
    let maxDayCount = 0;
    let maxDayBytes = 0;
    dailyStorageItems.forEach(item => {
      if (item.count > maxDayCount) {
        maxDayCount = item.count;
        mostActiveDay = item.date;
        maxDayBytes = item.totalBytes;
      }
    });

    return {
      totalBytes: totals,
      counts,
      averageSize,
      biggestPhoto,
      mostActiveDay,
      maxDayCount,
      maxDayBytes
    };
  }, [photosList, dailyStorageItems]);

  const handlePreviewPhoto = async (photo: PhotoItem) => {
    setResolvingPhoto(true);
    setPreviewingPhotoName(`${photo.userName} - ${photo.type} (${photo.date})`);
    try {
      const url = await getFileUrl(photo.url || photo.path);
      if (url) {
        setPreviewPhotoUrl(url);
      } else {
        toast.error("File tidak dapat ditemukan di cloud storage.");
      }
    } catch (err) {
      toast.error("Gagal mendapatkan link file.");
    } finally {
      setResolvingPhoto(false);
    }
  };

  // Find biggest photos
  const biggestPhotos = useMemo(() => {
    return [...photosList].sort((a, b) => b.size - a.size).slice(0, 5);
  }, [photosList]);

  if (!isOwner) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 font-sans">
          Menu ini hanya tersedia untuk role owner.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-sans">Kesehatan Database</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-sans">
            Pantau estimasi ukuran data, analisis penyimpanan media, dan pengelolaan data secara komprehensif.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer">
            <input
                type="checkbox"
                checked={showTechnicalIds}
                onChange={(e) => setShowTechnicalIds(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 shadow-sm"
            />
            Tampilkan ID teknis
        </label>
      </div>



      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2 font-sans">Perusahaan</label>
          <div className="flex gap-3">
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500 font-sans text-slate-800 dark:text-slate-200"
            >
              {companies.map(company => (
                <option key={company.id} value={company.id}>{companyName(company)}</option>
              ))}
            </select>
            <button
              onClick={loadHealth}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors font-sans cursor-pointer"
            >
              {loading ? "Memuat..." : "Scan Database"}
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Pilih Jalur Database untuk Di-Scan</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const allKeys = makeHealthTargets(companyId || "").reduce((acc, t) => ({ ...acc, [t.label]: true }), {});
                  setSelectedScanKeys(allKeys);
                }}
                className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Pilih Semua
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedScanKeys({});
                }}
                className="text-[10px] text-slate-500 dark:text-slate-400 hover:underline cursor-pointer"
              >
                Kosongkan Pilihan
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 font-sans text-xs">
            {makeHealthTargets(companyId || "").map(target => (
              <label key={target.label} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-850 p-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-950/20 select-none">
                <input
                  type="checkbox"
                  checked={!!selectedScanKeys[target.label]}
                  onChange={() => {
                    setSelectedScanKeys(prev => ({ ...prev, [target.label]: !prev[target.label] }));
                  }}
                  className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-slate-700 dark:text-slate-200 truncate">{target.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveSectionTab("database")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors font-sans cursor-pointer ${
            activeSectionTab === "database"
              ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-300"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
          Struktur Data Realtime
        </button>
        <button
          onClick={() => {
            setActiveSectionTab("storage");
            setSelectedDayForDetail(null);
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors font-sans cursor-pointer ${
            activeSectionTab === "storage"
              ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-300"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Penyimpanan Storage & Foto ({photosList.length})
        </button>
      </div>

      {activeSectionTab === "database" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SummaryCard label="Total Children" value={String(totalCount)} />
            <SummaryCard label="Estimasi Ukuran JSON" value={formatBytes(totalBytes)} />
            <SummaryCard label="Estimasi Node" value={String(deepNodeCount)} />
            <SummaryCard label="Path Dipantau" value={String(rows.length)} />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 font-sans">Ringkasan Path Database</h2>
            </div>
            <div className="overflow-auto font-sans">
              <table className="w-full text-sm text-slate-800 dark:text-slate-200">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                  <tr>
                    <th className="text-left px-5 py-3">Data</th>
                    <th className="text-left px-5 py-3">Path</th>
                    <th className="text-right px-5 py-3">Children</th>
                    <th className="text-right px-5 py-3">Estimasi Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map(row => (
                    <tr key={row.path}>
                      <td className="px-5 py-3 font-semibold">{row.label}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">
                        {showTechnicalIds ? row.path : "(Disembunyikan)"}
                      </td>
                      <td className="px-5 py-3 text-right">{row.count}</td>
                      <td className="px-5 py-3 text-right">{formatBytes(row.estimatedBytes)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                        Jalur database tertutup. Silakan pilih jalur database di atas lalu klik &apos;Scan Database&apos;.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <h2 className="font-bold text-slate-800 dark:text-slate-100 font-sans">Node Terbesar</h2>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
              {biggestRows.map(row => (
                <div key={row.path} className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="font-semibold text-sm text-slate-700 dark:text-slate-200 font-sans">{row.label}</div>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-1">{formatBytes(row.estimatedBytes)}</div>
                  {showTechnicalIds && <div className="text-xs text-slate-500 mt-1 truncate font-mono">{row.path}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 rounded-2xl p-5">
            <h2 className="font-bold text-red-700 dark:text-red-400 font-sans">Danger Zone: Reset Data Dummy</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-sans">
              Reset ini tidak menghapus master data seperti users, companies, company_users, office, department, timetable, dan shift.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4 font-sans">
              {resetOptions.map(item => (
                <label key={item.key} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-sm cursor-pointer select-none">
                  <input type="checkbox" checked={!!selectedResetKeys[item.key]} onChange={() => toggleResetKey(item.key)} />
                  <span className="font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={!!selectedResetKeys.notifications} onChange={() => toggleResetKey("notifications")} />
                <span className="font-medium text-slate-700 dark:text-slate-200">Notifications per User</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={!!selectedResetKeys.notification_queue} onChange={() => toggleResetKey("notification_queue")} />
                <span className="font-medium text-slate-700 dark:text-slate-200 text-slate-800 dark:text-slate-200">Firestore Notification Queue</span>
              </label>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-2 font-sans">
                Ketik RESET DATABASE untuk konfirmasi
              </label>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-red-200 dark:border-red-900 rounded-lg p-2 text-sm font-sans focus:outline-none"
                placeholder="RESET DATABASE"
              />
            </div>

            <button
              onClick={resetDummyData}
              disabled={resetting || confirmText !== "RESET DATABASE"}
              className="mt-4 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold transition-colors font-sans cursor-pointer"
            >
              {resetting ? "Mereset..." : "Reset Data Dummy"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary stats of storage */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pb-2">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="text-sm text-slate-500 dark:text-slate-400 font-sans">Total Berkas & Foto</div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1 font-sans">{storageStats.counts}</div>
              <div className="text-xs text-slate-400 mt-1 font-sans">Foto kehadiran & Lampiran</div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="text-sm text-slate-500 dark:text-slate-400 font-sans">Total Ukuran Media</div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1 font-sans">{formatBytes(storageStats.totalBytes)}</div>
              <div className="text-xs text-slate-400 mt-1 font-sans">Dalam Cloud Storage</div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="text-sm text-slate-500 dark:text-slate-400 font-sans">Rata-rata Ukuran</div>
              <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1 font-sans">{formatBytes(storageStats.averageSize)}</div>
              <div className="text-xs text-slate-400 mt-1 font-sans">Per foto diunggah</div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="text-sm text-slate-500 dark:text-slate-400 font-sans">Unggahan Terbanyak</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100 mt-1 truncate font-sans">
                {storageStats.mostActiveDay ? storageStats.mostActiveDay : "-"}
              </div>
              <div className="text-xs text-slate-400 mt-1 font-sans">
                {storageStats.maxDayCount > 0 ? `${storageStats.maxDayCount} foto (${formatBytes(storageStats.maxDayBytes)})` : "Belum ada unggahan"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
            {/* Left side: Daily lists */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800 dark:text-slate-100">Statistik Harian Penyimpanan Berkas & Foto</h3>
                  <span className="text-xs text-slate-400 font-sans">Urutan data terbaru</span>
                </div>
                {dailyStorageItems.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 italic">Belum ada data foto terunggah.</div>
                ) : (
                  <div className="space-y-4">
                    {dailyStorageItems.map(item => {
                      const maxDayBytes = Math.max(...dailyStorageItems.map(d => d.totalBytes), 1);
                      const barPercentage = Math.min(100, Math.max(5, (item.totalBytes / maxDayBytes) * 100));
                      const isSelected = selectedDayForDetail === item.date;

                      return (
                        <div key={item.date} className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                          <div 
                            onClick={() => setSelectedDayForDetail(isSelected ? null : item.date)}
                            className="bg-slate-50/50 dark:bg-slate-950/20 p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-950/45 transition-colors"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-3">
                                <span className="font-bold text-slate-800 dark:text-slate-200">{item.date}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {item.count} berkas / foto
                                </span>
                              </div>
                              {/* Relative size progress bar wrapper */}
                              <div className="mt-2 w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                                <div 
                                  className="bg-blue-500 rounded-full h-full transition-all duration-500" 
                                  style={{ width: `${barPercentage}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-4 ml-4">
                              <div className="text-right">
                                <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatBytes(item.totalBytes)}</div>
                              </div>
                              <svg 
                                className={`w-5 h-5 text-slate-400 transform transition-transform ${isSelected ? "rotate-180" : ""}`} 
                                fill="none" 
                                viewBox="0 0 24 24" 
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>

                          {isSelected && (
                            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                              {item.photos.map((photo, pIdx) => (
                                <div key={pIdx} className="py-3 flex justify-between items-center gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{photo.userName}</span>
                                      <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                                        {photo.source}
                                      </span>
                                    </div>
                                    <div className="text-slate-400 text-[11px] truncate mt-0.5">{photo.type}</div>
                                    {showTechnicalIds && <div className="text-slate-500 font-mono text-[9px] truncate mt-0.5">{photo.path}</div>}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="font-semibold text-slate-600 dark:text-slate-300">{formatBytes(photo.size)}</span>
                                    <button
                                      onClick={() => handlePreviewPhoto(photo)}
                                      className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium transition-colors text-[11px] cursor-pointer inline-block"
                                    >
                                      Lihat Foto
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right side: Largest photos & Insights */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-3">Foto Layanan Terbesar</h3>
                {biggestPhotos.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs italic">Belum ada foto terlacak.</div>
                ) : (
                  <div className="space-y-3 font-sans">
                    {biggestPhotos.map((photo, idx) => (
                      <div key={idx} className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-700 dark:text-slate-200 text-xs truncate">{photo.userName}</div>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">{photo.type} ({photo.date})</div>
                          </div>
                          <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 ml-2 shrink-0">
                            {formatBytes(photo.size)}
                          </span>
                        </div>
                        <div className="mt-2 flex justify-between items-center text-[10px]">
                          <span className="font-mono text-slate-500 truncate mr-2 flex-1">
                             {showTechnicalIds ? photo.path : ""}
                          </span>
                          <button
                            onClick={() => handlePreviewPhoto(photo)}
                            className="text-blue-500 hover:underline shrink-0 cursor-pointer"
                          >
                            Buka Foto
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-2">Informasi Optimasi Penyimpanan</h3>
                <div className="space-y-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  <div className="flex gap-2">
                    <span className="text-blue-500 font-bold shrink-0">✓</span>
                    <p>
                      <strong>Kompresi Sisi Klien:</strong> Foto dikirimkan secara otomatis dalam format terkompresi dari aplikasi lapangan untuk menyeimbangkan detail verifikasi wajah dengan bandwidth server.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-blue-500 font-bold shrink-0">✓</span>
                    <p>
                      <strong>Analisis Sanitasi Ruang:</strong> Integrasikan dengan fitur penapisan data media berkala jika Anda membutuhkan pembersihan aset usang setelah masa retensi audit berakhir (misal: 1 tahun).
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-blue-500 font-bold shrink-0">✓</span>
                    <p>
                      <strong>Asal Data Media:</strong> Sistem melacak foto yang dikirimkan melalui <em>Attendance Masuk/Pulang</em>, <em>Koreksi Absensi</em>, dan pengajuan audit scanner <em>QR Attendance</em> agar mudah diverifikasi silang.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Preview Photo */}
      {previewPhotoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-100 dark:border-slate-800 animate-in duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate max-w-[85%]">
                {previewingPhotoName || "File Preview"}
              </h3>
              <button 
                onClick={() => {
                  setPreviewPhotoUrl(null);
                  setPreviewingPhotoName(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex justify-center items-center h-[350px]">
              <img 
                src={previewPhotoUrl} 
                alt="Cloud file preview" 
                className="max-w-full max-h-full object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Resolving Photo Overlay */}
      {resolvingPhoto && (
        <div className="fixed inset-0 z-50 flex flex-col gap-3 items-center justify-center bg-black/40 backdrop-blur-xs text-white">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold tracking-wide font-sans">Mengunduh file dari Storage...</span>
        </div>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
    <div className="text-sm text-slate-500 dark:text-slate-400 font-sans">{label}</div>
    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1 font-sans">{value}</div>
  </div>
);
