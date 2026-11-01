// Route /admin/admin-guide — halaman Kelola + Sistem (tim Jaka).
// Pola file-based TanStack Router: admin.admin-guide.tsx -> /admin/admin-guide,
// di bawah layout /admin (auth guard + sidebar milik Raka).
import { createFileRoute } from "@tanstack/react-router"
import { AdminGuidePage } from "@/features/kelola-sistem/admin-guide/page"

export const Route = createFileRoute("/admin/admin-guide")({
  component: AdminGuidePage,
})
