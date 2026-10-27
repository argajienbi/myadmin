/**
 * Data Pengumuman — port announcementService.ts + announcementTargetResolver.ts
 * myadmin lama. Pengumuman tinggal di RTDB `companies/{id}/announcements`.
 * Publish mengirim push ke UID target (bila send_push) + log antrean.
 */
import { useQuery } from "@tanstack/react-query"
import { push, ref, set, update } from "firebase/database"
import { getDb, isFirebaseConfigured } from "@/lib/firebase"
import { readList } from "@/lib/rtdb-read"
import { createNotificationForUsers, writeNotificationLog } from "@/lib/firebase-notify"
import { paths } from "@/lib/firebase-paths"
import type {
  Announcement,
  AnnouncementStatus,
  AnnouncementTargetType,
  AnnouncementType,
  Area,
  CompanyUser,
  Department,
  EmployeeGroup,
  Office,
  SubDepartment,
} from "@/lib/firebase-types"

export interface AnnouncementsData {
  announcements: Announcement[]
  employees: CompanyUser[]
  areas: Area[]
  offices: Office[]
  departments: Department[]
  subDepartments: SubDepartment[]
  groups: EmployeeGroup[]
}

export function useAnnouncements(companyId: string) {
  return useQuery({
    queryKey: ["ks", "announcements", companyId],
    queryFn: async (): Promise<AnnouncementsData> => {
      const [
        announcements,
        employees,
        areas,
        offices,
        departments,
        subDepartments,
        groups,
      ] = await Promise.all([
        readList<Announcement>(paths.companyAnnouncements(companyId)),
        readList<CompanyUser>(paths.companyUsers(companyId)),
        readList<Area>(paths.areas(companyId)),
        readList<Office>(paths.offices(companyId)),
        readList<Department>(paths.departments(companyId)),
        readList<SubDepartment>(paths.subDepartments(companyId)),
        readList<EmployeeGroup>(paths.employeeGroups(companyId)),
      ])
      return {
        announcements,
        employees,
        areas,
        offices,
        departments,
        subDepartments,
        groups,
      }
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

function isActiveEmployee(e: CompanyUser): boolean {
  const status = String(e.status_akun ?? "").toLowerCase()
  if (["active", "aktif", "enabled", "approved", "1"].includes(status))
    return true
  return (
    (e as unknown as { active?: boolean }).active === true ||
    (e as unknown as { is_active?: boolean }).is_active === true
  )
}

/** Port announcementTargetResolver.ts lama. */
export function resolveAnnouncementTargetUids(
  employees: CompanyUser[],
  targetType: AnnouncementTargetType,
  targetIds: string[],
): string[] {
  const active = employees.filter(isActiveEmployee)
  if (targetType === "all") return active.map((e) => e.uid ?? e.id ?? "")
  if (targetType === "user") return targetIds
  const field: Record<string, keyof CompanyUser> = {
    office: "office_id",
    area: "area_id",
    department: "department_id",
    sub_department: "sub_department_id",
    group: "group_id",
  }
  const key = field[targetType]
  if (!key) return []
  return active
    .filter((e) => targetIds.includes(String(e[key] ?? "")))
    .map((e) => e.uid ?? e.id ?? "")
}

export interface AnnouncementForm {
  title: string
  body: string
  type: AnnouncementType
  status: AnnouncementStatus
  target_type: AnnouncementTargetType
  target_ids: string[]
  send_push: boolean
  show_on_home: boolean
  pinned: boolean
  scheduled_at: number | null
}

export async function createAnnouncement(
  companyId: string,
  form: AnnouncementForm,
  actor: { uid: string; name: string },
): Promise<string | null> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!form.title.trim()) throw new Error("Judul wajib diisi.")
  if (!form.body.trim()) throw new Error("Isi pengumuman wajib diisi.")
  const now = Date.now()
  const announcementsRef = push(ref(db, paths.companyAnnouncements(companyId)))
  await set(announcementsRef, {
    company_id: companyId,
    title: form.title.trim(),
    body: form.body.trim(),
    type: form.type,
    status: form.status,
    target_type: form.target_type,
    target_ids: form.target_ids,
    send_push: form.send_push,
    show_on_home: form.show_on_home,
    pinned: form.pinned,
    active: form.status !== "archived",
    published_at: form.status === "published" ? now : null,
    scheduled_at: form.scheduled_at ?? null,
    created_by: actor.uid,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now,
  })
  await writeNotificationLog(companyId, {
    action: "announcement_create",
    announcement_id: announcementsRef.key,
    title: form.title.trim(),
    status: form.status,
    target_type: form.target_type,
    target_ids: form.target_ids,
    created_by: actor.uid,
    created_by_name: actor.name,
  })
  return announcementsRef.key
}

export async function updateAnnouncement(
  companyId: string,
  announcementId: string,
  form: Partial<AnnouncementForm>,
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await update(ref(db, paths.companyAnnouncement(companyId, announcementId)), {
    ...form,
    updated_at: Date.now(),
  })
}

export async function publishAnnouncement(
  companyId: string,
  announcement: Announcement,
  targetUids: string[],
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const now = Date.now()
  await update(ref(db, paths.companyAnnouncement(companyId, announcement.id ?? "")), {
    status: "published",
    active: true,
    published_at: now,
    updated_at: now,
  })
  if (announcement.send_push) {
    try {
      const results = await createNotificationForUsers(
        companyId,
        targetUids,
        {
          title: announcement.title,
          message: announcement.body,
          type: announcement.type ?? "info",
          ref_type: "announcement",
          ref_id: announcement.id ?? "",
          data: {
            announcement_id: announcement.id ?? "",
            target_type: announcement.target_type ?? "all",
          },
        },
      )
      const queueCount = results.filter((item) => item?.queueId).length
      await writeNotificationLog(companyId, {
        action: "announcement_push_queue_created",
        announcement_id: announcement.id,
        target_count: targetUids.length,
        queue_count: queueCount,
        created_by: actor.uid,
        created_by_name: actor.name,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await writeNotificationLog(companyId, {
        action: "announcement_push_queue_failed",
        announcement_id: announcement.id,
        target_count: targetUids.length,
        error: message,
        created_by: actor.uid,
        created_by_name: actor.name,
      })
      throw new Error(
        `Pengumuman dipublish, tetapi push queue gagal dibuat: ${message}`,
        { cause: err },
      )
    }
  }
}

export async function archiveAnnouncement(
  companyId: string,
  announcementId: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const now = Date.now()
  await update(ref(db, paths.companyAnnouncement(companyId, announcementId)), {
    status: "archived",
    active: false,
    deleted_at: now,
    deleted_by: actor.uid,
    updated_at: now,
  })
  await writeNotificationLog(companyId, {
    action: "announcement_archive",
    announcement_id: announcementId,
    created_by: actor.uid,
    created_by_name: actor.name,
  })
}

export async function restoreAnnouncement(
  companyId: string,
  announcementId: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await update(ref(db, paths.companyAnnouncement(companyId, announcementId)), {
    status: "draft",
    active: true,
    deleted_at: null,
    deleted_by: null,
    updated_at: Date.now(),
  })
  await writeNotificationLog(companyId, {
    action: "announcement_restore",
    announcement_id: announcementId,
    created_by: actor.uid,
    created_by_name: actor.name,
  })
}
