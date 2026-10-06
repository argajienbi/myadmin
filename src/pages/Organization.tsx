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
import { getEffectiveCompanyId, isOwnerLike } from "../utils/roleAccess";
import { normalizeName, safeTrim } from "../utils/textNormalize";

type EntityType = "area" | "office" | "department" | "subdepartment" | "group";

const SHIFT_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: "Sen",
  tuesday: "Sel",
  wednesday: "Rab",
  thursday: "Kam",
  friday: "Jum",
  saturday: "Sab",
  sunday: "Min",
};

const ENTITY_LABEL: Record<EntityType, string> = {
  area: "Area",
  office: "Kantor",
  department: "Departemen",
  subdepartment: "Sub Departemen",
  group: "Grup Karyawan",
};

const ENTITY_ICON: Record<EntityType, string> = {
  area: "📍",
  office: "🏢",
  department: "🏬",
  subdepartment: "📂",
  group: "👥",
};

const localDateString = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

export const Organization: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const [areas, setAreas] = useState<Area[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subDepartments, setSubDepartments] = useState<SubDepartment[]>([]);
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);

  const [employees, setEmployees] = useState<any[]>([]);
  const [scheduleAssignments, setScheduleAssignments] = useState<any[]>([]);
  const [scheduleSpecials, setScheduleSpecials] = useState<any[]>([]);
  const [timetables, setTimetables] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);

  // Tree expand/collapse state, keyed by node id. Default: expanded.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Entity create/edit modal context (replaces the old tab-driven modal)
  const [entityModal, setEntityModal] = useState<{
    type: EntityType;
    editingId: string | null;
  } | null>(null);
  const [formData, setFormData] = useState<any>({});

  // "Atur Jam" modal context: which group's work patterns are being managed
  const [scheduleModalGroupId, setScheduleModalGroupId] = useState<string | null>(null);
  const [patternForm, setPatternForm] = useState({
    name: "",
    work_start: "",
    work_end: "",
    days: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
    } as Record<string, boolean>,
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
    if (!userData) return;

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

    get(ref(db, paths.companyUsers(targetCompanyId))).then(snap => {
      setEmployees(snap.exists() ? Object.keys(snap.val()).map(k => ({ ...snap.val()[k], uid: k })) : []);
    });

    get(ref(db, paths.scheduleAssignments(targetCompanyId))).then(snap => {
      setScheduleAssignments(snap.exists() ? Object.keys(snap.val()).map(k => ({ ...snap.val()[k], id: k })) : []);
    });

    get(ref(db, paths.scheduleSpecials(targetCompanyId))).then(snap => {
      setScheduleSpecials(snap.exists() ? Object.keys(snap.val()).map(k => ({ ...snap.val()[k], id: k })) : []);
    });

    get(ref(db, paths.timetables(targetCompanyId))).then(snap => {
      setTimetables(snap.exists() ? Object.keys(snap.val()).map(k => ({ ...snap.val()[k], id: k })) : []);
    });

    get(ref(db, paths.shifts(targetCompanyId))).then(snap => {
      setShifts(snap.exists() ? Object.keys(snap.val()).map(k => ({ ...snap.val()[k], id: k })) : []);
    });

    return () => unsubs.forEach(u => u());
  }, [targetCompanyId]);

  const buildBaseMasterPayload = (raw: any, existing?: any) => {
    const now = Date.now();
    const name = safeTrim(raw.name);

    return {
      ...raw,
      name,
      normalized_name: normalizeName(name),
      company_id: targetCompanyId,
      status: raw.status || (raw.active === false ? "inactive" : "active"),
      active: raw.active !== false,
      created_at: existing?.created_at || raw.created_at || now,
      created_by: existing?.created_by || raw.created_by || userData?.uid || "",
      updated_at: now,
      updated_by: userData?.uid || "",
    };
  };

  const openCreate = (type: EntityType, preset: any = {}) => {
    // Enrich preset with the full parent chain so dropdowns come pre-filled
    // when creating from a tree node (Area -> Kantor -> Departemen -> Grup).
    const enriched: any = { ...preset };
    if (enriched.sub_department_id) {
      const s: any = subDepartments.find((x: any) => x.id === enriched.sub_department_id);
      if (s && !enriched.department_id) enriched.department_id = s.department_id;
    }
    if (enriched.department_id) {
      const d: any = departments.find((x: any) => x.id === enriched.department_id);
      if (d && !enriched.office_id) enriched.office_id = d.office_id;
    }
    if (enriched.office_id) {
      const o: any = offices.find((x: any) => x.id === enriched.office_id);
      if (o && !enriched.area_id) enriched.area_id = o.area_id;
    }

    setEntityModal({ type, editingId: null });
    if (type === "office") {
      setFormData({
        latitude: -6.18142435142701,
        longitude: 106.82099076217408,
        radius_meter: 300,
        ...enriched,
      });
    } else {
      setFormData({ ...enriched });
    }
  };

  const openEdit = (type: EntityType, item: any) => {
    setEntityModal({ type, editingId: item.id });
    if (type === "office") {
      setFormData({
        ...item,
        latitude: item.latitude || -6.18142435142701,
        longitude: item.longitude || 106.82099076217408,
        radius_meter: item.radius_meter || 300,
      });
    } else {
      setFormData({ ...item });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCompanyId || !userData || !entityModal) return;
    const { type, editingId } = entityModal;

    const createRequest = async () => {
      let targetPath = "";
      let listPath = "";
      let rawData: any = { ...formData };
      const labelBisnis = ENTITY_LABEL[type];

      if (type === "area") {
        listPath = paths.areas(targetCompanyId);
        targetPath = paths.area(targetCompanyId, editingId || "");
      } else if (type === "office") {
        listPath = paths.offices(targetCompanyId);
        targetPath = paths.office(targetCompanyId, editingId || "");

        if (!formData.area_id) throw new Error("Area wajib dipilih.");
        if (!Number.isFinite(Number(formData.latitude))) throw new Error("Latitude tidak valid.");
        if (!Number.isFinite(Number(formData.longitude))) throw new Error("Longitude tidak valid.");
        if (!Number.isFinite(Number(formData.radius_meter)) || Number(formData.radius_meter) <= 0) {
          throw new Error("Radius wajib lebih dari 0 meter.");
        }

        rawData.latitude = Number(formData.latitude);
        rawData.longitude = Number(formData.longitude);
        rawData.radius_meter = Number(formData.radius_meter);
        rawData.map_provider = "leaflet_osm";
        rawData.geofence_source = "web_admin_leaflet";
      } else if (type === "department") {
        listPath = paths.departments(targetCompanyId);
        targetPath = paths.department(targetCompanyId, editingId || "");

        if (!formData.office_id) throw new Error("Kantor wajib dipilih.");
      } else if (type === "subdepartment") {
        listPath = paths.subDepartments(targetCompanyId);
        targetPath = paths.subDepartment(targetCompanyId, editingId || "");

        if (!formData.department_id) throw new Error("Departemen wajib dipilih.");
        // Derive office/area from department when not explicitly set
        const parentDept: any = departments.find((d: any) => d.id === formData.department_id);
        if (parentDept) {
          if (!rawData.office_id) rawData.office_id = parentDept.office_id;
          if (!rawData.area_id) {
            const parentOffice: any = offices.find((o: any) => o.id === parentDept.office_id);
            if (parentOffice) rawData.area_id = parentOffice.area_id;
          }
        }
      } else if (type === "group") {
        listPath = paths.employeeGroups(targetCompanyId);
        targetPath = paths.employeeGroup(targetCompanyId, editingId || "");

        if (!formData.department_id) throw new Error("Departemen wajib dipilih.");
        // Derive office/area from department when not explicitly set
        const parentDept: any = departments.find((d: any) => d.id === formData.department_id);
        if (parentDept) {
          if (!rawData.office_id) rawData.office_id = parentDept.office_id;
          if (!rawData.area_id) {
            const parentOffice: any = offices.find((o: any) => o.id === parentDept.office_id);
            if (parentOffice) rawData.area_id = parentOffice.area_id;
          }
        }
        // sub_department_id is optional; empty string when group sits directly under department
        if (!rawData.sub_department_id) rawData.sub_department_id = "";
      }

      let finalPayload: any;
      if (editingId) {
        const existingSnap = await get(ref(db, targetPath));
        const existingData = existingSnap.exists() ? existingSnap.val() : {};
        finalPayload = buildBaseMasterPayload(rawData, existingData);
        await update(ref(db, targetPath), finalPayload);
        await writeAuditLog(targetCompanyId, {
          action: "UPDATE_MASTER_DATA",
          details: `Mengubah data ${labelBisnis} (${finalPayload.name || editingId})`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: targetPath,
          new_value: finalPayload,
        });
      } else {
        const newRef = push(ref(db, listPath));
        finalPayload = buildBaseMasterPayload(rawData);
        finalPayload.id = newRef.key;
        await set(newRef, finalPayload);
        await writeAuditLog(targetCompanyId, {
          action: "CREATE_MASTER_DATA",
          details: `Membuat data ${labelBisnis} (${finalPayload.name || 'Baru'})`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "Unknown",
          target_path: `${listPath}/${newRef.key}`,
          new_value: finalPayload,
        });
      }
      return "Berhasil menyimpan data";
    };

    toast.promise(createRequest(), {
      loading: 'Menyimpan...',
      success: (msg) => {
        setFormData({});
        setEntityModal(null);
        return msg;
      },
      error: (err) => `Gagal menyimpan data: ${err.message}`
    });
  };

  const isActiveRecord = (item: any) => item?.active !== false && item?.status !== "inactive";

  const getDependencyUsage = (type: EntityType, id: string) => {
    const usages: string[] = [];

    if (type === "area") {
      const officeCount = offices.filter((item: any) => item.area_id === id && isActiveRecord(item)).length;
      const deptCount = departments.filter((item: any) => item.area_id === id && isActiveRecord(item)).length;
      const groupCount = groups.filter((item: any) => item.area_id === id && isActiveRecord(item)).length;
      if (officeCount > 0) usages.push(`${officeCount} kantor`);
      if (deptCount > 0) usages.push(`${deptCount} departemen`);
      if (groupCount > 0) usages.push(`${groupCount} grup karyawan`);
    }

    if (type === "office") {
      const deptCount = departments.filter((item: any) => item.office_id === id && isActiveRecord(item)).length;
      const groupCount = groups.filter((item: any) => item.office_id === id && isActiveRecord(item)).length;
      const employeeCount = employees.filter((item: any) => item.office_id === id && isActiveRecord(item)).length;
      if (deptCount > 0) usages.push(`${deptCount} departemen`);
      if (groupCount > 0) usages.push(`${groupCount} grup karyawan`);
      if (employeeCount > 0) usages.push(`${employeeCount} karyawan`);
    }

    if (type === "department") {
      const subDeptCount = subDepartments.filter((item: any) => item.department_id === id && isActiveRecord(item)).length;
      const groupCount = groups.filter((item: any) => item.department_id === id && isActiveRecord(item)).length;
      const employeeCount = employees.filter((item: any) => item.department_id === id && isActiveRecord(item)).length;
      if (subDeptCount > 0) usages.push(`${subDeptCount} sub departemen`);
      if (groupCount > 0) usages.push(`${groupCount} grup karyawan`);
      if (employeeCount > 0) usages.push(`${employeeCount} karyawan`);
    }

    if (type === "subdepartment") {
      const groupCount = groups.filter((item: any) => item.sub_department_id === id && isActiveRecord(item)).length;
      const employeeCount = employees.filter((item: any) => item.sub_department_id === id && isActiveRecord(item)).length;
      if (groupCount > 0) usages.push(`${groupCount} grup karyawan`);
      if (employeeCount > 0) usages.push(`${employeeCount} karyawan`);
    }

    if (type === "group") {
      const employeeCount = employees.filter((item: any) => item.group_id === id && isActiveRecord(item)).length;
      const assignmentCount = scheduleAssignments.filter((item: any) => {
        const targetType = String(item.type || item.target_type || "").toLowerCase();
        return targetType === "group" && item.target_id === id && isActiveRecord(item);
      }).length;
      const specialCount = scheduleSpecials.filter((item: any) => {
        const targetType = String(item.type || item.target_type || "").toLowerCase();
        return targetType === "group" && item.target_id === id && isActiveRecord(item);
      }).length;

      if (employeeCount > 0) usages.push(`${employeeCount} karyawan`);
      if (assignmentCount > 0) usages.push(`${assignmentCount} penerapan jadwal`);
      if (specialCount > 0) usages.push(`${specialCount} jadwal khusus`);
    }

    return usages;
  };

  const ensureNoDependencyBeforeDisableOrDelete = (type: EntityType, id: string, label: string) => {
    const usages = getDependencyUsage(type, id);
    if (usages.length === 0) return true;

    toast.error(`${label} masih dipakai oleh ${usages.join(", ")}. Pindahkan/nonaktifkan data terkait terlebih dahulu.`);
    return false;
  };

  const getItemPath = (type: EntityType, id: string) => {
    if (type === "area") return paths.area(targetCompanyId, id);
    if (type === "office") return paths.office(targetCompanyId, id);
    if (type === "department") return paths.department(targetCompanyId, id);
    if (type === "subdepartment") return paths.subDepartment(targetCompanyId, id);
    if (type === "group") return paths.employeeGroup(targetCompanyId, id);
    return "";
  };

  const handleToggle = async (type: EntityType, id: string, currentActive: boolean) => {
    if (!targetCompanyId || !userData) return;
    const labelBisnis = ENTITY_LABEL[type];
    const itemPath = getItemPath(type, id);
    if (!itemPath) return;

    if (currentActive) {
      if (!ensureNoDependencyBeforeDisableOrDelete(type, id, labelBisnis || "Data")) return;
    }

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
  };

  const handleDelete = async (type: EntityType, id: string) => {
    if (!targetCompanyId || !userData) return;
    const labelBisnis = ENTITY_LABEL[type];
    const itemPath = getItemPath(type, id);
    if (!itemPath) return;

    if (!ensureNoDependencyBeforeDisableOrDelete(type, id, labelBisnis || "Data")) return;

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
  };

  // ---------- Work pattern (Atur Jam) helpers ----------
  // One "pattern" = one schedule assignment of a shift to this group.
  // The underlying logic is unchanged: timetable -> shift -> assignment.

  const getGroupPatterns = (groupId: string) => {
    return scheduleAssignments
      .filter((a: any) => {
        const targetType = String(a.type || a.target_type || "").toLowerCase();
        return targetType === "group" && a.target_id === groupId && isActiveRecord(a);
      })
      .map((a: any) => {
        const shift: any = shifts.find((s: any) => s.id === a.shift_id);
        const dayEntries = SHIFT_DAY_KEYS
          .map((day) => {
            const d = shift?.days?.[day];
            if (!d || !d.active) return null;
            const tt: any = timetables.find((t: any) => t.id === d.timetable_id);
            return {
              day,
              label: DAY_LABELS[day],
              work_start: tt?.work_start || "",
              work_end: tt?.work_end || "",
            };
          })
          .filter(Boolean);
        // Summarize: group consecutive same-hour entries as "08:00-17:00"
        const timeRanges = Array.from(
          new Set(
            dayEntries.map((e: any) => `${e.work_start}-${e.work_end}`)
          )
        );
        const dayLabels = dayEntries.map((e: any) => e.label).join(", ");
        return {
          assignmentId: a.id,
          shiftId: shift?.id || "",
          name: shift?.name || "Pola",
          timeRanges,
          dayLabels,
          startDate: a.start_date || "",
        };
      });
  };

  const openScheduleModal = (groupId: string) => {
    setScheduleModalGroupId(groupId);
    setPatternForm({
      name: "",
      work_start: "",
      work_end: "",
      days: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      },
    });
  };

  const handleAddPattern = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCompanyId || !userData || !scheduleModalGroupId) return;

    const addRequest = async () => {
      const { name, work_start, work_end, days } = patternForm;
      if (!work_start || !work_end) throw new Error("Jam masuk dan jam keluar wajib diisi.");
      const activeDays = SHIFT_DAY_KEYS.filter((d) => days[d]);
      if (activeDays.length === 0) throw new Error("Minimal satu hari kerja harus dipilih.");

      const now = Date.now();
      const by = userData?.uid || "";
      const byName = userData?.nama_lengkap || "";

      // 1. Reuse an existing timetable with identical hours, else create one.
      let timetable: any = timetables.find(
        (t: any) => t.work_start === work_start && t.work_end === work_end && isActiveRecord(t)
      );
      if (!timetable) {
        const ttRef = push(ref(db, paths.timetables(targetCompanyId)));
        timetable = {
          id: ttRef.key,
          name: name || `${work_start}-${work_end}`,
          work_start,
          work_end,
          late_tolerance_minute: 0,
          early_out_tolerance_minute: 0,
          crosses_midnight: work_end < work_start,
          company_id: targetCompanyId,
          active: true,
          created_at: now,
          created_by: by,
          created_by_name: byName,
          updated_at: now,
          updated_by: by,
          updated_by_name: byName,
        };
        await set(ttRef, timetable);
        setTimetables((prev) => [...prev, timetable]);
      }

      // 2. Create the shift mapping days -> timetable.
      const shiftRef = push(ref(db, paths.shifts(targetCompanyId)));
      const shiftPayload: any = {
        id: shiftRef.key,
        name: name || `Pola ${work_start}-${work_end}`,
        workday_mode: "custom",
        days: {},
        company_id: targetCompanyId,
        active: true,
        created_at: now,
        created_by: by,
        created_by_name: byName,
        updated_at: now,
        updated_by: by,
        updated_by_name: byName,
      };
      SHIFT_DAY_KEYS.forEach((d) => {
        shiftPayload.days[d] = {
          active: !!days[d],
          timetable_id: days[d] ? timetable.id : "",
        };
      });
      await set(shiftRef, shiftPayload);
      setShifts((prev) => [...prev, shiftPayload]);

      // 3. Assign the shift to the group.
      const assignRef = push(ref(db, paths.scheduleAssignments(targetCompanyId)));
      const assignPayload: any = {
        id: assignRef.key,
        type: "group",
        target_id: scheduleModalGroupId,
        shift_id: shiftRef.key,
        start_date: localDateString(),
        end_date: "",
        company_id: targetCompanyId,
        active: true,
        created_at: now,
        created_by: by,
      };
      await set(assignRef, assignPayload);
      setScheduleAssignments((prev) => [...prev, assignPayload]);

      await writeAuditLog(targetCompanyId, {
        action: "CREATE_MASTER_DATA",
        details: `Menambah pola jam "${shiftPayload.name}" (${work_start}-${work_end}) untuk grup ${scheduleModalGroupId}`,
        user_uid: by,
        user_name: byName,
        target_path: `${paths.scheduleAssignments(targetCompanyId)}/${assignRef.key}`,
        new_value: assignPayload,
      });

      return "Berhasil menambah pola jam";
    };

    toast.promise(addRequest(), {
      loading: "Menyimpan...",
      success: (msg) => {
        setPatternForm({
          name: "",
          work_start: "",
          work_end: "",
          days: {
            monday: true,
            tuesday: true,
            wednesday: true,
            thursday: true,
            friday: true,
            saturday: false,
            sunday: false,
          },
        });
        return msg;
      },
      error: (err) => `Gagal menambah pola jam: ${err.message}`,
    });
  };

  const handleDeletePattern = (pattern: any) => {
    if (!targetCompanyId || !userData) return;
    requestConfirm(
      "Hapus Pola Jam",
      `Hapus pola jam "${pattern.name}"? Penerapan jadwal ke grup ini akan dicabut.`,
      true,
      () => {
        const deleteRequest = async () => {
          const updates: any = {};
          updates[`${paths.scheduleAssignment(targetCompanyId, pattern.assignmentId)}`] = null;
          if (pattern.shiftId) {
            updates[`${paths.shift(targetCompanyId, pattern.shiftId)}`] = null;
          }
          await update(ref(db), updates);
          setScheduleAssignments((prev) => prev.filter((a: any) => a.id !== pattern.assignmentId));
          setShifts((prev) => prev.filter((s: any) => s.id !== pattern.shiftId));
          return "Berhasil menghapus pola jam";
        };
        toast.promise(deleteRequest(), {
          loading: "Menghapus...",
          success: (msg) => msg,
          error: (err) => `Gagal menghapus pola jam: ${err.message}`,
        });
      }
    );
  };

  // ---------- Tree helpers ----------

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const getOfficesByArea = (areaId: string) =>
    offices.filter((o: any) => o.area_id === areaId);
  const getDepartmentsByOffice = (officeId: string) =>
    departments.filter((d: any) => d.office_id === officeId);
  const getSubDepartmentsByDepartment = (deptId: string) =>
    subDepartments.filter((s: any) => s.department_id === deptId);
  const getDirectGroupsByDepartment = (deptId: string) =>
    groups.filter((g: any) => g.department_id === deptId && !g.sub_department_id);
  const getGroupsBySubDepartment = (subDeptId: string) =>
    groups.filter((g: any) => g.sub_department_id === subDeptId);
  const getEmployeesByGroup = (groupId: string) =>
    employees.filter((e: any) => e.group_id === groupId && isActiveRecord(e));

  const actionBtn =
    "text-xs font-medium px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800";

  const renderNodeActions = (
    type: EntityType,
    item: any,
    onAddChild?: { label: string; run: () => void }
  ) => (
    <span className="flex items-center gap-0.5 shrink-0 ml-2">
      {onAddChild && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddChild.run(); }}
          className={`${actionBtn} text-emerald-600 dark:text-emerald-400`}
          title={onAddChild.label}
        >
          {onAddChild.label}
        </button>
      )}
      {type === "group" && (
        <button
          onClick={(e) => { e.stopPropagation(); openScheduleModal(item.id); }}
          className={`${actionBtn} text-teal-600 dark:text-teal-400`}
          title="Atur jam kerja grup ini"
        >
          🕐 Jam
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); openEdit(type, item); }}
        className={`${actionBtn} text-blue-600 dark:text-blue-400`}
      >
        Edit
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleToggle(type, item.id, item.active !== false); }}
        className={`${actionBtn} text-slate-500 dark:text-slate-400`}
      >
        {item.active !== false ? "Nonaktif" : "Pulihkan"}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleDelete(type, item.id); }}
        className={`${actionBtn} text-red-600 dark:text-red-400`}
      >
        Hapus
      </button>
    </span>
  );

  const renderGroupNode = (g: any, depth: number) => {
    const patterns = getGroupPatterns(g.id);
    const empCount = getEmployeesByGroup(g.id).length;
    const isCollapsed = !!collapsed[`g-${g.id}`];
    return (
      <div key={g.id} style={{ marginLeft: depth * 24 }} className="border-l-2 border-slate-200 dark:border-slate-800 pl-3 py-1.5">
        <div
          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
          onClick={() => toggleCollapse(`g-${g.id}`)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
            <span className="text-base">👥</span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
              {g.name}
              {g.active === false && <span className="text-red-500 text-xs ml-2">(Nonaktif)</span>}
            </span>
            {empCount > 0 && (
              <span className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full px-2 py-0.5">
                {empCount} karyawan
              </span>
            )}
          </div>
          {renderNodeActions("group", g)}
        </div>
        {!isCollapsed && (
          <div className="ml-6 mt-1 mb-1 flex flex-wrap items-center gap-1.5">
            {patterns.length === 0 ? (
              <button
                onClick={() => openScheduleModal(g.id)}
                className="text-[11px] text-amber-600 dark:text-amber-400 border border-dashed border-amber-300 dark:border-amber-800 rounded px-2 py-1 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              >
                + Atur jam kerja
              </button>
            ) : (
              patterns.map((p: any) => (
                <span
                  key={p.assignmentId}
                  className="text-[11px] bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 text-teal-700 dark:text-teal-300 rounded px-2 py-1"
                  title={p.dayLabels}
                >
                  🕐 {p.name}: {p.timeRanges.join(" / ")}
                </span>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSubDepartmentNode = (s: any, depth: number) => {
    const childGroups = getGroupsBySubDepartment(s.id);
    const isCollapsed = !!collapsed[`s-${s.id}`];
    return (
      <div key={s.id} style={{ marginLeft: depth * 24 }} className="border-l-2 border-slate-200 dark:border-slate-800 pl-3 py-1.5">
        <div
          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
          onClick={() => toggleCollapse(`s-${s.id}`)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
            <span className="text-base">📂</span>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
              {s.name}
              {s.active === false && <span className="text-red-500 text-xs ml-2">(Nonaktif)</span>}
            </span>
            {childGroups.length > 0 && (
              <span className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full px-2 py-0.5">
                {childGroups.length} grup
              </span>
            )}
          </div>
          {renderNodeActions("subdepartment", s, {
            label: "+ Grup",
            run: () => openCreate("group", { department_id: s.department_id, sub_department_id: s.id }),
          })}
        </div>
        {!isCollapsed && childGroups.map((g) => renderGroupNode(g, 1))}
      </div>
    );
  };

  const renderDepartmentNode = (d: any, depth: number) => {
    const childSubs = getSubDepartmentsByDepartment(d.id);
    const directGroups = getDirectGroupsByDepartment(d.id);
    const isCollapsed = !!collapsed[`d-${d.id}`];
    return (
      <div key={d.id} style={{ marginLeft: depth * 24 }} className="border-l-2 border-slate-200 dark:border-slate-800 pl-3 py-1.5">
        <div
          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
          onClick={() => toggleCollapse(`d-${d.id}`)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
            <span className="text-base">🏬</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {d.name}
              {d.active === false && <span className="text-red-500 text-xs ml-2">(Nonaktif)</span>}
            </span>
            {(childSubs.length + directGroups.length) > 0 && (
              <span className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full px-2 py-0.5">
                {childSubs.length + directGroups.length} unit
              </span>
            )}
          </div>
          <span className="flex items-center gap-0.5 shrink-0 ml-2">
            <button
              onClick={(e) => { e.stopPropagation(); openCreate("subdepartment", { department_id: d.id }); }}
              className={`${actionBtn} text-emerald-600 dark:text-emerald-400`}
            >
              + Sub Dept
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openCreate("group", { department_id: d.id, sub_department_id: "" }); }}
              className={`${actionBtn} text-emerald-600 dark:text-emerald-400`}
            >
              + Grup
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openEdit("department", d); }}
              className={`${actionBtn} text-blue-600 dark:text-blue-400`}
            >
              Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleToggle("department", d.id, d.active !== false); }}
              className={`${actionBtn} text-slate-500 dark:text-slate-400`}
            >
              {d.active !== false ? "Nonaktif" : "Pulihkan"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete("department", d.id); }}
              className={`${actionBtn} text-red-600 dark:text-red-400`}
            >
              Hapus
            </button>
          </span>
        </div>
        {!isCollapsed && (
          <>
            {childSubs.map((s) => renderSubDepartmentNode(s, 1))}
            {directGroups.map((g) => renderGroupNode(g, 1))}
          </>
        )}
      </div>
    );
  };

  const renderOfficeNode = (o: any) => {
    const childDepts = getDepartmentsByOffice(o.id);
    const isCollapsed = !!collapsed[`o-${o.id}`];
    return (
      <div key={o.id} className="border-l-2 border-slate-200 dark:border-slate-800 pl-3 py-1.5">
        <div
          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
          onClick={() => toggleCollapse(`o-${o.id}`)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
            <span className="text-base">🏢</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              {o.name}
              {o.active === false && <span className="text-red-500 text-xs ml-2">(Nonaktif)</span>}
            </span>
            <span className="text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5">
              {o.radius_meter}m
            </span>
            {childDepts.length > 0 && (
              <span className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full px-2 py-0.5">
                {childDepts.length} dept
              </span>
            )}
          </div>
          {renderNodeActions("office", o, {
            label: "+ Dept",
            run: () => openCreate("department", { office_id: o.id }),
          })}
        </div>
        {!isCollapsed && childDepts.map((d) => renderDepartmentNode(d, 1))}
      </div>
    );
  };

  const renderAreaNode = (a: any) => {
    const childOffices = getOfficesByArea(a.id);
    const isCollapsed = !!collapsed[`a-${a.id}`];
    return (
      <div key={a.id} className="mb-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
        <div
          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
          onClick={() => toggleCollapse(`a-${a.id}`)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-400 text-xs w-4">{isCollapsed ? "▶" : "▼"}</span>
            <span className="text-lg">📍</span>
            <span className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
              {a.name}
              {a.active === false && <span className="text-red-500 text-xs ml-2">(Nonaktif)</span>}
            </span>
            {childOffices.length > 0 && (
              <span className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full px-2 py-0.5">
                {childOffices.length} kantor
              </span>
            )}
          </div>
          {renderNodeActions("area", a, {
            label: "+ Kantor",
            run: () => openCreate("office", { area_id: a.id }),
          })}
        </div>
        {!isCollapsed && (
          <div className="mt-1">
            {childOffices.map((o) => renderOfficeNode(o))}
          </div>
        )}
      </div>
    );
  };

  const scheduleModalGroup = scheduleModalGroupId
    ? groups.find((g: any) => g.id === scheduleModalGroupId)
    : null;
  const scheduleModalPatterns = scheduleModalGroupId
    ? getGroupPatterns(scheduleModalGroupId)
    : [];

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
            onClick={() => openCreate("area")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
          >
            + Tambah Area
          </button>
        )}
      </div>

      {isOwner && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg flex items-center gap-4">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Pilih Perusahaan:</label>
          <select
            value={targetCompanyId}
            onChange={(e) => {
              setTargetCompanyId(e.target.value);
              localStorage.setItem("admin_selected_company", e.target.value);
            }}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded p-2 text-sm focus:outline-none focus:border-blue-500 min-w-[200px]"
          >
            <option value="" disabled>-- Pilih Perusahaan --</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {targetCompanyId && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-xs text-slate-600 dark:text-slate-300">
          Perusahaan aktif: <span className="font-semibold text-blue-600 dark:text-blue-400">
            {companies.find(c => c.id === targetCompanyId)?.name || targetCompanyId}
          </span>
        </div>
      )}

      {!targetCompanyId && !isOwner && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 p-4 rounded-lg text-sm">
          Akun ini belum terhubung ke perusahaan. Hubungi owner untuk memperbaiki akses.
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-blue-500">Memuat data organisasi...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : areas.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Belum ada struktur organisasi. Klik <span className="font-semibold">+ Tambah Area</span> untuk mulai membangun: Area → Kantor → Departemen → Grup.
        </div>
      ) : (
        <div>
          {areas.map((a) => renderAreaNode(a))}
        </div>
      )}

      {entityModal && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                {ENTITY_ICON[entityModal.type]} {entityModal.editingId ? "Edit" : "Tambah"} {ENTITY_LABEL[entityModal.type]}
              </h3>
              <button onClick={() => setEntityModal(null)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
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

              {(entityModal.type === "office" || entityModal.type === "department" || entityModal.type === "group") && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Area</label>
                    <select required value={formData.area_id || ""} onChange={e => setFormData({...formData, area_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="" disabled>Pilih Area...</option>
                      {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
              )}

              {entityModal.type === "office" && (
                <div className="my-4">
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Lokasi & Radius Presensi</label>
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

              {(entityModal.type === "department" || entityModal.type === "subdepartment" || entityModal.type === "group") && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Kantor</label>
                    <select required value={formData.office_id || ""} onChange={e => setFormData({...formData, office_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="" disabled>Pilih Kantor...</option>
                      {offices
                        .filter(o => !formData.area_id || o.area_id === formData.area_id)
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
              )}

              {(entityModal.type === "subdepartment" || entityModal.type === "group") && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Departemen</label>
                    <select required value={formData.department_id || ""} onChange={e => setFormData({...formData, department_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="" disabled>Pilih Departemen...</option>
                      {departments
                        .filter(d => !formData.office_id || (d as any).office_id === formData.office_id)
                        .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
              )}

              {entityModal.type === "group" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Sub Departemen <span className="font-normal text-slate-400">(opsional)</span></label>
                    <select value={formData.sub_department_id || ""} onChange={e => setFormData({...formData, sub_department_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200">
                      <option value="">-- Langsung di bawah Departemen --</option>
                      {subDepartments
                        .filter(s => !formData.department_id || s.department_id === formData.department_id)
                        .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
              )}

              <div className="flex justify-end gap-3 mt-6 border-t border-slate-200 dark:border-slate-800 pt-4">
                <button type="button" onClick={() => setEntityModal(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700">Batal</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium">Simpan</button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {scheduleModalGroupId && (
        <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                🕐 Jam Kerja — {scheduleModalGroup?.name || "Grup"}
              </h3>
              <button onClick={() => setScheduleModalGroupId(null)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Pola jam aktif</h4>
                {scheduleModalPatterns.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">Belum ada pola jam. Tambahkan pola pertama di bawah.</p>
                ) : (
                  <div className="space-y-2">
                    {scheduleModalPatterns.map((p: any) => (
                      <div key={p.assignmentId} className="flex items-center justify-between bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900 rounded px-3 py-2">
                        <div className="text-sm">
                          <span className="font-semibold text-teal-800 dark:text-teal-200">{p.name}</span>
                          <span className="text-teal-700 dark:text-teal-300 ml-2 font-mono">{p.timeRanges.join(" / ")}</span>
                          <div className="text-xs text-teal-600 dark:text-teal-400">{p.dayLabels}</div>
                        </div>
                        <button
                          onClick={() => handleDeletePattern(p)}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline px-2 py-1"
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleAddPattern} className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-4">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tambah pola jam</h4>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Nama pola <span className="font-normal text-slate-400">(mis. Pagi, Siang, Malam)</span></label>
                  <input
                    type="text"
                    value={patternForm.name}
                    onChange={e => setPatternForm({ ...patternForm, name: e.target.value })}
                    placeholder="Pagi"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Jam masuk</label>
                    <input
                      type="time"
                      required
                      value={patternForm.work_start}
                      onChange={e => setPatternForm({ ...patternForm, work_start: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Jam keluar</label>
                    <input
                      type="time"
                      required
                      value={patternForm.work_end}
                      onChange={e => setPatternForm({ ...patternForm, work_end: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Hari kerja</label>
                  <div className="flex flex-wrap gap-2">
                    {SHIFT_DAY_KEYS.map((day) => (
                      <label
                        key={day}
                        className={`cursor-pointer text-xs font-medium rounded-full px-3 py-1.5 border transition-colors ${
                          patternForm.days[day]
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={!!patternForm.days[day]}
                          onChange={(e) => setPatternForm({
                            ...patternForm,
                            days: { ...patternForm.days, [day]: e.target.checked },
                          })}
                        />
                        {DAY_LABELS[day]}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setScheduleModalGroupId(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm">Tutup</button>
                  <button type="submit" className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded text-sm font-medium">+ Tambah Pola</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
