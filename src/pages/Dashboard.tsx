import React, { useEffect, useState, useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { loadAttendanceByDateRange, loadRecentAttendance, loadDashboardSummary } from "../services/rtdbLeanService";
import toast from "react-hot-toast";
import DataGatePanel from "../components/DataGatePanel";
import { manualGet } from "../services/rtdbDataGate";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from "recharts";
import { 
  Users, CheckCircle, Clock, FileText, Calendar as CalendarIcon, Briefcase, 
  Activity, AlertCircle, TrendingUp, Flag, ShieldAlert, ArrowRight, User
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, subDays, isSameMonth, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";

// Helper parsers
function getRecordDate(record: any) {
  return record.date || record.tanggal || record.dateKey || "";
}
function getRecordTime(record: any) {
  return record.time || record.waktu || record.created_time || "";
}
function getActionType(record: any) {
  return record.action_type || record.type || record.jenis || "";
}
function isCheckIn(record: any) {
  const action = String(getActionType(record)).toLowerCase();
  return action.includes("masuk") || action.includes("check_in") || action === "in";
}
function isCheckOut(record: any) {
  const action = String(getActionType(record)).toLowerCase();
  return action.includes("pulang") || action.includes("check_out") || action === "out";
}
function getAttendanceStatus(record: any) {
  return String(
    record.attendance_status ||
    record.status_absen ||
    record.validation_status ||
    record.status ||
    "unknown"
  ).toLowerCase();
}

function getAttendanceStatusLabel(status: string) {
  const value = String(status || "").toLowerCase();

  if (value.includes("late") || value.includes("terlambat") || value.includes("telat")) {
    return "Terlambat";
  }

  if (value.includes("early") || value.includes("pulang cepat") || value.includes("awal")) {
    return "Pulang Cepat";
  }

  if (value.includes("outside") || value.includes("luar_radius") || value.includes("out_of_radius")) {
    return "Luar Radius";
  }

  if (value.includes("pending")) {
    return "Menunggu";
  }

  if (value.includes("reject") || value.includes("ditolak")) {
    return "Ditolak";
  }

  if (value.includes("approved") || value.includes("success") || value.includes("valid")) {
    return "Disetujui";
  }

  if (value.includes("on_time") || value.includes("tepat")) {
    return "Tepat Waktu";
  }

  if (!value || value === "unknown") {
    return "Belum Diketahui";
  }

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getActionTypeLabel(record: any) {
  if (isCheckIn(record)) return "Masuk";
  if (isCheckOut(record)) return "Pulang";

  const action = String(getActionType(record) || "").toLowerCase();

  if (action.includes("izin")) return "Izin";
  if (action.includes("sakit")) return "Sakit";
  if (action.includes("cuti")) return "Cuti";
  if (action.includes("lembur")) return "Lembur";

  return action
    ? action.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase())
    : "Presensi";
}

function getRecordTimestamp(record: any) {
  if (record.created_at) return Number(record.created_at) || 0;

  const date = getRecordDate(record);
  const time = getRecordTime(record) || "00:00:00";

  if (!date) return 0;

  const parsed = new Date(`${date}T${time}`).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export const Dashboard: React.FC = () => {
  const { userData } = useAuth();
  const navigate = useNavigate();

  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<any[]>([]);
  
  // Filters
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [selectedOffice, setSelectedOffice] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [selectedGroup, setSelectedGroup] = useState<string>("all");

  // Master Data
  const [employees, setEmployees] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);

  // Raw Data
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<any>(null);
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(false);
  const [trendSummaryData, setTrendSummaryData] = useState<any[]>([]);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [pendingApprovalSummary, setPendingApprovalSummary] = useState<any>(null);
  const [pendingApprovalLoading, setPendingApprovalLoading] = useState(false);
  const [pendingApprovalMessage, setPendingApprovalMessage] = useState("");
  const [holidays, setHolidays] = useState<any[]>([]);
  const [specials, setSpecials] = useState<any[]>([]);

  const isOwner = userData?.role === "owner";

  const withCompanyQuery = (path: string, params: Record<string, string | number | undefined | null> = {}) => {
    const search = new URLSearchParams();

    if (targetCompanyId) {
      search.set("companyId", targetCompanyId);
    }

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      search.set(key, String(value));
    });

    const qs = search.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const goToAttendance = (params: Record<string, string | number | undefined | null> = {}) => {
    navigate(withCompanyQuery("/attendance", params));
  };

  const goToApprovals = (params: Record<string, string | number | undefined | null> = {}) => {
    navigate(withCompanyQuery("/approvals", params));
  };

  const goToReports = (params: Record<string, string | number | undefined | null> = {}) => {
    navigate(withCompanyQuery("/reports", params));
  };

  const goToSchedules = (params: Record<string, string | number | undefined | null> = {}) => {
    navigate(withCompanyQuery("/schedules", params));
  };

  const [hasRunScan, setHasRunScan] = useState<boolean>(false);

  useEffect(() => {
    if (isOwner) {
      get(ref(db, paths.companies())).then((snapshot) => {
        if (snapshot.exists()) {
           const compList = Object.keys(snapshot.val()).map(k => ({...snapshot.val()[k], id: k}));
           setCompanies(compList);
           const saved = localStorage.getItem('admin_selected_company') || "";
           if (saved && compList.find(c => c.id === saved)) {
              setTargetCompanyId(saved);
           } else if (compList.length > 0) {
              setTargetCompanyId(compList[0].id);
              localStorage.setItem('admin_selected_company', compList[0].id);
           }
        }
      });
    } else if (userData?.company_id) {
      setTargetCompanyId(userData.company_id);
    }
  }, [isOwner, userData]);

  const fetchDashboardData = async () => {
    if (!targetCompanyId) return;
    setDashboardSummaryLoading(true);
    setPendingApprovalLoading(true);
    setPendingApprovalMessage("");
    try {
      const summaryPath = paths.dashboardSummary(targetCompanyId, selectedDate);
      const approvalPath = paths.pendingApprovalSummary(targetCompanyId);

      const [summaryData, approvalData] = await Promise.all([
        manualGet({ key: "dashboard_summary", path: summaryPath }),
        manualGet({ key: "leave_requests", path: approvalPath })
      ]);

      setDashboardSummary(summaryData);
      if (approvalData) {
        setPendingApprovalSummary(approvalData);
        setPendingApprovalsCount(Number(approvalData.total || approvalData.pending_total || 0));
      } else {
        setPendingApprovalSummary(null);
        setPendingApprovalsCount(0);
      }

      // Load master data on demand
      const [usersSnap, officesSnap, deptsSnap, groupsSnap, holidaysSnap, specialsSnap] = await Promise.all([
        manualGet({ key: "company_users", path: paths.companyUsers(targetCompanyId) }),
        manualGet({ key: "companies", path: paths.offices(targetCompanyId) }),
        manualGet({ key: "companies", path: paths.departments(targetCompanyId) }),
        manualGet({ key: "companies", path: paths.employeeGroups(targetCompanyId) }),
        manualGet({ key: "holidays", path: paths.holidays(targetCompanyId) }),
        manualGet({ key: "companies", path: paths.scheduleSpecials(targetCompanyId) }),
      ]);

      setEmployees(usersSnap ? Object.keys(usersSnap).map(k => ({ ...usersSnap[k], uid: k })) : []);
      setOffices(officesSnap ? Object.keys(officesSnap).map(k => ({ ...officesSnap[k], id: k })) : []);
      setDepartments(deptsSnap ? Object.keys(deptsSnap).map(k => ({ ...deptsSnap[k], id: k })) : []);
      setGroups(groupsSnap ? Object.keys(groupsSnap).map(k => ({ ...groupsSnap[k], id: k })) : []);
      setHolidays(holidaysSnap ? Object.keys(holidaysSnap).map(k => ({ ...holidaysSnap[k], id: k })) : []);
      setSpecials(specialsSnap ? Object.keys(specialsSnap).map(k => ({ ...specialsSnap[k], id: k })) : []);

      // Load recent logs too
      const recent = await manualGet({ key: "attendance", path: paths.attendanceRecent(targetCompanyId) });
      if (recent) {
        const rows = Object.keys(recent).map((id) => ({
          id,
          ...recent[id],
        }));
        rows.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
        setRecentLogs(rows.slice(0, 10));
      } else {
        setRecentLogs([]);
      }

      setHasRunScan(true);
      toast.success("Ringkasan dashboard berhasil dimuat.");
    } catch (err: any) {
      toast.error(err.message || "Gagal memuat ringkasan.");
    } finally {
      setDashboardSummaryLoading(false);
      setPendingApprovalLoading(false);
    }
  };

  // Attempt auto-load of allowed paths
  useEffect(() => {
    if (!targetCompanyId || !selectedDate) return;
    const tryAutoLoad = async () => {
      try {
        const summaryPath = paths.dashboardSummary(targetCompanyId, selectedDate);
        const approvalPath = paths.pendingApprovalSummary(targetCompanyId);

        const [summaryData, approvalData] = await Promise.all([
          manualGet({ key: "dashboard_summary", path: summaryPath }),
          manualGet({ key: "leave_requests", path: approvalPath })
        ]);

        if (summaryData || approvalData) {
          setDashboardSummary(summaryData);
          if (approvalData) {
            setPendingApprovalSummary(approvalData);
            setPendingApprovalsCount(Number(approvalData.total || approvalData.pending_total || 0));
          }
          setHasRunScan(true);
        } else {
          setDashboardSummary(null);
          setPendingApprovalSummary(null);
          setPendingApprovalsCount(0);
          setHasRunScan(false);
        }
      } catch (e) {
        setHasRunScan(false);
      }
    };
    tryAutoLoad();
  }, [targetCompanyId, selectedDate]);

  // Derived filtered data
  const filteredEmployees = useMemo(() => {
     return employees.filter(emp => {
        if (emp.status_akun !== 'active') return false;
        if (selectedOffice !== 'all' && String(emp.office_id) !== selectedOffice) return false;
        if (selectedDepartment !== 'all' && String(emp.department_id) !== selectedDepartment) return false;
        if (selectedGroup !== 'all' && String(emp.group_id) !== selectedGroup) return false;
        return true;
     });
  }, [employees, selectedOffice, selectedDepartment, selectedGroup]);

  const activeEmployeeIds = new Set(filteredEmployees.map(e => e.uid));

  // Load Lean Trend 30 Days (Only if scan/manual run has loaded filteredEmployees list)
  useEffect(() => {
    if (!targetCompanyId || !filteredEmployees.length || !hasRunScan) return;
    const fetchTrend = async () => {
      const data = [];
      for(let i=29; i>=0; i--) {
         const d = subDays(new Date(), i);
         const dayStr = format(d, 'yyyy-MM-dd');
         const dayLabel = format(d, 'dd MMM', { locale: idLocale });
         
         const sum = await loadDashboardSummary(targetCompanyId, dayStr).catch(()=>null);
         if (sum) {
           data.push({
             name: dayLabel,
             Hadir: sum.hadir || 0,
             Terlambat: sum.telat || 0,
             'Izin/Sakit/Cuti': sum.izin_sakit_cuti || 0,
             'Belum Absen': sum.absen || 0,
           });
         } else {
           data.push({
             name: dayLabel,
             Hadir: 0,
             Terlambat: 0,
             'Izin/Sakit/Cuti': 0,
             'Belum Absen': 0,
           });
         }
      }
      setTrendSummaryData(data);
    };
    fetchTrend();
  }, [targetCompanyId, filteredEmployees.length, hasRunScan]);

  const handleAmbilDataTanggalIni = async () => {
     if (!targetCompanyId || !selectedDate) return;
     toast.promise(
       loadAttendanceByDateRange({ companyId: targetCompanyId, startDate: selectedDate, endDate: selectedDate }),
       {
          loading: "Mengambil data harian...",
          success: (res) => {
             setAttendanceRecords(res);
             return "Data harian berhasil dimuat.";
          },
          error: "Gagal mengambil data harian"
       }
     );
  };


  // Today Stats
  const todayStats = useMemo(() => {
     if (dashboardSummary) {
       return {
         hadir: dashboardSummary.hadir || 0,
         telat: dashboardSummary.telat || 0,
         absen: dashboardSummary.absen || 0,
         izin: dashboardSummary.izin || 0,
         sakit: dashboardSummary.sakit || 0,
         cuti: dashboardSummary.cuti || 0
       };
     }

     let hadir = 0;
     let telat = 0;
     let izinTotal = 0;
     let sakitTotal = 0;
     let cutiTotal = 0;
     
     const currentDayRecords = attendanceRecords.filter(r => 
        (r.dateKey === selectedDate || r.parsedDate === selectedDate) && 
        activeEmployeeIds.has(r.uid)
     );

     const presentUsers = new Set<string>();

     currentDayRecords.forEach(r => {
        if (isCheckIn(r)) {
           presentUsers.add(r.uid);
           const status = getAttendanceStatus(r);
           if (status.includes("late") || status.includes("terlambat") || status.includes("telat")) {
              telat++;
           }
        }
     });

     hadir = presentUsers.size;
     // Catatan:
     /// Belum Absen belum sama dengan Alpa.
     /// Untuk menentukan Alpa secara akurat, dashboard harus mengecek jadwal kerja karyawan.
     /// Jangan tampilkan sebagai Mangkir/Alpa sebelum integrasi schedule resolver selesai.
     const absen = Math.max(0, filteredEmployees.length - hadir);

     return { hadir, telat, absen, izin: izinTotal, sakit: sakitTotal, cuti: cutiTotal };
  }, [attendanceRecords, activeEmployeeIds, selectedDate, filteredEmployees.length]);

  // 30 Days Trend
  const trendData = trendSummaryData;

  // Upcoming Holidays (Current month)
  const currentHolidays = useMemo(() => {
     const todayDate = new Date();
     const items: { date: string, name: string, type: 'holiday' | 'special' }[] = [];
     
     holidays.forEach(h => {
        if (h.date && isSameMonth(parseISO(h.date), todayDate)) {
           items.push({ date: h.date, name: h.name || h.title, type: 'holiday' });
        }
     });
     specials.forEach(s => {
        if (s.date && isSameMonth(parseISO(s.date), todayDate)) {
           items.push({ date: s.date, name: s.title || s.name, type: 'special' });
        }
     });
     
     return items.sort((a,b) => a.date.localeCompare(b.date));
  }, [holidays, specials]);

  // Recent Logs
  const recentLogsComputed = useMemo(() => {
     const logs = [...recentLogs].filter(r => activeEmployeeIds.has(r.uid));
     return logs.slice(0, 10);
  }, [recentLogs, activeEmployeeIds]);
  
  // Discipline Board (30 days)
  const discipline = useMemo(() => { 
     return { late: [], early: [], present: [], absent: [] };
     /*
     const lateMap: Record<string, number> = {};
     const earlyMap: Record<string, number> = {};
     const presentMap: Record<string, number> = {};
     
     const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
     
     attendanceRecords.forEach(r => {
        if (!activeEmployeeIds.has(r.uid)) return;
        const rDate = r.dateKey || r.parsedDate;
        if (rDate >= thirtyDaysAgo) {
            if (isCheckIn(r)) {
               presentMap[r.uid] = (presentMap[r.uid] || 0) + 1;
               const st = getAttendanceStatus(r);
               if (st.includes('late') || st.includes('terlambat') || st.includes('telat')) {
                  lateMap[r.uid] = (lateMap[r.uid] || 0) + 1;
               }
            } else if (isCheckOut(r)) {
               const st = getAttendanceStatus(r);
               if (st.includes('early') || st.includes('pulang cepat') || st.includes('awal')) {
                  earlyMap[r.uid] = (earlyMap[r.uid] || 0) + 1;
               }
            }
        }
     });

     const lateArr = Object.keys(lateMap).map(uid => ({ uid, count: lateMap[uid] })).sort((a,b) => b.count - a.count).slice(0,3);
     const earlyArr = Object.keys(earlyMap).map(uid => ({ uid, count: earlyMap[uid] })).sort((a,b) => b.count - a.count).slice(0,3);
     const presentArr = Object.keys(presentMap).map(uid => ({ uid, count: presentMap[uid] })).sort((a,b) => b.count - a.count).slice(0,3);
     
     // Sering Lupa Absen is tricky without knowing workdays precisely over 30 days. We estimate it based on who is active but has lowest present score.
     const absentArr = Array.from(activeEmployeeIds).map(uid => {
         const pres = presentMap[uid] || 0;
         return { uid, absenceEstimate: 30 - pres }; 
     }).sort((a,b) => b.absenceEstimate - a.absenceEstimate).slice(0,3);

     return { late: lateArr, early: earlyArr, present: presentArr, absent: absentArr };
  }, [attendanceRecords, activeEmployeeIds]); */ }, []);


  if (!userData) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm">
         <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Dashboard Presensi</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Ringkasan kehadiran dan operasional hari ini</p>
         </div>

         {isOwner && (
            <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-slate-400" />
                <select 
                    value={targetCompanyId} 
                    onChange={(e) => {
                       setTargetCompanyId(e.target.value);
                       localStorage.setItem('admin_selected_company', e.target.value);
                    }}
                    className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded p-2 text-sm focus:outline-none focus:border-blue-500 w-48"
                >
                    <option value="" disabled>-- Pilih Perusahaan --</option>
                    {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </div>
         )}
      </div>

      <DataGatePanel />

      {!targetCompanyId ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 rounded-xl text-center text-slate-500 shadow-sm flex flex-col items-center">
             <Briefcase className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-4" />
             <h2 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">Silakan pilih perusahaan</h2>
             <p className="text-sm">Pilih perusahaan dari menu di atas atau hubungi Administrator.</p>
          </div>
      ) : (
      <>
         {/* Filter Bar */}
         <div className="flex flex-wrap gap-4 items-end bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl shadow-sm">
            <div className="flex flex-col">
               <label className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Tanggal</label>
               <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-sm text-slate-800 dark:text-slate-200" />
            </div>
            <div className="flex flex-col">
               <label className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Kantor</label>
               <select value={selectedOffice} onChange={e => setSelectedOffice(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-sm text-slate-800 dark:text-slate-200 min-w-[120px]">
                  <option value="all">Semua Kantor</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
               </select>
            </div>
            <div className="flex flex-col">
               <label className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Departemen</label>
               <select value={selectedDepartment} onChange={e => setSelectedDepartment(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-sm text-slate-800 dark:text-slate-200 min-w-[120px]">
                  <option value="all">Semua Departemen</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
               </select>
            </div>
            <div className="flex flex-col">
               <label className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Grup Karyawan</label>
               <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-sm text-slate-800 dark:text-slate-200 min-w-[120px]">
                  <option value="all">Semua Grup</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
               </select>
            </div>
            <div className="flex flex-col">
               <button
                  type="button"
                  onClick={fetchDashboardData}
                  disabled={dashboardSummaryLoading || pendingApprovalLoading}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer animate-none"
               >
                  {dashboardSummaryLoading || pendingApprovalLoading ? "Memproses..." : hasRunScan ? "Refresh Ringkasan" : "Ambil Ringkasan"}
               </button>
            </div>
         </div>

         {!hasRunScan ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 rounded-xl text-center text-slate-500 shadow-sm flex flex-col items-center justify-center space-y-4">
               <FileText className="w-12 h-12 text-slate-300 dark:text-slate-700 animate-none" />
               <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-300">Ringkasan belum dimuat</h2>
               <p className="text-sm max-w-md text-slate-500">
                  Jalur database tertutup demi efisiensi bandwidth. Silakan klik &apos;Ambil Ringkasan&apos; untuk memproses dan membuka ringkasan data.
               </p>
               <button
                  type="button"
                  onClick={fetchDashboardData}
                  disabled={dashboardSummaryLoading || pendingApprovalLoading}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
               >
                  {dashboardSummaryLoading || pendingApprovalLoading ? "Memproses..." : "Ambil Ringkasan"}
               </button>
            </div>
         ) : (
            <>
               {/* Summary Cards */}
               <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <SummaryCard 
               title="Hadir Hari Ini" 
               value={todayStats.hadir} 
               subtitle={`Dari ${filteredEmployees.length} karyawan`} 
               icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />} 
               tone="green" 
               onClick={() => goToAttendance({
                 date: selectedDate,
                 startDate: selectedDate,
                 endDate: selectedDate,
                 status: "hadir",
                 action: "masuk",
               })}
            />
            <SummaryCard 
               title="Terlambat" 
               value={todayStats.telat} 
               subtitle="Absen lewat jam kerja" 
               icon={<Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />} 
               tone="yellow" 
               onClick={() => goToAttendance({
                 date: selectedDate,
                 startDate: selectedDate,
                 endDate: selectedDate,
                 status: "terlambat",
                 action: "masuk",
               })}
            />
            <SummaryCard 
               title="Belum Absen" 
               value={todayStats.absen} 
               subtitle="Belum ada data check-in" 
               icon={<AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />} 
               tone="red" 
               onClick={() => goToReports({
                 date: selectedDate,
                 startDate: selectedDate,
                 endDate: selectedDate,
                 view: "belum_absen",
               })}
            />
            <SummaryCard 
               title="Izin/Sakit/Cuti" 
               value={todayStats.izin + todayStats.sakit + todayStats.cuti} 
               subtitle={`Izin: ${todayStats.izin} · Sakit: ${todayStats.sakit} · Cuti: ${todayStats.cuti}`} 
               icon={<CalendarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />} 
               tone="blue" 
               onClick={() => goToApprovals({
                 tab: "leave",
                 date: selectedDate,
               })}
            />
            <SummaryCard 
               title="Approval Pending" 
               value={pendingApprovalsCount}
               subtitle="Butuh aksi Admin/HR" 
               icon={<FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />} 
               tone="purple" 
               onClick={() => goToApprovals({
                 status: "pending",
               })}
            />
         </div>

         {pendingApprovalMessage && (
            <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 p-3 rounded-lg text-amber-700 dark:text-amber-400 text-sm mb-6 mt-4">
              <span className="font-semibold">Info Approval:</span> {pendingApprovalMessage}
            </div>
         )}
         {/* Main Charts & Calendar */}
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <button 
               type="button"
               onClick={() => goToReports({ view: "trend", startDate: format(subDays(new Date(), 29), "yyyy-MM-dd"), endDate: selectedDate })}
               className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
               <div className="flex items-center gap-2 mb-6">
                  <TrendingUp className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex-1">Grafik Tren Presensi (30 Hari)</h3>
                  <ArrowRight className="w-4 h-4 text-slate-400 opacity-60 border-l border-slate-200 dark:border-slate-800 pl-2 ml-auto" />
               </div>
               <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                     <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                        <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip 
                           contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                           itemStyle={{ color: '#e2e8f0', fontSize: '13px' }}
                           labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '12px' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '13px', paddingTop: '16px' }} iconType="circle" />
                        <Line type="monotone" name="Hadir" dataKey="Hadir" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#10b981' }} />
                        <Line type="monotone" name="Terlambat" dataKey="Terlambat" stroke="#eab308" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#eab308' }} />
                        <Line type="monotone" name="Belum Absen" dataKey="Belum Absen" stroke="#ef4444" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#ef4444' }} />
                        <Line type="monotone" name="Izin/Cuti" dataKey="Izin/Sakit/Cuti" stroke="#3b82f6" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#3b82f6' }} />
                     </LineChart>
                  </ResponsiveContainer>
               </div>
            </button>

            <div 
               role="button"
               tabIndex={0}
               onClick={() => goToSchedules({ tab: "holidays" })}
               onKeyDown={(e) => {
                 if (e.key === "Enter" || e.key === " ") goToSchedules({ tab: "holidays" });
               }}
               className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm flex flex-col cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
               <div className="flex items-center gap-2 mb-6">
                  <Flag className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex-1">Hari Libur Bulan Ini</h3>
                  <ArrowRight className="w-4 h-4 text-slate-400 opacity-60 ml-auto" />
               </div>
               <div className="flex-1 overflow-y-auto pr-2">
                  {currentHolidays.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-slate-400 py-10">
                        <CalendarIcon className="w-10 h-10 mb-3 opacity-20" />
                        <p className="text-sm text-center">Tidak ada hari libur atau jadwal khusus bulan ini.</p>
                     </div>
                  ) : (
                     <div className="space-y-4">
                        {currentHolidays.map((h, i) => (
                           <div key={i} className="flex gap-4 items-start p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                              <div className="flex flex-col items-center justify-center shrink-0 w-12 h-14 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded shadow-sm text-center">
                                 <span className="text-xs font-semibold text-red-500 uppercase">{format(parseISO(h.date), 'MMM', {locale: idLocale})}</span>
                                 <span className="text-lg font-bold text-slate-800 dark:text-slate-200 leading-none mt-1">{format(parseISO(h.date), 'dd')}</span>
                              </div>
                              <div className="pt-1">
                                 <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{h.name}</div>
                                 <div className="text-xs text-slate-500 mt-1 capitalize">{h.type === 'holiday' ? 'Hari Libur Nasional' : 'Jadwal Khusus'}</div>
                              </div>
                           </div>
                        ))}
                     </div>
                  )}
               </div>
            </div>
         </div>

         {/* Recent Logs & Discipline Board */}
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm">
               <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                     <Activity className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                     <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Log Presensi Terbaru</h3>
                  </div>
                  <button onClick={() => goToAttendance({ date: selectedDate })} className="text-sm font-medium text-blue-600 hover:text-blue-500 flex items-center gap-1">
                     Lihat Lengkap <ArrowRight className="w-4 h-4" />
                  </button>
               </div>
               
               {recentLogs.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">
                      Belum ada data presensi.
                  </div>
               ) : (
                  <div className="overflow-x-auto">
                     <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 uppercase">
                           <tr>
                              <th className="px-4 py-3 font-medium rounded-l-lg">Karyawan</th>
                              <th className="px-4 py-3 font-medium">Waktu</th>
                              <th className="px-4 py-3 font-medium">Jenis</th>
                              <th className="px-4 py-3 font-medium rounded-r-lg">Status</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                           {recentLogs.map((log, i) => {
                              const emp = employees.find(e => e.uid === log.uid);
                              const type = getActionTypeLabel(log);
                              const status = getAttendanceStatus(log); // Keep for coloring class
                              const statusLabel = getAttendanceStatusLabel(status);
                              const ds = status.includes('late') || status.includes('terlambat') ? 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20' : 
                                         status.includes('early') || status.includes('pulang cepat') ? 'text-orange-600 bg-orange-50 dark:bg-orange-900/20' :
                                         'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20';

                              return (
                                 <tr 
                                    key={i} 
                                    onClick={() => goToAttendance({
                                      date: log.dateKey || log.parsedDate || selectedDate,
                                      startDate: log.dateKey || log.parsedDate || selectedDate,
                                      endDate: log.dateKey || log.parsedDate || selectedDate,
                                      search: emp?.nama_lengkap || log.uid || "",
                                    })}
                                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                                    title="Buka detail absensi"
                                 >
                                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                                       {emp?.nama_lengkap || 'Karyawan Tanpa Nama'}
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                       {(() => {
                                          const ts = getRecordTimestamp(log);
                                          if (!ts) return "-";
                                          return format(new Date(ts), "dd MMM yyyy, HH:mm", { locale: idLocale });
                                       })()}
                                    </td>
                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 capitalize">
                                       {type}
                                    </td>
                                    <td className="px-4 py-3">
                                       <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${ds}`}>
                                          {statusLabel}
                                       </span>
                                    </td>
                                 </tr>
                              );
                           })}
                        </tbody>
                     </table>
                  </div>
               )}
            </div>

            <div 
               role="button"
               tabIndex={0}
               onClick={() => goToReports({ view: "discipline" })}
               onKeyDown={(e) => {
                 if (e.key === "Enter" || e.key === " ") goToReports({ view: "discipline" });
               }}
               className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
               <div className="flex items-center gap-2 mb-6">
                  <ShieldAlert className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex-1">Papan Kedisiplinan</h3>
                  <ArrowRight className="w-4 h-4 text-slate-400 opacity-60 ml-auto" />
               </div>
               
               <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-lg border border-slate-200 dark:border-slate-700/50 text-center">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                     Papan disiplin akan aktif setelah summary/index harian tersedia secara penuh.
                  </p>
               </div>
            </div>
         </div>
            </>
         )}
      </>
      )}
    </div>
  );
};

// UI Components

function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  tone,
  onClick,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ReactNode;
  tone: "green" | "yellow" | "red" | "blue" | "purple";
  onClick?: () => void;
}) {
   const tones = {
      green: "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800/30",
      yellow: "bg-yellow-50 dark:bg-yellow-900/10 border-yellow-100 dark:border-yellow-800/30",
      red: "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-800/30",
      blue: "bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/30",
      purple: "bg-purple-50 dark:bg-purple-900/10 border-purple-100 dark:border-purple-800/30",
   };

   const clickable = typeof onClick === "function";

   return (
      <button
         type="button"
         onClick={onClick}
         disabled={!clickable}
         className={`p-4 rounded-xl border ${tones[tone]} flex flex-col shadow-sm text-left transition-all ${
            clickable
               ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
               : "cursor-default"
         }`}
         title={clickable ? `Buka detail ${title}` : undefined}
      >
         <div className="flex justify-between items-start mb-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</span>
            <div className="p-1.5 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700">
               {icon}
            </div>
         </div>
         <div className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight mt-1 mb-1">{value}</div>
         <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1 w-full flex-wrap">
            <span className="flex-1">{subtitle}</span>
            {clickable && <ArrowRight className="w-3 h-3 opacity-60" />}
         </div>
      </button>
   );
}


function DisciplineRank({ title, data, employees, unit, iconColor, isEstimate=false }: { title: string, data: any[], employees: any[], unit: string, iconColor: string, isEstimate?: boolean }) {
   return (
      <div>
         <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{title}</h4>
         {data.length === 0 || (data.length > 0 && (data[0].count === 0 || data[0].absenceEstimate === 0)) ? (
            <div className="text-sm text-slate-400 italic py-1">Belum ada data</div>
         ) : (
            <div className="space-y-2">
               {data.map((item, i) => {
                  const val = isEstimate ? item.absenceEstimate : item.count;
                  if (val === 0) return null;
                  const emp = employees.find(e => e.uid === item.uid);
                  return (
                     <div key={i} className="flex items-center justify-between group">
                        <div className="flex items-center gap-2 overflow-hidden">
                           <div className="w-5 text-center text-xs font-bold text-slate-400">{i+1}.</div>
                           <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                              <User className={`w-3 h-3 ${iconColor}`} />
                           </div>
                           <div className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                              {emp?.nama_lengkap || 'Karyawan'}
                           </div>
                        </div>
                        <div className="text-xs font-bold text-slate-500 whitespace-nowrap ml-2">
                           {val} <span className="opacity-70 font-medium">{unit}</span>
                        </div>
                     </div>
                  );
               })}
            </div>
         )}
      </div>
   );
}
