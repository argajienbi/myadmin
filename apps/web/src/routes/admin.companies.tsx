// Route /admin/companies — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.companies.tsx -> /admin/companies,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { CompaniesPage } from "@/features/kelola-sistem/companies/page"

export const Route = createFileRoute("/admin/companies")({
  component: CompaniesPageRoute,
})

function CompaniesPageRoute() {
  return (
    <RequirePermission resource="companies">
      <CompaniesPage />
    </RequirePermission>
  )
}
