# RTDB Bandwidth Safety Guide

## Tujuan

Dokumen ini mencegah admin web kembali membaca node besar Firebase Realtime Database yang bisa menyebabkan tagihan `Outgoing Bandwidth` naik.

## Node yang Tidak Boleh Dibaca Otomatis dari Browser

Jangan auto-load, jangan realtime-listen, dan jangan filter di frontend dari node berikut:

- `attendance/{companyId}`
- `leave_requests/{companyId}`
- `qr_attendance_requests/{companyId}`
- `audit_logs/{companyId}`
- `storage_index/{companyId}` jika ukurannya sudah besar

Node tersebut hanya boleh dibaca lewat mode legacy/manual dengan warning jelas.

## Node Hemat yang Disarankan

Gunakan node berikut untuk UI admin:

- `attendance_by_date/{companyId}/{date}`
- `attendance_recent/{companyId}`
- `dashboard_summary/{companyId}/{date}`
- `pending_approval_summary/{companyId}`

## Aturan Halaman

### Dashboard

Dashboard boleh auto-load data kecil:

- company list
- metadata ringan
- `dashboard_summary/{companyId}/{date}`
- `attendance_recent/{companyId}` limit kecil
- `pending_approval_summary/{companyId}`

Dashboard tidak boleh membaca:

- `attendance/{companyId}`
- `leave_requests/{companyId}`
- `qr_attendance_requests/{companyId}`

### Attendance

Attendance wajib menggunakan tombol `Ambil Data`.

Default range:

- hari ini sampai hari ini

Maksimal range normal:

- 31 hari

Attendance harus membaca:

- `attendance_by_date/{companyId}/{date}`

Attendance tidak boleh membaca:

- `attendance/{companyId}`

### Reports

Reports wajib menggunakan tombol `Ambil Data`.

Export harus disabled sebelum data diambil.

Reports harus membaca:

- `attendance_by_date/{companyId}/{date}`

Legacy Load hanya boleh untuk owner dan harus diberi warning jelas.

## Checklist Sebelum Merge

Cari string berikut:

```text
onValue(
paths.attendanceRoot(
get(ref(db, paths.attendanceRoot
onValue(ref(db, paths.leaveRequests
onValue(ref(db, paths.qrRequests
```

Syarat aman:

- Tidak ada `onValue()` untuk node besar.
- Dashboard tidak membaca attendance root.
- Dashboard tidak realtime-listen leave root.
- Attendance tidak membaca attendance root.
- Reports normal mode tidak membaca attendance root.
- Legacy mode owner-only dan double confirmation.
- `npm run build` berhasil.

## Backfill

Untuk membuat index hemat dari data lama:

```bash
npm run backfill:attendance-index -- --companyId=COMPANY_ID --dryRun
```

Jika dry run benar:

```bash
npm run backfill:attendance-index -- --companyId=COMPANY_ID --startDate=YYYY-MM-DD --endDate=YYYY-MM-DD
```

Jangan menjalankan backfill tanpa range tanggal jika data sangat besar.

## Prinsip

Lebih baik admin menekan tombol `Ambil Data` setelah memilih tanggal daripada browser membaca seluruh database secara otomatis.

Database kecil yang dibaca berkali-kali tetap bisa menjadi bandwidth besar.
