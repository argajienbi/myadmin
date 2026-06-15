export function looksLikeRawId(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return false;

  // Firebase push id biasanya panjang, random, berisi - _ angka huruf.
  if (/^-?[A-Za-z0-9_-]{16,}$/.test(text)) return true;

  // UID Firebase Auth sering panjang random.
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return true;

  return false;
}

export function maskId(value: unknown, prefix = "ID") {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= 8) return `${prefix} ${text}`;
  return `${prefix} ${text.slice(0, 4)}…${text.slice(-4)}`;
}

export function safeFallbackLabel(
  label: unknown,
  fallback = "Belum diberi nama"
) {
  const text = String(label || "").trim();
  if (!text) return fallback;
  if (looksLikeRawId(text)) return fallback;
  return text;
}

export function companyDisplayName(company: any, fallback = "Perusahaan") {
  return safeFallbackLabel(
    company?.name ||
      company?.nama ||
      company?.company_name ||
      company?.nama_perusahaan ||
      company?.display_name ||
      company?.legal_name,
    fallback
  );
}

export function employeeDisplayName(user: any, fallback = "Karyawan") {
  return safeFallbackLabel(
    user?.nama_lengkap ||
      user?.name ||
      user?.display_name ||
      user?.email ||
      user?.phone ||
      user?.uid,
    fallback
  );
}

export function groupDisplayName(group: any, fallback = "Grup Karyawan") {
  return safeFallbackLabel(
    group?.name || group?.nama || group?.group_name || group?.display_name,
    fallback
  );
}

export function officeDisplayName(office: any, fallback = "Kantor") {
  return safeFallbackLabel(
    office?.name || office?.nama || office?.office_name || office?.display_name,
    fallback
  );
}

export function departmentDisplayName(dept: any, fallback = "Departemen") {
  return safeFallbackLabel(
    dept?.name || dept?.nama || dept?.department_name || dept?.display_name,
    fallback
  );
}

export function shiftDisplayName(shift: any, fallback = "Pola Shift") {
  return safeFallbackLabel(
    shift?.name || shift?.nama || shift?.shift_name || shift?.display_name,
    fallback
  );
}

export function timetableDisplayName(timetable: any, fallback = "Jam Kerja") {
  return safeFallbackLabel(
    timetable?.name ||
      timetable?.nama ||
      timetable?.label ||
      timetable?.display_name,
    fallback
  );
}
