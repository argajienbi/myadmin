// Route /admin/notification-logs — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.notification-logs.tsx -> /admin/notification-logs,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { NotificationLogsPage } from "@/features/kelola-sistem/notification-logs/page"

export const Route = createFileRoute("/admin/notification-logs")({
  component: NotificationLogsPageRoute,
})

function NotificationLogsPageRoute() {
  return (
    <RequirePermission ownerOnly>
      <NotificationLogsPage />
    </RequirePermission>
  )
}
