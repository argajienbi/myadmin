// Route /admin/notification-settings — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.notification-settings.tsx -> /admin/notification-settings,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { NotificationSettingsPage } from "@/features/kelola-sistem/notification-settings/page"

export const Route = createFileRoute("/admin/notification-settings")({
  component: NotificationSettingsPageRoute,
})

function NotificationSettingsPageRoute() {
  return (
    <RequirePermission ownerOnly>
      <NotificationSettingsPage />
    </RequirePermission>
  )
}
