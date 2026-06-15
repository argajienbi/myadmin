import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, push, update, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Company } from "../types";
import toast from "react-hot-toast";

export const AttendanceCorrections: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [problems, setProblems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"problems" | "history">("problems");
  
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const isOwner = userData?.role === "owner";

  useEffect(() => {
    if (isOwner) {
      get(ref(db, paths.companies())).then((snapshot) => {
        if (snapshot.exists()) {
           const data = snapshot.val();
           const compList = Object.keys(data).map(k => ({...data[k], id: k}));
           setCompanies(compList);
           if (compList.length > 0 && !targetCompanyId) {
             setTargetCompanyId(compList[0].id);
           }
        }
      });
    } else if (userData?.company_id) {
      setTargetCompanyId(userData.company_id);
    }
  }, [isOwner, userData]);

  useEffect(() => {
    if (!targetCompanyId) {
        setLoading(false);
        setCorrections([]);
        setUsers([]);
        setProblems([]);
        return;
    }

    setLoading(true);

    const corrRef = ref(db, paths.attendanceCorrections(targetCompanyId));
    const unsubCorr = onValue(corrRef, (snap) => {
        if(snap.exists()) {
            const data = snap.val();
            setCorrections(Object.keys(data).map(k => ({...data[k], id: k})).sort((a,b) => b.created_at - a.created_at));
        } else {
            setCorrections([]);
        }
    });

    const loadData = async () => {
        const userSnap = await get(ref(db, paths.companyUsers(targetCompanyId)));
        const usersObj = userSnap.exists() ? userSnap.val() : {};
        const usersList = Object.keys(usersObj).map(k => ({...usersObj[k], uid: k}));
        setUsers(usersList);

        const activeUsers = usersList.filter(u => u.status_akun === 'active' || u.status_akun === 'verified');

        const attSnap = await get(ref(db, paths.attendanceRoot(targetCompanyId)));
        const attObj = attSnap.exists() ? attSnap.val() : {};

        const foundProblems: any[] = [];
        const todayStr = new Date().toISOString().slice(0, 10);

        activeUsers.forEach(u => {
            const userAtt = attObj[u.uid] || {};
            const dates = Object.keys(userAtt).filter(d => d === todayStr); // Look at today
            
            dates.forEach(d => {
                const actions = userAtt[d];
                const checkIn = actions["check_in"] || actions["check-in"] || actions["in"];
                const checkOut = actions["check_out"] || actions["check-out"] || actions["out"];
                
                if (checkIn) {
                    const status = String(checkIn.attendance_status || "").toLowerCase();
                    if (status.includes("terlambat") || status.includes("late")) {
                        foundProblems.push({ uid: u.uid, name: u.nama_lengkap, date: d, issue: "Terlambat", record: checkIn, action: "check_in" });
                    }
                    if (status.includes("luar_radius") || status.includes("outside")) {
                        foundProblems.push({ uid: u.uid, name: u.nama_lengkap, date: d, issue: "Absen Luar Radius", record: checkIn, action: "check_in" });
                    }
                    if (!checkOut) {
                        foundProblems.push({ uid: u.uid, name: u.nama_lengkap, date: d, issue: "Tidak Absen Pulang", record: null, action: "check_out" });
                    }
                }
                
                if (checkOut) {
                    const status = String(checkOut.attendance_status || "").toLowerCase();
                    if (status.includes("pulang_cepat") || status.includes("early")) {
                        foundProblems.push({ uid: u.uid, name: u.nama_lengkap, date: d, issue: "Pulang Lebih Awal", record: checkOut, action: "check_out" });
                    }
                    if (status.includes("luar_radius") || status.includes("outside")) {
                        foundProblems.push({ uid: u.uid, name: u.nama_lengkap, date: d, issue: "Absen Luar Radius (Pulang)", record: checkOut, action: "check_out" });
                    }
                }
            });
            
            // Note: Does not currently check "Tidak ada absen masuk padahal ada jadwal" without backend due to full DB queries. We check only when resolving.
        });

        // Let's run a bulk resolve for today just for active users
        const getResolvePromises = activeUsers.map(async u => {
             try {
                const { resolveScheduleForUser } = await import('../services/scheduleResolver');
                const out = await resolveScheduleForUser({ companyId: targetCompanyId, uid: u.uid, date: todayStr });
                return { uid: u.uid, out };
             } catch(e) { return null; }
        });

        const resolved = await Promise.all(getResolvePromises);
        resolved.forEach(res => {
            if (!res || !res.out.scheduleReady) return;
            if (res.out.todayActive) {
                const u = activeUsers.find(x => x.uid === res.uid);
                const isHoliday = res.out.schedule_source === 'holiday';
                if (!isHoliday) {
                    const userAtt = attObj[res.uid] || {};
                    const actions = userAtt[todayStr] || {};
                    const checkIn = actions["check_in"] || actions["check-in"] || actions["in"];
                    
                    if (!checkIn) {
                        foundProblems.push({ uid: res.uid, name: u?.nama_lengkap, date: todayStr, issue: "Tidak Absen Masuk", record: null, action: "check_in" });
                    }
                }
            }
        });

        const uniqueProblems = Array.from(new Set(foundProblems.map(p => p.uid + p.date + p.issue)))
          .map(id => {
            return foundProblems.find(p => p.uid + p.date + p.issue === id);
          }).sort((a: any, b: any) => a.uid.localeCompare(b.uid));

        setProblems(uniqueProblems);
        setLoading(false);
    };

    loadData();

    return () => unsubCorr();
  }, [targetCompanyId]);

  const handleFixIssue = (prob: any) => {
      setFormData({
          uid: prob.uid,
          tanggal: prob.date,
          action_type: prob.action || "check_in",
          new_value: "",
          reason: `Koreksi Admin (${prob.issue})`
      });
      setShowModal(true);
  };

  const handleCorrect = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!targetCompanyId || !formData.uid || !formData.tanggal || !formData.action_type || !formData.new_value) {
          toast.error("Data tidak lengkap.");
          return;
      }
      setSaving(true);
      
      const saveCorrection = async () => {
          const attendanceRef = ref(db, paths.attendanceRecord(targetCompanyId, formData.uid, formData.tanggal, formData.action_type));
          let oldVal = "";
          const snap = await get(attendanceRef);
          if (snap.exists()) {
              oldVal = snap.val().waktu || "";
          }

          const corrListRef = ref(db, paths.attendanceCorrections(targetCompanyId));
          const newCorrRef = push(corrListRef);
          const correctionId = newCorrRef.key!;
          
          const correctionData = {
              correction_id: correctionId,
              uid: formData.uid,
              tanggal: formData.tanggal,
              action_type: formData.action_type,
              old_value: oldVal,
              new_value: formData.new_value,
              reason: formData.reason || "Koreksi Admin",
              status: "approved",
              corrected_by: userData?.uid,
              corrected_by_name: userData?.nama_lengkap,
              created_at: Date.now()
          };

          const attUpdates: any = {
              waktu: formData.new_value,
              method: "correction",
              status: "success",
              attendance_status: formData.attendance_status || "hadir", 
              updated_at: Date.now(),
              correction_id: correctionId
          };
          
          if (!snap.exists()) {
             attUpdates.company_id = targetCompanyId;
             attUpdates.uid = formData.uid;
             attUpdates.tanggal = formData.tanggal;
             attUpdates.action_type = formData.action_type;
             attUpdates.created_at = Date.now();
          }

          const auditRef = push(ref(db, paths.auditLogs(targetCompanyId)));
          const auditData = {
              action: "MANUAL_CORRECTION",
              details: `Koreksi ${formData.action_type} user ${formData.uid} tgl ${formData.tanggal} jd ${formData.new_value}`,
              user_uid: userData?.uid,
              user_name: userData?.nama_lengkap,
              created_at: Date.now()
          };

          const updates: any = {};
          updates[paths.attendanceCorrections(targetCompanyId) + "/" + correctionId] = correctionData;
          updates[paths.attendanceRecord(targetCompanyId, formData.uid, formData.tanggal, formData.action_type)] = !snap.exists() ? attUpdates : {...snap.val(), ...attUpdates};
          updates[paths.auditLogs(targetCompanyId) + "/" + auditRef.key] = auditData;

          await update(ref(db), updates);

          import("../services/notificationService").then(({ createNotification }) => {
              createNotification(formData.uid, {
                  company_id: targetCompanyId,
                  title: "Koreksi Presensi Disetujui",
                  message: `Koreksi admin (${formData.action_type} ${formData.tanggal}) -> ${formData.new_value}`,
                  type: "success",
                  ref_type: "attendance_correction",
                  ref_id: correctionId
              });
          });

          // remove from problems list locally
          setProblems(prev => prev.filter(p => !(p.uid === formData.uid && p.date === formData.tanggal && p.action === formData.action_type)));

          return "Koreksi absensi berhasil disimpan";
      };

      toast.promise(saveCorrection(), {
          loading: 'Memproses koreksi...',
          success: (msg) => {
              setShowModal(false);
              setFormData({});
              return msg;
          },
          error: (err) => `Gagal menyimpan koreksi: ${err.message}`
      }).finally(() => {
          setSaving(false);
      });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Koreksi Absensi</h1>
          <p className="text-sm text-slate-500">Daftar otomatis masalah absensi & input manual</p>
        </div>
        {targetCompanyId && (
          <button
            onClick={() => { setFormData({}); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
          >
            + Buat Koreksi Manual
          </button>
        )}
      </div>

      <div className="flex space-x-1 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab("problems")}
          className={`py-2 px-4 border-b-2 font-medium text-sm ${
            activeTab === "problems" 
            ? "border-blue-500 text-blue-600 dark:text-blue-400" 
            : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          Daftar Masalah Hari Ini
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`py-2 px-4 border-b-2 font-medium text-sm ${
            activeTab === "history" 
            ? "border-blue-500 text-blue-600 dark:text-blue-400" 
            : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          }`}
        >
          Riwayat Koreksi
        </button>
      </div>

      {loading ? (
          <div className="p-8 text-center text-blue-500">Memuat data...</div>
      ) : !targetCompanyId ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
            Anda tidak memiliki akses perusahaan.
          </div>
      ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
             {activeTab === "history" && (
                corrections.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">
                         Belum ada riwayat koreksi.
                     </div>
                 ) : (
                     <table className="w-full text-sm text-left">
                         <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                             <tr>
                                 <th className="px-6 py-3 font-medium">User</th>
                                 <th className="px-6 py-3 font-medium">Tgl & Action</th>
                                 <th className="px-6 py-3 font-medium">Perubahan Waktu</th>
                                 <th className="px-6 py-3 font-medium">Alasan</th>
                                 <th className="px-6 py-3 font-medium">Admin</th>
                             </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-800">
                             {corrections.map((c) => (
                                 <tr key={c.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                     <td className="px-6 py-4 font-medium">
                                         {users.find(u => u.uid === c.uid)?.nama_lengkap || c.uid}
                                     </td>
                                     <td className="px-6 py-4">
                                         {c.tanggal} <span className="uppercase text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1 rounded ml-1">{c.action_type}</span>
                                     </td>
                                     <td className="px-6 py-4 font-mono text-xs">
                                         {c.old_value || "(Kosong)"} &rarr; <span className="text-emerald-600 dark:text-emerald-400">{c.new_value}</span>
                                     </td>
                                     <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">{c.reason}</td>
                                     <td className="px-6 py-4 text-xs text-slate-500">{c.corrected_by_name}</td>
                                 </tr>
                             ))}
                         </tbody>
                     </table>
                 )
             )}

             {activeTab === "problems" && (
                problems.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">
                         Tidak ada masalah absensi hari ini. Semua clear! 🎉
                     </div>
                 ) : (
                     <table className="w-full text-sm text-left">
                         <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                             <tr>
                                 <th className="px-6 py-3 font-medium">Tanggal</th>
                                 <th className="px-6 py-3 font-medium">Nama / UID</th>
                                 <th className="px-6 py-3 font-medium">Masalah</th>
                                 <th className="px-6 py-3 font-medium text-right">Aksi</th>
                             </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-800">
                             {problems.map((p, idx) => (
                                 <tr key={idx} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                     <td className="px-6 py-4">{p.date}</td>
                                     <td className="px-6 py-4 font-medium">
                                         {p.name || p.uid}
                                         <div className="text-xs text-slate-500 font-normal">{p.uid}</div>
                                     </td>
                                     <td className="px-6 py-4">
                                         <span className="inline-block px-2 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded text-xs font-medium">
                                            {p.issue}
                                         </span>
                                     </td>
                                     <td className="px-6 py-4 text-right">
                                         <button
                                             onClick={() => handleFixIssue(p)}
                                             className="text-xs px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-600 dark:hover:text-blue-400 text-slate-700 dark:text-slate-300 rounded font-medium transition-colors"
                                         >
                                            Koreksi
                                         </button>
                                     </td>
                                 </tr>
                             ))}
                         </tbody>
                     </table>
                 )
             )}
          </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl w-full max-w-md shadow-xl text-slate-800 dark:text-slate-200">
            <h2 className="text-lg font-bold mb-4">Input Koreksi</h2>
            <form onSubmit={handleCorrect} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nama Karyawan</label>
                <select
                  required
                  value={formData.uid || ""}
                  onChange={e => setFormData({...formData, uid: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="" disabled>Pilih User</option>
                  {users.map(u => (
                    <option key={u.uid} value={u.uid}>{u.nama_lengkap}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tanggal</label>
                <input
                  type="date"
                  required
                  value={formData.tanggal || ""}
                  onChange={e => setFormData({...formData, tanggal: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tipe (check_in / check_out)</label>
                <select
                  required
                  value={formData.action_type || ""}
                  onChange={e => setFormData({...formData, action_type: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="" disabled>Pilih Tipe</option>
                  <option value="check_in">Masuk</option>
                  <option value="check_out">Pulang</option>
                </select>
              </div>
               <div>
                 <label className="block text-xs font-medium text-slate-500 mb-1">Status Absensi</label>
                 <select
                   required
                   value={formData.attendance_status || "hadir"}
                   onChange={e => setFormData({...formData, attendance_status: e.target.value})}
                   className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                 >
                   <option value="hadir">Hadir Tepat Waktu</option>
                   <option value="terlambat">Hadir Terlambat</option>
                   <option value="izin">Izin</option>
                   <option value="sakit">Sakit</option>
                   <option value="cuti">Cuti</option>
                   <option value="luar_radius">Luar Radius</option>
                 </select>
               </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Set Waktu Baru</label>
                <input
                  type="time"
                  step="1"
                  required
                  value={formData.new_value || ""}
                  onChange={e => setFormData({...formData, new_value: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Alasan</label>
                <textarea
                  required
                  value={formData.reason || ""}
                  onChange={e => setFormData({...formData, reason: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm focus:outline-none focus:border-blue-500"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded"
                >
                  {saving ? "Menyimpan..." : "Simpan Koreksi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
