// Pemindai lokasi palsu — notifikasi header MyAdmin.
// Sekali per sesi login (guard modul): cek presensi hari ini; bila ada
// record lokasi palsu yang belum pernah diberitahu, kirim notifikasi
// (inbox + antrean push, jalur createNotification yang sama seperti
// notifikasi persetujuan) ke semua admin + owner perusahaan, lalu tandai
// record-nya (mock_alert_sent) supaya satu record hanya diberitahu
// satu kali. Tanpa baris mock baru: tidak menulis apa pun (login normal
// = read-only). Kegagalan dicatat ke console, tidak dilempar ke UI.
import { get, ref, update } from "firebase/database"
import { getDb } from "./firebase"
import { paths } from "./firebase-paths"
import { createNotification } from "./firebase-notify"
import { isOwnerLike, normalizeRole } from "./role-access"
import {
  loadAttendanceByDateRange,
  todayKey,
  type AttendanceRow,
} from "./rtdb-lean-service"

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

function isMockRow(row: AttendanceRow): boolean {
  return (
    row.mock_location_detected === true ||
    row.location_mock_detected === true
  )
}

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

function actionLabel(row: AttendanceRow): string {
  const action = String(row.action_type || row.record_action || "").toLowerCase()
  return action.includes("pulang") ? "Pulang" : "Masuk"
}

function timeLabel(row: AttendanceRow): string {
  return String(row.record_time || row.waktu || row.time || "").slice(0, 5)
}

/**
 * Pindai presensi hari ini dan beri tahu admin/owner bila ada lokasi
 * palsu yang belum diberitahu. Mengembalikan jumlah record yang
 * diberitahu (0 bila tidak ada yang baru — tanpa menulis apa pun).
 */
export async function scanMockAlerts(companyId: string): Promise<number> {
  const db = getDb()
  if (!db || !companyId) return 0
  const today = todayKey()
  let rows: AttendanceRow[]
  try {
    rows = await loadAttendanceByDateRange({
      companyId,
      startDate: today,
      endDate: today,
    })
  } catch (err) {
    console.error("scanMockAlerts: gagal memuat presensi hari ini", err)
    return 0
  }
  const fresh = rows.filter(
    (row) => isMockRow(row) && row.mock_alert_sent !== true
  )
  if (fresh.length === 0) return 0

  let usersVal: Record<string, Record<string, unknown>>
  try {
    const usersSnap = await get(ref(db, paths.companyUsers(companyId)))
    usersVal =
      (usersSnap.val() as Record<string, Record<string, unknown>> | null) ||
      {}
  } catch (err) {
    console.error("scanMockAlerts: gagal memuat company_users", err)
    return 0
  }
  const recipients = Object.entries(usersVal)
    .filter(([, rec]) => rec && isAdminLike(rec))
    .map(([uid]) => uid)
  if (recipients.length === 0) return 0

  let notified = 0
  for (const row of fresh) {
    const uid = String(row.uid || "")
    const dateKey = String(row.dateKey || row.record_date || today)
    const actionKey = String(row.action_type || row.record_action || "")
    if (!uid || !actionKey) continue
    const time = timeLabel(row)
    const message =
      `${employeeName(usersVal[uid])} — ${actionLabel(row)}` +
      `${time ? ` ${time} WIB` : ""}, ${formatTanggalId(dateKey)}. ` +
      "Perlu validasi admin."
    let sent = 0
    for (const recipientUid of recipients) {
      try {
        await createNotification(recipientUid, {
          company_id: companyId,
          title: "⚠️ Lokasi Palsu Terdeteksi",
          message,
          type: "warning",
          ref_type: "attendance",
          ref_id: `${dateKey}_${uid}_${actionKey}`,
          data: { route: "/admin/attendance", date: dateKey, risk: "mock" },
        })
        sent++
      } catch (err) {
        console.error("scanMockAlerts: gagal memberi tahu", recipientUid, err)
      }
    }
    // Tandai hanya bila SEMUA penerima berhasil — bila sebagian gagal,
    // record dibiarkan tanpa penanda supaya dicoba lagi saat login
    // berikutnya (bukan hilang diam-diam).
    if (sent === recipients.length) {
      try {
        await update(
          ref(db, paths.attendanceRecord(companyId, uid, dateKey, actionKey)),
          { mock_alert_sent: true }
        )
        notified++
      } catch (err) {
        console.error("scanMockAlerts: gagal menandai record", row.id, err)
      }
    }
  }
  return notified
}

/** Sekali per companyId selama halaman ini hidup. */
export async function runMockAlertScanOnce(
  companyId: string
): Promise<number> {
  if (!companyId || scannedCompanies.has(companyId)) return 0
  scannedCompanies.add(companyId)
  return scanMockAlerts(companyId)
}
