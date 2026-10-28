/**
 * Halaman Perusahaan — mengikuti mockup companies.html: tabel perusahaan
 * (Nama, Branding, Website, Admin PT, Status, Aksi Edit + Kode Undangan),
 * Kode Undangan Aktif (Salin/Cabut), Website Perusahaan, dan Branding.
 * Logika mengikuti Companies.tsx myadmin lama (kode undangan 6 karakter,
 * website https, logo Storage maks 2 MB).
 */
import { useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Textarea } from "@workspace/ui/components/textarea"
import { ConfirmAction } from "@/components/confirm-action"
import { TableState } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { readList } from "@/lib/rtdb-read"
import { FirebaseNotConfigured } from "../shared"
import type { Company, UserIndex } from "@/lib/firebase-types"
import { domainsToText, formatDateTime } from "@/lib/display-utils"
import {
  createCompany,
  generateInviteCode,
  removeCompanyLogo,
  revokeInvite,
  saveBranding,
  saveWebsite,
  updateCompany,
  uploadCompanyLogo,
  useCompanies,
  type WebsiteForm,
} from "./api"

function WebsiteCard({ company }: { company: Company }) {
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<WebsiteForm>({
    website_enabled: company.company_website_enabled ?? false,
    website_title: company.company_website_title ?? "",
    website_url: company.company_website_url ?? "",
    website_allowed_domains: domainsToText(company.company_allowed_domains),
  })
  const save = useMutation({
    mutationFn: () => saveWebsite(company.id ?? "", form, actor),
    onSuccess: () => {
      toast.success("Pengaturan website berhasil disimpan.")
      void queryClient.invalidateQueries({ queryKey: ["ks", "companies"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Website Perusahaan</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={form.website_enabled}
              onCheckedChange={(c) =>
                setForm({ ...form, website_enabled: c === true })
              }
            />
            Aktifkan website perusahaan
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="web-title">Judul Menu</Label>
            <Input
              id="web-title"
              value={form.website_title}
              onChange={(e) =>
                setForm({ ...form, website_title: e.target.value })
              }
              placeholder="cth. Portal Perusahaan"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="web-url">URL</Label>
            <Input
              id="web-url"
              inputMode="url"
              value={form.website_url}
              onChange={(e) =>
                setForm({ ...form, website_url: e.target.value })
              }
              placeholder="https://contoh.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="web-domains">
              Domain yang Diizinkan (satu per baris)
            </Label>
            <Textarea
              id="web-domains"
              value={form.website_allowed_domains}
              onChange={(e) =>
                setForm({ ...form, website_allowed_domains: e.target.value })
              }
              rows={3}
            />
          </div>
          <div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Menyimpan..." : "Simpan Website"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function BrandingCard({ company }: { company: Company }) {
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [logoEnabled, setLogoEnabled] = useState(company.company_logo_enabled ?? false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ks", "companies"] })

  const save = useMutation({
    mutationFn: async () => {
      let logo = {
        logo_url: company.company_logo_url ?? "",
        logo_path: company.company_logo_path ?? "",
      }
      if (pendingFile) {
        const uploaded = await uploadCompanyLogo(company.id ?? "", pendingFile)
        logo = { logo_url: uploaded.url, logo_path: uploaded.path }
      }
      await saveBranding(
        company.id ?? "",
        { logo_enabled: logoEnabled, ...logo },
        actor,
      )
    },
    onSuccess: () => {
      toast.success("Branding berhasil disimpan.")
      setPendingFile(null)
      setPreviewUrl(null)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const removeLogo = useMutation({
    mutationFn: () =>
      removeCompanyLogo(company.id ?? "", company.company_logo_path, actor),
    onSuccess: () => {
      toast.success("Logo berhasil dihapus.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={logoEnabled}
              onCheckedChange={(c) => setLogoEnabled(c === true)}
            />
            Tampilkan logo perusahaan
          </label>
          {(previewUrl || company.company_logo_url) && (
            <img
              src={previewUrl ?? company.company_logo_url}
              alt={`Logo ${company.name}`}
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
              {company.company_logo_url ? "Ganti Logo" : "Unggah Logo"}
            </Button>
            {company.company_logo_url && (
              <ConfirmAction
                trigger={
                  <Button type="button" variant="outline">
                    Hapus Logo
                  </Button>
                }
                title="Hapus logo perusahaan?"
                description={`Logo ${company.name} akan dihapus dari Storage dan record perusahaan.`}
                confirmLabel="Hapus"
                onConfirm={() => removeLogo.mutate()}
              />
            )}
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Menyimpan..." : "Simpan Branding"}
            </Button>
          </div>
          {pendingFile && (
            <p className="text-xs text-muted-foreground">
              File dipilih: {pendingFile.name} — klik Simpan Branding untuk
              mengunggah.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Format PNG, JPEG, atau WEBP, maksimal 2 MB.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function CompaniesPage() {
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [editTarget, setEditTarget] = useState<Company | null>(null)
  const [editName, setEditName] = useState("")
  const [editActive, setEditActive] = useState(true)
  const [configCompanyId, setConfigCompanyId] = useState("")

  const companiesQuery = useCompanies()
  const data = companiesQuery.data
  const usersQuery = useQuery({
    queryKey: ["ks", "users-index"],
    queryFn: () => readList<UserIndex>("users"),
    enabled: isFirebaseConfigured(),
  })
  const usersById = new Map(
    (usersQuery.data ?? []).map((u) => [u.uid, u]),
  )
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ks", "companies"] })

  const create = useMutation({
    mutationFn: () => createCompany(newName, actor),
    onSuccess: () => {
      toast.success("Perusahaan berhasil dibuat.")
      setCreateOpen(false)
      setNewName("")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const update = useMutation({
    mutationFn: () =>
      updateCompany(
        editTarget?.id ?? "",
        { name: editName.trim(), active: editActive },
        actor,
      ),
    onSuccess: () => {
      toast.success("Perusahaan berhasil diubah.")
      setEditTarget(null)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const generateCode = useMutation({
    mutationFn: (company: Company) => generateInviteCode(company, actor),
    onSuccess: async (code) => {
      try {
        await navigator.clipboard.writeText(code)
        toast.success(`Kode undangan ${code} dibuat dan disalin.`)
      } catch {
        toast.success(`Kode undangan berhasil dibuat: ${code}`)
      }
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: (args: { code: string; companyId: string }) =>
      revokeInvite(args.code, args.companyId, actor),
    onSuccess: () => {
      toast.success("Kode undangan dicabut.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const configCompany =
    data?.companies.find((c) => c.id === configCompanyId) ??
    data?.companies[0]

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Perusahaan"
          description="Kelola perusahaan, kode undangan, website, dan branding."
        />
        <FirebaseNotConfigured title="Data perusahaan belum dapat dimuat." />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perusahaan"
        description="Kelola perusahaan, kode undangan, website, dan branding."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>Tambah Perusahaan</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Tambah Perusahaan</DialogTitle>
              </DialogHeader>
              <form
                className="grid gap-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  create.mutate()
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="company-name">Nama Perusahaan</Label>
                  <Input
                    id="company-name"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Menyimpan..." : "Simpan"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Branding</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Admin PT</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={6}
                loading={companiesQuery.isLoading}
                empty={(data?.companies.length ?? 0) === 0}
                error={companiesQuery.error as Error | null}
                emptyText="Belum ada perusahaan."
              />
              {data?.companies.map((c) => {
                const admin = c.admin_uid
                  ? usersById.get(c.admin_uid)
                  : undefined
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.company_logo_url ? (
                        <img
                          src={c.company_logo_url}
                          alt=""
                          className="h-8 w-auto rounded object-contain"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.company_website_url ? (
                        <a
                          href={c.company_website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm underline"
                        >
                          {c.company_website_title || c.company_website_url}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {admin?.nama_lengkap ?? admin?.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      {c.active !== false ? (
                        <Badge variant="default">Aktif</Badge>
                      ) : (
                        <Badge variant="secondary">Nonaktif</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditTarget(c)
                            setEditName(c.name)
                            setEditActive(c.active !== false)
                          }}
                        >
                          Ubah
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => generateCode.mutate(c)}
                          disabled={generateCode.isPending}
                        >
                          Kode Undangan
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kode Undangan Aktif</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Perusahaan</TableHead>
                <TableHead>Batas Waktu</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={4}
                loading={companiesQuery.isLoading}
                empty={
                  (data?.invites.filter((i) => i.active).length ?? 0) === 0
                }
                error={companiesQuery.error as Error | null}
                emptyText="Tidak ada kode undangan aktif."
              />
              {data?.invites
                .filter((i) => i.active)
                .map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-mono font-medium">
                      {invite.id}
                    </TableCell>
                    <TableCell>{invite.company_name ?? "—"}</TableCell>
                    <TableCell>
                      {invite.expired_at
                        ? formatDateTime(invite.expired_at)
                        : "Tanpa batas"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(invite.id ?? "")
                              toast.success("Kode disalin.")
                            } catch {
                              toast.error("Gagal menyalin kode.")
                            }
                          }}
                        >
                          Salin
                        </Button>
                        <ConfirmAction
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                            >
                              Cabut
                            </Button>
                          }
                          title="Cabut kode undangan?"
                          description={`Kode ${invite.id} tidak dapat dipakai lagi untuk mendaftar.`}
                          confirmLabel="Cabut"
                          onConfirm={() =>
                            revoke.mutate({
                              code: invite.id ?? "",
                              companyId: invite.company_id,
                            })
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {configCompany && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="config-company">Pengaturan untuk perusahaan</Label>
            <Select
              value={configCompany.id}
              onValueChange={setConfigCompanyId}
            >
              <SelectTrigger id="config-company" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data?.companies.map((c) => (
                  <SelectItem key={c.id} value={c.id ?? ""}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <WebsiteCard key={`web-${configCompany.id}`} company={configCompany} />
            <BrandingCard
              key={`brand-${configCompany.id}`}
              company={configCompany}
            />
          </div>
        </div>
      )}

      {/* Dialog ubah perusahaan */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ubah Perusahaan</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              update.mutate()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="edit-company-name">Nama Perusahaan</Label>
              <Input
                id="edit-company-name"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={editActive}
                onCheckedChange={(c) => setEditActive(c === true)}
              />
              Perusahaan aktif
            </label>
            <DialogFooter>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
