import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthLayout } from "@/features/auth/components/auth-layout"
import { LoginForm } from "@/features/auth/components/login-form"
import { settledStatus } from "@/lib/auth-context"

const isInternalPath = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//")

export const Route = createFileRoute("/login")({
  validateSearch: (search): { redirect?: string } =>
    isInternalPath(search.redirect) ? { redirect: search.redirect } : {},
  beforeLoad: async ({ context }) => {
    if ((await settledStatus(context.auth)) === "authenticated") {
      throw redirect({ to: "/admin/dashboard" })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch()
  return (
    <AuthLayout
      title="Masuk ke akun Anda"
      description="Masukkan email dan kata sandi untuk mengakses dashboard."
      footer={
        <p className="text-center text-xs text-muted-foreground">
          Belum punya akun? Minta admin untuk mengundang Anda.
        </p>
      }
    >
      <LoginForm redirectTo={redirectTo} />
    </AuthLayout>
  )
}
