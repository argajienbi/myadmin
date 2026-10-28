import { useState, type FormEvent } from "react"
import { SECURITY_POLICY } from "@workspace/contracts"
import { createFileRoute, Link } from "@tanstack/react-router"
import { confirmPasswordReset } from "firebase/auth"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { auth } from "@/lib/firebase"

export const Route = createFileRoute("/reset-password")({
  // Tautan reset Firebase membawa ?mode=resetPassword&oobCode=...
  validateSearch: (search): { oobCode?: string } =>
    typeof search.oobCode === "string" ? { oobCode: search.oobCode } : {},
  component: ResetPasswordPage,
})

export function ResetPasswordPage() {
  const { oobCode } = Route.useSearch()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!oobCode) return
    const form = new FormData(e.currentTarget)
    setError(null)
    setPending(true)
    try {
      await confirmPasswordReset(auth, oobCode, String(form.get("password")))
      setDone(true)
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ""
      if (
        code === "auth/expired-action-code" ||
        code === "auth/invalid-action-code"
      ) {
        setError(
          "Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru."
        )
      } else if (code === "auth/weak-password") {
        setError("Kata sandi terlalu lemah. Gunakan minimal 6 karakter.")
      } else {
        setError("Reset gagal")
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Reset kata sandi"
      description="Pilih kata sandi baru untuk akun Anda."
    >
      {!oobCode ? (
        <div className="space-y-4 text-sm">
          <p>Tautan reset tidak ditemukan.</p>
          <Button asChild size="lg" className="w-full">
            <Link to="/forgot-password">Minta tautan baru</Link>
          </Button>
        </div>
      ) : done ? (
        <div className="space-y-4 text-sm">
          <p role="status">Kata sandi Anda sudah direset.</p>
          <Button asChild size="lg" className="w-full">
            <Link to="/login">Kembali ke halaman masuk</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Kata sandi baru</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder={`Minimal ${SECURITY_POLICY.passwordMinLength} karakter`}
              minLength={SECURITY_POLICY.passwordMinLength}
              maxLength={SECURITY_POLICY.passwordMaxLength}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Mereset…" : "Reset kata sandi"}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
