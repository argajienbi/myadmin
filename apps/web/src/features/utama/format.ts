// Helper format & nilai teks untuk halaman Utama. Port helper kecil dari
// myadmin lama (Approvals.tsx, Attendance.tsx, utils) — tanpa logika baca
// data, supaya bisa dipakai semua halaman Utama.
import { format, parseISO } from "date-fns"
import { id as idLocale } from "date-fns/locale"

export function textValue(value: unknown, fallback = "-"): string {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  return text === "" ? fallback : text
}

export function employeeName(req: Record<string, unknown>): string {
  return textValue(
    req.user_name || req.nama_lengkap || req.employee_name || req.name,
    "Karyawan"
  )
}

export function employeeNip(req: Record<string, unknown>): string {
  return textValue(req.nip || req.employee_id || req.user_nip, "-")
}

export function leaveTypeValue(req: Record<string, unknown>): string {
  return String(req.type || req.leave_type || "izin").toLowerCase()
}

export function leaveTypeLabel(type: string): string {
  const t = String(type || "izin").toLowerCase()
  if (t === "sakit") return "Izin Sakit"
  if (t === "cuti") return "Cuti Tahunan"
  if (t === "lembur") return "Izin Lembur"
  if (t === "keluarga") return "Izin Keluarga"
  return "Izin"
}

export function formatTanggal(dateKey: string): string {
  if (!dateKey) return "-"
  try {
    return format(parseISO(dateKey), "dd MMM yyyy", { locale: idLocale })
  } catch {
    return dateKey
  }
}

export function formatTanggalWaktu(ms: number | null | undefined): string {
  if (!ms) return "-"
  try {
    return format(new Date(ms), "dd MMM yyyy, HH:mm", { locale: idLocale })
  } catch {
    return "-"
  }
}

export function formatJam(ms: number | null | undefined): string {
  if (!ms) return "-"
  try {
    return format(new Date(ms), "HH:mm", { locale: idLocale })
  } catch {
    return "-"
  }
}

export function formatWaktuDariTanggal(
  dateKey: string,
  time: string
): string {
  if (!dateKey || !time) return "-"
  const parsed = new Date(`${dateKey}T${time}:00`)
  if (Number.isNaN(parsed.getTime())) return time
  return format(parsed, "HH:mm")
}

export function durationLabel(req: Record<string, unknown>): string {
  const start = String(req.start_date || req.date || "")
  const end = String(req.end_date || "")
  if (!start) return "-"
  if (!end || end === start) return formatTanggal(start)
  return `${formatTanggal(start)} – ${formatTanggal(end)}`
}

export function dateReason(req: Record<string, unknown>): string {
  return textValue(req.reason || req.alasan || req.note || req.keterangan, "-")
}

export function statusBadgeVariant(status: string): string {
  const s = status.toLowerCase()
  if (s.includes("approve") || s.includes("setuju") || s === "success")
    return "success"
  if (s.includes("reject") || s.includes("tolak")) return "danger"
  if (s.includes("pending") || s.includes("processing")) return "warning"
  return "neutral"
}

export function statusLabel(status: string): string {
  const s = status.toLowerCase()
  if (s === "pending" || s === "pending_admin") return "Menunggu"
  if (s === "processing") return "Diproses"
  if (s === "approved") return "Disetujui"
  if (s === "rejected") return "Ditolak"
  if (s === "success") return "Selesai"
  return status || "-"
}

// Inisial avatar dari nama (maks 2 huruf), dipakai di tabel-tabel Utama.
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Unduh CSV dari baris data (dipakai tombol "Ekspor CSV" di halaman Utama).
export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const escape = (value: string) => {
    const v = String(value ?? "")
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
    return v
  }
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ]
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
