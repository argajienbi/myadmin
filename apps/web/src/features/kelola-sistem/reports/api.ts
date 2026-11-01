/**
 * Data Laporan — port logika Reports.tsx myadmin lama.
 * Data dibuka LANGSUNG dari RTDB (tanpa mode Legacy / tanpa confirm +
 * ketik LEGACY): proyek sudah Spark tanpa billing, jadi baca mentah
 * tidak lagi berisiko biaya. Presensi dibatasi rentang tanggal
 * (maks 31 hari, lean per tanggal); perizinan/QR/lembur dibaca
 * langsung dari root perusahaan lalu disaring periode di halaman.
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

export async function fetchReportData(
  companyId: string,
  startDate: string,
  endDate: string,
  meta: ReportsMeta,
): Promise<ReportData> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const [rawRows, leaveSnap, qrSnap, overtimeSnap] = await Promise.all([
    loadAttendanceByDateRange({ companyId, startDate, endDate }),
    get(ref(db, paths.leaveRequests(companyId))),
    get(ref(db, paths.qrRequests(companyId))),
    get(ref(db, paths.overtimeSchedules(companyId))),
  ])
  const attendances = rawRows
    .map((rec) => enrichAttendance(rec, meta))
    .sort((a, b) => {
      const d1 = new Date(`${a.record_date}T${a.record_time}`)
      const d2 = new Date(`${b.record_date}T${b.record_time}`)
      return d2.getTime() - d1.getTime()
    })
  const leaveRequests = snapshotToArray<LeaveRequestRow>(leaveSnap).map(
    (a) => ({ ...a, request_id: a.id }),
  )
  const qrRequests = snapshotToArray<Record<string, unknown>>(qrSnap)
  const overtimeSchedules =
    snapshotToArray<Record<string, unknown>>(overtimeSnap)
  return { attendances, leaveRequests, qrRequests, overtimeSchedules }
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
