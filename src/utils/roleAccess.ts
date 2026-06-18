export function normalizeRole(role: unknown) {
  return String(role || "").trim().toLowerCase();
}

export function isOwnerLike(userData: any) {
  const role = normalizeRole(userData?.role);

  return (
    role === "owner" ||
    role === "system_owner" ||
    userData?.is_owner === true ||
    userData?.is_system_owner === true
  );
}

export function getEffectiveCompanyId(userData: any, fallbackSelectedCompany = "") {
  if (!userData) return "";

  if (isOwnerLike(userData)) {
    return fallbackSelectedCompany || userData.company_id || "";
  }

  return userData.company_id || "";
}
