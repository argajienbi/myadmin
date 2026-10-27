/**
 * Data Pengaturan — port logika Settings.tsx myadmin lama.
 * Profil: nama + no HP ditulis ke `users/{uid}` (+ `company_users` bila
 * admin punya company_id dan bukan owner). Sandi via Firebase Auth
 * `updatePassword`. Website/branding memakai fungsi yang sama dengan
 * halaman Perusahaan (field `company_*`). Sinkronisasi user ke Firestore
 * mem-port syncFirestoreUsersFromRtdb.ts.
 *
 * SEAM SEMENTARA: sampai auth Firebase Raka mendarat, UID Firebase admin
 * dicari dengan mencocokkan email (template auth JWT tidak membawa UID
 * Firebase). Bila tidak cocok, profil menampilkan pemberitahuan jujur.
 */
import { useQuery } from "@tanstack/react-query"
import { updatePassword } from "firebase/auth"
import { update } from "firebase/database"
import { ref } from "firebase/database"
import { getDb, auth, isFirebaseConfigured } from "@/lib/firebase"
import { mirrorUserToFirestore } from "@/lib/firebase-user-mirror"
import { readList, readValue } from "@/lib/rtdb-read"
import { paths } from "@/lib/firebase-paths"
import type { Company, UserIndex } from "@/lib/firebase-types"

export interface SettingsData {
  firebaseUser: UserIndex | null
  company: Company | null
}

export async function findUserByEmail(
  email: string,
): Promise<UserIndex | null> {
  const users = await readList<UserIndex>("users")
  const lower = email.trim().toLowerCase()
  return (
    users.find((u) => (u.email ?? "").toLowerCase() === lower) ?? null
  )
}

export function useSettingsData(companyId: string, email: string | undefined) {
  return useQuery({
    queryKey: ["ks", "settings", companyId, email],
    queryFn: async (): Promise<SettingsData> => {
      const [firebaseUser, company] = await Promise.all([
        email ? findUserByEmail(email) : Promise.resolve(null),
        companyId
          ? readValue<Company>(paths.company(companyId))
          : Promise.resolve(null),
      ])
      return { firebaseUser, company }
    },
    enabled: isFirebaseConfigured() && Boolean(email),
  })
}

export async function updateProfile(
  uid: string,
  companyId: string | undefined,
  role: string | undefined,
  patch: { nama_lengkap: string; no_hp: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const updates: Record<string, unknown> = {}
  updates[`${paths.userIndex(uid)}/nama_lengkap`] = patch.nama_lengkap
  updates[`${paths.userIndex(uid)}/no_hp`] = patch.no_hp
  if (companyId && role !== "owner") {
    updates[`${paths.companyUser(companyId, uid)}/nama_lengkap`] =
      patch.nama_lengkap
    updates[`${paths.companyUser(companyId, uid)}/no_hp`] = patch.no_hp
  }
  await update(ref(db), updates)
  try {
    await mirrorUserToFirestore({
      uid,
      nama_lengkap: patch.nama_lengkap,
      no_hp: patch.no_hp,
    })
  } catch (mirrorErr) {
    console.warn("Failed to mirror profile update", mirrorErr)
  }
}

export async function changePassword(
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  if (newPassword !== confirmPassword)
    throw new Error("Password dan konfirmasi tidak cocok.")
  if (newPassword.length < 6)
    throw new Error("Password minimal 6 karakter.")
  const currentUser = auth?.currentUser
  if (!currentUser)
    throw new Error(
      "Sesi Firebase belum tersedia — ubah sandi membutuhkan login Firebase.",
    )
  await updatePassword(currentUser, newPassword)
}

/** Port syncFirestoreUsersFromRtdb.ts: mirror semua user perusahaan. */
export async function syncFirestoreUsersFromRtdb(
  companyId?: string,
): Promise<{ total: number; success: number; failed: number }> {
  const usersSnap = await readList<Record<string, unknown>>("users")
  const currentUid = auth?.currentUser?.uid
  const userKeys = [...usersSnap]
  userKeys.sort((a, b) => {
    if (a.id === currentUid) return -1
    if (b.id === currentUid) return 1
    return 0
  })
  let total = 0
  let success = 0
  let failed = 0
  for (const user of userKeys) {
    if (companyId && user.company_id !== companyId) continue
    total += 1
    try {
      await mirrorUserToFirestore({
        uid: String(user.id ?? user.uid ?? ""),
        company_id: String(user.company_id ?? ""),
        role: String(user.role ?? "employee"),
        status_akun: String(user.status_akun ?? "active"),
        nama_lengkap: String(user.nama_lengkap ?? user.name ?? ""),
        email: String(user.email ?? ""),
        nip: String(user.nip ?? ""),
        no_hp: String(user.no_hp ?? ""),
        position: String(user.position ?? ""),
        area_id: String(user.area_id ?? ""),
        office_id: String(user.office_id ?? ""),
        department_id: String(user.department_id ?? ""),
        sub_department_id: String(user.sub_department_id ?? ""),
        group_id: String(user.group_id ?? ""),
        photo_url: String(user.photo_url ?? ""),
        photo_path: String(user.photo_path ?? ""),
      })
      success += 1
    } catch {
      failed += 1
    }
  }
  return { total, success, failed }
}

/** Warna primer — field baru dari mockup (`company_primary_color`). */
export async function savePrimaryColor(
  companyId: string,
  color: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await update(ref(db, paths.company(companyId)), {
    company_primary_color: color,
    updated_at: Date.now(),
    updated_by: actor.uid,
    updated_by_name: actor.name,
  })
}
