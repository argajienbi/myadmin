// Route /admin/reports — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.reports.tsx -> /admin/reports,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { ReportsPage } from "@/features/kelola-sistem/reports/page"

export const Route = createFileRoute("/admin/reports")({
  component: ReportsPageRoute,
})

function ReportsPageRoute() {
  return (
    <RequirePermission resource="reports">
      <ReportsPage />
    </RequirePermission>
  )
}
