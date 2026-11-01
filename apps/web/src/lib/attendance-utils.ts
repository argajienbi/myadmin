// Klasifikasi record absensi — port helper dari Dashboard.tsx /
// Attendance.tsx myadmin lama (repo argajienbi/myadmin, main HEAD 31e4b9b).
import { isConfigAvailable } from "./firebase"
import type { AttendanceRow } from "./rtdb-lean-service"

export function isCheckIn(row: AttendanceRow): boolean {
  const action = String(row.action_type || row.record_action || "")
  return ["masuk", "check_in", "check-in", "in", "lembur_masuk"].includes(
    action
  )
}

export function isCheckOut(row: AttendanceRow): boolean {
  const action = String(row.action_type || row.record_action || "")
  return ["pulang", "check_out", "check-out", "out", "lembur_pulang"].includes(
    action
  )
}

export function getActionTypeLabel(row: AttendanceRow): string {
  if (isCheckIn(row)) return "masuk"
  if (isCheckOut(row)) return "pulang"
  return String(row.action_type || row.record_action || "absensi")
}

export function getAttendanceStatus(row: AttendanceRow): string {
  return String(
    row.attendance_status || row.status || row.status_absensi || ""
  ).toLowerCase()
}

export function getAttendanceStatusLabel(status: string): string {
  const s = status.toLowerCase()
  if (s.includes("late") || s.includes("terlambat") || s.includes("telat"))
    return "Terlambat"
  if (s.includes("early") || s.includes("pulang cepat")) return "Pulang Cepat"
  if (s.includes("luar_radius") || s.includes("luar radius"))
    return "Luar Radius"
  if (s.includes("hadir") || s.includes("success") || s === "hadir")
    return "Hadir"
  if (s) return s
  return "Hadir"
}

export function getRecordTimestamp(row: AttendanceRow): number | null {
  const created = Number(row.created_at || 0)
  if (created > 0) return created
  const date = String(row.record_date || row.dateKey || "")
  const time = String(row.record_time || row.waktu || row.time || "")
  if (!date || !time) return null
  const parsed = new Date(`${date}T${time}`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getTime()
}

// Menit keterlambatan check-in terhadap jam kerja record itu sendiri
// (field work_start / schedule_work_start bila ada). Null bila jam kerja
// tidak tercatat di record — halaman menampilkan badge tanpa angka.
export function getLateMinutes(row: AttendanceRow): number | null {
  const workStart = String(
    row.work_start || row.schedule_work_start || row.timetable_work_start || ""
  )
  if (!workStart || !workStart.includes(":")) return null
  const time = String(row.record_time || row.waktu || row.time || "")
  if (!time || !time.includes(":")) return null
  const [wh, wm] = workStart.split(":").map(Number)
  const [th, tm] = time.split(":").map(Number)
  if (![wh, wm, th, tm].every(Number.isFinite)) return null
  const diff = th * 60 + tm - (wh * 60 + wm)
  return diff > 0 ? diff : 0
}

export function requireFirebaseConfig(): void {
  if (!isConfigAvailable) {
    throw new Error(
      "Firebase belum dikonfigurasi. Isi firebase-applet-config.json atau env VITE_FIREBASE_*."
    )
  }
}
