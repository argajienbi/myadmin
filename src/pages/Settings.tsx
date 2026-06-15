import React, { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { updatePassword } from "firebase/auth";
import { ref, update, get } from "firebase/database";
import { db, auth, storage } from "../firebase";
import { paths } from "../services/paths";
import toast from "react-hot-toast";
import { syncFirestoreUsersFromRtdb } from "../services/syncFirestoreUsersFromRtdb";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  normalizeHttpsUrl,
  parseDomains,
  domainFromUrl,
  domainsToText,
} from "../utils/companyWebsite";
import { writeAuditLog } from "../services/auditService";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { getLogoExtension, validateCompanyLogoFile, getCompanyDisplayName } from "../utils/companyBranding";

export const Settings: React.FC = () => {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(false);
  const [syncingFirestoreUsers, setSyncingFirestoreUsers] = useState(false);

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
  
  // Profile state
  const [namaLengkap, setNamaLengkap] = useState(userData?.nama_lengkap || "");
  const [noHp, setNoHp] = useState((userData as any)?.no_hp || "");
  
  // Security state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [companyWebsiteLoading, setCompanyWebsiteLoading] = useState(false);
  const [companyWebsiteSaving, setCompanyWebsiteSaving] = useState(false);
  const [companyWebsiteEnabled, setCompanyWebsiteEnabled] = useState(false);
  const [companyWebsiteTitle, setCompanyWebsiteTitle] = useState("Website Perusahaan");
  const [companyWebsiteUrl, setCompanyWebsiteUrl] = useState("");
  const [companyWebsiteDomains, setCompanyWebsiteDomains] = useState("");

  const manageableCompanyId = userData?.role === "owner"
    ? ""
    : userData?.company_id || "";

  const [companyLogoEnabled, setCompanyLogoEnabled] = useState(true);
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [companyLogoPath, setCompanyLogoPath] = useState("");
  const [companyLogoPreview, setCompanyLogoPreview] = useState("");
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyBrandingLoading, setCompanyBrandingLoading] = useState(false);
  const [companyBrandingSaving, setCompanyBrandingSaving] = useState(false);

  useEffect(() => {
    if (!manageableCompanyId) return;

    let mounted = true;

    const loadWebsite = async () => {
      setCompanyWebsiteLoading(true);
      try {
        const snap = await get(ref(db, paths.company(manageableCompanyId)));
        const company = snap.exists() ? snap.val() : {};
        if (!mounted) return;

        setCompanyWebsiteEnabled(company.company_website_enabled === true || String(company.company_website_enabled) === "true");
        setCompanyWebsiteTitle(company.company_website_title || "Website Perusahaan");
        setCompanyWebsiteUrl(company.company_website_url || "");
        setCompanyWebsiteDomains(domainsToText(company.company_allowed_domains));
        
        const logoUrl = company.company_logo_url || "";
        setCompanyLogoEnabled(company.company_logo_enabled !== false);
        setCompanyLogoUrl(logoUrl);
        setCompanyLogoPath(company.company_logo_path || "");
        setCompanyLogoPreview(logoUrl);
      } catch (error: any) {
        if (mounted) toast.error(error.message || "Gagal memuat website perusahaan.");
      } finally {
        if (mounted) setCompanyWebsiteLoading(false);
      }
    };

    loadWebsite();

    return () => {
      mounted = false;
    };
  }, [manageableCompanyId]);

  const handleSaveCompanyWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manageableCompanyId) return;

    setCompanyWebsiteSaving(true);

    const saveRequest = async () => {
      let normalizedUrl = "";

      if (companyWebsiteEnabled) {
        normalizedUrl = normalizeHttpsUrl(companyWebsiteUrl);
      } else if (companyWebsiteUrl.trim()) {
        normalizedUrl = normalizeHttpsUrl(companyWebsiteUrl);
      }

      let domains = parseDomains(companyWebsiteDomains);
      const mainDomain = normalizedUrl ? domainFromUrl(normalizedUrl) : "";

      if (mainDomain && domains.length === 0) {
        domains = [mainDomain];
      }

      if (mainDomain && !domains.includes(mainDomain)) {
        domains.unshift(mainDomain);
      }

      const updates = {
        company_website_enabled: companyWebsiteEnabled,
        company_website_title: companyWebsiteTitle.trim() || "Website Perusahaan",
        company_website_url: normalizedUrl,
        company_allowed_domains: domains,
        updated_at: Date.now(),
      };

      await update(ref(db, paths.company(manageableCompanyId)), updates);

      await writeAuditLog(manageableCompanyId, {
        action: "UPDATE_MASTER_DATA",
        details: "Mengubah konfigurasi website perusahaan",
        user_uid: userData?.uid || "",
        user_name: userData?.nama_lengkap || "Unknown",
        target_path: paths.company(manageableCompanyId),
        new_value: updates,
      });

      return "Website perusahaan berhasil disimpan.";
    };

    toast.promise(saveRequest(), {
      loading: "Menyimpan website perusahaan...",
      success: (msg) => msg,
      error: (err) => `Gagal menyimpan website: ${err.message}`,
    }).finally(() => setCompanyWebsiteSaving(false));
  };

  const handleCompanyLogoFileChange = (file?: File | null) => {
    if (!file) return;

    try {
      validateCompanyLogoFile(file);
      setCompanyLogoFile(file);
      setCompanyLogoPreview(URL.createObjectURL(file));
    } catch (error: any) {
      toast.error(error.message || "Logo tidak valid.");
    }
  };

  const handleSaveCompanyBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manageableCompanyId) return;

    setCompanyBrandingSaving(true);

    const saveRequest = async () => {
      const updates: any = {
        company_logo_enabled: companyLogoEnabled,
        company_logo_updated_at: Date.now(),
        updated_at: Date.now(),
      };

      if (companyLogoFile) {
        validateCompanyLogoFile(companyLogoFile);

        const ext = getLogoExtension(companyLogoFile);
        const path = `company_logos/${manageableCompanyId}/logo.${ext}`;
        const fileRef = storageRef(storage, path);

        await uploadBytes(fileRef, companyLogoFile, {
          contentType: companyLogoFile.type,
          customMetadata: {
            companyId: manageableCompanyId,
            uploadedBy: userData?.uid || "",
            purpose: "company_logo",
          },
        });

        const downloadUrl = await getDownloadURL(fileRef);

        updates.company_logo_url = downloadUrl;
        updates.company_logo_path = path;
        updates.company_logo_file_name = companyLogoFile.name;
        updates.company_logo_mime_type = companyLogoFile.type;
        updates.company_logo_size_bytes = companyLogoFile.size;
        updates.company_logo_enabled = true;
      }

      await update(ref(db, paths.company(manageableCompanyId)), updates);

      await writeAuditLog(manageableCompanyId, {
        action: "UPDATE_MASTER_DATA",
        details: `Mengubah branding perusahaan`,
        user_uid: userData?.uid || "",
        user_name: userData?.nama_lengkap || "Unknown",
        target_path: paths.company(manageableCompanyId),
        new_value: {
          company_logo_enabled: updates.company_logo_enabled,
          company_logo_path: updates.company_logo_path || companyLogoPath || "",
          company_logo_url: updates.company_logo_url ? "[uploaded_url]" : companyLogoUrl ? "[existing_url]" : "",
        },
      });

      return "Branding perusahaan berhasil disimpan.";
    };

    toast.promise(saveRequest(), {
      loading: "Menyimpan branding perusahaan...",
      success: (msg) => msg,
      error: (err) => `Gagal menyimpan branding: ${err.message}`,
    }).finally(() => setCompanyBrandingSaving(false));
  };

  const handleDeleteCompanyLogo = () => {
    if (!manageableCompanyId) return;

    requestConfirm(
      "Hapus Logo Perusahaan",
      "Hapus logo perusahaan ini? ID Card akan memakai fallback MP.",
      true,
      () => {
        const deleteRequest = async () => {
          if (companyLogoPath) {
            try {
              await deleteObject(storageRef(storage, companyLogoPath));
            } catch (_) {}
          }

          const updates = {
            company_logo_enabled: false,
            company_logo_url: "",
            company_logo_path: "",
            company_logo_updated_at: Date.now(),
            company_logo_file_name: "",
            company_logo_mime_type: "",
            company_logo_size_bytes: 0,
            updated_at: Date.now(),
          };

          await update(ref(db, paths.company(manageableCompanyId)), updates);

          await writeAuditLog(manageableCompanyId, {
            action: "UPDATE_MASTER_DATA",
            details: "Menghapus logo perusahaan",
            user_uid: userData?.uid || "",
            user_name: userData?.nama_lengkap || "Unknown",
            target_path: paths.company(manageableCompanyId),
            new_value: updates,
          });

          setCompanyLogoUrl("");
          setCompanyLogoPath("");
          setCompanyLogoPreview("");
          setCompanyLogoFile(null);
          setCompanyLogoEnabled(false);

          return "Logo perusahaan berhasil dihapus.";
        };

        toast.promise(deleteRequest(), {
          loading: "Menghapus logo...",
          success: (msg) => msg,
          error: (err) => `Gagal menghapus logo: ${err.message}`,
        });
      }
    );
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userData?.uid) return;
    
    setLoading(true);
    const saveProfile = async () => {
      const updates: any = {};
      updates[`${paths.userIndex(userData.uid)}/nama_lengkap`] = namaLengkap;
      updates[`${paths.userIndex(userData.uid)}/no_hp`] = noHp;

      if (userData.company_id && userData.role !== 'owner') {
         updates[`${paths.companyUser(userData.company_id, userData.uid)}/nama_lengkap`] = namaLengkap;
         updates[`${paths.companyUser(userData.company_id, userData.uid)}/no_hp`] = noHp;
      }
      
      await update(ref(db), updates);
      return "Profil berhasil diperbarui!";
    };

    toast.promise(saveProfile(), {
      loading: 'Menyimpan profil...',
      success: (msg) => msg,
      error: (err) => `Gagal mengupdate profil: ${err.message}`
    }).finally(() => {
      setLoading(false);
    });
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast.error("Password dan konfirmasi tidak cocok.");
      return;
    }
    
    if (newPassword.length < 6) {
      toast.error("Password minimal 6 karakter.");
      return;
    }

    if (!auth.currentUser) return;

    setLoading(true);
    const savePassword = async () => {
      await updatePassword(auth.currentUser!, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      return "Password berhasil diperbarui!";
    };

    toast.promise(savePassword(), {
      loading: 'Menyimpan password...',
      success: (msg) => msg,
      error: (err) => {
        if (err.code === "auth/requires-recent-login") {
           return "Mohon logout dan login kembali sebelum mengubah password demi keamanan.";
        }
        return `Gagal mengupdate password: ${err.message}`;
      }
    }).finally(() => {
      setLoading(false);
    });
  };

  const handleSyncFirestoreUsers = async () => {
    if (!userData) return;

    requestConfirm(
      "Sinkronisasi User ke Firestore",
      "Sinkronkan data user lama dari RTDB ke Firestore? Proses ini diperlukan agar fitur Pengumuman dan Notifikasi Firestore berjalan tanpa input manual.",
      false,
      async () => {
        setSyncingFirestoreUsers(true);

        try {
          const companyId =
            userData.role === "owner"
              ? undefined
              : userData.company_id;

          const result = await syncFirestoreUsersFromRtdb(companyId);

          toast.success(
            `Sync selesai. Total: ${result.total}, Berhasil: ${result.success}, Gagal: ${result.failed}`
          );
        } catch (error: any) {
          toast.error(error.message || "Gagal sinkron user ke Firestore");
        } finally {
          setSyncingFirestoreUsers(false);
        }
      }
    );
  };

  return (
    <div className="max-w-4xl max-w-full">
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        isDestructive={confirmModal.isDestructive}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      />
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-6">Pengaturan Profil</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-lg">
             <h2 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">Informasi Pribadi</h2>
             <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                   <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Lengkap</label>
                   <input
                     type="text"
                     required
                     value={namaLengkap}
                     onChange={e => setNamaLengkap(e.target.value)}
                     className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-blue-500 outline-none"
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email <span className="text-slate-400 text-xs">(Tidak dapat diubah)</span></label>
                   <input
                     type="email"
                     disabled
                     value={userData?.email || ""}
                     className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 rounded cursor-not-allowed"
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">No. Handphone</label>
                   <input
                     type="text"
                     value={noHp}
                     onChange={e => setNoHp(e.target.value)}
                     className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-blue-500 outline-none"
                   />
                </div>
                <button
                   type="submit"
                   disabled={loading}
                   className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium disabled:opacity-50"
                >
                   {loading ? "Menyimpan..." : "Simpan Profil"}
                </button>
             </form>
          </div>
          
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-lg">
             <h2 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">Keamanan Akun</h2>
             <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div>
                   <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password Baru</label>
                   <input
                     type="password"
                     required
                     value={newPassword}
                     onChange={e => setNewPassword(e.target.value)}
                     className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-red-500 outline-none"
                   />
                </div>
                <div>
                   <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Konfirmasi Password Baru</label>
                   <input
                     type="password"
                     required
                     value={confirmPassword}
                     onChange={e => setConfirmPassword(e.target.value)}
                     className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-red-500 outline-none"
                   />
                </div>
                <button
                   type="submit"
                   disabled={loading}
                   className="w-full py-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium disabled:opacity-50"
                >
                   {loading ? "Menyimpan..." : "Ganti Password"}
                </button>
             </form>
             <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded text-sm text-blue-800 dark:text-blue-300">
                Catatan: Mengganti password dapat mengharuskan Anda untuk melakukan login ulang pada aplikasi.
             </div>
          </div>
      </div>
      
      {userData?.role !== "owner" && manageableCompanyId && (
        <div className="mt-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">
            Website Perusahaan
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Atur alamat website yang akan dibuka dari aplikasi Flutter pada menu Profil.
          </p>

          {companyWebsiteLoading ? (
            <div className="mt-4 text-sm text-blue-500">Memuat konfigurasi website...</div>
          ) : (
            <form onSubmit={handleSaveCompanyWebsite} className="mt-5 space-y-4 max-w-2xl">
              <label className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 w-fit">
                <input
                  type="checkbox"
                  checked={companyWebsiteEnabled}
                  onChange={(e) => setCompanyWebsiteEnabled(e.target.checked)}
                />
                <div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Aktifkan website perusahaan
                  </div>
                  <div className="text-xs text-slate-500">
                    Jika aktif, karyawan dapat membuka website dari menu Profil.
                  </div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Judul Menu
                </label>
                <input
                  type="text"
                  value={companyWebsiteTitle}
                  onChange={(e) => setCompanyWebsiteTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-blue-500 outline-none"
                  placeholder="Website Perusahaan"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  URL Website
                </label>
                <input
                  type="url"
                  value={companyWebsiteUrl}
                  onChange={(e) => setCompanyWebsiteUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-blue-500 outline-none"
                  placeholder="https://perusahaan.co.id"
                  required={companyWebsiteEnabled}
                />
                <p className="text-xs text-slate-500 mt-1">Wajib HTTPS.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Domain yang Diizinkan
                </label>
                <textarea
                  value={companyWebsiteDomains}
                  onChange={(e) => setCompanyWebsiteDomains(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded focus:border-blue-500 outline-none font-mono text-xs"
                  placeholder={"perusahaan.co.id\nwww.perusahaan.co.id"}
                />
              </div>

              <button
                type="submit"
                disabled={companyWebsiteSaving}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {companyWebsiteSaving ? "Menyimpan..." : "Simpan Website Perusahaan"}
              </button>
            </form>
          )}
        </div>
      )}

      {userData?.role === "owner" && (
        <div className="mt-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Website Perusahaan</h2>
          <p className="text-sm text-slate-500 mt-1">
            Owner dapat mengatur website perusahaan dari menu <span className="font-semibold text-slate-700 dark:text-slate-300">Perusahaan &gt; Website</span>.
          </p>
        </div>
      )}

      {userData?.role !== "owner" && manageableCompanyId && (
        <div className="mt-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Branding Perusahaan</h2>
          <p className="text-sm text-slate-500 mt-1">Atur logo yang akan tampil di ID Card aplikasi Flutter.</p>

          {companyBrandingLoading ? (
            <div className="mt-4 text-sm text-blue-500">Memuat konfigurasi branding...</div>
          ) : (
            <form onSubmit={handleSaveCompanyBranding} className="mt-5 space-y-5 max-w-2xl">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950">
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center shadow-sm">
                    {companyLogoPreview ? (
                      <img src={companyLogoPreview} alt="Preview logo" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xl font-black text-teal-600">MP</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-200">Logo Perusahaan</div>
                    <p className="text-xs text-slate-500 mt-1">Logo ini akan tampil di ID Card aplikasi Flutter.</p>
                    <p className="text-[11px] text-slate-500 mt-2">Format: PNG, JPG, WEBP. Maksimal 2 MB. Rasio disarankan 1:1.</p>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 w-fit">
                <input type="checkbox" checked={companyLogoEnabled} onChange={(e) => setCompanyLogoEnabled(e.target.checked)} />
                <div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200">Aktifkan logo perusahaan</div>
                  <div className="text-xs text-slate-500">Jika nonaktif, aplikasi akan memakai fallback logo MP.</div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Upload / Ganti Logo</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => handleCompanyLogoFileChange(e.target.files?.[0])}
                  className="w-full text-sm text-slate-700 dark:text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-teal-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-teal-500"
                />
              </div>

              <div className="flex justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDeleteCompanyLogo}
                  disabled={!companyLogoUrl}
                  className="px-4 py-2 rounded text-sm font-medium text-red-600 dark:text-red-400 border border-red-500/30 disabled:opacity-40"
                >
                  Hapus Logo
                </button>

                <button type="submit" disabled={companyBrandingSaving} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded text-sm font-medium disabled:opacity-50">
                  {companyBrandingSaving ? "Menyimpan..." : "Simpan Branding"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {userData?.role === "owner" && (
        <div className="mt-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Branding Perusahaan</h2>
          <p className="text-sm text-slate-500 mt-1">Owner dapat mengatur logo perusahaan dari menu <span className="font-semibold text-slate-700 dark:text-slate-300">Perusahaan &gt; Branding</span>.</p>
        </div>
      )}
      
      {userData?.role === 'owner' && (
        <div className="mt-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">
            Sinkronisasi Firestore
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Sinkronkan data user lama dari RTDB ke Firestore agar fitur Pengumuman,
            Notifikasi, dan FCM dapat memakai rules Firestore tanpa input manual.
          </p>
  
          <button
            type="button"
            onClick={handleSyncFirestoreUsers}
            disabled={syncingFirestoreUsers}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {syncingFirestoreUsers ? "Menyinkronkan..." : "Sinkronkan User ke Firestore"}
          </button>
        </div>
      )}
    </div>
  );
};
