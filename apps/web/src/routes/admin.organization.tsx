// Route /admin/organization — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.organization.tsx -> /admin/organization,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { OrganizationPage } from "@/features/kelola-sistem/organization/page"

export const Route = createFileRoute("/admin/organization")({
  component: OrganizationPageRoute,
})

function OrganizationPageRoute() {
  return (
    <RequirePermission resource="organization">
      <OrganizationPage />
    </RequirePermission>
  )
}
