# Inventaris MyAdmin lama

Sumber kebenaran: repo publik `argajienbi/myadmin`, branch `main`,
HEAD `31e4b9b28a5bbb48f890c2ffbd0aa097f1969528`
("fix(fcm): hapus sisa Cloud Function di NotificationLogs.tsx",
18 Okt 2026 21:28 WIB).
Dibaca dari clone segar `~/workspace/myadmin-source-main/` — HEAD clone
identik dengan HEAD live main (dicek via konektor GitHub, 27 Okt 2026).
Salinan lama `~/workspace/review-mypresence/myadmin` TIDAK dipakai.

Stack lama: Vite 6 + React 19 + react-router-dom 7 + Tailwind 4,
`firebase` ^12.13.0 (Auth + RTDB + Firestore + Storage),
`react-hot-toast`, `lucide-react`, `date-fns`, `recharts`, `jspdf`,
`xlsx`, `leaflet`/`react-leaflet`, `vite-plugin-pwa`.
Total `src/`: 21.225 baris (20 file halaman, 17 service, 5 komponen).

Firebase yang dipakai: proyek **mypresence-prod**,
RTDB `mypresence-prod-default-rtdb.asia-southeast1.firebasedatabase.app`,
Auth `mypresence-prod.firebaseapp.com`.
Konfigurasi dari `firebase-applet-config.json` (client config publik),
fallback env `VITE_FIREBASE_*` — lihat `src/firebase.ts`.

Peran: `UserRole = "owner" | "admin" | "user"`, plus flag
`is_owner` / `is_system_owner` (bootstrap owner) — lihat
`src/utils/roleAccess.ts`, `src/auth/AuthContext.tsx`.
Posisi karyawan: MANAGER, ADMIN, SPV, LEADER, CREW, USER, OWNER.

## Halaman (19 route + 1 placeholder)

| Route | File (baris) | Tujuan | Sumber data Firebase |
|---|---|---|---|
| `/login` | Login.tsx (278) | Login email+password, reset password | Firebase Auth (`signInWithEmailAndPassword`, `sendPasswordResetEmail`); baca `users/{uid}` untuk role/company |
| `/` | Dashboard.tsx (917) | Dashboard Presensi: ringkasan hari ini, absensi terbaru, grafik | RTDB via `rtdbLeanService` (`loadDashboardSummary`, `loadRecentAttendance`, `loadAttendanceByDateRange`); `dashboard_summary/{company}/{date}`, `attendance_recent/{company}`, `attendance_by_date/{company}/{date}`; baca dibatasi `rtdbDataGate` (`manualGet`) |
| `/setup` | SetupWizard.tsx (343) | Setup awal / bootstrap owner | RTDB `companies`, `users`, `company_users` |
| `/buku-petunjuk` | AdminGuide.tsx (655) | Buku petunjuk admin (statis) | Tidak ada Firebase (hanya `useAuth` + `isOwnerLike` untuk konten kondisional) |
| `/companies` | Companies.tsx (1041) | CRUD perusahaan + undangan (`company_invites`) + logo | RTDB `companies`, `company_invites`; Storage untuk logo perusahaan; `writeAuditLog` |
| `/company-admins` | CompanyAdmins.tsx (325) | Kelola admin perusahaan (owner saja) | RTDB `companies`, `users`; `mirrorUserToFirestore` |
| `/organization` | Organization.tsx (1309) | Struktur org: area → kantor (lat/lon + radius) → departemen → sub-departemen → grup karyawan | RTDB `areas`, `offices`, `departments`, `sub_departments`, `employee_groups`; komponen `RadiusMapPicker` (Leaflet) |
| `/employees` | Employees.tsx (1573) | CRUD karyawan + buat akun Auth + transfer antar unit | RTDB `company_users/{company}`, `users`; Firebase Auth (buat user via secondary app `createUserWithEmailAndPassword`); `mirrorUserToFirestore`; `createNotification`; `writeAuditLog`; `employee_transfer_logs` |
| `/schedules` | Schedules.tsx (2807) | Jam kerja & penjadwalan: timetable, shift 7 hari, penugasan grup/perorangan, libur, jadwal khusus, lembur, log perubahan; sinkron Google Calendar | RTDB `timetables`, `shifts`, `schedule_assignments`, `holidays`, `schedule_specials`, `overtime_schedules`, `schedule_change_logs`; `getGoogleCalendarAccessToken` (`auth/workspaceAuth.ts`) |
| `/attendance` | Attendance.tsx (559) | Daftar absensi per rentang tanggal + foto | RTDB `attendance_by_date` via `rtdbLeanService.loadAttendanceByDateRange`; foto via `storageService.getFileUrl` |
| `/attendance/corrections` | AttendanceCorrections.tsx (495) | Ajukan/lihat koreksi absensi | RTDB `attendance_corrections` (baca `onValue`, tulis `push`/`update`) |
| `/approvals` | Approvals.tsx (1411) | Persetujuan 3 tab: Izin/Cuti/Sakit/Lembur, QR, Koreksi Presensi; approve/reject menulis record absensi | RTDB `leave_requests`, `qr_attendance_requests`, `attendance_corrections` (baca `onValue`); tulis `attendance/{company}/{uid}/{date}/{masuk\|pulang}` via `update()`; `resolveScheduleForUser`; `createNotification`; `writeAuditLog`; `getFileUrl`. **Mengandung bug 2b — lihat `FIX-approvals-2b.md`.** |
| `/announcements` | Announcements.tsx (582) | CRUD + publish/archive pengumuman, target per perusahaan/grup | RTDB `announcements/{company}` + Firestore `companies/{id}/announcements` (ganda); `announcementTargetResolver` |
| `/notification-settings` | NotificationSettings.tsx (376) | Pengaturan notifikasi (owner saja) | RTDB (pengaturan perusahaan); Firestore `companies/{id}/notification_settings/main` |
| `/notification-logs` | NotificationLogs.tsx (1889) | Pusat Debug & Monitoring Notifikasi / FCM (owner saja) | RTDB + Firestore `companies/{id}/notification_logs`, `notification_queue`, `notification_dedup`, `announcement_delivery_logs`; `companies/{id}/users/{uid}/fcm_tokens`, `notification_inbox` |
| `/reports` | Reports.tsx (809) | Laporan absensi + export Excel/PDF | RTDB `attendance_by_date` via `rtdbLeanService`; `exportService` (`exportToExcel`, `exportToPdf` — `xlsx`, `jspdf-autotable`); `writeAuditLog` |
| `/audit` | Audit.tsx (171) | Audit log (owner saja) | RTDB `audit_logs/{company}` (`onValue`) |
| `/database-health` | DatabaseHealth.tsx (995) | Kesehatan database: cek RTDB+Firestore, orphan, bersih-bersih (owner saja) | RTDB + Firestore (`collection`/`getDocs`/`writeBatch`); `storage_index` |
| `/settings` | Settings.tsx (661) | Pengaturan profil + ganti password + logo perusahaan + sinkron user Firestore | Firebase Auth `updatePassword`; RTDB perusahaan; Storage logo (`companyBranding`); `syncFirestoreUsersFromRtdb` |
| — | GenericPage.tsx (12) | Placeholder "sedang dalam pengembangan" | Tidak dipakai route mana pun (tidak ada di `App.tsx`) — **drop saat rebuild** |

Menu sidebar (`src/components/Layout.tsx`): Dashboard, Karyawan,
Jadwal Kerja, Absensi, Koreksi Absensi, Persetujuan, Pengaturan
Notifikasi, Laporan, Pengaturan Profil.

## Layanan (`src/services/`)

| File | Fungsi |
|---|---|
| `paths.ts` (124) | Seluruh path RTDB: `users`, `companies`, `company_invites`, `company_users`, `areas`, `offices`, `departments`, `sub_departments`, `employee_groups`, `timetables`, `shifts`, `schedule_assignments`, `holidays`, `schedule_specials`, `schedule_change_logs`, `overtime_schedules`, `attendance`, `attendance_by_date`, `attendance_recent`, `dashboard_summary`, `pending_approval_summary`, `leave_requests`, `qr_attendance_requests`, `attendance_corrections`, `announcements`, `audit_logs`, `employee_transfer_logs`, `notifications`, `report_cache`, `storage_index`, `app_config` |
| `firestorePaths.ts` (49) | Path Firestore: `companies/{id}/announcements`, `notification_settings/main`, `notification_queue`, `notification_logs`, `notification_dedup`, `announcement_delivery_logs`, `users/{uid}/notification_inbox`, `users/{uid}/fcm_tokens`, `dashboard_daily_summary/{date}`, `report_cache/{month}` |
| `rtdbLeanService.ts` (146) | Baca hemat RTDB: `loadAttendanceByDateRange`, `loadRecentAttendance`, `loadDashboardSummary`, `assertSafeDateRange`, `buildDateRange` (batas rentang + limit) |
| `rtdbDataGate.ts` (122) | Pembatas baca RTDB: `manualGet`, `manualListen`, `makeGateId`, `isGateOpen`, `closeGate(s)` |
| `scheduleResolver.ts` (345) | `resolveScheduleForUser` — jadwal efektif seorang karyawan (penugasan grup/perorangan, libur, jadwal khusus) |
| `scheduleDiagnostic.ts` (323) | `diagnoseEmployeeSchedule` — diagnosa kenapa jadwal tidak ketemu |
| `auditService.ts` (30) | `writeAuditLog` → RTDB `audit_logs/{company}` |
| `notificationService.ts` (70) | `createNotification` → RTDB `notifications/{uid}` |
| `firestoreNotificationService.ts` (166) | Notifikasi Firestore: `createUserNotification`, `createNotificationQueue`, `createNotificationForUser(s)`, `writeNotificationLog` |
| `notificationDeliveryService.ts` (114) | `createUserNotificationAndPush` — notifikasi + push FCM (antre + dedup) |
| `announcementService.ts` (184) | `createAnnouncement`, `updateAnnouncement`, `publishAnnouncement`, `archiveAnnouncement`, `restoreAnnouncement` |
| `announcementTargetResolver.ts` (80) | `resolveAnnouncementTargetUids` — siapa penerima pengumuman |
| `firestoreUserMirrorService.ts` (70) | `mirrorUserToFirestore` — cermin `users` RTDB → Firestore |
| `syncFirestoreUsersFromRtdb.ts` (73) | `syncFirestoreUsersFromRtdb` — sinkron massal |
| `storageService.ts` (15) | `getFileUrl` — URL unduh Storage |
| `exportService.ts` (29) | `exportToExcel`, `exportToPdf` |
| `companyScope.ts` (41) | `isOwnerRole`, `isAdminRole`, `getEffectiveCompanyId`, `assertCompanyAccess` |
| `paths.ts` / `firestorePaths.ts` | (di atas) |

## Auth, komponen, hooks, util, tipe

- `src/auth/AuthContext.tsx` (164): `AuthProvider`, `useAuth` —
  `onAuthStateChanged`, muat `users/{uid}` + `company_users`, bootstrap
  owner bila belum ada. `ProtectedRoute.tsx` (107): guard
  `allowedRoles` per route. `workspaceAuth.ts` (19): token Google
  Calendar (OAuth).
- `src/components/`: `Layout.tsx` (424, sidebar + header + menu),
  `ConfirmModal.tsx` (63), `DataGatePanel.tsx` (58, indikator gate
  baca RTDB), `RadiusMapPicker.tsx` (331, Leaflet),
  `SetupProgress.tsx` (116).
- `src/hooks/`: `useTheme.ts` (26, dark mode), `useTechnicalIds.ts`
  (15, tampil/sembunyi ID teknis).
- `src/utils/`: `roleAccess.ts` (24), `safeDisplay.ts` (91, nama +
  mask ID), `displayLabels.ts` (40), `companyBranding.ts` (36),
  `companyWebsite.ts` (43), `textNormalize.ts` (10).
- `src/types.ts` (271): `UserRole`, `Position`, `AccountStatus`,
  `AttendanceAction` (`masuk`/`pulang`/`lembur_masuk`/`lembur_pulang`),
  `AttendanceMethod`, `AttendanceStatus`, `RequestStatus`,
  `ScheduleSource`, `UserIndex`, `CompanyUser`, `EmployeeTransferLog`,
  `Company`, `CompanyInvite`, `Area`, `Office`, `Department`,
  `SubDepartment`, `EmployeeGroup`, `Timetable`, `ShiftDay`, `Shift`,
  `ScheduleAssignment`.
- `src/main.tsx` (27), `src/index.css`, `src/ErrorBoundary.tsx` (43).
- `scripts/`: `setCustomClaims.mjs` (pakai `firebase-admin`, dev only),
  `backfillAttendanceByDate.mjs`.
- `firebase.json`, `firestore.rules`, `rtdb.rules.json`,
  `storage.rules`, `.firebaserc`, `firebase-applet-config.json`.
