/**
 * Data Log Notifikasi — port logika NotificationLogs.tsx myadmin lama.
 * Sumber: RTDB notification_queue, notification_logs,
 * notification_delivery_logs, attendance_reminder_scheduler_logs,
 * company_users; token FCM dari Firestore
 * `companies/{id}/users/{uid}/fcm_tokens` + mirror RTDB
 * `companies/{id}/users/{uid}/fcm_tokens`.
 */
import { useQuery } from "@tanstack/react-query"
import { collection, doc, getDocs, setDoc } from "firebase/firestore"
import { get, ref, remove, set, update } from "firebase/database"
import { createUserNotificationAndPush } from "@/lib/firebase-notify"
import { getDb, getFirestoreDb, isFirebaseConfigured } from "@/lib/firebase"
import { readList } from "@/lib/rtdb-read"
import { paths, firestorePaths } from "@/lib/firebase-paths"
import type { CompanyUser, NotificationQueueItem } from "@/lib/firebase-types"

export interface NotificationLogRow {
  id?: string
  uid?: string
  title?: string
  message?: string
  body?: string
  status?: string
  type?: string
  action?: string
  ref_type?: string
  ref_id?: string
  error?: string
  created_at?: number
  [key: string]: unknown
}

export interface DeliveryLogRow {
  id?: string
  uid?: string
  token?: string
  token_id?: string
  title?: string
  message?: string
  status?: string
  error?: string
  created_at?: number
  [key: string]: unknown
}

export interface SchedulerLogRow {
  id?: string
  uid?: string
  title?: string
  message?: string
  status?: string
  stage?: string
  direction?: string
  created_at?: number
  [key: string]: unknown
}

export interface FcmToken {
  token_id: string
  uid: string
  userName: string
  role?: string
  active: boolean
  permission_status?: string
  statusbar_allowed?: boolean
  permission_last_checked_at?: number
  last_seen_at?: number
  updated_at?: number
  invalidated_at?: number
  invalid_reason?: string
  superseded_by?: string
  app_source?: string
  platform?: string
  device_name?: string
  source: "firestore" | "rtdb_mirror"
  source_label: string
  is_current: boolean
  effective_permission_allowed: boolean
  effective_status: string
}

export interface NotificationLogsData {
  queue: NotificationQueueItem[]
  logs: NotificationLogRow[]
  deliveryLogs: DeliveryLogRow[]
  schedulerLogs: SchedulerLogRow[]
  users: CompanyUser[]
}

export function useNotificationLogs(companyId: string) {
  return useQuery({
    queryKey: ["ks", "notification-logs", companyId],
    queryFn: async (): Promise<NotificationLogsData> => {
      const [queue, logs, deliveryLogs, schedulerLogs, users] =
        await Promise.all([
          readList<NotificationQueueItem>(paths.notificationQueue(companyId)),
          readList<NotificationLogRow>(paths.notificationLogs(companyId)),
          readList<DeliveryLogRow>(paths.announcementDeliveryLogs(companyId)),
          readList<SchedulerLogRow>(
            paths.attendanceReminderSchedulerLogs(companyId),
          ),
          readList<CompanyUser>(paths.companyUsers(companyId)),
        ])
      const byCreatedDesc = <T extends { created_at?: number }>(a: T, b: T) =>
        (b.created_at ?? 0) - (a.created_at ?? 0)
      queue.sort(byCreatedDesc)
      logs.sort(byCreatedDesc)
      deliveryLogs.sort(byCreatedDesc)
      schedulerLogs.sort(byCreatedDesc)
      return { queue, logs, deliveryLogs, schedulerLogs, users }
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

/** Retry antrean gagal: status kembali pending, retry_count +1. */
export async function retryQueueItem(
  companyId: string,
  item: NotificationQueueItem,
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const nextRetry = (item.retry_count ?? 0) + 1
  await update(
    ref(db, `${paths.notificationQueue(companyId)}/${item.id}`),
    {
      status: "pending",
      retry_count: nextRetry,
      previous_error: item.error ?? "",
      error: null,
      retried_at: Date.now(),
      updated_at: Date.now(),
    },
  )
}

/** Reset dedupe reminder hari ini (WIB): hapus node dedupe tanggal ini. */
export async function resetDedupeToday(
  companyId: string,
): Promise<{ deleted: number; matched: number; dateKey: string }> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const dedupeRef = ref(
    db,
    `companies/${companyId}/notification_dedupe/${dateKey}`,
  )
  const snap = await get(dedupeRef)
  let matched = 0
  let deleted = 0
  if (snap.exists()) {
    const val = snap.val()
    matched = typeof val === "object" ? Object.keys(val).length : 1
    await set(dedupeRef, null)
    deleted = matched
  }
  return { deleted, matched, dateKey }
}

export type TestEventType =
  | "test_push"
  | "schedule_update"
  | "approval"
  | "reminder"

export interface TestEventOptions {
  title?: string
  body?: string
  reminderDirection?: "check_in" | "check_out"
  reminderStage?: "pre" | "now" | "late"
  stage?: string
  targetAction?: string
}

/** Port handleSendTestEvent: test push bypass filtering (skipSettingsCheck). */
export async function sendTestEvent(
  companyId: string,
  uid: string,
  eventType: TestEventType,
  options: TestEventOptions = {},
): Promise<void> {
  let title = options.title ?? "Test Push MYPRESENCE"
  let body = options.body ?? "Ini adalah test push dari dashboard admin."
  const type: string = eventType
  let refType = "system"
  let refId: string = eventType
  let data: Record<string, unknown> = {}
  if (options.stage) data = { ...data, stage: options.stage }
  if (options.targetAction) data = { ...data, target_action: options.targetAction }

  if (eventType === "schedule_update") {
    title = "Jadwal Kerja Diperbarui"
    body = "Ini test notifikasi perubahan jadwal."
    refType = "schedule"
    refId = "test_schedule"
  } else if (eventType === "approval") {
    title = "Cuti Disetujui"
    body = "Ini test notifikasi approval pengajuan."
    refType = "leave_request"
    refId = "test_approval"
  } else if (eventType === "reminder") {
    const direction = options.reminderDirection ?? "check_in"
    const stage = options.reminderStage ?? "pre"
    if (direction === "check_in") {
      if (stage === "pre") title = "Segera Absen Masuk"
      else if (stage === "now") title = "Waktunya Absen Masuk"
      else title = "Anda Belum Absen Masuk"
    } else {
      if (stage === "pre") title = "Segera Absen Pulang"
      else if (stage === "now") title = "Waktunya Absen Pulang"
      else title = "Anda Belum Absen Pulang"
    }
    body = `Ini test reminder absen ${direction === "check_in" ? "masuk" : "pulang"} (${stage}).`
    refType = "attendance_reminder"
    refId = `attendance_reminder_test_${direction}_${stage}`
    data = {
      ...data,
      reminder_action: direction,
      reminder_stage: stage,
      reminder_timing_minutes: stage === "now" ? 0 : 10,
    }
  }
  await createUserNotificationAndPush(companyId, uid, {
    title,
    message: body,
    type,
    ref_type: refType,
    ref_id: refId,
    data,
    skipSettingsCheck: true,
  })
}

export const TEST_EVENT_TYPES: { id: TestEventType; label: string }[] = [
  { id: "test_push", label: "Test Push" },
  { id: "schedule_update", label: "Update Jadwal" },
  { id: "approval", label: "Approval" },
  { id: "reminder", label: "Reminder" },
]

// --- Kesehatan token FCM ----------------------------------------------------

function isPermissionAllowed(token: {
  statusbar_allowed?: boolean
  permission_status?: string
}): boolean {
  if (token.statusbar_allowed !== undefined) return token.statusbar_allowed
  const raw = String(token.permission_status ?? "").toLowerCase()
  return raw === "authorized" || raw === "provisional"
}

export async function fetchTokenHealth(
  companyId: string,
  users: CompanyUser[],
): Promise<FcmToken[]> {
  const fs = getFirestoreDb()
  const db = getDb()
  if (!fs || !db) throw new Error("Firebase belum dikonfigurasi.")
  const allTokens: FcmToken[] = []
  await Promise.all(
    users.map(async (user) => {
      const uid = user.uid ?? user.id ?? ""
      if (!uid) return
      const firestoreIds = new Set<string>()
      const snap = await getDocs(
        collection(fs, firestorePaths.userFcmTokens(companyId, uid)),
      )
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>
        firestoreIds.add(docSnap.id)
        allTokens.push(normalizeToken(data, docSnap.id, uid, user, "firestore"))
      })
      const rtdbSnap = await get(
        ref(db, `companies/${companyId}/users/${uid}/fcm_tokens`),
      )
      if (rtdbSnap.exists()) {
        const rtdbData = (rtdbSnap.val() ?? {}) as Record<string, Record<string, unknown>>
        for (const [tokenId, data] of Object.entries(rtdbData)) {
          if (data && typeof data === "object" && !firestoreIds.has(tokenId)) {
            allTokens.push(normalizeToken(data, tokenId, uid, user, "rtdb_mirror"))
          }
        }
      }
    }),
  )
  const byUid = new Map<string, FcmToken[]>()
  for (const t of allTokens) {
    const list = byUid.get(t.uid) ?? []
    list.push(t)
    byUid.set(t.uid, list)
  }
  return allTokens.map((token) => {
    const siblings = byUid.get(token.uid) ?? []
    const current = siblings.reduce<FcmToken | null>((best, cur) => {
      const curTs = cur.last_seen_at ?? cur.updated_at ?? 0
      const bestTs = best ? (best.last_seen_at ?? best.updated_at ?? 0) : 0
      return curTs > bestTs ? cur : best
    }, null)
    const is_current = current?.token_id === token.token_id
    const effective_permission_allowed = isPermissionAllowed(token)
    let effective_status = "old"
    if (!token.active) effective_status = "inactive"
    else if (token.invalid_reason === "superseded_by_new_token")
      effective_status = "superseded"
    else if (is_current && effective_permission_allowed)
      effective_status = "current_ok"
    else if (is_current && !effective_permission_allowed)
      effective_status = "current_blocked"
    return {
      ...token,
      is_current,
      effective_permission_allowed,
      effective_status,
    }
  })
}

function normalizeToken(
  data: Record<string, unknown>,
  tokenId: string,
  uid: string,
  user: CompanyUser,
  source: "firestore" | "rtdb_mirror",
): FcmToken {
  const permissionStatusRaw = String(data.permission_status ?? "").toLowerCase()
  const statusbarAllowed =
    data.statusbar_allowed !== undefined
      ? Boolean(data.statusbar_allowed)
      : permissionStatusRaw === "authorized" ||
        permissionStatusRaw === "provisional"
  return {
    ...(data as Record<string, unknown>),
    token_id: tokenId,
    uid,
    userName: user.nama_lengkap ?? "Karyawan Tanpa Nama",
    role: user.role ?? "staff",
    permission_status: String(data.permission_status ?? ""),
    statusbar_allowed: statusbarAllowed,
    active: Boolean(data.active),
    permission_last_checked_at: Number(
      data.permission_last_checked_at ?? data.updated_at ?? data.last_seen_at ?? 0,
    ),
    last_seen_at: Number(data.last_seen_at ?? 0),
    updated_at: Number(data.updated_at ?? 0),
    invalidated_at: Number(data.invalidated_at ?? 0),
    invalid_reason: String(data.invalid_reason ?? ""),
    superseded_by: String(data.superseded_by ?? ""),
    app_source: String(data.app_source ?? ""),
    platform: String(data.platform ?? ""),
    device_name: String(data.device_name ?? ""),
    source,
    source_label: source === "firestore" ? "Firestore" : "RTDB Mirror",
    is_current: false,
    effective_permission_allowed: false,
    effective_status: "old",
  } as FcmToken
}

/** Nonaktifkan token secara manual (Firestore + mirror RTDB). */
export async function deactivateToken(
  companyId: string,
  token: FcmToken,
): Promise<void> {
  const fs = getFirestoreDb()
  const db = getDb()
  if (!fs || !db) throw new Error("Firebase belum dikonfigurasi.")
  const now = Date.now()
  await setDoc(
    doc(fs, firestorePaths.userFcmToken(companyId, token.uid, token.token_id)),
    {
      active: false,
      invalidated_at: now,
      updated_at: now,
      invalid_reason: "manual_deactivation_by_admin",
    },
    { merge: true },
  )
  // Mirror RTDB WAJIB ikut ditulis: pipeline push (Worker FCM) membaca
  // dari RTDB — tanpa ini token yang dinonaktifkan tetap menerima push.
  await update(
    ref(db, `companies/${companyId}/users/${token.uid}/fcm_tokens/${token.token_id}`),
    {
      active: false,
      invalidated_at: now,
      updated_at: now,
      invalid_reason: "manual_deactivation_by_admin",
    },
  )
}

export async function removeNotificationQueueItem(
  companyId: string,
  id: string,
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await remove(ref(db, `${paths.notificationQueue(companyId)}/${id}`))
}
