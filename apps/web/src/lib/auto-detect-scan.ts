// Pemindai deteksi otomatis — notifikasi header MyAdmin.
// Cerminan mock-alert-scan.ts: sekali per sesi login (guard modul),
// pindai hari ini dan kirim notifikasi (inbox + antrean push, jalur
// createNotification yang sama) ke semua admin + owner perusahaan.
// Satu kejadian hanya diberitahu satu kali: penanda ditulis di record-nya
// (pola mock_alert_sent) — untuk "tidak absen masuk" yang tidak punya
// record, penanda ditulis di node dedupe harian
// `companies/{id}/notification_dedupe/{date}` (node yang sama dikelola
// resetDedupeToday di Log Notifikasi), dengan kunci berawalan
// `auto_detect_`. Tanpa kejadian baru: tidak menulis apa pun (login
// normal = read-only). Kegagalan dicatat ke console, tidak dilempar ke UI.
//
// Aturan (default dari mockup yang disetujui; bisa diubah lewat node
// `companies/{id}/notification_settings/main` — skema kunci ada di
// RENCANA S1, UI pengaturannya batch S4):
//   a. Telat masuk — getLateMinutes(row) > toleransi (default 15 mnt).
//   b. Tidak absen masuk — karyawan aktif yang dijadwalkan kerja hari ini
//      tapi belum ada record masuk sampai batas (default pukul 10:00).
//   c. Tidak absen pulang — sudah masuk tapi belum ada record pulang
//      60 mnt setelah jam pulang shift.
//   d. Pengajuan baru (izin/cuti/sakit/lembur) — leave_requests pending
//      yang belum pernah diberitahu.
//   e. Jam lembur janggal — pengajuan lembur pending: durasi > 4 jam/hari,
//      ATAU jam akhir > 22:00, ATAU jam lembur tidak cocok dengan presensi
//      hari itu (hanya bila overtime_date = hari ini).
// Jadwal harian di-resolve in-memory dari master data (sekali baca per
// node) dengan prioritas yang sama seperti resolveScheduleForUser di
// features/utama/schedule-data.ts: lembur > khusus > penugasan user >
// penugasan grup > libur. Memanggil resolveScheduleForUser per karyawan
// (±7 baca RTDB × ±200 karyawan) terlalu berat untuk hook login — karena
// itu logikanya dicerminkan di sini; bila prioritas di schedule-data.ts
// berubah, cerminan ini wajib ikut diubah.
import { get, ref, set, update } from "firebase/database"
import { getDb } from "./firebase"
import { firestorePaths, paths } from "./firebase-paths"
import { createNotification } from "./firebase-notify"
import { isOwnerLike, normalizeRole } from "./role-access"
import {
  getLateMinutes,
  isCheckIn,
  isCheckOut,
} from "./attendance-utils"
import {
  loadAttendanceByDateRange,
  todayKey,
  type AttendanceRow,
} from "./rtdb-lean-service"
import {
  DEFAULT_NO_CHECK_IN_CUTOFF,
  excusedUidsOn,
  fromMinutes,
  isActiveEmployee,
  leaveEndDate,
  leaveStartDate,
  leaveTypeValue,
  nowMinutesWIB,
  resolveDayFor,
  toMinutes,
} from "./schedule-batch-resolve"
import type {
  ResolvedDay,
  ScheduleMaster,
} from "./schedule-batch-resolve"

const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
]

// Sekali per companyId selama halaman ini hidup (sekali per sesi login).
const scannedCompanies = new Set<string>()

// --- Pengaturan (node yang sama dengan halaman Pengaturan Notifikasi) ---

interface AutoDetectSettings {
  enabled: boolean
  lateEnabled: boolean
  lateToleranceMinutes: number
  noCheckInEnabled: boolean
  noCheckInCutoff: string
  noCheckOutEnabled: boolean
  noCheckOutAfterMinutes: number
  newRequestEnabled: boolean
  overtimeEnabled: boolean
  overtimeMaxHours: number
  overtimeLatestEnd: string
}

const DEFAULT_AUTO_DETECT_SETTINGS: AutoDetectSettings = {
  enabled: true,
  lateEnabled: true,
  lateToleranceMinutes: 15,
  noCheckInEnabled: true,
  noCheckInCutoff: DEFAULT_NO_CHECK_IN_CUTOFF,
  noCheckOutEnabled: true,
  noCheckOutAfterMinutes: 60,
  newRequestEnabled: true,
  overtimeEnabled: true,
  overtimeMaxHours: 4,
  overtimeLatestEnd: "22:00",
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const text = value.trim().toLowerCase()
    if (text === "true" || text === "1") return true
    if (text === "false" || text === "0") return false
  }
  return fallback
}

function asClampedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function asTimeString(value: unknown, fallback: string): string {
  const text = String(value || "").trim()
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [h, m] = text.split(":").map(Number)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    }
  }
  return fallback
}

function mergeAutoDetectSettings(
  data: Record<string, unknown> | null
): AutoDetectSettings {
  const d = data ?? {}
  const f = DEFAULT_AUTO_DETECT_SETTINGS
  return {
    enabled: asBool(d.auto_detect_enabled, f.enabled),
    lateEnabled: asBool(d.auto_detect_late_enabled, f.lateEnabled),
    lateToleranceMinutes: asClampedNumber(
      d.auto_detect_late_tolerance_minutes,
      f.lateToleranceMinutes,
      0,
      720
    ),
    noCheckInEnabled: asBool(d.auto_detect_no_check_in_enabled, f.noCheckInEnabled),
    noCheckInCutoff: asTimeString(d.auto_detect_no_check_in_cutoff, f.noCheckInCutoff),
    noCheckOutEnabled: asBool(d.auto_detect_no_check_out_enabled, f.noCheckOutEnabled),
    noCheckOutAfterMinutes: asClampedNumber(
      d.auto_detect_no_check_out_after_minutes,
      f.noCheckOutAfterMinutes,
      0,
      720
    ),
    newRequestEnabled: asBool(d.auto_detect_new_request_enabled, f.newRequestEnabled),
    overtimeEnabled: asBool(d.auto_detect_overtime_enabled, f.overtimeEnabled),
    overtimeMaxHours: asClampedNumber(
      d.auto_detect_overtime_max_hours,
      f.overtimeMaxHours,
      1,
      24
    ),
    overtimeLatestEnd: asTimeString(
      d.auto_detect_overtime_latest_end,
      f.overtimeLatestEnd
    ),
  }
}

// --- Helper kecil (cerminan mock-alert-scan.ts / format.ts) ---

function isAdminLike(rec: Record<string, unknown>): boolean {
  if (isOwnerLike(rec)) return true
  return (
    normalizeRole(rec.role) === "admin" ||
    String(rec.position || "").trim().toLowerCase() === "admin"
  )
}

function employeeName(rec: unknown): string {
  // Sama seperti employeeName di features/utama/format.ts (B1).
  const r = (rec ?? {}) as Record<string, unknown>
  const value = (key: string) => String(r[key] ?? "").trim()
  return (
    value("user_name") ||
    value("nama_lengkap") ||
    value("employee_name") ||
    value("target_name") ||
    value("name") ||
    "Karyawan"
  )
}

function formatTanggalId(dateKey: string): string {
  const [y, m, d] = dateKey.split("-")
  const month = MONTHS_ID[Number(m || 0) - 1] || ""
  return `${Number(d || 0)} ${month} ${y}`.trim()
}

function timeLabel(row: AttendanceRow): string {
  return String(row.record_time || row.waktu || row.time || "").slice(0, 5)
}

function time5(value: unknown): string {
  return String(value || "").slice(0, 5)
}

function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1).replace(".", ",")} jam`
}

function formatDateRange(start: string, end: string): string {
  if (!start) return ""
  if (!end || end === start) return formatTanggalId(start)
  const [sy, sm, sd] = start.split("-")
  const [ey, em, ed] = end.split("-")
  if (sy === ey && sm === em) {
    return `${Number(sd)}–${Number(ed)} ${MONTHS_ID[Number(sm) - 1]} ${sy}`
  }
  return `${formatTanggalId(start)}–${formatTanggalId(end)}`
}

// --- Pengajuan (cerminan approvals-page.tsx) ---

const PENDING_LEAVE = ["pending", "pending_admin", "processing"]

function isPendingStatus(status: unknown): boolean {
  return PENDING_LEAVE.includes(String(status || ""))
}

function overtimeMinutes(req: Record<string, unknown>): number | null {
  const direct = Number(req.overtime_duration_minute || 0)
  if (Number.isFinite(direct) && direct > 0) return direct
  const s = toMinutes(String(req.overtime_start_time || ""))
  const e = toMinutes(String(req.overtime_end_time || ""))
  if (s === null || e === null) return null
  const diff = e - s
  return diff > 0 ? diff : null
}

// --- Kejadian + pengiriman ---

interface AutoDetectEvent {
  title: string
  message: string
  type: "warning" | "approval"
  refType: string
  refId: string
  data: Record<string, unknown>
  /** Tulis penanda "sudah diberitahu" — hanya dipanggil bila SEMUA penerima berhasil. */
  mark: () => Promise<void>
}

async function notifyAll(
  companyId: string,
  recipients: string[],
  event: AutoDetectEvent
): Promise<boolean> {
  let sent = 0
  for (const recipientUid of recipients) {
    try {
      await createNotification(recipientUid, {
        company_id: companyId,
        title: event.title,
        message: event.message,
        type: event.type,
        ref_type: event.refType,
        ref_id: event.refId,
        data: event.data,
      })
      sent++
    } catch (err) {
      console.error("scanAutoDetect: gagal memberi tahu", recipientUid, err)
    }
  }
  return recipients.length > 0 && sent === recipients.length
}

/**
 * Pindai deteksi otomatis hari ini dan beri tahu admin/owner bila ada
 * kejadian baru. Mengembalikan jumlah kejadian yang diberitahu (0 bila
 * tidak ada yang baru — tanpa menulis apa pun).
 */
export async function scanAutoDetect(companyId: string): Promise<number> {
  const db = getDb()
  if (!db || !companyId) return 0
  const today = todayKey()

  // Pengaturan dulu: bila master dimatikan, tidak ada baca lain.
  let settings: AutoDetectSettings
  try {
    const settingsSnap = await get(
      ref(db, firestorePaths.notificationSettings(companyId))
    )
    settings = mergeAutoDetectSettings(
      (settingsSnap.val() as Record<string, unknown> | null) || null
    )
  } catch (err) {
    console.error("scanAutoDetect: gagal memuat pengaturan, pakai default", err)
    settings = { ...DEFAULT_AUTO_DETECT_SETTINGS }
  }
  if (!settings.enabled) return 0

  // Muat semua sumber sekaligus. Bila satu pun gagal, batalkan pemindaian
  // (coba lagi saat login berikutnya) — jangan beri tahu setengah-setengah.
  let rows: AttendanceRow[]
  let usersVal: Record<string, Record<string, unknown>>
  let leavesVal: Record<string, Record<string, unknown>>
  let dedupeToday: Record<string, unknown>
  let master: ScheduleMaster
  try {
    const [
      rowsResult,
      usersSnap,
      leavesSnap,
      dedupeSnap,
      holidaySnap,
      overtimeSnap,
      specialsSnap,
      assignmentsSnap,
      shiftsSnap,
      timetablesSnap,
    ] = await Promise.all([
      loadAttendanceByDateRange({
        companyId,
        startDate: today,
        endDate: today,
      }),
      get(ref(db, paths.companyUsers(companyId))),
      get(ref(db, paths.leaveRequests(companyId))),
      get(ref(db, `companies/${companyId}/notification_dedupe/${today}`)),
      get(ref(db, paths.holiday(companyId, today))),
      get(ref(db, paths.overtimeSchedules(companyId))),
      get(ref(db, paths.scheduleSpecials(companyId))),
      get(ref(db, paths.scheduleAssignments(companyId))),
      get(ref(db, paths.shifts(companyId))),
      get(ref(db, paths.timetables(companyId))),
    ])
    rows = rowsResult
    usersVal =
      (usersSnap.val() as Record<string, Record<string, unknown>> | null) || {}
    leavesVal =
      (leavesSnap.val() as Record<string, Record<string, unknown>> | null) || {}
    dedupeToday = (dedupeSnap.val() as Record<string, unknown> | null) || {}
    master = {
      holidays: holidaySnap.exists() ? { [today]: holidaySnap.val() } : {},
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
  } catch (err) {
    console.error("scanAutoDetect: gagal memuat data hari ini", err)
    return 0
  }

  const nowMin = nowMinutesWIB()
  const cutoffMin = toMinutes(settings.noCheckInCutoff) ?? 600

  // Peta presensi hari ini per karyawan.
  const checkInByUid = new Map<string, AttendanceRow>()
  const checkOutByUid = new Map<string, AttendanceRow>()
  for (const row of rows) {
    const uid = String(row.uid || "")
    if (!uid) continue
    if (isCheckIn(row) && !checkInByUid.has(uid)) checkInByUid.set(uid, row)
    if (isCheckOut(row) && !checkOutByUid.has(uid)) checkOutByUid.set(uid, row)
  }

  // Karyawan yang izin/cuti/sakit-nya disetujui dan mencakup hari ini:
  // mereka dilewati aturan tidak-absen.
  const excusedToday = excusedUidsOn(leavesVal, today)

  // Jadwal hari ini per karyawan aktif (di-resolve sekali, dipakai
  // aturan b, c, dan cek silang lembur).
  const resolvedByUid = new Map<string, ResolvedDay>()
  for (const [uid, rec] of Object.entries(usersVal)) {
    if (!rec || !isActiveEmployee(rec)) continue
    resolvedByUid.set(uid, resolveDayFor({ ...rec, uid }, today, master))
  }

  const events: AutoDetectEvent[] = []
  const markAttendanceRecord =
    (uid: string, actionKey: string, patch: Record<string, unknown>) =>
    async () => {
      await update(
        ref(db, paths.attendanceRecord(companyId, uid, today, actionKey)),
        patch
      )
    }
  const markLeaveRequest =
    (requestId: string, patch: Record<string, unknown>) => async () => {
      await update(ref(db, paths.leaveRequest(companyId, requestId)), patch)
    }

  // --- (a) Telat masuk ---
  if (settings.lateEnabled) {
    for (const row of rows) {
      if (!isCheckIn(row)) continue
      const minutes = getLateMinutes(row)
      if (minutes === null || minutes <= settings.lateToleranceMinutes) continue
      if (row.auto_detect_late_notified === true) continue
      const uid = String(row.uid || "")
      const dateKey = String(row.dateKey || row.record_date || today)
      const actionKey = String(row.action_type || row.record_action || "")
      if (!uid || !actionKey) continue
      const workStart = String(
        row.work_start || row.schedule_work_start || row.timetable_work_start || ""
      )
      const workEnd = String(
        row.work_end || row.schedule_work_end || row.timetable_work_end || ""
      )
      const office = String(row.office_name || row.office || "")
      const shiftText =
        workStart && workEnd ? ` Shift ${time5(workStart)}–${time5(workEnd)}` : ""
      const officeText = office ? `, ${office}` : ""
      events.push({
        title: "⏰ Telat Masuk",
        message:
          `${employeeName(usersVal[uid])} — Masuk ${timeLabel(row)} WIB, ` +
          `terlambat ${minutes} mnt.${shiftText}${officeText}, ` +
          `${formatTanggalId(dateKey)}. Perlu validasi admin.`,
        type: "warning",
        refType: "attendance",
        refId: `${dateKey}_${uid}_late_masuk`,
        data: { route: "/admin/attendance", date: dateKey, status: "terlambat" },
        mark: markAttendanceRecord(uid, actionKey, {
          auto_detect_late_notified: true,
        }),
      })
    }
  }

  // --- (b) Tidak absen masuk ---
  if (settings.noCheckInEnabled && nowMin >= cutoffMin) {
    for (const [uid, resolved] of resolvedByUid) {
      if (!resolved.todayActive) continue
      if (excusedToday.has(uid)) continue
      if (checkInByUid.has(uid)) continue
      // Shift yang baru mulai setelah batas belum jatuh tempo.
      const workStartMin = toMinutes(resolved.workStart)
      if (workStartMin !== null && workStartMin > cutoffMin) continue
      if (dedupeToday[`auto_detect_no_check_in_${uid}`] != null) continue
      const shiftText =
        resolved.workStart && resolved.workEnd
          ? ` Jadwal ${time5(resolved.workStart)}–${time5(resolved.workEnd)}`
          : ""
      events.push({
        title: "🚫 Tidak Absen Masuk",
        message:
          `${employeeName(usersVal[uid])} — belum absen masuk hari ini.` +
          `${shiftText}, sudah lewat batas ${settings.noCheckInCutoff}. ` +
          "Perlu validasi admin.",
        type: "warning",
        refType: "attendance",
        refId: `${today}_${uid}_no_check_in`,
        data: { route: "/admin/attendance", date: today, status: "tidak_absen" },
        mark: async () => {
          await set(
            ref(
              db,
              `companies/${companyId}/notification_dedupe/${today}/auto_detect_no_check_in_${uid}`
            ),
            { notified_at: Date.now() }
          )
        },
      })
    }
  }

  // --- (c) Tidak absen pulang ---
  if (settings.noCheckOutEnabled) {
    for (const [uid, checkInRow] of checkInByUid) {
      if (checkOutByUid.has(uid)) continue
      if (checkInRow.auto_detect_no_checkout_notified === true) continue
      const resolved = resolvedByUid.get(uid)
      if (!resolved || !resolved.todayActive) continue
      if (resolved.crossesMidnight) continue
      const workEnd = resolved.workEnd || resolved.checkOutEnd
      const workEndMin = toMinutes(workEnd)
      if (workEndMin === null) continue
      const limitMin = workEndMin + settings.noCheckOutAfterMinutes
      if (nowMin < limitMin) continue
      const actionKey = String(
        checkInRow.action_type || checkInRow.record_action || ""
      )
      if (!actionKey) continue
      events.push({
        title: "🏠 Tidak Absen Pulang",
        message:
          `${employeeName(usersVal[uid])} — Masuk ${timeLabel(checkInRow)} WIB, ` +
          `belum absen pulang. Jam pulang shift ${time5(workEnd)}, ` +
          `batas ${fromMinutes(limitMin)} sudah lewat. Perlu validasi admin.`,
        type: "warning",
        refType: "attendance",
        refId: `${today}_${uid}_no_check_out`,
        data: { route: "/admin/attendance", date: today, status: "belum_pulang" },
        mark: markAttendanceRecord(uid, actionKey, {
          auto_detect_no_checkout_notified: true,
        }),
      })
    }
  }

  // --- (d) Pengajuan baru & (e) Jam lembur janggal ---
  if (settings.newRequestEnabled || settings.overtimeEnabled) {
    for (const [key, raw] of Object.entries(leavesVal)) {
      const req = (raw ?? {}) as Record<string, unknown>
      if (!isPendingStatus(req.status)) continue
      const requestId = String(req.request_id || key)
      const uid = String(req.uid || "")
      const type = leaveTypeValue(req)
      const startDate = leaveStartDate(req)
      const detailDate = formatDateRange(startDate, leaveEndDate(req))
      const name = employeeName(usersVal[uid] || req)

      // (e) Lembur janggal — diperiksa dulu; bila janggal, HANYA notifikasi
      // janggal yang dikirim (bukan dobel dengan "pengajuan baru").
      if (type === "lembur" && settings.overtimeEnabled) {
        const violations: string[] = []
        const durMin = overtimeMinutes(req)
        const maxMin = settings.overtimeMaxHours * 60
        if (durMin !== null && durMin > maxMin) {
          violations.push(
            `durasi ${formatHours(durMin)} melebihi batas ${formatHours(maxMin)}`
          )
        }
        const endTime = time5(req.overtime_end_time)
        if (endTime && toMinutes(endTime) !== null) {
          const latestMin = toMinutes(settings.overtimeLatestEnd)
          const endMin = toMinutes(endTime)
          if (latestMin !== null && endMin !== null && endMin > latestMin) {
            violations.push(
              `jam akhir ${endTime} melewati batas jam lembur ${settings.overtimeLatestEnd}`
            )
          }
        }
        const overtimeDate = String(req.overtime_date || "")
        if (overtimeDate === today) {
          const resolved = resolvedByUid.get(uid)
          const startTime = time5(req.overtime_start_time)
          if (resolved && resolved.todayActive) {
            if (
              resolved.source !== "overtime_schedule" &&
              resolved.workEnd &&
              startTime &&
              toMinutes(startTime) !== null &&
              toMinutes(resolved.workEnd) !== null &&
              (toMinutes(startTime) as number) <
                (toMinutes(resolved.workEnd) as number)
            ) {
              violations.push(
                `jam mulai ${startTime} sebelum jam pulang shift ${time5(resolved.workEnd)}`
              )
            }
            if (!checkInByUid.has(uid) && nowMin >= cutoffMin) {
              violations.push(
                `tidak ada presensi masuk pada ${formatTanggalId(today)}`
              )
            }
            const checkOutRow = checkOutByUid.get(uid)
            if (checkOutRow && endTime) {
              const outTime = timeLabel(checkOutRow)
              if (
                toMinutes(outTime) !== null &&
                toMinutes(endTime) !== null &&
                (toMinutes(outTime) as number) < (toMinutes(endTime) as number)
              ) {
                violations.push(
                  `pulang tercatat ${outTime}, sebelum jam akhir lembur ${endTime}`
                )
              }
            }
          }
        }
        if (violations.length > 0) {
          if (req.auto_detect_overtime_notified === true) continue
          const startTime = time5(req.overtime_start_time)
          const durText =
            durMin !== null ? ` (${formatHours(durMin)})` : ""
          events.push({
            title: "⏱️ Jam Lembur Janggal",
            message:
              `${name} — Lembur ${detailDate || formatTanggalId(today)}` +
              `${startTime && endTime ? `, ${startTime}–${endTime}${durText}` : ""}. ` +
              `${violations.join(" ")} Perlu validasi admin.`,
            type: "warning",
            refType: "leave_request",
            refId: `${requestId}_overtime`,
            data: {
              route: "/admin/approvals",
              tab: "lembur",
              status: "pending",
              date: overtimeDate || startDate,
            },
            mark: markLeaveRequest(requestId, {
              auto_detect_overtime_notified: true,
            }),
          })
          continue
        }
      }

      // (d) Pengajuan baru (termasuk lembur yang TIDAK janggal).
      if (!settings.newRequestEnabled) continue
      if (req.auto_detect_new_notified === true) continue
      const titles: Record<string, string> = {
        izin: "📝 Pengajuan Izin Baru",
        cuti: "🏖️ Pengajuan Cuti Baru",
        sakit: "🤒 Pengajuan Sakit Baru",
        lembur: "⏱️ Pengajuan Lembur Baru",
      }
      const labels: Record<string, string> = {
        izin: "Izin",
        cuti: "Cuti",
        sakit: "Sakit",
        lembur: "Lembur",
      }
      const title = titles[type] || "📝 Pengajuan Baru"
      const label = labels[type] || "Izin"
      let detail = `${label}, ${detailDate}`
      if (type === "lembur") {
        const startTime = time5(req.overtime_start_time)
        const endTime = time5(req.overtime_end_time)
        const durMin = overtimeMinutes(req)
        if (startTime && endTime) {
          detail += `, ${startTime}–${endTime}`
          if (durMin !== null) detail += ` (${formatHours(durMin)})`
        }
      }
      if (type === "cuti") {
        const start = leaveStartDate(req)
        const end = leaveEndDate(req)
        if (start && end && start !== end) {
          const days =
            Math.floor(
              (new Date(`${end}T00:00:00`).getTime() -
                new Date(`${start}T00:00:00`).getTime()) /
                86400000
            ) + 1
          if (Number.isFinite(days) && days > 1) detail += ` (${days} hari)`
        }
      }
      events.push({
        title,
        message: `${name} — ${detail}. Menunggu persetujuan.`,
        type: "approval",
        refType: "leave_request",
        refId: `${requestId}_new`,
        data: {
          route: "/admin/approvals",
          tab: type === "lembur" ? "lembur" : "izin",
          status: "pending",
          date: startDate,
        },
        mark: markLeaveRequest(requestId, {
          auto_detect_new_notified: true,
        }),
      })
    }
  }

  if (events.length === 0) return 0

  const recipients = Object.entries(usersVal)
    .filter(([, rec]) => rec && isAdminLike(rec))
    .map(([uid]) => uid)
  if (recipients.length === 0) return 0

  let notified = 0
  for (const event of events) {
    if (!(await notifyAll(companyId, recipients, event))) continue
    // Tandai hanya bila SEMUA penerima berhasil — bila sebagian gagal,
    // kejadian dibiarkan tanpa penanda supaya dicoba lagi saat login
    // berikutnya (bukan hilang diam-diam).
    try {
      await event.mark()
      notified++
    } catch (err) {
      console.error("scanAutoDetect: gagal menandai kejadian", event.refId, err)
    }
  }
  return notified
}

/** Sekali per companyId selama halaman ini hidup. */
export async function runAutoDetectScanOnce(
  companyId: string
): Promise<number> {
  if (!companyId || scannedCompanies.has(companyId)) return 0
  scannedCompanies.add(companyId)
  return scanAutoDetect(companyId)
}
