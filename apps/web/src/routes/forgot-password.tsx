import { useState, type FormEvent } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { MailCheckIcon } from "lucide-react"
import { sendPasswordResetEmail } from "firebase/auth"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { auth } from "@/lib/firebase"

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get("email"))
    setError(null)
    setPending(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setSentTo(email)
    } catch (err) {
      // Jawaban sama untuk semua email (anti-enumeration); hanya
      // pembatasan laju yang ditampilkan.
      const code = (err as { code?: string })?.code ?? ""
      if (code === "auth/too-many-requests")
        setError("Terlalu banyak percobaan. Coba lagi sebentar lagi.")
      else setSentTo(email)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title={sentTo ? "Periksa email Anda" : "Lupa kata sandi?"}
      description={
        sentTo
          ? "Ikuti tautan di email untuk memilih kata sandi baru."
          : "Masukkan email Anda dan kami akan mengirim tautan reset."
      }
      footer={
        <p className="text-center text-sm">
          <Link
            to="/login"
            className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Kembali ke halaman masuk
          </Link>
        </p>
      }
    >
      {sentTo ? (
        <div className="space-y-4">
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm"
          >
            <MailCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>
              Jika <span className="font-medium">{sentTo}</span> punya akun,
              kami sudah mengirim tautan reset.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => setSentTo(null)}
          >
            Gunakan email lain
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nama@perusahaan.com"
              required
              aria-invalid={!!error}
              aria-describedby={error ? "forgot-error" : undefined}
            />
          </div>
          {error && (
            <p
              id="forgot-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Mengirim…" : "Kirim tautan reset"}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
