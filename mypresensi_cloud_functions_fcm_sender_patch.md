# mypresensi_cloud_functions_fcm_sender_patch.md

Target implementation: Cloud Functions FCM sender
Tujuan patch:
- Firebase Functions setup
- Firebase Admin SDK
- trigger `companies/{companyId}/notification_queue/{queueId}`
- ambil `fcm_tokens`
- kirim FCM
- update queue sent/failed
- disable invalid token
