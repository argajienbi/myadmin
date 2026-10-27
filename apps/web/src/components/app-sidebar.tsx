import { Link } from "@tanstack/react-router"
import {
  BarChart3Icon,
  BellIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ClockIcon,
  DatabaseIcon,
  FileCheckIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"
import { NavMain, type NavItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { useAuth } from "@/lib/auth-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar"

function isSystemOwner(user: unknown): boolean {
  return (
    !!user &&
    typeof user === "object" &&
    ((user as Record<string, unknown>).is_system_owner === true ||
      (user as Record<string, unknown>).bootstrap_owner === true)
  )
}

// Menu myadmin (mockup): hanya halaman yang ada di redesain. Yang tidak
// ada di sini (mis. Pengaturan Sistem, Setup Awal) belum dimockup / di-drop.
const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Utama",
    items: [
      {
        title: "Dashboard",
        url: "/admin/dashboard",
        icon: <LayoutDashboardIcon />,
      },
      {
        title: "Persetujuan",
        url: "/admin/approvals",
        icon: <CheckCircle2Icon />,
      },
      { title: "Absensi", url: "/admin/attendance", icon: <ClockIcon /> },
      {
        title: "Koreksi Absensi",
        url: "/admin/corrections",
        icon: <FileCheckIcon />,
      },
      { title: "Karyawan", url: "/admin/employees", icon: <UsersIcon /> },
      { title: "Jadwal", url: "/admin/schedules", icon: <CalendarDaysIcon /> },
    ],
  },
  {
    title: "Kelola",
    items: [
      {
        title: "Organisasi",
        url: "/admin/organization",
        icon: <Building2Icon />,
      },
      { title: "Laporan", url: "/admin/reports", icon: <BarChart3Icon /> },
      {
        title: "Pengumuman",
        url: "/admin/announcements",
        icon: <MegaphoneIcon />,
      },
    ],
  },
  {
    title: "Sistem",
    items: [
      { title: "Audit Log", url: "/admin/audit", icon: <FileTextIcon /> },
      {
        title: "Perusahaan",
        url: "/admin/companies",
        icon: <Building2Icon />,
      },
      {
        title: "Admin PT",
        url: "/admin/company-admins",
        icon: <ShieldCheckIcon />,
        ownerOnly: true,
      },
      {
        title: "Kesehatan Database",
        url: "/admin/database-health",
        icon: <DatabaseIcon />,
      },
      {
        title: "Pengaturan Notifikasi",
        url: "/admin/notification-settings",
        icon: <BellIcon />,
        ownerOnly: true,
      },
      {
        title: "Log Notifikasi",
        url: "/admin/notification-logs",
        icon: <ScrollTextIcon />,
        ownerOnly: true,
      },
      { title: "Pengaturan", url: "/admin/settings", icon: <SettingsIcon /> },
      {
        title: "Buku Petunjuk",
        url: "/admin/admin-guide",
        icon: <BookOpenIcon />,
      },
    ],
  },
]

const NAV_RESOURCE: Record<string, string> = {
  "/admin/dashboard": "reports",
  "/admin/approvals": "approvals",
  "/admin/attendance": "attendance",
  "/admin/corrections": "approvals",
  "/admin/employees": "employees",
  "/admin/schedules": "schedules",
  "/admin/organization": "organization",
  "/admin/reports": "reports",
  "/admin/announcements": "announcements",
  "/admin/audit": "audit",
  "/admin/companies": "companies",
  "/admin/company-admins": "companies",
  "/admin/database-health": "database",
  "/admin/notification-settings": "notifications",
  "/admin/notification-logs": "notifications",
  "/admin/settings": "settings",
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { can, profile } = useAuth()
  const owner = isSystemOwner(profile)
  const sections = NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items.filter((item) => {
      // Halaman owner-only (Admin PT, Pengaturan/Log Notifikasi) tidak
      // bisa disaring resource saja: admin PUNYA resource companies dan
      // notifications — jadi ownerOnly didahulukan.
      if (item.ownerOnly && !owner) return false
      const resource = NAV_RESOURCE[item.url]
      if (!resource) return true
      // Owner lolos semua; selain itu ikut pemetaan role (firebase-permissions).
      // settings hanya punya pasangan manage (tanpa view) — cek keduanya.
      return owner || can(resource, "view") || can(resource, "manage")
    }),
  })).filter((section) => section.items.length > 0)

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/admin/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2Icon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">MyPresence</span>
                  <span className="truncate text-xs">Admin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => (
          <NavMain key={section.title} label={section.title} items={section.items} />
        ))}
        {owner && (
          <div className="mt-auto px-2 pb-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldCheckIcon className="size-3.5" /> Owner Mode
              </div>
              <p className="mt-0.5 text-amber-200/80">
                Akses penuh semua perusahaan.
              </p>
            </div>
          </div>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
