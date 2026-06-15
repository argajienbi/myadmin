import { push, ref, set } from "firebase/database";
import { db } from "../firebase";
import { paths } from "./paths";
import { createUserNotificationAndPush } from "./notificationDeliveryService";

export type NotificationType = "info" | "success" | "warning" | "danger";

export type NotificationPayload = {
  company_id: string;
  uid: string;
  title: string;
  message: string;
  body?: string;
  type: NotificationType | string;
  ref_type: string;
  ref_id: string;
  related_id?: string;
  data?: Record<string, any>;
};

function nowDateParts() {
  const now = new Date();
  const created_date = now.toISOString().slice(0, 10);
  const created_time = now.toTimeString().slice(0, 8);
  return {
    nowMs: now.getTime(),
    created_date,
    created_time,
  };
}

export async function createUserNotification(payload: NotificationPayload) {
  const { nowMs, created_date, created_time } = nowDateParts();

  const body = payload.body || payload.message || "";
  const relatedId = payload.related_id || payload.ref_id || "";

  const normalized = {
    ...payload,
    body,
    message: payload.message || body,
    related_id: relatedId,
    read: false,
    is_read: false,
    created_date,
    created_time,
    created_at: nowMs,
    updated_at: nowMs,
  };

  const rtdbRef = push(ref(db, paths.notifications(payload.uid)));

  await set(rtdbRef, {
    ...normalized,
    notification_id: rtdbRef.key,
  });

  return {
    id: rtdbRef.key,
    ...normalized,
  };
}

export async function createNotificationQueue(payload: NotificationPayload) {
  if (!payload.company_id) {
    throw new Error("company_id kosong, notification queue tidak bisa dibuat.");
  }

  if (!payload.uid) {
    throw new Error("uid kosong, notification queue tidak bisa dibuat.");
  }

  if (!payload.title && !payload.message && !payload.body) {
    throw new Error("title/message/body kosong, notification queue tidak bisa dibuat.");
  }

  const { nowMs } = nowDateParts();

  const rtdbQueueRef = push(ref(db, `companies/${payload.company_id}/notification_queue`));
  await set(rtdbQueueRef, {
    ...payload,
    company_id: payload.company_id,
    uid: payload.uid,
    title: payload.title,
    message: payload.message,
    body: payload.body || payload.message || "",
    type: payload.type || "info",
    ref_type: payload.ref_type || "",
    ref_id: payload.ref_id || "",
    related_id: payload.related_id || payload.ref_id || "",
    status: "pending",
    retry_count: 0,
    token_count: 0,
    success_count: 0,
    failed_count: 0,
    error: null,
    created_at: nowMs,
    sent_at: null,
    failed_at: null,
  });

  console.info("Notification queue document created (RTDB)", {
    company_id: payload.company_id,
    uid: payload.uid,
    queueId: rtdbQueueRef.key,
    ref_type: payload.ref_type || "",
    ref_id: payload.ref_id || "",
  });

  return rtdbQueueRef.key;
}

export async function createNotificationForUser(payload: NotificationPayload) {
  const result = await createUserNotificationAndPush({
    companyId: payload.company_id,
    uid: payload.uid,
    title: payload.title,
    body: payload.body || payload.message || "",
    type: payload.type,
    refType: payload.ref_type,
    refId: payload.ref_id,
    relatedId: payload.related_id,
    data: payload.data,
  });

  return {
    inbox: { id: result.notificationId },
    queueId: result.queueId || result.notificationId,
  };
}

export async function createNotificationForUsers(
  companyId: string,
  uids: string[],
  basePayload: Omit<NotificationPayload, "company_id" | "uid">
) {
  const results: any[] = [];

  for (const uid of uids) {
    try {
      const res = await createNotificationForUser({
        ...basePayload,
        company_id: companyId,
        uid,
      });
      results.push(res);
    } catch (err) {
      console.warn(`Failed to push notification to user ${uid}:`, err);
    }
  }

  return results;
}

export async function writeNotificationLog(
  companyId: string,
  payload: Record<string, any>
) {
  const { nowMs } = nowDateParts();

  const rtdbLogsRef = push(ref(db, `companies/${companyId}/notification_logs`));
  return set(rtdbLogsRef, {
    ...payload,
    created_at: nowMs,
  });
}
