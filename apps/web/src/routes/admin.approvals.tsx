// Route Persetujuan — admin.approvals.tsx -> /admin/approvals.
// Search params (dari kartu Dashboard): ?tab=izin|qr|koreksi&date=...
// dan ?status=pending (kartu Approval Pending).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { ApprovalsPage } from "@/features/utama/approvals-page"

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export const Route = createFileRoute("/admin/approvals")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: pickString(search.tab),
    status: pickString(search.status),
    date: pickString(search.date),
  }),
  component: ApprovalsRoute,
})

function ApprovalsRoute() {
  const search = Route.useSearch()
  return (
    <RequirePermission resource="approvals">
      <ApprovalsPage initialTab={search.tab} initialStatus={search.status} />
    </RequirePermission>
  )
}
