// Route /admin/company-admins — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.company-admins.tsx -> /admin/company-admins,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { CompanyAdminsPage } from "@/features/kelola-sistem/company-admins/page"

export const Route = createFileRoute("/admin/company-admins")({
  component: CompanyAdminsPageRoute,
})

function CompanyAdminsPageRoute() {
  return (
    <RequirePermission ownerOnly>
      <CompanyAdminsPage />
    </RequirePermission>
  )
}
