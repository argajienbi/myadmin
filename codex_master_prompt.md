# CODEX MASTER PROMPT — MYPRESENSI Web Admin

Target repo: `argajienbi/admin`.

Build a clean web admin from scratch. Do not reuse the old AI Studio implementation from `argajienbi/web_admin`.

## Stack
- React + Vite + TypeScript
- Firebase Auth
- Firebase Realtime Database
- Firebase Storage
- Plain CSS or simple component CSS. Avoid unnecessary UI framework complexity.
- `npm run build` must pass.

## Firebase
Use the same Firebase project as the Sketchware Android app:
- Project ID: `inventory-410f4`
- Project Number: `112547967654`
- RTDB: `https://inventory-410f4-default-rtdb.asia-southeast1.firebasedatabase.app`
- Storage: `inventory-410f4.firebasestorage.app`
- Auth Domain: `inventory-410f4.firebaseapp.com`

Use `.env`, not hardcoded config.

## Non-negotiable rules
1. `/users/{uid}` is only a global login index.
2. Full employee data is in `/company_users/{company_id}/{uid}`.
3. All operational data is scoped by `company_id`.
4. Role values are only `owner`, `admin`, `user`.
5. Position values are `MANAGER`, `ADMIN`, `SPV`, `LEADER`, `CREW`, `USER`.
6. `owner` sees all companies.
7. `admin` sees only their own `company_id`.
8. `user` is mobile-only and must be blocked from web admin.
9. Never show a blank screen. Every page must handle loading, empty, error, no-company, and permission states.
10. No mock dashboard data. Use real Firebase reads, otherwise show empty state.
11. Employee Directory must read `/company_users/{company_id}`.

## Required modules
Owner:
- Login
- Owner Dashboard
- Companies
- Admin PT
- Company invite code
- Audit global

Admin PT:
- Dashboard
- Area
- Office with geofence
- Department
- Sub Department
- Employee Group
- Employees
- Pending User Activation
- Timetable / Jam Kerja
- Shift
- Schedule Assignment
- Holiday
- Special Schedule
- Leave Approval
- QR Approval
- Attendance Correction
- Attendance/Reports
- Notifications

## Required schedule menu
```text
Jadwal Kerja
├── Jam Kerja / Timetable
├── Shift
├── Pengaturan Jadwal
├── Kalender Libur
├── Jadwal Khusus
└── Riwayat Perubahan Jadwal
```

## Auth flow
```text
Firebase Auth login
→ read /users/{uid}
→ if missing: logout/block "Akun belum terdaftar"
→ if status_akun != active: block
→ if role == user: block from web admin
→ if owner: owner dashboard
→ if admin: admin dashboard scoped to company_id
```

Read all docs in `/docs` before coding.
