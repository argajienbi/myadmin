/**
 * Data Audit Log — port logika Audit.tsx myadmin lama.
 * Audit log dibaca dari RTDB `audit_logs/{company}`, terbaru dulu.
 * Nama user di-resolve dari company_users; UID di-mask kecuali toggle
 * "Tampilkan ID teknis" aktif.
 */
import { useQuery } from "@tanstack/react-query"
import { saveDownload } from "@/components/list-controls"
import { isFirebaseConfigured } from "@/lib/firebase"
import { readList } from "@/lib/rtdb-read"
import { paths } from "@/lib/firebase-paths"
import type { AuditLog, CompanyUser } from "@/lib/firebase-types"
import { formatDateTime, maskId } from "@/lib/display-utils"

export interface AuditData {
  logs: AuditLog[]
  users: CompanyUser[]
}

export function useAuditLogs(companyId: string) {
  return useQuery({
    queryKey: ["ks", "audit", companyId],
    queryFn: async (): Promise<AuditData> => {
      const [logs, users] = await Promise.all([
        readList<AuditLog>(paths.auditLogs(companyId)),
        readList<CompanyUser>(paths.companyUsers(companyId)),
      ])
      logs.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
      return { logs, users }
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

export function resolveAuditUserName(
  log: AuditLog,
  users: CompanyUser[],
): string {
  const user = users.find(
    (u) => (u.uid ?? u.id) === log.user_uid,
  )
  if (user) return user.nama_lengkap ?? user.email ?? log.user_uid ?? "-"
  if (log.user_name) return log.user_name
  return log.user_uid ? maskId(log.user_uid) : "-"
}

/** CSV dengan guard injeksi formula (sel diawali =, +, -, @ diberi '). */
export function exportAuditCsv(logs: AuditLog[], filename: string): void {
  const guard = (value: string): string => {
    const v = value.replace(/"/g, '""')
    const needsQuote = /[",\n]/.test(v) || /^[=+\-@]/.test(v)
    const guarded = /^[=+\-@]/.test(v) ? `'${v}` : v
    return needsQuote ? `"${guarded.replace(/"/g, '""')}"` : guarded
  }
  const lines = [
    ["Waktu", "User", "Action", "Details"].map(guard).join(","),
    ...logs.map((l) =>
      [
        formatDateTime(l.created_at),
        l.user_name ?? l.user_uid ?? "",
        l.action,
        l.details ?? "",
      ]
        .map(guard)
        .join(","),
    ),
  ]
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  })
  saveDownload(blob, filename)
}
