// Route /admin/announcements — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.announcements.tsx -> /admin/announcements,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { AnnouncementsPage } from "@/features/kelola-sistem/announcements/page"

export const Route = createFileRoute("/admin/announcements")({
  component: AnnouncementsPageRoute,
})

function AnnouncementsPageRoute() {
  return (
    <RequirePermission resource="announcements">
      <AnnouncementsPage />
    </RequirePermission>
  )
}
