// Notifikasi — gabungan port notificationService.ts,
// notificationDeliveryService.ts, dan firestoreNotificationService.ts
// myadmin lama (repo argajienbi/myadmin, main HEAD 31e4b9b). Jalur tulisnya
// murni RTDB (inbox + queue); tidak ada Cloud Function di tengah.
// Notifikasi in-app selalu ditulis; push dilewati bila pengaturan
// perusahaan mematikannya — kecuali test event (skipSettingsCheck) yang
// memang bypass filtering.
import { push, ref, set } from "firebase/database"
import { getDb } from "./firebase"
import { paths } from "./firebase-paths"

export type NotificationType =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "schedule_update"
  | "approval"
  | "reminder"
  | "announcement"
  | string

export interface NotificationPayload {
  company_id?: string
  title: string
  message: string
  type?: NotificationType
  ref_type?: string
  ref_id?: string
  created_by?: string
  created_by_name?: string
  data?: Record<string, unknown>
  skipSettingsCheck?: boolean
}

// Tulis ke inbox user (companies/{c}/users/{uid}/notification_inbox) dan
// antrean push (companies/{c}/notification_queue). Worker FCM yang sudah
// ada membaca antrean ini; penulisan di sini tidak mengirim push langsung.
export async function createNotification(
  uid: string,
  payload: NotificationPayload
): Promise<{
  rtdbNotificationId: string | null
  firestoreInboxId: string | null
  queueId: string | null
}> {
  try {
    const companyId = payload.company_id
    if (!companyId || !uid) {
      throw new Error("companyId atau uid tidak boleh kosong.")
    }
    const db = getDb()
    if (!db) {
      throw new Error("Firebase belum dikonfigurasi.")
    }
    const nowMs = Date.now()
    const notifRef = push(ref(db, paths.notificationInbox(companyId, uid)))
    await set(notifRef, {
      notification_id: notifRef.key,
      company_id: companyId,
      uid,
      title: payload.title,
      message: payload.message,
      body: payload.message,
      type: payload.type || "info",
      ref_type: payload.ref_type || "",
      ref_id: payload.ref_id || "",
      related_id: payload.ref_id || "",
      data: payload.data || {},
      sender_name: "Admin",
      sender_role: "admin",
      dedupe_key: null,
      skip_settings_check: false,
      read: false,
      is_read: false,
      created_at: nowMs,
      updated_at: nowMs,
    })
    const queueRef = push(ref(db, paths.notificationQueue(companyId)))
    await set(queueRef, {
      company_id: companyId,
      uid,
      title: payload.title,
      message: payload.message,
      body: payload.message,
      type: payload.type || "info",
      ref_type: payload.ref_type || "",
      ref_id: payload.ref_id || "",
      related_id: payload.ref_id || "",
      data: payload.data || {},
      notification_id: notifRef.key,
      status: "pending",
      retry_count: 0,
      token_count: 0,
      success_count: 0,
      failed_count: 0,
      error: null,
      created_at: nowMs,
      sent_at: null,
      failed_at: null,
    })
    return {
      rtdbNotificationId: notifRef.key,
      firestoreInboxId: notifRef.key,
      queueId: queueRef.key,
    }
  } catch (err) {
    console.error("Failed creating notification queue", {
      company_id: payload.company_id,
      uid,
      ref_type: payload.ref_type,
      ref_id: payload.ref_id,
      error: (err as Error)?.message || err,
    })
    throw new Error(
      `Gagal membuat notifikasi dan push queue: ${(err as Error)?.message || err}`,
      { cause: err }
    )
  }
}

/** Inbox RTDB per user: `notifications/{uid}` (firestoreNotificationService). */
export async function createUserNotification(
  uid: string,
  payload: NotificationPayload
): Promise<string | null> {
  const db = getDb()
  if (!db || !uid) return null
  const notifRef = push(ref(db, paths.notifications(uid)))
  await set(notifRef, {
    title: payload.title,
    message: payload.message,
    body: payload.message,
    type: payload.type ?? "info",
    ref_type: payload.ref_type ?? "",
    ref_id: payload.ref_id ?? "",
    company_id: payload.company_id ?? "",
    is_read: false,
    created_at: Date.now(),
    ...(payload.data ?? {}),
  })
  return notifRef.key
}

/**
 * Inbox perusahaan + antrean push (notificationDeliveryService).
 * `skipSettingsCheck` dipakai test event di Log Notifikasi.
 * Mengembalikan key antrean (queueId) seperti layanan lama.
 */
export async function createUserNotificationAndPush(
  companyId: string,
  uid: string,
  payload: NotificationPayload
): Promise<string | null> {
  const db = getDb()
  if (!db || !companyId || !uid) return null
  const now = Date.now()
  const inboxRef = push(ref(db, paths.notificationInbox(companyId, uid)))
  await set(inboxRef, {
    title: payload.title,
    message: payload.message,
    body: payload.message,
    type: payload.type ?? "info",
    ref_type: payload.ref_type ?? "",
    ref_id: payload.ref_id ?? "",
    is_read: false,
    created_at: now,
    created_by: payload.created_by ?? "",
    created_by_name: payload.created_by_name ?? "",
  })
  const queueRef = push(ref(db, paths.notificationQueue(companyId)))
  await set(queueRef, {
    uid,
    title: payload.title,
    message: payload.message,
    body: payload.message,
    type: payload.type ?? "info",
    ref_type: payload.ref_type ?? "",
    ref_id: payload.ref_id ?? "",
    status: "pending",
    retry_count: 0,
    skip_settings_check: payload.skipSettingsCheck === true,
    created_at: now,
  })
  return queueRef.key
}

export async function createNotificationForUsers(
  companyId: string,
  uids: string[],
  payload: NotificationPayload
): Promise<{ queueId: string | null }[]> {
  const results: { queueId: string | null }[] = []
  for (const uid of uids) {
    const queueId = await createUserNotificationAndPush(companyId, uid, payload)
    results.push({ queueId })
  }
  return results
}

/**
 * Log pengiriman notifikasi: `companies/{id}/notification_logs`.
 * Bentuk bebas (action + field lain) seperti firestoreNotificationService
 * lama — record ditulis apa adanya + `created_at`.
 */
export async function writeNotificationLog(
  companyId: string,
  entry: Record<string, unknown>
): Promise<void> {
  const db = getDb()
  if (!db || !companyId) return
  const logRef = push(ref(db, paths.notificationLogs(companyId)))
  await set(logRef, { ...entry, created_at: Date.now() })
}
