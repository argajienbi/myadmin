/**
 * Data Kesehatan Database — port logika DatabaseHealth.tsx myadmin lama.
 * Scan membaca path RTDB terpilih (satu `get` per path — pengganti
 * `manualGet` rtdbDataGate yang belum ada di seam ini), menghitung jumlah
 * children + estimasi ukuran (byte UTF-8 dari JSON). Reset dummy hanya
 * untuk owner, wajib ketik "RESET DATABASE", dan menulis audit
 * OWNER_DATABASE_RESET. Bagian foto lama TIDAK dibawa: mockup tidak
 * memintanya dan ukuran file lama adalah estimasi deterministik dari hash
 * (bukan ukuran nyata).
 */
import { collection, getDocs, writeBatch } from "firebase/firestore"
import { get, ref, remove, set } from "firebase/database"
import { getDb, getFirestoreDb, isFirebaseConfigured } from "@/lib/firebase"
import { paths, firestorePaths } from "@/lib/firebase-paths"

export interface HealthTarget {
  label: string
  path: string
}

export function makeHealthTargets(companyId: string): HealthTarget[] {
  return [
    { label: "Company", path: paths.company(companyId) },
    { label: "Company Users", path: paths.companyUsers(companyId) },
    { label: "Attendance", path: paths.attendanceRoot(companyId) },
    { label: "Leave Requests", path: paths.leaveRequests(companyId) },
    { label: "QR Attendance Requests", path: paths.qrRequests(companyId) },
    { label: "Attendance Corrections", path: paths.attendanceCorrections(companyId) },
    { label: "Announcements", path: paths.companyAnnouncements(companyId) },
    { label: "Audit Logs", path: paths.auditLogs(companyId) },
    { label: "Schedule Assignments", path: paths.scheduleAssignments(companyId) },
    { label: "Schedule Specials", path: paths.scheduleSpecials(companyId) },
    { label: "Overtime Schedules", path: paths.overtimeSchedules(companyId) },
    { label: "Holidays", path: paths.holidays(companyId) },
    { label: "Schedule Change Logs", path: paths.scheduleChangeLogs(companyId) },
    { label: "Timetables", path: paths.timetables(companyId) },
    { label: "Shifts", path: paths.shifts(companyId) },
    { label: "Storage Index", path: paths.storageIndex(companyId) },
    { label: "Report Cache", path: paths.reportCache(companyId) },
  ]
}

export interface ResetOption {
  key: string
  label: string
  path: (companyId: string) => string
  defaultChecked: boolean
}

export const RESET_OPTIONS: ResetOption[] = [
  { key: "attendance", label: "Attendance", path: (id) => paths.attendanceRoot(id), defaultChecked: true },
  { key: "leave_requests", label: "Leave Requests", path: (id) => paths.leaveRequests(id), defaultChecked: true },
  { key: "qr_attendance_requests", label: "QR Attendance Requests", path: (id) => paths.qrRequests(id), defaultChecked: true },
  { key: "attendance_corrections", label: "Attendance Corrections", path: (id) => paths.attendanceCorrections(id), defaultChecked: true },
  { key: "announcements", label: "Announcements", path: (id) => paths.companyAnnouncements(id), defaultChecked: true },
  { key: "audit_logs", label: "Audit Logs", path: (id) => paths.auditLogs(id), defaultChecked: false },
  { key: "schedule_change_logs", label: "Schedule Change Logs", path: (id) => paths.scheduleChangeLogs(id), defaultChecked: false },
  { key: "overtime_schedules", label: "Overtime Schedules", path: (id) => paths.overtimeSchedules(id), defaultChecked: true },
  { key: "schedule_specials", label: "Schedule Specials", path: (id) => paths.scheduleSpecials(id), defaultChecked: true },
  { key: "schedule_assignments", label: "Schedule Assignments", path: (id) => paths.scheduleAssignments(id), defaultChecked: false },
  { key: "holidays", label: "Holidays", path: (id) => paths.holidays(id), defaultChecked: false },
  { key: "report_cache", label: "Report Cache", path: (id) => paths.reportCache(id), defaultChecked: true },
  { key: "storage_index", label: "Storage Index", path: (id) => paths.storageIndex(id), defaultChecked: false },
]

export const EXTRA_RESET_KEYS = [
  { key: "notifications", label: "Notifications per User" },
  { key: "notification_queue", label: "Firestore Notification Queue" },
] as const

export interface HealthRow {
  label: string
  path: string
  count: number
  estimatedBytes: number
}

export function countChildren(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "object") return Object.keys(value as object).length
  return 1
}

export function countDeepNodes(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value !== "object") return 1
  let count = 0
  for (const child of Object.values(value as Record<string, unknown>)) {
    count += 1 + countDeepNodes(child)
  }
  return count
}

export function estimateBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export async function scanDatabase(
  companyId: string,
  selectedLabels: string[],
): Promise<{ rows: HealthRow[]; deepNodeCount: number }> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const targets = makeHealthTargets(companyId).filter((t) =>
    selectedLabels.includes(t.label),
  )
  if (targets.length === 0)
    throw new Error("Silakan pilih minimal satu jalur database untuk discan.")
  const rows: HealthRow[] = []
  let deepNodeCount = 0
  for (const target of targets) {
    const snap = await get(ref(db, target.path))
    const value = snap.val()
    rows.push({
      label: target.label,
      path: target.path,
      count: countChildren(value),
      estimatedBytes: estimateBytes(value),
    })
    deepNodeCount += countDeepNodes(value)
  }
  return { rows, deepNodeCount }
}

export async function clearFirestoreNotificationQueue(
  companyId: string,
): Promise<void> {
  const fs = getFirestoreDb()
  if (!fs) throw new Error("Firebase belum dikonfigurasi.")
  const snapshot = await getDocs(
    collection(fs, firestorePaths.notificationQueue(companyId)),
  )
  const batch = writeBatch(fs)
  snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref))
  await batch.commit()
}

export async function resetDummyData(
  companyId: string,
  companyName: string,
  selectedKeys: Record<string, boolean>,
  actor: { uid: string; name: string },
): Promise<string[]> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const selected = RESET_OPTIONS.filter((item) => selectedKeys[item.key])
  if (
    selected.length === 0 &&
    !selectedKeys.notifications &&
    !selectedKeys.notification_queue
  ) {
    throw new Error("Pilih minimal satu data untuk direset.")
  }
  const deletedPaths: string[] = []
  for (const item of selected) {
    const targetPath = item.path(companyId)
    await remove(ref(db, targetPath))
    deletedPaths.push(targetPath)
  }
  if (selectedKeys.notifications) {
    const usersSnap = await get(ref(db, paths.companyUsers(companyId)))
    const users = usersSnap.exists() ? usersSnap.val() : {}
    for (const uid of Object.keys(users ?? {})) {
      await remove(ref(db, paths.notifications(uid)))
      deletedPaths.push(paths.notifications(uid))
    }
  }
  if (selectedKeys.notification_queue) {
    await clearFirestoreNotificationQueue(companyId)
    deletedPaths.push(`firestore:companies/${companyId}/notification_queue`)
  }
  await set(ref(db, `${paths.auditLogs(companyId)}/owner_reset_${Date.now()}`), {
    action: "OWNER_DATABASE_RESET",
    company_id: companyId,
    company_name: companyName,
    paths_deleted: deletedPaths,
    admin_uid: actor.uid,
    admin_name: actor.name,
    created_at: Date.now(),
  })
  return deletedPaths
}

export function isDbConfigured(): boolean {
  return isFirebaseConfigured()
}
