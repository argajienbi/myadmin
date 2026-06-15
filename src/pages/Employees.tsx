import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, update, get } from "firebase/database";
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { db, firebaseConfig } from "../firebase";
import { paths } from "../services/paths";
import { CompanyUser, Company, Area, Office, Department, SubDepartment, EmployeeGroup, Position } from "../types";
import { getFileUrl } from "../services/storageService";

import { createNotification } from "../services/notificationService";
import { writeAuditLog } from "../services/auditService";
import { mirrorUserToFirestore } from "../services/firestoreUserMirrorService";
import toast from "react-hot-toast";
import { ConfirmModal } from "../components/ConfirmModal";

const EmployeeAvatar: React.FC<{ emp: CompanyUser }> = ({ emp }) => {
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    let active = true;
    const fetchUrl = async () => {
      const source = emp.photo_url || emp.photo_path;
      if (source) {
        try {
          const resolvedUrl = await getFileUrl(source);
          if (active) setUrl(resolvedUrl);
        } catch (e) {
          console.error("Failed to load photo", e);
        }
      }
    };
    fetchUrl();
    return () => { active = false; };
  }, [emp.photo_url, emp.photo_path]);

  if (url) {
    return <img src={url} alt={emp.nama_lengkap} className="w-10 h-10 rounded-full object-cover shrink-0 bg-slate-100" />;
  }

  return (
    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">
      {emp.nama_lengkap ? emp.nama_lengkap.charAt(0).toUpperCase() : "?"}
    </div>
  );
};

export const Employees: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<CompanyUser[]>([]);
  
  // Org data for assignment
  const [areas, setAreas] = useState<Area[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"active" | "pending" | "inactive" | "rejected">("pending");
  const [error, setError] = useState("");

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<CompanyUser | null>(null);
  const [formData, setFormData] = useState<any>({});

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
       setEmployees([]);
       return;
    }

    setLoading(true);
    setError("");
    
    // Load Org Data
    get(ref(db, paths.areas(targetCompanyId))).then(s => setAreas(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));
    get(ref(db, paths.offices(targetCompanyId))).then(s => setOffices(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));
    get(ref(db, paths.departments(targetCompanyId))).then(s => setDepartments(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));
    get(ref(db, paths.subDepartments(targetCompanyId))).then(s => setSubDepartments(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));
    get(ref(db, paths.employeeGroups(targetCompanyId))).then(s => setGroups(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));
    get(ref(db, paths.scheduleAssignments(targetCompanyId))).then(s => setAssignments(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));

    const usersRef = ref(db, paths.companyUsers(targetCompanyId));
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
       if (snapshot.exists()) {
          const data = snapshot.val();
          const userList = Object.keys(data).map(key => ({...data[key], uid: key}));
          setEmployees(userList);
       } else {
          setEmployees([]);
       }
       setLoading(false);
    }, (err) => {
       setError("Error: " + err.message);
       setLoading(false);
       setEmployees([]);
    });

    return () => unsubscribe();
  }, [targetCompanyId]);

  function getEmployeeBadges(emp: any, currentAssignments: any[]) {
    const badges: { label: string; color: "green" | "yellow" | "red" | "blue" | "gray" }[] = [];

    if (emp.status_akun === "active") badges.push({ label: "Aktif", color: "green" });
    else if (emp.status_akun === "pending") badges.push({ label: "Pending", color: "yellow" });
    else badges.push({ label: "Nonaktif", color: "gray" });

    if (!emp.office_id) badges.push({ label: "Belum Ada Kantor", color: "red" });
    if (!emp.group_id) badges.push({ label: "Belum Ada Grup", color: "red" });

    const hasSchedule = currentAssignments.some((a) =>
      a.active !== false &&
      (
        (a.type === "user" && a.target_id === emp.uid) ||
        (a.type === "group" && a.target_id === emp.group_id)
      )
    );

    badges.push({
      label: hasSchedule ? "Jadwal Diterapkan" : "Belum Ada Jadwal",
      color: hasSchedule ? "blue" : "yellow",
    });

    return badges;
  }

  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormData, setAddFormData] = useState<any>({
     nama_lengkap: "", email: "", password: "",
     nip: "", no_hp: "", position: "",
     area_id: "", office_id: "", department_id: "", sub_department_id: "", group_id: "",
     photo_url: "", photo_path: ""
  });
  const [isAdding, setIsAdding] = useState(false);

  const handleUpdateStatus = async (uid: string, newStatus: string) => {
    if (!targetCompanyId || !uid) return;
    
    const updateRequest = async () => {
      const updates: any = {};
      updates[`${paths.companyUser(targetCompanyId, uid)}/status_akun`] = newStatus;
      updates[`${paths.userIndex(uid)}/status_akun`] = newStatus;
      
      if (newStatus === "active") {
        updates[`${paths.companyUser(targetCompanyId, uid)}/profile_completed`] = true;
      }
      
      await update(ref(db), updates);
      
      try {
        await mirrorUserToFirestore({
          uid,
          company_id: targetCompanyId,
          status_akun: newStatus
        });
      } catch (err) {
        console.warn('Failed mirroring user status to firestore', err);
      }
      
      // Audit log
      await writeAuditLog(targetCompanyId, {
          action: newStatus === "active" ? "ACTIVATE_USER" : (newStatus === "inactive" ? "INACTIVE_USER" : "REJECT_USER"),
          details: `Mengubah status user ${uid} menjadi ${newStatus}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: `${paths.companyUser(targetCompanyId, uid)}/status_akun`,
          new_value: newStatus
      });

      // Notification
      await createNotification(uid, {
          company_id: targetCompanyId,
          title: newStatus === "active" ? "Akun Anda Telah Aktif" : (newStatus === "rejected" ? "Pendaftaran Ditolak" : "Akun Dinonaktifkan"),
          message: newStatus === "active" ? "Selamat, akun Anda sudah dapat digunakan." : "Hubungi admin untuk info lebih lanjut.",
          type: newStatus === "active" ? "success" : "danger",
          ref_type: "user_status",
          ref_id: uid
      });
      return `Berhasil update status menjadi ${newStatus}`;
    };

    toast.promise(updateRequest(), {
      loading: 'Memproses...',
      success: (msg) => msg,
      error: (err) => `Gagal update: ${err.message}`
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp || !targetCompanyId) return;

    const saveRequest = async () => {
        const uid = editingEmp.uid;
        const updates: any = {};
        const now = Date.now();

        const cuPath = paths.companyUser(targetCompanyId, uid);
        const userPath = paths.userIndex(uid);

        const namaLengkap = String(formData.nama_lengkap || "").trim();
        const position = String(formData.position || "USER").trim();
        const statusAkun = String(formData.status_akun || "pending").trim();

        if (!namaLengkap) {
          throw new Error("Nama lengkap wajib diisi.");
        }

        // Field yang harus sinkron ke /users dan /company_users
        updates[`${cuPath}/nama_lengkap`] = namaLengkap;
        updates[`${userPath}/nama_lengkap`] = namaLengkap;

        updates[`${cuPath}/position`] = position;
        updates[`${userPath}/position`] = position;

        updates[`${cuPath}/status_akun`] = statusAkun;
        updates[`${userPath}/status_akun`] = statusAkun;

        updates[`${cuPath}/photo_url`] = formData.photo_url || "";
        updates[`${userPath}/photo_url`] = formData.photo_url || "";

        updates[`${cuPath}/photo_path`] = formData.photo_path || "";
        updates[`${userPath}/photo_path`] = formData.photo_path || "";

        updates[`${cuPath}/updated_at`] = now;
        updates[`${userPath}/updated_at`] = now;

        // Field khusus company_users
        updates[`${cuPath}/nip`] = formData.nip || "";
        updates[`${cuPath}/no_hp`] = formData.no_hp || "";
        updates[`${cuPath}/area_id`] = formData.area_id || "";
        updates[`${cuPath}/office_id`] = formData.office_id || "";
        updates[`${cuPath}/department_id`] = formData.department_id || "";
        updates[`${cuPath}/sub_department_id`] = formData.sub_department_id || "";
        updates[`${cuPath}/group_id`] = formData.group_id || "";

        // Default QR fields jika belum ada
        if ((editingEmp as any).qr_token === undefined) {
          updates[`${cuPath}/qr_token`] = "";
        }
        if ((editingEmp as any).qr_active === undefined) {
          updates[`${cuPath}/qr_active`] = false;
        }
        if ((editingEmp as any).qr_updated_at === undefined) {
          updates[`${cuPath}/qr_updated_at`] = 0;
        }

        await update(ref(db), updates);
        
        try {
          await mirrorUserToFirestore({
            uid: uid,
            company_id: targetCompanyId,
            role: "employee",
            status_akun: statusAkun,
            nama_lengkap: namaLengkap,
            position: position,
            email: editingEmp.email || "",
            nip: formData.nip || "",
            no_hp: formData.no_hp || "",
            area_id: formData.area_id || "",
            office_id: formData.office_id || "",
            department_id: formData.department_id || "",
            sub_department_id: formData.sub_department_id || "",
            group_id: formData.group_id || "",
            photo_url: formData.photo_url || "",
            photo_path: formData.photo_path || ""
          });
        } catch (mirrorErr) {
          console.warn('Failed to mirror user on edit', mirrorErr);
        }

        await writeAuditLog(targetCompanyId, {
          action: "UPDATE_USER",
          details: `Mengubah data karyawan ${uid}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: cuPath,
          new_value: {
            nama_lengkap: namaLengkap,
            nip: formData.nip || "",
            no_hp: formData.no_hp || "",
            position,
            status_akun: statusAkun,
            area_id: formData.area_id || "",
            office_id: formData.office_id || "",
            department_id: formData.department_id || "",
            sub_department_id: formData.sub_department_id || "",
            group_id: formData.group_id || "",
          },
        });

        return "Berhasil menyimpan data karyawan";
    };

    toast.promise(saveRequest(), {
        loading: 'Menyimpan...',
        success: (msg) => {
            setShowEditModal(false);
            return msg;
        },
        error: (err) => `Gagal menyimpan data karyawan: ${err.message}`
    });
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCompanyId || !addFormData.email || !addFormData.password || !addFormData.nama_lengkap) {
        toast.error("Email, password, dan nama lengkap wajib diisi.");
        return;
    }
    
    setIsAdding(true);
    
    const addRequest = async () => {
        // Create secondary app to register user without logging out admin
        const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp" + Date.now());
        const secondaryAuth = getAuth(secondaryApp);
        
        const userCredential = await createUserWithEmailAndPassword(
            secondaryAuth,
            addFormData.email,
            addFormData.password
        );
        
        const newUid = userCredential.user.uid;
        await secondaryAuth.signOut(); // optional
        
        const updates: any = {};
        const now = Date.now();
        
        // Setup User Index
        updates[`${paths.userIndex(newUid)}`] = {
            uid: newUid,
            company_id: targetCompanyId,
            role: "user",
            position: addFormData.position || "USER",
            status_akun: "active",
            email: addFormData.email,
            nama_lengkap: addFormData.nama_lengkap,
            photo_url: addFormData.photo_url || "",
            photo_path: addFormData.photo_path || "",
            created_at: now,
            updated_at: now
        };
        
        // Setup Company User
        updates[`${paths.companyUser(targetCompanyId, newUid)}`] = {
            uid: newUid,
            company_id: targetCompanyId,
            role: "user",
            position: addFormData.position || "USER",
            status_akun: "active",
            email: addFormData.email,
            nama_lengkap: addFormData.nama_lengkap,
            nip: addFormData.nip || "",
            no_hp: addFormData.no_hp || "",
            area_id: addFormData.area_id || "",
            office_id: addFormData.office_id || "",
            department_id: addFormData.department_id || "",
            sub_department_id: addFormData.sub_department_id || "",
            group_id: addFormData.group_id || "",
            profile_completed: true,
            photo_url: addFormData.photo_url || "",
            photo_path: addFormData.photo_path || "",
            qr_token: "",
            qr_active: false,
            qr_updated_at: 0,
            face_registered: false,
            face_registered_at: null,
            device_id: null,
            device_name: null,
            created_at: now,
            updated_at: now
        };
        
        await update(ref(db), updates);
        
        try {
          await mirrorUserToFirestore({
            uid: newUid,
            company_id: targetCompanyId,
            role: "user",
            position: addFormData.position || "USER",
            status_akun: "active",
            email: addFormData.email,
            nama_lengkap: addFormData.nama_lengkap,
            nip: addFormData.nip || "",
            no_hp: addFormData.no_hp || "",
            area_id: addFormData.area_id || "",
            office_id: addFormData.office_id || "",
            department_id: addFormData.department_id || "",
            sub_department_id: addFormData.sub_department_id || "",
            group_id: addFormData.group_id || "",
            photo_url: addFormData.photo_url || "",
            photo_path: addFormData.photo_path || ""
          });
        } catch (mirrorErr) {
            console.warn('Failed to mirror added user', mirrorErr);
        }

        return "Berhasil menambahkan karyawan!";
    };

    toast.promise(addRequest(), {
        loading: 'Menyimpan...',
        success: (msg) => {
            setShowAddModal(false);
            setAddFormData({
                 nama_lengkap: "", email: "", password: "",
                 nip: "", no_hp: "", position: "",
                 area_id: "", office_id: "", department_id: "", sub_department_id: "", group_id: "",
                 photo_url: "", photo_path: ""
            });
            return msg;
        },
        error: (err) => `Gagal menambahkan karyawan: ${err.message}`
    }).finally(() => {
        setIsAdding(false);
    });
  };

  const handleResetFace = async (uid: string) => {
      if (!targetCompanyId || !uid) return;
      
      requestConfirm(
          "Reset Data Wajah",
          "Yakin ingin menghapus data wajah karyawan ini? Karyawan harus mendaftar wajah lagi saat absensi berikutnya.",
          true,
          () => {
              const resetRequest = async () => {
          const updates: any = {};
          updates[`${paths.companyUser(targetCompanyId, uid)}/face_registered`] = false;
          updates[`${paths.companyUser(targetCompanyId, uid)}/face_registered_at`] = null;
          // Nullify face descriptor arrays on root if applicable, depending on implementation
          updates[`companies/${targetCompanyId}/face_descriptors/${uid}`] = null;
          
          await update(ref(db), updates);

          await writeAuditLog(targetCompanyId, {
              action: "RESET_FACE_DATA",
              details: `Menghapus data wajah karyawan ${uid}`,
              user_uid: userData?.uid || "",
              user_name: userData?.nama_lengkap || "Unknown",
              target_path: paths.companyUser(targetCompanyId, uid)
          });
          
          await createNotification(uid, {
             company_id: targetCompanyId,
             title: "Pendaftaran Wajah Ulang Diperlukan",
             message: "Data wajah Anda telah di-reset oleh admin. Harap mendaftar ulang wajah sebelum absensi berikutnya.",
             type: "warning",
             ref_type: "face_reset",
             ref_id: uid
          });
          return "Berhasil menghapus data wajah.";
      };

      toast.promise(resetRequest(), {
          loading: 'Memproses...',
          success: (msg) => msg,
          error: (err) => `Gagal menghapus data wajah: ${err.message}`
      });
    }
  );
};

const handleResetDevice = async (uid: string) => {
      if (!targetCompanyId || !uid) return;
      
      requestConfirm(
          "Reset Perangkat",
          "Yakin ingin mereset data perangkat karyawan ini?",
          true,
          () => {
              const resetRequest = async () => {
          const updates: any = {};
          updates[`${paths.companyUser(targetCompanyId, uid)}/device_id`] = null;
          updates[`${paths.companyUser(targetCompanyId, uid)}/device_name`] = null;
          
          await update(ref(db), updates);

          await writeAuditLog(targetCompanyId, {
              action: "RESET_DEVICE_DATA",
              details: `Mereset device karyawan ${uid}`,
              user_uid: userData?.uid || "",
              user_name: userData?.nama_lengkap || "Unknown",
              target_path: paths.companyUser(targetCompanyId, uid)
          });
          return "Berhasil reset data perangkat.";
      };

      toast.promise(resetRequest(), {
          loading: 'Memproses...',
          success: (msg) => msg,
          error: (err) => `Gagal mereset perangkat: ${err.message}`
      });
    }
  );
};

const filteredEmployees = employees.filter(emp => emp.status_akun === activeTab);

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
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Karyawan</h1>
          <p className="text-sm text-slate-500">Direktori Karyawan & Aktivasi Akun</p>
        </div>
        {targetCompanyId && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors border border-blue-500"
          >
            + Tambah Karyawan
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
        <div className="p-8 text-center text-blue-500">Memuat data karyawan...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : (
        <>
          <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800 pb-2">
            {[
              { id: "active", label: "Aktif" },
              { id: "pending", label: "Pending Aktivasi" },
              { id: "inactive", label: "Nonaktif" },
              { id: "rejected", label: "Ditolak" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id 
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500" 
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 p-4 rounded-lg text-sm italic">
              Diagnosis: {error}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {filteredEmployees.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                Tidak ada karyawan dengan status {activeTab}.
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <tr>
                    <th className="px-6 py-3 font-medium">Nama/Email</th>
                    <th className="px-6 py-3 font-medium">Struktur Organisasi</th>
                    <th className="px-6 py-3 font-medium">Aksi/Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.uid} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <EmployeeAvatar emp={emp} />
                          <div>
                            <div className="font-medium text-slate-800 dark:text-slate-200">{emp.nama_lengkap}</div>
                            <div className="text-xs text-slate-500">{emp.email} {emp.nip && `• ${emp.nip}`}</div>
                            <div className="flex flex-wrap gap-2 items-center mt-1">
                                <span className="text-[10px] bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5 inline-block font-mono text-slate-600 dark:text-slate-400 uppercase tracking-widest">{emp.position || "TANPA POSISI"}</span>
                                {emp.face_registered ? (
                                    <span className="text-[10px] border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded px-1.5 py-0.5 inline-block font-mono uppercase">Wajah Terdaftar</span>
                                ) : (
                                    <span className="text-[10px] border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded px-1.5 py-0.5 inline-block font-mono uppercase">Wajah Kosong</span>
                                )}
                                {emp.qr_active && (
                                    <span className="text-[10px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded px-1.5 py-0.5 inline-block font-mono uppercase">QR Aktif</span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                                {getEmployeeBadges(emp, assignments).map((b, i) => (
                                    <span key={i} className={`text-[10px] border rounded px-1.5 py-0.5 inline-block uppercase font-bold
                                      ${b.color === 'green' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 
                                        b.color === 'yellow' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30' : 
                                        b.color === 'red' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30' : 
                                        b.color === 'blue' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30' :
                                        'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
                                      }
                                    `}>
                                      {b.label}
                                    </span>
                                ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {emp.office_id ? (
                           <div className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
                              <div><span className="opacity-50">Kantor:</span> {offices.find(o => o.id === emp.office_id)?.name || "Kantor tidak ditemukan"}</div>
                              {emp.department_id && <div><span className="opacity-50">Dept:</span> {departments.find(d => d.id === emp.department_id)?.name || "Departemen tidak ditemukan"}</div>}
                              {emp.sub_department_id && <div><span className="opacity-50">Sub-Dept:</span> {subDepartments.find(s => s.id === emp.sub_department_id)?.name || "Sub-Departemen tidak ditemukan"}</div>}
                              {emp.group_id && <div><span className="opacity-50">Grup Karyawan:</span> {groups.find(g => g.id === emp.group_id)?.name || "Grup tidak ditemukan"}</div>}
                           </div>
                        ) : (
                            <span className="text-xs text-slate-600 italic">Belum di-assign</span>
                        )}
                      </td>
                      <td className="px-6 py-4 space-x-3">
                        <button 
                            onClick={() => {
                                setEditingEmp(emp);
                                setFormData({
                                    nama_lengkap: emp.nama_lengkap || "",
                                    nip: emp.nip || "",
                                    no_hp: emp.no_hp || "",
                                    position: emp.position || "",
                                    status_akun: emp.status_akun || "pending",
                                    area_id: emp.area_id || "",
                                    office_id: emp.office_id || "",
                                    department_id: emp.department_id || "",
                                    sub_department_id: emp.sub_department_id || "",
                                    group_id: emp.group_id || "",
                                    photo_url: emp.photo_url || "",
                                    photo_path: emp.photo_path || "",
                                });
                                setShowEditModal(true);
                            }}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-300 text-xs font-medium bg-blue-500/10 px-2 py-1 rounded"
                        >
                            Edit
                        </button>
                        
                        {activeTab === "pending" && (
                          <>
                            <button 
                              onClick={() => handleUpdateStatus(emp.uid, "active")}
                              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                            >
                              Pulihkan
                            </button>
                            <button 
                              onClick={() => handleUpdateStatus(emp.uid, "rejected")}
                              className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium"
                            >
                              Tolak
                            </button>
                          </>
                        )}
                        {activeTab === "active" && (
                          <>
                            <button 
                              onClick={() => handleUpdateStatus(emp.uid, "inactive")}
                              className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium"
                            >
                              Nonaktifkan
                            </button>
                            {emp.face_registered && (
                                <button 
                                  onClick={() => handleResetFace(emp.uid)}
                                  className="text-amber-600 dark:text-amber-400 hover:text-amber-300 text-xs font-medium"
                                >
                                  Reset Wajah
                                </button>
                            )}
                            <button 
                              onClick={() => handleResetDevice(emp.uid)}
                              className="text-amber-600 dark:text-amber-400 hover:text-amber-300 text-xs font-medium"
                            >
                              Reset Device
                            </button>
                          </>
                        )}
                        {(activeTab === "inactive" || activeTab === "rejected") && (
                          <button 
                            onClick={() => handleUpdateStatus(emp.uid, "active")}
                            className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-300 text-xs font-medium"
                          >
                            Pulihkan
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showEditModal && editingEmp && (
          <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">Edit Karyawan</h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="text-sm text-blue-600 dark:text-blue-400 font-bold mb-4">{editingEmp.email}</div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={formData.nama_lengkap || ""}
                  onChange={(e) => setFormData({ ...formData, nama_lengkap: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  NIP / ID Karyawan
                </label>
                <input
                  type="text"
                  value={formData.nip || ""}
                  onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  No HP
                </label>
                <input
                  type="text"
                  value={formData.no_hp || ""}
                  onChange={(e) => setFormData({ ...formData, no_hp: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Status Akun
                </label>
                <select
                  value={formData.status_akun || "pending"}
                  onChange={(e) => setFormData({ ...formData, status_akun: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                >
                  <option value="pending">Pending</option>
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                  <option value="rejected">Ditolak</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Posisi / Jabatan</label>
                <select value={formData.position || ""} onChange={e => setFormData({...formData, position: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Pilih Posisi --</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SPV">SPV</option>
                  <option value="LEADER">LEADER</option>
                  <option value="CREW">CREW</option>
                  <option value="USER">USER</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Area</label>
                <select value={formData.area_id || ""} onChange={e => setFormData({...formData, area_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Office</label>
                <select value={formData.office_id || ""} onChange={e => setFormData({...formData, office_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Department</label>
                <select value={formData.department_id || ""} onChange={e => setFormData({...formData, department_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Sub Department
                </label>
                <select
                  value={formData.sub_department_id || ""}
                  onChange={(e) => setFormData({ ...formData, sub_department_id: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                >
                  <option value="">-- Kosong --</option>
                  {subDepartments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Employee Group</label>
                <select value={formData.group_id || ""} onChange={e => setFormData({...formData, group_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => { setShowEditModal(false); setFormData({}); setEditingEmp(null); }} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700">Batal</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-md my-auto">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">Tambah Karyawan Manual</h3>
              <button disabled={isAdding} onClick={() => setShowAddModal(false)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            <form onSubmit={handleAddEmployee} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Nama Lengkap *</label>
                <input required type="text" value={addFormData.nama_lengkap} onChange={e => setAddFormData({...addFormData, nama_lengkap: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" placeholder="Contoh: Budi Santoso" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Email Karyawan *</label>
                <input required type="email" value={addFormData.email} onChange={e => setAddFormData({...addFormData, email: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" placeholder="budi@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Password Sementara *</label>
                <input required type="password" minLength={6} value={addFormData.password} onChange={e => setAddFormData({...addFormData, password: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" placeholder="(minimal 6 karakter)" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">NIP (Opsional)</label>
                <input type="text" value={addFormData.nip} onChange={e => setAddFormData({...addFormData, nip: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" placeholder="Contoh: EMP-123" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Nomor HP (Opsional)</label>
                <input type="text" value={addFormData.no_hp} onChange={e => setAddFormData({...addFormData, no_hp: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" placeholder="Contoh: 0812..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Posisi / Jabatan</label>
                <select value={addFormData.position || ""} onChange={e => setAddFormData({...addFormData, position: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Pilih Posisi --</option>
                  <option value="MANAGER">MANAGER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SPV">SPV</option>
                  <option value="LEADER">LEADER</option>
                  <option value="CREW">CREW</option>
                  <option value="USER">USER</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Office</label>
                <select value={addFormData.office_id || ""} onChange={e => setAddFormData({...addFormData, office_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Department</label>
                <select value={addFormData.department_id || ""} onChange={e => setAddFormData({...addFormData, department_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                  Sub Department
                </label>
                <select
                  value={addFormData.sub_department_id || ""}
                  onChange={(e) =>
                    setAddFormData({ ...addFormData, sub_department_id: e.target.value })
                  }
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                >
                  <option value="">-- Kosong --</option>
                  {subDepartments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Employee Group</label>
                <select value={addFormData.group_id || ""} onChange={e => setAddFormData({...addFormData, group_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                  <option value="">-- Kosong --</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 relative z-10 bg-white dark:bg-slate-900 pb-2">
                <button disabled={isAdding} type="button" onClick={() => { setShowAddModal(false); setAddFormData({}); }} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700 disabled:opacity-50">Batal</button>
                <button disabled={isAdding} type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                  {isAdding ? "Memproses..." : "Simpan Karyawan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
