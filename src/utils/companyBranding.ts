export const MAX_COMPANY_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

export const ALLOWED_COMPANY_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export function getLogoExtension(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "png";
}

export function validateCompanyLogoFile(file: File) {
  if (!ALLOWED_COMPANY_LOGO_TYPES.includes(file.type)) {
    throw new Error("Format logo harus PNG, JPG, JPEG, atau WEBP.");
  }

  if (file.size > MAX_COMPANY_LOGO_SIZE_BYTES) {
    throw new Error("Ukuran logo maksimal 2 MB.");
  }
}

export function getCompanyDisplayName(company: any) {
  return String(
    company?.display_name ||
    company?.name ||
    company?.company_name ||
    "MYPRESENCE"
  ).trim();
}
