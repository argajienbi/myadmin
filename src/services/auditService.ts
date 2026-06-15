import { push, ref, set } from "firebase/database";
import { db } from "../firebase";
import { paths } from "./paths";

export async function writeAuditLog(
  companyId: string,
  payload: {
    action: string;
    details: string;
    user_uid: string;
    user_name: string;
    target_path?: string;
    old_value?: unknown;
    new_value?: unknown;
  }
) {
  const logRef = push(ref(db, paths.auditLogs(companyId)));
  await set(logRef, {
    ...payload,
    old_value:
      typeof payload.old_value === "string"
        ? payload.old_value
        : JSON.stringify(payload.old_value ?? ""),
    new_value:
      typeof payload.new_value === "string"
        ? payload.new_value
        : JSON.stringify(payload.new_value ?? ""),
    created_at: Date.now(),
  });
}
