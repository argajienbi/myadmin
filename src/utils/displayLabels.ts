export interface StructureLabelInput {
  name?: string | null;
  officeName?: string | null;
  departmentName?: string | null;
  subDepartmentName?: string | null;
  groupName?: string | null;
  nip?: string | null;
}

export function compactJoin(parts: Array<string | null | undefined>, separator = ' > '): string {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(separator);
}

export function formatGroupLabel(input: StructureLabelInput): string {
  const group = String(input.groupName || input.name || '').trim() || '-';
  const structure = compactJoin([
    input.officeName,
    input.departmentName,
    input.subDepartmentName,
  ]);

  return structure ? `${group} — ${structure}` : group;
}

export function formatEmployeeLabel(input: StructureLabelInput): string {
  const name = String(input.name || '').trim() || '-';
  const nip = String(input.nip || '').trim();
  const structure = compactJoin([
    input.officeName,
    input.departmentName,
    input.subDepartmentName,
    input.groupName,
  ]);

  const nameWithNip = nip ? `${name} — ${nip}` : name;
  return structure ? `${nameWithNip} — ${structure}` : nameWithNip;
}
