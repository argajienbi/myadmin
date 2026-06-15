import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { get, ref, onValue } from "firebase/database";
import { db, firestore } from "../firebase";
import { paths } from "../services/paths";
import { firestorePaths } from "../services/firestorePaths";
import {
  collection,
  query,
  orderBy
} from "firebase/firestore";
import { onSnapshot } from "firebase/firestore";
import {
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
  restoreAnnouncement,
  AnnouncementPayload,
  AnnouncementStatus,
  AnnouncementTargetType
} from "../services/announcementService";
import { resolveAnnouncementTargetUids } from "../services/announcementTargetResolver";
import { companyDisplayName, employeeDisplayName, groupDisplayName, officeDisplayName, departmentDisplayName } from "../utils/safeDisplay";
import { Plus, Edit2, Archive, Play, RefreshCw, X, Save, Bell, BellOff, MapPin, Building, Users, Clock } from "lucide-react";
import toast from "react-hot-toast";

export const Announcements: React.FC = () => {
    const { userData } = useAuth();
    const [targetCompanyId, setTargetCompanyId] = useState<string>("");

    const [companies, setCompanies] = useState<any[]>([]);
    const [loadError, setLoadError] = useState<string>("");

    const [announcements, setAnnouncements] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [offices, setOffices] = useState<any[]>([]);
    const [departments, setDepartments] = useState<any[]>([]);
    const [employeeGroups, setEmployeeGroups] = useState<any[]>([]);

    const [filterStatus, setFilterStatus] = useState<string>("all");

    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<AnnouncementPayload>>({
        title: "",
        body: "",
        type: "info",
        status: "draft",
        target_type: "all",
        target_ids: [],
        send_push: true,
        scheduled_at: null
    });

    useEffect(() => {
        if (!userData || userData.role !== "owner") return;

        get(ref(db, paths.companies())).then((snap) => {
            if (!snap.exists()) {
                setCompanies([]);
                return;
            }

            const list = Object.keys(snap.val()).map((id) => ({
                id,
                ...snap.val()[id],
            }));

            setCompanies(list);

            const savedCompanyId = localStorage.getItem("admin_selected_company");
            const validSaved = savedCompanyId && list.some((company) => company.id === savedCompanyId);

            if (validSaved) {
                setTargetCompanyId(savedCompanyId);
                return;
            }

            if (userData.company_id && list.some((company) => company.id === userData.company_id)) {
                setTargetCompanyId(userData.company_id);
                localStorage.setItem("admin_selected_company", userData.company_id);
                return;
            }

            if (list.length > 0) {
                setTargetCompanyId(list[0].id);
                localStorage.setItem("admin_selected_company", list[0].id);
            }
        }).catch((error) => {
            console.error("Failed loading companies", error);
            toast.error("Gagal memuat daftar perusahaan.");
        });
    }, [userData]);

    useEffect(() => {
        if (!userData) return;

        if (userData.role === "owner") {
            const savedCompanyId = localStorage.getItem("admin_selected_company");
            if (savedCompanyId) {
                setTargetCompanyId(savedCompanyId);
            }
            return;
        }

        setTargetCompanyId(userData.company_id || "");
    }, [userData]);

    useEffect(() => {
        if (!targetCompanyId) return;

        // Load RTDB master data for targets
        get(ref(db, paths.companyUsers(targetCompanyId))).then(snap => {
            setEmployees(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], uid: k})) : []);
        });
        get(ref(db, paths.offices(targetCompanyId))).then(snap => {
            setOffices(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
        });
        get(ref(db, paths.departments(targetCompanyId))).then(snap => {
            setDepartments(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
        });
        get(ref(db, paths.employeeGroups(targetCompanyId))).then(snap => {
            setEmployeeGroups(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
        });

        // Load RTDB announcements
        const unsubAnnouncements = onValue(
            ref(db, `companies/${targetCompanyId}/announcements`),
            (snapshot) => {
                setLoadError("");
                if (snapshot.exists()) {
                    const list = Object.entries(snapshot.val()).map(([key, value]: any) => ({
                        id: key,
                        ...value,
                    }));
                    list.sort((a, b) => b.created_at - a.created_at);
                    setAnnouncements(list);
                } else {
                    setAnnouncements([]);
                }
            },
            (error) => {
                console.error("Failed loading announcements", error);
                setLoadError(error.message || "Gagal memuat pengumuman.");
                toast.error("Gagal memuat pengumuman dari server.");
                setAnnouncements([]);
            }
        );

        return () => unsubAnnouncements();
    }, [targetCompanyId]);

    const handleCompanyChange = (companyId: string) => {
        setTargetCompanyId(companyId);
        localStorage.setItem("admin_selected_company", companyId);
    };


    const filteredAnnouncements = announcements.filter(a => {
        if (filterStatus !== "all" && a.status !== filterStatus) return false;
        return true;
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!targetCompanyId || !userData) return;

        const payload = {
            company_id: targetCompanyId,
            title: formData.title || "",
            body: formData.body || "",
            type: formData.type || "info",
            status: formData.status as AnnouncementStatus,
            target_type: formData.target_type as AnnouncementTargetType,
            target_ids: formData.target_ids || [],
            send_push: formData.send_push || false,
            scheduled_at: formData.scheduled_at || null,
            created_by: userData.uid,
            created_by_name: userData.nama_lengkap || "Admin"
        } as AnnouncementPayload;

        try {
            const targetUids = resolveAnnouncementTargetUids(
                employees,
                payload.target_type,
                payload.target_ids || []
            );

            if (payload.status === "published" && targetUids.length === 0) {
                toast.error("Tidak ada karyawan aktif yang cocok dengan target penerima.");
                return;
            }

            if (editingId) {
                await updateAnnouncement(targetCompanyId, editingId, payload);

                if (payload.status === "published") {
                    await publishAnnouncement(targetCompanyId, editingId, {
                        title: payload.title,
                        body: payload.body,
                        type: payload.type,
                        target_type: payload.target_type,
                        target_ids: payload.target_ids || [],
                        send_push: payload.send_push,
                        target_uids: targetUids,
                        admin_uid: userData.uid,
                        admin_name: userData.nama_lengkap || "Admin"
                    });

                    toast.success(`Pengumuman dipublish ke ${targetUids.length} karyawan.`);
                } else {
                    toast.success("Pengumuman diperbarui");
                }
            } else {
                const announcementId = await createAnnouncement({
                    ...payload,
                    status: payload.status === "published" ? "draft" : payload.status,
                });

                if (payload.status === "published") {
                    await publishAnnouncement(targetCompanyId, announcementId, {
                        title: payload.title,
                        body: payload.body,
                        type: payload.type,
                        target_type: payload.target_type,
                        target_ids: payload.target_ids || [],
                        send_push: payload.send_push,
                        target_uids: targetUids,
                        admin_uid: userData.uid,
                        admin_name: userData.nama_lengkap || "Admin"
                    });

                    toast.success(`Pengumuman dipublish ke ${targetUids.length} karyawan.`);
                } else {
                    toast.success("Pengumuman dibuat");
                }
            }

            setShowForm(false);
            setEditingId(null);
            setFormData({
                title: "",
                body: "",
                type: "info",
                status: "draft",
                target_type: "all",
                target_ids: [],
                send_push: true,
                scheduled_at: null,
            });
        } catch (error: any) {
            toast.error(error.message || "Gagal menyimpan pengumuman");
        }
    };

    const handlePublish = async (ann: any) => {
        if (!targetCompanyId || !userData) return;

        try {
            const targetUids = resolveAnnouncementTargetUids(
                employees,
                ann.target_type,
                ann.target_ids || []
            );

            if (targetUids.length === 0) {
                toast.error("Tidak ada karyawan aktif yang cocok dengan target penerima.");
                return;
            }

            await publishAnnouncement(targetCompanyId, ann.id, {
                title: ann.title,
                body: ann.body,
                type: ann.type,
                target_type: ann.target_type,
                target_ids: ann.target_ids || [],
                send_push: ann.send_push,
                target_uids: targetUids,
                admin_uid: userData.uid,
                admin_name: userData.nama_lengkap || "Admin"
            });

            toast.success(`Pengumuman dipublish ke ${targetUids.length} karyawan.`);
        } catch (e: any) {
            toast.error(e.message || "Gagal publish pengumuman");
        }
    };

    const handleArchiveToggle = async (ann: any) => {
        if (!targetCompanyId || !userData) return;
        const isArchived = ann.status === "archived";

        try {
            if (isArchived) {
                await restoreAnnouncement(targetCompanyId, ann.id, userData.uid, userData.nama_lengkap || "Admin");
                toast.success("Dipulihkan ke draft");
            } else {
                await archiveAnnouncement(targetCompanyId, ann.id, userData.uid, userData.nama_lengkap || "Admin");
                toast.success("Diarsipkan");
            }
        } catch(e:any) {
            toast.error(e.message);
        }
    }


    const estimatedTargets = resolveAnnouncementTargetUids(employees, formData.target_type || "all", formData.target_ids || []).length;

    const activeCompany = companies.find((company) => company.id === targetCompanyId);
    const activeCompanyName = userData?.role === "owner"
        ? companyDisplayName(activeCompany, targetCompanyId ? "Perusahaan terpilih" : "Belum memilih perusahaan")
        : companyDisplayName(userData, "Perusahaan aktif");

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div>
                   <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Pengumuman</h1>
                   <p className="text-sm text-slate-500 mt-1">Kelola dan kirim informasi ke karyawan</p>
                   <div className="mt-3 flex flex-col sm:flex-row gap-2 text-xs text-slate-500">
                       {userData?.role === "owner" && companies.length === 0 ? (
                           <span className="text-xs text-slate-400">Memuat daftar perusahaan...</span>
                       ) : (
                           <span className="inline-flex items-center gap-1">
                               <Building className="w-3.5 h-3.5 text-slate-400" />
                               <span>Perusahaan aktif:</span>
                               <b className="text-slate-800 dark:text-slate-200">
                                   {activeCompanyName}
                               </b>
                           </span>
                       )}
                       {userData?.role === "owner" && (
                           <select
                               value={targetCompanyId}
                               onChange={(e) => handleCompanyChange(e.target.value)}
                               className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200"
                           >
                               {companies.map((company, index) => (
                                   <option key={company.id} value={company.id}>
                                       {companyDisplayName(company, `Perusahaan ${index + 1}`)}
                                   </option>
                               ))}
                           </select>
                       )}
                   </div>
                </div>
                <button 
                   onClick={() => {
                       setShowForm(true); setEditingId(null); 
                       setFormData({ title: "", body: "", type: "info", status: "draft", target_type: "all", target_ids: [], send_push: true });
                   }}
                   className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus className="w-4 h-4" /> Buat Pengumuman
                </button>
            </div>

            {loadError && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300">
                    Gagal memuat pengumuman: {loadError}
                    <div className="mt-1 text-xs">
                        Periksa apakah Firestore rules sudah mengizinkan akun ini membaca data perusahaan aktif.
                    </div>
                </div>
            )}

            {showForm && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">{editingId ? "Edit Pengumuman" : "Buat Pengumuman Baru"}</h2>
                        <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
                    </div>
                    
                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Judul</label>
                                <input required type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" placeholder="Contoh: Libur Nasional Peringatan..." />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipe</label>
                                <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200">
                                    <option value="info">Informasi (Biru)</option>
                                    <option value="success">Sukses (Hijau)</option>
                                    <option value="warning">Peringatan (Kuning)</option>
                                    <option value="danger">Penting (Merah)</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Isi Pengumuman</label>
                            <textarea required rows={4} value={formData.body} onChange={e => setFormData({...formData, body: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" placeholder="Ketik pesan..." />
                        </div>

                        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 space-y-4">
                            <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Pengaturan Pengiriman</h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Target Penerima</label>
                                    <select value={formData.target_type} onChange={e => setFormData({...formData, target_type: e.target.value as AnnouncementTargetType, target_ids: []})} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200">
                                        <option value="all">Semua Karyawan ({resolveAnnouncementTargetUids(employees, "all", []).length} orang)</option>
                                        <option value="office">Kantor Tertentu</option>
                                        <option value="department">Departemen Tertentu</option>
                                        <option value="group">Grup Karyawan Tertentu</option>
                                        <option value="user">Karyawan Tertentu</option>
                                    </select>
                                </div>

                                {formData.target_type === "office" && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Pilih Kantor</label>
                                        <div className="max-h-32 overflow-y-auto space-y-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded">
                                            {offices.map(o => (
                                                <label key={o.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                                    <input type="checkbox" checked={(formData.target_ids||[]).includes(o.id)} onChange={e => {
                                                        const ids = e.target.checked ? [...(formData.target_ids||[]), o.id] : (formData.target_ids||[]).filter((id:any) => id !== o.id);
                                                        setFormData({...formData, target_ids: ids});
                                                    }} className="rounded"/> {officeDisplayName(o, "Kantor tanpa nama")}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {formData.target_type === "department" && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Pilih Departemen</label>
                                        <div className="max-h-32 overflow-y-auto space-y-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded">
                                            {departments.map(d => (
                                                <label key={d.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                                    <input type="checkbox" checked={(formData.target_ids||[]).includes(d.id)} onChange={e => {
                                                        const ids = e.target.checked ? [...(formData.target_ids||[]), d.id] : (formData.target_ids||[]).filter((id:any) => id !== d.id);
                                                        setFormData({...formData, target_ids: ids});
                                                    }} className="rounded"/> {departmentDisplayName(d, "Departemen tanpa nama")}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {formData.target_type === "group" && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Pilih Grup Karyawan</label>
                                        <div className="max-h-32 overflow-y-auto space-y-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded">
                                            {employeeGroups.map(g => (
                                                <label key={g.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                                    <input type="checkbox" checked={(formData.target_ids||[]).includes(g.id)} onChange={e => {
                                                        const ids = e.target.checked ? [...(formData.target_ids||[]), g.id] : (formData.target_ids||[]).filter((id:any) => id !== g.id);
                                                        setFormData({...formData, target_ids: ids});
                                                    }} className="rounded"/> {groupDisplayName(g, "Grup tanpa nama")}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {formData.target_type === "user" && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Pilih Karyawan</label>
                                        <div className="max-h-32 overflow-y-auto space-y-1 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded">
                                            {employees.filter(e => e.status_akun === 'active').map(e => (
                                                <label key={e.uid} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                                                    <input type="checkbox" checked={(formData.target_ids||[]).includes(e.uid)} onChange={ev => {
                                                        const ids = ev.target.checked ? [...(formData.target_ids||[]), e.uid] : (formData.target_ids||[]).filter((id:any) => id !== e.uid);
                                                        setFormData({...formData, target_ids: ids});
                                                    }} className="rounded"/> {employeeDisplayName(e, "Karyawan tanpa nama")}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Aksi Simpan</label>
                                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as AnnouncementStatus})} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm text-slate-800 dark:text-slate-200">
                                        <option value="draft">Simpan sebagai Draft</option>
                                        <option value="published">Publish Sekarang (Kirim)</option>
                                        <option value="scheduled" disabled>Jadwalkan (Coming Soon)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <div>
                                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                                        <input type="checkbox" checked={formData.send_push} onChange={e => setFormData({...formData, send_push: e.target.checked})} className="rounded text-blue-600 focus:ring-blue-500 bg-white" />
                                        Kirim notifikasi ke aplikasi dan antrean push
                                    </label>
                                    <div className="text-xs text-slate-500 mt-1 pl-6">
                                        Status bar aktif setelah Cloud Functions FCM sender terpasang.
                                    </div>
                                </div>
                                <div className="text-xs text-slate-500 shrink-0">Estimasi Penerima: <b className="text-slate-800 dark:text-slate-200">{estimatedTargets}</b> Karyawan</div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg">Batal</button>
                            <button type="submit" className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                                <Save className="w-4 h-4" /> Simpan Pengumuman
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex gap-2">
                        {['all', 'published', 'draft', 'archived'].map(s => (
                            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${filterStatus === s ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'}`}>
                                {s === 'all' ? 'Semua' : s}
                            </button>
                        ))}
                    </div>
                </div>

                {filteredAnnouncements.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 text-sm">
                        Belum ada pengumuman.
                    </div>
                ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                        {filteredAnnouncements.map(ann => (
                            <div key={ann.id} className={`p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${ann.status === 'archived' ? 'opacity-60' : ''}`}>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${ann.type==='info'?'bg-blue-100 text-blue-700 dark:bg-blue-900/30' : ann.type==='success'?'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' : ann.type==='warning'?'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' : 'bg-red-100 text-red-700 dark:bg-red-900/30'}`}>
                                                {ann.type}
                                            </span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${ann.status==='published'?'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-800' : ann.status==='draft'?'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
                                                {ann.status}
                                            </span>
                                            {ann.send_push && <span title="Push Notification Aktif"><Bell className="w-3 h-3 text-blue-500" /></span>}
                                        </div>
                                        <h3 className="font-bold text-slate-800 dark:text-slate-200 text-lg mb-1">{ann.title}</h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{ann.body}</p>
                                        
                                        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                                            <div className="flex items-center gap-1">
                                                <Users className="w-3 h-3" /> Target: {ann.target_type === 'all' ? 'Semua Karyawan' : ann.target_type}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" /> Dibuat: {new Date(ann.created_at).toLocaleDateString('id-ID')}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2 shrink-0">
                                        {ann.status === 'draft' && (
                                            <>
                                                <button onClick={() => {
                                                    setEditingId(ann.id);
                                                    setFormData({
                                                        title: ann.title, body: ann.body, type: ann.type, status: ann.status, target_type: ann.target_type, target_ids: ann.target_ids||[], send_push: ann.send_push, scheduled_at: ann.scheduled_at
                                                    });
                                                    setShowForm(true);
                                                    window.scrollTo({top: 0, behavior: 'smooth'});
                                                }} className="px-3 py-1.5 flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs font-semibold transition-colors">
                                                    <Edit2 className="w-3 h-3"/> Edit
                                                </button>
                                                <button onClick={() => handlePublish(ann)} className="px-3 py-1.5 flex items-center gap-2 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-400 rounded text-xs font-semibold transition-colors">
                                                    <Play className="w-3 h-3"/> Publish
                                                </button>
                                            </>
                                        )}
                                        <button onClick={() => handleArchiveToggle(ann)} className="px-3 py-1.5 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-500 rounded text-xs font-semibold transition-colors">
                                            <Archive className="w-3 h-3"/> {ann.status === 'archived' ? 'Pulihkan' : 'Arsipkan'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
