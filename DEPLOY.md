# Deploy redesain myadmin ke live

Disusun 27 Okt 2026. Status: SIAP — build terverifikasi seperti yang akan Vercel jalankan.

## Keadaan live saat ini (terverifikasi via Vercel, 27 Okt)

- Proyek Vercel **myadmin** (`prj_sxfbvAyWAcZ1YblNbeNBbxZxrvIo`), framework vite, Node 24.x.
- Production branch = **main**. Deployment production terakhir: `dpl_GMx4Mm9RzPBAnKzNm289NCznFwBt`,
  main @ `31e4b9b` ("fix(fcm): hapus sisa Cloud Function di NotificationLogs.tsx"), READY.
- Domain production: `myadmin-drab.vercel.app` (juga `myadmin-argajienbis-projects.vercel.app`).
- Deploy lama dari branch `uti/patch-hemat-biaya` SUDAH TIDAK BERLAKU — production sekarang mengikuti main.
- SSO Protection aktif untuk semua deployment kecuali custom domain (preview hanya bisa dibuka
  setelah login Vercel — Arga sudah login).

## Yang sudah disiapkan di workspace ini

- `vercel.json` (baru, di root repo): install `pnpm install --ignore-scripts`, build
  `pnpm --filter web build`, output `apps/web/dist`, SPA rewrite `/(.*)` → `/index.html`
  (file statis seperti `/sw.js`, `/assets/*`, `/manifest.webmanifest` tetap dilayani langsung,
  rewrite hanya berlaku bila file tidak ada).
- Tanpa env var baru: konfigurasi Firebase dibundel dari `apps/web/firebase-applet-config.json`
  (config client publik, sama seperti repo lama); `VITE_API_BASE_URL` hanya untuk API NestJS
  yang tidak dipakai.
- `pnpm install --ignore-scripts` aman: web me-resolve `@workspace/contracts` dari `src`
  (exports `import` → `./src/index.ts`), jadi `dist` kontrak tidak dibutuhkan — terbukti:
  build lolos padahal `packages/contracts/dist/` tidak ada di VM ini.
- Verifikasi yang sudah dijalankan Uti: `pnpm --filter web build` dari root → exit 0
  (9 dtk, PWA precache 77 entri); typecheck web 0, lint web 0, typecheck contracts 0.
- Isi branch: 397 file, 3,8 MB (tanpa `node_modules`/`dist`). Termasuk `mockup/` + dokumen
  (`INVENTORY.md`, `MAPPING.md`, `FIX-approvals-2b.md`, `DEPLOY.md` ini) sebagai referensi.

## Rencana deploy (preview dulu, production belakangan)

1. **Branch baru `uti/redesign-myadmin`** dari main `31e4b9b`, berisi seluruh workspace ini.
   Vercel otomatis membuat Preview Deployment untuk branch baru (URL bentuk
   `myadmin-git-uti-redesign-myadmin-argajienbis-projects.vercel.app`).
2. **Arga uji di URL preview**: login Firebase (akun owner), buka 17 halaman, cek Persetujuan
   (fix bug 2b), lonceng, dan satu aksi tulis yang aman.
3. **Merge ke main** (PR → Merge di GitHub) → Vercel otomatis deploy production ke
   `myadmin-drab.vercel.app`. Verifikasi ulang di domain production.
4. **Rollback bila ada masalah**: Vercel → Deployments → pilih deployment production lama
   (`dpl_GMx4Mm9RzPBAnKzNm289NCznFwBt`, main `31e4b9b`) → Promote to Production.
   Atau `git revert` merge commit.

## Yang masih butuh tangan Arga (Uti tidak bisa)

GitHub App Uti **tidak punya akses tulis** ke repo `argajienbi/myadmin` (403 sejak 18 Okt 2026),
jadi Uti tidak bisa push branch sendiri. Dua jalan:

- **A (disarankan, sama seperti cleanyourtv):** Arga menambahkan repo `myadmin` ke instalasi
  GitHub App "Meta Muse AI" (GitHub → Settings → Applications → Meta Muse AI → Repository
  access → tambah `argajienbi/myadmin`). Setelah itu kabari Uti — Uti yang buat branch,
  push 397 file, dan laporkan URL preview.
- **B (manual):** Arga push sendiri dari VS Code di PC: clone `myadmin`, salin isi zip
  `myadmin-redesign.zip` (disiapkan Uti) ke clone, commit, push branch `uti/redesign-myadmin`.
  Panduan langkah ada di bawah.

## Panduan jalan B (push manual dari VS Code)

```bash
git clone https://github.com/argajienbi/myadmin.git myadmin-redesign-push
cd myadmin-redesign-push
git checkout -b uti/redesign-myadmin
# salin isi myadmin-redesign.zip ke folder ini (timpa semua file kecuali .git)
# pastikan node_modules/ dan dist/ TIDAK ikut tersalin
git add -A
git status   # periksa: hanya file redesign, tanpa node_modules/dist/.env
git commit -m "redesign: myadmin baru (monorepo-vite-nestjs, Firebase Auth, fix bug 2b)"
git push -u origin uti/redesign-myadmin
```

Lalu buka Vercel → project myadmin → Deployments → cari deployment branch
`uti/redesign-myadmin` → buka URL preview-nya.

## Yang TIDAK berubah saat deploy

- Firebase `mypresence-prod`, data RTDB/Firestore, dan rules — tidak disentuh.
- API NestJS/Postgres tetap tidak dipakai (kode tetap ada di repo, tidak dijalankan).
- Login tetap Firebase Auth; akun dan role yang sama.

## Terbuka (bukan blocker deploy, sudah dilaporkan ke Arga)

- Ikon PWA `pwa-192x192.png`/`pwa-512x512.png` tidak ada — butuh logo MyPresence dari Arga.
- `usePublicSettings` masih memanggil API NestJS (fallback "MyPresence").
- Deep-link Dashboard → Laporan `?view=belum_absen` belum ada target.
- `isActiveRecord` karyawan mengabaikan `status_akun`.
