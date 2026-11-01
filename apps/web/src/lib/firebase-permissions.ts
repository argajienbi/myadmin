import {
  PERMISSIONS,
  type Resource,
  type RolePermission,
  type Scope,
} from "@workspace/contracts"
import { isOwnerLike } from "./role-access"
import type { UserIndex } from "./firebase-types"

export type FirebaseProfileLike = Pick<UserIndex, "role"> & {
  is_owner?: boolean
  is_system_owner?: boolean
}

// Resource myadmin yang boleh diakses role admin. Owner boleh semuanya;
// role "user" (pengguna aplikasi mobile) tidak boleh masuk web admin.
// Daftar ini cerminan menu sidebar myadmin lama (Layout.tsx): halaman
// Admin PT, Audit Log, Kesehatan Database, Pengaturan Notifikasi,
// Log Notifikasi, dan Pengaturan hanya untuk owner.
const ADMIN_RESOURCES: Resource[] = [
  "employees",
  "schedules",
  "attendance",
  "approvals",
  "companies",
  "organization",
  "reports",
  "announcements",
  "notifications",
]

export function permissionsForRole(
  profile: FirebaseProfileLike | null | undefined
): RolePermission[] {
  if (!profile) return []
  if (isOwnerLike(profile)) {
    return PERMISSIONS.map((p) => ({
      resource: p.resource,
      action: p.action,
      scope: "all" as Scope,
    }))
  }
  if (String(profile.role || "").trim().toLowerCase() !== "admin") return []
  return PERMISSIONS.filter((p) =>
    ADMIN_RESOURCES.includes(p.resource)
  ).map((p) => ({ resource: p.resource, action: p.action, scope: "team" as Scope }))
}

export function canForRole(
  profile: FirebaseProfileLike | null | undefined,
  resource: string,
  action: string
): boolean {
  return permissionsForRole(profile).some(
    (p) => p.resource === resource && p.action === action
  )
}

export function scopeForRole(
  profile: FirebaseProfileLike | null | undefined,
  resource: string,
  action: string
): Scope | null {
  return (
    permissionsForRole(profile).find(
      (p) => p.resource === resource && p.action === action
    )?.scope ?? null
  )
}
