export type UserRole = 'owner' | 'admin' | 'user' | string;

export interface CompanyScopeInput {
  role?: UserRole | null;
  sessionCompanyId?: string | null;
  selectedCompanyId?: string | null;
}

export function isOwnerRole(role?: UserRole | null): boolean {
  return String(role || '').toLowerCase() === 'owner';
}

export function isAdminRole(role?: UserRole | null): boolean {
  return String(role || '').toLowerCase() === 'admin';
}

export function getEffectiveCompanyId(input: CompanyScopeInput): string {
  const role = String(input.role || '').toLowerCase();
  const sessionCompanyId = String(input.sessionCompanyId || '').trim();
  const selectedCompanyId = String(input.selectedCompanyId || '').trim();

  if (role === 'owner') {
    return selectedCompanyId || sessionCompanyId;
  }

  return sessionCompanyId;
}

export function assertCompanyAccess(input: CompanyScopeInput): void {
  const role = String(input.role || '').toLowerCase();
  const sessionCompanyId = String(input.sessionCompanyId || '').trim();
  const selectedCompanyId = String(input.selectedCompanyId || '').trim();

  if (!sessionCompanyId && role !== 'owner') {
    throw new Error('Akun admin belum memiliki company_id.');
  }

  if (role !== 'owner' && selectedCompanyId && selectedCompanyId !== sessionCompanyId) {
    throw new Error('Anda tidak memiliki akses ke perusahaan ini.');
  }
}
