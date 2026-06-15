# Firebase Rules Notes

## RTDB Rules

RTDB rules membaca role dan company dari:

/users/{uid}

Role yang didukung:

- owner
- admin
- user

Owner bisa mengelola semua company.
Admin hanya bisa mengelola company_id miliknya.
User hanya bisa membaca/menulis data yang diizinkan dalam company miliknya.

## Storage Rules

Storage rules tidak bisa membaca Realtime Database.
Karena itu Storage rules produksi menggunakan Firebase Custom Claims:

```json
{
  "role": "admin",
  "company_id": "company_fmi"
}
```

Claims wajib dipasang untuk:

- owner
- admin
- user

Setelah claims dipasang, user harus logout/login ulang agar token baru aktif.

## Set Custom Claims

Gunakan script:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

npm run claims:set -- <uid> <role> [company_id]
```

Contoh:

```bash
npm run claims:set -- 6L6pTYo4Dgfn9TSbmiA7Np9Wkht2 owner
npm run claims:set -- REPLACE_WITH_REAL_ADMIN_UID admin company_fmi
npm run claims:set -- REPLACE_WITH_REAL_USER_BUDI_UID user company_fmi
```

## Jangan Commit Service Account

File service account wajib masuk .gitignore.
