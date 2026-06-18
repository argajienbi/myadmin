import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, push, set, update, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Company, Timetable, Shift, ScheduleAssignment, EmployeeGroup, CompanyUser } from "../types";
import toast from "react-hot-toast";
import { ConfirmModal } from "../components/ConfirmModal";
import { createNotification } from "../services/notificationService";
import { getGoogleCalendarAccessToken } from "../auth/workspaceAuth";
import { companyDisplayName, employeeDisplayName, groupDisplayName, shiftDisplayName, timetableDisplayName } from "../utils/safeDisplay";
import { AlertCircle, ExternalLink, Copy, Check, X } from "lucide-react";
import { getEffectiveCompanyId, isOwnerLike } from "../utils/roleAccess";

const SHIFT_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

type ShiftDayKey = typeof SHIFT_DAY_KEYS[number];

function isActiveValue(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "active" || text === "yes";
}

const dayLabelMap: Record<string, string> = {
  sunday: "Minggu",
  monday: "Senin",
  tuesday: "Selasa",
  wednesday: "Rabu",
  thursday: "Kamis",
  friday: "Jumat",
  saturday: "Sabtu"
};

const subtractMinutesFromTime = (time: string, minutes: number) => {
  if (!time || !time.includes(":")) return time;
  const [hh, mm] = time.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return time;
  const total = ((hh * 60 + mm - minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const timeToMinutesLocal = (time: string) => {
  const [hh, mm] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
};

const currentMinutesLocal = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const isTodayWorkStartAlreadyPassed = (time: string) => {
  const target = timeToMinutesLocal(time);
  if (target == null) return false;
  return currentMinutesLocal() >= target;
};

const dateKeyToLabel = (dateKey: string) => {
  if (!dateKey) return "-";
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const sortDateKeys = (dates: Record<string, boolean> | string[]) => {
  if (Array.isArray(dates)) return [...dates].sort();
  return Object.keys(dates || {}).filter(key => dates[key]).sort();
};

const dayKeyFromDate = (dateKey: string) => {
  const date = new Date(`${dateKey}T00:00:00`);
  const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return keys[date.getDay()];
};

const buildDaysFromDates = (dateKeys: string[]) => {
  const days: Record<string, boolean> = {
    sunday: false,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
  };

  dateKeys.forEach(dateKey => {
    const dayKey = dayKeyFromDate(dateKey);
    if (dayKey) days[dayKey] = true;
  });

  return days;
};

const buildDateMap = (dateKeys: string[]) => {
  return dateKeys.reduce((acc: Record<string, boolean>, dateKey) => {
    if (dateKey) acc[dateKey] = true;
    return acc;
  }, {});
};

const minuteOfDay = (value: string) => {
  const [hour, minute] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
};

const timeRangeOverlaps = (startA: string, endA: string, startB: string, endB: string) => {
  const aStart = minuteOfDay(startA);
  const aEnd = minuteOfDay(endA);
  const bStart = minuteOfDay(startB);
  const bEnd = minuteOfDay(endB);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;

  const normalize = (start: number, end: number) => {
    if (end >= start) return [[start, end]];
    return [[start, 1440], [0, end]];
  };

  return normalize(aStart, aEnd).some(([sa, ea]) =>
    normalize(bStart, bEnd).some(([sb, eb]) => sa < eb && sb < ea)
  );
};

const dateExistsInSchedule = (item: any, dateKey: string) => {
  if (item.dates && typeof item.dates === "object") {
    return item.dates[dateKey] === true || item.dates[dateKey] === "true";
  }
  if (item.date) return item.date === dateKey;
  if (item.date_start && item.date_end) return dateKey >= item.date_start && dateKey <= item.date_end;
  return false;
};

const targetUidExistsInSchedule = (item: any, uid: string) => {
  const targetUids = item.target_uids || {};
  if (Array.isArray(targetUids)) return targetUids.includes(uid);
  return targetUids[uid] === true || targetUids[uid] === "true";
};

const employeeLabelByUid = (employees: any[], uid: string) => {
  const employee = employees.find((item: any) => item.uid === uid);
  return employeeDisplayName(employee, "Karyawan tidak ditemukan");
};

export const Schedules: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");

  const getActiveEmployees = () => {
    return employees.filter((emp: any) => {
      const status = String(emp.status_akun || emp.status || "active").toLowerCase();
      if (emp.active === false || status === "inactive" || emp.is_active === false) return false;
      return true;
    });
  };

  const dateInAssignmentRange = (assignment: any, dateKey: string) => {
    const start = String(assignment.start_date || "");
    const end = String(assignment.end_date || "");
    if (start && dateKey < start) return false;
    if (end && dateKey > end) return false;
    return true;
  };

  const getGroupName = (id: string) => groupDisplayName(groups.find((g: any) => g.id === id), "Grup tidak ditemukan");
  const getEmployeeName = (uid: string) => employeeDisplayName(employees.find((e: any) => e.uid === uid), "Karyawan tidak ditemukan");
  const getShiftName = (id: string) => shiftDisplayName(shifts.find((s: any) => s.id === id), "Shift tidak ditemukan");
  const getTimetableName = (id: string) => timetableDisplayName(timetables.find((t: any) => t.id === id), "Jam kerja tidak ditemukan");

  const assignmentMatchesEmployee = (assignment: any, employee: any) => {
    const type = String(assignment.type || assignment.target_type || "").toLowerCase();
    const targetId = String(assignment.target_id || "");

    if (type === "user" || type === "individual" || type === "employee") {
      return targetId === employee.uid;
    }

    if (type === "group") {
      return targetId && targetId === employee.group_id;
    }

    return false;
  };

  const getValidAssignmentForEmployee = (employee: any, dateKey: string) => {
    return assignments.find((assignment: any) => {
      if (!isActiveValue(assignment.active, true)) return false;
      if (String(assignment.status || "active").toLowerCase() === "inactive") return false;
      if (!assignment.shift_id) return false;
      if (!dateInAssignmentRange(assignment, dateKey)) return false;
      return assignmentMatchesEmployee(assignment, employee);
    });
  };

  const uniqueUids = (uids: string[]) => {
    return Array.from(new Set(uids.filter(Boolean)));
  };

  const resolveTargetUids = (targetType: string, targetId: string) => {
    if (!targetId) return [];

    const normalizedType = String(targetType || "").toLowerCase();

    if (
      normalizedType === "user" ||
      normalizedType === "individual" ||
      normalizedType === "employee"
    ) {
      return [targetId];
    }

    if (normalizedType === "group") {
      return getActiveEmployees()
        .filter((emp: any) => emp.group_id === targetId)
        .map((emp: any) => emp.uid);
    }

    if (normalizedType === "all" || normalizedType === "company") {
      return getActiveEmployees().map((emp: any) => emp.uid);
    }

    return [];
  };

  const getAssignmentsUsingShift = (shiftId: string) => {
    return assignments.filter((item: any) => {
      const active = item.active !== false && item.status !== "inactive";
      return active && item.shift_id === shiftId;
    });
  };

  const getSpecialsUsingShift = (shiftId: string) => {
    return specials.filter((item: any) => {
      const active = item.active !== false && item.status !== "inactive";
      return active && item.shift_id === shiftId;
    });
  };

  const shiftUsesTimetable = (shift: any, timetableId: string) => {
    const days = shift.days || {};
    return Object.values(days).some((day: any) => {
      return day?.active !== false && day?.timetable_id === timetableId;
    });
  };

  const resolveUsersImpactedByShift = (shiftId: string) => {
    const fromAssignments = getAssignmentsUsingShift(shiftId)
      .flatMap((item: any) => resolveTargetUids(item.type || item.target_type || "individual", item.target_id));

    const fromSpecials = getSpecialsUsingShift(shiftId)
      .flatMap((item: any) => resolveTargetUids(item.type || item.target_type || "individual", item.target_id));

    return uniqueUids([...fromAssignments, ...fromSpecials]);
  };

  const resolveUsersImpactedByTimetable = (timetableId: string) => {
    const shiftIds = shifts
      .filter((shift: any) => shiftUsesTimetable(shift, timetableId))
      .map((shift: any) => shift.id);

    return uniqueUids(
      shiftIds.flatMap((shiftId: string) => resolveUsersImpactedByShift(shiftId))
    );
  };

  const resolveUsersImpactedByHoliday = () => {
    return getActiveEmployees().map((emp: any) => emp.uid);
  };

  const sendScheduleChangeNotifications = async ({
    uids,
    title,
    message,
    refId,
    extraData = {},
  }: {
    uids: string[];
    title: string;
    message: string;
    refId: string;
    extraData?: Record<string, any>;
  }) => {
    const uniqueTargets = uniqueUids(uids);

    if (uniqueTargets.length === 0) {
      console.info("Tidak ada target user untuk notifikasi jadwal.", { title, refId });
      return;
    }

    const results = await Promise.allSettled(
      uniqueTargets.map((uid) =>
        createNotification(uid, {
          company_id: targetCompanyId,
          title,
          message,
          type: "schedule_update",
          ref_type: "schedule",
          ref_id: refId,
          data: {
            source: "admin_web",
            changed_by_uid: userData?.uid || "",
            changed_by_name: userData?.nama_lengkap || "",
            changed_at: Date.now(),
            ...extraData,
          },
        } as any)
      )
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      console.warn("Sebagian notifikasi jadwal gagal dikirim.", failed);
      toast.error(`${failed.length} notifikasi jadwal gagal dikirim. Cek Log Notifikasi.`);
    }
  };

  const notifyUsersOfScheduleChange = async (
    targetType: string,
    targetId: string,
    title: string,
    body: string,
    refId: string,
    extraData: Record<string, any> = {}
  ) => {
    const uidsToNotify = resolveTargetUids(targetType, targetId);

    await sendScheduleChangeNotifications({
      uids: uidsToNotify,
      title,
      message: body,
      refId,
      extraData: {
        target_type: targetType,
        target_id: targetId,
        ...extraData,
      },
    });
  };
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"summary" | "timetable" | "shift" | "assignment" | "holiday" | "special" | "overtime" | "diagnostic" | "logs">("summary");

  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [specials, setSpecials] = useState<any[]>([]);
  const [overtimeSchedules, setOvertimeSchedules] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);
  const [employees, setEmployees] = useState<CompanyUser[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [diagnosticUid, setDiagnosticUid] = useState<string>("");
  const [diagnosticDate, setDiagnosticDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  const [isDiagnosticLoading, setIsDiagnosticLoading] = useState(false);
  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [syncCalendarAllCompanies, setSyncCalendarAllCompanies] = useState(false);
  const [searchParams] = useSearchParams();
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

  const [firebaseErrorHelpModal, setFirebaseErrorHelpModal] = useState<{
    isOpen: boolean;
    errorType: "unauthorized_domain" | "operation_not_allowed" | "calendar_api_disabled" | "other";
    rawMessage: string;
  }>({
    isOpen: false,
    errorType: "other",
    rawMessage: ""
  });

   const [copiedText, setCopiedText] = useState<string | null>(null);
  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => {
      setCopiedText(null);
    }, 2000);
  };

  const [savePreview, setSavePreview] = useState<{
    isOpen: boolean;
    title: string;
    summary: string;
    impactedUids: string[];
    notificationWillBeSent: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    summary: "",
    impactedUids: [],
    notificationWillBeSent: false,
    onConfirm: () => {},
  });

  const requestConfirm = (title: string, message: string, isDestructive: boolean, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, isDestructive, onConfirm });
  };

  const isOwner = isOwnerLike(userData);

  const runDiagnostic = async () => {
      if (!targetCompanyId || !diagnosticUid || !diagnosticDate) {
          toast.error("Pilih karyawan dan tanggal terlebih dahulu.");
          return;
      }
      setIsDiagnosticLoading(true);
      setDiagnosticResult(null);
      import("../services/scheduleDiagnostic").then(({ diagnoseEmployeeSchedule }) => {
           diagnoseEmployeeSchedule(targetCompanyId, diagnosticUid, diagnosticDate).then(result => {
               setDiagnosticResult(result);
           }).finally(() => {
               setIsDiagnosticLoading(false);
           });
      });
  };

  const handleSyncGoogleCalendar = async () => {
    if (!targetCompanyId) return;

    requestConfirm(
      "Sinkronisasi Kalender Indonesia",
      `Apakah Anda yakin ingin menyinkronkan daftar hari libur nasional?
Target: ${isOwner && syncCalendarAllCompanies ? "semua perusahaan" : "perusahaan aktif"}.
Jadwal libur akan ditambahkan ke sistem ini.`,
      false,
      async () => {
        setIsSyncingCalendar(true);
        try {
          const accessToken = await getGoogleCalendarAccessToken();
          if (!accessToken) {
             throw new Error("Gagal memperoleh akses ke Google Calendar.");
          }

          const currentYear = new Date().getFullYear();
          const timeMin = new Date(`${currentYear}-01-01T00:00:00Z`).toISOString();
          const timeMax = new Date(`${currentYear}-12-31T23:59:59Z`).toISOString();
          
          const calendarId = encodeURIComponent("en.indonesian#holiday@group.v.calendar.google.com");
          
          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          
          if (!response.ok) {
            let errorText = "";
            try {
              const errData = await response.json();
              errorText = errData?.error?.message || JSON.stringify(errData);
            } catch (e) {
              try {
                errorText = await response.text();
              } catch (textErr) {
                errorText = response.statusText || `HTTP Status ${response.status}`;
              }
            }
            throw new Error(`Google Calendar API error: ${errorText}`);
          }
          
          const data = await response.json();
          if (!data.items || data.items.length === 0) {
            toast.success("Tidak ada hari libur yang ditemukan untuk tahun ini.");
            return;
          }

          const targetCompanyIds =
            isOwner && syncCalendarAllCompanies
              ? companies.map((c: any) => c.id).filter(Boolean)
              : [targetCompanyId].filter(Boolean);

          const syncUpdates: any = {};
          let addedCount = 0;
          
          for (const item of data.items) {
             if (item.start && item.start.date) {
               const dateStr = item.start.date;
               const note = item.summary || "Hari Libur Nasional";
               
               for (const compId of targetCompanyIds) {
                 const holidayRefPath = paths.holiday(compId as string, dateStr);
                 
                 syncUpdates[holidayRefPath] = {
                   id: dateStr,
                   date: dateStr,
                   title: note,
                   note: 'Disinkronkan dari Google Calendar',
                   type: 'holiday',
                   paid: true,
                   active: true,
                   created_by: userData?.uid || "",
                   created_at: Date.now(),
                   updated_at: Date.now()
                 };
               }
               addedCount++;
             }
          }
          
          if (addedCount > 0) {
             await update(ref(db), syncUpdates);
             
             // Log
             for (const compId of targetCompanyIds) {
                 await set(push(ref(db, paths.scheduleChangeLogs(compId as string))), {
                    admin_uid: userData?.uid || "",
                    admin_name: userData?.nama_lengkap || "",
                    action: "SYNC_GOOGLE_CALENDAR",
                    new_value: `Synced ${addedCount} holidays`,
                    created_at: Date.now()
                 });
             }
             
             toast.success(`Berhasil menyinkronkan ${addedCount} hari libur nasional ke ${targetCompanyIds.length} perusahaan!`);
          } else {
             toast.success("Tidak ada hari libur baru yang ditambahkan.");
          }
        } catch (error: any) {
          console.error("Gagal sinkron kalender:", error);
          const msg = error?.message || "";
          let errorType: "unauthorized_domain" | "operation_not_allowed" | "calendar_api_disabled" | "other" = "other";
          if (msg.includes("auth/unauthorized-domain") || msg.includes("unauthorized-domain")) {
            errorType = "unauthorized_domain";
          } else if (msg.includes("auth/operation-not-allowed") || msg.includes("operation-not-allowed")) {
            errorType = "operation_not_allowed";
          } else if (msg.includes("Google Calendar API") || msg.includes("calendar-json.googleapis.com") || msg.includes("accessNotConfigured") || msg.includes("disabled")) {
            errorType = "calendar_api_disabled";
          }
          
          if (errorType !== "other") {
            setFirebaseErrorHelpModal({
              isOpen: true,
              errorType,
              rawMessage: msg
            });
          } else {
            toast.error(error.message || "Gagal menyinkronkan kalender. Mohon coba lagi.");
          }
        } finally {
          setIsSyncingCalendar(false);
        }
      }
    );
  };

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (!tab) return;
    
    // Map alternate names
    const tabMap: Record<string, string> = {
      holidays: "holiday",
      hari_libur: "holiday",
      timetables: "timetable",
      shifts: "shift",
      assignments: "assignment",
      specials: "special",
      summary: "summary",
      overtime: "overtime",
      diagnostic: "diagnostic",
      logs: "logs"
    };
    
    const resolvedTab = tabMap[tab] || tab;
    if (["summary", "timetable", "shift", "assignment", "holiday", "special", "overtime", "diagnostic", "logs"].includes(resolvedTab)) {
      setActiveTab(resolvedTab as any);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!userData) {
      setLoading(false);
      return;
    }

    if (isOwner) {
      get(ref(db, paths.companies())).then((snapshot) => {
        const data = snapshot.exists() ? snapshot.val() : {};
        const compList = Object.keys(data).map(k => ({ ...data[k], id: k }));
        setCompanies(compList);

        const queryCompanyId = searchParams.get("companyId") || "";
        const savedCompanyId = localStorage.getItem("admin_selected_company") || "";

        const resolvedCompanyId =
          queryCompanyId && compList.some((c: any) => c.id === queryCompanyId)
            ? queryCompanyId
            : savedCompanyId && compList.some((c: any) => c.id === savedCompanyId)
              ? savedCompanyId
              : userData.company_id && compList.some((c: any) => c.id === userData.company_id)
                ? userData.company_id
                : compList[0]?.id || "";

        setTargetCompanyId(resolvedCompanyId);

        if (resolvedCompanyId) {
          localStorage.setItem("admin_selected_company", resolvedCompanyId);
        }

        setLoading(false);
      });

      return;
    }

    setTargetCompanyId(getEffectiveCompanyId(userData));
    setLoading(false);
  }, [isOwner, userData, searchParams]);

  useEffect(() => {
    if (!targetCompanyId) return;

    setLoading(true);
    const unsubs: Function[] = [];

    unsubs.push(onValue(ref(db, paths.timetables(targetCompanyId)), snap => {
        setTimetables(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));

    unsubs.push(onValue(ref(db, paths.shifts(targetCompanyId)), snap => {
        setShifts(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));

    unsubs.push(onValue(ref(db, paths.scheduleAssignments(targetCompanyId)), snap => {
        setAssignments(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));

    unsubs.push(onValue(ref(db, paths.holidays(targetCompanyId)), snap => {
        setHolidays(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));

    unsubs.push(onValue(ref(db, paths.scheduleSpecials(targetCompanyId)), snap => {
        setSpecials(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));

    unsubs.push(onValue(ref(db, paths.overtimeSchedules(targetCompanyId)), snap => {
        setOvertimeSchedules(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})) : []);
    }));

    unsubs.push(onValue(ref(db, paths.scheduleChangeLogs(targetCompanyId)), snap => {
        setLogs(snap.exists() ? Object.keys(snap.val()).map(k => ({...snap.val()[k], id: k})).sort((a,b) => b.created_at - a.created_at) : []);
    }));

    // Data needed for dropdowns
    get(ref(db, paths.employeeGroups(targetCompanyId))).then(s => setGroups(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], id: k})) : []));
    get(ref(db, paths.companyUsers(targetCompanyId))).then(s => setEmployees(s.exists() ? Object.keys(s.val()).map(k => ({...s.val()[k], uid: k})) : []));

    setLoading(false);
    return () => unsubs.forEach(u => u());
  }, [targetCompanyId]);

  const findOvertimeConflicts = ({
    scheduleId,
    selectedDates,
    selectedUids,
    workStart,
    workEnd,
  }: {
    scheduleId?: string;
    selectedDates: string[];
    selectedUids: string[];
    workStart: string;
    workEnd: string;
  }) => {
    const conflicts: string[] = [];

    for (const existing of overtimeSchedules) {
      const existingId = existing.id || existing.schedule_id;
      if (scheduleId && existingId === scheduleId) continue;
      if (existing.active === false || existing.status === "inactive") continue;

      const existingWorkStart = String(existing.work_start || "");
      const existingWorkEnd = String(existing.work_end || "");

      for (const dateKey of selectedDates) {
        if (!dateExistsInSchedule(existing, dateKey)) continue;

        for (const uid of selectedUids) {
          if (!targetUidExistsInSchedule(existing, uid)) continue;
          if (!timeRangeOverlaps(workStart, workEnd, existingWorkStart, existingWorkEnd)) continue;

          conflicts.push(
            `${employeeLabelByUid(employees, uid)} sudah memiliki jadwal lembur "${existing.name || "Jadwal Lembur"}" pada ${dateKeyToLabel(dateKey)} pukul ${existingWorkStart || "-"}-${existingWorkEnd || "-"}.`
          );
        }
      }
    }

    return conflicts;
  };

  const renderImpactPreview = () => {
    const targetType = formData.type || "individual";
    const targetId = formData.target_id;
    if (!targetId) return null;

    const uids = resolveTargetUids(targetType === "user" ? "individual" : targetType, targetId);
    if (uids.length === 0) {
      return (
        <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-500 font-mono">
          ℹ️ Tidak ada karyawan yang masuk dalam target penjadwalan saat ini.
        </div>
      );
    }

    return (
      <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/50 rounded-lg text-xs space-y-2">
        <div className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>Dampak Penjadwalan: {uids.length} Karyawan Terpengaruh</span>
        </div>
        <div className="max-h-24 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50 font-mono text-slate-600 dark:text-slate-400">
          {uids.map((uid) => {
            const emp = employees.find((e) => e.uid === uid);
            return (
              <div key={uid} className="py-1 flex justify-between">
                <span>{emp?.nama_lengkap || "Karyawan"}</span>
                <span className="text-slate-400 text-[10px]">{emp?.nip || "-"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderShiftOrTimetableImpactPreview = () => {
    if (!formData.id) return null;

    let uids: string[] = [];
    let label = "";

    if (activeTab === "shift") {
      uids = resolveUsersImpactedByShift(formData.id);
      label = "Pola Shift";
    } else if (activeTab === "timetable") {
      uids = resolveUsersImpactedByTimetable(formData.id);
      label = "Jam Kerja";
    }

    if (uids.length === 0) return null;

    return (
      <div className="p-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/50 rounded-lg text-xs space-y-2 animate-pulse">
        <div className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>Peringatan Dampak: Mengedit {label} ini akan memengaruhi jadwal aktif {uids.length} karyawan!</span>
        </div>
        <div className="max-h-24 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50 font-mono text-slate-600 dark:text-slate-400">
          {uids.map((uid) => {
            const emp = employees.find((e) => e.uid === uid);
            return (
              <div key={uid} className="py-1 flex justify-between">
                <span>{emp?.nama_lengkap || "Karyawan"}</span>
                <span className="text-slate-400 text-[10px]">{emp?.nip || "-"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getCurrentScheduleItem = () => {
    if (!formData?.id) return null;

    if (activeTab === "timetable") {
      return timetables.find((item: any) => item.id === formData.id) || null;
    }

    if (activeTab === "shift") {
      return shifts.find((item: any) => item.id === formData.id) || null;
    }

    if (activeTab === "assignment") {
      return assignments.find((item: any) => item.id === formData.id) || null;
    }

    if (activeTab === "holiday") {
      return holidays.find((item: any) => item.id === formData.id || item.date === formData.id) || null;
    }

    if (activeTab === "special") {
      return specials.find((item: any) => item.id === formData.id) || null;
    }

    if (activeTab === "overtime") {
      return overtimeSchedules.find((item: any) => item.id === formData.id || item.schedule_id === formData.id) || null;
    }

    return null;
  };

  const applyScheduleMetadata = (payload: any, existing?: any) => {
    const now = Date.now();

    return {
      ...payload,
      company_id: targetCompanyId,
      created_at: existing?.created_at || payload.created_at || now,
      created_by: existing?.created_by || payload.created_by || userData?.uid || "",
      created_by_name: existing?.created_by_name || payload.created_by_name || userData?.nama_lengkap || "",
      updated_at: now,
      updated_by: userData?.uid || "",
      updated_by_name: userData?.nama_lengkap || "",
    };
  };

  const getImpactedPreviewForCurrentForm = () => {
    let impactedUids: string[] = [];
    let title = `Simpan ${createLabel()}`;
    let summary = `Data ${createLabel().toLowerCase()} akan disimpan.`;
    let notificationWillBeSent = false;

    if (activeTab === "assignment") {
      impactedUids = resolveTargetUids(formData.type || "individual", formData.target_id || "");
      summary = `Penerapan jadwal akan berdampak ke ${impactedUids.length} karyawan.`;
      notificationWillBeSent = impactedUids.length > 0;
    }

    if (activeTab === "special") {
      impactedUids = resolveTargetUids(formData.type || "individual", formData.target_id || "");
      summary = `Jadwal khusus tanggal ${formData.date || "-"} akan berdampak ke ${impactedUids.length} karyawan.`;
      notificationWillBeSent = impactedUids.length > 0;
    }

    if (activeTab === "overtime") {
      impactedUids = employees
        .map((employee: any) => employee.uid)
        .filter((uid: string) => formData[`target_${uid}`]);

      const selectedDates = sortDateKeys(formData.dates || {});
      summary = `Jadwal lembur untuk ${selectedDates.length} tanggal akan berdampak ke ${impactedUids.length} karyawan.`;
      notificationWillBeSent = impactedUids.length > 0;
    }

    return {
      title,
      summary,
      impactedUids,
      notificationWillBeSent,
    };
  };

  const previewEmployeeLines = (uids: string[]) => {
    if (uids.length === 0) return "- Tidak ada karyawan terdampak";

    const lines = uids.slice(0, 10).map((uid) => {
      return `- ${getEmployeeName(uid)} (${uid})`;
    });

    if (uids.length > 10) {
      lines.push(`+${uids.length - 10} karyawan lainnya`);
    }

    return lines.join("\n");
  };

  const handleCreate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!targetCompanyId) return;

      const createRequest = async () => {
          let listPath = "";
          const existingScheduleItem = getCurrentScheduleItem();
          let newData: any = { ...formData, active: formData.active !== false };

          if (activeTab === "timetable") {
              if (!newData.name || !newData.work_start || !newData.work_end) throw new Error("Data jam kerja belum lengkap.");
              listPath = paths.timetables(targetCompanyId);
              newData.late_tolerance_minute = parseInt(newData.late_tolerance_minute || "0");
              newData.early_out_tolerance_minute = parseInt(newData.early_out_tolerance_minute || "0");
              newData.crosses_midnight = newData.crosses_midnight === true || newData.crosses_midnight === "true";
          } else if (activeTab === "shift") {
              if (!newData.name) throw new Error("Nama pola shift wajib diisi.");
              listPath = paths.shifts(targetCompanyId);
              newData.workday_mode = formData.workday_mode || "custom";
              newData.days = SHIFT_DAY_KEYS.reduce((acc: any, day) => {
                  acc[day] = {
                      active: isActiveValue(formData[`day_${day}`], false),
                      timetable_id: formData[`timetable_${day}`] || "",
                  };
                  return acc;
              }, {});
              
              const activeDays = Object.values(newData.days).filter((d: any) => d.active);
              if (activeDays.length === 0) throw new Error("Minimal satu hari kerja harus aktif.");
              if (activeDays.some((d: any) => !d.timetable_id)) throw new Error("Setiap hari aktif wajib memilih jam kerja.");

              if (newData.workday_mode === "full_week") {
                  const inactive = SHIFT_DAY_KEYS.filter(day => !newData.days[day]?.active);
                  if (inactive.length > 0) {
                      throw new Error(`Mode Senin-Minggu wajib mengaktifkan semua hari: ${inactive.join(", ")}`);
                  }
              }

              SHIFT_DAY_KEYS.forEach(d => {
                  delete newData[`day_${d}`];
                  delete newData[`timetable_${d}`];
              });
          } else if (activeTab === "assignment") {
              if (!newData.target_id || !newData.shift_id || !newData.start_date) throw new Error("Target, shift, dan tanggal mulai wajib diisi.");
              
              if (newData.end_date && newData.end_date < newData.start_date) {
                throw new Error("Tanggal akhir tidak boleh lebih kecil dari tanggal mulai.");
              }

              if (newData.type === "group") {
                if (!groups.some((g: any) => g.id === newData.target_id)) throw new Error("Grup yang dipilih tidak ditemukan.");
              } else {
                if (!employees.some((e: any) => e.uid === newData.target_id)) throw new Error("Karyawan yang dipilih tidak ditemukan.");
              }

              const selectedShift: any = shifts.find((shift: any) => shift.id === newData.shift_id);
              if (!selectedShift) throw new Error("Shift tidak ditemukan.");
              if (selectedShift.active === false || selectedShift.status === "inactive") {
                throw new Error("Shift yang dipilih sedang nonaktif.");
              }

              const shiftDays = selectedShift.days || {};
              const activeShiftDays = Object.values(shiftDays).filter((day: any) => {
                return day && isActiveValue(day.active, false);
              });

              if (activeShiftDays.length === 0 && selectedShift.workday_mode !== "full_week") {
                throw new Error("Shift yang dipilih belum memiliki hari kerja aktif.");
              }

              if (activeShiftDays.some((day: any) => !day.timetable_id) && selectedShift.workday_mode !== "full_week") {
                throw new Error("Shift yang dipilih memiliki hari aktif tanpa jam kerja (timetable).");
              }

              listPath = paths.scheduleAssignments(targetCompanyId);
              newData.created_by = userData?.uid || "";
              if (!newData.end_date) newData.end_date = "";
              
              if (formData.type === "group" && formData._add_to_group) {
                 const updates: any = {};
                 Object.keys(formData._add_to_group).forEach(uid => {
                    if (formData._add_to_group[uid]) {
                        updates[`${paths.companyUsers(targetCompanyId)}/${uid}/group_id`] = newData.target_id;
                    }
                 });
                 if (Object.keys(updates).length > 0) {
                     await update(ref(db), updates);
                 }
              }
              delete newData._add_to_group;
          } else if (activeTab === "holiday") {
              if (!newData.date || !newData.title) throw new Error("Tanggal dan judul libur wajib diisi.");
              // holiday uses date as key
              listPath = paths.holidays(targetCompanyId) + "/" + newData.date;
              newData.type = "holiday";
              newData.created_by = userData?.uid || "";
          } else if (activeTab === "special") {
              if (!newData.date || !newData.title || !newData.target_id || !newData.shift_id) throw new Error("Formulir jadwal khusus belum lengkap.");
              listPath = paths.scheduleSpecials(targetCompanyId);
              newData.created_by = userData?.uid || "";
          } else if (activeTab === "overtime") {
              if (!newData.name || !newData.work_start || !newData.work_end) {
                throw new Error("Nama grup lembur dan jam kerja wajib diisi.");
              }
              
              if (!newData.check_in_start || !newData.check_in_end || !newData.check_out_start || !newData.check_out_end) {
                throw new Error("Jendela check-in dan check-out wajib diisi.");
              }
              
              const selectedDates = sortDateKeys(formData.dates || {});
              if (selectedDates.length === 0) {
                throw new Error("Minimal satu tanggal lembur wajib dipilih.");
              }
              
              const selectedUids = employees
                .map((employee: any) => employee.uid)
                .filter((uid: string) => formData[`target_${uid}`]);
              
              if (selectedUids.length === 0) {
                throw new Error("Minimal satu karyawan wajib dipilih.");
              }
              
              const targetUids = selectedUids.reduce((acc: Record<string, boolean>, uid: string) => {
                acc[uid] = true;
                return acc;
              }, {});
              
              const datesMap = buildDateMap(selectedDates);
              const generatedDays = buildDaysFromDates(selectedDates);
              
              const conflicts = findOvertimeConflicts({
                scheduleId: formData.id,
                selectedDates,
                selectedUids,
                workStart: newData.work_start,
                workEnd: newData.work_end,
              });

              if (conflicts.length > 0) {
                throw new Error(
                  `Jadwal lembur bertabrakan:\n${conflicts.slice(0, 5).join("\n")}${
                    conflicts.length > 5 ? `\n+${conflicts.length - 5} bentrok lainnya.` : ""
                  }`
                );
              }

              listPath = paths.overtimeSchedules(targetCompanyId);
              
              newData = {
                  schedule_id: formData.id || "",
                  company_id: targetCompanyId,
                  name: newData.name.trim(),
                  mode: "group",
                  target_type: "group",
                  target_uids: targetUids,
                  target_count: selectedUids.length,
                  dates: datesMap,
                  work_start: newData.work_start,
                  work_end: newData.work_end,
                  check_in_start: newData.check_in_start,
                  check_in_end: newData.check_in_end,
                  check_out_start: newData.check_out_start,
                  check_out_end: newData.check_out_end,
                  note: newData.note || "",
                  status: newData.active === false || newData.status === "inactive" ? "inactive" : "active",
                  active: newData.active !== false,
                  // Kompatibilitas sementara dengan struktur lama.
                  date_start: selectedDates[0],
                  date_end: selectedDates[selectedDates.length - 1],
                  days: generatedDays,
                  created_by: formData.created_by || userData?.uid || "",
                  created_by_name: formData.created_by_name || userData?.nama_lengkap || "",
                  created_at: formData.created_at || Date.now(),
                  updated_at: Date.now()
              };
          }

          newData = applyScheduleMetadata(newData, existingScheduleItem);

          if (activeTab === "holiday") {
              if (formData.id && formData.id !== newData.date) {
                  // Date changed, remove old date
                  await set(ref(db, paths.holidays(targetCompanyId) + "/" + formData.id), null);
              }
              // It is possible it was google_calendar source, we check if it already exists
              if (formData.id) {
                 const current = holidays.find(h => h.id === formData.id);
                 if (current && current.source === "google_calendar") {
                    newData.manual_override = true;
                    newData.override_by = userData?.uid || "";
                    newData.override_by_name = userData?.nama_lengkap || "";
                    newData.override_at = Date.now();
                 }
              }
              await set(ref(db, paths.holidays(targetCompanyId) + "/" + newData.date), newData);
          } else {
              if (formData.id) {
                  if (activeTab === "overtime") {
                      newData.schedule_id = formData.id;
                      newData.id = formData.id;
                  }
                  await set(ref(db, `${listPath}/${formData.id}`), newData);
              } else {
                  const newRef = push(ref(db, listPath));
                  newData.id = newRef.key;
                  if (activeTab === "overtime") {
                      newData.schedule_id = newRef.key;
                  }
                  await set(newRef, newData);
              }
          }

          if (activeTab === "timetable") {
              const timetableId = formData.id || newData.id;
              const impactedUids = resolveUsersImpactedByTimetable(timetableId);

              if (impactedUids.length > 0) {
                const title = formData.id ? "Jam Kerja Diperbarui" : "Jam Kerja Baru";
                const message = `${newData.name || "Jam kerja"} telah ${formData.id ? "diperbarui" : "ditambahkan"} oleh Admin. Silakan cek jadwal kerja Anda.`;

                await sendScheduleChangeNotifications({
                  uids: impactedUids,
                  title,
                  message,
                  refId: timetableId || "timetable",
                  extraData: {
                    schedule_change_type: "timetable",
                    timetable_id: timetableId || "",
                  },
                });
              }
          }

          if (activeTab === "shift") {
              const shiftId = formData.id || newData.id;
              const impactedUids = resolveUsersImpactedByShift(shiftId);

              if (impactedUids.length > 0) {
                const title = formData.id ? "Pola Shift Diperbarui" : "Pola Shift Baru";
                const message = `${newData.name || "Pola shift"} telah ${formData.id ? "diperbarui" : "ditambahkan"} oleh Admin. Silakan cek jadwal kerja Anda.`;

                await sendScheduleChangeNotifications({
                  uids: impactedUids,
                  title,
                  message,
                  refId: shiftId || "shift",
                  extraData: {
                    schedule_change_type: "shift",
                    shift_id: shiftId || "",
                  },
                });
              }
          }

          if (activeTab === "holiday") {
              const impactedUids = resolveUsersImpactedByHoliday();
              const title = formData.id ? "Hari Libur Diperbarui" : "Hari Libur Baru";
              const message = `${newData.title || "Hari libur"} pada ${dateKeyToLabel(newData.date)} telah ${formData.id ? "diperbarui" : "ditambahkan"}.`;

              await sendScheduleChangeNotifications({
                uids: impactedUids,
                title,
                message,
                refId: newData.date || "holiday",
                extraData: {
                  schedule_change_type: "holiday",
                  holiday_date: newData.date || "",
                },
              });
          }

          if (activeTab === "overtime") {
              const scheduleId = formData.id || newData.schedule_id || newData.id;
              const targetUids = Object.keys(newData.target_uids || {});
              const notificationTitle = formData.id ? "Jadwal Lembur Diperbarui" : "Jadwal Lembur Ditambahkan";
              const selectedDateLabels = sortDateKeys(newData.dates || {})
                .map(dateKeyToLabel)
                .join(", ");
              const notificationMessage = `${newData.name}: ${selectedDateLabels}, ${newData.work_start}-${newData.work_end}.`;

              await sendScheduleChangeNotifications({
                  uids: targetUids,
                  title: notificationTitle,
                  message: notificationMessage,
                  refId: scheduleId || "overtime",
                  extraData: {
                      schedule_change_type: "overtime",
                      overtime_schedule_id: scheduleId || "",
                  }
              });
          }

          if (activeTab === "assignment") {
              const scheduleId = formData.id || newData.id;
              const notificationTitle = formData.id ? "Penerapan Jadwal Diperbarui" : "Penerapan Jadwal Baru";
              const notificationMessage = `Jadwal kerja Anda telah diperbarui oleh Admin. Silakan cek detail di menu Jadwal.`;
              await notifyUsersOfScheduleChange(
                  newData.type || "individual",
                  newData.target_id,
                  notificationTitle,
                  notificationMessage,
                  scheduleId || "assignment",
                  {
                      schedule_change_type: "assignment",
                      assignment_id: scheduleId || "",
                  }
              );
          }

          if (activeTab === "special") {
              const scheduleId = formData.id || newData.id;
              const notificationTitle = formData.id ? "Jadwal Khusus Diperbarui" : "Jadwal Khusus Baru";
              const notificationMessage = `Anda mendapat jadwal khusus pada tanggal ${newData.date}. Silakan cek detail jadwal Anda.`;
              await notifyUsersOfScheduleChange(
                  newData.type || "individual",
                  newData.target_id,
                  notificationTitle,
                  notificationMessage,
                  scheduleId || "special",
                  {
                      schedule_change_type: "special",
                      special_id: scheduleId || "",
                      date: newData.date || "",
                  }
              );
          }

          // Log action
          const isGoogleOverride = activeTab === "holiday" && formData.id && holidays.find(h => h.id === formData.id)?.source === "google_calendar";
          const action = activeTab === "overtime"
              ? (formData.id ? "UPDATE_OVERTIME_SCHEDULE" : "CREATE_OVERTIME_SCHEDULE")
              : isGoogleOverride 
                  ? "EDIT_GOOGLE_CALENDAR_HOLIDAY"
                  : (formData.id ? `EDIT_${activeTab.toUpperCase()}` : `CREATE_${activeTab.toUpperCase()}`);

          const logRef = push(ref(db, paths.scheduleChangeLogs(targetCompanyId)));
          await set(logRef, {
              admin_uid: userData?.uid || "",
              admin_name: userData?.nama_lengkap || "",
              action,
              ref_type: activeTab === "overtime" ? "overtime_schedule" : activeTab,
              ref_id: activeTab === "overtime" ? (newData.schedule_id || newData.id || formData.id || "") : (newData.id || formData.id || ""),
              new_value: activeTab === "holiday" ? newData.date : (newData.name || newData.id || ""),
              created_at: Date.now()
          });

          return "Berhasil menyimpan data";
      };

      const runCreateRequest = () => {
        toast.promise(createRequest(), {
          loading: 'Menyimpan...',
          success: (msg) => {
              setFormData({});
              setShowModal(false);
              return msg;
          },
          error: (err) => `Gagal menyimpan: ${err.message}`
        });
      };

      if (["assignment", "special", "overtime"].includes(activeTab)) {
        const preview = getImpactedPreviewForCurrentForm();

        setSavePreview({
          isOpen: true,
          ...preview,
          onConfirm: () => {
            setSavePreview(prev => ({ ...prev, isOpen: false }));
            runCreateRequest();
          },
        });

        return;
      }

      runCreateRequest();
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    if (!targetCompanyId) return;

    const toggleRequest = async () => {
      let itemPath = "";
      if (activeTab === "timetable") itemPath = paths.timetable(targetCompanyId, id);
      else if (activeTab === "shift") itemPath = paths.shift(targetCompanyId, id);
      else if (activeTab === "assignment") itemPath = paths.scheduleAssignment(targetCompanyId, id);
      else if (activeTab === "holiday") itemPath = paths.holiday(targetCompanyId, id);
      else if (activeTab === "special") itemPath = paths.scheduleSpecial(targetCompanyId, id);
      else if (activeTab === "overtime") itemPath = paths.overtimeSchedule(targetCompanyId, id);

      if(itemPath) {
          await update(ref(db, itemPath), {
            active: !currentActive,
            updated_at: Date.now()
          });
          
          await set(push(ref(db, paths.scheduleChangeLogs(targetCompanyId))), {
              admin_uid: userData?.uid || "",
              admin_name: userData?.nama_lengkap || "",
              action: `TOGGLE_${activeTab.toUpperCase()}`,
              target_id: id,
              new_value: !currentActive,
              created_at: Date.now()
          });

          // Kirim notifikasi jika berdampak ke user
          let uids: string[] = [];
          let title = "";
          let message = "";
          let notificationRefId = id;
          let extra: Record<string, any> = {};

          if (activeTab === "timetable") {
            uids = resolveUsersImpactedByTimetable(id);
            title = currentActive ? "Jam Kerja Dinonaktifkan" : "Jam Kerja Diaktifkan";
            message = `Jam kerja Anda telah ${currentActive ? "dinonaktifkan" : "diaktifkan kembali"} oleh Admin. Silakan cek detail jadwal Anda.`;
            extra = { schedule_change_type: "timetable", timetable_id: id };
          } else if (activeTab === "shift") {
            uids = resolveUsersImpactedByShift(id);
            title = currentActive ? "Pola Shift Dinonaktifkan" : "Pola Shift Diaktifkan";
            message = `Pola shift Anda telah ${currentActive ? "dinonaktifkan" : "diaktifkan kembali"} oleh Admin. Silakan cek detail jadwal Anda.`;
            extra = { schedule_change_type: "shift", shift_id: id };
          } else if (activeTab === "assignment") {
            const assignment = assignments.find(a => a.id === id);
            if (assignment) {
              uids = resolveTargetUids(assignment.type || "individual", assignment.target_id);
              title = currentActive ? "Penerapan Jadwal Dinonaktifkan" : "Penerapan Jadwal Diaktifkan";
              message = `Penerapan jadwal kerja Anda telah ${currentActive ? "dinonaktifkan" : "diaktifkan kembali"} oleh Admin.`;
              extra = { schedule_change_type: "assignment", assignment_id: id, target_type: assignment.type, target_id: assignment.target_id };
            }
          } else if (activeTab === "special") {
            const special = specials.find(s => s.id === id);
            if (special) {
              uids = resolveTargetUids(special.type || "individual", special.target_id);
              title = currentActive ? "Jadwal Khusus Dinonaktifkan" : "Jadwal Khusus Diaktifkan";
              message = `Jadwal khusus Anda pada tanggal ${special.date || ""} telah ${currentActive ? "dinonaktifkan" : "diaktifkan kembali"} oleh Admin.`;
              extra = { schedule_change_type: "special", special_id: id, date: special.date, target_type: special.type, target_id: special.target_id };
            }
          } else if (activeTab === "overtime") {
            const overtime = overtimeSchedules.find(o => o.id === id);
            if (overtime) {
              uids = Object.keys(overtime.target_uids || {});
              title = currentActive ? "Jadwal Lembur Dinonaktifkan" : "Jadwal Lembur Diaktifkan";
              message = `Jadwal lembur '${overtime.name}' Anda telah ${currentActive ? "dinonaktifkan" : "diaktifkan kembali"} oleh Admin.`;
              extra = { schedule_change_type: "overtime", overtime_schedule_id: id };
            }
          } else if (activeTab === "holiday") {
            uids = resolveUsersImpactedByHoliday();
            title = currentActive ? "Hari Libur Dinonaktifkan" : "Hari Libur Diaktifkan";
            message = `Hari libur yang sebelumnya ditetapkan telah ${currentActive ? "dinonaktifkan" : "diaktifkan kembali"} oleh Admin.`;
            extra = { schedule_change_type: "holiday", holiday_id: id };
          }

          if (uids.length > 0) {
              await sendScheduleChangeNotifications({
                  uids,
                  title,
                  message,
                  refId: notificationRefId,
                  extraData: extra
              });
          }

          return "Berhasil diubah";
      }
      throw new Error("Invalid path");
    };

    toast.promise(toggleRequest(), {
        loading: 'Memproses...',
        success: (msg) => msg,
        error: (err) => `Gagal update: ${err.message}`
    });
  };

  const getFallbackTimetableId = () => {
    const selected = SHIFT_DAY_KEYS
      .map(day => formData[`timetable_${day}`])
      .find(Boolean);

    return selected || timetables[0]?.id || "";
  };

  const applyShiftPreset = (mode: "full_week" | "weekday" | "clear") => {
    const fallbackTimetableId = getFallbackTimetableId();
    const next: any = { ...formData };

    SHIFT_DAY_KEYS.forEach(day => {
      const active =
        mode === "full_week"
          ? true
          : mode === "weekday"
            ? !["saturday", "sunday"].includes(day)
            : false;

      next[`day_${day}`] = active;

      if (active) {
        next[`timetable_${day}`] = next[`timetable_${day}`] || fallbackTimetableId;
      } else if (mode === "clear") {
        next[`timetable_${day}`] = "";
      }
    });

    next.workday_mode = mode === "full_week"
      ? "full_week"
      : mode === "weekday"
        ? "weekday"
        : "custom";

    setFormData(next);
  };

  const repairShiftToFullWeek = async (shift: any) => {
    if (!targetCompanyId || !shift?.id) return;

    const days = shift.days || {};
    const fallbackTimetableId =
      SHIFT_DAY_KEYS
        .map(day => days?.[day]?.timetable_id)
        .find(Boolean) ||
      timetables[0]?.id ||
      "";

    if (!fallbackTimetableId) {
      toast.error("Tidak ada jam kerja/timetable untuk diterapkan ke semua hari.");
      return;
    }

    const nextDays = SHIFT_DAY_KEYS.reduce((acc: any, day) => {
      acc[day] = {
        active: true,
        timetable_id: days?.[day]?.timetable_id || fallbackTimetableId,
      };
      return acc;
    }, {});

    try {
      await update(ref(db, paths.shift(targetCompanyId, shift.id)), {
        days: nextDays,
        workday_mode: "full_week",
        updated_at: Date.now(),
        updated_by: userData?.uid || "",
      });

      await set(push(ref(db, paths.scheduleChangeLogs(targetCompanyId))), {
        admin_uid: userData?.uid || "",
        admin_name: userData?.nama_lengkap || "",
        action: "REPAIR_SHIFT_FULL_WEEK",
        ref_type: "shift",
        ref_id: shift.id,
        new_value: shift.name || shift.id,
        created_at: Date.now(),
      });

      toast.success("Shift diset aktif Senin sampai Minggu.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

    const handleDelete = async (id: string) => {
    if (!targetCompanyId) return;

    requestConfirm(
      "Hapus Data",
      `Apakah Anda yakin ingin menghapus data ${createLabel().toLowerCase()} ini? Data yang sudah dihapus tidak dapat dikembalikan.`,
      true,
      async () => {
        try {
          let itemPath = "";
          let collectionType = activeTab;

          if (activeTab === "timetable") itemPath = paths.timetable(targetCompanyId, id);
          else if (activeTab === "shift") itemPath = paths.shift(targetCompanyId, id);
          else if (activeTab === "assignment") itemPath = paths.scheduleAssignment(targetCompanyId, id);
          else if (activeTab === "holiday") itemPath = paths.holiday(targetCompanyId, id);
          else if (activeTab === "special") itemPath = paths.scheduleSpecial(targetCompanyId, id);
          else if (activeTab === "overtime") {
            itemPath = paths.overtimeSchedule(targetCompanyId, id);
            collectionType = "overtime_schedule" as any;
          }

          if (itemPath) {
            let uids: string[] = [];
            let title = "";
            let message = "";
            let extra: Record<string, any> = {};

            if (activeTab === "timetable") {
              uids = resolveUsersImpactedByTimetable(id);
              title = "Jam Kerja Dihapus";
              message = `Jam kerja yang jadwal Anda gunakan telah dihapus oleh Admin. Silakan hubungi admin untuk info lebih lanjut.`;
              extra = { schedule_change_type: "timetable", timetable_id: id };
            } else if (activeTab === "shift") {
              uids = resolveUsersImpactedByShift(id);
              title = "Pola Shift Dihapus";
              message = `Pola shift yang jadwal Anda gunakan telah dihapus oleh Admin. Silakan hubungi admin untuk info lebih lanjut.`;
              extra = { schedule_change_type: "shift", shift_id: id };
            } else if (activeTab === "assignment") {
              const oldAssignment = assignments.find(a => a.id === id);
              if (oldAssignment) {
                uids = resolveTargetUids(oldAssignment.type || "individual", oldAssignment.target_id);
                title = "Penerapan Jadwal Dihapus";
                message = "Penerapan jadwal kerja Anda telah dibatalkan oleh Admin.";
                extra = { schedule_change_type: "assignment", assignment_id: id, target_type: oldAssignment.type, target_id: oldAssignment.target_id };
              }
            } else if (activeTab === "special") {
              const oldSpecial = specials.find(s => s.id === id);
              if (oldSpecial) {
                uids = resolveTargetUids(oldSpecial.type || "individual", oldSpecial.target_id);
                title = "Jadwal Khusus Dihapus";
                message = `Jadwal khusus Anda pada tanggal ${oldSpecial.date || ""} telah dibatalkan oleh Admin.`;
                extra = { schedule_change_type: "special", special_id: id, date: oldSpecial.date, target_type: oldSpecial.type, target_id: oldSpecial.target_id };
              }
            } else if (activeTab === "holiday") {
              uids = resolveUsersImpactedByHoliday();
              title = "Hari Libur Dihapus";
              message = "Hari libur yang sebelumnya ditetapkan telah dibatalkan oleh Admin.";
              extra = { schedule_change_type: "holiday", holiday_id: id };
            } else if (activeTab === "overtime") {
              const oldOvertime = overtimeSchedules.find(o => o.id === id);
              if (oldOvertime) {
                uids = Object.keys(oldOvertime.target_uids || {});
                title = "Jadwal Lembur Dihapus";
                message = `Jadwal lembur '${oldOvertime.name}' Anda telah dibatalkan oleh Admin.`;
                extra = { schedule_change_type: "overtime", overtime_schedule_id: id };
              }
            }

            await set(ref(db, itemPath), null);

            await set(push(ref(db, paths.scheduleChangeLogs(targetCompanyId))), {
              admin_uid: userData?.uid || "",
              admin_name: userData?.nama_lengkap || "",
              action: `DELETE_${collectionType.toUpperCase()}`,
              target_id: id,
              new_value: "DELETED",
              created_at: Date.now()
            });

            if (uids.length > 0) {
              await sendScheduleChangeNotifications({
                  uids,
                  title,
                  message,
                  refId: id,
                  extraData: extra
              });
            }

            toast.success("Berhasil dihapus");
          }
        } catch (error: any) {
          toast.error("Gagal menghapus: " + error.message);
        }
      }
    );
  };

  const createLabel = () => {
      switch (activeTab) {
        case "timetable":
          return "Jam Kerja";
        case "shift":
          return "Pola Shift";
        case "assignment":
          return "Penerapan Jadwal";
        case "holiday":
          return "Hari Libur";
        case "special":
          return "Jadwal Khusus";
        case "overtime":
          return "Jadwal Lembur";
        default:
          return "Data";
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
      <ConfirmModal
        isOpen={savePreview.isOpen}
        title={savePreview.title}
        message={`${savePreview.summary}

Jumlah target: ${savePreview.impactedUids.length} karyawan.
Notifikasi: ${savePreview.notificationWillBeSent ? "akan dikirim" : "tidak dikirim"}.

Target terdampak:
${previewEmployeeLines(savePreview.impactedUids)}`}
        isDestructive={false}
        onConfirm={savePreview.onConfirm}
        onCancel={() => setSavePreview(prev => ({ ...prev, isOpen: false }))}
      />
      {firebaseErrorHelpModal.isOpen && (() => {
        const getGcpEnableUrl = (msg: string) => {
          const match = msg.match(/https:\/\/console\.[^\s"']+/i);
          return match ? match[0].replace(/[.,;:()'"\s]+$/, "") : null;
        };
        const gcpEnableUrl = getGcpEnableUrl(firebaseErrorHelpModal.rawMessage);
        
        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
            <div className="bg-white dark:bg-slate-900 max-w-2xl w-full rounded-2xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200 text-slate-800 dark:text-slate-200">
              <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center text-amber-600">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white leading-tight">
                      {firebaseErrorHelpModal.errorType === "operation_not_allowed" 
                        ? "Google Sign-In Belum Aktif di Firebase" 
                        : firebaseErrorHelpModal.errorType === "calendar_api_disabled"
                        ? "Google Calendar API Belum Aktif"
                        : "Domain Belum Diotorisasi di Firebase"}
                    </h3>
                    <p className="text-xs text-slate-500 font-sans mt-0.5">Konfigurasi Tambahan Diperlukan</p>
                  </div>
                </div>
                <button 
                  onClick={() => setFirebaseErrorHelpModal({ ...firebaseErrorHelpModal, isOpen: false })}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto font-sans">
                {firebaseErrorHelpModal.errorType === "operation_not_allowed" ? (
                  <>
                    <p className="text-sm leading-relaxed">
                      Sinkronisasi Google Calendar membutuhkan token otorisasi yang aman. Saat ini, metode login Google belum diaktifkan pada proyek Firebase (Authentication) milik Anda.
                    </p>
                    
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 font-sans">
                      <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Langkah Penyelesaian:</h4>
                      <ol className="list-decimal list-inside space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
                        <li>
                          Buka <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 font-semibold inline-flex items-center gap-0.5 hover:underline font-sans">Firebase Console <ExternalLink className="w-3 h-3" /></a> dan pilih proyek Anda.
                        </li>
                        <li>
                          Pergi ke menu <span className="font-bold">Authentication</span> pada navigasi kiri, kemudian klik tab <span className="font-bold">Sign-in method</span>.
                        </li>
                        <li>
                          Klik tombol <span className="font-bold">Add new provider</span> (Tambah penyedia baru) dan pilih <span className="font-bold text-blue-600">Google</span>.
                        </li>
                        <li>
                          Aktifkan tombol toggle <span className="font-bold">Enable</span>, pilih <span className="font-bold">Project support email</span> Anda, lalu klik <span className="font-bold bg-blue-50 dark:bg-blue-950 text-blue-600 px-1 py-0.5 rounded">Save / Simpan</span>.
                        </li>
                        <li>
                          Kembali ke halaman ini dan coba klik kembali tombol <span className="font-bold text-emerald-600">Sync Kalender Indonesia</span>.
                        </li>
                      </ol>
                    </div>
                  </>
                ) : firebaseErrorHelpModal.errorType === "calendar_api_disabled" ? (
                  <>
                    <p className="text-sm leading-relaxed">
                      Fitur sinkronisasi kalender membutuhkan layanan <span className="font-bold">Google Calendar API</span> diaktifkan pada konsol Google Cloud Platform (GCP) milik Anda agar aplikasi diperbolehkan menarik data hari libur nasional.
                    </p>
                    
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 font-sans">
                      <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Langkah Penyelesaian:</h4>
                      <ol className="list-decimal list-inside space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
                        {gcpEnableUrl ? (
                          <li>
                            Klik tombol biru <span className="font-bold">Aktifkan API Sekarang</span> di kanan bawah, atau klik tautan aktivasi langsung dari Google berikut:
                            <div className="mt-2 pl-4">
                              <a 
                                href={gcpEnableUrl} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-blue-600 dark:text-blue-400 font-semibold inline-flex items-center gap-1 hover:underline break-all"
                              >
                                {gcpEnableUrl} <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                              </a>
                            </div>
                          </li>
                        ) : (
                          <>
                            <li>
                              Buku <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 font-semibold inline-flex items-center gap-0.5 hover:underline font-sans">Google Cloud Console <ExternalLink className="w-3 h-3" /></a> dan pastikan Anda memilih proyek yang sesuai.
                            </li>
                            <li>
                              Buka menu utama di kiri atas, pilih <span className="font-bold">APIs & Services</span>, lalu klik <span className="font-bold">Library</span>.
                            </li>
                            <li>
                              Cari <span className="font-bold">"Google Calendar API"</span> di kotak pencarian, klik layanannya, lalu klik tombol <span className="font-bold text-emerald-600 font-sans">Enable / Aktifkan</span>.
                            </li>
                          </>
                        )}
                        <li>
                          Tunggu sekitar 30 detik hingga 1 menit agar perubahan diaplikasikan oleh sistem Google, kemudian kembali ke halaman ini dan ulangi proses sinkronisasi kalender Anda.
                        </li>
                      </ol>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed">
                      Domain aplikasi ini belum dimasukkan ke daftar domain yang diizinkan (Authorized Domains) di menu Firebase Authentication proyek Anda. Firebase memblokir proses masuk demi keamanan.
                    </p>
                    
                    <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 font-sans">
                      <h4 className="font-semibold text-sm text-slate-800 dark:text-slate-200">Langkah Penyelesaian:</h4>
                      <ol className="list-decimal list-inside space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
                        <li>
                          Buka <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 font-semibold inline-flex items-center gap-0.5 hover:underline font-sans">Firebase Console <ExternalLink className="w-3 h-3" /></a> dan pilih proyek Anda.
                        </li>
                        <li>
                          Masuk ke menu <span className="font-bold">Authentication</span>, klik tab <span className="font-bold">Settings</span> di bagian kanan atas, lalu pilih menu <span className="font-bold text-amber-600">Authorized domains</span>.
                        </li>
                        <li className="space-y-1.5">
                          <span>Klik tombol <span className="font-bold">Add domain</span> dan masukkan domain aplikasi berikut satu per satu:</span>
                          <div className="space-y-2 my-2 pl-4">
                            {[
                              window.location.hostname,
                              "ais-dev-qldee2cedor5ds3ifue6o5-203816477998.asia-southeast1.run.app",
                              "ais-pre-qldee2cedor5ds3ifue6o5-203816477998.asia-southeast1.run.app"
                            ].filter(Boolean).map((domain, idx) => (
                              <div key={idx} className="flex items-center gap-2 justify-between max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-[11px] font-mono select-all">
                                <span className="truncate">{domain}</span>
                                <button
                                  onClick={() => handleCopyText(domain)}
                                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                                  title="Salin Domain"
                                >
                                  {copiedText === domain ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        </li>
                        <li>
                          Klik <span className="font-bold bg-blue-50 dark:bg-blue-950 text-blue-600 px-1 py-0.5 rounded">Add / Tambahkan</span> untuk menyimpan setiap domain tersebut.
                        </li>
                        <li>
                          Tunggu sekitar 10 detik, lalu muat ulang halaman ini dan ulangi proses sinkronisasi kalender.
                        </li>
                      </ol>
                    </div>
                  </>
                )}
                
                <div className="text-[11px] text-slate-400 font-mono mt-4 truncate max-w-full">
                  Sistem internal detail error: {firebaseErrorHelpModal.rawMessage}
                </div>
              </div>
              
              <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex justify-end gap-3">
                <button
                  onClick={() => setFirebaseErrorHelpModal({ ...firebaseErrorHelpModal, isOpen: false })}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-sm font-medium transition"
                >
                  Tutup Panduan
                </button>
                <a
                  href={
                    firebaseErrorHelpModal.errorType === "calendar_api_disabled"
                      ? (gcpEnableUrl || "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com")
                      : "https://console.firebase.google.com/"
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition inline-flex items-center gap-1.5"
                >
                  {firebaseErrorHelpModal.errorType === "calendar_api_disabled" 
                    ? "Aktifkan API Sekarang" 
                    : "Buka Firebase Console"}
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Jam Kerja & Penjadwalan</h1>
          <p className="text-sm text-slate-500">Kelola operasional waktu kerja, penerapan jadwal, dan hari libur</p>
        </div>
        {targetCompanyId && (activeTab === "timetable" || activeTab === "shift" || activeTab === "assignment" || activeTab === "holiday" || activeTab === "special" || activeTab === "overtime") && (
          <div className="flex items-center gap-3">
            {activeTab === "holiday" && isOwner && (
              <div className="flex items-center gap-3 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 px-3 bg-slate-50 dark:bg-slate-950/50">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={syncCalendarAllCompanies}
                    onChange={(e) => setSyncCalendarAllCompanies(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                  />
                  <span>Terapkan ke semua perusahaan</span>
                </label>
                <button
                  onClick={handleSyncGoogleCalendar}
                  disabled={isSyncingCalendar}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-400 text-white rounded text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  {isSyncingCalendar ? "Menyinkronkan..." : "Sync Kalender Indonesia"}
                </button>
              </div>
            )}
            <button
              onClick={() => { setFormData({}); setShowModal(true); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
            >
              + Buat {createLabel()}
            </button>
          </div>
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
            {companies.map((c: any, index: number) => (
              <option key={c.id} value={c.id}>{companyDisplayName(c, `Perusahaan ${index + 1}`)}</option>
            ))}
          </select>
        </div>
      )}

      {targetCompanyId && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-xs text-slate-600 dark:text-slate-300">
          Perusahaan aktif:{" "}
          <span className="font-semibold text-blue-600 dark:text-blue-400">
            {companies.find((c: any) => c.id === targetCompanyId)
              ? companyDisplayName(companies.find((c: any) => c.id === targetCompanyId), targetCompanyId)
              : targetCompanyId}
          </span>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-blue-500">Memuat data jadwal...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : (
        <>
          <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
            {[
              { id: "summary", label: "Ringkasan" },
              { id: "timetable", label: "Jam Kerja" },
              { id: "shift", label: "Pola Shift" },
              { id: "assignment", label: "Terapkan Jadwal" },
              { id: "holiday", label: "Hari Libur" },
              { id: "special", label: "Jadwal Khusus" },
              { id: "overtime", label: "Jadwal Lembur" },
              { id: "diagnostic", label: "Cek Jadwal Karyawan" },
              { id: "logs", label: "Riwayat Perubahan" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                  activeTab === tab.id 
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500" 
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden min-h-[400px]">
             {activeTab === "summary" && (
                <div className="p-6">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">Ringkasan Operasional Jadwal</h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                            <div className="text-slate-500 text-xs font-semibold uppercase mb-1">Total Jam Kerja</div>
                            <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{timetables.length}</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                            <div className="text-slate-500 text-xs font-semibold uppercase mb-1">Total Pola Shift</div>
                            <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{shifts.length}</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                            <div className="text-slate-500 text-xs font-semibold uppercase mb-1">Penerapan Jadwal Aktif</div>
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{assignments.filter(a => a.active).length}</div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                            <div className="text-slate-500 text-xs font-semibold uppercase mb-1">Total Karyawan</div>
                            <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{employees.length}</div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {(() => {
                           const withoutGroup = employees.filter(e => !e.group_id).length;
                           if (withoutGroup > 0) return (
                               <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800/50 p-4 rounded-lg text-sm">
                                   <strong>Perhatian:</strong> Ada <strong>{withoutGroup} karyawan</strong> yang belum dimasukkan ke <em>Grup Karyawan</em>. Karyawan tersebut mungkin belum bisa menggunakan presensi jika jadwal diterapkan berdasarkan Grup.
                               </div>
                           );
                           return null;
                        })()}

                        {(() => {
                           const withoutOffice = employees.filter(e => !e.office_id).length;
                           if (withoutOffice > 0) return (
                               <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800/50 p-4 rounded-lg text-sm">
                                   <strong>Perhatian:</strong> Ada <strong>{withoutOffice} karyawan</strong> yang belum memilih <em>Kantor / Lokasi</em> kerjanya. Absensi menggunakan geofencing (radius) mungkin tidak akan berfungsi bagi mereka.
                               </div>
                           );
                           return null;
                        })()}

                        {(() => {
                           const incompleteShifts = shifts.filter(s => {
                               const days = s.days as any || {};
                               const activeDays = Object.values(days).filter((d: any) => d && d.active);
                               if (activeDays.length === 0) return true;
                               return activeDays.some((d: any) => !d.timetable_id);
                           }).length;
                           if (incompleteShifts > 0) return (
                               <div className="bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800/50 p-4 rounded-lg text-sm">
                                   <strong>Awas:</strong> Ditemukan <strong>{incompleteShifts} pola shift</strong> yang tidak lengkap (hari kerja tidak memiliki pilihan jam kerja, atau tidak ada hari kerja aktif). Mohon periksa kembali agar status absen akurat.
                               </div>
                           );
                           return null;
                        })()}
                    </div>
                </div>
             )}

             {activeTab === "diagnostic" && (
                <div className="p-6">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4">Cek Jadwal Karyawan</h2>
                    <div className="flex flex-col md:flex-row gap-4 mb-6">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Pilih Karyawan</label>
                            <select value={diagnosticUid} onChange={e => setDiagnosticUid(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                                <option value="" disabled>-- Pilih Karyawan --</option>
                                {employees.map((e: any, index: number) => (
                                    <option key={e.uid || `employee-diagnostic-${index}`} value={e.uid}>
                                        {employeeDisplayName(e, `Karyawan ${index + 1}`)}
                                        {e.nip ? ` - ${e.nip}` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Tanggal</label>
                            <input type="date" value={diagnosticDate} onChange={e => setDiagnosticDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" />
                        </div>
                        <div className="flex items-end">
                            <button onClick={runDiagnostic} disabled={isDiagnosticLoading} className="w-full md:w-auto px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-400 text-white rounded text-sm font-medium">
                                {isDiagnosticLoading ? "Mengecek..." : "Cek Jadwal"}
                            </button>
                        </div>
                    </div>
                    
                    {diagnosticResult && (
                        <div className={`p-5 rounded-lg border ${diagnosticResult.canAttend ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : diagnosticResult.ok ? 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <span className="text-2xl">{diagnosticResult.canAttend ? '✅' : diagnosticResult.ok ? 'ℹ️' : '❌'}</span>
                                <div>
                                    <h3 className={`font-bold ${diagnosticResult.canAttend ? 'text-emerald-700 dark:text-emerald-400' : diagnosticResult.ok ? 'text-blue-700 dark:text-blue-400' : 'text-red-700 dark:text-red-400'}`}>
                                        {diagnosticResult.canAttend ? "Siap digunakan untuk absen" : diagnosticResult.ok ? diagnosticResult.status : "Belum bisa digunakan untuk absen"}
                                    </h3>
                                </div>
                            </div>
                            
                            <div className="mb-4">
                                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Penyebab / Status:</div>
                                <div className="text-sm text-slate-600 dark:text-slate-400 bg-white/50 dark:bg-slate-900/50 p-3 rounded">{diagnosticResult.reason}</div>
                            </div>
                            
                            {diagnosticResult.employee && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm mt-6 p-4 bg-white/50 dark:bg-slate-900/50 rounded-lg">
                                    <div><span className="text-slate-500 w-32 inline-block">Karyawan</span>: <span className="font-medium text-slate-800 dark:text-slate-200">{diagnosticResult.employee.nama_lengkap}</span></div>
                                    <div><span className="text-slate-500 w-32 inline-block">Tanggal</span>: <span className="font-medium text-slate-800 dark:text-slate-200">{new Date(diagnosticDate).toLocaleDateString('id-ID', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</span></div>
                                    {diagnosticResult.groupName && <div><span className="text-slate-500 w-32 inline-block">Grup</span>: <span className="font-medium text-slate-800 dark:text-slate-200">{diagnosticResult.groupName.replace('Group: ', '')}</span></div>}
                                    {diagnosticResult.officeName && <div><span className="text-slate-500 w-32 inline-block">Kantor</span>: <span className="font-medium text-slate-800 dark:text-slate-200">{diagnosticResult.officeName.replace('Office: ', '')}</span></div>}
                                    
                                    {diagnosticResult.details?.source && <div className="col-span-1 md:col-span-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/50"><span className="text-slate-500 w-32 inline-block">Sumber Jadwal</span>: <span className="font-medium text-blue-600 dark:text-blue-400">{diagnosticResult.details.source}</span></div>}
                                    
                                    {diagnosticResult.details?.shift && <div><span className="text-slate-500 w-32 inline-block">Pola Shift</span>: <span className="font-medium text-slate-800 dark:text-slate-200">{diagnosticResult.details.shift.name}</span></div>}
                                    {diagnosticResult.details?.timetable && <div><span className="text-slate-500 w-32 inline-block">Jam Kerja</span>: <span className="font-medium text-slate-800 dark:text-slate-200">{diagnosticResult.details.timetable.name}</span></div>}
                                    
                                    {diagnosticResult.details?.timetable && (
                                        <>
                                        <div className="col-span-1 md:col-span-2 grid grid-cols-2 mt-2 gap-4">
                                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 rounded">
                                                <div className="text-xs text-slate-500 uppercase">Wajib Hadir</div>
                                                <div className="font-mono text-slate-800 dark:text-slate-200 font-bold">{diagnosticResult.details.timetable.work_start} - {diagnosticResult.details.timetable.work_end}</div>
                                            </div>
                                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2 rounded">
                                                <div className="text-xs text-slate-500 uppercase">Jendela Absen</div>
                                                <div className="font-mono text-xs text-slate-600 dark:text-slate-400">In: {diagnosticResult.details.timetable.check_in_start}-{diagnosticResult.details.timetable.check_in_end} </div>
                                                <div className="font-mono text-xs text-slate-600 dark:text-slate-400">Out: {diagnosticResult.details.timetable.check_out_start}-{diagnosticResult.details.timetable.check_out_end}</div>
                                            </div>
                                        </div>
                                        <div className="col-span-1 md:col-span-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800/50">
                                            <div className="text-[11px] text-slate-500">
                                                <strong>Testing Reminder:</strong><br/>
                                                Jadwal ini sudah valid. Jika ingin mengetes reminder otomatis, 
                                                pastikan <code>work_start</code> sekitar 6-10 menit dari sekarang,
                                                dan tunggu scheduler berjalan (otomatis setiap 5 menit).
                                            </div>
                                        </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
             )}

             {activeTab === "timetable" && (
                 timetables.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada jam kerja.</div> : (
                 <table className="w-full text-sm text-left">
                     <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Nama Jam Kerja</th><th className="px-6 py-3 font-medium">Waktu Kerja</th><th className="px-6 py-3 font-medium">Jendela Absen</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                     <tbody className="divide-y divide-slate-800">
                         {timetables.map(t => (
                             <tr key={t.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                 <td className="px-6 py-4 font-medium">{t.name}</td>
                                 <td className="px-6 py-4">
                                     <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">{t.work_start} - {t.work_end}</div>
                                     <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 bg-slate-50 dark:bg-slate-900/40 p-1.5 rounded border border-slate-150 dark:border-slate-800/60 leading-relaxed font-mono">
                                         <div>🔔 Reminder masuk: <span className="font-semibold text-blue-600 dark:text-blue-400">{subtractMinutesFromTime(t.work_start, 5)}</span> (5m sebelum)</div>
                                         <div>🎯 Tepat masuk: <span className="font-semibold text-slate-700 dark:text-slate-300">{t.work_start}</span></div>
                                         <div>⏰ Late masuk: <span className="font-semibold text-amber-600 dark:text-amber-400">{subtractMinutesFromTime(t.work_start, -10)}</span> (+10m)</div>
                                     </div>
                                 </td>
                                 <td className="px-6 py-4 text-[11px] text-slate-600 dark:text-slate-400">
                                     Masuk: {t.check_in_start} - {t.check_in_end} <br/> Pulang: {t.check_out_start} - {t.check_out_end}
                                 </td>
                                 <td className="px-6 py-4 text-right space-x-3">
                                     <button onClick={() => { setFormData(t); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 text-xs font-medium">Edit</button>
                                     <button onClick={() => handleToggle(t.id!, t.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{t.active ? "Nonaktifkan" : "Pulihkan"}</button>
                                     <button onClick={() => handleDelete(t.id!)} className="text-red-600 dark:text-red-400 hover:text-red-800 text-xs font-medium">Hapus</button>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
                 )
             )}

             {activeTab === "shift" && (
                 shifts.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada pola shift.</div> : (
                 <table className="w-full text-sm text-left">
                     <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Nama Pola Shift</th><th className="px-6 py-3 font-medium text-center">Status</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                     <tbody className="divide-y divide-slate-800">
                         {shifts.map(s => (
                             <tr key={s.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                 <td className="px-6 py-4 font-medium">{s.name}</td>
                                 <td className="px-6 py-4 text-center">
                                      {s.active ? (
                                        <span className="px-2 py-0.5 rounded text-[10px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">AKTIF</span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded text-[10px] border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">NONAKTIF</span>
                                      )}
                                 </td>
                                 <td className="px-6 py-4 text-right space-x-3">
                                     <button
                                       onClick={() => repairShiftToFullWeek(s)}
                                       className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 text-xs font-medium"
                                     >
                                       Set Senin-Minggu
                                     </button>
                                     <button onClick={() => {
                                         const normalized: any = { ...s };
                                         if (s.days) {
                                             SHIFT_DAY_KEYS.forEach(d => {
                                                 const cd = (s.days as any)[d];
                                                 normalized[`day_${d}`] = isActiveValue(cd?.active, false);
                                                 normalized[`timetable_${d}`] = cd?.timetable_id || "";
                                             });
                                             const allActive = SHIFT_DAY_KEYS.every(d => normalized[`day_${d}`]);
                                             const weekdayActive = ["monday", "tuesday", "wednesday", "thursday", "friday"].every(d => normalized[`day_${d}`]) && !normalized[`day_saturday`] && !normalized[`day_sunday`];
                                             normalized.workday_mode = allActive ? "full_week" : (weekdayActive ? "weekday" : "custom");
                                         } else {
                                             normalized.workday_mode = "custom";
                                         }
                                         setFormData(normalized); 
                                         setShowModal(true); 
                                     }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 text-xs font-medium">Edit</button>
                                     <button onClick={() => handleToggle(s.id!, s.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{s.active ? "Nonaktifkan" : "Pulihkan"}</button>
                                     <button onClick={() => handleDelete(s.id!)} className="text-red-600 dark:text-red-400 hover:text-red-800 text-xs font-medium">Hapus</button>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
                 )
             )}

             {activeTab === "assignment" && (() => {
                 const d = new Date();
                 const tzOffset = d.getTimezoneOffset() * 60000;
                 const localISOTime = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
                 const dateKey = localISOTime;

                 const activeEmps = getActiveEmployees();
                 const empsWithAssignment = activeEmps.filter(e => getValidAssignmentForEmployee(e, dateKey));
                 const empsWithoutAssignment = activeEmps.filter(e => !getValidAssignmentForEmployee(e, dateKey));

                 return (
                   <div className="space-y-6">
                     <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 lg:p-6 shadow-sm">
                       <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-800 pb-2">
                         <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Status Penerapan Jadwal Hari Ini ({dateKey})</h3>
                         <button onClick={() => { setFormData({}); setShowModal(true); }} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md font-medium">Buat Penerapan Baru</button>
                       </div>
                       
                       <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                         <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700/50">
                           <div className="text-xs text-slate-500 mb-1">Total Karyawan Aktif</div>
                           <div className="text-2xl font-bold text-slate-800 dark:text-slate-200">{activeEmps.length}</div>
                         </div>
                         <div className="bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-lg border border-emerald-200 dark:border-emerald-800/30">
                           <div className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Punya Penerapan Aktif</div>
                           <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{empsWithAssignment.length}</div>
                         </div>
                         <div className={`p-4 rounded-lg border ${empsWithoutAssignment.length > 0 ? "bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/30" : "bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/50"}`}>
                           <div className={`text-xs mb-1 ${empsWithoutAssignment.length > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500"}`}>Belum Ada Penerapan Aktif</div>
                           <div className={`text-2xl font-bold ${empsWithoutAssignment.length > 0 ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-200"}`}>{empsWithoutAssignment.length}</div>
                         </div>
                       </div>

                       {empsWithoutAssignment.length > 0 && (
                         <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                           <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 mb-3">Daftar Karyawan Tanpa Penerapan Jadwal (Maks 10):</div>
                           <div className="flex flex-wrap gap-2">
                             {empsWithoutAssignment.slice(0, 10).map((emp: any) => (
                               <div key={emp.uid} className="px-3 py-1.5 bg-rose-100 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-md text-xs text-rose-800 dark:text-rose-300 flex flex-col">
                                 <span className="font-semibold">{employeeDisplayName(emp, "Karyawan tidak ditemukan")}</span>
                                 {emp.group_id && <span className="opacity-70">Grup: {getGroupName(emp.group_id)}</span>}
                               </div>
                             ))}
                             {empsWithoutAssignment.length > 10 && (
                               <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs text-slate-500 flex items-center justify-center">
                                 +{empsWithoutAssignment.length - 10} lainnya
                               </div>
                             )}
                           </div>
                         </div>
                       )}
                     </div>

                     {assignments.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada jadwal yang diterapkan ke karyawan/grup.</div> : (
                     <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                       <table className="w-full text-sm text-left">
                           <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Target Penerapan</th><th className="px-6 py-3 font-medium">Pola Shift</th><th className="px-6 py-3 font-medium">Periode</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                           <tbody className="divide-y divide-slate-800">
                               {assignments.map(a => (
                                   <tr key={a.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                       <td className="px-6 py-4">
                                           <div className="text-[10px] uppercase text-blue-600 dark:text-blue-400 font-bold mb-1">{a.type === "group" ? "Grup Karyawan" : "Karyawan Tertentu"}</div>
                                           {a.type === "group" ? getGroupName(a.target_id) : getEmployeeName(a.target_id)}
                                       </td>
                                 <td className="px-6 py-4 font-medium">{getShiftName(a.shift_id)}</td>
                                 <td className="px-6 py-4 text-xs font-mono">{a.start_date} <span className="text-slate-500">&rarr;</span> {a.end_date || "Seterusnya"}</td>
                                 <td className="px-6 py-4 text-right space-x-3">
                                     <button onClick={() => { setFormData(a); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 text-xs font-medium">Edit</button>
                                     <button onClick={() => handleToggle(a.id!, a.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{a.active ? "Nonaktifkan" : "Pulihkan"}</button>
                                     <button onClick={() => handleDelete(a.id!)} className="text-red-600 dark:text-red-400 hover:text-red-800 text-xs font-medium">Hapus</button>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
                 </div>
                 )}
                 </div>
                 );
             })()}

             {activeTab === "holiday" && (
                 holidays.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada hari libur tersimpan.</div> : (
                 <table className="w-full text-sm text-left">
                     <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Tanggal</th><th className="px-6 py-3 font-medium">Keterangan</th><th className="px-6 py-3 font-medium">Sumber</th><th className="px-6 py-3 font-medium">Status Pembayaran</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                     <tbody className="divide-y divide-slate-800">
                         {holidays.map(h => (
                             <tr key={h.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                 <td className="px-6 py-4 font-mono">{h.date}</td>
                                 <td className="px-6 py-4">{h.title} <br/><span className="text-xs text-slate-500">{h.note}</span></td>
                                 <td className="px-6 py-4">
                                     <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                         {h.manual_override ? "Override Manual" : h.source === "google_calendar" ? "Google Calendar" : "Manual"}
                                     </span>
                                 </td>
                                 <td className="px-6 py-4">{h.paid ? "Dibayar (Paid)" : "Tidak Dibayar (Unpaid)"}</td>
                                 <td className="px-6 py-4 text-right space-x-3">
                                     <button onClick={() => { setFormData(h); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 text-xs font-medium">Edit</button>
                                     <button onClick={() => handleToggle(h.id!, h.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{h.active ? "Nonaktifkan" : "Pulihkan"}</button>
                                     <button onClick={() => handleDelete(h.id!)} className="text-red-600 dark:text-red-400 hover:text-red-800 text-xs font-medium">Hapus</button>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
                 )
             )}

             {activeTab === "special" && (
                 specials.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada jadwal khusus.</div> : (
                 <table className="w-full text-sm text-left">
                     <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Tanggal</th><th className="px-6 py-3 font-medium">Target</th><th className="px-6 py-3 font-medium">Pola Shift</th><th className="px-6 py-3 font-medium text-right">Aksi</th></tr></thead>
                     <tbody className="divide-y divide-slate-800">
                         {specials.map(s => (
                             <tr key={s.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                 <td className="px-6 py-4 font-mono">
                                     {s.date}<br/>
                                     <span className="text-xs text-slate-500">{s.title}</span>
                                 </td>
                                 <td className="px-6 py-4 text-xs">
                                     <div className="uppercase text-blue-600 dark:text-blue-400 font-bold mb-1">{s.type === "group" ? "Grup Karyawan" : "Karyawan Tertentu"}</div>
                                     {s.type === "group" ? getGroupName(s.target_id) : getEmployeeName(s.target_id)}
                                 </td>
                                 <td className="px-6 py-4">{getShiftName(s.shift_id)}</td>
                                 <td className="px-6 py-4 text-right space-x-3">
                                     <button onClick={() => { setFormData(s); setShowModal(true); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 text-xs font-medium">Edit</button>
                                     <button onClick={() => handleToggle(s.id!, s.active)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium">{s.active ? "Nonaktifkan" : "Pulihkan"}</button>
                                     <button onClick={() => handleDelete(s.id!)} className="text-red-600 dark:text-red-400 hover:text-red-800 text-xs font-medium">Hapus</button>
                                 </td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
                 )
             )}

             {activeTab === "overtime" && (
                 overtimeSchedules.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada jadwal lembur.</div> : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium">Nama Grup</th>
                        <th className="px-6 py-3 font-medium">Tanggal Lembur</th>
                        <th className="px-6 py-3 font-medium">Jam</th>
                        <th className="px-6 py-3 font-medium">Karyawan</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                        <th className="px-6 py-3 font-medium text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {overtimeSchedules.map(item => {
                        const dates = sortDateKeys(item.dates || {});
                        const targetUids = Object.keys(item.target_uids || {});
                        const targetNames = targetUids
                          .map(uid => {
                            const employee = employees.find((item: any) => item.uid === uid);
                            return employeeDisplayName(employee, "Karyawan tidak ditemukan");
                          })
                          .slice(0, 3);

                        return (
                          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300">
                            <td className="px-6 py-4">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</div>
                              <div className="text-xs text-slate-500">{item.note || "-"}</div>
                            </td>

                            <td className="px-6 py-4 text-xs">
                              <div className="flex flex-wrap gap-1 max-w-[260px]">
                                {dates.length === 0 ? (
                                  <span>-</span>
                                ) : (
                                  dates.slice(0, 4).map(dateKey => (
                                    <span key={dateKey} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                      {dateKeyToLabel(dateKey)}
                                    </span>
                                  ))
                                )}
                                {dates.length > 4 && (
                                  <span className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300">
                                    +{dates.length - 4} tanggal
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="px-6 py-4 text-xs whitespace-nowrap">
                              <div><span className="text-slate-500">Kerja:</span> {item.work_start} - {item.work_end}</div>
                              <div><span className="text-slate-500">In:</span> {item.check_in_start} - {item.check_in_end}</div>
                              <div><span className="text-slate-500">Out:</span> {item.check_out_start} - {item.check_out_end}</div>
                            </td>

                            <td className="px-6 py-4 text-xs">
                              <div className="font-semibold text-slate-700 dark:text-slate-200">
                                {item.target_count || targetUids.length || 0} orang
                              </div>
                              <div className="text-slate-500 max-w-[220px] truncate">
                                {targetNames.join(", ")}
                                {targetUids.length > 3 ? ` +${targetUids.length - 3}` : ""}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${
                                item.active !== false
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                              }`}>
                                {item.active !== false ? "Aktif" : "Nonaktif"}
                              </span>
                            </td>

                            <td className="px-6 py-4 text-right space-x-3">
                              <button
                                onClick={() => {
                                  const targetMap = item.target_uids || {};
                                  const nextForm: any = {
                                    ...item,
                                    dates: { ...(item.dates || {}) },
                                  };
                                  Object.keys(targetMap).forEach(uid => {
                                    nextForm[`target_${uid}`] = true;
                                  });
                                  setFormData(nextForm);
                                  setShowModal(true);
                                }}
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 text-xs font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleToggle(item.id, item.active !== false)}
                                className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs font-medium"
                              >
                                {item.active !== false ? "Nonaktifkan" : "Aktifkan"}
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="text-red-600 dark:text-red-400 hover:text-red-800 text-xs font-medium"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                 )
             )}

             {activeTab === "logs" && (
                 logs.length === 0 ? <div className="p-8 text-center text-slate-500">Belum ada riwayat perubahan.</div> : (
                 <table className="w-full text-sm text-left">
                     <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400"><tr><th className="px-6 py-3 font-medium">Waktu</th><th className="px-6 py-3 font-medium">Admin</th><th className="px-6 py-3 font-medium">Log Aktivitas</th></tr></thead>
                     <tbody className="divide-y divide-slate-800">
                         {logs.map(l => (
                             <tr key={l.id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                                 <td className="px-6 py-4 text-xs font-mono">{new Date(l.created_at).toLocaleString('id-ID')}</td>
                                 <td className="px-6 py-4 text-xs">{l.admin_name || l.admin_uid || "Sistem"}</td>
                                 <td className="px-6 py-4 text-xs">
                                     <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{l.action.replace(/_/g, ' ')}</span>
                                     <br/><span className="text-slate-500 mt-1 block">Aksi telah terekam oleh sistem.</span>
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
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200">
                {formData.id ? "Edit " : "Tambah "} 
                {activeTab === "timetable" ? "Jam Kerja" : activeTab === "assignment" ? "Penerapan Jadwal" : activeTab === "holiday" ? "Hari Libur" : activeTab === "special" ? "Jadwal Khusus" : "Pola Shift"}
              </h3>
              <button onClick={() => { setShowModal(false); setFormData({}); }} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
            </div>
            <form onSubmit={handleCreate} className="p-6 overflow-y-auto space-y-4">
              
              {activeTab === "timetable" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Nama Jam Kerja</label>
                    <input type="text" required value={formData.name || ""} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" placeholder="Misal: Jam Kerja Pagi" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Jam Kerja Mulai</label>
                        <input type="time" required value={formData.work_start || ""} onChange={e => setFormData({...formData, work_start: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Jam Kerja Selesai</label>
                        <input type="time" required value={formData.work_end || ""} onChange={e => setFormData({...formData, work_end: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                  </div>
                  {isTodayWorkStartAlreadyPassed(formData.work_start) && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/50 text-amber-700 dark:text-amber-300 text-xs p-3 font-mono leading-relaxed">
                      ⚠️ Jam masuk ini ({formData.work_start}) sudah lewat untuk hari ini. Reminder 5 menit sebelum tidak akan muncul hari ini. Gunakan jam masuk beberapa menit ke depan untuk testing scheduler.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Batas Check In (Mulai)</label>
                        <input type="time" required value={formData.check_in_start || ""} onChange={e => setFormData({...formData, check_in_start: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Batas Check In (Akhir)</label>
                        <input type="time" required value={formData.check_in_end || ""} onChange={e => setFormData({...formData, check_in_end: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Batas Check Out (Mulai)</label>
                        <input type="time" required value={formData.check_out_start || ""} onChange={e => setFormData({...formData, check_out_start: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Batas Check Out (Akhir)</label>
                        <input type="time" required value={formData.check_out_end || ""} onChange={e => setFormData({...formData, check_out_end: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Toleransi Telat (Menit)</label>
                        <input type="number" required value={formData.late_tolerance_minute || ""} onChange={e => setFormData({...formData, late_tolerance_minute: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Toleransi Pulang Awal (Menit)</label>
                        <input type="number" required value={formData.early_out_tolerance_minute || ""} onChange={e => setFormData({...formData, early_out_tolerance_minute: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                        <input type="checkbox" checked={formData.crosses_midnight || false} onChange={e => setFormData({...formData, crosses_midnight: e.target.checked})} className="rounded bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-blue-600 focus:ring-blue-500" />
                        Jadwal melewati tengah malam (Crosses Midnight)
                    </label>
                  </div>
                  {renderShiftOrTimetableImpactPreview()}
                </>
              )}

              {activeTab === "shift" && (
                <>
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Nama Shift</label>
                    <input type="text" required value={formData.name || ""} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" placeholder="Misal: Shift HK Pagi" />
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => applyShiftPreset("full_week")}
                      className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                    >
                      Aktifkan Senin - Minggu
                    </button>

                    <button
                      type="button"
                      onClick={() => applyShiftPreset("weekday")}
                      className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                    >
                      Aktifkan Senin - Jumat
                    </button>

                    <button
                      type="button"
                      onClick={() => applyShiftPreset("clear")}
                      className="px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 text-white text-xs font-semibold"
                    >
                      Kosongkan Hari
                    </button>
                  </div>

                  {SHIFT_DAY_KEYS.map(day => (
                      <div key={day} className="flex items-center gap-4 border-b border-slate-200 dark:border-slate-800/50 pb-2 mb-2">
                        <label className="w-24 capitalize text-sm text-slate-700 dark:text-slate-300">{dayLabelMap[day] || day}</label>
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                           <input type="checkbox" checked={formData[`day_${day}`] || false} onChange={e => setFormData({...formData, [`day_${day}`]: e.target.checked})} className="rounded bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800" />
                           Kerja
                        </label>
                        {formData[`day_${day}`] && (
                           <select required value={formData[`timetable_${day}`] || ""} onChange={e => setFormData({...formData, [`timetable_${day}`]: e.target.value})} className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-xs text-slate-800 dark:text-slate-200">
                               <option value="" disabled>Pilih Jam Kerja...</option>
                               {timetables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                           </select>
                        )}
                      </div>
                  ))}
                  {renderShiftOrTimetableImpactPreview()}
                </>
              )}

              {activeTab === "assignment" && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Terapkan Jadwal Pada</label>
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="radio" name="type" required checked={formData.type === "group"} onChange={() => {setFormData({...formData, type: "group", target_id: ""})}} /> Grup Karyawan</label>
                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="radio" name="type" required checked={formData.type === "user"} onChange={() => {setFormData({...formData, type: "user", target_id: ""})}} /> Karyawan Terpilih</label>
                    </div>
                  </div>

                  {formData.type && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Pilih Target</label>
                        <select required value={formData.target_id || ""} onChange={e => setFormData({...formData, target_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                            <option value="" disabled>-- Pilih Target --</option>
                            {formData.type === "group" 
                              ? groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
                              : employees.map(u => <option key={u.uid} value={u.uid}>{u.nama_lengkap} - {u.nip}</option>)
                            }
                        </select>
                      </div>
                  )}

                  {formData.type === "group" && formData.target_id && (
                     <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Tambahkan Karyawan ke Grup Ini (Opsional)</label>
                        <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded p-2 bg-slate-50 dark:bg-slate-950 text-sm">
                           {employees.filter(e => e.group_id !== formData.target_id).map(e => (
                             <label key={e.uid} className="flex items-center gap-2 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded cursor-pointer">
                               <input type="checkbox" checked={formData._add_to_group?.[e.uid] || false} onChange={ev => {
                                 const nextMap = { ...(formData._add_to_group || {}) };
                                 if (ev.target.checked) nextMap[e.uid] = true;
                                 else delete nextMap[e.uid];
                                 setFormData({...formData, _add_to_group: nextMap});
                               }} className="rounded border-slate-300 dark:border-slate-700" />
                               <span className="text-slate-800 dark:text-slate-200">{employeeDisplayName(e, "Karyawan")}</span> 
                               <span className="text-slate-400 text-xs">({e.group_id ? getGroupName(e.group_id) : "Belum ada grup"})</span>
                             </label>
                           ))}
                           {employees.filter(e => e.group_id !== formData.target_id).length === 0 && (
                               <div className="text-xs text-slate-500 p-2 text-center">Semua karyawan sudah berada di grup ini atau tidak ada karyawan tersedia.</div>
                           )}
                        </div>
                     </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Shift</label>
                    <select required value={formData.shift_id || ""} onChange={e => setFormData({...formData, shift_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                        <option value="" disabled>-- Pilih Shift --</option>
                        {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Start Date</label>
                        <input type="date" required value={formData.start_date || ""} onChange={e => setFormData({...formData, start_date: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">End Date (Opsional)</label>
                        <input type="date" value={formData.end_date || ""} onChange={e => setFormData({...formData, end_date: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" />
                    </div>
                  </div>
                  <div className="mt-4">
                    {renderImpactPreview()}
                  </div>
                </>
              )}

              {activeTab === "holiday" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Tanggal Libur</label>
                    <input type="date" required value={formData.date || ""} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Nama Libur</label>
                    <input type="text" required value={formData.title || ""} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" placeholder="Misal: Idul Fitri" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Keterangan / Note</label>
                    <input type="text" value={formData.note || ""} onChange={e => setFormData({...formData, note: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200" placeholder="Libur nasional..." />
                  </div>
                  <div className="mt-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                        <input type="checkbox" checked={formData.paid || false} onChange={e => setFormData({...formData, paid: e.target.checked})} className="rounded bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-blue-600 focus:ring-blue-500" />
                        Paid Holiday (Dibayar / Dihitung Hadir)
                    </label>
                  </div>
                </>
              )}

              {activeTab === "overtime" && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-800 dark:text-blue-200">
                    Jadwal lembur dibuat sebagai grup lembur. Untuk perorangan, pilih satu karyawan saja di daftar karyawan.
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Nama Grup Lembur
                    </label>
                    <input
                      value={formData.name || ""}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200"
                      placeholder="Contoh: Lembur Libur Nasional Shift Pagi"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                      Pilih Tanggal Lembur
                    </label>

                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={formData.date_picker || ""}
                        onChange={e => setFormData({ ...formData, date_picker: e.target.value })}
                        className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const date = formData.date_picker;
                          if (!date) return;
                          const current = { ...(formData.dates || {}) };
                          current[date] = true;
                          setFormData({
                            ...formData,
                            dates: current,
                            date_picker: "",
                          });
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
                      >
                        Tambah Tanggal
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {sortDateKeys(formData.dates || {}).length === 0 ? (
                        <div className="text-xs text-slate-500">Belum ada tanggal dipilih.</div>
                      ) : (
                        sortDateKeys(formData.dates || {}).map(dateKey => (
                          <span
                            key={dateKey}
                            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                          >
                            {dateKeyToLabel(dateKey)}
                            <button
                              type="button"
                              onClick={() => {
                                const next = { ...(formData.dates || {}) };
                                delete next[dateKey];
                                setFormData({ ...formData, dates: next });
                              }}
                              className="text-red-500 hover:text-red-700"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Jam Kerja Mulai</label>
                      <input type="time" required value={formData.work_start || ""} onChange={e => setFormData({ ...formData, work_start: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Jam Kerja Selesai</label>
                      <input type="time" required value={formData.work_end || ""} onChange={e => setFormData({ ...formData, work_end: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Check-in Mulai</label>
                      <input type="time" required value={formData.check_in_start || ""} onChange={e => setFormData({ ...formData, check_in_start: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Check-in Selesai</label>
                      <input type="time" required value={formData.check_in_end || ""} onChange={e => setFormData({ ...formData, check_in_end: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Check-out Mulai</label>
                      <input type="time" required value={formData.check_out_start || ""} onChange={e => setFormData({ ...formData, check_out_start: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Check-out Selesai</label>
                      <input type="time" required value={formData.check_out_end || ""} onChange={e => setFormData({ ...formData, check_out_end: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                      Pilih Karyawan
                    </label>
                    <div className="max-h-64 overflow-auto border border-slate-200 dark:border-slate-800 rounded p-2 space-y-1">
                      {employees.length === 0 ? (
                        <div className="text-sm text-slate-500 p-3">Belum ada karyawan.</div>
                      ) : (
                        employees.map((employee: any) => (
                          <label
                            key={employee.uid}
                            className="flex items-center gap-2 text-sm p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={!!formData[`target_${employee.uid}`]}
                              onChange={e => setFormData({ ...formData, [`target_${employee.uid}`]: e.target.checked })}
                            />
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {employeeDisplayName(employee, "Karyawan tidak ditemukan")}
                            </span>
                            <span className="text-xs text-slate-500">{employee.nip || ""}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Untuk jadwal lembur perorangan, pilih satu karyawan saja.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Catatan</label>
                    <textarea
                      value={formData.note || ""}
                      onChange={e => setFormData({ ...formData, note: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-sm text-slate-800 dark:text-slate-200"
                      rows={3}
                      placeholder="Contoh: Operasional hari libur nasional"
                    />
                  </div>
                </div>
              )}

              {activeTab === "special" && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Tanggal Berubah</label>
                    <input type="date" required value={formData.date || ""} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Judul Event / Alasan</label>
                    <input type="text" required value={formData.title || ""} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm" placeholder="Misal: Event Tahun Baru" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Ubah Jadwal Untuk</label>
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="radio" name="type" required checked={formData.type === "group"} onChange={() => {setFormData({...formData, type: "group", target_id: ""})}} /> Grup Karyawan</label>
                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="radio" name="type" required checked={formData.type === "user"} onChange={() => {setFormData({...formData, type: "user", target_id: ""})}} /> Karyawan Terpilih</label>
                    </div>
                  </div>
                  {formData.type && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Pilih Target</label>
                        <select required value={formData.target_id || ""} onChange={e => setFormData({...formData, target_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                            <option value="" disabled>-- Pilih Target --</option>
                            {formData.type === "group" 
                              ? groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
                              : employees.map(u => <option key={u.uid} value={u.uid}>{u.nama_lengkap} - {u.nip}</option>)
                            }
                        </select>
                      </div>
                  )}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Shift Khusus</label>
                    <select required value={formData.shift_id || ""} onChange={e => setFormData({...formData, shift_id: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm">
                        <option value="" disabled>-- Pilih Shift --</option>
                        {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="mt-4">
                    {renderImpactPreview()}
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button type="button" onClick={() => { setShowModal(false); setFormData({}); }} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-700">Batal</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium">Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
