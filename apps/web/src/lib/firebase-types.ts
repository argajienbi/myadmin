export type UserRole = "owner" | "admin" | "user";

export type Position =
  | "MANAGER"
  | "ADMIN"
  | "SPV"
  | "LEADER"
  | "CREW"
  | "USER"
  | "OWNER";

export type AccountStatus =
  | "pending"
  | "active"
  | "inactive"
  | "rejected";

export type AttendanceAction =
  | "masuk"
  | "pulang"
  | "lembur_masuk"
  | "lembur_pulang";

export type AttendanceMethod =
  | "selfie"
  | "qr"
  | "manual"
  | "correction";

export type AttendanceStatus =
  | "hadir"
  | "terlambat"
  | "izin"
  | "sakit"
  | "cuti"
  | "alpha"
  | "dinas"
  | "dispensasi";

export type RequestStatus =
  | "pending"
  | "pending_admin"
  | "approved"
  | "rejected"
  | "success";

export type ScheduleSource =
  | "user_assignment"
  | "group_assignment"
  | "holiday"
  | "special_schedule"
  | "manual_correction"
  | "none";

export interface UserIndex {
  uid: string;
  company_id: string;
  role: UserRole;
  position?: Position;
  status_akun: AccountStatus;
  email: string;
  nama_lengkap: string;
  photo_url?: string;
  photo_path?: string;
  created_at?: number;
  updated_at?: number;
}

export interface CompanyUser extends UserIndex {
  id?: string;
  nip?: string;
  no_hp?: string;
  area_id?: string;
  office_id?: string;
  department_id?: string;
  sub_department_id?: string;
  group_id?: string;
  profile_completed?: boolean;
  face_registered?: boolean;
  face_registered_at?: number;
  device_id?: string | null;
  device_name?: string | null;
  photo_url?: string;
  photo_path?: string;
  qr_token?: string;
  qr_active?: boolean;
  qr_updated_at?: number;
  last_transfer_id?: string;
  last_transfer_at?: number;
  last_transfer_reason?: string;
  updated_by?: string;
  updated_by_name?: string;
}

export interface EmployeeTransferLog {
  id?: string;
  company_id: string;
  uid: string;
  employee_name: string;
  employee_email?: string;

  old_area_id?: string;
  old_office_id?: string;
  old_department_id?: string;
  old_sub_department_id?: string;
  old_group_id?: string;

  old_area_name?: string;
  old_office_name?: string;
  old_department_name?: string;
  old_sub_department_name?: string;
  old_group_name?: string;

  new_area_id?: string;
  new_office_id?: string;
  new_department_id?: string;
  new_sub_department_id?: string;
  new_group_id?: string;

  new_area_name?: string;
  new_office_name?: string;
  new_department_name?: string;
  new_sub_department_name?: string;
  new_group_name?: string;

  effective_date: string;
  reason: string;
  status: "completed" | "cancelled";

  schedule_warning?: string;
  individual_assignment_count?: number;
  new_group_assignment_count?: number;

  created_by: string;
  created_by_name: string;
  created_at: number;
  updated_at: number;
}

export interface Company {
  id?: string;
  name: string;
  admin_uid: string;
  active: boolean;
  created_by: string;
  created_at: number;
  updated_at: number;
  company_website_enabled?: boolean;
  company_website_title?: string;
  company_website_url?: string;
  company_allowed_domains?: string[] | Record<string, string>;
  display_name?: string;
  company_logo_enabled?: boolean;
  company_logo_url?: string;
  company_logo_path?: string;
  company_logo_updated_at?: number;
  company_logo_file_name?: string;
  company_logo_mime_type?: string;
  company_logo_size_bytes?: number;
  /** Tambahan dari mockup Settings (belum ada di data lama). */
  company_primary_color?: string;
}

export interface CompanyInvite {
  id?: string;
  code?: string;
  company_id: string;
  company_name: string;
  active: boolean;
  created_by: string;
  expired_at: number;
  created_at: number;
}

export interface Area {
  id?: string;
  name: string;
  company_id?: string;
  active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface Office {
  id?: string;
  name: string;
  area_id: string;
  company_id?: string;
  latitude: number;
  longitude: number;
  radius_meter: number;
  active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface Department {
  id?: string;
  name: string;
  area_id?: string;
  office_id: string;
  company_id?: string;
  active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface SubDepartment {
  id?: string;
  name: string;
  office_id: string;
  department_id: string;
  company_id?: string;
  active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface EmployeeGroup {
  id?: string;
  name: string;
  area_id?: string;
  office_id: string;
  department_id: string;
  sub_department_id: string;
  company_id?: string;
  active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface Timetable {
  id?: string;
  name: string;
  work_start: string;
  work_end: string;
  // "Tambah Pola" lama membuat timetable tanpa jendela check-in/out —
  // field ini opsional di data nyata.
  check_in_start?: string;
  check_in_end?: string;
  check_out_start?: string;
  check_out_end?: string;
  late_tolerance_minute?: number;
  early_out_tolerance_minute?: number;
  crosses_midnight?: boolean;
  company_id?: string;
  active?: boolean;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at?: number;
  updated_at?: number;
}

export interface ShiftDay {
  active: boolean;
  timetable_id: string;
}

export interface Shift {
  id?: string;
  name: string;
  active: boolean;
  days: {
    monday: ShiftDay;
    tuesday: ShiftDay;
    wednesday: ShiftDay;
    thursday: ShiftDay;
    friday: ShiftDay;
    saturday: ShiftDay;
    sunday: ShiftDay;
  };
  company_id?: string;
  workday_mode?: string;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at?: number;
  updated_at?: number;
}

export interface ScheduleAssignment {
  id?: string;
  type: "group" | "user";
  target_id: string;
  shift_id: string;
  start_date: string;
  end_date: string;
  company_id?: string;
  active: boolean;
  created_by: string;
  created_at?: number;
  updated_at?: number;
}

// --- Tipe yang sebelumnya hanya ada di seam Kelola (port types.ts lama) ---

// Kunci hari memakai nama penuh ("monday".."sunday") seperti
// scheduleResolver.ts dan Shift.days di atas — BUKAN "mon".."sun".
// Shift yang ditulis dengan key pendek tidak dibaca resolver lama.
export type ShiftDayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday"
export const SHIFT_DAY_KEYS: ShiftDayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]
export const SHIFT_DAY_LABELS: Record<ShiftDayKey, string> = {
  monday: "Senin",
  tuesday: "Selasa",
  wednesday: "Rabu",
  thursday: "Kamis",
  friday: "Jumat",
  saturday: "Sabtu",
  sunday: "Minggu",
}

export type AnnouncementStatus =
  | "draft"
  | "published"
  | "scheduled"
  | "archived"
export type AnnouncementType = "info" | "success" | "warning" | "danger"
export type AnnouncementTargetType =
  | "all"
  | "user"
  | "office"
  | "area"
  | "department"
  | "sub_department"
  | "group"

export interface Announcement {
  id?: string
  title: string
  body: string
  type?: AnnouncementType
  status: AnnouncementStatus
  target_type?: AnnouncementTargetType
  target_ids?: string[]
  send_push?: boolean
  show_on_home?: boolean
  pinned?: boolean
  scheduled_at?: number | null
  published_at?: number | null
  created_at?: number
  created_by?: string
  created_by_name?: string
  updated_at?: number
}

export interface AuditLog {
  id?: string
  action: string
  details?: string
  user_uid?: string
  user_name?: string
  target_path?: string
  old_value?: string
  new_value?: string
  created_at?: number
}

export interface NotificationSettings {
  push_enabled?: boolean
  in_app_enabled?: boolean
  attendance_reminder_enabled?: boolean
  reminder_check_in_pre_enabled?: boolean
  reminder_check_in_now_enabled?: boolean
  reminder_check_in_late_enabled?: boolean
  reminder_check_out_pre_enabled?: boolean
  reminder_check_out_now_enabled?: boolean
  reminder_check_out_late_enabled?: boolean
  reminder_check_in_pre_minutes?: number
  reminder_check_in_now_window_minutes?: number
  reminder_check_in_late_minutes?: number
  reminder_check_out_pre_minutes?: number
  reminder_check_out_now_window_minutes?: number
  reminder_check_out_late_minutes?: number
  reminder_scheduler_catchup_minutes?: number
  /** Tambahan dari mockup (belum ada di data lama). */
  reminder_scheduler_interval_minutes?: number
  /** Tambahan dari mockup (belum ada di data lama). */
  reminder_scheduler_skip_holidays?: boolean
  /** Tambahan dari mockup (belum ada di data lama): jam aktif "HH:MM". */
  reminder_scheduler_active_at?: string
  announcement_push_enabled?: boolean
  approval_push_enabled?: boolean
  schedule_change_push_enabled?: boolean
  holiday_notice_push_enabled?: boolean
  /** Mirror legacy (ditulis saat save, dibaca sebagai fallback). */
  pre_check_in_enabled?: boolean
  pre_check_in_minutes?: number
  pre_check_out_enabled?: boolean
  pre_check_out_minutes?: number
  missed_check_in_enabled?: boolean
  missed_check_in_minutes?: number
  missed_check_out_enabled?: boolean
  missed_check_out_minutes?: number
  updated_at?: number
  updated_by?: string
}

export interface NotificationQueueItem {
  id?: string
  uid?: string
  title?: string
  message?: string
  type?: string
  status?: string
  retry_count?: number
  created_at?: number
  scheduled_at?: number
  sent_at?: number
  error?: string
}
