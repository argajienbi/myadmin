# Pemetaan MyAdmin lama → template monorepo-vite-nestjs

Template: salinan `~/workspace/rekanara/monorepo-vite-nestjs` di
`~/workspace/myadmin-redesign/` (293 file, identik byte-per-byte,
tanpa `.git`). Web app: `apps/web` — Vite 8 + React 19 +
TanStack Router/Query + shadcn/ui (`packages/ui`) + Tailwind v4.
API: `apps/api` — NestJS 11 + Prisma 6 (Postgres).
Kontrak bersama: `packages/contracts` (zod + katalog permission).

## Prinsip pemetaan (keputusan fondasi)

1. **Template dipakai sebagai shell web + design system + pola admin
   generik.** Seluruh data bisnis myadmin TETAP di Firebase
   (RTDB + Firestore + Auth + Storage, proyek `mypresence-prod`).
   Backend NestJS/Postgres template TIDAK menggantikan Firebase pada
   redesain ini — API `apps/api` tidak dipakai dulu (tetap ada di
   repo, tidak dihapus, tidak dijalankan).
2. **Satu-satunya keputusan arsitektur besar yang masih terbuka:
   Auth.** Template memakai JWT NestJS + refresh cookie + TOTP 2FA;
   myadmin memakai Firebase Auth. Pilihannya: (a) web baru tetap
   Firebase Auth (template auth dilewati), atau (b) migrasi user ke
   NestJS. Keputusan ini di tangan Arga — fondasi TIDAK memilih.
   Dampak pilihan (b): migrasi akun, klaim/role, FCM worker, dan
   rules Firebase — proyek tersendiri, bukan bagian redesain UI.
3. **Multi-company adalah konsep myadmin, bukan template.**
   Template tidak mengenal perusahaan; scoping per-perusahaan
   (`getEffectiveCompanyId`, `companyScope.ts`) harus dibawa utuh.
4. **Pola baca data template adalah TanStack Query + `authedRequest`.**
   Saat porting, baca Firebase dibungkus Query (bukan `onValue`
   mentah di komponen) — pola ini diputuskan saat implementasi,
   bukan di fondasi.

## Yang template sudah sediakan (pakai apa adanya)

| Fitur template | Lokasi | Catatan untuk myadmin |
|---|---|---|
| Layout admin (sidebar + breadcrumb + toggle tema + lonceng notifikasi) | `apps/web/src/routes/admin.tsx`, `components/app-sidebar.tsx`, `components/nav-main.tsx`, `components/notification-bell.tsx` | Gantikan `Layout.tsx` lama. Nav disaring permission (`can()`). |
| Dashboard generik | `routes/admin.dashboard.tsx` | Hanya kartu Role/Permissions/Email + pengumuman — isi dashboard presensi harus di-porting (lihat bawah). |
| Login / lupa password / reset / verifikasi email / terima undangan | `routes/login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `verify-email.tsx`, `accept-invite.tsx`, `features/auth/` | Berlaku bila Auth = NestJS. Bila Auth tetap Firebase, halaman ini diganti login Firebase. |
| Auth + 2FA (TOTP, backup code) + sesi | `lib/auth-context.tsx`, `lib/token-store.ts`, `lib/refresh-session.ts`, `features/auth/components/two-factor-card.tsx` | Sama seperti di atas — terikat pilihan Auth. |
| RBAC fail-closed | `packages/contracts/src/permissions.ts` (`RESOURCES`: users, roles, permissions, audit, settings, announcements, webhooks, apiKeys; `ACTIONS`: manage/view/create/edit/delete), `PermissionGuard`, `useAuth().can()` | Resource myadmin (employees, schedules, attendance, approvals, companies, organization, reports, notifications, database) BELUM ada — harus ditambah ke katalog + seed saat implementasi. |
| Users (CRUD, soft-delete, restore, export CSV/XLSX, import CSV) | `routes/admin.administration.users*.tsx`, `features/admin/api.ts` (`usersApi`) | Pola UI dipakai ulang; datanya myadmin adalah `company_users` Firebase, bukan user NestJS. |
| Roles & permissions | `routes/admin.administration.roles*.tsx`, `permissions.tsx` | Dipakai bila RBAC template dipakai; role myadmin (`owner`/`admin`/`user` + `system_owner`) dipetakan ke role template saat implementasi. |
| Audit log | `routes/admin.administration.audit.tsx`, `auditApi` | UI dipakai ulang; sumber data myadmin adalah RTDB `audit_logs`, bukan `audit_log` Postgres. |
| Announcements | `routes/admin.administration.announcements.tsx`, `announcementsApi` | UI dipakai ulang; sumber data myadmin adalah RTDB + Firestore (lihat bawah). |
| Notifications (in-app) | `routes/admin.notifications.tsx`, `notificationsApi` | Lonceng + daftar notifikasi dipakai; push FCM myadmin tetap lewat jalur lama (Firestore queue + Worker FCM). |
| Settings aplikasi + branding publik | `routes/admin.administration.settings.tsx`, `settingsApi`, `lib/public-settings.ts` | Dipakai untuk branding/login; pengaturan profil+logo perusahaan myadmin adalah fitur terpisah (lihat bawah). |
| System status / maintenance | `routes/admin.administration.system.tsx`, `systemApi` | Bukan pengganti DatabaseHealth myadmin. |
| API keys, webhooks | `routes/admin.administration.api-keys.tsx`, `webhooks.tsx` | Webhook Midtrans template TIDAK dibutuhkan myadmin — jangan di-porting. API keys: hanya bila dibutuhkan nanti. |
| Komponen shadcn | `packages/ui/src/components/` (button, card, table, dialog, sidebar, breadcrumb, select, input, badge, skeleton, sonner, dsb.) | Gantikan komponen lama (`ConfirmModal` → `alert-dialog`, toast → `sonner`). |

## Pemetaan per halaman myadmin

| Halaman lama (route) | Target di template | Status |
|---|---|---|
| Dashboard `/` | `routes/admin.dashboard.tsx` — ganti isi dengan ringkasan presensi | **Porting** — shell ada, isi (statistik + grafik `recharts`) dibawa dari `Dashboard.tsx` + `rtdbLeanService` |
| Login `/login` | `routes/login.tsx` | **Tergantung pilihan Auth** — Firebase Auth = tulis ulang halaman login di atas `signInWithEmailAndPassword`; NestJS = pakai template |
| SetupWizard `/setup` | Route baru, mis. `routes/admin.setup.tsx` (owner only) | **Porting** — tidak ada padanan template (template memakai invite) |
| AdminGuide `/buku-petunjuk` | Route baru, mis. `routes/admin.guide.tsx` | **Porting** — halaman statis, tanpa Firebase |
| Companies `/companies` | Fitur baru `features/companies/` + `routes/admin.companies.tsx` | **Porting** — template tidak punya konsep perusahaan |
| CompanyAdmins `/company-admins` | Bagian dari fitur users/companies | **Porting** — penugasan admin per perusahaan (Firebase) |
| Organization `/organization` | Fitur baru `features/organization/` + `routes/admin.organization.tsx` | **Porting** — butuh `leaflet` + `RadiusMapPicker` dibawa |
| Employees `/employees` | Fitur baru `features/employees/` + `routes/admin.employees.tsx` (pola UI meniru `administration.users`) | **Porting** — data `company_users` + pembuatan akun Auth + mirror Firestore + transfer log |
| Schedules `/schedules` | Fitur baru `features/schedules/` + `routes/admin.schedules.tsx` | **Porting** — halaman terbesar (2.807 baris); bawa `scheduleResolver` + `scheduleDiagnostic` + sinkron Google Calendar |
| Attendance `/attendance` | Fitur baru `features/attendance/` + `routes/admin.attendance.tsx` | **Porting** — bawa `rtdbLeanService` + `rtdbDataGate` |
| AttendanceCorrections `/attendance/corrections` | `routes/admin.attendance.corrections.tsx` | **Porting** |
| Approvals `/approvals` | Fitur baru `features/approvals/` + `routes/admin.approvals.tsx` | **Porting + terapkan `FIX-approvals-2b.md`** (4 baris, dua blok masuk/pulang) |
| Announcements `/announcements` | `routes/admin.administration.announcements.tsx` (UI template) | **Adaptasi** — UI template, sumber data tetap Firebase (RTDB + Firestore); `announcementService` + `announcementTargetResolver` dibawa |
| NotificationSettings `/notification-settings` | Fitur baru (pengaturan FCM perusahaan) | **Porting** — sumber Firestore `notification_settings/main` |
| NotificationLogs `/notification-logs` | Fitur baru `features/notifications/` + `routes/admin.notification-logs.tsx` | **Porting** — tidak ada padanan template (debug FCM myadmin) |
| Reports `/reports` | Fitur baru `features/reports/` + `routes/admin.reports.tsx` | **Porting** — bawa `exportService` (`xlsx`, `jspdf-autotable`) |
| Audit `/audit` | `routes/admin.administration.audit.tsx` (UI template) | **Adaptasi** — UI template, sumber data RTDB `audit_logs` |
| DatabaseHealth `/database-health` | Fitur baru `features/database/` + `routes/admin.database-health.tsx` | **Porting** — tidak ada padanan template |
| Settings `/settings` | `routes/admin.account.tsx` (profil) + fitur logo perusahaan | **Porting sebagian** — profil/password ke `admin.account`; logo + sinkron Firestore dibawa sebagai fitur perusahaan |
| GenericPage | — | **Drop** — placeholder, tidak ada route |

## Yang tetap Firebase (tidak pindah ke Postgres)

- Semua data bisnis: RTDB (`paths.ts` — 30+ path) + Firestore
  (`firestorePaths.ts`) + Storage (foto absensi, logo).
- Firebase Auth (sampai keputusan Auth diputuskan Arga).
- FCM: antre + dedup + log di Firestore, push lewat Worker FCM
  yang sudah ada (`mypresence-fcm-worker`).
- Rules: `rtdb.rules.json`, `firestore.rules`, `storage.rules`
  tetap berlaku — web baru harus lolos rules yang sama.
- Sinkron Google Calendar (`workspaceAuth.ts`).

## Lapisan Firebase baru yang harus dibuat di `apps/web`

(Pekerjaan implementasi, dicatat di sini agar mockup + koding tidak
kehilangan jejak.)

- `apps/web/src/lib/firebase.ts` — port `src/firebase.ts`
  (init app, `auth`/`db`/`storage`/`firestore`, config dari
  `firebase-applet-config.json` + env `VITE_FIREBASE_*`).
- `apps/web/src/lib/firebase-paths.ts` — port `paths.ts` +
  `firestorePaths.ts`.
- `apps/web/src/lib/firebase-types.ts` — port `types.ts`
  (atau masuk `packages/contracts` bila dipakai API juga).
- `apps/web/src/features/<fitur>/firebase-api.ts` per fitur —
  port service terkait (`rtdbLeanService`, `rtdbDataGate`,
  `scheduleResolver`, `scheduleDiagnostic`, `auditService`,
  `notificationService`, `firestoreNotificationService`,
  `notificationDeliveryService`, `announcementService`,
  `announcementTargetResolver`, `firestoreUserMirrorService`,
  `syncFirestoreUsersFromRtdb`, `storageService`,
  `exportService`, `companyScope`).
- `apps/web/src/lib/company-scope.ts` — port `companyScope.ts` +
  `roleAccess.ts` (scoping per-perusahaan + `isOwnerLike`).
- Dependensi yang harus ditambah ke `apps/web`: `firebase`,
  `date-fns`, `recharts`, `jspdf`, `jspdf-autotable`, `xlsx`,
  `leaflet` + `react-leaflet` (bila peta dipertahankan).
  `react-hot-toast` diganti `sonner` (sudah ada di template).
  `react-router-dom` diganti TanStack Router (sudah ada).

## Risiko / blocker (untuk Arga & tim implementasi)

1. **Auth (terbesar).** Firebase Auth vs JWT NestJS belum diputuskan.
   Selama belum diputuskan, halaman login + guard + `useAuth().can()`
   tidak bisa final.
2. **RBAC ganda.** Template punya katalog permission sendiri;
   myadmin punya role `owner/admin/user` + `system_owner`.
   Pemetaan role → permission harus ditulis eksplisit (di
   `packages/contracts/src/permissions.ts` + seed), kalau tidak
   halaman bisa 403 massal (template fail-closed: route tanpa
   `@RequirePermission` → 403).
3. **Data gate RTDB.** Myadmin membatasi baca RTDB
   (`rtdbDataGate`, `rtdbLeanService` + limit rentang tanggal).
   Kalau pola ini tidak dibawa, dashboard/laporan baru bisa membaca
   RTDB tanpa batas (biaya + lambat).
4. **Dua sumber pengumuman & notifikasi.** Pengumuman ada di RTDB
   dan Firestore; log notifikasi tersebar di 5 koleksi Firestore.
   Porting harus mempertahankan kedua sumber sampai migrasi data
   diputuskan — jangan "merapikan" dengan menghapus salah satu.
5. **NestJS API menganggur.** `apps/api` + Postgres tidak dipakai
   pada redesain ini. Jangan hapus — tapi jangan juga dijalankan
   tanpa `.env` + database (akan gagal start). Bila Arga nanti
   memutuskan migrasi Postgres, itu proyek terpisah.
6. **PWA.** Myadmin lama memakai `vite-plugin-pwa`; template web
   tidak punya PWA. Bila PWA dipertahankan, tambahkan saat
   implementasi — bukan fondasi.
