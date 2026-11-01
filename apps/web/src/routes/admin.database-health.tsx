// Route /admin/database-health — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.database-health.tsx -> /admin/database-health,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { DatabaseHealthPage } from "@/features/kelola-sistem/database-health/page"

export const Route = createFileRoute("/admin/database-health")({
  component: DatabaseHealthPageRoute,
})

function DatabaseHealthPageRoute() {
  return (
    <RequirePermission resource="database">
      <DatabaseHealthPage />
    </RequirePermission>
  )
}
