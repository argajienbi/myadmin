// Route /admin/employees — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.employees.tsx -> /admin/employees,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { EmployeesPage } from "@/features/kelola-sistem/employees/page"

export const Route = createFileRoute("/admin/employees")({
  component: EmployeesPageRoute,
})

function EmployeesPageRoute() {
  return (
    <RequirePermission resource="employees">
      <EmployeesPage />
    </RequirePermission>
  )
}
