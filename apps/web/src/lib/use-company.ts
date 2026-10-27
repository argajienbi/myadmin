// Konteks pengguna & perusahaan untuk halaman myadmin — gabungan port
// AuthContext.tsx + roleAccess.ts + pemilih perusahaan Dashboard/Schedules
// myadmin lama (repo argajienbi/myadmin, main HEAD 31e4b9b).
//
// Profil (users/{uid}) dibaca sekali oleh AuthProvider Raka (auth-context);
// hook di sini hanya memakainya. Owner boleh memilih perusahaan (pilihan
// tersimpan di localStorage `admin_selected_company`); non-owner terkunci
// ke company_id miliknya sendiri. Daftar perusahaan hanya dimuat untuk
// owner — non-owner tidak pernah melihat pemilih perusahaan.
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAuth, type FirebaseUserProfile } from "./auth-context"
import type { User as FirebaseUser } from "firebase/auth"
import { isConfigAvailable } from "./firebase"
import { paths } from "./firebase-paths"
import { getEffectiveCompanyId, isOwnerLike } from "./role-access"
import { readList } from "./rtdb-read"
import type { Company } from "./firebase-types"

/** Alias nama lama (dipakai schedules-forms / schedule-data). */
export type FirebaseUserData = FirebaseUserProfile

const SELECTED_COMPANY_KEY = "admin_selected_company"

export function useCurrentActor(): { uid: string; name: string } {
  const { user } = useAuth()
  return {
    uid: user?.id ?? "",
    name: user?.fullName ?? user?.email ?? "Admin",
  }
}

export function useIsOwner(): boolean {
  const { profile } = useAuth()
  return isOwnerLike(profile)
}

export interface CompanyScope {
  currentUser: FirebaseUser | null
  userData: FirebaseUserProfile | null
  profile: FirebaseUserProfile | null
  authLoading: boolean
  companies: Company[]
  company: Company | undefined
  companyId: string
  selectedCompanyId: string
  setCompanyId: (id: string) => void
  selectCompany: (id: string) => void
  isOwner: boolean
  loading: boolean
}

export function useCompany(): CompanyScope {
  const { currentUser, profile, status } = useAuth()
  const userData = profile
  const authLoading = status === "loading"
  const isOwner = isOwnerLike(profile)

  // Pilihan owner dibaca dari localStorage sejak awal (bukan lewat effect).
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_COMPANY_KEY) ?? ""
    } catch {
      return ""
    }
  })

  const companiesQuery = useQuery({
    queryKey: ["lib", "companies"],
    queryFn: () => readList<Company>(paths.companies()),
    enabled: isConfigAvailable && isOwner,
  })
  const companies = companiesQuery.data ?? []

  // Owner: pilihan tersimpan bila masih ada di daftar, else perusahaan
  // pertama. Non-owner: company_id sendiri (dihitung saat render).
  const effectiveSelected = isOwner
    ? selectedCompanyId &&
      companies.some((c) => c.id === selectedCompanyId)
      ? selectedCompanyId
      : (companies[0]?.id ?? "")
    : (profile?.company_id ?? "")
  const companyId = getEffectiveCompanyId(profile, effectiveSelected)
  const company = companies.find((c) => c.id === companyId)

  useEffect(() => {
    try {
      if (selectedCompanyId)
        localStorage.setItem(SELECTED_COMPANY_KEY, selectedCompanyId)
    } catch {
      // abaikan: localStorage tidak tersedia
    }
  }, [selectedCompanyId])

  const setCompanyId = (id: string) => {
    setSelectedCompanyId(id)
    try {
      localStorage.setItem(SELECTED_COMPANY_KEY, id)
    } catch {
      // abaikan: localStorage tidak tersedia
    }
  }

  const loading = authLoading || (isOwner && !!profile && companiesQuery.isLoading)

  return {
    currentUser,
    userData,
    profile,
    authLoading,
    companies,
    company,
    companyId,
    selectedCompanyId: effectiveSelected,
    setCompanyId,
    selectCompany: setCompanyId,
    isOwner,
    loading,
  }
}

/** Nama lama (dipakai halaman Kelola + Sistem). */
export const useCompanyScope = useCompany
