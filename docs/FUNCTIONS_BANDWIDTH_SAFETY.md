# Functions Bandwidth Safety

## Tujuan

Backend Cloud Functions tidak boleh membaca root besar RTDB secara otomatis.

## Node yang Dilarang Dibaca Otomatis

- `attendance/{companyId}`
- `leave_requests/{companyId}`
- `qr_attendance_requests/{companyId}`
- `audit_logs/{companyId}`

## Scheduler Reminder

`scheduledAttendanceReminder` default aman.

Scheduler hanya berjalan jika:

```json
{
  "system_config": {
    "attendance_reminder_scheduler": {
      "enabled": true,
      "target_companies": {
        "COMPANY_ID": true
      }
    }
  }
}
```

Jika config tidak ada, scheduler tidak memproses company apa pun.

## Leave Index

Scheduler tidak membaca `leave_requests/{companyId}`.

Scheduler membaca:

```text
approved_leave_by_date/{companyId}/{date}
```

Index ini dibuat oleh:

```text
syncApprovedLeaveByDate
```

Untuk data lama, gunakan callable manual:

```text
rebuildApprovedLeaveByDateCallable
```

Callable wajib memakai range tanggal maksimal 31 hari.

## Prinsip

Lebih baik reminder tidak terkirim sementara daripada function membaca seluruh database tiap menit dan membuat billing bengkak.
