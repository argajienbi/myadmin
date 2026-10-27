/**
 * Halaman Pengaturan — mengikuti mockup settings.html: Informasi Pribadi
 * (nama, email, no HP), Keamanan Akun (sandi baru + ulangi), Website
 * Perusahaan, Branding (logo + Warna primer). Logika mengikuti
 * Settings.tsx myadmin lama (profil ke users + company_users, sandi via
 * Firebase Auth, website/branding field `company_*`, sinkronisasi user
 * ke Firestore).
 *
 * Deviasi dari mockup: form Website memakai field lengkap lama (aktif,
 * judul, URL, domain) — mockup hanya menyebut judul; "Warna primer"
 * adalah field baru `company_primary_color`.
 */
import { useRef, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { ConfirmAction } from "@/components/confirm-action"
import { PageHeader } from "@/components/page"
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { FirebaseNotConfigured } from "../shared"
import { domainsToText } from "@/lib/display-utils"
import {
  removeCompanyLogo,
  saveBranding,
  saveWebsite,
  uploadCompanyLogo,
  type WebsiteForm,
} from "../companies/api"
import {
  changePassword,
  savePrimaryColor,
  syncFirestoreUsersFromRtdb,
  updateProfile,
  useSettingsData,
} from "./api"

export function SettingsPage() {
  const { user } = useAuth()
  const { companyId, company } = useCompanyScope()
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [namaLengkap, setNamaLengkap] = useState("")
  const [noHp, setNoHp] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [websiteForm, setWebsiteForm] = useState<WebsiteForm>({
    website_enabled: false,
    website_title: "",
    website_url: "",
    website_allowed_domains: "",
  })
  const [logoEnabled, setLogoEnabled] = useState(true)
  const [primaryColor, setPrimaryColor] = useState("#0b7a8c")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const settingsQuery = useSettingsData(companyId, user?.email)
  const firebaseUser = settingsQuery.data?.firebaseUser ?? null
  const settingsCompany = settingsQuery.data?.company ?? company ?? null

  // Sinkronisasi form dari data query (pola "adjusting state during
  // render" React): isi ulang form saat profil/perusahaan berubah.
  const [prevFirebaseUser, setPrevFirebaseUser] = useState(firebaseUser)
  if (firebaseUser !== prevFirebaseUser) {
    setPrevFirebaseUser(firebaseUser)
    setNamaLengkap(firebaseUser?.nama_lengkap ?? "")
    setNoHp(firebaseUser?.no_hp ?? "")
  }
  const [prevSettingsCompany, setPrevSettingsCompany] =
    useState(settingsCompany)
  if (settingsCompany !== prevSettingsCompany) {
    setPrevSettingsCompany(settingsCompany)
    if (settingsCompany) {
      setWebsiteForm({
        website_enabled: settingsCompany.company_website_enabled ?? false,
        website_title: settingsCompany.company_website_title ?? "",
        website_url: settingsCompany.company_website_url ?? "",
        website_allowed_domains: domainsToText(
          settingsCompany.company_allowed_domains,
        ),
      })
      setLogoEnabled(settingsCompany.company_logo_enabled !== false)
      setPrimaryColor(settingsCompany.company_primary_color ?? "#0b7a8c")
    }
  }

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ks", "settings"] })

  const saveProfileMutation = useMutation({
    mutationFn: () => {
      if (!firebaseUser) throw new Error("Profil Firebase tidak ditemukan.")
      return updateProfile(
        firebaseUser.uid,
        firebaseUser.company_id,
        firebaseUser.role,
        { nama_lengkap: namaLengkap.trim(), no_hp: noHp.trim() },
      )
    },
    onSuccess: () => {
      toast.success("Profil berhasil diperbarui.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const changePasswordMutation = useMutation({
    mutationFn: () => changePassword(newPassword, confirmPassword),
    onSuccess: () => {
      toast.success("Password berhasil diperbarui.")
      setNewPassword("")
      setConfirmPassword("")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const saveWebsiteMutation = useMutation({
    mutationFn: () => saveWebsite(companyId, websiteForm, actor),
    onSuccess: () => {
      toast.success("Pengaturan website berhasil disimpan.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const saveBrandingMutation = useMutation({
    mutationFn: async () => {
      let logo = {
        logo_url: settingsCompany?.company_logo_url ?? "",
        logo_path: settingsCompany?.company_logo_path ?? "",
      }
      if (pendingFile) {
        const uploaded = await uploadCompanyLogo(companyId, pendingFile)
        logo = { logo_url: uploaded.url, logo_path: uploaded.path }
      }
      await saveBranding(
        companyId,
        { logo_enabled: logoEnabled, ...logo },
        actor,
      )
      await savePrimaryColor(companyId, primaryColor, actor)
    },
    onSuccess: () => {
      toast.success("Branding berhasil disimpan.")
      setPendingFile(null)
      setPreviewUrl(null)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const removeLogoMutation = useMutation({
    mutationFn: () =>
      removeCompanyLogo(
        companyId,
        settingsCompany?.company_logo_path,
        actor,
      ),
    onSuccess: () => {
      toast.success("Logo berhasil dihapus.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const syncMutation = useMutation({
    mutationFn: () => syncFirestoreUsersFromRtdb(companyId),
    onSuccess: (result) => {
      toast.success(
        `Sinkronisasi selesai: ${result.success}/${result.total} berhasil, ${result.failed} gagal.`,
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Pengaturan"
          description="Profil, keamanan akun, website, dan branding perusahaan."
        />
        <FirebaseNotConfigured title="Pengaturan belum dapat dimuat." />
      </div>
    )

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Pengaturan"
        description="Profil, keamanan akun, website, dan branding perusahaan."
      />

      <Card>
        <CardHeader>
          <CardTitle>Informasi Pribadi</CardTitle>
        </CardHeader>
        <CardContent>
          {firebaseUser ? (
            <form
              className="grid gap-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                saveProfileMutation.mutate()
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="settings-nama">Nama Lengkap</Label>
                <Input
                  id="settings-nama"
                  value={namaLengkap}
                  onChange={(e) => setNamaLengkap(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="settings-email">Email</Label>
                <Input
                  id="settings-email"
                  value={firebaseUser.email ?? user?.email ?? ""}
                  disabled
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="settings-hp">No. HP</Label>
                <Input
                  id="settings-hp"
                  value={noHp}
                  onChange={(e) => setNoHp(e.target.value)}
                />
              </div>
              <div>
                <Button type="submit" disabled={saveProfileMutation.isPending}>
                  {saveProfileMutation.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Profil Firebase tidak ditemukan untuk email {user?.email ?? "—"}.
              Data profil akan tersedia setelah login Firebase aktif.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keamanan Akun</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              changePasswordMutation.mutate()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="settings-pass">Kata Sandi Baru</Label>
              <Input
                id="settings-pass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="settings-pass-confirm">
                Ulangi Kata Sandi Baru
              </Label>
              <Input
                id="settings-pass-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Button type="submit" disabled={changePasswordMutation.isPending}>
                {changePasswordMutation.isPending ? "Menyimpan..." : "Ubah Sandi"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Minimal 6 karakter. Ubah sandi membutuhkan sesi Firebase aktif.
            </p>
          </form>
        </CardContent>
      </Card>

      {settingsCompany && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Website Perusahaan — {settingsCompany.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  saveWebsiteMutation.mutate()
                }}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={websiteForm.website_enabled}
                    onCheckedChange={(c) =>
                      setWebsiteForm({
                        ...websiteForm,
                        website_enabled: c === true,
                      })
                    }
                  />
                  Aktifkan website perusahaan
                </label>
                <div className="grid gap-1.5">
                  <Label htmlFor="settings-web-title">Judul Menu</Label>
                  <Input
                    id="settings-web-title"
                    value={websiteForm.website_title}
                    onChange={(e) =>
                      setWebsiteForm({
                        ...websiteForm,
                        website_title: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="settings-web-url">URL</Label>
                  <Input
                    id="settings-web-url"
                    inputMode="url"
                    value={websiteForm.website_url}
                    onChange={(e) =>
                      setWebsiteForm({
                        ...websiteForm,
                        website_url: e.target.value,
                      })
                    }
                    placeholder="https://contoh.com"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="settings-web-domains">
                    Domain yang Diizinkan (satu per baris)
                  </Label>
                  <Textarea
                    id="settings-web-domains"
                    rows={3}
                    value={websiteForm.website_allowed_domains}
                    onChange={(e) =>
                      setWebsiteForm({
                        ...websiteForm,
                        website_allowed_domains: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Button type="submit" disabled={saveWebsiteMutation.isPending}>
                    {saveWebsiteMutation.isPending
                      ? "Menyimpan..."
                      : "Simpan Website"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branding — {settingsCompany.name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={logoEnabled}
                  onCheckedChange={(c) => setLogoEnabled(c === true)}
                />
                Tampilkan logo perusahaan
              </label>
              {(previewUrl || settingsCompany.company_logo_url) && (
                <img
                  src={previewUrl ?? settingsCompany.company_logo_url}
                  alt={`Logo ${settingsCompany.name}`}
                  className="h-20 w-auto rounded border object-contain"
                />
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setPendingFile(file)
                  setPreviewUrl(URL.createObjectURL(file))
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  {settingsCompany.company_logo_url ? "Ganti Logo" : "Unggah Logo"}
                </Button>
                {settingsCompany.company_logo_url && (
                  <ConfirmAction
                    trigger={
                      <Button type="button" variant="outline">
                        Hapus Logo
                      </Button>
                    }
                    title="Hapus logo perusahaan?"
                    description={`Logo ${settingsCompany.name} akan dihapus dari Storage dan record perusahaan.`}
                    confirmLabel="Hapus"
                    onConfirm={() => removeLogoMutation.mutate()}
                  />
                )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="settings-color">Warna Primer</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="settings-color"
                    type="color"
                    className="h-10 w-16 p-1"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-32 font-mono"
                    aria-label="Kode warna primer"
                  />
                </div>
              </div>
              <div>
                <Button
                  type="button"
                  disabled={saveBrandingMutation.isPending}
                  onClick={() => saveBrandingMutation.mutate()}
                >
                  {saveBrandingMutation.isPending
                    ? "Menyimpan..."
                    : "Simpan Branding"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Format logo PNG, JPEG, atau WEBP, maksimal 2 MB.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sinkronisasi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Salin ulang seluruh user perusahaan dari RTDB ke Firestore
            (mirror). User yang sedang login disinkronkan pertama.
          </p>
          <Button
            variant="outline"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending
              ? "Menyinkronkan..."
              : "Sinkronkan User ke Firestore"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
