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

  auditLogs: (companyId: string) => `audit_logs/${companyId}`,
  auditLog: (companyId: string, logId: string) =>
    `audit_logs/${companyId}/${logId}`,

  notifications: (uid: string) => `notifications/${uid}`,
  notification: (uid: string, notificationId: string) =>
    `notifications/${uid}/${notificationId}`,

  reportCache: (companyId: string) => `report_cache/${companyId}`,
  storageIndex: (companyId: string) => `storage_index/${companyId}`,
};
