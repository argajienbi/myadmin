# FIX bug 2b — lampiran koreksi menimpa foto absensi (Approvals)

Status: **DOKUMEN PATCH — belum diterapkan ke repo mana pun.**
Dibawa ke fitur Approvals hasil rebuild (lihat `MAPPING.md`).
JANGAN apply ke repo lama, JANGAN push apa pun.

## Bukti (terverifikasi 27 Okt 2026)

Sumber: `argajienbi/myadmin` branch `main`, HEAD
`31e4b9b28a5bbb48f890c2ffbd0aa097f1969528`,
file `src/pages/Approvals.tsx` (1.411 baris).
Diverifikasi pada clone segar `~/workspace/myadmin-source-main/`
(HEAD clone = HEAD live main).

`grep -rn "correction_attachment" src/` → **0 hasil**: field
perbaikan belum ada di repo mana pun. Fix dari sesi vscode.dev
19–20 Okt 2026 tidak pernah mendarat di main.

## Bug

Handler persetujuan koreksi (`processApproval`, baris 275; cabang
`actionType === "correction"`) menulis record absensi baru
(`attendance/{company}/{uid}/{date}/{masuk|pulang}`) dari data
permintaan koreksi. Di dua tempat, lampiran koreksi ditulis ke
field foto absensi:

**Blok masuk — baris 608–613:**

```ts
if (actionReq.attachment_url) {
    attendanceRecord.photo_url = actionReq.attachment_url;
}
if (actionReq.attachment_path) {
    attendanceRecord.photo_path = actionReq.attachment_path;
}
```

**Blok pulang — baris 678–683:** pola identik (baris 679 dan 682).

## Dampak

Foto absensi asli karyawan (selfie/QR) tertimpa oleh lampiran
koreksi (mis. surat dokter / bukti pendukung). Foto asli hilang
dari record absensi; yang tampil di detail absensi
(`Approvals.tsx` baris 207, 234–237, 1235 memakai `photo_url`)
adalah lampiran koreksi, bukan foto kehadiran.

## Akar masalah

Satu record absensi dipakai untuk dua hal berbeda (bukti kehadiran
vs bukti pendukung koreksi) tanpa field terpisah. Penulis kode
memakai ulang `photo_url`/`photo_path` sebagai "ada lampiran".

## Fix (4 baris, dua blok)

Tulis lampiran koreksi ke field terpisah, jangan sentuh
`photo_url`/`photo_path`:

```diff
                   if (actionReq.attachment_url) {
-                      attendanceRecord.photo_url = actionReq.attachment_url;
+                      attendanceRecord.correction_attachment_url = actionReq.attachment_url;
                   }
                   if (actionReq.attachment_path) {
-                      attendanceRecord.photo_path = actionReq.attachment_path;
+                      attendanceRecord.correction_attachment_path = actionReq.attachment_path;
                   }
```

Terapkan di **kedua** blok: blok masuk (baris 608–613) dan blok
pulang (baris 678–683). Tidak ada perubahan lain: `photo_url` /
`photo_path` tetap berisi foto absensi asli (dari `existing` /
record lama), status request, notifikasi, dan audit log tidak
berubah.

## Yang harus dicek saat rebuild (regresi)

1. Detail koreksi di Approvals baru harus menampilkan DUA foto
   bila keduanya ada: foto absensi (`photo_url`) dan lampiran
   koreksi (`correction_attachment_url`) — jangan hanya satu.
2. Record absensi yang sudah rusak sebelum fix (foto tertimpa)
   tidak bisa dipulihkan dari kode — hanya dari foto asli di
   Storage bila `photo_path` lama masih tercatat di tempat lain.
   Di luar scope fix ini; catat bila ditemukan saat migrasi.
3. Tampilan detail lama (`attachmentSource`, baris 60, dan
   `detailReq.photo_url || detailReq.photo_path`, baris 1235)
   harus diperbarui mengikuti field baru — kalau tidak, lampiran
   koreksi tidak tampil di halaman detail.
4. Tidak ada pembaca lain atas `photo_url` record koreksi yang
   bergantung pada perilaku lama (menimpa): `grep photo_url`
   pada `Attendance.tsx` / `Reports.tsx` memakai foto absensi
   murni — perilaku mereka MEMBAIK dengan fix ini, bukan rusak.
