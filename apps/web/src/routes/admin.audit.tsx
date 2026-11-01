// Route /admin/audit — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.audit.tsx -> /admin/audit,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { AuditPage } from "@/features/kelola-sistem/audit/page"

export const Route = createFileRoute("/admin/audit")({
  component: AuditPageRoute,
})

function AuditPageRoute() {
  return (
    <RequirePermission resource="audit">
      <AuditPage />
    </RequirePermission>
  )
}
