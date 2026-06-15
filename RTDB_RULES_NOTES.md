# Catatan Rules Database

File rtdb.rules.json adalah draft pengamanan company-scoped.

Sebelum deploy:
1. Backup database.
2. Pastikan semua admin punya /users/{uid}/company_id dan role.
3. Test di Firebase Rules Playground:
   - Admin A read company A harus allow.
   - Admin A read company B harus deny.
   - Owner read semua company harus allow.
4. Deploy bertahap.
