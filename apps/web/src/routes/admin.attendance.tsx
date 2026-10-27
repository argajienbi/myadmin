// Route Absensi — admin.attendance.tsx -> /admin/attendance.
// Search params (dari kartu Dashboard & baris Log Terbaru): date,
// startDate, endDate, search, method, action, office, department, group,
// status, geofence.
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { AttendancePage } from "@/features/utama/attendance-page"

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export const Route = createFileRoute("/admin/attendance")({
  validateSearch: (search: Record<string, unknown>) => ({
    date: pickString(search.date),
    startDate: pickString(search.startDate),
    endDate: pickString(search.endDate),
    search: pickString(search.search),
    method: pickString(search.method),
    action: pickString(search.action),
    office: pickString(search.office),
    department: pickString(search.department),
    group: pickString(search.group),
    status: pickString(search.status),
    geofence: pickString(search.geofence),
  }),
  component: AttendanceRoute,
})

function AttendanceRoute() {
  const search = Route.useSearch()
  return (
    <RequirePermission resource="attendance">
      <AttendancePage search={search} />
    </RequirePermission>
  )
}
