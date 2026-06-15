import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, update, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Company, UserIndex } from "../types";
import toast from "react-hot-toast";
import { mirrorUserToFirestore } from "../services/firestoreUserMirrorService";
import { ConfirmModal } from "../components/ConfirmModal";

export const CompanyAdmins: React.FC = () => {
    const { userData } = useAuth();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [users, setUsers] = useState<UserIndex[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
    const [selectedAdminUid, setSelectedAdminUid] = useState<string>("");

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

    useEffect(() => {
        if (userData?.role !== "owner") return;

        const companiesRef = ref(db, paths.companies());
        const unsubCompanies = onValue(companiesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setCompanies(Object.keys(data).map(key => ({...data[key], id: key})));
            } else {
                setCompanies([]);
            }
            setLoading(false);
        });

        // Fetch all active/pending users for selection (only those without company, or already admins)
        const usersRef = ref(db, paths.users());
        const unsubUsers = onValue(usersRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setUsers(Object.keys(data).map(key => ({...data[key], uid: key})));
            } else {
                setUsers([]);
            }
        });

        return () => {
            unsubCompanies();
            unsubUsers();
        };
    }, [userData]);

    const handleAssignAdmin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCompany?.id || !selectedAdminUid) return;

        const assignRequest = async () => {
            const companyId = selectedCompany.id!;
            const updates: any = {};
            
            // Assign in users index
            updates[`${paths.userIndex(selectedAdminUid)}/role`] = "admin";
            updates[`${paths.userIndex(selectedAdminUid)}/position`] = "ADMIN";
            updates[`${paths.userIndex(selectedAdminUid)}/company_id`] = companyId;
            updates[`${paths.userIndex(selectedAdminUid)}/status_akun`] = "active";
            
            // Set as admin for company
            updates[`${paths.company(companyId)}/admin_uid`] = selectedAdminUid;
            
            // Also need to push to company_users if not there
            const targetUser = users.find(u => u.uid === selectedAdminUid);
            if (targetUser) {
                updates[`${paths.companyUser(companyId, selectedAdminUid)}`] = {
                    ...targetUser,
                    role: "admin",
                    position: "ADMIN",
                    company_id: companyId,
                    status_akun: "active"
                };
            }

            await update(ref(db), updates);

            try {
                const targetAdmin = users.find(u => u.uid === selectedAdminUid);
                if (targetAdmin || selectedAdminUid) {
                    await mirrorUserToFirestore({
                        uid: selectedAdminUid,
                        company_id: companyId,
                        role: "admin",
                        status_akun: "active",
                        nama_lengkap: targetAdmin?.nama_lengkap || "",
                        email: targetAdmin?.email || "",
                        no_hp: (targetAdmin as any)?.no_hp || "",
                        position: "Admin Perusahaan",
                    });
                }
            } catch (mirrorErr) {
                console.warn("Failed to mirror admin assignment", mirrorErr);
            }

            return "Berhasil menetapkan Admin PT.";
        };

        toast.promise(assignRequest(), {
            loading: 'Menyimpan...',
            success: (msg) => {
                setShowModal(false);
                return msg;
            },
            error: (err) => `Gagal menetapkan admin: ${err.message}`
        });
    };

    if (loading) {
        return <div className="p-8 text-center text-blue-500">Memuat data Admin PT...</div>;
    }

    // Filter potential admins: those not yet assigned to another company, or already in this company
    const potentialAdmins = users.filter(u => u.role !== "owner" && (!u.company_id || (selectedCompany && u.company_id === selectedCompany.id)));

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
                    <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Admin PT</h1>
                    <p className="text-sm text-slate-500">Assign admin utama untuk tiap perusahaan</p>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                        <tr>
                            <th className="px-6 py-3 font-medium">Perusahaan</th>
                            <th className="px-6 py-3 font-medium">Nama Admin</th>
                            <th className="px-6 py-3 font-medium text-right">Aksi</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {companies.map((company) => {
                            const adminInfo = users.find(u => u.uid === company.admin_uid);
                            return (
                                <tr key={company.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                    <td className="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">{company.name}</td>
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-slate-800 dark:text-slate-200">
                                            {adminInfo ? (adminInfo.nama_lengkap || adminInfo.email || "Tanpa Nama") : (company.admin_uid ? <span className="text-slate-500 italic">Data Tidak Ditemukan</span> : <span className="text-slate-500 italic">Belum di assign</span>)}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right flex justify-end gap-3">
                                        <button 
                                            onClick={() => {
                                                setSelectedCompany(company);
                                                setSelectedAdminUid(company.admin_uid || "");
                                                setShowModal(true);
                                            }}
                                            className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium"
                                        >
                                            {company.admin_uid ? "Ubah Admin" : "Set Admin"}
                                        </button>

                                        {company.admin_uid && (
                                            <>
                                              <button 
                                                  onClick={() => {
                                                      requestConfirm(
                                                          "Cabut Akses Admin",
                                                          "Cabut akses admin dari perusahaan ini?",
                                                          true,
                                                          () => {
                                                              const removeRequest = async () => {
                                                                  const updates: any = {};
                                                                  updates[`${paths.company(company.id!)}/admin_uid`] = null;
                                                                  updates[`${paths.userIndex(company.admin_uid!)}/role`] = "user";
                                                                  updates[`${paths.companyUser(company.id!, company.admin_uid!)}/role`] = "user";
                                                                  await update(ref(db), updates);

                                                                  try {
                                                                      const targetAdmin = users.find(u => u.uid === company.admin_uid);
                                                                      if (company.admin_uid) {
                                                                          await mirrorUserToFirestore({
                                                                              uid: company.admin_uid,
                                                                              company_id: company.id,
                                                                              role: "user",
                                                                              status_akun: targetAdmin?.status_akun || "active",
                                                                          });
                                                                      }
                                                                  } catch (mirrorErr) {
                                                                      console.warn("Failed to mirror admin removal", mirrorErr);
                                                                  }

                                                                  return "Akses admin berhasil dicabut.";
                                                              };
                                                              
                                                              toast.promise(removeRequest(), {
                                                                  loading: "Memproses...",
                                                                  success: (msg) => msg,
                                                                  error: (err) => `Gagal mencabut admin: ${err.message}`
                                                              });
                                                          }
                                                      );
                                                  }}
                                                  className="text-orange-600 dark:text-orange-400 hover:text-orange-300 text-xs font-medium"
                                              >
                                                  Cabut Akses
                                              </button>
                                              
                                              <button 
                                                  onClick={() => {
                                                      requestConfirm(
                                                          "Hapus Akun Admin",
                                                          "Hapus permanen akun admin ini dari sistem? Tindakan ini tidak dapat dibatalkan.",
                                                          true,
                                                          () => {
                                                              const deleteRequest = async () => {
                                                                  const updates: any = {};
                                                                  // Reset admin in company
                                                                  updates[`${paths.company(company.id!)}/admin_uid`] = null;
                                                                  // Remove from users index
                                                                  updates[paths.userIndex(company.admin_uid!)] = null;
                                                                  // Remove from company_users
                                                                  updates[paths.companyUser(company.id!, company.admin_uid!)] = null;
                                                                  
                                                                  await update(ref(db), updates);
                                                                  return "Akun admin berhasil dihapus permanen.";
                                                              };
                                                              
                                                              toast.promise(deleteRequest(), {
                                                                  loading: "Menghapus...",
                                                                  success: (msg) => msg,
                                                                  error: (err) => `Gagal menghapus admin: ${err.message}`
                                                              });
                                                          }
                                                      );
                                                  }}
                                                  className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium"
                                              >
                                                  Hapus
                                              </button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {showModal && selectedCompany && (
                <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">Set Admin: {selectedCompany.name}</h3>
                            <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
                        </div>
                        <form onSubmit={handleAssignAdmin} className="p-6">
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                Admin baru akan memiliki full akses ke perusahaan ini, mengubah role-nya menjadi <code>admin</code>.
                            </p>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Pilih User</label>
                                <select
                                    value={selectedAdminUid}
                                    onChange={(e) => setSelectedAdminUid(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                                    required
                                >
                                    <option value="" disabled>-- Pilih Calon Admin --</option>
                                    {potentialAdmins.map(u => (
                                        <option key={u.uid} value={u.uid}>
                                            {u.nama_lengkap} ({u.email}) {u.company_id ? ` - di PT ini` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700"
                                >
                                    Batal
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
                                >
                                    Simpan
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
