import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase";

export type NotificationDeliveryOptions = {
  companyId: string;
  uid: string;
  title: string;
  body: string;
  type: string; // e.g. success, info, warning, danger, schedule_update, etc.
  refType: string; // e.g. schedule, leave, correction, qr_attendance_request
  refId: string;
  relatedId?: string;
  data?: Record<string, any>;
  senderUid?: string;
  senderName?: string;
  senderRole?: string;
  notificationId?: string; // Optional custom notification_id
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

  try {
    const functions = getFunctions(app, "asia-southeast1");
    const callable = httpsCallable<any, any>(functions, "createUserNotificationAndPushCallable");

    const result = await callable({
      companyId,
      uid,
      title,
      body,
      type,
      refType,
      refId,
      relatedId: relatedId || refId || "",
      payload: data || {},
      notificationId,
      dedupeKey,
      senderName,
      senderRole,
      skipSettingsCheck,
      forceRetry: options.forceRetry || false,
    });

    const resData = result.data || {};
    if (resData.skipped) {
      console.info(`Notification of type ${type} to user ${uid} skipped:`, resData.reason);
    } else {
      console.info("Notification successfully triggered via Callable:", resData);
    }

    return {
      success: Boolean(resData.success),
      skipped: Boolean(resData.skipped),
      reason: resData.reason || "",
      notificationId: resData.notification_id || notificationId || "",
      queueId: resData.queue_id || "",
      pushSent: Boolean(resData.push_sent),
      inAppSent: Boolean(resData.in_app_sent),
    };
  } catch (error: any) {
    const code = error?.code || "";
    const message = error?.message || "";
    const detailsMessage =
      error?.details?.original_message ||
      error?.details?.message ||
      "";

    const errorMsg = [code, detailsMessage || message]
      .filter(Boolean)
      .join(": ");

    console.warn("Failed to create user notification and push queue via Callable:", error);
    throw new Error(`Failed to create notification and push: ${errorMsg}`);
  }
}

