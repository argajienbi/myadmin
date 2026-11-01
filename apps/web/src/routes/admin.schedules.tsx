// Route Jadwal Kerja — admin.schedules.tsx -> /admin/schedules.
// Search param ?tab=ringkasan|timetable|shift|assignment|holiday|special|
// overtime|diagnostic|logs (dari kartu Dashboard & tautan lain).
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { SchedulesPage } from "@/features/utama/schedules-page"

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export const Route = createFileRoute("/admin/schedules")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: pickString(search.tab),
  }),
  component: SchedulesRoute,
})

function SchedulesRoute() {
  const search = Route.useSearch()
  return (
    <RequirePermission resource="schedules">
      <SchedulesPage initialTab={search.tab} />
    </RequirePermission>
  )
}
