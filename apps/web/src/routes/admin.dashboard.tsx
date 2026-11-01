// Route Dashboard Presensi (menggantikan dashboard contoh template).
// Pola file-based TanStack Router: admin.dashboard.tsx -> /admin/dashboard,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { DashboardPage } from "@/features/utama/dashboard-page"

export const Route = createFileRoute("/admin/dashboard")({
  component: DashboardPageRoute,
})

function DashboardPageRoute() {
  return (
    <RequirePermission resource="reports">
      <DashboardPage />
    </RequirePermission>
  )
}
