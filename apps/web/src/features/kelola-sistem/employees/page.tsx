/**
 * Halaman Karyawan — mengikuti mockup employees.html: pencarian + filter
 * Kantor/Departemen/Status, tabel Nama/Email, Struktur Organisasi, Status,
 * Aksi (Ubah, Nonaktifkan/Aktifkan), paginasi. Logika tulis mengikuti
 * Employees.tsx myadmin lama (secondary app saat tambah, tulis ganda
 * users + company_users, mirror Firestore, audit, reset wajah/perangkat,
 * transfer + log).
 */
import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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
import {
  Pagination,
  TableState,
  useDebounced,
} from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { FirebaseNotConfigured } from "../shared"
import { isFirebaseConfigured } from "@/lib/firebase"
import type {
  AccountStatus,
  CompanyUser,
  Position,
} from "@/lib/firebase-types"
import {
  createEmployee,
  resetEmployeeDevice,
  resetEmployeeFace,
  setEmployeeStatus,
  transferEmployee,
  updateEmployee,
  useEmployees,
  type EmployeeEditForm,
  type EmployeeForm,
  type EmployeesData,
  type TransferForm,
} from "./api"

const ANY = "any"
const PAGE_SIZE = 10
const POSITIONS: Position[] = [
  "MANAGER",
  "ADMIN",
  "SPV",
  "LEADER",
  "CREW",
  "USER",
  "OWNER",
]

const EMPTY_FORM: EmployeeForm = {
  nama_lengkap: "",
  email: "",
  password: "",
  nip: "",
  no_hp: "",
  position: "",
  area_id: "",
  office_id: "",
  department_id: "",
  sub_department_id: "",
  group_id: "",
}

function statusBadge(employee: CompanyUser) {
  const status = employee.status_akun ?? "pending"
  if (status === "active")
    return <Badge variant="default">Aktif</Badge>
  if (status === "pending")
    return <Badge variant="outline">Pending</Badge>
  if (status === "inactive")
    return <Badge variant="secondary">Nonaktif</Badge>
  return <Badge variant="destructive">Ditolak</Badge>
}

function hasSchedule(employee: CompanyUser, data: EmployeesData): boolean {
  const uid = employee.uid ?? employee.id ?? ""
  return data.assignments.some(
    (a) =>
      a.active !== false &&
      ((a.type === "user" && a.target_id === uid) ||
        (a.type === "group" && a.target_id === employee.group_id)),
  )
}

/** Select organisasi berantai: Area → Kantor → Departemen → Sub → Grup. */
function OrgSelects({
  data,
  value,
  onChange,
}: {
  data: EmployeesData
  value: Pick<
    EmployeeForm,
    "area_id" | "office_id" | "department_id" | "sub_department_id" | "group_id"
  >
  onChange: (patch: Partial<EmployeeForm>) => void
}) {
  const offices = data.offices.filter(
    (o) => !value.area_id || o.area_id === value.area_id,
  )
  const departments = data.departments.filter(
    (d) => !value.office_id || d.office_id === value.office_id,
  )
  const subs = data.subDepartments.filter(
    (s) => !value.department_id || s.department_id === value.department_id,
  )
  const groups = data.groups.filter(
    (g) => !value.department_id || g.department_id === value.department_id,
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor="emp-area">Area</Label>
        <Select
          value={value.area_id || ANY}
          onValueChange={(v) =>
            onChange({
              area_id: v === ANY ? "" : v,
              office_id: "",
              department_id: "",
              sub_department_id: "",
              group_id: "",
            })
          }
        >
          <SelectTrigger id="emp-area">
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
      <div className="grid gap-1.5">
        <Label htmlFor="emp-office">Kantor</Label>
        <Select
          value={value.office_id || ANY}
          onValueChange={(v) =>
            onChange({
              office_id: v === ANY ? "" : v,
              department_id: "",
              sub_department_id: "",
              group_id: "",
            })
          }
        >
          <SelectTrigger id="emp-office">
            <SelectValue placeholder="Pilih kantor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tanpa kantor</SelectItem>
            {offices.map((o) => (
              <SelectItem key={o.id} value={o.id ?? ""}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="emp-dept">Departemen</Label>
        <Select
          value={value.department_id || ANY}
          onValueChange={(v) =>
            onChange({
              department_id: v === ANY ? "" : v,
              sub_department_id: "",
              group_id: "",
            })
          }
        >
          <SelectTrigger id="emp-dept">
            <SelectValue placeholder="Pilih departemen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tanpa departemen</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id ?? ""}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="emp-sub">Sub Departemen</Label>
        <Select
          value={value.sub_department_id || ANY}
          onValueChange={(v) =>
            onChange({ sub_department_id: v === ANY ? "" : v })
          }
        >
          <SelectTrigger id="emp-sub">
            <SelectValue placeholder="Pilih sub departemen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tanpa sub departemen</SelectItem>
            {subs.map((s) => (
              <SelectItem key={s.id} value={s.id ?? ""}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="emp-group">Grup Karyawan</Label>
        <Select
          value={value.group_id || ANY}
          onValueChange={(v) => onChange({ group_id: v === ANY ? "" : v })}
        >
          <SelectTrigger id="emp-group">
            <SelectValue placeholder="Pilih grup" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tanpa grup</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id ?? ""}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function EmployeesPage() {
  const { companyId } = useCompanyScope()
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search)
  const [officeFilter, setOfficeFilter] = useState(ANY)
  const [deptFilter, setDeptFilter] = useState(ANY)
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<EmployeeForm>(EMPTY_FORM)
  const [editTarget, setEditTarget] = useState<CompanyUser | null>(null)
  const [editForm, setEditForm] = useState<EmployeeEditForm | null>(null)
  const [transferTarget, setTransferTarget] = useState<CompanyUser | null>(null)
  const [transferForm, setTransferForm] = useState<TransferForm>({
    area_id: "",
    office_id: "",
    department_id: "",
    sub_department_id: "",
    group_id: "",
    reason: "",
    effective_date: "",
  })

  const employeesQuery = useEmployees(companyId)
  const data = employeesQuery.data
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ks", "employees", companyId] })

  const create = useMutation({
    mutationFn: (form: EmployeeForm) => createEmployee(companyId, form, actor),
    onSuccess: () => {
      toast.success("Berhasil menambahkan karyawan.")
      setAddOpen(false)
      setAddForm(EMPTY_FORM)
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal menambahkan karyawan: ${e.message}`),
  })
  const update = useMutation({
    mutationFn: (args: { uid: string; form: EmployeeEditForm }) =>
      updateEmployee(companyId, args.uid, args.form, actor),
    onSuccess: () => {
      toast.success("Data karyawan berhasil diubah.")
      setEditTarget(null)
      setEditForm(null)
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal mengubah karyawan: ${e.message}`),
  })
  const toggleStatus = useMutation({
    mutationFn: (args: { uid: string; status: AccountStatus }) =>
      setEmployeeStatus(companyId, args.uid, args.status, actor),
    onSuccess: () => {
      toast.success("Status karyawan berhasil diubah.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal mengubah status: ${e.message}`),
  })
  const resetDevice = useMutation({
    mutationFn: (uid: string) => resetEmployeeDevice(companyId, uid, actor),
    onSuccess: () => {
      toast.success("Data perangkat berhasil direset.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal mereset perangkat: ${e.message}`),
  })
  const resetFace = useMutation({
    mutationFn: (uid: string) => resetEmployeeFace(companyId, uid, actor),
    onSuccess: () => {
      toast.success("Data wajah berhasil dihapus.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal menghapus data wajah: ${e.message}`),
  })
  const transfer = useMutation({
    mutationFn: (args: { employee: CompanyUser; form: TransferForm }) =>
      transferEmployee(companyId, args.employee, args.form, actor),
    onSuccess: () => {
      toast.success("Karyawan berhasil dipindahkan.")
      setTransferTarget(null)
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal memindahkan karyawan: ${e.message}`),
  })

  const filtered = useMemo(() => {
    if (!data) return []
    const q = debouncedSearch.trim().toLowerCase()
    return data.employees.filter((e) => {
      if (
        q &&
        !`${e.nama_lengkap ?? ""} ${e.email ?? ""} ${e.nip ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false
      if (officeFilter !== ANY && e.office_id !== officeFilter) return false
      if (deptFilter !== ANY && e.department_id !== deptFilter) return false
      if (statusFilter === "active" && e.status_akun !== "active") return false
      if (statusFilter === "inactive" && e.status_akun !== "inactive")
        return false
      if (statusFilter === "verified" && e.face_registered !== true)
        return false
      return true
    })
  }, [data, debouncedSearch, officeFilter, deptFilter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const openEdit = (employee: CompanyUser) => {
    setEditTarget(employee)
    setEditForm({
      nama_lengkap: employee.nama_lengkap ?? "",
      nip: employee.nip ?? "",
      no_hp: employee.no_hp ?? "",
      position: employee.position ?? "",
      status_akun: employee.status_akun ?? "pending",
      area_id: employee.area_id ?? "",
      office_id: employee.office_id ?? "",
      department_id: employee.department_id ?? "",
      sub_department_id: employee.sub_department_id ?? "",
      group_id: employee.group_id ?? "",
    })
  }
  const openTransfer = (employee: CompanyUser) => {
    setTransferTarget(employee)
    setTransferForm({
      area_id: employee.area_id ?? "",
      office_id: employee.office_id ?? "",
      department_id: employee.department_id ?? "",
      sub_department_id: employee.sub_department_id ?? "",
      group_id: employee.group_id ?? "",
      reason: "",
      effective_date: "",
    })
  }

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Karyawan"
          description="Kelola data karyawan, struktur organisasi, dan status akun."
        />
        <FirebaseNotConfigured title="Data karyawan belum dapat dimuat." />
      </div>
    )

  const handleAdd = (e: FormEvent) => {
    e.preventDefault()
    create.mutate(addForm)
  }
  const handleEdit = (e: FormEvent) => {
    e.preventDefault()
    if (!editTarget || !editForm) return
    update.mutate({ uid: editTarget.uid ?? editTarget.id ?? "", form: editForm })
  }
  const handleTransfer = (e: FormEvent) => {
    e.preventDefault()
    if (!transferTarget) return
    transfer.mutate({ employee: transferTarget, form: transferForm })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Karyawan"
        description="Kelola data karyawan, struktur organisasi, dan status akun."
        actions={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>Tambah Karyawan</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Tambah Karyawan</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAdd} className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="add-nama">Nama Lengkap</Label>
                    <Input
                      id="add-nama"
                      required
                      value={addForm.nama_lengkap}
                      onChange={(e) =>
                        setAddForm({ ...addForm, nama_lengkap: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="add-email">Email</Label>
                    <Input
                      id="add-email"
                      type="email"
                      required
                      value={addForm.email}
                      onChange={(e) =>
                        setAddForm({ ...addForm, email: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="add-password">Kata Sandi</Label>
                    <Input
                      id="add-password"
                      type="password"
                      required
                      minLength={6}
                      value={addForm.password}
                      onChange={(e) =>
                        setAddForm({ ...addForm, password: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="add-nip">NIP</Label>
                    <Input
                      id="add-nip"
                      value={addForm.nip}
                      onChange={(e) =>
                        setAddForm({ ...addForm, nip: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="add-hp">No. HP</Label>
                    <Input
                      id="add-hp"
                      value={addForm.no_hp}
                      onChange={(e) =>
                        setAddForm({ ...addForm, no_hp: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="add-position">Jabatan</Label>
                    <Select
                      value={addForm.position || ANY}
                      onValueChange={(v) =>
                        setAddForm({
                          ...addForm,
                          position: (v === ANY ? "" : v) as Position,
                        })
                      }
                    >
                      <SelectTrigger id="add-position">
                        <SelectValue placeholder="Pilih jabatan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ANY}>Tanpa jabatan</SelectItem>
                        {POSITIONS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {data && (
                  <OrgSelects
                    data={data}
                    value={addForm}
                    onChange={(patch) => setAddForm({ ...addForm, ...patch })}
                  />
                )}
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
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-64"
              placeholder="Cari nama, email, atau NIP..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            <Select
              value={officeFilter}
              onValueChange={(v) => {
                setOfficeFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48" aria-label="Filter kantor">
                <SelectValue placeholder="Semua Kantor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Kantor</SelectItem>
                {(data?.offices ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id ?? ""}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={deptFilter}
              onValueChange={(v) => {
                setDeptFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-48" aria-label="Filter departemen">
                <SelectValue placeholder="Semua Departemen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Departemen</SelectItem>
                {(data?.departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id ?? ""}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-44" aria-label="Filter status">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="verified">Terverifikasi</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama / Email</TableHead>
                <TableHead>Struktur Organisasi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={4}
                loading={employeesQuery.isLoading}
                empty={pageRows.length === 0}
                error={employeesQuery.error as Error | null}
                emptyText="Belum ada karyawan yang cocok dengan filter."
              />
              {data &&
                pageRows.map((e) => {
                  const office = data.offices.find((o) => o.id === e.office_id)
                  const dept = data.departments.find(
                    (d) => d.id === e.department_id,
                  )
                  const group = data.groups.find((g) => g.id === e.group_id)
                  const uid = e.uid ?? e.id ?? ""
                  const isActive = e.status_akun === "active"
                  return (
                    <TableRow key={uid}>
                      <TableCell>
                        <p className="font-medium">{e.nama_lengkap ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.email ?? ""}
                          {e.nip ? ` · ${e.nip}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">
                          {[office?.name, dept?.name].filter(Boolean).join(" — ") ||
                            "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {group?.name ?? ""}
                          {e.position ? ` · ${e.position}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {statusBadge(e)}
                          {!e.office_id && (
                            <Badge variant="outline">Belum ada kantor</Badge>
                          )}
                          {!e.group_id && (
                            <Badge variant="outline">Belum ada grup</Badge>
                          )}
                          {!hasSchedule(e, data) && (
                            <Badge variant="outline">Belum ada jadwal</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(e)}
                          >
                            Ubah
                          </Button>
                          <ConfirmAction
                            trigger={
                              <Button variant="ghost" size="sm">
                                {isActive ? "Nonaktifkan" : "Aktifkan"}
                              </Button>
                            }
                            title={
                              isActive
                                ? "Nonaktifkan karyawan?"
                                : "Aktifkan karyawan?"
                            }
                            description={`${e.nama_lengkap ?? ""} akan ${isActive ? "dinonaktifkan" : "diaktifkan"}.`}
                            confirmLabel={isActive ? "Nonaktifkan" : "Aktifkan"}
                            onConfirm={() =>
                              toggleStatus.mutate({
                                uid,
                                status: isActive ? "inactive" : "active",
                              })
                            }
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                Lainnya
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openTransfer(e)}>
                                Pindah Struktur
                              </DropdownMenuItem>
                              {e.face_registered && (
                                <DropdownMenuItem
                                  onClick={() => resetFace.mutate(uid)}
                                >
                                  Reset Wajah
                                </DropdownMenuItem>
                              )}
                              {e.device_id && (
                                <DropdownMenuItem
                                  onClick={() => resetDevice.mutate(uid)}
                                >
                                  Reset Perangkat
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            onPageChange={setPage}
            pageSize={PAGE_SIZE}
          />
        </CardContent>
      </Card>

      {/* Dialog ubah karyawan */}
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
            <DialogTitle>Ubah Karyawan</DialogTitle>
          </DialogHeader>
          {editForm && (
            <form onSubmit={handleEdit} className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-nama">Nama Lengkap</Label>
                  <Input
                    id="edit-nama"
                    required
                    value={editForm.nama_lengkap}
                    onChange={(e) =>
                      setEditForm({ ...editForm, nama_lengkap: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-nip">NIP</Label>
                  <Input
                    id="edit-nip"
                    value={editForm.nip}
                    onChange={(e) =>
                      setEditForm({ ...editForm, nip: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-hp">No. HP</Label>
                  <Input
                    id="edit-hp"
                    value={editForm.no_hp}
                    onChange={(e) =>
                      setEditForm({ ...editForm, no_hp: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-position">Jabatan</Label>
                  <Select
                    value={editForm.position || ANY}
                    onValueChange={(v) =>
                      setEditForm({
                        ...editForm,
                        position: (v === ANY ? "" : v) as Position,
                      })
                    }
                  >
                    <SelectTrigger id="edit-position">
                      <SelectValue placeholder="Pilih jabatan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY}>Tanpa jabatan</SelectItem>
                      {POSITIONS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-status">Status Akun</Label>
                  <Select
                    value={editForm.status_akun}
                    onValueChange={(v) =>
                      setEditForm({
                        ...editForm,
                        status_akun: v as AccountStatus,
                      })
                    }
                  >
                    <SelectTrigger id="edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                      <SelectItem value="rejected">Ditolak</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {data && (
                <OrgSelects
                  data={data}
                  value={editForm}
                  onChange={(patch) => setEditForm({ ...editForm, ...patch })}
                />
              )}
              <DialogFooter>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog pindah struktur */}
      <Dialog
        open={transferTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Pindah Struktur — {transferTarget?.nama_lengkap ?? ""}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTransfer} className="grid gap-4">
            {data && (
              <OrgSelects
                data={data}
                value={transferForm}
                onChange={(patch) =>
                  setTransferForm({ ...transferForm, ...patch })
                }
              />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="transfer-date">Tanggal Berlaku</Label>
                <Input
                  id="transfer-date"
                  type="date"
                  value={transferForm.effective_date}
                  onChange={(e) =>
                    setTransferForm({
                      ...transferForm,
                      effective_date: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="transfer-reason">Alasan</Label>
                <Input
                  id="transfer-reason"
                  value={transferForm.reason}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, reason: e.target.value })
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Perpindahan dicatat di log transfer dan karyawan menerima
              notifikasi.
            </p>
            <DialogFooter>
              <Button type="submit" disabled={transfer.isPending}>
                {transfer.isPending ? "Menyimpan..." : "Pindahkan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
