/**
 * Halaman Organisasi — mengikuti mockup organization.html: 6 tab (Area,
 * Kantor, Departemen, Sub Departemen, Grup Karyawan, Pola), tabel + Tambah/
 * Ubah per tab, Kantor punya "Lihat Peta" + Lokasi & Radius (Leaflet),
 * Pola = form nama + jam masuk/keluar + hari kerja. Logika mengikuti
 * Organization.tsx myadmin lama (CRUD generik + guard dependensi +
 * pola jam reuse-timetable).
 *
 * Deviasi dari mockup: form "Tambah Pola" di sini berupa dialog dengan
 * pilihan Grup (di kode lama pola dibuat dari modal jadwal per grup).
 */
import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
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
import { ConfirmAction } from "@/components/confirm-action"
import { TableState } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { CompanySelect, FirebaseNotConfigured, Tabs } from "../shared"
import { SHIFT_DAY_KEYS, SHIFT_DAY_LABELS } from "@/lib/firebase-types"
import {
  addPattern,
  deleteEntity,
  deletePattern,
  ENTITY_LABEL,
  getDependencyUsage,
  isActiveRecord,
  saveEntity,
  toggleEntity,
  useOrganization,
  type EntityForm,
  type EntityType,
  type PatternForm,
} from "./api"
import { RadiusMapPicker } from "./radius-map-picker"

const ANY = "any"
const TABS = [
  { id: "area", label: "Area" },
  { id: "office", label: "Kantor" },
  { id: "department", label: "Departemen" },
  { id: "subdepartment", label: "Sub Departemen" },
  { id: "group", label: "Grup Karyawan" },
  { id: "pattern", label: "Pola" },
] as const

type TabId = (typeof TABS)[number]["id"]

const EMPTY_ENTITY_FORM: EntityForm = {
  name: "",
  area_id: "",
  office_id: "",
  department_id: "",
  sub_department_id: "",
  latitude: -6.18142435142701,
  longitude: 106.82099076217408,
  radius_meter: 300,
}

const EMPTY_PATTERN_FORM: PatternForm = {
  name: "",
  work_start: "08:00",
  work_end: "17:00",
  days: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
}

function statusBadge(active?: boolean) {
  return active !== false ? (
    <Badge variant="default">Aktif</Badge>
  ) : (
    <Badge variant="secondary">Nonaktif</Badge>
  )
}

export function OrganizationPage() {
  const { companies, companyId, isOwner, selectCompany } = useCompanyScope()
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabId>("area")
  const [entityModal, setEntityModal] = useState<{
    type: EntityType
    editingId: string | null
  } | null>(null)
  const [entityForm, setEntityForm] = useState<EntityForm>(EMPTY_ENTITY_FORM)
  const [patternOpen, setPatternOpen] = useState(false)
  const [patternForm, setPatternForm] = useState<PatternForm>(EMPTY_PATTERN_FORM)
  const [patternFormGroup, setPatternFormGroup] = useState("")
  const [mapView, setMapView] = useState<{
    latitude: number
    longitude: number
    radius_meter: number
    name: string
  } | null>(null)

  const orgQuery = useOrganization(companyId)
  const data = orgQuery.data
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ks", "organization", companyId] })

  const save = useMutation({
    mutationFn: (args: {
      type: EntityType
      editingId: string | null
      form: EntityForm
    }) => saveEntity(companyId, args.type, args.editingId, args.form, actor),
    onSuccess: (_, args) => {
      toast.success(
        `${ENTITY_LABEL[args.type]} berhasil ${args.editingId ? "diubah" : "ditambahkan"}.`,
      )
      setEntityModal(null)
      setEntityForm(EMPTY_ENTITY_FORM)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const toggle = useMutation({
    mutationFn: (args: { type: EntityType; id: string; active: boolean }) =>
      toggleEntity(companyId, args.type, args.id, args.active, actor),
    onSuccess: () => {
      toast.success("Status berhasil diubah.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const removeEntity = useMutation({
    mutationFn: (args: { type: EntityType; id: string }) =>
      deleteEntity(companyId, args.type, args.id),
    onSuccess: (_, args) => {
      toast.success(`${ENTITY_LABEL[args.type]} berhasil dihapus.`)
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal menghapus: ${e.message}`),
  })
  const addPatternMutation = useMutation({
    mutationFn: (args: { groupId: string; form: PatternForm }) =>
      addPattern(companyId, args.groupId, args.form, data?.timetables ?? [], actor),
    onSuccess: () => {
      toast.success("Berhasil menambah pola jam.")
      setPatternOpen(false)
      setPatternForm(EMPTY_PATTERN_FORM)
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const removePattern = useMutation({
    mutationFn: (args: { assignmentId: string; shiftId: string | null }) =>
      deletePattern(companyId, args.assignmentId, args.shiftId),
    onSuccess: () => {
      toast.success("Pola jam berhasil dihapus.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal menghapus pola: ${e.message}`),
  })

  const openEntity = (
    type: EntityType,
    editing?: {
      id?: string
      name: string
      area_id?: string
      office_id?: string
      department_id?: string
      sub_department_id?: string
      latitude?: number
      longitude?: number
      radius_meter?: number
    } | null,
  ) => {
    setEntityModal({ type, editingId: editing?.id ?? null })
    setEntityForm({
      name: editing?.name ?? "",
      area_id: editing?.area_id ?? "",
      office_id: editing?.office_id ?? "",
      department_id: editing?.department_id ?? "",
      sub_department_id: editing?.sub_department_id ?? "",
      latitude: editing?.latitude ?? -6.18142435142701,
      longitude: editing?.longitude ?? 106.82099076217408,
      radius_meter: editing?.radius_meter ?? 300,
    })
  }

  /** Guard dependensi lama sebelum nonaktifkan/hapus. */
  const guardOrRun = (
    type: EntityType,
    id: string,
    run: () => void,
  ): boolean => {
    if (!data) return false
    const usages = getDependencyUsage(data, type, id)
    if (usages.length > 0) {
      toast.error(
        `${ENTITY_LABEL[type]} masih dipakai oleh ${usages.join(", ")}. Pindahkan/nonaktifkan data terkait terlebih dahulu.`,
      )
      return false
    }
    run()
    return true
  }

  const patterns = useMemo(() => {
    if (!data) return []
    return data.assignments
      .filter((a) => a.type === "group" && isActiveRecord(a))
      .map((a) => {
        const shift = data.shifts.find((s) => s.id === a.shift_id)
        const group = data.groups.find((g) => g.id === a.target_id)
        const activeDays = SHIFT_DAY_KEYS.filter(
          (d) => shift?.days?.[d]?.active,
        )
        const timetableId = activeDays
          .map((d) => shift?.days?.[d]?.timetable_id)
          .find(Boolean)
        const timetable = data.timetables.find((t) => t.id === timetableId)
        return {
          assignmentId: a.id ?? "",
          shiftId: shift?.id ?? null,
          name: shift?.name ?? "—",
          groupName: group?.name ?? "—",
          workStart: timetable?.work_start ?? "—",
          workEnd: timetable?.work_end ?? "—",
          days: activeDays.map((d) => SHIFT_DAY_LABELS[d]),
        }
      })
  }, [data])

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Organisasi"
          description="Kelola area, kantor, departemen, grup karyawan, dan pola jam kerja."
        />
        <FirebaseNotConfigured title="Data organisasi belum dapat dimuat." />
      </div>
    )

  const handleEntitySubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!entityModal) return
    save.mutate({
      type: entityModal.type,
      editingId: entityModal.editingId,
      form: entityForm,
    })
  }
  const handlePatternSubmit = (e: FormEvent) => {
    e.preventDefault()
    addPatternMutation.mutate({ groupId: patternFormGroup, form: patternForm })
  }

  interface OrgRow {
    id?: string
    name: string
    active?: boolean
    area_id?: string
    office_id?: string
    department_id?: string
    sub_department_id?: string
    latitude?: number
    longitude?: number
    radius_meter?: number
  }

  const rowsFor = (type: EntityType): OrgRow[] => {
    if (!data) return []
    if (type === "area") return data.areas
    if (type === "office") return data.offices
    if (type === "department") return data.departments
    if (type === "subdepartment") return data.subDepartments
    return data.groups
  }

  const entityActions = (
    type: EntityType,
    item: {
      id?: string
      name: string
      active?: boolean
      area_id?: string
      office_id?: string
      department_id?: string
      sub_department_id?: string
      latitude?: number
      longitude?: number
      radius_meter?: number
    },
  ) => {
    const id = item.id ?? ""
    const isActive = item.active !== false
    return (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={() => openEntity(type, item)}>
          Ubah
        </Button>
        {type === "office" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setMapView({
                latitude: item.latitude ?? -6.18142435142701,
                longitude: item.longitude ?? 106.82099076217408,
                radius_meter: item.radius_meter ?? 300,
                name: item.name,
              })
            }
          >
            Lihat Peta
          </Button>
        )}
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="sm">
              {isActive ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          }
          title={isActive ? "Nonaktifkan data?" : "Aktifkan data?"}
          description={`${ENTITY_LABEL[type]} "${item.name}" akan ${isActive ? "dinonaktifkan" : "diaktifkan"}.`}
          confirmLabel={isActive ? "Nonaktifkan" : "Aktifkan"}
          onConfirm={() => {
            if (isActive) {
              guardOrRun(type, id, () =>
                toggle.mutate({ type, id, active: false }),
              )
            } else {
              toggle.mutate({ type, id, active: true })
            }
          }}
        />
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="sm" className="text-destructive">
              Hapus
            </Button>
          }
          title={`Hapus ${ENTITY_LABEL[type]}?`}
          description={`Hapus permanen ${ENTITY_LABEL[type]} "${item.name}"? Tindakan ini tidak dapat dibatalkan.`}
          confirmLabel="Hapus"
          onConfirm={() =>
            guardOrRun(type, id, () => removeEntity.mutate({ type, id }))
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisasi"
        description="Kelola area, kantor, departemen, grup karyawan, dan pola jam kerja."
        actions={
          isOwner ? (
            <CompanySelect
              companies={companies}
              value={companyId}
              onChange={selectCompany}
            />
          ) : undefined
        }
      />
      <Tabs tabs={[...TABS]} active={tab} onChange={(id) => setTab(id as TabId)} />

      {tab !== "pattern" && data && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-end">
              <Button
                onClick={() => openEntity(tab as EntityType, null)}
              >
                Tambah {ENTITY_LABEL[tab as EntityType]}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  {tab === "office" && <TableHead>Area</TableHead>}
                  {tab === "office" && <TableHead>Lokasi & Radius</TableHead>}
                  {tab === "department" && <TableHead>Kantor</TableHead>}
                  {tab === "subdepartment" && <TableHead>Departemen</TableHead>}
                  {tab === "group" && <TableHead>Departemen</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  colSpan={5}
                  loading={orgQuery.isLoading}
                  empty={rowsFor(tab as EntityType).length === 0}
                  error={orgQuery.error as Error | null}
                  emptyText={`Belum ada ${ENTITY_LABEL[tab as EntityType].toLowerCase()}.`}
                />
                {(rowsFor(tab as EntityType) as OrgRow[]).map(
                  (item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      {tab === "office" && (
                        <TableCell>
                          {data.areas.find((a) => a.id === item.area_id)?.name ?? "—"}
                        </TableCell>
                      )}
                      {tab === "office" && (
                        <TableCell>
                          {item.latitude !== undefined
                            ? `${item.latitude}, ${item.longitude} · ${item.radius_meter ?? "—"} m`
                            : "—"}
                        </TableCell>
                      )}
                      {tab === "department" && (
                        <TableCell>
                          {data.offices.find((o) => o.id === item.office_id)?.name ?? "—"}
                        </TableCell>
                      )}
                      {tab === "subdepartment" && (
                        <TableCell>
                          {data.departments.find((d) => d.id === item.department_id)?.name ?? "—"}
                        </TableCell>
                      )}
                      {tab === "group" && (
                        <TableCell>
                          {data.departments.find((d) => d.id === item.department_id)?.name ?? "—"}
                        </TableCell>
                      )}
                      <TableCell>{statusBadge(item.active)}</TableCell>
                      <TableCell className="text-right">
                        {entityActions(tab as EntityType, item)}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "pattern" && data && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-end">
              <Dialog open={patternOpen} onOpenChange={setPatternOpen}>
                <DialogTrigger asChild>
                  <Button>Tambah Pola</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Tambah Pola Jam</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handlePatternSubmit} className="grid gap-4">
                    <div className="grid gap-1.5">
                      <Label htmlFor="pattern-group">Grup Karyawan</Label>
                      <Select
                        value={patternFormGroup || ANY}
                        onValueChange={(v) =>
                          setPatternFormGroup(v === ANY ? "" : v)
                        }
                      >
                        <SelectTrigger id="pattern-group">
                          <SelectValue placeholder="Pilih grup" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.groups.map((g) => (
                            <SelectItem key={g.id} value={g.id ?? ""}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="pattern-name">Nama Pola</Label>
                      <Input
                        id="pattern-name"
                        value={patternForm.name}
                        onChange={(e) =>
                          setPatternForm({ ...patternForm, name: e.target.value })
                        }
                        placeholder="cth. Shift Pagi"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="pattern-start">Jam Masuk</Label>
                        <Input
                          id="pattern-start"
                          type="time"
                          required
                          value={patternForm.work_start}
                          onChange={(e) =>
                            setPatternForm({
                              ...patternForm,
                              work_start: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="pattern-end">Jam Keluar</Label>
                        <Input
                          id="pattern-end"
                          type="time"
                          required
                          value={patternForm.work_end}
                          onChange={(e) =>
                            setPatternForm({
                              ...patternForm,
                              work_end: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>Hari Kerja</Label>
                      <div className="flex flex-wrap gap-4">
                        {SHIFT_DAY_KEYS.map((d) => (
                          <label
                            key={d}
                            className="flex cursor-pointer items-center gap-1.5 text-sm"
                          >
                            <Checkbox
                              checked={patternForm.days[d]}
                              onCheckedChange={(checked) =>
                                setPatternForm({
                                  ...patternForm,
                                  days: {
                                    ...patternForm.days,
                                    [d]: checked === true,
                                  },
                                })
                              }
                            />
                            {SHIFT_DAY_LABELS[d]}
                          </label>
                        ))}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        type="submit"
                        disabled={addPatternMutation.isPending || !patternFormGroup}
                      >
                        {addPatternMutation.isPending ? "Menyimpan..." : "Simpan"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama Pola</TableHead>
                  <TableHead>Grup</TableHead>
                  <TableHead>Jam Kerja</TableHead>
                  <TableHead>Hari Kerja</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  colSpan={5}
                  loading={orgQuery.isLoading}
                  empty={patterns.length === 0}
                  error={orgQuery.error as Error | null}
                  emptyText="Belum ada pola jam."
                />
                {patterns.map((p) => (
                  <TableRow key={p.assignmentId}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.groupName}</TableCell>
                    <TableCell>
                      {p.workStart} – {p.workEnd}
                    </TableCell>
                    <TableCell>{p.days.join(", ") || "—"}</TableCell>
                    <TableCell className="text-right">
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive">
                            Hapus
                          </Button>
                        }
                        title="Hapus Pola Jam?"
                        description={`Hapus pola jam "${p.name}"? Penerapan jadwal ke grup ini akan dicabut.`}
                        confirmLabel="Hapus"
                        onConfirm={() =>
                          removePattern.mutate({
                            assignmentId: p.assignmentId,
                            shiftId: p.shiftId,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Dialog tambah/ubah entitas */}
      <Dialog
        open={entityModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEntityModal(null)
            setEntityForm(EMPTY_ENTITY_FORM)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {entityModal
                ? `${entityModal.editingId ? "Ubah" : "Tambah"} ${ENTITY_LABEL[entityModal.type]}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          {entityModal && data && (
            <form onSubmit={handleEntitySubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="entity-name">Nama</Label>
                <Input
                  id="entity-name"
                  required
                  value={entityForm.name}
                  onChange={(e) =>
                    setEntityForm({ ...entityForm, name: e.target.value })
                  }
                />
              </div>
              {(entityModal.type === "office" ||
                entityModal.type === "department" ||
                entityModal.type === "group") && (
                <div className="grid gap-1.5">
                  <Label htmlFor="entity-area">Area</Label>
                  <Select
                    value={entityForm.area_id || ANY}
                    onValueChange={(v) =>
                      setEntityForm({
                        ...entityForm,
                        area_id: v === ANY ? "" : v,
                        office_id: "",
                        department_id: "",
                        sub_department_id: "",
                      })
                    }
                  >
                    <SelectTrigger id="entity-area">
                      <SelectValue placeholder="Pilih area" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Tanpa area</SelectItem>
                      {data.areas.map((a) => (
                        <SelectItem key={a.id} value={a.id ?? ""}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {entityModal.type === "office" && (
                <div className="grid gap-1.5">
                  <Label>Lokasi & Radius Presensi</Label>
                  <RadiusMapPicker
                    value={{
                      latitude: entityForm.latitude,
                      longitude: entityForm.longitude,
                      radius_meter: entityForm.radius_meter,
                    }}
                    onChange={(next) =>
                      setEntityForm({
                        ...entityForm,
                        latitude: next.latitude,
                        longitude: next.longitude,
                        radius_meter: next.radius_meter,
                      })
                    }
                  />
                </div>
              )}
              {(entityModal.type === "department" ||
                entityModal.type === "subdepartment" ||
                entityModal.type === "group") && (
                <div className="grid gap-1.5">
                  <Label htmlFor="entity-office">Kantor</Label>
                  <Select
                    value={entityForm.office_id || ANY}
                    onValueChange={(v) =>
                      setEntityForm({
                        ...entityForm,
                        office_id: v === ANY ? "" : v,
                        department_id: "",
                        sub_department_id: "",
                      })
                    }
                  >
                    <SelectTrigger id="entity-office">
                      <SelectValue placeholder="Pilih kantor" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.offices
                        .filter(
                          (o) =>
                            !entityForm.area_id || o.area_id === entityForm.area_id,
                        )
                        .map((o) => (
                          <SelectItem key={o.id} value={o.id ?? ""}>
                            {o.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {(entityModal.type === "subdepartment" ||
                entityModal.type === "group") && (
                <div className="grid gap-1.5">
                  <Label htmlFor="entity-dept">Departemen</Label>
                  <Select
                    value={entityForm.department_id || ANY}
                    onValueChange={(v) =>
                      setEntityForm({
                        ...entityForm,
                        department_id: v === ANY ? "" : v,
                        sub_department_id: "",
                      })
                    }
                  >
                    <SelectTrigger id="entity-dept">
                      <SelectValue placeholder="Pilih departemen" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.departments
                        .filter(
                          (d) =>
                            !entityForm.office_id ||
                            d.office_id === entityForm.office_id,
                        )
                        .map((d) => (
                          <SelectItem key={d.id} value={d.id ?? ""}>
                            {d.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {entityModal.type === "group" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="entity-sub">Sub Departemen (opsional)</Label>
                  <Select
                    value={entityForm.sub_department_id || ANY}
                    onValueChange={(v) =>
                      setEntityForm({
                        ...entityForm,
                        sub_department_id: v === ANY ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger id="entity-sub">
                      <SelectValue placeholder="Pilih sub departemen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Tanpa sub departemen</SelectItem>
                      {data.subDepartments
                        .filter(
                          (s) =>
                            !entityForm.department_id ||
                            s.department_id === entityForm.department_id,
                        )
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id ?? ""}>
                            {s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog lihat peta kantor (tampilan saja) */}
      <Dialog
        open={mapView !== null}
        onOpenChange={(open) => {
          if (!open) setMapView(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Peta — {mapView?.name ?? ""}</DialogTitle>
          </DialogHeader>
          {mapView && (
            <div className="grid gap-3">
              <RadiusMapPicker
                value={mapView}
                onChange={() => undefined}
                height={320}
              />
              <p className="text-xs text-muted-foreground">
                Tampilan saja — ubah lokasi dan radius lewat tombol Ubah.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
