import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ref, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { loadAttendanceByDateRange } from "../services/rtdbLeanService";
import toast from "react-hot-toast";
import { Company } from "../types";
import { Search } from "lucide-react";

import { getFileUrl } from "../services/storageService";

export const Attendance: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [hasFetched, setHasFetched] = useState(false);
  const [filterMethod, setFilterMethod] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterSubDepartment, setFilterSubDepartment] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGeofence, setFilterGeofence] = useState("");
  
  const [searchParams] = useSearchParams();

  const [offices, setOffices] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [subDepartments, setSubDepartments] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [previewLocation, setPreviewLocation] = useState<any | null>(null);

  const isOwner = userData?.role === "owner";

  useEffect(() => {
    const date = searchParams.get("date") || "";
    const start = searchParams.get("startDate") || date;
    const end = searchParams.get("endDate") || date;
    const status = searchParams.get("status") || "";
    const action = searchParams.get("action") || "";
    const method = searchParams.get("method") || "";
    const office = searchParams.get("office") || "";
    const department = searchParams.get("department") || "";
    const group = searchParams.get("group") || "";
    const search = searchParams.get("search") || "";

    if (start) setStartDate(start);
    if (end) setEndDate(end);
    if (status) setFilterStatus(status);
    if (action) setFilterAction(action);
    if (method) setFilterMethod(method);
    if (office) setFilterOffice(office);
    if (department) setFilterDepartment(department);
    if (group) setFilterGroup(group);
    if (search) setSearchTerm(search);
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

  useEffect(() => {
    if (!targetCompanyId) {
      setLoading(false);
      return;
    }

    let mounted = true;

    async function loadMetadata() {
      setLoading(true);
      setError("");

      try {
        const [
          officesSnap,
          departmentsSnap,
          subDepartmentsSnap,
          groupsSnap
        ] = await Promise.all([
          get(ref(db, paths.offices(targetCompanyId))),
          get(ref(db, paths.departments(targetCompanyId))),
          get(ref(db, paths.subDepartments(targetCompanyId))),
          get(ref(db, paths.employeeGroups(targetCompanyId)))
        ]);

        const officesObj = officesSnap.exists() ? officesSnap.val() : {};
        const departmentsObj = departmentsSnap.exists() ? departmentsSnap.val() : {};
        const subDepartmentsObj = subDepartmentsSnap.exists() ? subDepartmentsSnap.val() : {};
        const groupsObj = groupsSnap.exists() ? groupsSnap.val() : {};

        const officeList = Object.keys(officesObj).map((id) => ({ id, ...officesObj[id] }));
        const departmentList = Object.keys(departmentsObj).map((id) => ({ id, ...departmentsObj[id] }));
        const subDepartmentList = Object.keys(subDepartmentsObj).map((id) => ({ id, ...subDepartmentsObj[id] }));
        const groupList = Object.keys(groupsObj).map((id) => ({ id, ...groupsObj[id] }));

        if (!mounted) return;

        setOffices(officeList);
        setDepartments(departmentList);
        setSubDepartments(subDepartmentList);
        setGroups(groupList);
      } catch (e: any) {
        if (mounted) {
          setError(e.message || "Gagal memuat metadata.");
        }
      }

      if (mounted) {
        setLoading(false);
      }
    }

    loadMetadata();

    return () => {
      mounted = false;
    };
  }, [targetCompanyId]);

  const handleAmbilData = async () => {
    if (!targetCompanyId || !startDate || !endDate) return;
    setLoading(true);
    setHasFetched(true);
    setError("");

    try {
      const [usersSnap, officesSnap, departmentsSnap, subDepartmentsSnap, groupsSnap] = await Promise.all([
        get(ref(db, paths.companyUsers(targetCompanyId))),
        get(ref(db, paths.offices(targetCompanyId))),
        get(ref(db, paths.departments(targetCompanyId))),
        get(ref(db, paths.subDepartments(targetCompanyId))),
        get(ref(db, paths.employeeGroups(targetCompanyId)))
      ]);

      const users = usersSnap.exists() ? usersSnap.val() : {};
      const officesObj = officesSnap.exists() ? officesSnap.val() : {};
      const departmentsObj = departmentsSnap.exists() ? departmentsSnap.val() : {};
      const subDepartmentsObj = subDepartmentsSnap.exists() ? subDepartmentsSnap.val() : {};
      const groupsObj = groupsSnap.exists() ? groupsSnap.val() : {};

      const rawRows = await loadAttendanceByDateRange({
        companyId: targetCompanyId,
        startDate,
        endDate
      });

      const allRecords = rawRows.map(rec => {
        const uid = rec.uid || rec.record_uid;
        const user = users[uid] || {};
        const distance = Number(rec.distance_meter || 0);
        const radius = Number(rec.radius_meter || 0);
        const geofence_status = radius > 0 ? (distance <= radius ? "inside" : "outside") : "unknown";
        
        const isApproved = rec.status === "approved" || rec.status === "success";

        return {
          ...rec,
          record_uid: uid,
          record_action: rec.action_type || rec.record_action,
          is_approved: isApproved,
          user_name: user.nama_lengkap || uid,
          nip: user.nip || "-",
          position: user.position || "",
          office_name: officesObj[rec.office_id]?.name || rec.office_id || "",
          department_name: departmentsObj[rec.department_id]?.name || rec.department_id || "",
          sub_department_name: subDepartmentsObj[rec.sub_department_id]?.name || rec.sub_department_id || "",
          group_name: groupsObj[rec.group_id]?.name || rec.group_id || "",
          geofence_status
        };
      });

      setAttendances(allRecords);
    } catch (err: any) {
      toast.error(err.message || "Gagal mengambil data harian.");
      setError(err.message);
      setAttendances([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResetFilter = () => {
     setSearchTerm("");
     setStartDate(new Date().toISOString().slice(0, 10));
     setEndDate(new Date().toISOString().slice(0, 10));
     setFilterMethod("");
     setFilterAction("");
     setFilterOffice("");
     setFilterDepartment("");
     setFilterSubDepartment("");
     setFilterGroup("");
     setFilterStatus("");
     setFilterGeofence("");
     setAttendances([]);
     setHasFetched(false);
  };

  const filteredData = attendances.filter(a => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const haystack = [
          a.user_name,
          a.nip,
          a.record_date,
          a.office_name,
          a.department_name,
          a.sub_department_name,
          a.group_name
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(term)) return false;
      }
      if (startDate && a.record_date < startDate) return false;
      if (endDate && a.record_date > endDate) return false;
      if (filterMethod && a.method !== filterMethod) return false;
      
      if (filterAction) {
        const actionText = String(a.action_type || a.record_action || "").toLowerCase();
        const expected = String(filterAction).toLowerCase();

        const actionMatch =
          actionText === expected ||
          actionText.includes(expected) ||
          (expected === "masuk" && (actionText.includes("check_in") || actionText.includes("in"))) ||
          (expected === "pulang" && (actionText.includes("check_out") || actionText.includes("out")));

        if (!actionMatch) return false;
      }
      
      if (filterOffice && a.office_id !== filterOffice) return false;
      if (filterDepartment && a.department_id !== filterDepartment) return false;
      if (filterSubDepartment && a.sub_department_id !== filterSubDepartment) return false;
      if (filterGroup && a.group_id !== filterGroup) return false;
      
      if (filterStatus) {
        const statusText = String(a.attendance_status || a.status_absen || a.status || "").toLowerCase();
        const expected = String(filterStatus).toLowerCase();

        const statusMatch =
          statusText === expected ||
          statusText.includes(expected) ||
          (expected === "hadir" && ["success", "approved", "valid", "on_time", "tepat_waktu"].some(x => statusText.includes(x))) ||
          (expected === "terlambat" && ["late", "telat"].some(x => statusText.includes(x)));

        if (!statusMatch) return false;
      }

      if (filterGeofence && a.geofence_status !== filterGeofence) return false;
      
      return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Absensi Karyawan</h1>
          <p className="text-sm text-slate-500">Daftar rekaman absensi masuk dan pulang</p>
        </div>
      </div>

      <div className="p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-xl shadow-sm text-sm text-teal-800 dark:text-teal-200">
         <span className="font-semibold">Mode hemat bandwidth aktif.</span> Data besar tidak disinkron otomatis. Pilih filter tanggal lalu klik <b>Ambil Data</b>.
      </div>

      {isOwner && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg flex items-center gap-4">
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

      {loading ? (
        <div className="p-8 text-center text-blue-500">Memuat data absensi...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col xl:flex-row gap-4 items-center mb-2">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-400 h-4 w-4" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari nama karyawan atau tanggal..."
                className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            
            <div className="flex flex-wrap gap-2 w-full xl:w-auto">
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                title="Start Date"
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500 max-w-[140px]"
              />
              <span className="text-slate-500 self-center">-</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                title="End Date"
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500 max-w-[140px]"
              />
              <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                <option value="">Semua Metode</option>
                <option value="qr">QR</option>
                <option value="selfie">Selfie</option>
                <option value="correction">Koreksi Manual</option>
              </select>
              <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                <option value="">Semua Action</option>
                <option value="masuk">Masuk</option>
                <option value="pulang">Pulang</option>
                <option value="lembur_masuk">Lembur Masuk</option>
                <option value="lembur_pulang">Lembur Pulang</option>
              </select>
              <select value={filterOffice} onChange={e => setFilterOffice(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                  <option value="">Semua Office</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <select value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                  <option value="">Semua Department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={filterSubDepartment} onChange={e => setFilterSubDepartment(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                  <option value="">Semua Sub Dept</option>
                  {subDepartments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                  <option value="">Semua Group</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                  <option value="">Semua Status</option>
                  <option value="hadir">Hadir</option>
                  <option value="terlambat">Terlambat</option>
                  <option value="izin">Izin</option>
                  <option value="sakit">Sakit</option>
                  <option value="cuti">Cuti</option>
                  <option value="alpha">Alpha</option>
                  <option value="libur">Libur</option>
              </select>
              <select value={filterGeofence} onChange={e => setFilterGeofence(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-800 dark:text-slate-200 text-sm focus:border-blue-500">
                  <option value="">Semua Radius</option>
                  <option value="inside">Dalam Radius</option>
                  <option value="outside">Di Luar Radius</option>
              </select>
            </div>
            <div className="flex gap-2 w-full mt-2">
              <button
                onClick={handleAmbilData}
                disabled={loading}
                className="px-4 py-2 flex-1 bg-teal-600 hover:bg-teal-700 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                Ambil Data
              </button>
              <button
                onClick={handleResetFilter}
                className="px-4 py-2 flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm rounded-lg transition-colors"
              >
                Reset Filters
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 p-4 rounded-lg text-sm italic">
              Diagnosis: {error}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            {!hasFetched ? (
                <div className="p-8 text-center text-slate-500">
                  <p>Pilih tanggal lalu klik <span className="font-semibold text-teal-600">Ambil Data</span>. Data tidak disinkron otomatis untuk menghemat bandwidth RTDB.</p>
                </div>
            ) : filteredData.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <p>Tidak ada data presensi pada range tanggal ini, atau index attendance_by_date belum tersedia.</p>
                </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-6 py-3 font-medium">Karyawan</th>
                    <th className="px-6 py-3 font-medium">Tanggal/Waktu</th>
                    <th className="px-6 py-3 font-medium">Jadwal & Office</th>
                    <th className="px-6 py-3 font-medium">Tipe / Metode</th>
                    <th className="px-6 py-3 font-medium">Radius & Jarak</th>
                    <th className="px-6 py-3 font-medium">Status / Telat</th>
                    <th className="px-6 py-3 font-medium text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredData.map((req, idx) => (
                    <tr key={`${req.record_uid}_${req.record_date}_${req.record_action}_${idx}`} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{req.user_name || req.record_uid}</div>
                      </td>
                      <td className="px-6 py-4">
                        {req.record_date} <br/>
                        <span className="font-mono text-slate-600 dark:text-slate-400 text-xs">{req.record_time}</span>
                      </td>
                      <td className="px-6 py-4 text-xs space-y-1">
                        {req.shift_name && <div className="text-blue-600 dark:text-blue-400">Shift: {req.shift_name}</div>}
                        {req.timetable_name && <div className="text-slate-600 dark:text-slate-400">Jam: {req.timetable_name} ({req.work_start}-{req.work_end})</div>}
                        <div className="text-slate-500 max-w-[150px] truncate" title={req.office_name || req.office_id}>Office: {req.office_name || req.office_id || "-"}</div>
                        <div className="text-slate-500 max-w-[150px] truncate" title={req.department_name}>Dept: {req.department_name || "-"}</div>
                        <div className="text-slate-500 max-w-[150px] truncate" title={req.sub_department_name}>Sub: {req.sub_department_name || "-"}</div>
                        <div className="text-slate-500 max-w-[150px] truncate" title={req.group_name}>Group: {req.group_name || "-"}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2 items-center flex-wrap">
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                {req.action_type || req.record_action}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                {req.method || "-"}
                            </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs">
                        {req.geofence_status === "inside" ? (
                          <span className="text-teal-600 dark:text-teal-400">Dalam Radius</span>
                        ) : req.geofence_status === "outside" ? (
                          <span className="text-red-600 dark:text-red-400">Luar Radius</span>
                        ) : (
                          <span className="text-slate-500">Radius Tidak Diketahui</span>
                        )}
                        <br />
                        <span className="text-slate-500">
                          {req.distance_meter ?? "-"}m / {req.radius_meter ?? "-"}m
                        </span>
                      </td>
                      <td className="px-6 py-4">
                         <div className="flex flex-col gap-1">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold self-start ${
                                req.attendance_status === "hadir" ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" :
                                req.attendance_status === "terlambat" ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" :
                                "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                            }`}>
                                {req.attendance_status || "-"}
                            </span>
                            {req.is_approved && (
                                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold self-start bg-blue-500/20 text-blue-600 dark:text-blue-400">
                                    Approved
                                </span>
                            )}
                            {(req.late_minute > 0) && (
                                <span className="text-xs text-red-600 dark:text-red-400">Telat: {req.late_minute}m</span>
                            )}
                         </div>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                          {(req.foto_url || req.foto_path) && (
                              <button 
                                  onClick={async () => setPreviewPhoto(await getFileUrl(req.foto_url || req.foto_path))}
                                  className="text-blue-600 dark:text-blue-400 hover:underline text-xs bg-blue-500/10 px-2 py-1 rounded"
                              >
                                  Foto
                              </button>
                          )}
                          {(req.latitude && req.longitude) && (
                              <button 
                                  onClick={() => setPreviewLocation({lat: req.latitude, lng: req.longitude, radius: req.radius_meter, distance: req.distance_meter})}
                                  className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs bg-emerald-500/10 px-2 py-1 rounded"
                              >
                                  Lokasi
                              </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Photo Preview Modal */}
      {previewPhoto && (
          <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/90 flex flex-col items-center justify-center z-[60] p-4">
              <div className="w-full max-w-lg flex justify-end mb-2">
                  <button onClick={() => setPreviewPhoto(null)} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded">
                      ✕ Tutup
                  </button>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 max-w-lg max-h-[80vh] flex justify-center items-center">
                  <img src={previewPhoto} alt="Attendance" className="max-w-full max-h-[70vh] object-contain rounded" />
              </div>
          </div>
      )}

      {/* Location Modal */}
      {previewLocation && (
          <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/90 flex flex-col items-center justify-center z-[60] p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 dark:text-slate-200">Detail Lokasi</h3>
                      <button onClick={() => setPreviewLocation(null)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
                  </div>
                  <div className="p-6 text-sm text-slate-700 dark:text-slate-300">
                      <p><span className="text-slate-500 inline-block w-24">Latitude:</span> {previewLocation.lat}</p>
                      <p><span className="text-slate-500 inline-block w-24">Longitude:</span> {previewLocation.lng}</p>
                      <p><span className="text-slate-500 inline-block w-24">Jarak:</span> {previewLocation.distance} meter</p>
                      <p><span className="text-slate-500 inline-block w-24">Radius Office:</span> {previewLocation.radius} meter</p>
                      <a 
                          href={`https://www.openstreetmap.org/?mlat=${previewLocation.lat}&mlon=${previewLocation.lng}#map=18/${previewLocation.lat}/${previewLocation.lng}`}
                          target="_blank" rel="noreferrer"
                          className="mt-4 block text-center bg-blue-600 hover:bg-blue-500 text-white rounded py-2"
                      >
                          Buka di OpenStreetMap
                      </a>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
