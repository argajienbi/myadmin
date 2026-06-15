# MYPRESENSI Web Admin

Web admin untuk sistem absensi MYPRESENSI berbasis Firebase.

## Stack

- React + Vite + TypeScript
- Firebase Auth
- Firebase Realtime Database
- Firebase Storage

## Firebase

Project ID: mypresence-db
Database: https://mypresence-db-default-rtdb.asia-southeast1.firebasedatabase.app
Storage: mypresence-db.firebasestorage.app

**Catatan**: File `rtdb.rules.json` adalah draft. Uji di Firebase Rules Playground sebelum dipakai di production. Pastikan semua admin punya `/users/{uid}/company_id` dan role.

## Jalankan Lokal

npm install
cp .env.example .env
npm run dev

## Build

npm run build

## App Compatibility

Setiap perubahan struktur data admin_web harus dicek terhadap Flutter app MYPRESENSI.

Lihat:
APP_ADMIN_INTEGRATION_CONTRACT.md
