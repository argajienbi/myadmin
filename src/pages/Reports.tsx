import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ref, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { loadAttendanceByDateRange } from "../services/rtdbLeanService";
import { writeAuditLog } from "../services/auditService";
import { Company } from "../types";
import { Search, Download, Filter, FileText, Table } from "lucide-react";
import toast from "react-hot-toast";
import { exportToExcel, exportToPdf } from "../services/exportService";

export const Reports: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [reportView, setReportView] = useState("default");

  const [searchParams] = useSearchParams();

  const [attendances, setAttendances] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [qrRequests, setQrRequests] = useState<any[]>([]);
  const [overtimeSchedules, setOvertimeSchedules] = useState<any[]>([]);
  const [metadata, setMetadata] = useState<any>({
    offices: {}, departments: {}, subDepartments: {}, groups: {}, users: {}
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [hasFetched, setHasFetched] = useState(false);
  const [filterOffice, setFilterOffice] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterSub, setFilterSub] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterMethod, setFilterMethod] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterGeofence, setFilterGeofence] = useState("");

  const isOwner = userData?.role === "owner";

  useEffect(() => {
    const date = searchParams.get("date") || "";
    const start = searchParams.get("startDate") || date;
    const end = searchParams.get("endDate") || date;
    const status = searchParams.get("status") || "";
    const view = searchParams.get("view") || "default";

    if (start) setStartDate(start);
    if (end) setEndDate(end);
    if (status) setFilterStatus(status);
    setReportView(view);
  }, [searchParams]);

  useEffect(() => {
    if (isOwner) {
      get(ref(db, paths.companies())).then((snapshot) => {
        if (snapshot.exists()) {
           const data = snapshot.val();
           const compList = Object.keys(data).map(k => ({...data[k], id: k}));
           setCompanies(compList);
           
           const queryCompanyId = searchParams.get("companyId") || "";
           if (queryCompanyId && compList.some(c => c.id === queryCompanyId)) {
             setTargetCompanyId(queryCompanyId);
           } else if (compList.length > 0 && !targetCompanyId) {
             setTargetCompanyId(compList[0].id);
           }
        }
      });
    } else if (userData?.company_id) {
      setTargetCompanyId(userData.company_id);
    }
  }, [isOwner, userData, searchParams]);

  function snapshotToArray(snapshot: any) {
    if (!snapshot.exists()) return [];
    const data = snapshot.val();
    return Object.keys(data).map((id) => ({ id, ...data[id] }));
  }

  useEffect(() => {
     if (!targetCompanyId) return;

     const fetchMetadata = async () => {
        setLoading(true);

        try {
            const [
                usersSnap, offSnap, deptSnap, subSnap, grpSnap
            ] = await Promise.all([
                get(ref(db, paths.companyUsers(targetCompanyId))),
                get(ref(db, paths.offices(targetCompanyId))),
                get(ref(db, paths.departments(targetCompanyId))),
                get(ref(db, paths.subDepartments(targetCompanyId))),
                get(ref(db, paths.employeeGroups(targetCompanyId)))
            ]);

            const meta: any = {
                users: usersSnap.exists() ? usersSnap.val() : {},
                offices: offSnap.exists() ? offSnap.val() : {},
                departments: deptSnap.exists() ? deptSnap.val() : {},
                subDepartments: subSnap.exists() ? subSnap.val() : {},
                groups: grpSnap.exists() ? grpSnap.val() : {}
            };
            setMetadata(meta);
        } catch(e: any) {
            setMessage(e.message || "Gagal memuat metadata");
        } finally {
            setLoading(false);
        }
     };

     fetchMetadata();
  }, [targetCompanyId]);

  const handleAmbilData = async () => {
      if (!targetCompanyId || !startDate || !endDate) return;
      setLoading(true);
      setHasFetched(true);
      setMessage("");

      try {
         const rawRows = await loadAttendanceByDateRange({
             companyId: targetCompanyId,
             startDate,
             endDate
         });
         
         const meta = metadata;
         const allRecords = rawRows.map(rec => {
             const uid = rec.uid || rec.record_uid;
             const user = meta.users[uid] || {};
             
             const distance = Number(rec.distance_meter || 0);
             const radius = Number(rec.radius_meter || 0);
             const geofence_status = radius > 0 ? (distance <= radius ? "inside" : "outside") : "unknown";

             return {
                 ...rec,
                 record_uid: uid,
                 record_date: rec.record_date || rec.dateKey,
                 record_time: rec.record_time || rec.time || rec.waktu || "00:00:00",
                 record_action: rec.action_type || rec.record_action,
                 user_name: user.nama_lengkap || uid,
                 nip: user.nip || "-",
                 position: user.position || "-",
                 geofence_status
             };
         });

         allRecords.sort((a,b) => {
             const d1 = new Date(`${a.record_date}T${a.record_time}`);
             const d2 = new Date(`${b.record_date}T${b.record_time}`);
             return d2.getTime() - d1.getTime();
         });
         
         setAttendances(allRecords);

         // We skip loading leave/qr/overtime for normal mode for now to keep bandwidth down 
         setLeaveRequests([]);
         setQrRequests([]);
         setOvertimeSchedules([]);

      } catch (err: any) {
         setMessage(err.message || "Gagal mengambil data harian.");
         toast.error(err.message);
      } finally {
         setLoading(false);
      }
  };

  const handleAmbilDataLegacy = async () => {
      if (!targetCompanyId) return;
      
      const confirmLegacy = window.confirm(
          "PERINGATAN: Legacy Load membaca root besar RTDB dan bisa meningkatkan biaya bandwidth. Gunakan hanya untuk data lama yang belum dibackfill. Lanjutkan?"
      );
      if (!confirmLegacy) return;

      const typed = window.prompt(
          "Ketik LEGACY untuk melanjutkan mode berisiko:"
      );

      if (typed !== "LEGACY") {
          toast.error("Legacy Load dibatalkan.");
          return;
      }

      setLoading(true);
      setHasFetched(true);
      setMessage("");
      try {
         const [
              attSnap, leaveSnap, qrSnap, overtimeSnap
          ] = await Promise.all([
              get(ref(db, paths.attendanceRoot(targetCompanyId))),
              get(ref(db, paths.leaveRequests(targetCompanyId))),
              get(ref(db, paths.qrRequests(targetCompanyId))),
              get(ref(db, paths.overtimeSchedules(targetCompanyId)))
          ]);
         
         setLeaveRequests(snapshotToArray(leaveSnap).map(a => ({...a, request_id: a.id})));
         setQrRequests(snapshotToArray(qrSnap));
         setOvertimeSchedules(snapshotToArray(overtimeSnap));

         if (attSnap.exists()) {
             const data = attSnap.val();
             let allRecords: any[] = [];
             const meta = metadata;

             for (const uid of Object.keys(data)) {
                 const datesObj = data[uid];
                 for (const date of Object.keys(datesObj)) {
                     const actionObj = datesObj[date];
                     for (const actionType of Object.keys(actionObj)) {
                         const rec = actionObj[actionType];
                         const user = meta.users[uid] || {};
                         
                         const distance = Number(rec.distance_meter || 0);
                         const radius = Number(rec.radius_meter || 0);
                         const geofence_status = radius > 0 ? (distance <= radius ? "inside" : "outside") : "unknown";

                         allRecords.push({
                             ...rec,
                             record_uid: uid,
                             record_date: date,
                             record_time: rec.record_time || rec.time || rec.waktu || "00:00:00",
                             record_action: actionType,
                             user_name: user.nama_lengkap || uid,
                             nip: user.nip || "-",
                             position: user.position || "-",
                             geofence_status
                         });
                     }
                 }
             }

             allRecords.sort((a,b) => {
                 const d1 = new Date(`${a.record_date}T${a.record_time}`);
                 const d2 = new Date(`${b.record_date}T${b.record_time}`);
                 return d2.getTime() - d1.getTime();
             });
             
             setAttendances(allRecords);
         } else {
             setAttendances([]);
         }
      } catch (err: any) {
         setMessage(err.message || "Gagal mengambil data legacy");
         toast.error(err.message);
      } finally {
         setLoading(false);
      }
  };

  const filteredData = useMemo(() => {
      return attendances.filter(a => {
          if (searchTerm) {
              const term = searchTerm.toLowerCase();
              const haystack = [
                a.user_name,
                a.nip,
                a.position,
                a.record_date,
                metadata.offices[a.office_id]?.name,
                metadata.departments[a.department_id]?.name,
                metadata.subDepartments[a.sub_department_id]?.name,
                metadata.groups[a.group_id]?.name,
                a.shift_name,
                a.timetable_name
              ].join(" ").toLowerCase();
              if (!haystack.includes(term)) return false;
          }
          if (startDate && a.record_date < startDate) return false;
          if (endDate && a.record_date > endDate) return false;
          
          if (filterOffice && a.office_id !== filterOffice) return false;
          if (filterPosition && a.position !== filterPosition) return false;
          if (filterDept && a.department_id !== filterDept) return false;
          if (filterSub && a.sub_department_id !== filterSub) return false;
          if (filterGroup && a.group_id !== filterGroup) return false;
          
          if (filterMethod && a.method !== filterMethod) return false;
          if (filterStatus && a.attendance_status !== filterStatus) return false;
          if (filterAction && a.action_type !== filterAction) return false;
          if (filterGeofence && a.geofence_status !== filterGeofence) return false;

          return true;
      });
  }, [attendances, searchTerm, startDate, endDate, filterOffice, filterPosition, filterDept, filterSub, filterGroup, filterMethod, filterStatus, filterAction, filterGeofence]);

  const filteredLeaveRequests = useMemo(() => {
    return leaveRequests.filter((x) => {
      const date = x.tanggal_mulai || x.date || "";
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    });
  }, [leaveRequests, startDate, endDate]);

  const filteredQrRequests = useMemo(() => {
    return qrRequests.filter((x) => {
      const date = x.tanggal || x.date || "";
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    });
  }, [qrRequests, startDate, endDate]);

  const isApproved = (status: any) => {
    const value = String(status || "").toLowerCase();
    return value === "approved" || value === "validated";
  };

  const minuteOfDay = (value: string) => {
    const [h, m] = String(value || "").split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };

  const durationMinute = (start: string, end: string) => {
    const s = minuteOfDay(start);
    const e = minuteOfDay(end);
    if (s === null || e === null) return 0;
    return e >= s ? e - s : e + 1440 - s;
  };

  const formatDuration = (minutes: number) => {
    if (!minutes || minutes <= 0) return "-";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h <= 0) return `${minutes} menit`;
    if (m <= 0) return `${h} jam`;
    return `${h} jam ${m} menit`;
  };

  const allOvertimeRows = useMemo(() => {
    const approvedUserOvertime = leaveRequests.filter(req => {
      const type = String(req.type || req.leave_type || "").toLowerCase();
      return type === "lembur" && isApproved(req.status);
    }).map(req => {
      const minutes = Number(req.overtime_duration_minute || 0) ||
        durationMinute(req.overtime_start_time, req.overtime_end_time);

      return {
        id: req.request_id,
        source: "User Request",
        date: req.overtime_date || req.date_start || req.tanggal_mulai || req.date || "-",
        user_name: req.user_name || req.nama_lengkap || req.employee_name || "-",
        uid: req.uid || "",
        time: `${req.overtime_start_time || "-"} - ${req.overtime_end_time || "-"}`,
        duration_minute: minutes,
        status: req.status,
      };
    });

    const scheduledOvertimeRows = attendances
      .filter((row: any) => row.schedule_source === "overtime_schedule" || row.overtime_flag === true)
      .map((row: any) => {
        const minutes = durationMinute(row.work_start || row.check_in_start, row.work_end || row.check_out_end);
        return {
          id: row.id || `${row.record_uid}_${row.record_date}`,
          source: "Jadwal Lembur",
          date: row.record_date || row.tanggal || "-",
          user_name: row.user_name || row.nama_lengkap || row.employee_name || row.record_uid || "-",
          uid: row.record_uid || "",
          time: `${row.work_start || row.check_in_start || "-"} - ${row.work_end || row.check_out_end || "-"}`,
          duration_minute: minutes,
          status: "approved",
        };
      });

    return [...approvedUserOvertime, ...scheduledOvertimeRows].filter((x) => {
      if (startDate && x.date < startDate) return false;
      if (endDate && x.date > endDate) return false;
      return true;
    });
  }, [leaveRequests, attendances, startDate, endDate]);

  const summary = useMemo(() => {
     return {
         total: filteredData.length,
         hadir: filteredData.filter(a => a.attendance_status === "hadir").length,
         terlambat: filteredData.filter(a => a.attendance_status === "terlambat").length,
         selfie: filteredData.filter(a => a.method === "selfie").length,
         qr: filteredData.filter(a => a.method === "qr").length,
         correction: filteredData.filter(a => a.method === "correction").length,
         insideR: filteredData.filter(a => a.geofence_status === "inside").length,
         outsideR: filteredData.filter(a => a.geofence_status === "outside").length,
         totalLateMin: filteredData.reduce((acc, curr) => acc + (Number(curr.late_minute) || 0), 0),
          leavePending: filteredLeaveRequests.filter(x => x.status === "pending").length,
         leaveApproved: filteredLeaveRequests.filter(x => x.status === "approved" || x.status === "validated").length,
         leaveRejected: filteredLeaveRequests.filter(x => x.status === "rejected").length,
         qrPending: filteredQrRequests.filter(x => x.status === "pending_admin").length,
         qrApproved: filteredQrRequests.filter(x => x.status === "approved").length,
         qrRejected: filteredQrRequests.filter(x => x.status === "rejected").length,
         lemburApproved: allOvertimeRows.length,
         totalOTMin: allOvertimeRows.reduce((a, b) => a + (b.duration_minute || 0), 0)
     };
  }, [filteredData, filteredLeaveRequests, filteredQrRequests, allOvertimeRows]);

  const getAttendanceExportData = () => {
     return filteredData.map(r => ({
         "Nama": r.user_name,
         "NIP": r.nip,
         "Position": r.position,
         "Tanggal": r.record_date,
         "Action Type": r.action_type,
         "Waktu": r.waktu,
         "Method": r.method,
         "Attendance Status": r.attendance_status,
         "Late Minute": r.late_minute,
         "Early Out Minute": r.early_out_minute,
         "Overtime Minute": r.overtime_minute,
         "Total Work Minute": r.total_work_minute,
         "Office": metadata.offices[r.office_id]?.name || r.office_id || "",
         "Department": metadata.departments[r.department_id]?.name || r.department_id || "",
         "Sub Department": metadata.subDepartments[r.sub_department_id]?.name || r.sub_department_id || "",
         "Group": metadata.groups[r.group_id]?.name || r.group_id || "",
         "Shift": r.shift_name,
         "Timetable": r.timetable_name,
         "Schedule Source": r.schedule_source
     }));
  };

  const getLeaveExportData = () => {
      return filteredLeaveRequests.map(r => {
          const user = metadata.users[r.uid] || {};
          return {
              "Request ID": r.request_id || r.id, 
              "Nama": r.nama_lengkap || user.nama_lengkap || r.uid, 
              "NIP": r.nip || user.nip || "", 
              "Type": r.leave_type, 
              "Tanggal Mulai": r.tanggal_mulai, 
              "Tanggal Selesai": r.tanggal_selesai, 
              "Jumlah Hari": r.jumlah_hari, 
              "Alasan": r.alasan, 
              "Status": r.status, 
              "Admin Note": r.admin_note, 
              "Approved By": r.approved_by, 
              "Approved At": r.approved_at, 
              "Rejected By": r.rejected_by, 
              "Rejected At": r.rejected_at
          };
      });
  };

  const [exportType, setExportType] = useState<"attendance" | "leave">("attendance");

  const handleExportExcel = async () => {
      if (!targetCompanyId) return;
      const data = exportType === "attendance" ? getAttendanceExportData() : getLeaveExportData();
      if (data.length === 0) {
          toast.error("Tidak ada data untuk diexport.");
          return;
      }

      const filename = `laporan_${exportType}_${targetCompanyId}_${new Date().toISOString().slice(0, 10)}`;
      exportToExcel(data, filename);

      await writeAuditLog(targetCompanyId, {
          action: "EXPORT_REPORT_EXCEL",
          details: `Export ${exportType} report`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: paths.attendanceRoot(targetCompanyId)
      });
      toast.success("Export Excel berhasil");
  };

  const handleExportPDF = async () => {
      if (!targetCompanyId) return;
      const data = exportType === "attendance" ? getAttendanceExportData() : getLeaveExportData();
      if (data.length === 0) {
          toast.error("Tidak ada data untuk diexport.");
          return;
      }

      const headers = Object.keys(data[0]);
      const rows = data.map(obj => Object.values(obj).map(v => String(v || "")));
      const filename = `laporan_${exportType}_${targetCompanyId}_${new Date().toISOString().slice(0, 10)}`;
      
      exportToPdf(headers, rows, filename, `Laporan ${exportType.toUpperCase()}`);

      await writeAuditLog(targetCompanyId, {
          action: "EXPORT_REPORT_PDF",
          details: `Export ${exportType} report`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: paths.attendanceRoot(targetCompanyId)
      });
      toast.success("Export PDF berhasil");
  };


  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Laporan</h1>
          {reportView !== "default" && (
            <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase">
              View: {reportView.replaceAll("_", " ")}
            </span>
          )}
          <p className="text-sm text-slate-500">Export data untuk HR dan Payroll</p>
        </div>
      </div>

      {isOwner && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg flex items-center gap-4 mb-4">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Pilih Perusahaan:</label>
          <select 
            value={targetCompanyId} 
            onChange={(e) => setTargetCompanyId(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded p-2 text-sm focus:outline-none focus:border-blue-500 min-w-[200px]"
          >
            <option value="" disabled>-- Pilih Perusahaan --</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {!targetCompanyId ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
            Pilih perusahaan untuk memuat laporan.
          </div>
      ) : (
          <>
             {/* Filtering */}
             <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-400 h-4 w-4" />
                     <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Cari nama karyawan..."
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 text-sm"
                     />
                 </div>
                 
                 <div className="flex gap-2">
                     <input 
                         type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                         className="w-1/2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500"
                     />
                     <input 
                         type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                         className="w-1/2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500"
                     />
                 </div>

                 <select value={filterOffice} onChange={e => setFilterOffice(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                     <option value="">Semua Office</option>
                     {Object.keys(metadata.offices).map(k => <option key={k} value={k}>{metadata.offices[k].name}</option>)}
                 </select>

                 <select value={filterPosition} onChange={e => setFilterPosition(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                    <option value="">Semua Jabatan</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="SPV">SPV</option>
                    <option value="LEADER">LEADER</option>
                    <option value="CREW">CREW</option>
                    <option value="USER">USER</option>
                 </select>

                 <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                     <option value="">Semua Department</option>
                     {Object.keys(metadata.departments).map(k => <option key={k} value={k}>{metadata.departments[k].name}</option>)}
                 </select>

                 <select value={filterSub} onChange={e => setFilterSub(e.target.value)} className="hidden">
                     <option value="">Semua Sub Department</option>
                     {Object.keys(metadata.subDepartments).map(k => <option key={k} value={k}>{metadata.subDepartments[k].name}</option>)}
                 </select>

                 <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                     <option value="">Semua Group</option>
                     {Object.keys(metadata.groups).map(k => <option key={k} value={k}>{metadata.groups[k].name}</option>)}
                 </select>

                 <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                     <option value="">Semua Status</option>
                     <option value="hadir">Hadir</option>
                     <option value="terlambat">Terlambat</option>
                     <option value="izin">Izin</option>
                     <option value="sakit">Sakit</option>
                     <option value="cuti">Cuti</option>
                     <option value="alpha">Alpha</option>
                     <option value="libur">Libur</option>
                 </select>

                 <select value={filterGeofence} onChange={e => setFilterGeofence(e.target.value)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                     <option value="">Semua Radius</option>
                     <option value="inside">Dalam Radius</option>
                     <option value="outside">Luar Radius</option>
                 </select>
             </div>
             
             <div className="flex gap-2 w-full max-w-sm mt-4">
                 <button onClick={handleAmbilData} disabled={loading} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-medium py-2 px-4 rounded text-sm disabled:opacity-50 transition">Ambil Data</button>
             </div>
             
             {isOwner && (
                 <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded text-sm">
                     <p className="text-red-700 dark:text-red-400 mb-2">Mode Legacy membaca node besar dan bisa meningkatkan biaya. Gunakan hanya jika index attendance_by_date belum tersedia.</p>
                     <button onClick={handleAmbilDataLegacy} disabled={loading} className="bg-red-500 hover:bg-red-600 text-white font-medium py-1.5 px-3 rounded text-xs disabled:opacity-50 transition">Legacy Load (Berisiko Mahal)</button>
                 </div>
             )}

             {/* Summary */}
             <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-center">
                     <div className="text-2xl font-bold text-slate-900 dark:text-white">{summary.total}</div>
                     <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Total Absensi</div>
                 </div>
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-center">
                     <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{summary.hadir}</div>
                     <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Hadir Tepat Waktu</div>
                 </div>
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-center">
                     <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{summary.terlambat}</div>
                     <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Telat ({summary.totalLateMin}m)</div>
                 </div>
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-center">
                     <div className="text-xl font-medium text-slate-700 dark:text-slate-300">
                       <span className="text-teal-600 dark:text-teal-400">{summary.leaveApproved}</span> / <span className="text-amber-600 dark:text-amber-400">{summary.leavePending}</span>
                     </div>
                     <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Izin (Apprv / Pend)</div>
                 </div>
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-center">
                     <div className="text-xl font-medium text-slate-700 dark:text-slate-300">
                       <span className="text-purple-600 dark:text-purple-400">{summary.lemburApproved}</span> / <span className="text-indigo-600 dark:text-indigo-400">{summary.totalOTMin}</span>
                     </div>
                     <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">Lembur (Req / Menit)</div>
                 </div>
                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-center">
                     <div className="text-xl font-medium text-slate-700 dark:text-slate-300">
                       <span className="text-teal-600 dark:text-teal-400">{summary.qrApproved}</span> / <span className="text-amber-600 dark:text-amber-400">{summary.qrPending}</span>
                     </div>
                     <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">QR (Apprv / Pend)</div>
                 </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-200 dark:border-slate-800 pt-6">
                 <div className="flex items-center gap-2">
                     <span className="text-sm text-slate-600 dark:text-slate-400">Jenis Export:</span>
                     <select 
                         value={exportType}
                         onChange={(e) => setExportType(e.target.value as "attendance" | "leave")}
                         className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded py-2 px-3 text-sm"
                     >
                         <option value="attendance">Laporan Presensi (Absensi)</option>
                         <option value="leave">Laporan Perizinan / Cuti</option>
                     </select>
                 </div>
                 <button
                     onClick={handleExportExcel}
                     disabled={loading || !hasFetched}
                     className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded py-2 px-4 text-sm font-medium shadow shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                     <Table className="w-4 h-4" /> Export Excel
                 </button>
                 <button
                     onClick={handleExportPDF}
                     disabled={loading || !hasFetched}
                     className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white rounded py-2 px-4 text-sm font-medium shadow shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                     <FileText className="w-4 h-4" /> Export PDF
                 </button>
             </div>
             
             {message && (
                 <div className="text-sm text-emerald-600 dark:text-emerald-400 italic bg-emerald-500/10 p-3 rounded border border-emerald-500/20">
                     {message}
                 </div>
             )}

              {/* Preview Absensi */}
             <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                 <div className="p-4 border-b border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-800 dark:text-slate-200">
                    Laporan Presensi (Absensi)
                 </div>
                 <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 text-xs uppercase font-medium">
                        <tr>
                            <th className="px-4 py-3">Nama/NIP</th>
                            <th className="px-4 py-3">Waktu</th>
                            <th className="px-4 py-3">Metode/Tipe</th>
                            <th className="px-4 py-3">Status/Jarak</th>
                            <th className="px-4 py-3">Jadwal/Lokasi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {filteredData.slice(0, 100).map((r, idx) => (
                            <tr key={idx} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-slate-800 dark:text-slate-200">{r.user_name}</div>
                                    <div className="text-xs text-slate-500">{r.nip}</div>
                                </td>
                                <td className="px-4 py-3">
                                    <div>{r.record_date}</div>
                                    <div className="text-xs font-mono mt-0.5 text-slate-600 dark:text-slate-400">{r.waktu}</div>
                                </td>
                                <td className="px-4 py-3 text-xs">
                                    <div className="uppercase mb-0.5">{r.method}</div>
                                    <div className="text-slate-500 uppercase">{r.action_type}</div>
                                </td>
                                <td className="px-4 py-3 text-xs">
                                    <div className={`uppercase font-bold mb-0.5 ${r.attendance_status === 'hadir' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                        {r.attendance_status} {r.late_minute > 0 ? `(+${r.late_minute}m)` : ''}
                                    </div>
                                    <div className={r.geofence_status === 'inside' ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}>
                                        {r.geofence_status} ({r.distance_meter}m / {r.radius_meter}m)
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                                    <div className="truncate max-w-[150px]" title={metadata.offices[r.office_id]?.name || r.office_id}>{metadata.offices[r.office_id]?.name || r.office_id}</div>
                                    <div className="truncate max-w-[150px]">{r.shift_name}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                 </table>
                 {filteredData.length > 100 && (
                     <div className="p-4 text-center text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
                         Menampilkan 100 dari {filteredData.length} data absensi. Gunakan filter untuk mencari atau export seluruhnya ke Excel / PDF.
                     </div>
                 )}
                 {!hasFetched ? (
                     <div className="p-8 text-center text-slate-500">
                         Pilih filter tanggal lalu klik <span className="font-semibold text-teal-600">Ambil Data</span>.
                     </div>
                 ) : filteredData.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">
                         Tidak ada data laporan absensi pada range ini.
                     </div>
                 ) : null}
             </div>

             {/* Preview Lembur */}
             <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto mt-6">
                 <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">Rekap Data Lembur (Approved & Terjadwal)</span>
                    <span className="text-xs text-slate-500">Total: <b className="text-slate-800 dark:text-slate-200">{summary.lemburApproved} rekaman ({formatDuration(summary.totalOTMin)})</b></span>
                 </div>
                 <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 text-xs uppercase font-medium">
                        <tr>
                            <th className="px-4 py-3">Tanggal</th>
                            <th className="px-4 py-3">Nama Karyawan</th>
                            <th className="px-4 py-3">Sumber</th>
                            <th className="px-4 py-3">Jam (In - Out)</th>
                            <th className="px-4 py-3 text-right">Durasi</th>
                            <th className="px-4 py-3">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {allOvertimeRows.slice(0, 100).map((r, idx) => (
                            <tr key={r.id || idx} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                <td className="px-4 py-3 font-mono text-xs">{r.date}</td>
                                <td className="px-4 py-3">
                                    <div className="font-medium text-slate-800 dark:text-slate-200">{r.user_name}</div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                        {r.source}
                                    </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                                    {r.time}
                                </td>
                                <td className="px-4 py-3 text-right font-medium text-indigo-600 dark:text-indigo-400 text-xs">
                                    {formatDuration(r.duration_minute)}
                                </td>
                                <td className="px-4 py-3 text-xs uppercase font-bold text-emerald-600 dark:text-emerald-400">
                                    {r.status}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                 </table>
                 {allOvertimeRows.length > 100 && (
                     <div className="p-4 text-center text-xs text-slate-500 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
                         Menampilkan 100 dari {allOvertimeRows.length} data lembur.
                     </div>
                 )}
                 {allOvertimeRows.length === 0 && (
                     <div className="p-8 text-center text-slate-500">
                         Tidak ada data lembur pada rentang waktu ini.
                     </div>
                 )}
             </div>
          </>
      )}
    </div>
  );
};
