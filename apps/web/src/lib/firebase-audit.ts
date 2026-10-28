// Audit log — port auditService.ts myadmin lama (repo argajienbi/myadmin,
// main HEAD 31e4b9b). Bentuk record dipertahankan persis: old/new value
// di-JSON-stringify, `created_at` epoch ms.
import { push, ref, set } from "firebase/database"
import { getDb } from "./firebase"
import { paths } from "./firebase-paths"

export interface AuditEntry {
  action: string
  details?: string
  user_uid?: string
  user_name?: string
  target_path?: string
  old_value?: unknown
  new_value?: unknown
}

export async function writeAuditLog(
  companyId: string,
  entry: AuditEntry
): Promise<void> {
  const db = getDb()
  if (!db || !companyId) return
  const logRef = push(ref(db, paths.auditLogs(companyId)))
  await set(logRef, {
    action: entry.action,
    details: entry.details ?? "",
    user_uid: entry.user_uid ?? "",
    user_name: entry.user_name ?? "",
    target_path: entry.target_path ?? "",
    old_value:
      entry.old_value === undefined
        ? ""
        : typeof entry.old_value === "string"
          ? entry.old_value
          : JSON.stringify(entry.old_value),
    new_value:
      entry.new_value === undefined
        ? ""
        : typeof entry.new_value === "string"
          ? entry.new_value
          : JSON.stringify(entry.new_value),
    created_at: Date.now(),
  })
}
