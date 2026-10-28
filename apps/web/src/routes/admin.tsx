import { Fragment } from "react"
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { MoonIcon, SunIcon } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { AppSidebar } from "@/components/app-sidebar"
import { NotificationBell } from "@/components/notification-bell"
import { useTheme } from "@/components/theme-provider"
import { settledStatus, useAuth } from "@/lib/auth-context"
import { isOwnerLike } from "@/lib/role-access"

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context, location }) => {
    if ((await settledStatus(context.auth)) !== "authenticated") {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }
  },
  component: AdminLayout,
})

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Label breadcrumb mengikuti nama halaman di mockup (bukan nama segmen URL).
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  approvals: "Persetujuan",
  attendance: "Absensi",
  corrections: "Koreksi Absensi",
  employees: "Karyawan",
  schedules: "Jadwal",
  organization: "Organisasi",
  reports: "Laporan",
  announcements: "Pengumuman",
  audit: "Audit Log",
  companies: "Perusahaan",
  "company-admins": "Admin PT",
  "database-health": "Kesehatan Database",
  "notification-settings": "Pengaturan Notifikasi",
  "notification-logs": "Log Notifikasi",
  settings: "Pengaturan",
  "admin-guide": "Buku Petunjuk",
}
const label = (segment: string) =>
  SEGMENT_LABELS[segment] ??
  (UUID_RE.test(segment)
    ? "Detail"
    : segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " "))

function AdminLayout() {
  const segments = useLocation({
    select: (l) => l.pathname.split("/").filter(Boolean).slice(1),
  })
  const { theme, setTheme } = useTheme()
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)

  // Gate akses web admin (myadmin lama): hanya owner/admin aktif yang
  // profilnya ada di users/{uid}. Firebase user tanpa profil, akun
  // nonaktif, dan role "user" melihat layar penolakan, bukan shell.
  const deniedMessage = !profile
    ? "Akun ini belum terdaftar di MyPresence. Minta admin mendaftarkan akun Anda."
    : profile.status_akun !== "active"
      ? "Akun ini sudah tidak aktif. Hubungi owner perusahaan Anda."
      : !isOwnerLike(profile) &&
          String(profile.role || "").trim().toLowerCase() !== "admin"
        ? "Akun ini tidak punya akses web admin. Web admin hanya untuk owner dan admin."
        : null

  if (deniedMessage) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border p-6 text-center">
          <h1 className="text-lg font-semibold">Akses ditolak</h1>
          <p className="mt-2 text-sm text-muted-foreground">{deniedMessage}</p>
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

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                {segments.map((segment, i) => (
                  <Fragment key={segment}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {i === segments.length - 1 ? (
                        <BreadcrumbPage>{label(segment)}</BreadcrumbPage>
                      ) : (
                        label(segment)
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto" />
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ganti tema"
              onClick={() => setTheme(dark ? "light" : "dark")}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </Button>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
