import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Company } from "../types";
import { companyDisplayName, employeeDisplayName, maskId } from "../utils/safeDisplay";
import { useTechnicalIds } from "../hooks/useTechnicalIds";

export const Audit: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isOwner = userData?.role === "owner";
  const { showTechnicalIds, setShowTechnicalIds } = useTechnicalIds();

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
       setLogs([]);
       return;
    }

    setLoading(true);
    setError("");
    
    const logsRef = ref(db, paths.auditLogs(targetCompanyId));
    const unsub = onValue(logsRef, (snapshot) => {
       if (snapshot.exists()) {
          const data = snapshot.val();
          const items = Object.keys(data).map(key => ({
              id: key,
              ...data[key]
          })).sort((a,b) => b.created_at - a.created_at);
          setLogs(items);
       } else {
          setLogs([]);
       }
       setLoading(false);
    }, (err) => {
       setError(err.message);
       setLoading(false);
    });

    get(ref(db, paths.companyUsers(targetCompanyId))).then(s => {
        if(s.exists()) {
            setEmployees(Object.keys(s.val()).map(k => ({...s.val()[k], uid: k})));
        }
    });

    return () => unsub();
  }, [targetCompanyId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Audit Log</h1>
          <p className="text-sm text-slate-500">Riwayat aktivitas dan perubahan data</p>
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
              <option key={c.id} value={c.id}>{companyDisplayName(c)}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-blue-500">Memuat log...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
            {error && (
                <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 p-4 rounded-lg text-sm italic">
                  Diagnosis: {error}
                </div>
            )}
            {logs.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  Tidak ada audit log.
                </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-6 py-3 font-medium">Waktu</th>
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-6 py-3 font-medium">Action</th>
                    <th className="px-6 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                      <td className="px-6 py-4 text-xs font-mono text-slate-500">
                         {new Date(log.created_at).toLocaleString('id-ID')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {employeeDisplayName(employees.find(e => e.uid === log.user_uid) || {nama_lengkap: log.user_name || "Sistem"})}
                        </div>
                        {showTechnicalIds && log.user_uid && (
                            <details className="mt-1">
                                <summary className="text-[10px] text-slate-400 cursor-pointer">UID</summary>
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{maskId(log.user_uid, "UID")}</div>
                            </details>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-sm truncate text-slate-600 dark:text-slate-400" title={log.details}>
                         {log.details || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  );
};
