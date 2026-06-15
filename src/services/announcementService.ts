import { push, ref, set, update } from "firebase/database";
import { db } from "../firebase";
import {
  createNotificationForUsers,
  writeNotificationLog,
} from "./firestoreNotificationService";

export type AnnouncementStatus = "draft" | "published" | "scheduled" | "archived";

export type AnnouncementTargetType =
  | "all"
  | "user"
  | "office"
  | "area"
  | "department"
  | "sub_department"
  | "group";

export type AnnouncementPayload = {
  company_id: string;
  title: string;
  body: string;
  type: "info" | "success" | "warning" | "danger" | string;
  status: AnnouncementStatus;
  target_type: AnnouncementTargetType;
  target_ids: string[];
  send_push: boolean;
  scheduled_at?: number | null;
  created_by: string;
  created_by_name: string;
};

export async function createAnnouncement(payload: AnnouncementPayload) {
  const now = Date.now();
  const announcementsRef = push(ref(db, `companies/${payload.company_id}/announcements`));

  await set(announcementsRef, {
    ...payload,
    active: payload.status !== "archived",
    published_at: payload.status === "published" ? now : null,
    scheduled_at: payload.scheduled_at || null,
    created_at: now,
    updated_at: now,
  });

  await writeNotificationLog(payload.company_id, {
    action: "announcement_create",
    announcement_id: announcementsRef.key,
    title: payload.title,
    status: payload.status,
    target_type: payload.target_type,
    target_ids: payload.target_ids,
    created_by: payload.created_by,
    created_by_name: payload.created_by_name,
  });

  return announcementsRef.key;
}

export async function updateAnnouncement(
  companyId: string,
  announcementId: string,
  payload: Partial<AnnouncementPayload>
) {
  const docRef = ref(db, `companies/${companyId}/announcements/${announcementId}`);
  await update(docRef, {
    ...payload,
    updated_at: Date.now(),
  });
}

export async function publishAnnouncement(
  companyId: string,
  announcementId: string,
  payload: {
    title: string;
    body: string;
    type: string;
    target_type: AnnouncementTargetType;
    target_ids: string[];
    send_push: boolean;
    target_uids: string[];
    admin_uid: string;
    admin_name: string;
  }
) {
  const now = Date.now();

  const docRef = ref(db, `companies/${companyId}/announcements/${announcementId}`);
  await update(docRef, {
    status: "published",
    active: true,
    published_at: now,
    updated_at: now,
  });

  if (payload.send_push) {
    try {
      const notificationResults = await createNotificationForUsers(companyId, payload.target_uids, {
        title: payload.title,
        message: payload.body,
        body: payload.body,
        type: payload.type,
        ref_type: "announcement",
        ref_id: announcementId,
        related_id: announcementId,
        data: {
          announcement_id: announcementId,
          target_type: payload.target_type,
        },
      });

      const queueCount = notificationResults.filter((item: any) => item?.queueId).length;

      await writeNotificationLog(companyId, {
        action: "announcement_push_queue_created",
        announcement_id: announcementId,
        target_count: payload.target_uids.length,
        queue_count: queueCount,
        created_by: payload.admin_uid,
        created_by_name: payload.admin_name,
      });
    } catch (err: any) {
      await writeNotificationLog(companyId, {
        action: "announcement_push_queue_failed",
        announcement_id: announcementId,
        target_count: payload.target_uids.length,
        error: err?.message || String(err),
        created_by: payload.admin_uid,
        created_by_name: payload.admin_name,
      });

      throw new Error(`Pengumuman dipublish, tetapi push queue gagal dibuat: ${err?.message || err}`);
    }
  }
}

export async function archiveAnnouncement(
  companyId: string,
  announcementId: string,
  adminUid: string,
  adminName: string
) {
  const now = Date.now();

  const docRef = ref(db, `companies/${companyId}/announcements/${announcementId}`);
  await update(docRef, {
    status: "archived",
    active: false,
    deleted_at: now,
    deleted_by: adminUid,
    updated_at: now,
  });

  await writeNotificationLog(companyId, {
    action: "announcement_archive",
    announcement_id: announcementId,
    created_by: adminUid,
    created_by_name: adminName,
  });
}

export async function restoreAnnouncement(
  companyId: string,
  announcementId: string,
  adminUid: string,
  adminName: string
) {
  const docRef = ref(db, `companies/${companyId}/announcements/${announcementId}`);
  await update(docRef, {
    status: "draft",
    active: true,
    deleted_at: null,
    deleted_by: null,
    updated_at: Date.now(),
  });

  await writeNotificationLog(companyId, {
    action: "announcement_restore",
    announcement_id: announcementId,
    created_by: adminUid,
    created_by_name: adminName,
  });
}
