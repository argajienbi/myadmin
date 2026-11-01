import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth"
import { get, ref, set, update } from "firebase/database"
import type { LoginResponse, MeResponse, Scope } from "@workspace/contracts"
import { auth, db, isConfigAvailable } from "./firebase"
import { paths } from "./firebase-paths"
import { queryClient } from "./query-client"
import { ApiError } from "./api-client"
import {
  canForRole,
  permissionsForRole,
  scopeForRole,
} from "./firebase-permissions"
import { mirrorUserToFirestore } from "./firebase-user-mirror"
import type { UserIndex } from "./firebase-types"

export type FirebaseUserProfile = UserIndex & {
  is_owner?: boolean
  is_system_owner?: boolean
  bootstrap_owner?: boolean
}

type SettledStatus = "authenticated" | "anonymous"
type AuthStatus = "loading" | SettledStatus

interface AuthState {
  status: AuthStatus
  // Profil Firebase (users/{uid}) — sumber role/company halaman.
  profile: FirebaseUserProfile | null
  currentUser: FirebaseUser | null
  // Peta ke bentuk template agar NavUser / halaman template lama tetap jalan.
  user: MeResponse | null
}

export interface AuthContextValue extends AuthState {
  ready: Promise<SettledStatus>
  login: (email: string, password: string) => Promise<LoginResponse>
  verifyTwoFactor: (
    challengeToken: string,
    code: string
  ) => Promise<LoginResponse>
  verifyTwoFactorBackup: (
    challengeToken: string,
    backupCode: string
  ) => Promise<LoginResponse>
  logout: () => Promise<void>
  // Reloads users/{uid} into state (after profile changes); never throws.
  refreshUser: () => Promise<void>
  can: (resource: string, action: string) => boolean
  // Widest scope granted for the permission, or null when not granted.
  scopeOf: (resource: string, action: string) => Scope | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Sama seperti myadmin lama: owner bootstrap dikenali dari UID/email ini.
const OWNER_UID = "BIVgnX2aIwTjMSG2lHkicEfkt9I3"
const OWNER_EMAIL = "armin.gandi@gmail.com"

function roleLabel(role: string): string {
  const r = role.trim().toLowerCase()
  if (r === "owner" || r === "system_owner") return "Owner"
  if (r === "admin") return "Admin"
  return "User"
}

function toMeResponse(
  profile: FirebaseUserProfile,
  firebaseUser: FirebaseUser
): MeResponse {
  return {
    id: profile.uid,
    email: profile.email || firebaseUser.email || "",
    fullName: profile.nama_lengkap || firebaseUser.displayName || null,
    avatarUrl: profile.photo_url || firebaseUser.photoURL || null,
    roleId: profile.role || "user",
    roleName: roleLabel(profile.role || "user"),
    emailVerified: firebaseUser.emailVerified,
    permissions: permissionsForRole(profile),
  }
}

function toLoginError(err: unknown): unknown {
  const code = (err as { code?: string })?.code ?? ""
  if (code === "auth/too-many-requests") {
    return new ApiError(
      429,
      code,
      "Terlalu banyak percobaan. Coba lagi sebentar lagi."
    )
  }
  if (
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/wrong-password" ||
    code === "auth/invalid-email"
  ) {
    return new ApiError(401, code, "Email atau kata sandi salah.")
  }
  return err
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    status: isConfigAvailable ? "loading" : "anonymous",
    profile: null,
    currentUser: null,
    user: null,
  }))

  const [ready] = useState<{
    promise: Promise<SettledStatus>
    resolve: (status: SettledStatus) => void
  }>(() => {
    let resolve!: (status: SettledStatus) => void
    const promise = new Promise<SettledStatus>((res) => {
      resolve = res
    })
    return { promise, resolve }
  })

  const loadProfile = useCallback(
    async (firebaseUser: FirebaseUser): Promise<FirebaseUserProfile | null> => {
      const isOwner =
        firebaseUser.uid === OWNER_UID ||
        firebaseUser.email?.toLowerCase() === OWNER_EMAIL

      const defaultOwnerData: FirebaseUserProfile = {
        uid: firebaseUser.uid,
        company_id: "",
        role: "owner",
        status_akun: "active",
        email: firebaseUser.email || OWNER_EMAIL,
        nama_lengkap: firebaseUser.displayName || "System Owner",
        created_at: Date.now(),
        is_owner: true,
        is_system_owner: true,
        bootstrap_owner: true,
        updated_at: Date.now(),
      }

      let resolved: FirebaseUserProfile | null = isOwner
        ? defaultOwnerData
        : null

      try {
        const userRef = ref(db, paths.userIndex(firebaseUser.uid))
        let snapshot = null
        try {
          snapshot = await get(userRef)
        } catch (readErr) {
          console.warn(
            "RTDB read restricted for user:",
            (readErr as { message?: string })?.message ?? readErr
          )
        }

        if (snapshot && snapshot.exists()) {
          const data = snapshot.val() as FirebaseUserProfile
          if (isOwner) {
            data.role = "owner"
            data.status_akun = "active"
            data.is_owner = true
            data.is_system_owner = true
            data.bootstrap_owner = true
            try {
              await update(userRef, {
                role: "owner",
                status_akun: "active",
                is_owner: true,
                is_system_owner: true,
                bootstrap_owner: true,
                updated_at: Date.now(),
              })
            } catch (updateErr) {
              console.warn("Owner update to RTDB restricted:", updateErr)
            }
          }
          resolved = data
        } else if (isOwner) {
          resolved = defaultOwnerData
          try {
            await set(userRef, defaultOwnerData)
          } catch (writeErr) {
            console.warn("Owner bootstrap to RTDB restricted:", writeErr)
          }
        } else {
          resolved = null
        }
      } catch (error) {
        if (!isOwner) {
          console.warn(
            "Notice reading user profile:",
            (error as { message?: string })?.message ?? error
          )
          resolved = null
        }
      }

      return resolved
    },
    []
  )

  const applySession = useCallback(
    (firebaseUser: FirebaseUser | null, profile: FirebaseUserProfile | null) => {
      flushSync(() =>
        setState({
          status: firebaseUser ? "authenticated" : "anonymous",
          profile,
          currentUser: firebaseUser,
          user:
            firebaseUser && profile
              ? toMeResponse(profile, firebaseUser)
              : null,
        })
      )
    },
    []
  )

  const mirrorProfile = useCallback((profile: FirebaseUserProfile | null) => {
    if (!profile) return
    mirrorUserToFirestore({
      uid: profile.uid,
      company_id: profile.company_id || "",
      role: profile.role || "owner",
      status_akun: profile.status_akun || "active",
      nama_lengkap: profile.nama_lengkap || "",
      email: profile.email || "",
      nip: (profile as { nip?: string }).nip || "",
      no_hp: (profile as { no_hp?: string }).no_hp || "",
      position: profile.position || "",
      area_id: (profile as { area_id?: string }).area_id || "",
      office_id: (profile as { office_id?: string }).office_id || "",
      department_id: (profile as { department_id?: string }).department_id || "",
      sub_department_id:
        (profile as { sub_department_id?: string }).sub_department_id || "",
      group_id: (profile as { group_id?: string }).group_id || "",
      photo_url: profile.photo_url || "",
      photo_path: profile.photo_path || "",
    }).catch((mirrorError) => {
      console.warn("Failed mirroring current user to Firestore", mirrorError)
    })
  }, [])

  useEffect(() => {
    if (!isConfigAvailable) {
      ready.resolve("anonymous")
      return
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        applySession(null, null)
        ready.resolve("anonymous")
        return
      }
      const profile = await loadProfile(user)
      applySession(user, profile)
      mirrorProfile(profile)
      ready.resolve("authenticated")
    })
    return unsubscribe
  }, [ready, loadProfile, applySession, mirrorProfile])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResponse> => {
      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        )
        const firebaseUser = credential.user
        // Drop anything cached for a previous session before the new user renders.
        queryClient.clear()
        const profile = await loadProfile(firebaseUser)
        applySession(firebaseUser, profile)
        mirrorProfile(profile)
        return {
          requiresTwoFactor: false,
          accessToken: await firebaseUser.getIdToken(),
          accessTokenExpiresInSeconds: 3600,
          user: {
            id: firebaseUser.uid,
            email: firebaseUser.email || email,
            roleId: profile?.role || "user",
          },
        }
      } catch (err) {
        throw toLoginError(err)
      }
    },
    [loadProfile, applySession, mirrorProfile]
  )

  const verifyTwoFactor = useCallback(
    async (): Promise<LoginResponse> => {
      throw new Error(
        "Verifikasi dua faktor tidak dipakai pada login Firebase."
      )
    },
    []
  )

  const verifyTwoFactorBackup = useCallback(
    async (): Promise<LoginResponse> => {
      throw new Error(
        "Verifikasi dua faktor tidak dipakai pada login Firebase."
      )
    },
    []
  )

  const logout = useCallback(async () => {
    await signOut(auth).catch(() => undefined)
    queryClient.clear()
    flushSync(() =>
      setState({
        status: "anonymous",
        profile: null,
        currentUser: null,
        user: null,
      })
    )
  }, [])

  const refreshUser = useCallback(async () => {
    const firebaseUser = state.currentUser
    if (!firebaseUser) return
    try {
      const profile = await loadProfile(firebaseUser)
      applySession(firebaseUser, profile)
    } catch (err) {
      // A failed refetch must not turn an already-saved change into an error.
      console.warn("Could not refresh user", err)
    }
  }, [state.currentUser, loadProfile, applySession])

  const can = useCallback(
    (resource: string, action: string) =>
      canForRole(state.profile, resource, action),
    [state.profile]
  )

  const scopeOf = useCallback(
    (resource: string, action: string): Scope | null =>
      scopeForRole(state.profile, resource, action),
    [state.profile]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      ready: ready.promise,
      login,
      verifyTwoFactor,
      verifyTwoFactorBackup,
      logout,
      refreshUser,
      can,
      scopeOf,
    }),
    [
      state,
      login,
      verifyTwoFactor,
      verifyTwoFactorBackup,
      logout,
      refreshUser,
      can,
      scopeOf,
      ready.promise,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function settledStatus(
  auth: Pick<AuthContextValue, "status" | "ready">
): Promise<SettledStatus> | SettledStatus {
  return auth.status === "loading" ? auth.ready : auth.status
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
