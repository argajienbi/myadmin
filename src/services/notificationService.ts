import { createUserNotificationAndPush } from "./notificationDeliveryService";

export type AppNotificationType =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "schedule_update"
  | "approval"
  | "reminder"
  | "announcement"
  | string;

export type CreateNotificationResult = {
  rtdbNotificationId: string | null;
  firestoreInboxId: string | null;
  queueId: string | null;
};

export async function createNotification(
  uid: string,
  payload: {
    company_id: string;
    title: string;
    message: string;
    type: AppNotificationType;
    ref_type: string;
    ref_id: string;
    data?: Record<string, any>;
  }
): Promise<CreateNotificationResult> {
  try {
    const result = await createUserNotificationAndPush({
      companyId: payload.company_id,
      uid,
      title: payload.title,
      body: payload.message,
      type: payload.type as any,
      refType: payload.ref_type,
      refId: payload.ref_id,
      data: payload.data || {},
    });

    console.info("Notification inbox and queue created using delivery service", {
      company_id: payload.company_id,
      uid,
      notificationId: result.notificationId,
      ref_type: payload.ref_type,
      ref_id: payload.ref_id,
    });

    return {
      rtdbNotificationId: result.notificationId || null,
      firestoreInboxId: result.notificationId || null,
      queueId: result.queueId || null,
    };
  } catch (err: any) {
    console.error("Failed creating notification queue", {
      company_id: payload.company_id,
      uid,
      ref_type: payload.ref_type,
      ref_id: payload.ref_id,
      error: err?.message || err,
    });

    throw new Error(
      `Gagal membuat notifikasi dan push queue: ${err?.message || err}`
    );
  }
}
