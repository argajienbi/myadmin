// Logika jadwal untuk halaman Utama — port 1:1 dari myadmin lama:
// services/scheduleResolver.ts (resolveScheduleForUser),
// services/scheduleDiagnostic.ts (diagnoseEmployeeSchedule),
// serta helper jadwal dari pages/Schedules.tsx (dampak, konflik lembur,
// notifikasi perubahan jadwal, tulis log perubahan).
// Tetap di features/utama: lib tidak punya scheduleResolver — hanya
// halaman Utama yang memakai resolver/diagnostik ini.
import { get, push, ref, set } from "firebase/database"
import { toast } from "sonner"
import { db } from "@/lib/firebase"
import { paths } from "@/lib/firebase-paths"
import { createNotification } from "@/lib/firebase-notify"
import { type FirebaseUserData } from "@/lib/use-company"

export const SHIFT_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const

export type ShiftDayKey = (typeof SHIFT_DAY_KEYS)[number]

export const dayLabelMap: Record<string, string> = {
  sunday: "Minggu",
  monday: "Senin",
  tuesday: "Selasa",
  wednesday: "Rabu",
  thursday: "Kamis",
  friday: "Jumat",
  saturday: "Sabtu",
}

export function isActiveValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1
  const text = String(value).trim().toLowerCase()
  return (
    text === "true" || text === "1" || text === "active" || text === "yes"
  )
}

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const

export function dayKeyFromDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`)
  return DAY_KEYS[date.getDay()]
}

export function dateKeyToLabel(dateKey: string): string {
  if (!dateKey) return "-"
  const parsed = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  return parsed.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function sortDateKeys(
  dates: Record<string, boolean> | string[]
): string[] {
  if (Array.isArray(dates)) return [...dates].sort()
  return Object.keys(dates || {})
    .filter((key) => dates[key])
    .sort()
}

export function buildDaysFromDates(dateKeys: string[]): Record<string, boolean> {
  const days: Record<string, boolean> = {
    sunday: false,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
  }
  dateKeys.forEach((dateKey) => {
    const dayKey = dayKeyFromDate(dateKey)
    if (dayKey) days[dayKey] = true
  })
  return days
}

export function buildDateMap(dateKeys: string[]): Record<string, boolean> {
  return dateKeys.reduce((acc: Record<string, boolean>, dateKey) => {
    if (dateKey) acc[dateKey] = true
    return acc
  }, {})
}

const minuteOfDay = (value: string): number | null => {
  const [hour, minute] = String(value || "").split(":").map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

export function timeRangeOverlaps(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const aStart = minuteOfDay(startA)
  const aEnd = minuteOfDay(endA)
  const bStart = minuteOfDay(startB)
  const bEnd = minuteOfDay(endB)
  if (aStart === null || aEnd === null || bStart === null || bEnd === null)
    return false
  const normalize = (start: number, end: number) => {
    if (end >= start) return [[start, end]]
    return [
      [start, 1440],
      [0, end],
    ]
  }
  return normalize(aStart, aEnd).some(([sa, ea]) =>
    normalize(bStart, bEnd).some(([sb, eb]) => sa < eb && sb < ea)
  )
}

export function dateExistsInSchedule(
  item: Record<string, unknown>,
  dateKey: string
): boolean {
  const dates = item.dates as Record<string, unknown> | undefined
  if (dates && typeof dates === "object") {
    return dates[dateKey] === true || dates[dateKey] === "true"
  }
  if (item.date) return item.date === dateKey
  if (item.date_start && item.date_end)
    return dateKey >= String(item.date_start) && dateKey <= String(item.date_end)
  return false
}

export function targetUidExistsInSchedule(
  item: Record<string, unknown>,
  uid: string
): boolean {
  const targetUids = item.target_uids as
    | Record<string, unknown>
    | string[]
    | undefined
  if (!targetUids) return false
  if (Array.isArray(targetUids)) return targetUids.includes(uid)
  return targetUids[uid] === true || targetUids[uid] === "true"
}

// --- resolveScheduleForUser (port scheduleResolver.ts) ---

export type ScheduleSource =
  | "holiday"
  | "special_schedule"
  | "user_assignment"
  | "group_assignment"
  | "overtime_schedule"
  | "none"

export interface ResolverOutput {
  scheduleReady: boolean
  todayActive: boolean
  schedule_source: ScheduleSource
  attendance_status?: string
  assignment_id?: string
  assignment_start_date?: string
  assignment_end_date?: string
  shift_id?: string
  shift_name?: string
  timetable_id?: string
  timetable_name?: string
  work_start?: string
  work_end?: string
  check_in_start?: string
  check_in_end?: string
  check_out_start?: string
  check_out_end?: string
  late_tolerance_minute?: number
  early_out_tolerance_minute?: number
  crosses_midnight?: boolean
  overtime_flag?: boolean
  overtime_schedule_id?: string
  is_holiday_work?: boolean
}

function dateInRange(date: string, startDate: string, endDate?: string): boolean {
  if (!startDate) return false
  if (date < startDate) return false
  if (endDate && date > endDate) return false
  return true
}

async function buildFromShift(params: {
  companyId: string
  date: string
  shiftId: string
  source:
    | "special_schedule"
    | "user_assignment"
    | "group_assignment"
    | "overtime_schedule"
  assignmentId: string
}): Promise<ResolverOutput> {
  const { companyId, date, shiftId, source, assignmentId } = params
  const shiftSnap = await get(ref(db, paths.shift(companyId, shiftId)))
  if (!shiftSnap.exists()) {
    return {
      scheduleReady: false,
      todayActive: false,
      schedule_source: "none",
    }
  }
  const shift = shiftSnap.val() as Record<string, unknown>
  const dateObj = new Date(`${date}T00:00:00`)
  const dayKey = DAY_KEYS[dateObj.getDay()]
  const days = (shift.days as Record<string, Record<string, unknown>>) || {}
  const day = days[dayKey]
  if (!isActiveValue(day?.active, false) || !day?.timetable_id) {
    return {
      scheduleReady: true,
      todayActive: false,
      schedule_source: source,
      assignment_id: assignmentId,
      shift_id: shiftId,
      shift_name: String(shift.name || ""),
    }
  }
  const timetableSnap = await get(
    ref(db, paths.timetable(companyId, String(day.timetable_id)))
  )
  if (!timetableSnap.exists()) {
    return {
      scheduleReady: false,
      todayActive: false,
      schedule_source: source,
      assignment_id: assignmentId,
      shift_id: shiftId,
      shift_name: String(shift.name || ""),
    }
  }
  const timetable = timetableSnap.val() as Record<string, unknown>
  return {
    scheduleReady: true,
    todayActive: true,
    schedule_source: source,
    assignment_id: assignmentId,
    shift_id: shiftId,
    shift_name: String(shift.name || ""),
    timetable_id: String(day.timetable_id),
    timetable_name: String(timetable.name || ""),
    work_start: String(timetable.work_start || ""),
    work_end: String(timetable.work_end || ""),
    check_in_start: String(timetable.check_in_start || ""),
    check_in_end: String(timetable.check_in_end || ""),
    check_out_start: String(timetable.check_out_start || ""),
    check_out_end: String(timetable.check_out_end || ""),
    late_tolerance_minute: Number(timetable.late_tolerance_minute || 0),
    early_out_tolerance_minute: Number(
      timetable.early_out_tolerance_minute || 0
    ),
    crosses_midnight:
      timetable.crosses_midnight !== undefined
        ? Boolean(timetable.crosses_midnight)
        : timetable.work_end && timetable.work_start
          ? String(timetable.work_end) < String(timetable.work_start)
          : false,
  }
}

export async function resolveScheduleForUser(params: {
  companyId: string
  uid: string
  date: string
}): Promise<ResolverOutput> {
  const { companyId, uid, date } = params
  const employeeSnap = await get(ref(db, paths.companyUser(companyId, uid)))
  const employee = employeeSnap.exists()
    ? (employeeSnap.val() as Record<string, unknown>)
    : null
  if (!employee) {
    return { scheduleReady: false, todayActive: false, schedule_source: "none" }
  }
  const holidaySnap = await get(ref(db, paths.holiday(companyId, date)))
  const isHoliday =
    holidaySnap.exists() && holidaySnap.val()?.active === true

  const overtimeSnap = await get(ref(db, paths.overtimeSchedules(companyId)))
  let selectedOvertime: Record<string, unknown> | null = null
  if (overtimeSnap.exists()) {
    const overtimes = overtimeSnap.val() as Record<
      string,
      Record<string, unknown>
    >
    for (const id of Object.keys(overtimes)) {
      const item = overtimes[id]
      if (!item.active) continue
      if (!dateExistsInSchedule(item, date)) continue
      // Format simpan lembur (aplikasi lama & baru): peta `dates` + `target_uids`
      // tanpa `type`/`target_id` — pakai helper yang sama dengan diagnostik.
      const matchTargetUids = targetUidExistsInSchedule(item, uid)
      const matchUser =
        item.type === "user" &&
        (item.target_id === uid || item.user_id === uid || item.uid === uid)
      const matchGroup =
        item.type === "group" &&
        (item.target_id === employee.group_id ||
          item.group_id === employee.group_id)
      if (matchTargetUids || matchUser || matchGroup) {
        selectedOvertime = { ...item, id }
        break
      }
    }
  }

  const specialsSnap = await get(ref(db, paths.scheduleSpecials(companyId)))
  let selectedSpecial: Record<string, unknown> | null = null
  if (specialsSnap.exists()) {
    const specials = specialsSnap.val() as Record<
      string,
      Record<string, unknown>
    >
    for (const id of Object.keys(specials)) {
      const item = specials[id]
      if (!item.active || item.date !== date) continue
      const matchUser =
        item.type === "user" &&
        (item.target_id === uid || item.user_id === uid || item.uid === uid)
      const matchGroup =
        item.type === "group" &&
        (item.target_id === employee.group_id ||
          item.group_id === employee.group_id)
      if (matchUser || matchGroup) {
        selectedSpecial = { ...item, id }
        break
      }
    }
  }

  if (isHoliday && !selectedOvertime && !selectedSpecial) {
    return {
      scheduleReady: true,
      todayActive: false,
      schedule_source: "holiday",
      attendance_status: "libur",
      is_holiday_work: false,
    }
  }

  if (selectedOvertime) {
    let baseOutput: ResolverOutput
    if (selectedOvertime.shift_id) {
      baseOutput = await buildFromShift({
        companyId,
        date,
        shiftId: String(selectedOvertime.shift_id),
        source: "overtime_schedule",
        assignmentId: String(selectedOvertime.id),
      })
    } else {
      baseOutput = {
        scheduleReady: true,
        todayActive: true,
        schedule_source: "overtime_schedule",
        assignment_id: String(selectedOvertime.id),
        work_start: String(
          selectedOvertime.work_start || selectedOvertime.time_start || ""
        ),
        work_end: String(
          selectedOvertime.work_end || selectedOvertime.time_end || ""
        ),
        check_in_start: String(selectedOvertime.check_in_start || ""),
        check_in_end: String(selectedOvertime.check_in_end || ""),
        check_out_start: String(selectedOvertime.check_out_start || ""),
        check_out_end: String(selectedOvertime.check_out_end || ""),
        late_tolerance_minute: Number(
          selectedOvertime.late_tolerance_minute || 0
        ),
        early_out_tolerance_minute: Number(
          selectedOvertime.early_out_tolerance_minute || 0
        ),
      }
    }
    if (
      baseOutput.crosses_midnight === undefined &&
      baseOutput.work_start &&
      baseOutput.work_end
    ) {
      baseOutput.crosses_midnight =
        baseOutput.work_end < baseOutput.work_start
    }
    return {
      ...baseOutput,
      assignment_start_date: String(
        selectedOvertime.date_start ||
          selectedOvertime.start_date ||
          selectedOvertime.date ||
          ""
      ),
      assignment_end_date: String(
        selectedOvertime.date_end ||
          selectedOvertime.end_date ||
          selectedOvertime.date ||
          ""
      ),
      attendance_status: String(
        selectedOvertime.attendance_status ||
          selectedOvertime.status ||
          "lembur"
      ),
      overtime_flag: true,
      overtime_schedule_id: String(selectedOvertime.id),
      is_holiday_work: isHoliday,
    }
  }

  if (selectedSpecial) {
    const baseOutput = await buildFromShift({
      companyId,
      date,
      shiftId: String(selectedSpecial.shift_id),
      source: "special_schedule",
      assignmentId: String(selectedSpecial.id),
    })
    return {
      ...baseOutput,
      assignment_start_date: String(selectedSpecial.date || ""),
      assignment_end_date: String(selectedSpecial.date || ""),
      is_holiday_work: isHoliday,
    }
  }

  const assignmentsSnap = await get(
    ref(db, paths.scheduleAssignments(companyId))
  )
  let userAssignment: Record<string, unknown> | null = null
  let groupAssignment: Record<string, unknown> | null = null
  if (assignmentsSnap.exists()) {
    const assignments = assignmentsSnap.val() as Record<
      string,
      Record<string, unknown>
    >
    for (const id of Object.keys(assignments)) {
      const item = assignments[id]
      if (!item.active) continue
      if (
        !dateInRange(
          date,
          String(item.start_date || ""),
          String(item.end_date || "")
        )
      )
        continue
      if (item.type === "user" && item.target_id === uid) {
        userAssignment = { ...item, id }
      }
      if (item.type === "group" && item.target_id === employee.group_id) {
        groupAssignment = { ...item, id }
      }
    }
  }

  if (userAssignment) {
    const baseOutput = await buildFromShift({
      companyId,
      date,
      shiftId: String(userAssignment.shift_id),
      source: "user_assignment",
      assignmentId: String(userAssignment.id),
    })
    return {
      ...baseOutput,
      assignment_start_date: String(userAssignment.start_date || ""),
      assignment_end_date: String(userAssignment.end_date || ""),
      is_holiday_work: isHoliday,
    }
  }

  if (groupAssignment) {
    const baseOutput = await buildFromShift({
      companyId,
      date,
      shiftId: String(groupAssignment.shift_id),
      source: "group_assignment",
      assignmentId: String(groupAssignment.id),
    })
    return {
      ...baseOutput,
      assignment_start_date: String(groupAssignment.start_date || ""),
      assignment_end_date: String(groupAssignment.end_date || ""),
      is_holiday_work: isHoliday,
    }
  }

  return { scheduleReady: false, todayActive: false, schedule_source: "none" }
}

// --- diagnoseEmployeeSchedule (port scheduleDiagnostic.ts) ---

export interface DiagnosticResult {
  ok: boolean
  canAttend: boolean
  status: string
  reason: string
  employee?: Record<string, unknown>
  groupName?: string
  officeName?: string
  dayKey?: string
  details?: {
    assignment?: Record<string, unknown>
    shift?: Record<string, unknown>
    timetable?: Record<string, unknown>
    source?: string
  }
}

const dayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]

const dayKeyOf = (dateStr: string): string => {
  const date = new Date(dateStr)
  return dayNames[date.getDay()]
}

const dateMatchesItem = (
  item: Record<string, unknown>,
  dateStr: string
): boolean => {
  const dates = item.dates as Record<string, unknown> | undefined
  if (dates && typeof dates === "object") {
    return dates[dateStr] === true || dates[dateStr] === "true"
  }
  if (item.date) return item.date === dateStr
  if (item.date_start && item.date_end)
    return dateStr >= String(item.date_start) && dateStr <= String(item.date_end)
  return false
}

const targetMatchesUid = (
  targetUids: unknown,
  uid: string
): boolean => {
  if (!targetUids) return false
  if (Array.isArray(targetUids)) return targetUids.includes(uid)
  const map = targetUids as Record<string, unknown>
  return map[uid] === true || map[uid] === "true"
}

export async function diagnoseEmployeeSchedule(
  companyId: string,
  uid: string,
  dateStr: string
): Promise<DiagnosticResult> {
  try {
    const userSnap = await get(ref(db, paths.companyUser(companyId, uid)))
    if (!userSnap.exists()) {
      return {
        ok: false,
        canAttend: false,
        status: "Tidak Ditemukan",
        reason: "Data karyawan tidak ditemukan dalam organisasi.",
      }
    }
    const employee = userSnap.val() as Record<string, unknown>
    if (!employee.office_id) {
      return {
        ok: false,
        canAttend: false,
        status: "Belum Lengkap",
        reason:
          "Karyawan belum memiliki penempatan kantor yang mengaktifkan lokasi / radius absen.",
        employee,
      }
    }
    if (!employee.group_id) {
      return {
        ok: false,
        canAttend: false,
        status: "Belum Lengkap",
        reason: "Karyawan belum dimasukkan ke Grup Karyawan.",
        employee,
      }
    }
    let groupName = "Grup belum ditemukan"
    try {
      const groupSnap = await get(
        ref(db, paths.employeeGroup(companyId, String(employee.group_id)))
      )
      if (groupSnap.exists()) groupName = String(groupSnap.val().name)
    } catch {
      // nama grup opsional
    }
    let officeName = "Kantor belum ditemukan"
    try {
      const offSnap = await get(
        ref(db, paths.office(companyId, String(employee.office_id)))
      )
      if (offSnap.exists()) officeName = String(offSnap.val().name)
    } catch {
      // nama kantor opsional
    }
    const dayKey = dayKeyOf(dateStr)

    const overtimeSnap = await get(
      ref(db, paths.overtimeSchedules(companyId))
    )
    let applicableOvertime: Record<string, unknown> | null = null
    if (overtimeSnap.exists()) {
      const val = overtimeSnap.val() as Record<string, Record<string, unknown>>
      const overtimeRows = Object.keys(val)
        .map((k): Record<string, unknown> => ({ ...val[k], id: k }))
        .filter(
          (item) => item.active !== false && item.status !== "inactive"
        )
      applicableOvertime =
        overtimeRows.find(
          (item) =>
            dateMatchesItem(item, dateStr) &&
            targetMatchesUid(item.target_uids, uid)
        ) || null
    }
    if (applicableOvertime) {
      const holidaySnap = await get(ref(db, paths.holiday(companyId, dateStr)))
      const isHoliday =
        holidaySnap.exists() && holidaySnap.val().active !== false
      return {
        ok: true,
        canAttend: true,
        status: "Jadwal Lembur Aktif",
        reason: isHoliday
          ? "User memiliki Jadwal Lembur aktif pada hari libur. Libur nasional tidak memblokir presensi untuk user ini."
          : "User memiliki Jadwal Lembur aktif pada tanggal ini.",
        employee,
        groupName,
        officeName,
        dayKey,
        details: {
          source: "Jadwal Lembur",
          assignment: applicableOvertime,
          timetable: {
            name: applicableOvertime.name,
            work_start: applicableOvertime.work_start,
            work_end: applicableOvertime.work_end,
            check_in_start: applicableOvertime.check_in_start,
            check_in_end: applicableOvertime.check_in_end,
            check_out_start: applicableOvertime.check_out_start,
            check_out_end: applicableOvertime.check_out_end,
          },
        },
      }
    }

    const holidaySnap = await get(ref(db, paths.holiday(companyId, dateStr)))
    if (holidaySnap.exists() && holidaySnap.val().active !== false) {
      return {
        ok: true,
        canAttend: false,
        status: "Hari Libur",
        reason: `Tanggal ini adalah hari libur: ${holidaySnap.val().title || "Hari Libur"}. Karyawan tidak perlu melakukan presensi.`,
        employee,
        groupName,
        officeName,
        details: { source: "Hari Libur" },
      }
    }

    const specialsSnap = await get(
      ref(db, paths.scheduleSpecials(companyId))
    )
    let applicableSpecial: Record<string, unknown> | null = null
    if (specialsSnap.exists()) {
      const specials = specialsSnap.val() as Record<
        string,
        Record<string, unknown>
      >
      const specialsArr = Object.keys(specials)
        .map((k): Record<string, unknown> => ({ ...specials[k], id: k }))
        .filter((s) => s.active !== false && s.date === dateStr)
      applicableSpecial =
        specialsArr.find((s) => s.type === "user" && s.target_id === uid) ||
        specialsArr.find(
          (s) => s.type === "group" && s.target_id === employee.group_id
        ) ||
        null
    }

    let shiftId = ""
    let source = ""
    let assignmentDetails: Record<string, unknown> | null = null
    if (applicableSpecial) {
      shiftId = String(applicableSpecial.shift_id || "")
      source = `Jadwal Khusus ${String(applicableSpecial.title || "")}`
      assignmentDetails = applicableSpecial
    } else {
      const assignmentsSnap = await get(
        ref(db, paths.scheduleAssignments(companyId))
      )
      let assignmentsArr: Record<string, unknown>[] = []
      if (assignmentsSnap.exists()) {
        const data = assignmentsSnap.val() as Record<
          string,
          Record<string, unknown>
        >
        assignmentsArr = Object.keys(data)
          .map((k): Record<string, unknown> => ({ ...data[k], id: k }))
          .filter((a) => a.active !== false)
      }
      const dateObj = new Date(dateStr)
      const matchedAssignment = assignmentsArr.find((assign) => {
        const targetMatches =
          (assign.type === "user" && assign.target_id === uid) ||
          (assign.type === "group" &&
            assign.target_id === employee.group_id)
        if (!targetMatches) return false
        const start = new Date(String(assign.start_date))
        const end = assign.end_date
          ? new Date(String(assign.end_date))
          : new Date("2100-01-01")
        return dateObj >= start && dateObj <= end
      })
      if (!matchedAssignment) {
        return {
          ok: false,
          canAttend: false,
          status: "Tanpa Jadwal",
          reason:
            "Belum ada penerapan jadwal kerja yang berlaku untuk karyawan atau grup ini pada tanggal yang dipilih.",
          employee,
          groupName,
          officeName,
        }
      }
      shiftId = String(matchedAssignment.shift_id || "")
      source = "Penerapan Jadwal Rutin"
      assignmentDetails = matchedAssignment
    }

    if (!shiftId) {
      return {
        ok: false,
        canAttend: false,
        status: "Shift Tidak Ditemukan",
        reason: "Penerapan jadwal belum memilih pola shift.",
        employee,
        groupName,
        officeName,
        details: { source },
      }
    }
    const shiftSnap = await get(ref(db, paths.shift(companyId, shiftId)))
    if (!shiftSnap.exists() || shiftSnap.val().active === false) {
      return {
        ok: false,
        canAttend: false,
        status: "Pola Shift Tidak Aktif",
        reason: "Pola Shift yang diterapkan sudah dihapus atau dinonaktifkan.",
        employee,
        groupName,
        officeName,
        details: { source, assignment: assignmentDetails ?? undefined },
      }
    }
    const shift = shiftSnap.val() as Record<string, unknown>
    const dayConfig = (
      (shift.days as Record<string, Record<string, unknown>>) || {}
    )[dayKey]
    if (!isActiveValue(dayConfig?.active, false)) {
      return {
        ok: true,
        canAttend: false,
        status: "Hari Libur Rutin",
        reason:
          "Sesuai pola shift, tanggal ini bukan hari kerja aktif. Karyawan tidak perlu melakukan presensi.",
        employee,
        groupName,
        officeName,
        dayKey,
        details: { source, assignment: assignmentDetails ?? undefined, shift },
      }
    }
    const timetableId = String(dayConfig.timetable_id || "").trim()
    if (!timetableId) {
      return {
        ok: false,
        canAttend: false,
        status: "Jam Kerja Belum Dipilih",
        reason: "Jam kerja untuk tanggal ini belum dipilih pada pola shift.",
        employee,
        groupName,
        officeName,
        dayKey,
        details: { source, assignment: assignmentDetails ?? undefined, shift },
      }
    }
    const ttSnap = await get(ref(db, paths.timetable(companyId, timetableId)))
    if (!ttSnap.exists() || ttSnap.val().active === false) {
      return {
        ok: false,
        canAttend: false,
        status: "Jam Kerja Tidak Valid",
        reason:
          "Data Jam Kerja yang dipilih pada pola shift ini sudah dihapus atau dinonaktifkan.",
        employee,
        groupName,
        officeName,
        dayKey,
        details: { source, assignment: assignmentDetails ?? undefined, shift },
      }
    }
    const timetable = ttSnap.val() as Record<string, unknown>
    return {
      ok: true,
      canAttend: true,
      status: "Jadwal Siap",
      reason: "Karyawan sudah bisa menggunakan fitur presensi untuk jadwal ini.",
      employee,
      groupName,
      officeName,
      dayKey,
      details: {
        source,
        assignment: assignmentDetails ?? undefined,
        shift,
        timetable,
      },
    }
  } catch (e) {
    return {
      ok: false,
      canAttend: false,
      status: "Error Sistem",
      reason: (e as Error)?.message || "Gagal melakukan pengecekan jadwal.",
    }
  }
}

// --- Helper halaman Schedules (port pages/Schedules.tsx) ---

export function getActiveEmployees(
  employees: Record<string, unknown>[]
): Record<string, unknown>[] {
  return employees.filter((emp) => {
    const status = String(
      emp.status_akun || emp.status || "active"
    ).toLowerCase()
    if (emp.active === false || status === "inactive" || emp.is_active === false)
      return false
    return true
  })
}

export function uniqueUids(uids: string[]): string[] {
  return Array.from(new Set(uids.filter(Boolean)))
}

export function resolveTargetUids(
  employees: Record<string, unknown>[],
  targetType: string,
  targetId: string
): string[] {
  if (!targetId) return []
  const normalizedType = String(targetType || "").toLowerCase()
  if (
    normalizedType === "user" ||
    normalizedType === "individual" ||
    normalizedType === "employee"
  ) {
    return [targetId]
  }
  if (normalizedType === "group") {
    return getActiveEmployees(employees)
      .filter((emp) => emp.group_id === targetId)
      .map((emp) => String(emp.uid))
  }
  if (normalizedType === "all" || normalizedType === "company") {
    return getActiveEmployees(employees).map((emp) => String(emp.uid))
  }
  return []
}

export function resolveUsersImpactedByShift(
  assignments: Record<string, unknown>[],
  specials: Record<string, unknown>[],
  employees: Record<string, unknown>[],
  shiftId: string
): string[] {
  const fromAssignments = assignments
    .filter((item) => {
      const active = item.active !== false && item.status !== "inactive"
      return active && item.shift_id === shiftId
    })
    .flatMap((item) =>
      resolveTargetUids(
        employees,
        String(item.type || item.target_type || "individual"),
        String(item.target_id || "")
      )
    )
  const fromSpecials = specials
    .filter((item) => {
      const active = item.active !== false && item.status !== "inactive"
      return active && item.shift_id === shiftId
    })
    .flatMap((item) =>
      resolveTargetUids(
        employees,
        String(item.type || item.target_type || "individual"),
        String(item.target_id || "")
      )
    )
  return uniqueUids([...fromAssignments, ...fromSpecials])
}

export function resolveUsersImpactedByTimetable(
  shifts: Record<string, unknown>[],
  assignments: Record<string, unknown>[],
  specials: Record<string, unknown>[],
  employees: Record<string, unknown>[],
  timetableId: string
): string[] {
  const shiftIds = shifts
    .filter((shift) => {
      const days = (shift.days as Record<string, Record<string, unknown>>) || {}
      return Object.values(days).some(
        (day) => day?.active !== false && day?.timetable_id === timetableId
      )
    })
    .map((shift) => String(shift.id))
  return uniqueUids(
    shiftIds.flatMap((shiftId) =>
      resolveUsersImpactedByShift(assignments, specials, employees, shiftId)
    )
  )
}

export function findOvertimeConflicts(params: {
  overtimeSchedules: Record<string, unknown>[]
  employees: Record<string, unknown>[]
  scheduleId?: string
  selectedDates: string[]
  selectedUids: string[]
  workStart: string
  workEnd: string
}): string[] {
  const {
    overtimeSchedules,
    employees,
    scheduleId,
    selectedDates,
    selectedUids,
    workStart,
    workEnd,
  } = params
  const conflicts: string[] = []
  for (const existing of overtimeSchedules) {
    const existingId = String(existing.id || existing.schedule_id || "")
    if (scheduleId && existingId === scheduleId) continue
    if (existing.active === false || existing.status === "inactive") continue
    const existingWorkStart = String(existing.work_start || "")
    const existingWorkEnd = String(existing.work_end || "")
    for (const dateKey of selectedDates) {
      if (!dateExistsInSchedule(existing, dateKey)) continue
      for (const uid of selectedUids) {
        if (!targetUidExistsInSchedule(existing, uid)) continue
        if (
          !timeRangeOverlaps(
            workStart,
            workEnd,
            existingWorkStart,
            existingWorkEnd
          )
        )
          continue
        const emp = employees.find((e) => e.uid === uid)
        const name = String(
          (emp?.nama_lengkap as string) || "Karyawan tidak ditemukan"
        )
        conflicts.push(
          `${name} sudah memiliki jadwal lembur "${String(existing.name || "Jadwal Lembur")}" pada ${dateKeyToLabel(dateKey)} pukul ${existingWorkStart || "-"}-${existingWorkEnd || "-"}.`
        )
      }
    }
  }
  return conflicts
}

export async function writeScheduleChangeLog(
  companyId: string,
  payload: {
    admin_uid: string
    admin_name: string
    action: string
    ref_type: string
    ref_id: string
    new_value: string
    old_value?: string
  }
): Promise<void> {
  const logRef = push(ref(db, paths.scheduleChangeLogs(companyId)))
  await set(logRef, { ...payload, created_at: Date.now() })
}

export async function sendScheduleChangeNotifications(params: {
  companyId: string
  uids: string[]
  title: string
  message: string
  refId: string
  userData: FirebaseUserData | null
  extraData?: Record<string, unknown>
}): Promise<void> {
  const { companyId, uids, title, message, refId, userData, extraData = {} } =
    params
  const uniqueTargets = uniqueUids(uids)
  if (uniqueTargets.length === 0) {
    console.info("Tidak ada target user untuk notifikasi jadwal.", {
      title,
      refId,
    })
    return
  }
  const results = await Promise.allSettled(
    uniqueTargets.map((uid) =>
      createNotification(uid, {
        company_id: companyId,
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
      })
    )
  )
  const failed = results.filter((r) => r.status === "rejected")
  if (failed.length > 0) {
    console.warn("Sebagian notifikasi jadwal gagal dikirim.", failed)
    toast.error(
      `${failed.length} notifikasi jadwal gagal dikirim. Cek Log Notifikasi.`
    )
  }
}
