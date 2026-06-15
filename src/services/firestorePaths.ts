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
