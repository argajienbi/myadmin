import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, update, get, push } from "firebase/database";
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
import { getEffectiveCompanyId, isOwnerLike } from "../utils/roleAccess";

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

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferEmp, setTransferEmp] = useState<CompanyUser | null>(null);
  const [transferFormData, setTransferFormData] = useState<any>({
    area_id: "",
    office_id: "",
    department_id: "",
    sub_department_id: "",
    group_id: "",
    effective_date: new Date().toISOString().split("T")[0],
    reason: "",
  });

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

  const isOwner = isOwnerLike(userData);

  useEffect(() => {
    if (!userData) {
      setLoading(false);
      return;
    }

    if (isOwner) {
      get(ref(db, paths.companies()))
        .then((snapshot) => {
          const data = snapshot.exists() ? snapshot.val() : {};
          const compList = Object.keys(data).map(k => ({ ...data[k], id: k }));
          setCompanies(compList);

          const savedCompanyId = localStorage.getItem("admin_selected_company") || "";
          const resolvedCompanyId =
            savedCompanyId && compList.some((item: any) => item.id === savedCompanyId)
              ? savedCompanyId
              : userData.company_id && compList.some((item: any) => item.id === userData.company_id)
                ? userData.company_id
                : compList[0]?.id || "";

          setTargetCompanyId(resolvedCompanyId);

          if (resolvedCompanyId) {
            localStorage.setItem("admin_selected_company", resolvedCompanyId);
          }
        })
        .finally(() => setLoading(false));

      return;
    }

    setTargetCompanyId(getEffectiveCompanyId(userData));
    setLoading(false);
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

  const isActiveRecord = (item: any) => item?.active !== false && item?.status !== "inactive";

  const getAreaName = (id?: string) =>
    areas.find((item: any) => item.id === id)?.name || "";

  const getOfficeName = (id?: string) =>
    offices.find((item: any) => item.id === id)?.name || "";

  const getDepartmentName = (id?: string) =>
    departments.find((item: any) => item.id === id)?.name || "";

  const getSubDepartmentName = (id?: string) =>
    subDepartments.find((item: any) => item.id === id)?.name || "";

  const getGroupName = (id?: string) =>
    groups.find((item: any) => item.id === id)?.name || "";

  const getActiveOfficesForArea = (areaId: string) =>
    offices.filter((item: any) => item.area_id === areaId && isActiveRecord(item));

  const getActiveDepartmentsForOffice = (officeId: string) =>
    departments.filter((item: any) => item.office_id === officeId && isActiveRecord(item));

  const getActiveSubDepartmentsForDepartment = (departmentId: string) =>
    subDepartments.filter((item: any) => item.department_id === departmentId && isActiveRecord(item));

  const getActiveGroupsForTarget = (officeId: string, departmentId: string, subDepartmentId = "") =>
    groups.filter((item: any) => {
      if (!isActiveRecord(item)) return false;
      if (officeId && item.office_id !== officeId) return false;
      if (departmentId && item.department_id !== departmentId) return false;

      if (subDepartmentId && item.sub_department_id && item.sub_department_id !== subDepartmentId) return false;

      return true;
    });

  const getTransferSchedulePreview = (employee: CompanyUser, newGroupId: string) => {
    const individualAssignments = assignments.filter((item: any) => {
      if (!isActiveRecord(item)) return false;
      const type = String(item.type || item.target_type || "").toLowerCase();
      return type === "user" && item.target_id === employee.uid;
    });

    const newGroupAssignments = assignments.filter((item: any) => {
      if (!isActiveRecord(item)) return false;
      const type = String(item.type || item.target_type || "").toLowerCase();
      return type === "group" && item.target_id === newGroupId;
    });

    let scheduleWarning = "";

    if (individualAssignments.length > 0) {
      scheduleWarning = "Karyawan memiliki jadwal individual aktif. Jadwal individual biasanya tetap menjadi prioritas walaupun grup berubah.";
    } else if (newGroupId && newGroupAssignments.length === 0) {
      scheduleWarning = "Grup tujuan belum memiliki penerapan jadwal aktif. Karyawan bisa tidak memiliki jadwal setelah transfer.";
    } else if (!newGroupId) {
      scheduleWarning = "Grup tujuan belum dipilih. Karyawan bisa tidak memiliki jadwal grup.";
    }

    return {
      individualAssignmentCount: individualAssignments.length,
      newGroupAssignmentCount: newGroupAssignments.length,
      scheduleWarning,
    };
  };

  const buildTransferPreviewMessage = () => {
    if (!transferEmp) return "";

    const preview = getTransferSchedulePreview(transferEmp, transferFormData.group_id || "");

    return [
      `Karyawan: ${transferEmp.nama_lengkap || transferEmp.email || transferEmp.uid}`,
      "",
      "Struktur lama:",
      `Area: ${getAreaName(transferEmp.area_id) || "-"}`,
      `Kantor: ${getOfficeName(transferEmp.office_id) || "-"}`,
      `Departemen: ${getDepartmentName(transferEmp.department_id) || "-"}`,
      `Grup: ${getGroupName(transferEmp.group_id) || "-"}`,
      "",
      "Struktur baru:",
      `Area: ${getAreaName(transferFormData.area_id) || "-"}`,
      `Kantor: ${getOfficeName(transferFormData.office_id) || "-"}`,
      `Departemen: ${getDepartmentName(transferFormData.department_id) || "-"}`,
      `Grup: ${getGroupName(transferFormData.group_id) || "-"}`,
      "",
      `Tanggal efektif: ${transferFormData.effective_date || "-"}`,
      `Alasan: ${transferFormData.reason || "-"}`,
      "",
      `Jadwal individual aktif: ${preview.individualAssignmentCount}`,
      `Jadwal grup tujuan aktif: ${preview.newGroupAssignmentCount}`,
      preview.scheduleWarning ? `Peringatan: ${preview.scheduleWarning}` : "",
      "",
      "Notifikasi akan dikirim ke karyawan.",
      "Karyawan perlu membuka ulang aplikasi agar lokasi/radius presensi terbaru dipakai.",
    ].filter(Boolean).join("\n");
  };

  const openTransferModal = (emp: CompanyUser) => {
    setTransferEmp(emp);
    setTransferFormData({
      area_id: emp.area_id || "",
      office_id: emp.office_id || "",
      department_id: emp.department_id || "",
      sub_department_id: emp.sub_department_id || "",
      group_id: emp.group_id || "",
      effective_date: new Date().toISOString().split("T")[0],
      reason: "",
    });
    setShowTransferModal(true);
  };

  const validateTransferForm = () => {
    if (!transferEmp) throw new Error("Data karyawan belum dipilih.");

    const areaId = String(transferFormData.area_id || "");
    const officeId = String(transferFormData.office_id || "");
    const departmentId = String(transferFormData.department_id || "");
    const subDepartmentId = String(transferFormData.sub_department_id || "");
    const groupId = String(transferFormData.group_id || "");

    if (!areaId) throw new Error("Area tujuan wajib dipilih.");
    if (!officeId) throw new Error("Kantor tujuan wajib dipilih.");
    if (!departmentId) throw new Error("Departemen tujuan wajib dipilih.");
    if (!groupId) throw new Error("Grup karyawan tujuan wajib dipilih.");
    if (!transferFormData.effective_date) throw new Error("Tanggal efektif wajib diisi.");
    if (!String(transferFormData.reason || "").trim()) throw new Error("Alasan transfer wajib diisi.");

    const area = areas.find((item: any) => item.id === areaId);
    if (!area || !isActiveRecord(area)) throw new Error("Area tujuan tidak aktif atau tidak ditemukan.");

    const office = offices.find((item: any) => item.id === officeId);
    if (!office || !isActiveRecord(office)) throw new Error("Kantor tujuan tidak aktif atau tidak ditemukan.");
    if (office.area_id !== areaId) throw new Error("Kantor tujuan tidak berada di area yang dipilih.");

    const department = departments.find((item: any) => item.id === departmentId);
    if (!department || !isActiveRecord(department)) throw new Error("Departemen tujuan tidak aktif atau tidak ditemukan.");
    if (department.office_id !== officeId) throw new Error("Departemen tujuan tidak berada di kantor yang dipilih.");

    if (subDepartmentId) {
      const subDepartment = subDepartments.find((item: any) => item.id === subDepartmentId);
      if (!subDepartment || !isActiveRecord(subDepartment)) throw new Error("Sub departemen tujuan tidak aktif atau tidak ditemukan.");
      if (subDepartment.department_id !== departmentId) throw new Error("Sub departemen tujuan tidak berada di departemen yang dipilih.");
    }

    const group = groups.find((item: any) => item.id === groupId);
    if (!group || !isActiveRecord(group)) throw new Error("Grup tujuan tidak aktif atau tidak ditemukan.");
    if (group.office_id !== officeId) throw new Error("Grup tujuan tidak berada di kantor yang dipilih.");
    if (group.department_id !== departmentId) throw new Error("Grup tujuan tidak berada di departemen yang dipilih.");

    const noChange =
      areaId === (transferEmp.area_id || "") &&
      officeId === (transferEmp.office_id || "") &&
      departmentId === (transferEmp.department_id || "") &&
      subDepartmentId === (transferEmp.sub_department_id || "") &&
      groupId === (transferEmp.group_id || "");

    if (noChange) {
      throw new Error("Struktur tujuan sama dengan struktur saat ini. Tidak ada yang ditransfer.");
    }
  };

  const handleTransferEmployee = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!targetCompanyId || !transferEmp) return;

    const submitTransfer = async () => {
      validateTransferForm();

      const uid = transferEmp.uid;
      const now = Date.now();
      const newTransferRef = push(ref(db, paths.employeeTransferLogs(targetCompanyId)));
      const transferId = newTransferRef.key;

      if (!transferId) throw new Error("Gagal membuat ID transfer.");

      const effectiveDate = String(transferFormData.effective_date || "");
      const reason = String(transferFormData.reason || "").trim();

      const schedulePreview = getTransferSchedulePreview(transferEmp, transferFormData.group_id || "");

      const transferLog = {
        id: transferId,
        company_id: targetCompanyId,
        uid,
        employee_name: transferEmp.nama_lengkap || "",
        employee_email: transferEmp.email || "",

        old_area_id: transferEmp.area_id || "",
        old_office_id: transferEmp.office_id || "",
        old_department_id: transferEmp.department_id || "",
        old_sub_department_id: transferEmp.sub_department_id || "",
        old_group_id: transferEmp.group_id || "",

        old_area_name: getAreaName(transferEmp.area_id),
        old_office_name: getOfficeName(transferEmp.office_id),
        old_department_name: getDepartmentName(transferEmp.department_id),
        old_sub_department_name: getSubDepartmentName(transferEmp.sub_department_id),
        old_group_name: getGroupName(transferEmp.group_id),

        new_area_id: transferFormData.area_id || "",
        new_office_id: transferFormData.office_id || "",
        new_department_id: transferFormData.department_id || "",
        new_sub_department_id: transferFormData.sub_department_id || "",
        new_group_id: transferFormData.group_id || "",

        new_area_name: getAreaName(transferFormData.area_id),
        new_office_name: getOfficeName(transferFormData.office_id),
        new_department_name: getDepartmentName(transferFormData.department_id),
        new_sub_department_name: getSubDepartmentName(transferFormData.sub_department_id),
        new_group_name: getGroupName(transferFormData.group_id),

        effective_date: effectiveDate,
        reason,
        status: "completed",

        schedule_warning: schedulePreview.scheduleWarning,
        individual_assignment_count: schedulePreview.individualAssignmentCount,
        new_group_assignment_count: schedulePreview.newGroupAssignmentCount,

        created_by: userData?.uid || "",
        created_by_name: userData?.nama_lengkap || "Unknown",
        created_at: now,
        updated_at: now,
      };

      const cuPath = paths.companyUser(targetCompanyId, uid);
      const updates: any = {};

      updates[paths.employeeTransferLog(targetCompanyId, transferId)] = transferLog;

      updates[`${cuPath}/area_id`] = transferFormData.area_id || "";
      updates[`${cuPath}/office_id`] = transferFormData.office_id || "";
      updates[`${cuPath}/department_id`] = transferFormData.department_id || "";
      updates[`${cuPath}/sub_department_id`] = transferFormData.sub_department_id || "";
      updates[`${cuPath}/group_id`] = transferFormData.group_id || "";
      updates[`${cuPath}/last_transfer_id`] = transferId;
      updates[`${cuPath}/last_transfer_at`] = now;
      updates[`${cuPath}/last_transfer_reason`] = reason;
      updates[`${cuPath}/updated_at`] = now;
      updates[`${cuPath}/updated_by`] = userData?.uid || "";
      updates[`${cuPath}/updated_by_name`] = userData?.nama_lengkap || "";

      await update(ref(db), updates);

      try {
        await mirrorUserToFirestore({
          uid,
          company_id: targetCompanyId,
          role: transferEmp.role || "user",
          status_akun: transferEmp.status_akun || "active",
          nama_lengkap: transferEmp.nama_lengkap || "",
          position: transferEmp.position || "USER",
          email: transferEmp.email || "",
          nip: transferEmp.nip || "",
          no_hp: transferEmp.no_hp || "",
          area_id: transferFormData.area_id || "",
          office_id: transferFormData.office_id || "",
          department_id: transferFormData.department_id || "",
          sub_department_id: transferFormData.sub_department_id || "",
          group_id: transferFormData.group_id || "",
          photo_url: transferEmp.photo_url || "",
          photo_path: transferEmp.photo_path || "",
        });
      } catch (mirrorErr) {
        console.warn("Failed to mirror transferred user", mirrorErr);
      }

      await writeAuditLog(targetCompanyId, {
        action: "TRANSFER_EMPLOYEE",
        details: `Transfer karyawan ${transferEmp.nama_lengkap || uid} ke ${getOfficeName(transferFormData.office_id) || "kantor baru"}`,
        user_uid: userData?.uid || "",
        user_name: userData?.nama_lengkap || "Unknown",
        target_path: cuPath,
        old_value: {
          area_id: transferEmp.area_id || "",
          office_id: transferEmp.office_id || "",
          department_id: transferEmp.department_id || "",
          sub_department_id: transferEmp.sub_department_id || "",
          group_id: transferEmp.group_id || "",
        },
        new_value: {
          area_id: transferFormData.area_id || "",
          office_id: transferFormData.office_id || "",
          department_id: transferFormData.department_id || "",
          sub_department_id: transferFormData.sub_department_id || "",
          group_id: transferFormData.group_id || "",
          transfer_id: transferId,
          reason,
          effective_date: effectiveDate,
        },
      });

      await createNotification(uid, {
        company_id: targetCompanyId,
        title: "Lokasi Kerja Diperbarui",
        message: `Anda dipindahkan ke ${getOfficeName(transferFormData.office_id) || "kantor/area baru"}. Buka ulang aplikasi agar jadwal dan radius presensi diperbarui.`,
        type: "info",
        ref_type: "employee_transfer",
        ref_id: transferId,
        data: {
          transfer_id: transferId,
          effective_date: effectiveDate,
          new_area_id: transferFormData.area_id || "",
          new_office_id: transferFormData.office_id || "",
          new_department_id: transferFormData.department_id || "",
          new_group_id: transferFormData.group_id || "",
        },
      });

      return "Transfer karyawan berhasil disimpan.";
    };

    requestConfirm(
      "Konfirmasi Transfer Karyawan",
      buildTransferPreviewMessage(),
      false,
      () => {
        toast.promise(submitTransfer(), {
          loading: "Memproses transfer...",
          success: (msg) => {
            setShowTransferModal(false);
            setTransferEmp(null);
            setTransferFormData({
              area_id: "",
              office_id: "",
              department_id: "",
              sub_department_id: "",
              group_id: "",
              effective_date: new Date().toISOString().split("T")[0],
              reason: "",
            });
            return msg;
          },
          error: (err) => `Gagal transfer karyawan: ${err.message}`,
        });
      }
    );
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
                              onClick={() => openTransferModal(emp)}
                              className="text-purple-600 dark:text-purple-400 hover:text-purple-300 text-xs font-medium bg-purple-500/10 px-2 py-1 rounded inline-flex items-center"
                            >
                              Transfer
                            </button>
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

      {showTransferModal && transferEmp && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-lg my-auto">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">Transfer Struktur Karyawan</h3>
              <button onClick={() => { setShowTransferModal(false); setTransferEmp(null); }} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            
            <form onSubmit={handleTransferEmployee} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-xs space-y-1">
                <div className="font-semibold text-slate-700 dark:text-slate-300 text-sm mb-2">Informasi Karyawan</div>
                <div><span className="text-slate-500">Nama:</span> <span className="font-medium text-slate-800 dark:text-slate-200">{transferEmp.nama_lengkap || "-"}</span></div>
                <div><span className="text-slate-500">Email:</span> <span className="text-slate-800 dark:text-slate-200">{transferEmp.email || "-"}</span></div>
                <div><span className="text-slate-500">NIP:</span> <span className="text-slate-800 dark:text-slate-200">{transferEmp.nip || "-"}</span></div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                  <span className="text-slate-500 font-medium">Struktur Saat Ini:</span>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div><span className="text-slate-400">Area:</span> {getAreaName(transferEmp.area_id) || "-"}</div>
                    <div><span className="text-slate-400">Kantor:</span> {getOfficeName(transferEmp.office_id) || "-"}</div>
                    <div><span className="text-slate-400">Dept:</span> {getDepartmentName(transferEmp.department_id) || "-"}</div>
                    <div><span className="text-slate-400">Grup:</span> {getGroupName(transferEmp.group_id) || "-"}</div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Pilih Area Tujuan *</label>
                <select 
                  required 
                  value={transferFormData.area_id || ""} 
                  onChange={e => {
                    const val = e.target.value;
                    setTransferFormData({
                      ...transferFormData,
                      area_id: val,
                      office_id: "",
                      department_id: "",
                      sub_department_id: "",
                      group_id: ""
                    });
                  }} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                >
                  <option value="">-- Pilih Area --</option>
                  {areas.filter(a => isActiveRecord(a)).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Pilih Kantor Tujuan *</label>
                <select 
                  required 
                  disabled={!transferFormData.area_id}
                  value={transferFormData.office_id || ""} 
                  onChange={e => {
                    const val = e.target.value;
                    setTransferFormData({
                      ...transferFormData,
                      office_id: val,
                      department_id: "",
                      sub_department_id: "",
                      group_id: ""
                    });
                  }} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm disabled:opacity-50"
                >
                  <option value="">-- Pilih Kantor --</option>
                  {getActiveOfficesForArea(transferFormData.area_id).map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Pilih Departemen Tujuan *</label>
                <select 
                  required 
                  disabled={!transferFormData.office_id}
                  value={transferFormData.department_id || ""} 
                  onChange={e => {
                    const val = e.target.value;
                    setTransferFormData({
                      ...transferFormData,
                      department_id: val,
                      sub_department_id: "",
                      group_id: ""
                    });
                  }} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm disabled:opacity-50"
                >
                  <option value="">-- Pilih Departemen --</option>
                  {getActiveDepartmentsForOffice(transferFormData.office_id).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Pilih Sub Departemen (Opsional)</label>
                <select 
                  disabled={!transferFormData.department_id}
                  value={transferFormData.sub_department_id || ""} 
                  onChange={e => {
                    const val = e.target.value;
                    setTransferFormData({
                      ...transferFormData,
                      sub_department_id: val,
                      group_id: ""
                    });
                  }} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm disabled:opacity-50"
                >
                  <option value="">-- Tanpa Sub Departemen --</option>
                  {getActiveSubDepartmentsForDepartment(transferFormData.department_id).map(sd => (
                    <option key={sd.id} value={sd.id}>{sd.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Pilih Grup Karyawan Baru *</label>
                <select 
                  required 
                  disabled={!transferFormData.department_id}
                  value={transferFormData.group_id || ""} 
                  onChange={e => setTransferFormData({...transferFormData, group_id: e.target.value})} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm disabled:opacity-50"
                >
                  <option value="">-- Pilih Grup --</option>
                  {getActiveGroupsForTarget(transferFormData.office_id, transferFormData.department_id, transferFormData.sub_department_id).map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Tanggal Efektif Transfer *</label>
                <input 
                  required 
                  type="date" 
                  value={transferFormData.effective_date} 
                  onChange={e => setTransferFormData({...transferFormData, effective_date: e.target.value})} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Alasan Transfer / Keterangan *</label>
                <textarea 
                  required 
                  rows={3}
                  value={transferFormData.reason} 
                  onChange={e => setTransferFormData({...transferFormData, reason: e.target.value})} 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm"
                  placeholder="Contoh: Promosi jabatan, mutasi dinas, restrukturisasi divisi..."
                />
              </div>

              {transferFormData.group_id && (
                <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 rounded-lg space-y-2">
                  <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Pratinjau Dampak & Jadwal</div>
                  
                  {(() => {
                    const preview = getTransferSchedulePreview(transferEmp, transferFormData.group_id);
                    return (
                      <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
                        <div>Jadwal individual aktif saat ini: <span className="font-semibold text-slate-800 dark:text-slate-200">{preview.individualAssignmentCount}</span></div>
                        <div>Jadwal grup tujuan aktif baru: <span className="font-semibold text-slate-800 dark:text-slate-200">{preview.newGroupAssignmentCount}</span></div>
                        {preview.scheduleWarning && (
                          <div className="text-amber-600 dark:text-amber-400 mt-2 font-medium bg-amber-500/10 p-2 rounded border border-amber-500/20">
                            ⚠️ {preview.scheduleWarning}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pb-2 relative z-10">
                <button 
                  type="button" 
                  onClick={() => { setShowTransferModal(false); setTransferEmp(null); }} 
                  className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700"
                >
                  Batal
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-medium flex items-center gap-2 shadow-sm"
                >
                  Simpan Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
