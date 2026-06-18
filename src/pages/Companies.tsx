import React, { useEffect, useState } from "react";
import { ref, onValue, push, set, update, remove } from "firebase/database";
import { db, storage } from "../firebase";
import { paths } from "../services/paths";
import { Company, CompanyInvite } from "../types";
import { useAuth } from "../auth/AuthContext";
import toast from "react-hot-toast";
import { writeAuditLog } from "../services/auditService";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  normalizeHttpsUrl,
  parseDomains,
  domainFromUrl,
  domainsToText,
} from "../utils/companyWebsite";
import {
  getCompanyDisplayName,
  getLogoExtension,
  validateCompanyLogoFile,
} from "../utils/companyBranding";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { isOwnerLike } from "../utils/roleAccess";

export const Companies: React.FC = () => {
  const { userData } = useAuth();
  const isOwner = isOwnerLike(userData);
  const isCompanyAdmin = String(userData?.role || "").toLowerCase() === "admin" && !!userData?.company_id;
  const adminCompanyId = userData?.company_id || "";

  const canManageCompany = (companyId?: string) => {
    if (!companyId) return false;
    if (isOwner) return true;
    return isCompanyAdmin && adminCompanyId === companyId;
  };

  const ensureCompanyAccess = (companyId?: string) => {
    if (canManageCompany(companyId)) return true;
    toast.error("Anda tidak memiliki akses ke perusahaan ini.");
    return false;
  };

  const ensureOwnerOnly = (message = "Aksi ini hanya dapat dilakukan oleh owner.") => {
    if (isOwner) return true;
    toast.error(message);
    return false;
  };

  const [companies, setCompanies] = useState<Company[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [websiteModalCompany, setWebsiteModalCompany] = useState<Company | null>(null);
  const [websiteEnabled, setWebsiteEnabled] = useState(false);
  const [websiteTitle, setWebsiteTitle] = useState("Website Perusahaan");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteDomains, setWebsiteDomains] = useState("");
  const [savingWebsite, setSavingWebsite] = useState(false);

  const [brandingCompany, setBrandingCompany] = useState<Company | null>(null);
  const [brandingLogoEnabled, setBrandingLogoEnabled] = useState(true);
  const [brandingLogoFile, setBrandingLogoFile] = useState<File | null>(null);
  const [brandingLogoPreview, setBrandingLogoPreview] = useState("");
  const [savingBranding, setSavingBranding] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);

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
    if (!userData) return;

    setLoading(true);
    setError("");

    if (isOwner) {
      const companiesRef = ref(db, paths.companies());
      const invitesRef = ref(db, paths.companyInvites());

      const unsubscribeCompanies = onValue(companiesRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const compList = Object.keys(data).map(key => ({
            ...data[key],
            id: key
          }));
          setCompanies(compList);
        } else {
          setCompanies([]);
        }
        setLoading(false);
      }, (err) => {
        setError(err.message);
        setLoading(false);
      });

      const unsubscribeInvites = onValue(invitesRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const invList = Object.keys(data).map(key => ({
            ...data[key],
            code: key
          }));
          setInvites(invList as any);
        } else {
          setInvites([]);
        }
      });

      return () => {
        unsubscribeCompanies();
        unsubscribeInvites();
      };
    }

    if (isCompanyAdmin && adminCompanyId) {
      const companyRef = ref(db, paths.company(adminCompanyId));

      const unsubscribeCompany = onValue(companyRef, (snapshot) => {
        if (snapshot.exists()) {
          setCompanies([{ ...snapshot.val(), id: adminCompanyId }]);
          setError("");
        } else {
          setCompanies([]);
          setError("Data perusahaan Anda tidak ditemukan. Hubungi owner.");
        }

        setInvites([]);
        setLoading(false);
      }, (err) => {
        setCompanies([]);
        setInvites([]);
        setError(err.message);
        setLoading(false);
      });

      return () => {
        unsubscribeCompany();
      };
    }

    setCompanies([]);
    setInvites([]);
    setLoading(false);
    setError("Akun ini belum memiliki akses perusahaan.");
  }, [userData, isOwner, isCompanyAdmin, adminCompanyId]);

  const openWebsiteModal = (company: Company) => {
    if (!ensureCompanyAccess(company.id)) return;
    setWebsiteModalCompany(company);
    setWebsiteEnabled(company.company_website_enabled === true || String((company as any).company_website_enabled) === "true");
    setWebsiteTitle(company.company_website_title || "Website Perusahaan");
    setWebsiteUrl(company.company_website_url || "");
    setWebsiteDomains(domainsToText(company.company_allowed_domains));
  };

  const closeWebsiteModal = () => {
    setWebsiteModalCompany(null);
    setWebsiteEnabled(false);
    setWebsiteTitle("Website Perusahaan");
    setWebsiteUrl("");
    setWebsiteDomains("");
    setSavingWebsite(false);
  };

  const handleSaveWebsiteConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteModalCompany?.id) return;
    if (!ensureCompanyAccess(websiteModalCompany.id)) return;

    setSavingWebsite(true);

    const saveRequest = async () => {
      let normalizedUrl = "";

      if (websiteEnabled) {
        normalizedUrl = normalizeHttpsUrl(websiteUrl);
      } else if (websiteUrl.trim()) {
        normalizedUrl = normalizeHttpsUrl(websiteUrl);
      }

      let domains = parseDomains(websiteDomains);
      const mainDomain = normalizedUrl ? domainFromUrl(normalizedUrl) : "";

      if (mainDomain && domains.length === 0) {
        domains = [mainDomain];
      }

      if (mainDomain && !domains.includes(mainDomain)) {
        domains.unshift(mainDomain);
      }

      const updates = {
        company_website_enabled: websiteEnabled,
        company_website_title: websiteTitle.trim() || "Website Perusahaan",
        company_website_url: normalizedUrl,
        company_allowed_domains: domains,
        updated_at: Date.now(),
      };

      await update(ref(db, paths.company(websiteModalCompany.id!)), updates);

      await writeAuditLog(websiteModalCompany.id!, {
        action: "UPDATE_MASTER_DATA",
        details: `Mengubah konfigurasi website perusahaan ${websiteModalCompany.name}`,
        user_uid: userData?.uid || "",
        user_name: userData?.nama_lengkap || "Unknown",
        target_path: paths.company(websiteModalCompany.id!),
        new_value: {
          ...updates,
          company_website_url: normalizedUrl,
          company_allowed_domains: domains,
        },
      });

      return "Konfigurasi website perusahaan berhasil disimpan.";
    };

    toast.promise(saveRequest(), {
      loading: "Menyimpan website perusahaan...",
      success: (msg) => {
        closeWebsiteModal();
        return msg;
      },
      error: (err) => `Gagal menyimpan website: ${err.message}`,
    }).finally(() => setSavingWebsite(false));
  };

  const openBrandingModal = (company: Company) => {
    if (!ensureCompanyAccess(company.id)) return;
    setBrandingCompany(company);
    setBrandingLogoEnabled(company.company_logo_enabled !== false);
    setBrandingLogoFile(null);
    setBrandingLogoPreview(company.company_logo_url || "");
  };

  const closeBrandingModal = () => {
    setBrandingCompany(null);
    setBrandingLogoEnabled(true);
    setBrandingLogoFile(null);
    setBrandingLogoPreview("");
    setSavingBranding(false);
  };

  const handleBrandingLogoFileChange = (file?: File | null) => {
    if (!file) return;

    try {
      validateCompanyLogoFile(file);
      setBrandingLogoFile(file);
      setBrandingLogoPreview(URL.createObjectURL(file));
    } catch (error: any) {
      toast.error(error.message || "Logo tidak valid.");
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandingCompany?.id) return;
    if (!ensureCompanyAccess(brandingCompany.id)) return;

    setSavingBranding(true);

    const saveRequest = async () => {
      const companyId = brandingCompany.id!;
      const updates: any = {
        company_logo_enabled: brandingLogoEnabled,
        company_logo_updated_at: Date.now(),
        updated_at: Date.now(),
      };

      if (brandingLogoFile) {
        validateCompanyLogoFile(brandingLogoFile);

        const ext = getLogoExtension(brandingLogoFile);
        const path = `company_logos/${companyId}/logo.${ext}`;
        const fileRef = storageRef(storage, path);

        await uploadBytes(fileRef, brandingLogoFile, {
          contentType: brandingLogoFile.type,
          customMetadata: {
            companyId,
            uploadedBy: userData?.uid || "",
            purpose: "company_logo",
          },
        });

        const downloadUrl = await getDownloadURL(fileRef);

        updates.company_logo_url = downloadUrl;
        updates.company_logo_path = path;
        updates.company_logo_file_name = brandingLogoFile.name;
        updates.company_logo_mime_type = brandingLogoFile.type;
        updates.company_logo_size_bytes = brandingLogoFile.size;
        updates.company_logo_enabled = true;
      }

      await update(ref(db, paths.company(companyId)), updates);

      await writeAuditLog(companyId, {
        action: "UPDATE_MASTER_DATA",
        details: `Mengubah branding/logo perusahaan ${brandingCompany.name}`,
        user_uid: userData?.uid || "",
        user_name: userData?.nama_lengkap || "Unknown",
        target_path: paths.company(companyId),
        new_value: {
          company_logo_enabled: updates.company_logo_enabled,
          company_logo_path: updates.company_logo_path || brandingCompany.company_logo_path || "",
          company_logo_url: updates.company_logo_url ? "[uploaded_url]" : brandingCompany.company_logo_url ? "[existing_url]" : "",
        },
      });

      return "Branding perusahaan berhasil disimpan.";
    };

    toast.promise(saveRequest(), {
      loading: "Menyimpan branding perusahaan...",
      success: (msg) => {
        closeBrandingModal();
        return msg;
      },
      error: (err) => `Gagal menyimpan branding: ${err.message}`,
    }).finally(() => setSavingBranding(false));
  };

  const handleDeleteCompanyLogo = () => {
    if (!brandingCompany?.id) return;
    if (!ensureCompanyAccess(brandingCompany.id)) return;

    requestConfirm(
      "Hapus Logo Perusahaan",
      "Hapus logo perusahaan ini? ID Card akan memakai fallback MP.",
      true,
      () => {
        const deleteRequest = async () => {
          const companyId = brandingCompany.id!;
          const currentPath = brandingCompany.company_logo_path || "";

          if (currentPath) {
            try {
              await deleteObject(storageRef(storage, currentPath));
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

          await update(ref(db, paths.company(companyId)), updates);

          await writeAuditLog(companyId, {
            action: "UPDATE_MASTER_DATA",
            details: `Menghapus logo perusahaan ${brandingCompany.name}`,
            user_uid: userData?.uid || "",
            user_name: userData?.nama_lengkap || "Unknown",
            target_path: paths.company(companyId),
            new_value: updates,
          });

          closeBrandingModal();
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

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    if (!isOwner && !editingCompanyId) {
      toast.error("Hanya owner yang dapat menambah perusahaan.");
      return;
    }

    if (editingCompanyId && !ensureCompanyAccess(editingCompanyId)) {
      return;
    }

    const createRequest = async () => {
      if (editingCompanyId) {
        await update(ref(db, paths.company(editingCompanyId)), {
          name: newCompanyName,
          updated_at: Date.now()
        });
        await writeAuditLog(editingCompanyId, {
          action: "UPDATE_MASTER_DATA",
          details: `Mengubah nama perusahaan menjadi ${newCompanyName}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: paths.company(editingCompanyId),
          new_value: { name: newCompanyName },
        });
        return "Berhasil memperbarui perusahaan";
      } else {
        const companiesRef = ref(db, paths.companies());
        const newCompanyRef = push(companiesRef);
        
        const newCompany: Company = {
          name: newCompanyName,
          admin_uid: "",
          active: true,
          created_by: userData?.uid || "",
          created_at: Date.now(),
          updated_at: Date.now()
        };

        await set(newCompanyRef, newCompany);
        await writeAuditLog(newCompanyRef.key!, {
          action: "CREATE_MASTER_DATA",
          details: `Membuat perusahaan baru ${newCompanyName}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: paths.company(newCompanyRef.key!),
          new_value: newCompany,
        });
        return "Berhasil membuat perusahaan";
      }
    };

    toast.promise(createRequest(), {
      loading: 'Menyimpan...',
      success: (msg) => {
        setNewCompanyName("");
        setEditingCompanyId(null);
        setShowModal(false);
        return msg;
      },
      error: (err) => `Gagal menyimpan perusahaan: ${err.message}`
    });
  };

  const handleToggleActive = async (companyId: string, currentActive: boolean) => {
    if (!ensureOwnerOnly("Hanya owner yang dapat menonaktifkan atau memulihkan perusahaan.")) return;

    requestConfirm(
      currentActive ? "Nonaktifkan Perusahaan" : "Pulihkan Perusahaan",
      currentActive ? "Nonaktifkan perusahaan ini? Data tidak akan dihapus permanen." : "Pulihkan perusahaan ini?",
      currentActive, // destructive if disabling
      () => {
        const toggleRequest = async () => {
          const updates = currentActive ? {
            active: false,
            deleted_at: Date.now(),
            deleted_by: userData?.uid || "",
            updated_at: Date.now()
          } : {
            active: true,
            deleted_at: null,
            deleted_by: null,
            updated_at: Date.now()
          };
          await update(ref(db, paths.company(companyId)), updates);
          await writeAuditLog(companyId, {
              action: currentActive ? "DEACTIVATE_MASTER_DATA" : "RESTORE_MASTER_DATA",
              details: `${currentActive ? 'Menonaktifkan' : 'Memulihkan'} perusahaan`,
              user_uid: userData?.uid || "",
              user_name: userData?.nama_lengkap || "Unknown",
              target_path: paths.company(companyId),
              new_value: updates,
          });
          return currentActive ? "Perusahaan dinonaktifkan" : "Perusahaan dipulihkan";
        };

        toast.promise(toggleRequest(), {
            loading: 'Memproses...',
            success: (msg) => msg,
            error: (err) => `Gagal update: ${err.message}`
        });
      }
    );
  };

  const handleDeleteCompany = async (companyId: string) => {
    if (!ensureOwnerOnly("Hanya owner yang dapat menghapus perusahaan.")) return;

    requestConfirm(
      "Hapus Perusahaan",
      "Hapus permanen perusahaan ini? Tindakan ini tidak dapat dibatalkan, dan semua data perusahaan akan hilang.",
      true,
      () => {
        const deleteRequest = async () => {
          await remove(ref(db, paths.company(companyId)));
          return "Perusahaan berhasil dihapus permanen";
        };

        toast.promise(deleteRequest(), {
            loading: 'Menghapus...',
            success: (msg) => msg,
            error: (err) => `Gagal menghapus: ${err.message}`
        });
      }
    );
  };

  const generateInviteCode = async (company: Company) => {
    if (!company.id) return;
    if (!ensureCompanyAccess(company.id)) return;
    
    // Generate a random 6 char alphanumeric code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const generateRequest = async () => {
      const inviteRef = ref(db, paths.companyInvite(code));
      const inviteData: CompanyInvite = {
        company_id: company.id!,
        company_name: company.name,
        active: true,
        created_by: userData?.uid || "",
        expired_at: 0,
        created_at: Date.now()
      };
      await set(inviteRef, inviteData);
      await writeAuditLog(company.id!, {
        action: "CREATE_MASTER_DATA",
        details: `Membuat kode undangan untuk perusahaan`,
        user_uid: userData?.uid || "",
        user_name: userData?.nama_lengkap || "Unknown",
        target_path: paths.companyInvite(code),
        new_value: inviteData,
      });
      return `Kode undangan berhasil dibuat: ${code}`;
    };

    toast.promise(generateRequest(), {
        loading: 'Membuat kode...',
        success: (msg) => msg,
        error: (err) => `Gagal membuat kode: ${err.message}`
    });
  };

  const handleToggleInviteActive = async (inviteCode: string, companyId: string, currentActive: boolean) => {
    if (!ensureOwnerOnly("Hanya owner yang dapat menonaktifkan atau memulihkan kode undangan.")) return;

    requestConfirm(
      currentActive ? "Nonaktifkan Kode" : "Pulihkan Kode",
      currentActive ? "Nonaktifkan kode undangan ini?" : "Pulihkan kode undangan ini?",
      currentActive,
      () => {
        const toggleRequest = async () => {
          const updates = currentActive ? {
            active: false,
            deleted_at: Date.now(),
            deleted_by: userData?.uid || "",
            updated_at: Date.now()
          } : {
            active: true,
            deleted_at: null,
            deleted_by: null,
            updated_at: Date.now()
          };
          await update(ref(db, paths.companyInvite(inviteCode)), updates);
          await writeAuditLog(companyId, {
              action: currentActive ? "DEACTIVATE_MASTER_DATA" : "RESTORE_MASTER_DATA",
              details: `${currentActive ? 'Menonaktifkan' : 'Memulihkan'} kode undangan`,
              user_uid: userData?.uid || "",
              user_name: userData?.nama_lengkap || "Unknown",
              target_path: paths.companyInvite(inviteCode),
              new_value: updates,
          });
          return currentActive ? "Kode undangan dinonaktifkan" : "Kode undangan dipulihkan";
        };

        toast.promise(toggleRequest(), {
            loading: 'Memproses...',
            success: (msg) => msg,
            error: (err) => `Gagal update: ${err.message}`
        });
      }
    );
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-blue-500 font-medium">Memuat data perusahaan...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 p-4 rounded-lg">
        Gagal memuat data: {error}
      </div>
    );
  }

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
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Perusahaan</h1>
          <p className="text-sm text-slate-500">
            {isOwner ? "Kelola semua entitas perusahaan" : "Kelola profil, branding, undangan, dan pengaturan perusahaan Anda"}
          </p>
        </div>
        {isOwner ? (
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
          >
            + Tambah Perusahaan
          </button>
        ) : (
          <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
            Mode Admin Perusahaan: hanya mengelola perusahaan sendiri.
          </div>
        )}
      </div>

      {!isOwner && !adminCompanyId && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 p-4 rounded-lg text-sm">
          Akun admin ini belum terhubung ke perusahaan. Hubungi owner untuk assign admin ke perusahaan.
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        {companies.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            Belum ada data perusahaan.
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-6 py-3 font-medium">Nama Perusahaan</th>
                <th className="px-6 py-3 font-medium">Branding</th>
                <th className="px-6 py-3 font-medium">Website</th>
                <th className="px-6 py-3 font-medium">Admin PT</th>
                <th className="px-6 py-3 font-medium text-center">Status</th>
                <th className="px-6 py-3 font-medium text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {companies.map((company) => (
                <tr key={company.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                  <td className="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">{company.name}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center">
                        {company.company_logo_enabled && company.company_logo_url ? (
                          <img
                            src={company.company_logo_url}
                            alt={`Logo ${company.name}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xs font-black text-teal-600">MP</span>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {company.company_logo_enabled && company.company_logo_url ? "Logo aktif" : "Fallback MP"}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {company.company_logo_updated_at
                            ? new Date(company.company_logo_updated_at).toLocaleDateString("id-ID")
                            : "Belum diatur"}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {company.company_website_enabled && company.company_website_url ? (
                      <div className="flex flex-col">
                        <span className="px-2 py-0.5 rounded text-[10px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit">
                          AKTIF
                        </span>
                        <span className="text-xs text-slate-500 mt-1 max-w-[220px] truncate" title={company.company_website_url}>
                          {company.company_website_url}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500 italic">Belum diatur</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-800 dark:text-slate-200">
                    {company.admin_uid ? (
                        <span className="px-2 py-0.5 rounded text-[10px] border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">Ter-assign</span>
                    ) : (
                        <span className="text-slate-500 italic text-xs">Belum di assign</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {company.active ? (
                      <span className="px-2 py-0.5 rounded text-[10px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">AKTIF</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">NONAKTIF</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right space-x-3">
                    <button
                      onClick={() => {
                        if (!ensureCompanyAccess(company.id)) return;
                        openBrandingModal(company);
                      }}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 text-xs font-medium"
                    >
                      Branding
                    </button>
                    <button
                      onClick={() => {
                        if (!ensureCompanyAccess(company.id)) return;
                        openWebsiteModal(company);
                      }}
                      className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-300 text-xs font-medium"
                    >
                      Website
                    </button>
                    <button 
                      onClick={() => {
                        if (!ensureCompanyAccess(company.id)) return;
                        setEditingCompanyId(company.id!);
                        setNewCompanyName(company.name);
                        setShowModal(true);
                      }}
                      className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                    >
                      Edit 
                    </button>
                    <button 
                      onClick={() => {
                        if (!ensureCompanyAccess(company.id)) return;
                        generateInviteCode(company);
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium"
                    >
                      Gen Invite
                    </button>
                    {isOwner && (
                      <>
                        <button 
                          onClick={() => handleToggleActive(company.id!, company.active)}
                          className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium"
                        >
                          {company.active ? "Nonaktifkan" : "Pulihkan"}
                        </button>
                        <button 
                          onClick={() => handleDeleteCompany(company.id!)}
                          className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium"
                        >
                          Hapus
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isOwner && invites.length > 0 && (
        <div className="mt-4">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">Invite Codes Aktif</h2>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Kode</th>
                  <th className="px-6 py-3 font-medium">Perusahaan</th>
                  <th className="px-6 py-3 font-medium">Batas Waktu</th>
                  <th className="px-6 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {invites.map((invite: any) => (
                  <tr key={invite.code} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                    <td className="px-6 py-3 font-mono text-blue-600 dark:text-blue-400 font-bold">{invite.code} {!invite.active && <span className="text-red-500 text-xs ml-2">(Nonaktif)</span>}</td>
                    <td className="px-6 py-3">{invite.company_name}</td>
                    <td className="px-6 py-3 text-slate-500">{invite.expired_at ? new Date(invite.expired_at).toLocaleDateString() : "Tanpa Batas"}</td>
                    <td className="px-6 py-3 text-right">
                      <button 
                        onClick={() => handleToggleInviteActive(invite.code, invite.company_id, invite.active)}
                        className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium"
                      >
                        {invite.active ? "Nonaktifkan" : "Pulihkan"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (isOwner || editingCompanyId) && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                {editingCompanyId 
                  ? (isOwner ? "Edit Perusahaan" : "Edit Perusahaan Saya") 
                  : "Tambah Perusahaan"}
              </h3>
              <button onClick={() => { setShowModal(false); setEditingCompanyId(null); setNewCompanyName(""); }} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            <form onSubmit={handleCreateCompany} className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Nama Perusahaan</label>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                  placeholder="Misal: PT FAJAR MEKAR INDAH"
                  autoFocus
                  required
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingCompanyId(null); setNewCompanyName(""); }}
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
      {websiteModalCompany && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                  Website Perusahaan
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {websiteModalCompany.name}
                </p>
              </div>
              <button onClick={closeWebsiteModal} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveWebsiteConfig} className="p-6 space-y-4">
              <label className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <input
                  type="checkbox"
                  checked={websiteEnabled}
                  onChange={(e) => setWebsiteEnabled(e.target.checked)}
                />
                <div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Aktifkan website perusahaan di aplikasi Flutter
                  </div>
                  <div className="text-xs text-slate-500">
                    Jika aktif, menu Profil &gt; Website Perusahaan akan membuka URL ini.
                  </div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Judul Menu
                </label>
                <input
                  type="text"
                  value={websiteTitle}
                  onChange={(e) => setWebsiteTitle(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                  placeholder="Website Perusahaan"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  URL Website
                </label>
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                  placeholder="https://perusahaan.co.id"
                  required={websiteEnabled}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Wajib HTTPS. Domain utama otomatis dimasukkan ke daftar domain aman.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Domain yang Diizinkan
                </label>
                <textarea
                  value={websiteDomains}
                  onChange={(e) => setWebsiteDomains(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 font-mono text-xs"
                  placeholder={"perusahaan.co.id\nwww.perusahaan.co.id"}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Satu domain per baris atau pisahkan dengan koma. Link di luar domain ini akan diblokir oleh Flutter.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeWebsiteModal}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingWebsite}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  {savingWebsite ? "Menyimpan..." : "Simpan Website"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {brandingCompany && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">Branding Perusahaan</h3>
                <p className="text-xs text-slate-500 mt-1">{getCompanyDisplayName(brandingCompany)}</p>
              </div>
              <button onClick={closeBrandingModal} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>

            <form onSubmit={handleSaveBranding} className="p-6 space-y-5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-950">
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center shadow-sm">
                    {brandingLogoPreview ? (
                      <img src={brandingLogoPreview} alt="Preview logo" className="w-full h-full object-cover" />
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

              <label className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                <input type="checkbox" checked={brandingLogoEnabled} onChange={(e) => setBrandingLogoEnabled(e.target.checked)} />
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
                  onChange={(e) => handleBrandingLogoFileChange(e.target.files?.[0])}
                  className="w-full text-sm text-slate-700 dark:text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-teal-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-teal-500"
                />
              </div>

              <div className="flex justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDeleteCompanyLogo}
                  disabled={!brandingCompany.company_logo_url}
                  className="px-4 py-2 rounded text-sm font-medium text-red-600 dark:text-red-400 border border-red-500/30 disabled:opacity-40"
                >
                  Hapus Logo
                </button>

                <div className="flex gap-3">
                  <button type="button" onClick={closeBrandingModal} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700">
                    Batal
                  </button>
                  <button type="submit" disabled={savingBranding} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded text-sm font-medium disabled:opacity-50">
                    {savingBranding ? "Menyimpan..." : "Simpan Branding"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
