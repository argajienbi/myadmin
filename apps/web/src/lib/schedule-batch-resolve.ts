// Resolver jadwal batch in-memory — satu sumber untuk pemindai deteksi
// otomatis (lib/auto-detect-scan.ts) dan halaman Absensi
// (features/utama/attendance-page.tsx).
// Cerminan resolveScheduleForUser di features/utama/schedule-data.ts
// (prioritas + pencocokan target yang sama), tapi bekerja di atas master
// data yang sudah dibaca sekali — bukan per karyawan (memanggil
// resolveScheduleForUser per karyawan = ±7 baca RTDB × ±200 karyawan).
// Helper kecil di bawah disalin dari file itu (isActiveValue,
// dateExistsInSchedule, targetUidExistsInSchedule, DAY_KEYS, dateInRange)
// — tidak diimpor dari features, supaya lib tetap mandiri (preseden S1).
// Bila prioritas di schedule-data.ts berubah, file ini wajib ikut diubah.
import { get, ref } from "firebase/database"
import { getDb } from "./firebase"
import { paths } from "./firebase-paths"

/** Batas default "tidak absen masuk" (jam WIB) — default pengaturan S1
 * (auto_detect_no_check_in_cutoff) sekaligus batas sintesis halaman
 * Absensi untuk hari ini. Satu sumber supaya halaman dan notifikasi
 * sepakat kapan seseorang disebut tidak absen. */
export const DEFAULT_NO_CHECK_IN_CUTOFF = "10:00"

/** "HH:mm" -> menit sejak tengah malam, atau null bila tidak parse. */
export function toMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null
  }
  return h * 60 + min
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** Menit saat ini dalam WIB (Asia/Jakarta), apa pun zona browser admin. */
export function nowMinutesWIB(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0)
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0)
  return h * 60 + m
}

export function isActiveEmployee(rec: Record<string, unknown>): boolean {
  // Sama seperti Dashboard (filteredEmployees): hanya status_akun active.
  return String(rec.status_akun || "") === "active"
}

// --- Pengajuan (cerminan approvals-page.tsx) ---

export function leaveTypeValue(req: Record<string, unknown>): string {
  return String(req.type || req.leave_type || "izin").toLowerCase()
}

export function leaveStartDate(req: Record<string, unknown>): string {
  return String(
    req.date_start ||
      req.tanggal_mulai ||
      req.date ||
      req.tanggal ||
      req.start_date ||
      req.overtime_date ||
      ""
  )
}

export function leaveEndDate(req: Record<string, unknown>): string {
  return String(
    req.date_end ||
      req.tanggal_selesai ||
      req.date_start ||
      req.tanggal_mulai ||
      req.overtime_date ||
      req.date ||
      req.tanggal ||
      req.start_date ||
      ""
  )
}

export function leaveCoversDate(
  req: Record<string, unknown>,
  dateKey: string
): boolean {
  const start = leaveStartDate(req)
  const end = leaveEndDate(req)
  if (start && end) return start <= dateKey && dateKey <= end
  if (start) return start === dateKey
  return false
}

/**
 * Karyawan yang izin/cuti/sakit-nya disetujui dan mencakup tanggal itu
 * (cerminan Dashboard): mereka dilewati aturan tidak-absen.
 * "validated" dinormalisasi jadi "approved" di aplikasi (PORT_CONTRACT
 * §7.5: approved bila approved|disetujui|validated|success|done).
 */
export function excusedUidsOn(
  leavesVal: Record<string, Record<string, unknown>>,
  dateKey: string
): Set<string> {
  const out = new Set<string>()
  for (const [key, raw] of Object.entries(leavesVal)) {
    const req = (raw ?? {}) as Record<string, unknown>
    if (!["approved", "validated"].includes(String(req.status || "")))
      continue
    if (!["izin", "cuti", "sakit"].includes(leaveTypeValue(req))) continue
    if (!leaveCoversDate(req, dateKey)) continue
    const uid = String(req.uid || key)
    if (uid) out.add(uid)
  }
  return out
}

// --- Resolver jadwal harian in-memory ---

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const

function isActiveValue(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1
  const text = String(value).trim().toLowerCase()
  return (
    text === "true" || text === "1" || text === "active" || text === "yes"
  )
}

function dateInRange(date: string, startDate: string, endDate?: string): boolean {
  if (!startDate) return false
  if (date < startDate) return false
  if (endDate && date > endDate) return false
  return true
}

function dateExistsInSchedule(
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

function targetUidExistsInSchedule(
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

export type ScheduleSource =
  | "holiday"
  | "special_schedule"
  | "user_assignment"
  | "group_assignment"
  | "overtime_schedule"
  | "none"

export interface ResolvedDay {
  todayActive: boolean
  source: ScheduleSource
  workStart: string
  workEnd: string
  checkOutEnd: string
  crossesMidnight: boolean
  overtimeFlag: boolean
}

export interface ScheduleMaster {
  /** Peta tanggal -> record libur (node holidays utuh). */
  holidays: Record<string, unknown>
  overtimeSchedules: Record<string, Record<string, unknown>>
  specials: Record<string, Record<string, unknown>>
  assignments: Record<string, Record<string, unknown>>
  shifts: Record<string, Record<string, unknown>>
  timetables: Record<string, Record<string, unknown>>
}

const INACTIVE_DAY: ResolvedDay = {
  todayActive: false,
  source: "none",
  workStart: "",
  workEnd: "",
  checkOutEnd: "",
  crossesMidnight: false,
  overtimeFlag: false,
}

function buildFromShiftInMemory(
  master: ScheduleMaster,
  date: string,
  shiftId: string,
  source: ScheduleSource
): ResolvedDay {
  const shift = master.shifts[shiftId] as Record<string, unknown> | undefined
  if (!shift) return { ...INACTIVE_DAY, source: "none" }
  const dayKey = DAY_KEYS[new Date(`${date}T00:00:00`).getDay()]
  const days = (shift.days as Record<string, Record<string, unknown>>) || {}
  const day = days[dayKey]
  if (!isActiveValue(day?.active, false) || !day?.timetable_id) {
    return { ...INACTIVE_DAY, source }
  }
  const timetable = master.timetables[String(day.timetable_id)] as
    | Record<string, unknown>
    | undefined
  if (!timetable) return { ...INACTIVE_DAY, source }
  const workStart = String(timetable.work_start || "")
  const workEnd = String(timetable.work_end || "")
  return {
    todayActive: true,
    source,
    workStart,
    workEnd,
    checkOutEnd: String(timetable.check_out_end || ""),
    crossesMidnight:
      timetable.crosses_midnight !== undefined
        ? Boolean(timetable.crosses_midnight)
        : workEnd && workStart
          ? workEnd < workStart
          : false,
    overtimeFlag: false,
  }
}

/**
 * Resolve jadwal satu karyawan untuk satu tanggal dari master data yang
 * sudah dibaca sekali. Prioritas sama seperti resolveScheduleForUser:
 * lembur > khusus > libur > penugasan user > penugasan grup.
 */
export function resolveDayFor(
  emp: Record<string, unknown>,
  date: string,
  master: ScheduleMaster
): ResolvedDay {
  const uid = String(emp.uid || "")
  const groupId = String(emp.group_id || "")

  let selectedOvertime: Record<string, unknown> | null = null
  for (const id of Object.keys(master.overtimeSchedules)) {
    const item = master.overtimeSchedules[id]
    if (!isActiveValue(item.active, true) || item.status === "inactive") continue
    if (!dateExistsInSchedule(item, date)) continue
    const matchTargetUids = targetUidExistsInSchedule(item, uid)
    const matchUser =
      item.type === "user" &&
      (item.target_id === uid || item.user_id === uid || item.uid === uid)
    const matchGroup =
      item.type === "group" &&
      (item.target_id === groupId || item.group_id === groupId)
    if (matchTargetUids || matchUser || matchGroup) {
      selectedOvertime = { ...item, id }
      break
    }
  }

  let selectedSpecial: Record<string, unknown> | null = null
  for (const id of Object.keys(master.specials)) {
    const item = master.specials[id]
    if (!isActiveValue(item.active, true) || item.date !== date) continue
    const matchUser =
      item.type === "user" &&
      (item.target_id === uid || item.user_id === uid || item.uid === uid)
    const matchGroup =
      item.type === "group" &&
      (item.target_id === groupId || item.group_id === groupId)
    if (matchUser || matchGroup) {
      selectedSpecial = { ...item, id }
      break
    }
  }

  const holidayRec = master.holidays[date] as
    | Record<string, unknown>
    | undefined
  const isHoliday =
    holidayRec !== undefined && isActiveValue(holidayRec.active, true)
  if (isHoliday && !selectedOvertime && !selectedSpecial) {
    return { ...INACTIVE_DAY, source: "holiday" }
  }

  if (selectedOvertime) {
    let base: ResolvedDay
    if (selectedOvertime.shift_id) {
      base = buildFromShiftInMemory(
        master,
        date,
        String(selectedOvertime.shift_id),
        "overtime_schedule"
      )
    } else {
      const workStart = String(
        selectedOvertime.work_start || selectedOvertime.time_start || ""
      )
      const workEnd = String(
        selectedOvertime.work_end || selectedOvertime.time_end || ""
      )
      base = {
        todayActive: true,
        source: "overtime_schedule",
        workStart,
        workEnd,
        checkOutEnd: String(selectedOvertime.check_out_end || ""),
        crossesMidnight:
          workStart && workEnd ? workEnd < workStart : false,
        overtimeFlag: false,
      }
    }
    return { ...base, overtimeFlag: true }
  }

  if (selectedSpecial) {
    return buildFromShiftInMemory(
      master,
      date,
      String(selectedSpecial.shift_id),
      "special_schedule"
    )
  }

  let userAssignment: Record<string, unknown> | null = null
  let groupAssignment: Record<string, unknown> | null = null
  for (const id of Object.keys(master.assignments)) {
    const item = master.assignments[id]
    if (!isActiveValue(item.active, true)) continue
    if (
      !dateInRange(
        date,
        String(item.start_date || ""),
        String(item.end_date || "")
      )
    ) {
      continue
    }
    if (item.type === "user" && item.target_id === uid) {
      userAssignment = { ...item, id }
    }
    if (item.type === "group" && item.target_id === groupId) {
      groupAssignment = { ...item, id }
    }
  }

  if (userAssignment) {
    return buildFromShiftInMemory(
      master,
      date,
      String(userAssignment.shift_id),
      "user_assignment"
    )
  }
  if (groupAssignment) {
    return buildFromShiftInMemory(
      master,
      date,
      String(groupAssignment.shift_id),
      "group_assignment"
    )
  }
  return { ...INACTIVE_DAY }
}

/**
 * Muat master jadwal sekali (6 baca RTDB paralel). Null bila Firebase
 * belum dikonfigurasi; throw bila ada baca yang gagal (pemanggil yang
 * memutuskan: scan membatalkan pemindaian, halaman melewati sintesis).
 */
export async function loadScheduleMaster(
  companyId: string
): Promise<ScheduleMaster | null> {
  const db = getDb()
  if (!db || !companyId) return null
  const [
    holidaysSnap,
    overtimeSnap,
    specialsSnap,
    assignmentsSnap,
    shiftsSnap,
    timetablesSnap,
  ] = await Promise.all([
    get(ref(db, paths.holidays(companyId))),
    get(ref(db, paths.overtimeSchedules(companyId))),
    get(ref(db, paths.scheduleSpecials(companyId))),
    get(ref(db, paths.scheduleAssignments(companyId))),
    get(ref(db, paths.shifts(companyId))),
    get(ref(db, paths.timetables(companyId))),
  ])
  return {
    holidays:
      (holidaysSnap.val() as Record<string, unknown> | null) || {},
    overtimeSchedules:
      (overtimeSnap.val() as Record<string, Record<string, unknown>> | null) ||
      {},
    specials:
      (specialsSnap.val() as Record<string, Record<string, unknown>> | null) ||
      {},
    assignments:
      (assignmentsSnap.val() as Record<string, Record<string, unknown>> | null) ||
      {},
    shifts:
      (shiftsSnap.val() as Record<string, Record<string, unknown>> | null) ||
      {},
    timetables:
      (timetablesSnap.val() as Record<string, Record<string, unknown>> | null) ||
      {},
  }
}
