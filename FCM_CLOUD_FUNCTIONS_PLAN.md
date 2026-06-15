# FCM Cloud Functions Plan

admin_web hanya membuat notification_queue.
Pengiriman FCM dilakukan oleh Cloud Functions/backend dengan Firebase Admin SDK.

Function yang dibutuhkan:
1. onNotificationQueueCreated
2. scheduledAttendanceReminder
3. scheduledAnnouncementPublisher
4. cleanupInvalidFcmTokens

Queue path:
companies/{companyId}/notification_queue/{queueId}

Token path:
companies/{companyId}/users/{uid}/fcm_tokens/{tokenId}

Flow:
1. Queue pending dibuat.
2. Function ambil uid dan token aktif.
3. Kirim FCM.
4. Update queue sent/failed.
5. Tulis notification_logs.
6. Nonaktifkan token invalid.
