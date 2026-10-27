/**
 * Data Admin PT — port logika CompanyAdmins.tsx myadmin lama.
 * Tunjuk admin: users/{uid} role=admin, position=ADMIN, company_id,
 * status active + companies/{id}/admin_uid + upsert company_users +
 * mirror Firestore. Cabut: admin_uid dihapus, role kembali "user".
 */
import { useQuery } from "@tanstack/react-query"
import { update } from "firebase/database"
import { ref } from "firebase/database"
import { writeAuditLog } from "@/lib/firebase-audit"
import { getDb, isFirebaseConfigured } from "@/lib/firebase"
import { mirrorUserToFirestore } from "@/lib/firebase-user-mirror"
import { readList } from "@/lib/rtdb-read"
import { paths } from "@/lib/firebase-paths"
import type { Company, UserIndex } from "@/lib/firebase-types"

export interface CompanyAdminsData {
  companies: Company[]
  users: UserIndex[]
}

export function useCompanyAdmins() {
  return useQuery({
    queryKey: ["ks", "company-admins"],
    queryFn: async (): Promise<CompanyAdminsData> => {
      const [companies, users] = await Promise.all([
        readList<Company>(paths.companies()),
        readList<UserIndex>("users"),
      ])
      return { companies, users }
    },
    enabled: isFirebaseConfigured(),
  })
}

/** Calon admin: bukan owner, dan belum terikat perusahaan lain. */
export function potentialAdmins(
  users: UserIndex[],
  companyId: string,
): UserIndex[] {
  return users.filter(
    (u) =>
      u.role !== "owner" &&
      (!u.company_id || u.company_id === companyId),
  )
}

export async function assignCompanyAdmin(
  companyId: string,
  adminUid: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const userSnap = await readList<UserIndex>("users")
  const targetUser = userSnap.find((u) => u.uid === adminUid)
  const updates: Record<string, unknown> = {}
  updates[`${paths.userIndex(adminUid)}/role`] = "admin"
  updates[`${paths.userIndex(adminUid)}/position`] = "ADMIN"
  updates[`${paths.userIndex(adminUid)}/company_id`] = companyId
  updates[`${paths.userIndex(adminUid)}/status_akun`] = "active"
  updates[`${paths.company(companyId)}/admin_uid`] = adminUid
  if (targetUser) {
    updates[paths.companyUser(companyId, adminUid)] = {
      ...targetUser,
      role: "admin",
      position: "ADMIN",
      company_id: companyId,
      status_akun: "active",
    }
  }
  await update(ref(db), updates)
  try {
    await mirrorUserToFirestore({
      uid: adminUid,
      company_id: companyId,
      role: "admin",
      status_akun: "active",
      nama_lengkap: targetUser?.nama_lengkap ?? "",
      email: targetUser?.email ?? "",
      position: "Admin Perusahaan",
    })
  } catch (mirrorErr) {
    console.warn("Failed to mirror admin assignment", mirrorErr)
  }
  await writeAuditLog(companyId, {
    action: "ASSIGN_COMPANY_ADMIN",
    details: `Menetapkan admin PT ${targetUser?.nama_lengkap ?? adminUid}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.company(companyId),
    new_value: { admin_uid: adminUid },
  })
}

export async function revokeCompanyAdmin(
  companyId: string,
  adminUid: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const userSnap = await readList<UserIndex>("users")
  const targetAdmin = userSnap.find((u) => u.uid === adminUid)
  const updates: Record<string, unknown> = {}
  updates[`${paths.company(companyId)}/admin_uid`] = null
  updates[`${paths.userIndex(adminUid)}/role`] = "user"
  updates[`${paths.companyUser(companyId, adminUid)}/role`] = "user"
  await update(ref(db), updates)
  try {
    await mirrorUserToFirestore({
      uid: adminUid,
      company_id: companyId,
      role: "user",
      status_akun: targetAdmin?.status_akun ?? "active",
    })
  } catch (mirrorErr) {
    console.warn("Failed to mirror admin removal", mirrorErr)
  }
  await writeAuditLog(companyId, {
    action: "REVOKE_COMPANY_ADMIN",
    details: `Mencabut akses admin PT ${targetAdmin?.nama_lengkap ?? adminUid}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.company(companyId),
    new_value: { admin_uid: null },
  })
}
