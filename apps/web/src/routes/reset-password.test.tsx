import { afterEach, describe, expect, it, vi } from "vitest"
import { ResetPasswordPage } from "./reset-password"
import { render, submit } from "../test-utils"

const state = vi.hoisted(() => ({
  confirmPasswordReset: vi.fn(),
  oobCode: "code" as string | undefined,
}))

vi.mock("@/features/auth/components/auth-layout", () => ({
  AuthLayout: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))
vi.mock("firebase/auth", () => ({
  confirmPasswordReset: state.confirmPasswordReset,
}))
vi.mock("@/lib/firebase", () => ({ auth: {} }))
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: unknown) => ({
    ...(cfg as object),
    useSearch: () => ({ oobCode: state.oobCode }),
  }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

afterEach(() => {
  state.confirmPasswordReset.mockReset()
  state.oobCode = "code"
  document.body.replaceChildren()
})

describe("ResetPasswordPage", () => {
  it("submits oobCode and new password", async () => {
    state.confirmPasswordReset.mockResolvedValue(undefined)
    await render(<ResetPasswordPage />)
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    await submit(document.querySelector("form")!)
    expect(state.confirmPasswordReset).toHaveBeenCalledWith(
      {},
      "code",
      "Password123!"
    )
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "direset"
    )
  })

  it("handles missing oobCode and Firebase error", async () => {
    state.oobCode = undefined
    await render(<ResetPasswordPage />)
    expect(document.body.textContent).toContain("Tautan reset tidak ditemukan")
    document.body.replaceChildren()
    state.oobCode = "code"
    state.confirmPasswordReset.mockRejectedValue({
      code: "auth/invalid-action-code",
    })
    await render(<ResetPasswordPage />)
    ;(document.querySelector("#password") as HTMLInputElement).value =
      "Password123!"
    await submit(document.querySelector("form")!)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "tidak valid atau sudah kedaluwarsa"
    )
  })
})
