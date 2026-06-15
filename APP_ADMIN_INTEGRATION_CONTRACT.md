# MYPRESENSI App ↔ Admin Web Integration Contract

Dokumen ini menjaga agar perubahan di admin_web tidak memutus app Flutter.

## Prinsip

admin_web adalah pusat konfigurasi.
Flutter app membaca konfigurasi dan data operasional yang dibuat admin_web.

Jangan mengubah path atau nama field utama tanpa patch Flutter.

## Path wajib tetap kompatibel

### User dan karyawan

/users/{uid}
/company_users/{company_id}/{uid}

Field penting:
- uid
- company_id
- nama_lengkap
- email
- nip
- no_hp
- photo_url
- photo_path
- status_akun
- role
- position
- office_id
- department_id
- sub_department_id
- group_id
- qr_token
- qr_active

### Organisasi

/companies/{company_id}
/areas/{company_id}
/offices/{company_id}
/departments/{company_id}
/sub_departments/{company_id}
/employee_groups/{company_id}

Field kantor yang wajib kompatibel:
- name
- address
- latitude
- longitude
- radius_meter
- active

### Jadwal kerja

/timetables/{company_id}
/shifts/{company_id}
/schedule_assignments/{company_id}
/holidays/{company_id}
/schedule_specials/{company_id}

Field timetable wajib:
- name
- work_start
- work_end
- check_in_start
- check_in_end
- check_out_start
- check_out_end
- late_tolerance_minute
- early_out_tolerance_minute
- crosses_midnight
- active

Field shift wajib:
- name
- active
- days.sunday.active
- days.sunday.timetable_id
- days.monday.active
- days.monday.timetable_id
- days.tuesday.active
- days.tuesday.timetable_id
- days.wednesday.active
- days.wednesday.timetable_id
- days.thursday.active
- days.thursday.timetable_id
- days.friday.active
- days.friday.timetable_id
- days.saturday.active
- days.saturday.timetable_id

Day key wajib bahasa Inggris:
- sunday
- monday
- tuesday
- wednesday
- thursday
- friday
- saturday

Field schedule assignment wajib:
- type: user | group
- target_id
- shift_id
- start_date
- end_date
- active

Field holiday wajib:
- date
- title
- active

Field schedule special wajib:
- date
- title
- type: user | group
- target_id
- shift_id
- active

### Presensi

/attendance/{company_id}/{uid}/{date}/{action_type}

Field yang harus dipertahankan:
- company_id
- uid
- date
- tanggal
- time
- waktu
- action_type
- attendance_status
- status
- validation_status
- office_id
- department_id
- sub_department_id
- group_id
- shift_id
- shift_name
- timetable_id
- timetable_name
- schedule_source
- latitude
- longitude
- distance_meter
- geofence_status
- photo_url
- photo_path
- created_at
- source

### Izin dan approval

/leave_requests/{company_id}
/qr_attendance_requests/{company_id}
/attendance_corrections/{company_id}

Status pending harus tetap dikenali:
- pending
- pending_admin

Status approved harus tetap dikenali:
- approved
- success

Status rejected harus tetap dikenali:
- rejected
- ditolak

### Notifikasi

/notifications/{uid}

Field wajib:
- title
- message
- body
- type
- ref_type
- ref_id
- related_id
- read
- is_read
- created_date
- created_time
- created_at

### Reminder Absen Statusbar

Path konfigurasi:
- /companies/{company_id}/notification_settings/main

Field konfigurasi utama:
- attendance_reminder_enabled
- reminder_check_in_pre_enabled
- reminder_check_in_now_enabled
- reminder_check_in_late_enabled
- reminder_check_out_pre_enabled
- reminder_check_out_now_enabled
- reminder_check_out_late_enabled
- reminder_check_in_pre_minutes
- reminder_check_in_now_window_minutes
- reminder_check_in_late_minutes
- reminder_check_out_pre_minutes
- reminder_check_out_now_window_minutes
- reminder_check_out_late_minutes
- reminder_scheduler_catchup_minutes

Field legacy tetap ditulis:
- pre_check_in_enabled
- pre_check_in_minutes
- missed_check_in_enabled
- missed_check_in_minutes
- pre_check_out_enabled
- pre_check_out_minutes
- missed_check_out_enabled
- missed_check_out_minutes

Flutter wajib fallback aman jika path konfigurasi belum ada.

## Aturan perubahan

Jika admin_web menambah field baru:
- aman selama tidak menghapus field lama.

Jika admin_web mengganti nama field:
- wajib patch Flutter di service terkait.

Jika admin_web mengganti path:
- wajib patch Flutter dan rules.

Jika admin_web mengubah status enum:
- wajib update mapper di Flutter dan admin_web.

Jika admin_web membuat fitur baru:
- pastikan Flutter tidak crash saat field baru belum ada.

## Checklist sebelum publish admin_web

- npm run build berhasil.
- Tidak ada perubahan path utama tanpa patch Flutter.
- Field lama tetap ditulis.
- Record lama tetap dibaca.
- Flutter app masih bisa:
  - login
  - membaca session
  - membaca jadwal
  - membaca radius kantor
  - melakukan presensi
  - membaca notifikasi
  - membaca riwayat

## Firestore Feature Layer

Firestore digunakan untuk fitur baru:
- announcements
- notification_inbox
- notification_queue
- notification_logs
- notification_settings
- notification_dedup
- fcm_tokens

Path:
- companies/{companyId}/announcements/{announcementId}
- companies/{companyId}/users/{uid}/notification_inbox/{notificationId}
- companies/{companyId}/users/{uid}/fcm_tokens/{tokenId}
- companies/{companyId}/notification_queue/{queueId}
- companies/{companyId}/notification_logs/{logId}
- companies/{companyId}/notification_settings/main
- companies/{companyId}/notification_dedup/{dedupId}

Flutter app wajib:
- membaca notification_inbox
- fallback membaca RTDB /notifications/{uid}
- membaca announcements
- menyimpan fcm_tokens

### Aturan Timing Reminder Scheduler

Scheduler Cloud Functions wajib memilih stage reminder berdasarkan setting admin:
- pre: hanya sebelum anchor jam masuk/pulang
- now: mulai anchor sesuai now window
- late: setelah anchor + late minutes

Jika scheduler terlambat berjalan dan waktu sekarang sudah mencapai anchor, stage pre tidak boleh dikirim. Scheduler harus memilih now/late atau skip.

Stage valid:
- check_in/pre
- check_in/now
- check_in/late
- check_out/pre
- check_out/now
- check_out/late

Stage `after` tidak digunakan lagi.
