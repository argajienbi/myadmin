// Form + logika simpan Jadwal Kerja (Dewi) — dipakai schedules-page.tsx.
// Port pages/Schedules.tsx lama: validasi & pembangunan newData per tab,
// applyScheduleMetadata, tulis RTDB, notifikasi perubahan jadwal, dan log
// schedule_change_logs. Google Calendar sync TIDAK dibawa (butuh
// workspaceAuth Google — domain auth Raka); CRUD hari libur tetap jalan.
import { push, ref, set, update } from "firebase/database"
import { toast } from "sonner"
import { db } from "@/lib/firebase"
import { paths } from "@/lib/firebase-paths"
import { writeScheduleChangeLog } from "./schedule-data"
import {
  SHIFT_DAY_KEYS,
  buildDateMap,
  buildDaysFromDates,
  dateExistsInSchedule,
  dateKeyToLabel,
  findOvertimeConflicts,
  isActiveValue,
  resolveTargetUids,
  resolveUsersImpactedByShift,
  resolveUsersImpactedByTimetable,
  sendScheduleChangeNotifications,
  sortDateKeys,
  targetUidExistsInSchedule,
  timeRangeOverlaps,
  dayLabelMap,
} from "./schedule-data"
import { type FirebaseUserData } from "@/lib/use-company"

export type ScheduleTabId =
  | "summary"
  | "timetable"
  | "shift"
  | "assignment"
  | "holiday"
  | "special"
  | "overtime"
  | "diagnostic"
  | "logs"

export type ScheduleRow = Record<string, unknown> & { id: string }

export interface ScheduleLists {
  timetables: ScheduleRow[]
  shifts: ScheduleRow[]
  assignments: ScheduleRow[]
  holidays: ScheduleRow[]
  specials: ScheduleRow[]
  overtimeSchedules: ScheduleRow[]
  groups: Record<string, unknown>[]
  employees: Record<string, unknown>[]
}

export function createLabel(tab: ScheduleTabId): string {
  if (tab === "timetable") return "Jam Kerja"
  if (tab === "shift") return "Pola Shift"
  if (tab === "assignment") return "Penerapan Jadwal"
  if (tab === "holiday") return "Hari Libur"
  if (tab === "special") return "Jadwal Khusus"
  if (tab === "overtime") return "Jadwal Lembur"
  return "Jadwal"
}

export function defaultFormData(
  tab: ScheduleTabId,
  item?: ScheduleRow | null
): Record<string, unknown> {
  if (tab === "timetable") {
    return {
      name: "",
      work_start: "08:00",
      work_end: "17:00",
      check_in_start: "07:00",
      check_in_end: "08:15",
      check_out_start: "16:30",
      check_out_end: "18:00",
      late_tolerance_minute: 15,
      early_out_tolerance_minute: 0,
      crosses_midnight: false,
      active: true,
      ...(item || {}),
    }
  }
  if (tab === "shift") {
    const base: Record<string, unknown> = {
      name: "",
      workday_mode: "custom",
      active: true,
    }
    SHIFT_DAY_KEYS.forEach((day) => {
      base[`day_${day}`] = false
      base[`timetable_${day}`] = ""
    })
    if (item) {
      base.id = item.id
      base.name = item.name || ""
      base.workday_mode = item.workday_mode || "custom"
      base.active = item.active !== false
      const days = (item.days as Record<string, Record<string, unknown>>) || {}
      SHIFT_DAY_KEYS.forEach((day) => {
        base[`day_${day}`] = isActiveValue(days[day]?.active, false)
        base[`timetable_${day}`] = String(days[day]?.timetable_id || "")
      })
    }
    return base
  }
  if (tab === "assignment") {
    return {
      type: "group",
      target_id: "",
      shift_id: "",
      start_date: new Date().toISOString().slice(0, 10),
      end_date: "",
      active: true,
      ...(item || {}),
    }
  }
  if (tab === "holiday") {
    return {
      date: "",
      title: "",
      active: true,
      ...(item ? { ...item, id: item.date || item.id } : {}),
    }
  }
  if (tab === "special") {
    return {
      date: new Date().toISOString().slice(0, 10),
      title: "",
      type: "group",
      target_id: "",
      shift_id: "",
      active: true,
      ...(item || {}),
    }
  }
  if (tab === "overtime") {
    const base: Record<string, unknown> = {
      name: "",
      dates: {},
      work_start: "17:00",
      work_end: "21:00",
      check_in_start: "16:00",
      check_in_end: "17:15",
      check_out_start: "20:30",
      check_out_end: "22:00",
      note: "",
      active: true,
    }
    if (item) {
      base.id = item.id || item.schedule_id || ""
      base.name = item.name || ""
      base.dates = item.dates || {}
      base.work_start = item.work_start || "17:00"
      base.work_end = item.work_end || "21:00"
      base.check_in_start = item.check_in_start || ""
      base.check_in_end = item.check_in_end || ""
      base.check_out_start = item.check_out_start || ""
      base.check_out_end = item.check_out_end || ""
      base.note = item.note || ""
      base.active = item.active !== false
      const targetUids = item.target_uids as
        | Record<string, unknown>
        | string[]
        | undefined
      if (Array.isArray(targetUids)) {
        targetUids.forEach((uid) => {
          base[`target_${uid}`] = true
        })
      } else if (targetUids) {
        Object.keys(targetUids).forEach((uid) => {
          base[`target_${uid}`] = true
        })
      }
    }
    return base
  }
  return {}
}

function applyScheduleMetadata(
  payload: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  companyId: string,
  userData: FirebaseUserData | null
): Record<string, unknown> {
  const now = Date.now()
  return {
    ...payload,
    company_id: companyId,
    created_at: existing?.created_at || payload.created_at || now,
    created_by:
      existing?.created_by || payload.created_by || userData?.uid || "",
    created_by_name:
      existing?.created_by_name ||
      payload.created_by_name ||
      userData?.nama_lengkap ||
      "",
    updated_at: now,
    updated_by: userData?.uid || "",
    updated_by_name: userData?.nama_lengkap || "",
  }
}

function getCurrentItem(
  tab: ScheduleTabId,
  formData: Record<string, unknown>,
  lists: ScheduleLists
): Record<string, unknown> | null {
  if (!formData?.id) return null
  if (tab === "timetable")
    return lists.timetables.find((i) => i.id === formData.id) || null
  if (tab === "shift")
    return lists.shifts.find((i) => i.id === formData.id) || null
  if (tab === "assignment")
    return lists.assignments.find((i) => i.id === formData.id) || null
  if (tab === "holiday")
    return (
      lists.holidays.find(
        (i) => i.id === formData.id || i.date === formData.id
      ) || null
    )
  if (tab === "special")
    return lists.specials.find((i) => i.id === formData.id) || null
  if (tab === "overtime")
    return (
      lists.overtimeSchedules.find(
        (i) => i.id === formData.id || i.schedule_id === formData.id
      ) || null
    )
  return null
}

// Port handleCreate/createRequest dari Schedules.tsx lama.
export async function saveScheduleItem(params: {
  tab: ScheduleTabId
  formData: Record<string, unknown>
  companyId: string
  userData: FirebaseUserData | null
  lists: ScheduleLists
}): Promise<string> {
  const { tab, formData, companyId, userData, lists } = params
  if (!companyId) throw new Error("Perusahaan belum dipilih.")
  const {
    shifts,
    assignments,
    holidays,
    specials,
    overtimeSchedules,
    groups,
    employees,
  } = lists
  let listPath = ""
  const existingScheduleItem = getCurrentItem(tab, formData, lists)
  let newData: Record<string, unknown> = {
    ...formData,
    active: formData.active !== false,
  }

  if (tab === "timetable") {
    if (!newData.name || !newData.work_start || !newData.work_end)
      throw new Error("Data jam kerja belum lengkap.")
    listPath = paths.timetables(companyId)
    newData.late_tolerance_minute = parseInt(
      String(newData.late_tolerance_minute || "0"),
      10
    )
    newData.early_out_tolerance_minute = parseInt(
      String(newData.early_out_tolerance_minute || "0"),
      10
    )
    newData.crosses_midnight =
      newData.crosses_midnight === true || newData.crosses_midnight === "true"
  } else if (tab === "shift") {
    if (!newData.name) throw new Error("Nama pola shift wajib diisi.")
    listPath = paths.shifts(companyId)
    newData.workday_mode = formData.workday_mode || "custom"
    newData.days = SHIFT_DAY_KEYS.reduce(
      (acc: Record<string, unknown>, day) => {
        acc[day] = {
          active: isActiveValue(formData[`day_${day}`], false),
          timetable_id: formData[`timetable_${day}`] || "",
        }
        return acc
      },
      {}
    )
    const activeDays = Object.values(
      newData.days as Record<string, Record<string, unknown>>
    ).filter((d) => d.active)
    if (activeDays.length === 0)
      throw new Error("Minimal satu hari kerja harus aktif.")
    if (activeDays.some((d) => !d.timetable_id))
      throw new Error("Setiap hari aktif wajib memilih jam kerja.")
    if (newData.workday_mode === "full_week") {
      const inactive = SHIFT_DAY_KEYS.filter(
        (day) =>
          !(newData.days as Record<string, Record<string, unknown>>)[day]
            ?.active
      )
      if (inactive.length > 0) {
        throw new Error(
          `Mode Senin-Minggu wajib mengaktifkan semua hari: ${inactive.join(", ")}`
        )
      }
    }
    SHIFT_DAY_KEYS.forEach((d) => {
      delete newData[`day_${d}`]
      delete newData[`timetable_${d}`]
    })
  } else if (tab === "assignment") {
    if (!newData.target_id || !newData.shift_id || !newData.start_date)
      throw new Error("Target, shift, dan tanggal mulai wajib diisi.")
    if (newData.end_date && String(newData.end_date) < String(newData.start_date)) {
      throw new Error("Tanggal akhir tidak boleh lebih kecil dari tanggal mulai.")
    }
    if (newData.type === "group") {
      if (!groups.some((g) => g.id === newData.target_id))
        throw new Error("Grup yang dipilih tidak ditemukan.")
    } else if (
      !employees.some((e) => e.uid === newData.target_id)
    ) {
      throw new Error("Karyawan yang dipilih tidak ditemukan.")
    }
    const selectedShift = shifts.find((s) => s.id === newData.shift_id)
    if (!selectedShift) throw new Error("Shift tidak ditemukan.")
    if (selectedShift.active === false || selectedShift.status === "inactive") {
      throw new Error("Shift yang dipilih sedang nonaktif.")
    }
    const shiftDays = (selectedShift.days as Record<string, Record<string, unknown>>) || {}
    const activeShiftDays = Object.values(shiftDays).filter((day) =>
      isActiveValue(day?.active, false)
    )
    if (
      activeShiftDays.length === 0 &&
      selectedShift.workday_mode !== "full_week"
    ) {
      throw new Error("Shift yang dipilih belum memiliki hari kerja aktif.")
    }
    if (
      activeShiftDays.some((day) => !day.timetable_id) &&
      selectedShift.workday_mode !== "full_week"
    ) {
      throw new Error(
        "Shift yang dipilih memiliki hari aktif tanpa jam kerja (timetable)."
      )
    }
    listPath = paths.scheduleAssignments(companyId)
    newData.created_by = userData?.uid || ""
    if (!newData.end_date) newData.end_date = ""
    if (formData.type === "group" && formData._add_to_group) {
      const updates: Record<string, unknown> = {}
      Object.keys(
        formData._add_to_group as Record<string, unknown>
      ).forEach((uid) => {
        if ((formData._add_to_group as Record<string, unknown>)[uid]) {
          updates[`${paths.companyUsers(companyId)}/${uid}/group_id`] =
            newData.target_id
        }
      })
      if (Object.keys(updates).length > 0) {
        await update(ref(db), updates)
      }
    }
    delete newData._add_to_group
  } else if (tab === "holiday") {
    if (!newData.date || !newData.title)
      throw new Error("Tanggal dan judul libur wajib diisi.")
    listPath = `${paths.holidays(companyId)}/${newData.date}`
    newData.type = "holiday"
    newData.created_by = userData?.uid || ""
  } else if (tab === "special") {
    if (
      !newData.date ||
      !newData.title ||
      !newData.target_id ||
      !newData.shift_id
    )
      throw new Error("Formulir jadwal khusus belum lengkap.")
    listPath = paths.scheduleSpecials(companyId)
    newData.created_by = userData?.uid || ""
  } else if (tab === "overtime") {
    if (!newData.name || !newData.work_start || !newData.work_end) {
      throw new Error("Nama grup lembur dan jam kerja wajib diisi.")
    }
    if (
      !newData.check_in_start ||
      !newData.check_in_end ||
      !newData.check_out_start ||
      !newData.check_out_end
    ) {
      throw new Error("Jendela check-in dan check-out wajib diisi.")
    }
    const selectedDates = sortDateKeys(
      (formData.dates as Record<string, boolean>) || {}
    )
    if (selectedDates.length === 0) {
      throw new Error("Minimal satu tanggal lembur wajib dipilih.")
    }
    const selectedUids = employees
      .map((employee) => String(employee.uid))
      .filter((uid) => formData[`target_${uid}`])
    if (selectedUids.length === 0) {
      throw new Error("Minimal satu karyawan wajib dipilih.")
    }
    const targetUids = selectedUids.reduce(
      (acc: Record<string, boolean>, uid) => {
        acc[uid] = true
        return acc
      },
      {}
    )
    const datesMap = buildDateMap(selectedDates)
    const generatedDays = buildDaysFromDates(selectedDates)
    const conflicts = findOvertimeConflicts({
      overtimeSchedules,
      employees,
      scheduleId: formData.id ? String(formData.id) : undefined,
      selectedDates,
      selectedUids,
      workStart: String(newData.work_start),
      workEnd: String(newData.work_end),
    })
    if (conflicts.length > 0) {
      throw new Error(
        `Jadwal lembur bertabrakan:\n${conflicts.slice(0, 5).join("\n")}${
          conflicts.length > 5
            ? `\n+${conflicts.length - 5} bentrok lainnya.`
            : ""
        }`
      )
    }
    listPath = paths.overtimeSchedules(companyId)
    newData = {
      schedule_id: formData.id || "",
      company_id: companyId,
      name: String(newData.name).trim(),
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
      status:
        newData.active === false || newData.status === "inactive"
          ? "inactive"
          : "active",
      active: newData.active !== false,
      date_start: selectedDates[0],
      date_end: selectedDates[selectedDates.length - 1],
      days: generatedDays,
      created_by: formData.created_by || userData?.uid || "",
      created_by_name:
        formData.created_by_name || userData?.nama_lengkap || "",
      created_at: formData.created_at || Date.now(),
      updated_at: Date.now(),
    }
  }

  newData = applyScheduleMetadata(
    newData,
    existingScheduleItem || undefined,
    companyId,
    userData
  )

  if (tab === "holiday") {
    if (formData.id && formData.id !== newData.date) {
      await set(
        ref(db, `${paths.holidays(companyId)}/${formData.id}`),
        null
      )
    }
    if (formData.id) {
      const current = holidays.find((h) => h.id === formData.id)
      if (current && current.source === "google_calendar") {
        newData.manual_override = true
        newData.override_by = userData?.uid || ""
        newData.override_by_name = userData?.nama_lengkap || ""
        newData.override_at = Date.now()
      }
    }
    await set(ref(db, `${paths.holidays(companyId)}/${newData.date}`), newData)
  } else {
    if (formData.id) {
      if (tab === "overtime") {
        newData.schedule_id = formData.id
        newData.id = formData.id
      }
      await set(ref(db, `${listPath}/${formData.id}`), newData)
    } else {
      const newRef = push(ref(db, listPath))
      newData.id = newRef.key
      if (tab === "overtime") {
        newData.schedule_id = newRef.key
      }
      await set(newRef, newData)
    }
  }

  if (tab === "timetable") {
    const timetableId = String(formData.id || newData.id || "")
    const impactedUids = resolveUsersImpactedByTimetable(
      shifts,
      assignments,
      specials,
      employees,
      timetableId
    )
    if (impactedUids.length > 0) {
      const title = formData.id ? "Jam Kerja Diperbarui" : "Jam Kerja Baru"
      const message = `${String(newData.name || "Jam kerja")} telah ${formData.id ? "diperbarui" : "ditambahkan"} oleh Admin. Silakan cek jadwal kerja Anda.`
      await sendScheduleChangeNotifications({
        companyId,
        uids: impactedUids,
        title,
        message,
        refId: timetableId || "timetable",
        userData,
        extraData: {
          schedule_change_type: "timetable",
          timetable_id: timetableId || "",
        },
      })
    }
  }

  if (tab === "shift") {
    const shiftId = String(formData.id || newData.id || "")
    const impactedUids = resolveUsersImpactedByShift(
      assignments,
      specials,
      employees,
      shiftId
    )
    if (impactedUids.length > 0) {
      const title = formData.id ? "Pola Shift Diperbarui" : "Pola Shift Baru"
      const message = `${String(newData.name || "Pola shift")} telah ${formData.id ? "diperbarui" : "ditambahkan"} oleh Admin. Silakan cek jadwal kerja Anda.`
      await sendScheduleChangeNotifications({
        companyId,
        uids: impactedUids,
        title,
        message,
        refId: shiftId || "shift",
        userData,
        extraData: {
          schedule_change_type: "shift",
          shift_id: shiftId || "",
        },
      })
    }
  }

  if (tab === "holiday") {
    const impactedUids = employees
      .filter((emp) => {
        const status = String(
          emp.status_akun || emp.status || "active"
        ).toLowerCase()
        return !(
          emp.active === false ||
          status === "inactive" ||
          emp.is_active === false
        )
      })
      .map((emp) => String(emp.uid))
    const title = formData.id ? "Hari Libur Diperbarui" : "Hari Libur Baru"
    const message = `${String(newData.title || "Hari libur")} pada ${dateKeyToLabel(String(newData.date || ""))} telah ${formData.id ? "diperbarui" : "ditambahkan"}.`
    await sendScheduleChangeNotifications({
      companyId,
      uids: impactedUids,
      title,
      message,
      refId: String(newData.date || "holiday"),
      userData,
      extraData: {
        schedule_change_type: "holiday",
        holiday_date: String(newData.date || ""),
      },
    })
  }

  if (tab === "overtime") {
    const scheduleId = String(
      formData.id || newData.schedule_id || newData.id || ""
    )
    const targetUids = Object.keys(
      (newData.target_uids as Record<string, unknown>) || {}
    )
    const notificationTitle = formData.id
      ? "Jadwal Lembur Diperbarui"
      : "Jadwal Lembur Ditambahkan"
    const selectedDateLabels = sortDateKeys(
      (newData.dates as Record<string, boolean>) || {}
    )
      .map(dateKeyToLabel)
      .join(", ")
    const notificationMessage = `${String(newData.name)}: ${selectedDateLabels}, ${String(newData.work_start)}-${String(newData.work_end)}.`
    await sendScheduleChangeNotifications({
      companyId,
      uids: targetUids,
      title: notificationTitle,
      message: notificationMessage,
      refId: scheduleId || "overtime",
      userData,
      extraData: {
        schedule_change_type: "overtime",
        overtime_schedule_id: scheduleId || "",
      },
    })
  }

  if (tab === "assignment") {
    const scheduleId = String(formData.id || newData.id || "")
    const notificationTitle = formData.id
      ? "Penerapan Jadwal Diperbarui"
      : "Penerapan Jadwal Baru"
    const notificationMessage =
      "Jadwal kerja Anda telah diperbarui oleh Admin. Silakan cek detail di menu Jadwal."
    const targetUids = resolveTargetUids(
      employees,
      String(newData.type || "individual"),
      String(newData.target_id || "")
    )
    await sendScheduleChangeNotifications({
      companyId,
      uids: targetUids,
      title: notificationTitle,
      message: notificationMessage,
      refId: scheduleId || "assignment",
      userData,
      extraData: {
        schedule_change_type: "assignment",
        assignment_id: scheduleId || "",
      },
    })
  }

  if (tab === "special") {
    const scheduleId = String(formData.id || newData.id || "")
    const notificationTitle = formData.id
      ? "Jadwal Khusus Diperbarui"
      : "Jadwal Khusus Baru"
    const notificationMessage = `Anda mendapat jadwal khusus pada tanggal ${String(newData.date || "")}. Silakan cek detail jadwal Anda.`
    const targetUids = resolveTargetUids(
      employees,
      String(newData.type || "individual"),
      String(newData.target_id || "")
    )
    await sendScheduleChangeNotifications({
      companyId,
      uids: targetUids,
      title: notificationTitle,
      message: notificationMessage,
      refId: scheduleId || "special",
      userData,
      extraData: {
        schedule_change_type: "special",
        special_id: scheduleId || "",
        date: String(newData.date || ""),
      },
    })
  }

  const isGoogleOverride =
    tab === "holiday" &&
    formData.id &&
    holidays.find((h) => h.id === formData.id)?.source === "google_calendar"
  const action =
    tab === "overtime"
      ? formData.id
        ? "UPDATE_OVERTIME_SCHEDULE"
        : "CREATE_OVERTIME_SCHEDULE"
      : isGoogleOverride
        ? "EDIT_GOOGLE_CALENDAR_HOLIDAY"
        : formData.id
          ? `EDIT_${tab.toUpperCase()}`
          : `CREATE_${tab.toUpperCase()}`
  await writeScheduleChangeLog(companyId, {
    admin_uid: userData?.uid || "",
    admin_name: userData?.nama_lengkap || "",
    action,
    ref_type: tab === "overtime" ? "overtime_schedule" : tab,
    ref_id:
      tab === "overtime"
        ? String(newData.schedule_id || newData.id || formData.id || "")
        : String(newData.id || formData.id || ""),
    new_value:
      tab === "holiday"
        ? String(newData.date || "")
        : String(newData.name || newData.id || ""),
  })

  return "Berhasil menyimpan data"
}

export function impactedPreviewForForm(params: {
  tab: ScheduleTabId
  formData: Record<string, unknown>
  lists: ScheduleLists
}): { impactedUids: string[]; summary: string; notify: boolean } {
  const { tab, formData, lists } = params
  let impactedUids: string[] = []
  let summary = `Data ${createLabel(tab).toLowerCase()} akan disimpan.`
  if (tab === "assignment") {
    impactedUids = resolveTargetUids(
      lists.employees,
      String(formData.type || "individual"),
      String(formData.target_id || "")
    )
    summary = `Penerapan jadwal akan berdampak ke ${impactedUids.length} karyawan.`
  }
  if (tab === "special") {
    impactedUids = resolveTargetUids(
      lists.employees,
      String(formData.type || "individual"),
      String(formData.target_id || "")
    )
    summary = `Jadwal khusus tanggal ${String(formData.date || "-")} akan berdampak ke ${impactedUids.length} karyawan.`
  }
  if (tab === "overtime") {
    impactedUids = lists.employees
      .map((employee) => String(employee.uid))
      .filter((uid) => formData[`target_${uid}`])
    const selectedDates = sortDateKeys(
      (formData.dates as Record<string, boolean>) || {}
    )
    summary = `Jadwal lembur untuk ${selectedDates.length} tanggal akan berdampak ke ${impactedUids.length} karyawan.`
  }
  return {
    impactedUids,
    summary,
    notify: impactedUids.length > 0,
  }
}

export function impactedByTimetableOrShift(params: {
  tab: ScheduleTabId
  formData: Record<string, unknown>
  lists: ScheduleLists
}): string[] {
  const { tab, formData, lists } = params
  if (!formData.id) return []
  if (tab === "shift") {
    return resolveUsersImpactedByShift(
      lists.assignments,
      lists.specials,
      lists.employees,
      String(formData.id)
    )
  }
  if (tab === "timetable") {
    return resolveUsersImpactedByTimetable(
      lists.shifts,
      lists.assignments,
      lists.specials,
      lists.employees,
      String(formData.id)
    )
  }
  return []
}

function scheduleItemPath(
  tab: ScheduleTabId,
  item: ScheduleRow,
  companyId: string
): string {
  if (tab === "timetable") return paths.timetable(companyId, item.id)
  if (tab === "shift") return paths.shift(companyId, item.id)
  if (tab === "assignment")
    return paths.scheduleAssignment(companyId, item.id)
  if (tab === "holiday")
    return paths.holiday(companyId, String(item.date || item.id))
  if (tab === "special") return paths.scheduleSpecial(companyId, item.id)
  if (tab === "overtime")
    return paths.overtimeSchedule(
      companyId,
      String(item.schedule_id || item.id)
    )
  throw new Error("Tab tidak mendukung operasi ini.")
}

export async function toggleScheduleActive(params: {
  tab: ScheduleTabId
  item: ScheduleRow
  companyId: string
  userData: FirebaseUserData | null
}): Promise<void> {
  const { tab, item, companyId, userData } = params
  const itemPath = scheduleItemPath(tab, item, companyId)
  const nextActive = !(item.active !== false)
  await update(ref(db, itemPath), {
    active: nextActive,
    updated_at: Date.now(),
  })
  await writeScheduleChangeLog(companyId, {
    admin_uid: userData?.uid || "",
    admin_name: userData?.nama_lengkap || "",
    action: `TOGGLE_${tab.toUpperCase()}`,
    ref_type: tab === "overtime" ? "overtime_schedule" : tab,
    ref_id: String(item.id),
    new_value: String(item.name || item.title || item.id || ""),
  })
  toast.success(
    `${createLabel(tab)} ${nextActive ? "diaktifkan" : "dinonaktifkan"}.`
  )
}

export async function deleteScheduleItem(params: {
  tab: ScheduleTabId
  item: ScheduleRow
  companyId: string
  userData: FirebaseUserData | null
}): Promise<void> {
  const { tab, item, companyId, userData } = params
  const itemPath = scheduleItemPath(tab, item, companyId)
  await set(ref(db, itemPath), null)
  await writeScheduleChangeLog(companyId, {
    admin_uid: userData?.uid || "",
    admin_name: userData?.nama_lengkap || "",
    action: `DELETE_${tab.toUpperCase()}`,
    ref_type: tab === "overtime" ? "overtime_schedule" : tab,
    ref_id: String(item.schedule_id || item.id),
    new_value: String(item.name || item.title || item.id || ""),
  })
  toast.success(`${createLabel(tab)} dihapus.`)
}

// Re-export helper yang dipakai form UI (hindari import ganda di page).
export {
  dateExistsInSchedule,
  dayLabelMap,
  targetUidExistsInSchedule,
  timeRangeOverlaps,
}
