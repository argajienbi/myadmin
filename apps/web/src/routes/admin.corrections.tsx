// Route Koreksi Absensi — admin.corrections.tsx -> /admin/corrections.
// Sengaja flat (bukan admin.attendance.corrections): route bersarang di
// bawah /admin/attendance akan butuh <Outlet/> di halaman Absensi, dan
// halaman Koreksi di mockup + aplikasi lama adalah halaman mandiri.
import { createFileRoute } from "@tanstack/react-router"
import { RequirePermission } from "@/components/page-gate"
import { CorrectionsPage } from "@/features/utama/corrections-page"

export const Route = createFileRoute("/admin/corrections")({
  component: CorrectionsPageRoute,
})

function CorrectionsPageRoute() {
  return (
    <RequirePermission resource="approvals">
      <CorrectionsPage />
    </RequirePermission>
  )
}
