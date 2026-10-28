/**
 * Data Perusahaan — port logika Companies.tsx myadmin lama ke TanStack
 * Query + satu-shot `get()`. Kode undangan 6 karakter alfanumerik,
 * website (https wajib), branding logo (Storage, maks 2 MB).
 */
import { useQuery } from "@tanstack/react-query"
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage"
import { push, ref, set, update } from "firebase/database"
import { writeAuditLog } from "@/lib/firebase-audit"
import { getDb, getFirebaseStorage, isFirebaseConfigured } from "@/lib/firebase"
import { readList, readValue } from "@/lib/rtdb-read"
import { paths } from "@/lib/firebase-paths"
import type { Company, CompanyInvite } from "@/lib/firebase-types"
import {
  domainFromUrl,
  getLogoExtension,
  normalizeHttpsUrl,
  parseDomains,
  validateCompanyLogoFile,
} from "@/lib/display-utils"

export interface CompaniesData {
  companies: Company[]
  invites: CompanyInvite[]
}

export function useCompanies() {
  return useQuery({
    queryKey: ["ks", "companies"],
    queryFn: async (): Promise<CompaniesData> => {
      const [companies, invites] = await Promise.all([
        readList<Company>(paths.companies()),
        readList<CompanyInvite>(paths.companyInvites()),
      ])
      return { companies, invites }
    },
    enabled: isFirebaseConfigured(),
  })
}

export async function createCompany(
  name: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!name.trim()) throw new Error("Nama perusahaan wajib diisi.")
  const companyRef = push(ref(db, paths.companies()))
  const payload = {
    id: companyRef.key,
    name: name.trim(),
    active: true,
    created_at: Date.now(),
    created_by: actor.uid,
    created_by_name: actor.name,
  }
  await set(companyRef, payload)
  await writeAuditLog(companyRef.key ?? "", {
    action: "CREATE_MASTER_DATA",
    details: `Membuat perusahaan baru ${name.trim()}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: `${paths.companies()}/${companyRef.key}`,
    new_value: payload,
  })
}

export async function updateCompany(
  companyId: string,
  patch: { name?: string; active?: boolean },
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await update(ref(db, paths.company(companyId)), {
    ...patch,
    updated_at: Date.now(),
    updated_by: actor.uid,
    updated_by_name: actor.name,
  })
  await writeAuditLog(companyId, {
    action: "UPDATE_MASTER_DATA",
    details: `Mengubah data perusahaan ${companyId}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.company(companyId),
    new_value: patch,
  })
}

export async function generateInviteCode(
  company: Company,
  actor: { uid: string; name: string },
): Promise<string> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!company.id) throw new Error("ID perusahaan tidak ditemukan.")
  // Kode harus unik — tanpa cek, set() akan menimpa undangan lain bila
  // kode acak bertabrakan.
  let code = ""
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = Math.random().toString(36).substring(2, 8).toUpperCase()
    const existing = await readValue(paths.companyInvite(candidate))
    if (!existing) {
      code = candidate
      break
    }
  }
  if (!code) throw new Error("Gagal membuat kode undangan unik, coba lagi.")
  const inviteData: CompanyInvite = {
    company_id: company.id,
    company_name: company.name,
    active: true,
    created_by: actor.uid,
    expired_at: 0,
    created_at: Date.now(),
  }
  await set(ref(db, paths.companyInvite(code)), inviteData)
  await writeAuditLog(company.id, {
    action: "CREATE_MASTER_DATA",
    details: "Membuat kode undangan untuk perusahaan",
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyInvite(code),
    new_value: inviteData,
  })
  return code
}

export async function revokeInvite(
  code: string,
  companyId: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await update(ref(db, paths.companyInvite(code)), { active: false })
  await writeAuditLog(companyId, {
    action: "UPDATE_MASTER_DATA",
    details: `Mencabut kode undangan ${code}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyInvite(code),
    new_value: { active: false },
  })
}

export interface WebsiteForm {
  website_enabled: boolean
  website_title: string
  website_url: string
  website_allowed_domains: string
}

/**
 * Simpan website perusahaan — port Companies.tsx lama: URL dinormalisasi
 * ke https, domain utama URL otomatis masuk daftar domain yang diizinkan,
 * judul default "Website Perusahaan".
 */
export async function saveWebsite(
  companyId: string,
  form: WebsiteForm,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const url = form.website_url.trim()
    ? normalizeHttpsUrl(form.website_url)
    : ""
  if (url && !domainFromUrl(url))
    throw new Error("URL website tidak valid.")
  const domains = parseDomains(form.website_allowed_domains)
  const mainDomain = url ? domainFromUrl(url) : ""
  if (mainDomain && domains.length === 0) domains.push(mainDomain)
  if (mainDomain && !domains.includes(mainDomain)) domains.unshift(mainDomain)
  const patch = {
    company_website_enabled: form.website_enabled,
    company_website_title: form.website_title.trim() || "Website Perusahaan",
    company_website_url: url,
    company_allowed_domains: domains,
    updated_at: Date.now(),
    updated_by: actor.uid,
    updated_by_name: actor.name,
  }
  await update(ref(db, paths.company(companyId)), patch)
  await writeAuditLog(companyId, {
    action: "UPDATE_MASTER_DATA",
    details: "Mengubah pengaturan website perusahaan",
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.company(companyId),
    new_value: patch,
  })
}

export async function uploadCompanyLogo(
  companyId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const storage = getFirebaseStorage()
  if (!storage) throw new Error("Firebase belum dikonfigurasi.")
  const error = validateCompanyLogoFile(file)
  if (error) throw new Error(error)
  const ext = getLogoExtension(file)
  const path = `company_logos/${companyId}/logo.${ext}`
  const fileRef = storageRef(storage, path)
  await uploadBytes(fileRef, file)
  const url = await getDownloadURL(fileRef)
  return { url, path }
}

export async function saveBranding(
  companyId: string,
  patch: { logo_enabled: boolean; logo_url?: string; logo_path?: string },
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const full = {
    company_logo_enabled: patch.logo_enabled,
    ...(patch.logo_url !== undefined
      ? { company_logo_url: patch.logo_url }
      : {}),
    ...(patch.logo_path !== undefined
      ? { company_logo_path: patch.logo_path }
      : {}),
    updated_at: Date.now(),
    updated_by: actor.uid,
    updated_by_name: actor.name,
  }
  await update(ref(db, paths.company(companyId)), full)
  await writeAuditLog(companyId, {
    action: "UPDATE_MASTER_DATA",
    details: "Mengubah branding perusahaan",
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.company(companyId),
    new_value: full,
  })
}

export async function removeCompanyLogo(
  companyId: string,
  logoPath: string | undefined,
  actor: { uid: string; name: string },
): Promise<void> {
  const storage = getFirebaseStorage()
  if (storage && logoPath) {
    try {
      await deleteObject(storageRef(storage, logoPath))
    } catch {
      // File sudah tidak ada di Storage — lanjut bersihkan record.
    }
  }
  await saveBranding(
    companyId,
    { logo_enabled: false, logo_url: "", logo_path: "" },
    actor,
  )
}
