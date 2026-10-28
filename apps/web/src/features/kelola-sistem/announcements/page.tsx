/**
 * Halaman Pengumuman — mengikuti mockup announcements.html: Daftar
 * (Edit/Arsipkan/Terbitkan) + Buat Baru (Judul, Tipe, Isi, Target
 * Semua/Kantor/Departemen/Grup/Karyawan) + Pengaturan Pengiriman (push
 * saat diterbitkan, tampil di beranda, pinned). Logika mengikuti
 * announcementService.ts myadmin lama (RTDB, publish kirim push ke UID
 * target bila send_push).
 */
import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { FirebaseNotConfigured } from "../shared"
import type {
  Announcement,
  AnnouncementTargetType,
  AnnouncementType,
} from "@/lib/firebase-types"
import { formatDateTime } from "@/lib/display-utils"
import {
  archiveAnnouncement,
  createAnnouncement,
  publishAnnouncement,
  resolveAnnouncementTargetUids,
  restoreAnnouncement,
  updateAnnouncement,
  useAnnouncements,
  type AnnouncementForm,
  type AnnouncementsData,
} from "./api"

const TYPE_LABEL: Record<AnnouncementType, string> = {
  info: "Info",
  success: "Sukses",
  warning: "Peringatan",
  danger: "Penting",
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  published: "Terbit",
  scheduled: "Terjadwal",
  archived: "Diarsipkan",
}

const TARGET_TYPES: { id: AnnouncementTargetType; label: string }[] = [
  { id: "all", label: "Semua Karyawan" },
  { id: "office", label: "Kantor" },
  { id: "area", label: "Area" },
  { id: "department", label: "Departemen" },
  { id: "sub_department", label: "Sub Departemen" },
  { id: "group", label: "Grup Karyawan" },
  { id: "user", label: "Karyawan Tertentu" },
]

const EMPTY_FORM: AnnouncementForm = {
  title: "",
  body: "",
  type: "info",
  status: "draft",
  target_type: "all",
  target_ids: [],
  send_push: true,
  show_on_home: true,
  pinned: false,
  scheduled_at: null,
}

function targetOptions(data: AnnouncementsData, targetType: AnnouncementTargetType) {
  if (targetType === "office") return data.offices.map((o) => ({ id: o.id ?? "", label: o.name }))
  if (targetType === "area") return data.areas.map((a) => ({ id: a.id ?? "", label: a.name }))
  if (targetType === "department")
    return data.departments.map((d) => ({ id: d.id ?? "", label: d.name }))
  if (targetType === "sub_department")
    return data.subDepartments.map((s) => ({ id: s.id ?? "", label: s.name }))
  if (targetType === "group")
    return data.groups.map((g) => ({ id: g.id ?? "", label: g.name }))
  if (targetType === "user")
    return data.employees.map((e) => ({
      id: e.uid ?? e.id ?? "",
      label: `${e.nama_lengkap ?? e.email ?? e.uid ?? ""}${e.email ? ` (${e.email})` : ""}`,
    }))
  return []
}

function AnnouncementFormFields({
  data,
  form,
  onChange,
}: {
  data: AnnouncementsData
  form: AnnouncementForm
  onChange: (patch: Partial<AnnouncementForm>) => void
}) {
  const options = targetOptions(data, form.target_type)
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="ann-title">Judul</Label>
        <Input
          id="ann-title"
          required
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ann-type">Tipe</Label>
          <Select
            value={form.type}
            onValueChange={(v) => onChange({ type: v as AnnouncementType })}
          >
            <SelectTrigger id="ann-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABEL) as AnnouncementType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ann-target-type">Target</Label>
          <Select
            value={form.target_type}
            onValueChange={(v) =>
              onChange({
                target_type: v as AnnouncementTargetType,
                target_ids: [],
              })
            }
          >
            <SelectTrigger id="ann-target-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGET_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {form.target_type !== "all" && (
        <div className="grid gap-2">
          <Label>Pilih Target</Label>
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada data untuk target ini.
            </p>
          ) : (
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
              {options.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={form.target_ids.includes(o.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        target_ids:
                          checked === true
                            ? [...form.target_ids, o.id]
                            : form.target_ids.filter((id) => id !== o.id),
                      })
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="ann-body">Isi Pengumuman</Label>
        <Textarea
          id="ann-body"
          required
          rows={5}
          value={form.body}
          onChange={(e) => onChange({ body: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label>Pengaturan Pengiriman</Label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={form.send_push}
            onCheckedChange={(c) => onChange({ send_push: c === true })}
          />
          Kirim push saat diterbitkan
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={form.show_on_home}
            onCheckedChange={(c) => onChange({ show_on_home: c === true })}
          />
          Tampilkan di beranda karyawan
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={form.pinned}
            onCheckedChange={(c) => onChange({ pinned: c === true })}
          />
          Sematkan (pinned)
        </label>
      </div>
    </div>
  )
}

export function AnnouncementsPage() {
  const { companyId } = useCompanyScope()
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [createForm, setCreateForm] = useState<AnnouncementForm>(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<Announcement | null>(null)
  const [editForm, setEditForm] = useState<AnnouncementForm | null>(null)

  const announcementsQuery = useAnnouncements(companyId)
  const data = announcementsQuery.data
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["ks", "announcements", companyId],
    })

  const create = useMutation({
    mutationFn: async (form: AnnouncementForm) => {
      const id = await createAnnouncement(companyId, form, actor)
      if (form.status === "published" && id && data) {
        const targetUids = resolveAnnouncementTargetUids(
          data.employees,
          form.target_type,
          form.target_ids,
        )
        await publishAnnouncement(
          companyId,
          { ...form, id, company_id: companyId } as unknown as Announcement,
          targetUids,
          actor,
        )
      }
      return id
    },
    onSuccess: () => {
      toast.success("Pengumuman berhasil disimpan.")
      setCreateForm(EMPTY_FORM)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const update = useMutation({
    mutationFn: (args: { id: string; form: Partial<AnnouncementForm> }) =>
      updateAnnouncement(companyId, args.id, args.form),
    onSuccess: () => {
      toast.success("Pengumuman berhasil diubah.")
      setEditTarget(null)
      setEditForm(null)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const publish = useMutation({
    mutationFn: (announcement: Announcement) => {
      if (!data) throw new Error("Data karyawan belum dimuat.")
      const targetUids = resolveAnnouncementTargetUids(
        data.employees,
        announcement.target_type ?? "all",
        announcement.target_ids ?? [],
      )
      return publishAnnouncement(companyId, announcement, targetUids, actor)
    },
    onSuccess: () => {
      toast.success("Pengumuman diterbitkan.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const archive = useMutation({
    mutationFn: (id: string) => archiveAnnouncement(companyId, id, actor),
    onSuccess: () => {
      toast.success("Pengumuman diarsipkan.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const restore = useMutation({
    mutationFn: (id: string) => restoreAnnouncement(companyId, id, actor),
    onSuccess: () => {
      toast.success("Pengumuman dikembalikan ke draf.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data.announcements].sort(
      (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0),
    )
  }, [data])

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Pengumuman"
          description="Buat dan kelola pengumuman untuk karyawan."
        />
        <FirebaseNotConfigured title="Data pengumuman belum dapat dimuat." />
      </div>
    )

  const handleCreate = (e: FormEvent) => {
    e.preventDefault()
    create.mutate({ ...createForm, status: "draft" })
  }
  const handleEdit = (e: FormEvent) => {
    e.preventDefault()
    if (!editTarget || !editForm) return
    update.mutate({ id: editTarget.id ?? "", form: editForm })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengumuman"
        description="Buat dan kelola pengumuman untuk karyawan."
      />

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengumuman</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Judul</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={5}
                loading={announcementsQuery.isLoading}
                empty={sorted.length === 0}
                error={announcementsQuery.error as Error | null}
                emptyText="Belum ada pengumuman."
              />
              {sorted.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <p className="font-medium">{a.title}</p>
                    <p className="max-w-md truncate text-xs text-muted-foreground">
                      {a.body}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {TYPE_LABEL[a.type ?? "info"] ?? a.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        a.status === "published"
                          ? "default"
                          : a.status === "archived"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDateTime(a.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditTarget(a)
                          setEditForm({
                            title: a.title,
                            body: a.body,
                            type: a.type ?? "info",
                            status: a.status,
                            target_type: a.target_type ?? "all",
                            target_ids: a.target_ids ?? [],
                            send_push: a.send_push ?? true,
                            show_on_home: a.show_on_home ?? true,
                            pinned: a.pinned ?? false,
                            scheduled_at: a.scheduled_at ?? null,
                          })
                        }}
                      >
                        Ubah
                      </Button>
                      {a.status !== "published" && a.status !== "archived" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => publish.mutate(a)}
                          disabled={publish.isPending}
                        >
                          Terbitkan
                        </Button>
                      )}
                      {a.status === "archived" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => restore.mutate(a.id ?? "")}
                          disabled={restore.isPending}
                        >
                          Pulihkan
                        </Button>
                      ) : (
                        <ConfirmAction
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                            >
                              Arsipkan
                            </Button>
                          }
                          title="Arsipkan pengumuman?"
                          description={`Pengumuman "${a.title}" akan diarsipkan dan tidak tampil lagi.`}
                          confirmLabel="Arsipkan"
                          onConfirm={() => archive.mutate(a.id ?? "")}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buat Pengumuman Baru</CardTitle>
        </CardHeader>
        <CardContent>
          {data ? (
            <form onSubmit={handleCreate} className="grid gap-4">
              <AnnouncementFormFields
                data={data}
                form={createForm}
                onChange={(patch) => setCreateForm({ ...createForm, ...patch })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Menyimpan..." : "Simpan Draf"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={create.isPending}
                  onClick={() => {
                    create.mutate({ ...createForm, status: "published" })
                  }}
                >
                  Simpan & Terbitkan
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Memuat data...</p>
          )}
        </CardContent>
      </Card>

      {/* Dialog ubah pengumuman */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
            setEditForm(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ubah Pengumuman</DialogTitle>
          </DialogHeader>
          {data && editForm && (
            <form onSubmit={handleEdit} className="grid gap-4">
              <AnnouncementFormFields
                data={data}
                form={editForm}
                onChange={(patch) => setEditForm({ ...editForm, ...patch })}
              />
              <DialogFooter>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
