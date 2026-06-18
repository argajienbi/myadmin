export function normalizeName(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function safeTrim(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
