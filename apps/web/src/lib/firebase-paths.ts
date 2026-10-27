// Port of myadmin lama: src/services/paths.ts + src/services/firestorePaths.ts
// (repo argajienbi/myadmin, main HEAD 31e4b9b). Isi disalin verbatim;
// halaman dan layanan baru memakai paths / firestorePaths dari sini.

export const paths = {
  appConfig: () => "app_config",

  userIndex: (uid: string) => `users/${uid}`,
  users: () => "users",

  companies: () => "companies",
  company: (companyId: string) => `companies/${companyId}`,

  companyInvites: () => "company_invites",
  companyInvite: (code: string) => `company_invites/${code}`,

  companyUsers: (companyId: string) => `company_users/${companyId}`,
  companyUser: (companyId: string, uid: string) =>
    `company_users/${companyId}/${uid}`,

  areas: (companyId: string) => `areas/${companyId}`,
  area: (companyId: string, areaId: string) =>
    `areas/${companyId}/${areaId}`,

  offices: (companyId: string) => `offices/${companyId}`,
  office: (companyId: string, officeId: string) =>
    `offices/${companyId}/${officeId}`,

  departments: (companyId: string) => `departments/${companyId}`,
  department: (companyId: string, departmentId: string) =>
    `departments/${companyId}/${departmentId}`,

  subDepartments: (companyId: string) => `sub_departments/${companyId}`,
  subDepartment: (companyId: string, subDepartmentId: string) =>
    `sub_departments/${companyId}/${subDepartmentId}`,

  employeeGroups: (companyId: string) => `employee_groups/${companyId}`,
  employeeGroup: (companyId: string, groupId: string) =>
    `employee_groups/${companyId}/${groupId}`,

  timetables: (companyId: string) => `timetables/${companyId}`,
  timetable: (companyId: string, timetableId: string) =>
    `timetables/${companyId}/${timetableId}`,

  shifts: (companyId: string) => `shifts/${companyId}`,
  shift: (companyId: string, shiftId: string) =>
    `shifts/${companyId}/${shiftId}`,

  scheduleAssignments: (companyId: string) =>
    `schedule_assignments/${companyId}`,
  scheduleAssignment: (companyId: string, assignmentId: string) =>
    `schedule_assignments/${companyId}/${assignmentId}`,

  holidays: (companyId: string) => `holidays/${companyId}`,
  holiday: (companyId: string, date: string) =>
    `holidays/${companyId}/${date}`,

  scheduleSpecials: (companyId: string) => `schedule_specials/${companyId}`,
  scheduleSpecial: (companyId: string, specialId: string) =>
    `schedule_specials/${companyId}/${specialId}`,

  scheduleChangeLogs: (companyId: string) =>
    `schedule_change_logs/${companyId}`,
  scheduleChangeLog: (companyId: string, logId: string) =>
    `schedule_change_logs/${companyId}/${logId}`,

  overtimeSchedules: (companyId: string) => `overtime_schedules/${companyId}`,
  overtimeSchedule: (companyId: string, scheduleId: string) =>
    `overtime_schedules/${companyId}/${scheduleId}`,

  attendanceRoot: (companyId: string) => `attendance/${companyId}`,
  attendanceUser: (companyId: string, uid: string) =>
    `attendance/${companyId}/${uid}`,
  attendanceRecord: (
    companyId: string,
    uid: string,
    date: string,
    actionType: string
  ) => `attendance/${companyId}/${uid}/${date}/${actionType}`,

  attendanceByDate: (companyId: string, date: string) =>
    `attendance_by_date/${companyId}/${date}`,

  attendanceRecent: (companyId: string) =>
    `attendance_recent/${companyId}`,

  dashboardSummary: (companyId: string, date: string) =>
    `dashboard_summary/${companyId}/${date}`,

  dashboardSummaryRoot: (companyId: string) =>
    `dashboard_summary/${companyId}`,

  pendingApprovalSummary: (companyId: string) =>
    `pending_approval_summary/${companyId}`,

  leaveRequests: (companyId: string) => `leave_requests/${companyId}`,
  leaveRequest: (companyId: string, requestId: string) =>
    `leave_requests/${companyId}/${requestId}`,

  qrRequests: (companyId: string) => `qr_attendance_requests/${companyId}`,
  qrRequest: (companyId: string, requestId: string) =>
    `qr_attendance_requests/${companyId}/${requestId}`,

  attendanceCorrections: (companyId: string) =>
    `attendance_corrections/${companyId}`,
  attendanceCorrection: (companyId: string, correctionId: string) =>
    `attendance_corrections/${companyId}/${correctionId}`,

  announcements: (companyId: string) => `announcements/${companyId}`,
  announcement: (companyId: string, announcementId: string) =>
    `announcements/${companyId}/${announcementId}`,

  // KOREKSI vs paths.ts lama: data pengumuman live ada di
  // `companies/{id}/announcements` (dibaca/ditulis Announcements.tsx dan
  // announcementService.ts lama), BUKAN di root `announcements/{id}`
  // (hanya dipakai scan DatabaseHealth lama — bug laten). Pakai
  // companyAnnouncements/companyAnnouncement untuk semua akses.
  companyAnnouncements: (companyId: string) =>
    `companies/${companyId}/announcements`,
  companyAnnouncement: (companyId: string, announcementId: string) =>
    `companies/${companyId}/announcements/${announcementId}`,

  auditLogs: (companyId: string) => `audit_logs/${companyId}`,
  auditLog: (companyId: string, logId: string) =>
    `audit_logs/${companyId}/${logId}`,

  employeeTransferLogs: (companyId: string) =>
    `employee_transfer_logs/${companyId}`,
  employeeTransferLog: (companyId: string, transferId: string) =>
    `employee_transfer_logs/${companyId}/${transferId}`,

  notifications: (uid: string) => `notifications/${uid}`,
  notification: (uid: string, notificationId: string) =>
    `notifications/${uid}/${notificationId}`,

  // Node notifikasi di bawah perusahaan (dipakai notificationDeliveryService
  // dan firestoreNotificationService lama; nama firestorePaths-nya sama,
  // tapi node ini di RTDB).
  notificationInbox: (companyId: string, uid: string) =>
    `companies/${companyId}/users/${uid}/notification_inbox`,
  notificationQueue: (companyId: string) =>
    `companies/${companyId}/notification_queue`,
  notificationQueueItem: (companyId: string, queueId: string) =>
    `companies/${companyId}/notification_queue/${queueId}`,
  notificationLogs: (companyId: string) =>
    `companies/${companyId}/notification_logs`,
  notificationLog: (companyId: string, logId: string) =>
    `companies/${companyId}/notification_logs/${logId}`,
  announcementDeliveryLogs: (companyId: string) =>
    `companies/${companyId}/announcement_delivery_logs`,
  announcementDeliveryLog: (companyId: string, logId: string) =>
    `companies/${companyId}/announcement_delivery_logs/${logId}`,
  attendanceReminderSchedulerLogs: (companyId: string) =>
    `companies/${companyId}/attendance_reminder_scheduler_logs`,

  reportCache: (companyId: string) => `report_cache/${companyId}`,
  storageIndex: (companyId: string) => `storage_index/${companyId}`,
};

export const firestorePaths = {
  company: (companyId: string) => `companies/${companyId}`,

  announcements: (companyId: string) =>
    `companies/${companyId}/announcements`,
  announcement: (companyId: string, announcementId: string) =>
    `companies/${companyId}/announcements/${announcementId}`,

  notificationSettings: (companyId: string) =>
    `companies/${companyId}/notification_settings/main`,

  notificationQueue: (companyId: string) =>
    `companies/${companyId}/notification_queue`,
  notificationQueueItem: (companyId: string, queueId: string) =>
    `companies/${companyId}/notification_queue/${queueId}`,

  notificationLogs: (companyId: string) =>
    `companies/${companyId}/notification_logs`,
  notificationLog: (companyId: string, logId: string) =>
    `companies/${companyId}/notification_logs/${logId}`,

  notificationDedup: (companyId: string) =>
    `companies/${companyId}/notification_dedup`,
  notificationDedupItem: (companyId: string, dedupId: string) =>
    `companies/${companyId}/notification_dedup/${dedupId}`,

  announcementDeliveryLogs: (companyId: string) =>
    `companies/${companyId}/announcement_delivery_logs`,
  announcementDeliveryLog: (companyId: string, logId: string) =>
    `companies/${companyId}/announcement_delivery_logs/${logId}`,

  userNotificationInbox: (companyId: string, uid: string) =>
    `companies/${companyId}/users/${uid}/notification_inbox`,
  userNotificationItem: (
    companyId: string,
    uid: string,
    notificationId: string
  ) => `companies/${companyId}/users/${uid}/notification_inbox/${notificationId}`,

  userFcmTokens: (companyId: string, uid: string) =>
    `companies/${companyId}/users/${uid}/fcm_tokens`,
  userFcmToken: (companyId: string, uid: string, tokenId: string) =>
    `companies/${companyId}/users/${uid}/fcm_tokens/${tokenId}`,

  dashboardDailySummary: (companyId: string, date: string) =>
    `companies/${companyId}/dashboard_daily_summary/${date}`,
  reportCache: (companyId: string, month: string) =>
    `companies/${companyId}/report_cache/${month}`,
};
