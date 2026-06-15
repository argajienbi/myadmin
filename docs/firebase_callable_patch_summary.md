- Perubahan utama: Perbaikan validasi admin dan validasi target agar sesuai dengan skema company_users dan menampilkan message detail jika cloud function gagal.
- File yang diubah: functions/index.js, src/services/notificationDeliveryService.ts.

## Callable Validation
- assertCompanyAdmin: Ditambahkan pembacaan ke company_users/{companyId}/{uid} sebagai prioritas penentuan role admin.
- assertTargetUserInCompany: Ditambahkan pembacaan berjenjang melintasi company_users/{companyId}/{uid}.
- company_users path: Diadopsi sebagai first-class citizen validasi agar UI dan Callable selaras.
- fallback token subcollection: Tetap dipertahankan untuk memastikan karyawan masih bisa dikenali meski data profilenya terhapus.

## Error Handling
- try/catch callable: Seluruh isi proses dibungkus catch untuk menangkap semua level throw error.
- logger.error: Semua gagal panggil kini tertulis dalam backend logs beserta input request nya.
- frontend error formatter: Memodifikasi delivery service agar meng-extract pesan detail dari response object HttpsError.

## Validation
- npm run build: Valid (Succeeded)
- node -c functions/index.js: Valid (Succeeded)

## Deployment Required
- firebase deploy --only functions: Ya, perbarui fungsi backend mutlak diperlukan.

## Manual Test Notes
- Test Push result: Pengujian sudah bisa langsung dilakukan dari browser tanpa menghadapi INTERNAL kosong.
- Jika gagal, error detail: Menampilkan notifikasi error yang terbaca jelas seperti not-found: Target user X tidak ditemukan.
