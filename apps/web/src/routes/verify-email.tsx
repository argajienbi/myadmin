import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { applyActionCode } from "firebase/auth"
import { Button } from "@workspace/ui/components/button"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { auth } from "@/lib/firebase"

export const Route = createFileRoute("/verify-email")({
  // Tautan verifikasi Firebase membawa ?mode=verifyEmail&oobCode=...
  validateSearch: (search): { oobCode?: string } =>
    typeof search.oobCode === "string" ? { oobCode: search.oobCode } : {},
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { oobCode } = Route.useSearch()
  const [state, setState] = useState<"pending" | "done" | "failed">(
    oobCode ? "pending" : "failed"
  )

  useEffect(() => {
    if (!oobCode) return
    applyActionCode(auth, oobCode).then(
      () => setState("done"),
      () => setState("failed")
    )
  }, [oobCode])

  return (
    <AuthLayout
      title="Verifikasi email"
      description="Mengonfirmasi alamat email Anda."
    >
      <div className="space-y-4 text-sm">
        <p role="status">
          {state === "pending"
            ? "Memverifikasi…"
            : state === "done"
              ? "Email Anda sudah terverifikasi."
              : "Tautan ini tidak valid atau sudah kedaluwarsa."}
        </p>
        {state !== "pending" && (
          <Button asChild size="lg" className="w-full">
            <Link to="/admin/dashboard">Lanjutkan</Link>
          </Button>
        )}
      </div>
    </AuthLayout>
  )
}
