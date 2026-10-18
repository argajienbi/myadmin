import { push, ref, set } from "firebase/database";
import { db } from "../firebase";

export type NotificationDeliveryOptions = {
  companyId: string;
  uid: string;
  title: string;
  body: string;
  type: string;
  refType: string;
  refId: string;
  relatedId?: string;
  data?: Record<string, any>;
  senderUid?: string;
  senderName?: string;
  senderRole?: string;
  notificationId?: string;
  dedupeKey?: string;
  forceRetry?: boolean;
  skipSettingsCheck?: boolean;
};

export async function createUserNotificationAndPush(options: NotificationDeliveryOptions) {
  const {
    companyId,
    uid,
    title,
    body,
    type,
    refType,
    refId,
    relatedId,
    data,
    senderName = "Admin",
    senderRole = "admin",
    notificationId,
    dedupeKey,
    skipSettingsCheck = false,
  } = options;

  if (!companyId || !uid) {
    throw new Error("companyId atau uid tidak boleh kosong.");
  }

  const nowMs = Date.now();
  const related = relatedId || refId || "";

  const notifRef = push(ref(db, `companies/${companyId}/users/${uid}/notification_inbox`));
  const notifPayload = {
    notification_id: notificationId || notifRef.key,
    company_id: companyId,
    uid,
    title,
    message: body,
    body,
    type: type || "info",
    ref_type: refType || "",
    ref_id: refId || "",
    related_id: related,
    data: data || {},
    sender_name: senderName,
    sender_role: senderRole,
    dedupe_key: dedupeKey || null,
    skip_settings_check: skipSettingsCheck,
    read: false,
    is_read: false,
    created_at: nowMs,
    updated_at: nowMs,
  };
  await set(notifRef, notifPayload);

  const queueRef = push(ref(db, `companies/${companyId}/notification_queue`));
  const queuePayload = {
    company_id: companyId,
    uid,
    title,
    message: body,
    body,
    type: type || "info",
    ref_type: refType || "",
    ref_id: refId || "",
    related_id: related,
    data: data || {},
    notification_id: notificationId || notifRef.key,
    status: "pending",
    retry_count: 0,
    token_count: 0,
    success_count: 0,
    failed_count: 0,
    error: null,
    created_at: nowMs,
    sent_at: null,
    failed_at: null,
  };
  await set(queueRef, queuePayload);

  console.info("Notification + queue written directly to RTDB (no Cloud Function)", {
    company_id: companyId,
    uid,
    notificationId: notifRef.key,
    queueId: queueRef.key,
    type,
  });

  return {
    success: true,
    skipped: false,
    reason: "",
    notificationId: notifRef.key || "",
    queueId: queueRef.key || "",
    pushSent: false,
    inAppSent: true,
  };
}
