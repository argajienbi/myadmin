// Util murni — port dari safeDisplay.ts, companyBranding.ts, dan
// companyWebsite.ts myadmin lama (repo argajienbi/myadmin, main HEAD
// 31e4b9b). Hanya yang dipakai halaman (plus companyDisplayName versi
// Utama, fallback "Perusahaan") yang pindah ke sini.
import type { Company } from "./firebase-types"

export function maskId(id: string): string {
  if (!id) return ""
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

export function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

// --- Branding logo (companyBranding.ts lama) ------------------------------

export const COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const COMPANY_LOGO_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const

export function getLogoExtension(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (["png", "jpg", "jpeg", "webp"].includes(fromName))
    return fromName === "jpg" ? "jpeg" : fromName
  if (file.type === "image/png") return "png"
  if (file.type === "image/webp") return "webp"
  return "jpeg"
}

export function validateCompanyLogoFile(file: File): string | null {
  if (
    !COMPANY_LOGO_ACCEPTED_TYPES.includes(
      file.type as (typeof COMPANY_LOGO_ACCEPTED_TYPES)[number]
    )
  )
    return "Logo harus berupa gambar PNG, JPEG, atau WEBP."
  if (file.size > COMPANY_LOGO_MAX_BYTES) return "Ukuran logo maksimal 2 MB."
  return null
}

// --- Website perusahaan (companyWebsite.ts lama) ---------------------------

export function normalizeHttpsUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ""
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

export function domainFromUrl(raw: string): string {
  try {
    return new URL(normalizeHttpsUrl(raw)).hostname.toLowerCase()
  } catch {
    return ""
  }
}

export function parseDomains(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

export function domainsToText(
  domains?: string[] | Record<string, string> | null,
): string {
  if (!domains) return ""
  const list = Array.isArray(domains) ? domains : Object.values(domains)
  return list.join("\n")
}

/** Format tanggal+jam (ms epoch) ke string lokal id-ID, atau "—". */
export function formatDateTime(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—"
  const d = new Date(typeof value === "number" ? value : String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Format tanggal (YYYY-MM-DD atau ms epoch) ke string lokal, atau "—". */
export function formatDate(value?: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  }
  const d = new Date(typeof value === "number" ? value : String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

// Tampilan nama perusahaan yang aman (port utils/safeDisplay.ts lama):
// tidak pernah melempar bila node tidak punya field nama.
export function companyDisplayName(
  company:
    | Pick<Company, "display_name" | "name" | "id">
    | null
    | undefined,
  fallback = "Perusahaan"
): string {
  return company?.display_name || company?.name || company?.id || fallback
}
