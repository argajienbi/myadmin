// Route /admin/settings — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.settings.tsx -> /admin/settings,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { SettingsPage } from "@/features/kelola-sistem/settings/page"

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPageRoute,
})

function SettingsPageRoute() {
  return (
    <RequirePermission resource="settings" action="manage">
      <SettingsPage />
    </RequirePermission>
  )
}
