/**
 * Data Pengaturan Notifikasi — port logika NotificationSettings.tsx
 * myadmin lama. Disimpan di RTDB `companies/{id}/notification_settings/main`
 * (nama path bergaya Firestore, isinya RTDB). Save menormalisasi boolean,
 * meng-clamp menit, dan menulis mirror legacy (field pre_ dan missed_).
 *
 * Tiga field tambahan dari mockup (belum ada di data lama):
 * reminder_scheduler_interval_minutes, reminder_scheduler_skip_holidays,
 * reminder_scheduler_active_at ("HH:MM").
 */
import { useQuery } from "@tanstack/react-query"
import { ref, set } from "firebase/database"
import { getDb, isFirebaseConfigured } from "@/lib/firebase"
import { readValue } from "@/lib/rtdb-read"
import { clampNumber } from "@/lib/display-utils"
import type { NotificationSettings } from "@/lib/firebase-types"

export const NOTIFICATION_SETTINGS_PATH = (companyId: string) =>
  `companies/${companyId}/notification_settings/main`

export const DEFAULT_NOTIFICATION_SETTINGS: Required<
  Omit<NotificationSettings, "updated_at" | "updated_by">
> = {
  push_enabled: true,
  in_app_enabled: true,
  attendance_reminder_enabled: true,
  reminder_check_in_pre_enabled: true,
  reminder_check_in_now_enabled: true,
  reminder_check_in_late_enabled: false,
  reminder_check_out_pre_enabled: true,
  reminder_check_out_now_enabled: true,
  reminder_check_out_late_enabled: false,
  reminder_check_in_pre_minutes: 10,
  reminder_check_in_now_window_minutes: 6,
  reminder_check_in_late_minutes: 10,
  reminder_check_out_pre_minutes: 10,
  reminder_check_out_now_window_minutes: 6,
  reminder_check_out_late_minutes: 10,
  reminder_scheduler_catchup_minutes: 6,
  reminder_scheduler_interval_minutes: 15,
  reminder_scheduler_skip_holidays: true,
  reminder_scheduler_active_at: "",
  announcement_push_enabled: true,
  approval_push_enabled: true,
  schedule_change_push_enabled: true,
  holiday_notice_push_enabled: true,
  pre_check_in_enabled: true,
  pre_check_in_minutes: 10,
  pre_check_out_enabled: true,
  pre_check_out_minutes: 10,
  missed_check_in_enabled: true,
  missed_check_in_minutes: 10,
  missed_check_out_enabled: true,
  missed_check_out_minutes: 10,
}

/** Gabung data tersimpan dengan default + fallback mirror legacy. */
export function mergeNotificationSettings(
  data: NotificationSettings | null,
): NotificationSettings {
  const d = data ?? {}
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...d,
    reminder_check_in_pre_enabled:
      d.reminder_check_in_pre_enabled !== undefined
        ? d.reminder_check_in_pre_enabled
        : (d.pre_check_in_enabled ?? true),
    reminder_check_in_now_enabled:
      d.reminder_check_in_now_enabled !== undefined
        ? d.reminder_check_in_now_enabled
        : true,
    reminder_check_in_late_enabled:
      d.reminder_check_in_late_enabled !== undefined
        ? d.reminder_check_in_late_enabled
        : (d.missed_check_in_enabled ?? false),
    reminder_check_in_pre_minutes:
      d.reminder_check_in_pre_minutes ?? d.pre_check_in_minutes ?? 10,
    reminder_check_in_now_window_minutes:
      d.reminder_check_in_now_window_minutes ?? 6,
    reminder_check_in_late_minutes:
      d.reminder_check_in_late_minutes ?? d.missed_check_in_minutes ?? 10,
    reminder_check_out_pre_enabled:
      d.reminder_check_out_pre_enabled !== undefined
        ? d.reminder_check_out_pre_enabled
        : (d.pre_check_out_enabled ?? true),
    reminder_check_out_now_enabled:
      d.reminder_check_out_now_enabled !== undefined
        ? d.reminder_check_out_now_enabled
        : true,
    reminder_check_out_late_enabled:
      d.reminder_check_out_late_enabled !== undefined
        ? d.reminder_check_out_late_enabled
        : (d.missed_check_out_enabled ?? false),
    reminder_check_out_pre_minutes:
      d.reminder_check_out_pre_minutes ?? d.pre_check_out_minutes ?? 10,
    reminder_check_out_now_window_minutes:
      d.reminder_check_out_now_window_minutes ?? 6,
    reminder_check_out_late_minutes:
      d.reminder_check_out_late_minutes ?? d.missed_check_out_minutes ?? 10,
    reminder_scheduler_catchup_minutes:
      d.reminder_scheduler_catchup_minutes ?? 6,
  }
}

export function useNotificationSettings(companyId: string) {
  return useQuery({
    queryKey: ["ks", "notification-settings", companyId],
    queryFn: async (): Promise<NotificationSettings> => {
      const data = await readValue<NotificationSettings>(
        NOTIFICATION_SETTINGS_PATH(companyId),
      )
      return mergeNotificationSettings(data)
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

/** Port handleSave NotificationSettings.tsx lama (clamp + mirror legacy). */
export async function saveNotificationSettings(
  companyId: string,
  settings: NotificationSettings,
  actor: { uid: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const normalized = {
    ...settings,
    attendance_reminder_enabled: Boolean(settings.attendance_reminder_enabled),
    reminder_check_in_pre_enabled: Boolean(
      settings.reminder_check_in_pre_enabled,
    ),
    reminder_check_in_now_enabled: Boolean(
      settings.reminder_check_in_now_enabled,
    ),
    reminder_check_in_late_enabled: Boolean(
      settings.reminder_check_in_late_enabled,
    ),
    reminder_check_out_pre_enabled: Boolean(
      settings.reminder_check_out_pre_enabled,
    ),
    reminder_check_out_now_enabled: Boolean(
      settings.reminder_check_out_now_enabled,
    ),
    reminder_check_out_late_enabled: Boolean(
      settings.reminder_check_out_late_enabled,
    ),
    reminder_check_in_pre_minutes: clampNumber(
      Number(settings.reminder_check_in_pre_minutes),
      0,
      120,
      10,
    ),
    reminder_check_in_now_window_minutes: clampNumber(
      Number(settings.reminder_check_in_now_window_minutes),
      0,
      30,
      6,
    ),
    reminder_check_in_late_minutes: clampNumber(
      Number(settings.reminder_check_in_late_minutes),
      1,
      180,
      10,
    ),
    reminder_check_out_pre_minutes: clampNumber(
      Number(settings.reminder_check_out_pre_minutes),
      0,
      120,
      10,
    ),
    reminder_check_out_now_window_minutes: clampNumber(
      Number(settings.reminder_check_out_now_window_minutes),
      0,
      30,
      6,
    ),
    reminder_check_out_late_minutes: clampNumber(
      Number(settings.reminder_check_out_late_minutes),
      1,
      240,
      10,
    ),
    reminder_scheduler_catchup_minutes: clampNumber(
      Number(settings.reminder_scheduler_catchup_minutes),
      5,
      30,
      6,
    ),
    reminder_scheduler_interval_minutes: clampNumber(
      Number(settings.reminder_scheduler_interval_minutes),
      1,
      120,
      15,
    ),
    updated_at: Date.now(),
    updated_by: actor.uid,
  }
  const payload = {
    ...normalized,
    pre_check_in_enabled: normalized.reminder_check_in_pre_enabled,
    pre_check_in_minutes: normalized.reminder_check_in_pre_minutes,
    pre_check_out_enabled: normalized.reminder_check_out_pre_enabled,
    pre_check_out_minutes: normalized.reminder_check_out_pre_minutes,
    missed_check_in_enabled: normalized.reminder_check_in_late_enabled,
    missed_check_in_minutes: normalized.reminder_check_in_late_minutes,
    missed_check_out_enabled: normalized.reminder_check_out_late_enabled,
    missed_check_out_minutes: normalized.reminder_check_out_late_minutes,
  }
  await set(ref(db, NOTIFICATION_SETTINGS_PATH(companyId)), payload)
}
