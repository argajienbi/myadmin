// Gate per halaman — pola layar "Akses ditolak" yang sama dengan gate
// layout di routes/admin.tsx. Dipakai file route tipis (routes/admin.*.tsx).
// admin.tsx (beforeLoad) sudah menunggu profil settle sebelum halaman
// dirender, jadi useAuth().can() di sini aman dipakai.
import type { ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { useAuth } from "@/lib/auth-context"
import { isOwnerLike } from "@/lib/role-access"

export function AccessDenied({ message }: { message: string }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border p-6 text-center">
        <h1 className="text-lg font-semibold">Akses ditolak</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Button
          className="mt-4"
          onClick={async () => {
            await logout()
            await navigate({ to: "/login" })
          }}
        >
          Keluar
        </Button>
      </div>
    </div>
  )
}

export function RequirePermission({
  resource,
  action = "view",
  ownerOnly = false,
  children,
}: {
  resource?: string
  action?: string
  ownerOnly?: boolean
  children: ReactNode
}) {
  const { can, profile } = useAuth()
  if (ownerOnly) {
    if (!isOwnerLike(profile)) {
      return <AccessDenied message="Halaman ini hanya untuk owner." />
    }
    return <>{children}</>
  }
  if (resource && !can(resource, action)) {
    // Pengecualian Pengaturan (regresi vs aplikasi lama): /settings lama
    // tidak di-gate — admin non-owner boleh buka untuk ubah sandi &
    // profil sendiri. Halaman Pengaturan sendiri yang membatasi konten
    // non-owner; menu sidebar tetap tersembunyi via can() di app-sidebar.
    if (resource === "settings") {
      return <>{children}</>
    }
    return (
      <AccessDenied message="Akun ini tidak punya akses ke halaman ini." />
    )
  }
  return <>{children}</>
}
