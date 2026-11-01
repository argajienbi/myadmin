export const SCOPES = ["self", "team", "all"] as const
export type Scope = (typeof SCOPES)[number]

export const ACTIONS = ["manage", "view", "create", "edit", "delete"] as const
export type Action = (typeof ACTIONS)[number]

export const RESOURCES = [
  "users",
  "roles",
  "permissions",
  "audit",
  "settings",
  "announcements",
  "webhooks",
  "apiKeys",
  // MyPresence admin resources (Firebase-backed; see apps/web/src/lib/firebase-permissions.ts).
  "employees",
  "schedules",
  "attendance",
  "approvals",
  "companies",
  "organization",
  "reports",
  "notifications",
  "database",
] as const
export type Resource = (typeof RESOURCES)[number]

export interface PermissionDef {
  resource: Resource
  action: Action
}

export const PERMISSIONS = [
  { resource: "users", action: "manage" },
  { resource: "roles", action: "manage" },
  { resource: "permissions", action: "view" },
  { resource: "audit", action: "view" },
  { resource: "settings", action: "manage" },
  { resource: "announcements", action: "view" },
  { resource: "announcements", action: "manage" },
  { resource: "webhooks", action: "manage" },
  { resource: "apiKeys", action: "manage" },
  // MyPresence admin resources: each gets view + manage (owner = all,
  // admin = operational subset — see firebase-permissions.ts).
  { resource: "employees", action: "view" },
  { resource: "employees", action: "manage" },
  { resource: "schedules", action: "view" },
  { resource: "schedules", action: "manage" },
  { resource: "attendance", action: "view" },
  { resource: "attendance", action: "manage" },
  { resource: "approvals", action: "view" },
  { resource: "approvals", action: "manage" },
  { resource: "companies", action: "view" },
  { resource: "companies", action: "manage" },
  { resource: "organization", action: "view" },
  { resource: "organization", action: "manage" },
  { resource: "reports", action: "view" },
  { resource: "reports", action: "manage" },
  { resource: "notifications", action: "view" },
  { resource: "notifications", action: "manage" },
  { resource: "database", action: "view" },
  { resource: "database", action: "manage" },
] as const satisfies readonly PermissionDef[]

export type Permission =
  `${(typeof PERMISSIONS)[number]["resource"]}.${(typeof PERMISSIONS)[number]["action"]}`

export function permissionKey(p: PermissionDef): Permission {
  return `${p.resource}.${p.action}` as Permission
}

export function isKnownPermission(resource: string, action: string): boolean {
  return PERMISSIONS.some((p) => p.resource === resource && p.action === action)
}
