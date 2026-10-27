import {
  get,
  limitToLast,
  orderByChild,
  query,
  ref,
  update,
} from "firebase/database"
import { db } from "./firebase"
import { paths } from "./firebase-paths"

export interface FirebaseNotificationItem {
  id: string
  title: string
  body: string
  read: boolean
  createdAt: number
}

function inboxPath(companyId: string, uid: string) {
  return paths.notificationInbox(companyId, uid)
}

function toItem(
  id: string,
  raw: Record<string, unknown>
): FirebaseNotificationItem {
  return {
    id,
    title: String(raw.title ?? ""),
    body: String(raw.body ?? raw.message ?? ""),
    read: raw.read === true || raw.is_read === true,
    createdAt: Number(raw.created_at ?? 0),
  }
}

// Baca lonceng: 10 terbaru saja (limitToLast), bukan seluruh inbox.
export async function listRecentNotifications(
  companyId: string,
  uid: string,
  limit = 10
): Promise<FirebaseNotificationItem[]> {
  const snap = await get(
    query(
      ref(db, inboxPath(companyId, uid)),
      orderByChild("created_at"),
      limitToLast(limit)
    )
  )
  if (!snap.exists()) return []
  const data = snap.val() as Record<string, Record<string, unknown>>
  return Object.entries(data)
    .map(([id, raw]) => toItem(id, raw ?? {}))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function markNotificationRead(
  companyId: string,
  uid: string,
  id: string
): Promise<void> {
  await update(ref(db, `${inboxPath(companyId, uid)}/${id}`), {
    read: true,
    is_read: true,
    updated_at: Date.now(),
  })
}

export async function markAllNotificationsRead(
  companyId: string,
  uid: string
): Promise<void> {
  const items = await listRecentNotifications(companyId, uid, 50)
  const unread = items.filter((item) => !item.read)
  if (unread.length === 0) return
  const now = Date.now()
  await Promise.all(
    unread.map((item) =>
      update(ref(db, `${inboxPath(companyId, uid)}/${item.id}`), {
        read: true,
        is_read: true,
        updated_at: now,
      })
    )
  )
}
