import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, push, set, update, get, remove } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Area, Company, Office, Department, SubDepartment, EmployeeGroup } from "../types";
import { RadiusMapPicker } from "../components/RadiusMapPicker";
import toast from "react-hot-toast";
import { writeAuditLog } from "../services/auditService";

import { ConfirmModal } from "../components/ConfirmModal";

export const Organization: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<"area" | "office" | "department" | "group">("area");

  const [areas, setAreas] = useState<Area[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isDestructive: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    isDestructive: false,
    onConfirm: () => {}
  });

  const requestConfirm = (title: string, message: string, isDestructive: boolean, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, isDestructive, onConfirm });
  };

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
       return;
    }

    setLoading(true);
    const unsubs: Function[] = [];

    unsubs.push(onValue(ref(db, paths.areas(targetCompanyId)), snap => {
        setAreas(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));
    unsubs.push(onValue(ref(db, paths.offices(targetCompanyId)), snap => {
        setOffices(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));
    unsubs.push(onValue(ref(db, paths.departments(targetCompanyId)), snap => {
        setDepartments(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));
    unsubs.push(onValue(ref(db, paths.subDepartments(targetCompanyId)), snap => {
        setSubDepartments(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));
    unsubs.push(onValue(ref(db, paths.employeeGroups(targetCompanyId)), snap => {
        setGroups(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
        setLoading(false);
    }));

    return () => unsubs.forEach(u => u());
  }, [targetCompanyId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCompanyId || !userData) return;

    const createRequest = async () => {
      let targetPath = "";
      let listPath = "";
      let newData: any = { ...formData, active: true, created_at: Date.now(), updated_at: Date.now() };
      let labelBisnis = "";

      if (activeTab === "area") {
        listPath = paths.areas(targetCompanyId);
        targetPath = paths.area(targetCompanyId, editingId || "");
        labelBisnis = "Area";
      } else if (activeTab === "office") {
        listPath = paths.offices(targetCompanyId);
        targetPath = paths.office(targetCompanyId, editingId || "");
        labelBisnis = "Kantor";
        
        if (!formData.area_id) throw new Error("Area wajib dipilih.");
        if (!Number.isFinite(Number(formData.latitude))) throw new Error("Latitude tidak valid.");
        if (!Number.isFinite(Number(formData.longitude))) throw new Error("Longitude tidak valid.");
        if (!Number.isFinite(Number(formData.radius_meter)) || Number(formData.radius_meter) <= 0) {
          throw new Error("Radius wajib lebih dari 0 meter.");
        }
        
        newData.latitude = Number(formData.latitude);
        newData.longitude = Number(formData.longitude);
        newData.radius_meter = Number(formData.radius_meter);
        newData.map_provider = "leaflet_osm";
        newData.geofence_source = "web_admin_leaflet";
      } else if (activeTab === "department") {
        listPath = paths.departments(targetCompanyId);
        targetPath = paths.department(targetCompanyId, editingId || "");
        labelBisnis = "Departemen";
      } else if (activeTab === "group") {
        listPath = paths.employeeGroups(targetCompanyId);
        targetPath = paths.employeeGroup(targetCompanyId, editingId || "");
        labelBisnis = "Grup Karyawan";
      }

      if (editingId) {
        await update(ref(db, targetPath), {
          ...newData,
          updated_at: Date.now()
        });
        await writeAuditLog(targetCompanyId, {
          action: "UPDATE_MASTER_DATA",
          details: `Mengubah data ${labelBisnis} (${newData.name || editingId})`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: targetPath,
          new_value: newData,
        });
      } else {
        const newRef = push(ref(db, listPath));
        await set(newRef, newData);
        await writeAuditLog(targetCompanyId, {
          action: "CREATE_MASTER_DATA",
          details: `Membuat data ${labelBisnis} (${newData.name || 'Baru'})`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: `${listPath}/${newRef.key}`,
          new_value: newData,
        });
      }
      return "Berhasil menyimpan data";
    };

    toast.promise(createRequest(), {
      loading: 'Menyimpan...',
      success: (msg) => {
        setFormData({});
        setEditingId(null);
        setShowModal(false);
        return msg;
      },
      error: (err) => `Gagal menyimpan data: ${err.message}`
    });
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    if (!targetCompanyId || !userData) return;
    
    let itemPath = "";
    let labelBisnis = "";
    if (activeTab === "area") { itemPath = paths.area(targetCompanyId, id); labelBisnis = "Area"; }
    else if (activeTab === "office") { itemPath = paths.office(targetCompanyId, id); labelBisnis = "Kantor"; }
    else if (activeTab === "department") { itemPath = paths.department(targetCompanyId, id); labelBisnis = "Departemen"; }
    else if (activeTab === "group") { itemPath = paths.employeeGroup(targetCompanyId, id); labelBisnis = "Grup Karyawan"; }

    if(itemPath) {
      requestConfirm(
        currentActive ? `Nonaktifkan ${labelBisnis}` : `Pulihkan ${labelBisnis}`,
        currentActive ? `Nonaktifkan ${labelBisnis}? Data tidak akan dihapus permanen.` : `Pulihkan ${labelBisnis}?`,
        currentActive,
        () => {
          const toggleRequest = async () => {
              const updates = currentActive ? {
                active: false,
                deleted_at: Date.now(),
                deleted_by: userData.uid,
                updated_at: Date.now()
              } : {
                active: true,
                deleted_at: null,
                deleted_by: null,
                updated_at: Date.now()
              };
              
              await update(ref(db, itemPath), updates);
              
              await writeAuditLog(targetCompanyId, {
                action: currentActive ? "DEACTIVATE_MASTER_DATA" : "RESTORE_MASTER_DATA",
                details: `${currentActive ? 'Menonaktifkan' : 'Memulihkan'} data ${labelBisnis}`,
                user_uid: userData?.uid || "",
                user_name: userData?.nama_lengkap || "Unknown",
                target_path: itemPath,
                new_value: updates,
              });

              return currentActive ? "Berhasil menonaktifkan" : "Berhasil memulihkan";
          };

          toast.promise(toggleRequest(), {
            loading: 'Memproses...',
            success: (msg) => msg,
            error: (err) => `Gagal update: ${err.message}`
          });
        }
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!targetCompanyId || !userData) return;
    
    let itemPath = "";
    let labelBisnis = "";
    if (activeTab === "area") { itemPath = paths.area(targetCompanyId, id); labelBisnis = "Area"; }
    else if (activeTab === "office") { itemPath = paths.office(targetCompanyId, id); labelBisnis = "Kantor"; }
    else if (activeTab === "department") { itemPath = paths.department(targetCompanyId, id); labelBisnis = "Departemen"; }
    else if (activeTab === "group") { itemPath = paths.employeeGroup(targetCompanyId, id); labelBisnis = "Grup Karyawan"; }

    if(itemPath) {
      requestConfirm(
        `Hapus ${labelBisnis}`,
        `Hapus permanen ${labelBisnis}? Tindakan ini tidak dapat dibatalkan.`,
        true,
        () => {
          const deleteRequest = async () => {
            await remove(ref(db, itemPath));
            return `Berhasil menghapus permanen ${labelBisnis}`;
          };

          toast.promise(deleteRequest(), {
            loading: 'Menghapus...',
            success: (msg) => msg,
            error: (err) => `Gagal menghapus: ${err.message}`
          });
        }
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        isDestructive={confirmModal.isDestructive}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      />
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Organisasi</h1>
          <p className="text-sm text-slate-500">Kelola Struktur Perusahaan</p>
        </div>
        {targetCompanyId && (
          <button
            onClick={() => { 
                setEditingId(null);
                if (activeTab === "office") {
                    setFormData({
                        latitude: -6.18142435142701,
                        longitude: 106.82099076217408,
                        radius_meter: 300,
                    });
                } else {
                    setFormData({}); 
                }
                setShowModal(true); 
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
          >
            + Tambah {activeTab}
          </button>
        )}
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
        <div className="p-8 text-center text-blue-500">Memuat data organisasi...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : (
        <>
          <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800 pb-2">
            {[
              { id: "area", label: "Area" },
              { id: "office", label: "Office" },
              { id: "department", label: "Department" },
              { id: "group", label: "Employee Group" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
                  activeTab === tab.id 
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500" 
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {activeTab === "area" && (
                areas.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada data...</div> : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Nama Area</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {areas.map(a => (
                      <tr key={a.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                        <td className="px-6 py-4">{a.name} {!a.active && <span className="text-red-600 dark:text-red-400 text-xs ml-2">(Nonaktif)</span>}</td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button onClick={() => { setEditingId(a.id!); setFormData(a); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                          <button onClick={() => handleToggle(a.id!, a.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{a.active ? "Nonaktifkan" : "Pulihkan"}</button>
                          <button onClick={() => handleDelete(a.id!)} className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {activeTab === "office" && (
                offices.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada data...</div> : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Nama Office & Area</th><th className="px-6 py-3 font-medium">Geofence (Lat, Lng, Rad)</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {offices.map(o => (
                      <tr key={o.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                        <td className="px-6 py-4">{o.name} <div className="text-xs text-slate-500">{areas.find(a => a.id === o.area_id)?.name}</div></td>
                        <td className="px-6 py-4 font-mono text-xs">
                          {o.latitude}, {o.longitude} <span className="text-emerald-600 dark:text-emerald-400 ml-2">{o.radius_meter}m</span>
                          <div className="mt-1">
                              <a href={`https://www.openstreetmap.org/?mlat=${o.latitude}&mlon=${o.longitude}#map=18/${o.latitude}/${o.longitude}`} target="_blank" rel="noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline">Buka Map</a>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button onClick={() => { 
                              setEditingId(o.id!); 
                              setFormData({
                                  ...o,
                                  latitude: o.latitude || -6.18142435142701,
                                  longitude: o.longitude || 106.82099076217408,
                                  radius_meter: o.radius_meter || 300,
                              }); 
                              setShowModal(true); 
                          }} className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                          <button onClick={() => handleToggle(o.id!, o.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{o.active ? "Nonaktifkan" : "Pulihkan"}</button>
                          <button onClick={() => handleDelete(o.id!)} className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {activeTab === "department" && (
                departments.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada data...</div> : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Nama Dept</th><th className="px-6 py-3 font-medium">Office</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {departments.map(d => (
                      <tr key={d.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                        <td className="px-6 py-4">{d.name}</td>
                        <td className="px-6 py-4 text-xs text-slate-500">{offices.find(o => o.id === d.office_id)?.name}</td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button onClick={() => { setEditingId(d.id!); setFormData(d); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                          <button onClick={() => handleToggle(d.id!, d.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{d.active ? "Nonaktifkan" : "Pulihkan"}</button>
                          <button onClick={() => handleDelete(d.id!)} className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {activeTab === "group" && (
                groups.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada data...</div> : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Nama Group</th><th className="px-6 py-3 font-medium">Struktur</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                  <tbody className="divide-y divide-slate-800">
                    {groups.map(g => (
                      <tr key={g.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                        <td className="px-6 py-4">{g.name}</td>
                        <td className="px-6 py-4 text-xs text-slate-500">
                          {offices.find(o => o.id === g.office_id)?.name} &gt; {departments.find(d => d.id === g.department_id)?.name}
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button onClick={() => { setEditingId(g.id!); setFormData(g); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium">Edit</button>
                          <button onClick={() => handleToggle(g.id!, g.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{g.active ? "Nonaktifkan" : "Pulihkan"}</button>
                          <button onClick={() => handleDelete(g.id!)} className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">{editingId ? "Edit" : "Tambah"} {activeTab}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Nama</label>
                <input
                  type="text"
                  required
                  value={formData.name || ""}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              {(activeTab === "office" || activeTab === "department" || activeTab === "group") && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Area Access</label>
                    <select required value={formData.area_id || ""} onChange={e => setFormData({...formData, area_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="" disabled>Pilih Area...</option>
                      {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
              )}

              {activeTab === "office" && (
                <div className="my-4">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Lokasi & Radius Geofence</label>
                  <RadiusMapPicker
                    value={{
                      latitude: Number(formData.latitude || -6.18142435142701),
                      longitude: Number(formData.longitude || 106.82099076217408),
                      radius_meter: Number(formData.radius_meter || 300),
                    }}
                    onChange={(next) =>
                      setFormData({
                        ...formData,
                        latitude: next.latitude,
                        longitude: next.longitude,
                        radius_meter: next.radius_meter,
                      })
                    }
                  />
                </div>
              )}

              {(activeTab === "department" || activeTab === "group") && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Office</label>
                    <select required value={formData.office_id || ""} onChange={e => setFormData({...formData, office_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="" disabled>Pilih Office...</option>
                      {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
              )}

              {activeTab === "group" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Department</label>
                    <select required value={formData.department_id || ""} onChange={e => setFormData({...formData, department_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="" disabled>Pilih Dept...</option>
                      {departments.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
              )}

              <div className="flex justify-end gap-3 mt-6 border-t border-slate-200 dark:border-slate-800 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700">Batal</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium">Simpan</button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
