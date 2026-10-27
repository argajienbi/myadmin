// Port of myadmin lama: src/utils/roleAccess.ts (repo argajienbi/myadmin, main HEAD 31e4b9b). Disalin verbatim.
export function normalizeRole(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

export function isOwnerLike(userData: unknown) {
  const u = userData as Record<string, unknown> | null | undefined;
  const role = normalizeRole(u?.role);

  return (
    role === "owner" ||
    role === "system_owner" ||
    u?.is_owner === true ||
    u?.is_system_owner === true
  );
}

export function getEffectiveCompanyId(userData: unknown, fallbackSelectedCompany = "") {
  if (!userData) return "";

  const u = userData as Record<string, unknown>;
  if (isOwnerLike(userData)) {
    return fallbackSelectedCompany || String(u.company_id || "");
  }

  return String(u.company_id || "");
}
