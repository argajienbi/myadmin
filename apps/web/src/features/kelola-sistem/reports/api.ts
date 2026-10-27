/**
 * Data Laporan — port logika Reports.tsx myadmin lama.
 * Mode normal: lean load per tanggal (maks 31 hari); leave/qr/lembur
 * sengaja tidak dimuat demi hemat bandwidth (seperti lama).
 * Mode Legacy: baca root besar RTDB (confirm + ketik LEGACY) — dipakai
 * hanya untuk data lama yang belum dibackfill.
 * Export: port exportService.ts lama (xlsx + jsPDF landscape).
 */
import { useQuery } from "@tanstack/react-query"
import { get } from "firebase/database"
import { ref } from "firebase/database"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import { writeAuditLog } from "@/lib/firebase-audit"
import { getDb, isFirebaseConfigured } from "@/lib/firebase"
import { loadAttendanceByDateRange } from "@/lib/rtdb-lean-service"
import { readList, snapshotToArray } from "@/lib/rtdb-read"
import { paths } from "@/lib/firebase-paths"
import type {
  CompanyUser,
  Department,
  EmployeeGroup,
  Office,
  SubDepartment,
} from "@/lib/firebase-types"

export interface AttendanceRow {
  id?: string
  record_uid: string
  record_date: string
  record_time: string
  record_action: string
  action_type?: string
  user_name: string
  nip: string
  position: string
  waktu?: string
  method?: string
  attendance_status?: string
  late_minute?: number
  early_out_minute?: number
  overtime_minute?: number
  total_work_minute?: number
  office_id?: string
  department_id?: string
  sub_department_id?: string
  group_id?: string
  shift_name?: string
  timetable_name?: string
  schedule_source?: string
  overtime_flag?: boolean
  work_start?: string
  work_end?: string
  check_in_start?: string
  check_out_end?: string
  geofence_status: string
  [key: string]: unknown
}

export interface LeaveRequestRow {
  id?: string
  request_id?: string
  uid?: string
  type?: string
  leave_type?: string
  status?: string
  tanggal_mulai?: string
  date?: string
  date_start?: string
  overtime_date?: string
  overtime_duration_minute?: number
  overtime_start_time?: string
  overtime_end_time?: string
  user_name?: string
  nama_lengkap?: string
  employee_name?: string
  [key: string]: unknown
}

export interface ReportsMeta {
  offices: Office[]
  departments: Department[]
  subDepartments: SubDepartment[]
  groups: EmployeeGroup[]
  users: CompanyUser[]
}

export function useReportsMeta(companyId: string) {
  return useQuery({
    queryKey: ["ks", "reports-meta", companyId],
    queryFn: async (): Promise<ReportsMeta> => {
      const [offices, departments, subDepartments, groups, users] =
        await Promise.all([
          readList<Office>(paths.offices(companyId)),
          readList<Department>(paths.departments(companyId)),
          readList<SubDepartment>(paths.subDepartments(companyId)),
          readList<EmployeeGroup>(paths.employeeGroups(companyId)),
          readList<CompanyUser>(paths.companyUsers(companyId)),
        ])
      return { offices, departments, subDepartments, groups, users }
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

export interface ReportData {
  attendances: AttendanceRow[]
  leaveRequests: LeaveRequestRow[]
  qrRequests: Record<string, unknown>[]
  overtimeSchedules: Record<string, unknown>[]
}

function enrichAttendance(
  rec: Record<string, unknown>,
  meta: ReportsMeta,
): AttendanceRow {
  const uid = String(rec.uid ?? rec.record_uid ?? "")
  const user =
    meta.users.find((u) => (u.uid ?? u.id) === uid) ??
    ({} as Partial<CompanyUser>)
  const distance = Number(rec.distance_meter ?? 0)
  const radius = Number(rec.radius_meter ?? 0)
  const geofence_status =
    radius > 0 ? (distance <= radius ? "inside" : "outside") : "unknown"
  return {
    ...(rec as Record<string, unknown>),
    record_uid: uid,
    record_date: String(rec.record_date ?? rec.dateKey ?? ""),
    record_time: String(rec.record_time ?? rec.time ?? rec.waktu ?? "00:00:00"),
    record_action: String(rec.action_type ?? rec.record_action ?? ""),
    user_name: user.nama_lengkap ?? uid,
    nip: user.nip ?? "-",
    position: user.position ?? "-",
    geofence_status,
  } as AttendanceRow
}

export async function fetchReportDataNormal(
  companyId: string,
  startDate: string,
  endDate: string,
  meta: ReportsMeta,
): Promise<ReportData> {
  const rawRows = await loadAttendanceByDateRange({ companyId, startDate, endDate })
  const attendances = rawRows
    .map((rec) => enrichAttendance(rec, meta))
    .sort((a, b) => {
      const d1 = new Date(`${a.record_date}T${a.record_time}`)
      const d2 = new Date(`${b.record_date}T${b.record_time}`)
      return d2.getTime() - d1.getTime()
    })
  // Seperti kode lama: mode normal tidak memuat leave/qr/lembur.
  return { attendances, leaveRequests: [], qrRequests: [], overtimeSchedules: [] }
}

/**
 * Legacy Load — membaca root besar RTDB. Wajib confirm + ketik LEGACY.
 * Teks confirm sama persis dengan kode lama.
 */
export async function fetchReportDataLegacy(
  companyId: string,
  meta: ReportsMeta,
): Promise<ReportData> {
  const confirmed = window.confirm(
    "PERINGATAN: Legacy Load membaca root besar RTDB dan bisa meningkatkan biaya bandwidth. Gunakan hanya untuk data lama yang belum dibackfill. Lanjutkan?",
  )
  if (!confirmed) throw new Error("Legacy Load dibatalkan.")
  const typed = window.prompt("Ketik LEGACY untuk melanjutkan mode berisiko:")
  if (typed !== "LEGACY") throw new Error("Legacy Load dibatalkan.")
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const [attSnap, leaveSnap, qrSnap, overtimeSnap] = await Promise.all([
    get(ref(db, paths.attendanceRoot(companyId))),
    get(ref(db, paths.leaveRequests(companyId))),
    get(ref(db, paths.qrRequests(companyId))),
    get(ref(db, paths.overtimeSchedules(companyId))),
  ])
  const leaveRequests = snapshotToArray<LeaveRequestRow>(leaveSnap).map(
    (a) => ({ ...a, request_id: a.id }),
  )
  const qrRequests = snapshotToArray<Record<string, unknown>>(qrSnap)
  const overtimeSchedules =
    snapshotToArray<Record<string, unknown>>(overtimeSnap)
  const allRecords: AttendanceRow[] = []
  if (attSnap.exists()) {
    const data = attSnap.val() as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >
    for (const uid of Object.keys(data)) {
      const datesObj = data[uid]
      for (const date of Object.keys(datesObj)) {
        const actionObj = datesObj[date]
        for (const actionType of Object.keys(actionObj)) {
          const rec = actionObj[actionType]
          allRecords.push(
            enrichAttendance(
              { ...rec, record_uid: uid, record_date: date, action_type: actionType },
              meta,
            ),
          )
        }
      }
    }
  }
  allRecords.sort((a, b) => {
    const d1 = new Date(`${a.record_date}T${a.record_time}`)
    const d2 = new Date(`${b.record_date}T${b.record_time}`)
    return d2.getTime() - d1.getTime()
  })
  return { attendances: allRecords, leaveRequests, qrRequests, overtimeSchedules }
}

// --- Export (port exportService.ts lama) -----------------------------------

export function exportToExcel(
  data: Record<string, unknown>[],
  filename: string,
): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Laporan")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export function exportToPdf(
  headers: string[],
  rows: (string | number)[][],
  filename: string,
  title: string,
): void {
  const doc = new jsPDF({ orientation: "landscape" })
  doc.text(title, 14, 15)
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 20,
    styles: { fontSize: 8 },
  })
  doc.save(`${filename}.pdf`)
}

export async function auditExport(
  companyId: string,
  details: string,
  actor: { uid: string; name: string },
): Promise<void> {
  await writeAuditLog(companyId, {
    action: "EXPORT_REPORT",
    details,
    user_uid: actor.uid,
    user_name: actor.name,
  })
}
