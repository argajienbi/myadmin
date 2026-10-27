// Absensi — halaman Utama (Dewi).
// Mengikuti mockup attendance.html + logika Attendance.tsx lama
// (loadAttendanceByDateRange maks 31 hari, filter, foto via getFileUrl).
// Deviasi dari mockup (dicatat di laporan): mockup tidak menampilkan
// filter tanggal — ditambahkan input Dari/Sampai karena rentang tanggal
// adalah penggerak query di logika lama. Filter sub-departemen lama tidak
// ditampilkan (mockup hanya punya 8 filter).
import { useEffect, useMemo, useState } from "react"
import { get, ref } from "firebase/database"
import { Download, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { PageHeader } from "@/components/page"
import { useCompany } from "@/lib/use-company"
import { db, getFileUrl } from "@/lib/firebase"
import { paths } from "@/lib/firebase-paths"
import { getAttendanceStatus, getAttendanceStatusLabel, getLateMinutes, isCheckIn, isCheckOut } from "@/lib/attendance-utils"
import { loadAttendanceByDateRange, todayKey } from "@/lib/rtdb-lean-service"
import { type AttendanceRow } from "@/lib/rtdb-lean-service"
import { AvatarInitials, EmptyState, Field, StatusBadge } from "./ui"
import {
  downloadCsv,
  employeeName,
  formatTanggal,
  textValue,
} from "./format"

const PAGE_SIZE = 8

export interface AttendanceSearch {
  date?: string
  startDate?: string
  endDate?: string
  search?: string
  method?: string
  action?: string
  office?: string
  department?: string
  group?: string
  status?: string
  geofence?: string
}

type MasterRow = Record<string, unknown> & { id?: string; uid?: string }

function toMasterList(
  val: Record<string, unknown> | null,
  keyField: "id" | "uid"
): MasterRow[] {
  if (!val) return []
  return Object.keys(val).map((k) => ({
    ...((val[k] as Record<string, unknown>) || {}),
    [keyField]: k,
  }))
}

function statusTone(row: AttendanceRow): "success" | "warning" | "danger" {
  const status = getAttendanceStatus(row)
  if (
    status.includes("late") ||
    status.includes("terlambat") ||
    status.includes("telat")
  )
    return "warning"
  if (status.includes("luar_radius") || status.includes("luar radius"))
    return "danger"
  if (status.includes("early") || status.includes("pulang cepat"))
    return "warning"
  return "success"
}

function statusText(row: AttendanceRow): string {
  const status = getAttendanceStatus(row)
  if (
    status.includes("late") ||
    status.includes("terlambat") ||
    status.includes("telat")
  ) {
    const minutes = getLateMinutes(row)
    return minutes !== null ? `Terlambat ${minutes} mnt` : "Terlambat"
  }
  return getAttendanceStatusLabel(status)
}

export function AttendancePage({ search }: { search: AttendanceSearch }) {
  const { userData, companyId, loading: companyLoading } = useCompany()
  const [startDate, setStartDate] = useState(
    search.startDate || search.date || todayKey()
  )
  const [endDate, setEndDate] = useState(
    search.endDate || search.date || todayKey()
  )
  const [searchText, setSearchText] = useState(search.search || "")
  const [methodFilter, setMethodFilter] = useState(search.method || "all")
  const [actionFilter, setActionFilter] = useState(search.action || "all")
  const [officeFilter, setOfficeFilter] = useState(search.office || "all")
  const [departmentFilter, setDepartmentFilter] = useState(
    search.department || "all"
  )
  const [groupFilter, setGroupFilter] = useState(search.group || "all")
  const [statusFilter, setStatusFilter] = useState(
    search.status || "all"
  )
  const [geofenceFilter, setGeofenceFilter] = useState(
    search.geofence || "all"
  )
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [employees, setEmployees] = useState<MasterRow[]>([])
  const [offices, setOffices] = useState<MasterRow[]>([])
  const [departments, setDepartments] = useState<MasterRow[]>([])
  const [groups, setGroups] = useState<MasterRow[]>([])
  const [page, setPage] = useState(1)
  const [detailRow, setDetailRow] = useState<AttendanceRow | null>(null)
  const [detailPhotoUrl, setDetailPhotoUrl] = useState("")

  useEffect(() => {
    if (!companyId) return
    Promise.all([
      get(ref(db, paths.companyUsers(companyId))),
      get(ref(db, paths.offices(companyId))),
      get(ref(db, paths.departments(companyId))),
      get(ref(db, paths.employeeGroups(companyId))),
    ])
      .then(([usersSnap, officesSnap, deptsSnap, groupsSnap]) => {
        setEmployees(
          toMasterList(
            (usersSnap.val() as Record<string, unknown> | null) || null,
            "uid"
          )
        )
        setOffices(
          toMasterList(
            (officesSnap.val() as Record<string, unknown> | null) || null,
            "id"
          )
        )
        setDepartments(
          toMasterList(
            (deptsSnap.val() as Record<string, unknown> | null) || null,
            "id"
          )
        )
        setGroups(
          toMasterList(
            (groupsSnap.val() as Record<string, unknown> | null) || null,
            "id"
          )
        )
      })
      .catch((err: Error) => {
        toast.error(`Gagal memuat data master: ${err.message}`)
      })
  }, [companyId])

  const rangeKey = `${companyId}|${startDate}|${endDate}`
  const [loadedRangeKey, setLoadedRangeKey] = useState("")
  // loading diturunkan dari kunci rentang (bukan setState di dalam effect):
  // true selama data rentang berjalan belum selesai dimuat.
  const loading = !!companyId && loadedRangeKey !== rangeKey

  useEffect(() => {
    if (!companyId) return
    loadAttendanceByDateRange({ companyId, startDate, endDate })
      .then((loaded) => setRows(loaded))
      .catch((err: Error) => {
        toast.error(err.message || "Gagal memuat absensi.")
        setRows([])
      })
      .finally(() => setLoadedRangeKey(rangeKey))
  }, [companyId, startDate, endDate, rangeKey])

  const employeeByUid = useMemo(() => {
    const map = new Map<string, MasterRow>()
    employees.forEach((e) => map.set(String(e.uid), e))
    return map
  }, [employees])

  const filteredRows = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return rows.filter((row) => {
      const emp = employeeByUid.get(String(row.uid))
      const name = emp ? employeeName(emp) : String(row.uid || "")
      if (
        q &&
        !name.toLowerCase().includes(q) &&
        !String(row.dateKey || "").includes(q)
      )
        return false
      const method = String(row.method || "").toLowerCase()
      if (methodFilter !== "all" && method !== methodFilter) return false
      if (actionFilter === "masuk" && !isCheckIn(row)) return false
      if (actionFilter === "pulang" && !isCheckOut(row)) return false
      if (
        officeFilter !== "all" &&
        String(row.office_id || emp?.office_id || "") !== officeFilter
      )
        return false
      if (
        departmentFilter !== "all" &&
        String(row.department_id || emp?.department_id || "") !==
          departmentFilter
      )
        return false
      if (
        groupFilter !== "all" &&
        String(row.group_id || emp?.group_id || "") !== groupFilter
      )
        return false
      const status = getAttendanceStatus(row)
      if (statusFilter === "hadir") {
        if (
          !(
            status.includes("hadir") ||
            status === "success" ||
            status === ""
          )
        )
          return false
      } else if (statusFilter === "terlambat") {
        if (
          !(
            status.includes("late") ||
            status.includes("terlambat") ||
            status.includes("telat")
          )
        )
          return false
      } else if (statusFilter === "luar_radius") {
        if (
          !(status.includes("luar_radius") || status.includes("luar radius"))
        )
          return false
      } else if (statusFilter === "pulang_cepat") {
        if (!(status.includes("early") || status.includes("pulang cepat")))
          return false
      }
      const distance = Number(row.distance_meter || 0)
      const radius = Number(row.radius_meter || 0)
      const outside = radius > 0 && distance > radius
      if (geofenceFilter === "inside" && outside) return false
      if (geofenceFilter === "outside" && !outside) return false
      return true
    })
  }, [
    rows,
    searchText,
    methodFilter,
    actionFilter,
    officeFilter,
    departmentFilter,
    groupFilter,
    statusFilter,
    geofenceFilter,
    employeeByUid,
  ])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const openDetail = async (row: AttendanceRow) => {
    setDetailRow(row)
    setDetailPhotoUrl("")
    const url = await getFileUrl(
      String(row.photo_url || row.photo_path || "")
    )
    setDetailPhotoUrl(url)
  }

  const exportCsv = () => {
    downloadCsv(
      `absensi-${startDate}-sd-${endDate}.csv`,
      [
        "Karyawan",
        "Tanggal",
        "Waktu",
        "Jadwal",
        "Office",
        "Tipe",
        "Metode",
        "Radius",
        "Jarak",
        "Status",
      ],
      filteredRows.map((row) => {
        const emp = employeeByUid.get(String(row.uid))
        return [
          emp ? employeeName(emp) : String(row.uid || ""),
          String(row.dateKey || ""),
          String(row.record_time || row.waktu || row.time || ""),
          String(row.timetable_name || ""),
          String(row.office_name || ""),
          isCheckIn(row) ? "Masuk" : isCheckOut(row) ? "Pulang" : "",
          String(row.method || ""),
          String(row.radius_meter || ""),
          String(row.distance_meter || ""),
          statusText(row),
        ]
      })
    )
  }

  if (!userData && !companyLoading) {
    return (
      <EmptyState>
        <p>Silakan masuk untuk melihat absensi.</p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Absensi"
        description={`Rekam presensi harian — ${formatTanggal(startDate)}${endDate !== startDate ? ` s.d. ${formatTanggal(endDate)}` : ""}`}
        actions={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Ekspor CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Dari" className="w-40">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="Sampai" className="w-40">
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="Cari" className="min-w-56 flex-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Cari nama karyawan atau tanggal..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value)
                  setPage(1)
                }}
                className="pl-8"
              />
            </div>
          </Field>
          <Field label="Metode" className="w-40">
            <Select
              value={methodFilter}
              onValueChange={(v) => {
                setMethodFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Metode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Metode</SelectItem>
                <SelectItem value="selfie">Selfie</SelectItem>
                <SelectItem value="qr">QR</SelectItem>
                <SelectItem value="fingerprint">Fingerprint</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="correction">Koreksi</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Aksi" className="w-36">
            <Select
              value={actionFilter}
              onValueChange={(v) => {
                setActionFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Aksi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Aksi</SelectItem>
                <SelectItem value="masuk">Masuk</SelectItem>
                <SelectItem value="pulang">Pulang</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kantor" className="w-44">
            <Select
              value={officeFilter}
              onValueChange={(v) => {
                setOfficeFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Kantor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kantor</SelectItem>
                {offices.map((o) => (
                  <SelectItem key={String(o.id)} value={String(o.id)}>
                    {String(o.name || o.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Departemen" className="w-44">
            <Select
              value={departmentFilter}
              onValueChange={(v) => {
                setDepartmentFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Departemen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Departemen</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={String(d.id)} value={String(d.id)}>
                    {String(d.name || d.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Grup" className="w-40">
            <Select
              value={groupFilter}
              onValueChange={(v) => {
                setGroupFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Grup" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Grup</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={String(g.id)} value={String(g.id)}>
                    {String(g.name || g.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" className="w-40">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="hadir">Hadir</SelectItem>
                <SelectItem value="terlambat">Terlambat</SelectItem>
                <SelectItem value="luar_radius">Luar Radius</SelectItem>
                <SelectItem value="pulang_cepat">Pulang Cepat</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Geofence" className="w-44">
            <Select
              value={geofenceFilter}
              onValueChange={(v) => {
                setGeofenceFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Geofence" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Geofence</SelectItem>
                <SelectItem value="inside">Di Dalam Radius</SelectItem>
                <SelectItem value="outside">Di Luar Radius</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <EmptyState>
              <p>Memuat absensi...</p>
            </EmptyState>
          ) : pageRows.length === 0 ? (
            <EmptyState>
              <p>Tidak ada catatan absensi pada rentang ini.</p>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Karyawan</th>
                    <th className="px-4 py-3 font-medium">Tanggal / Waktu</th>
                    <th className="px-4 py-3 font-medium">Jadwal &amp; Office</th>
                    <th className="px-4 py-3 font-medium">Tipe / Metode</th>
                    <th className="px-4 py-3 font-medium">Radius &amp; Jarak</th>
                    <th className="px-4 py-3 font-medium">Status / Telat</th>
                    <th className="px-4 py-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((row) => {
                    const emp = employeeByUid.get(String(row.uid))
                    const radius = Number(row.radius_meter || 0)
                    const distance = Number(row.distance_meter || 0)
                    const outside = radius > 0 && distance > radius
                    return (
                      <tr
                        key={String(row.id)}
                        className="hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <AvatarInitials
                              name={emp ? employeeName(emp) : String(row.uid)}
                            />
                            <div>
                              <div className="font-medium">
                                {emp ? employeeName(emp) : String(row.uid)}
                              </div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {textValue(
                                  emp?.nip || row.nip,
                                  String(row.uid || "")
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{formatTanggal(String(row.dateKey || ""))}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {String(
                              row.record_time || row.waktu || row.time || ""
                            ).slice(0, 5)}{" "}
                            WIB
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            {row.work_start && row.work_end
                              ? `${String(row.work_start).slice(0, 5)} – ${String(row.work_end).slice(0, 5)}`
                              : textValue(row.timetable_name, "-")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {textValue(row.office_name, "-")}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone="neutral">
                            {isCheckIn(row)
                              ? "Masuk"
                              : isCheckOut(row)
                                ? "Pulang"
                                : String(row.action_type || "")}
                          </StatusBadge>{" "}
                          <span className="capitalize">
                            {textValue(row.method, "-")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono">
                            {radius > 0 ? `${radius} m · ${distance} m` : "-"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {radius > 0
                              ? outside
                                ? "Di luar radius"
                                : "Di dalam radius"
                              : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={statusTone(row)}>
                            {statusText(row)}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openDetail(row)}
                          >
                            Detail
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
          <span>
            Menampilkan{" "}
            {filteredRows.length === 0
              ? 0
              : (currentPage - 1) * PAGE_SIZE + 1}
            –{Math.min(currentPage * PAGE_SIZE, filteredRows.length)} dari{" "}
            {filteredRows.length} catatan
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              ← Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Berikutnya →
            </Button>
          </span>
        </div>
      </Card>

      <Dialog
        open={detailRow !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {detailRow && (
            <>
              <DialogHeader>
                <DialogTitle>Detail Absensi</DialogTitle>
                <DialogDescription>
                  {formatTanggal(String(detailRow.dateKey || ""))} ·{" "}
                  {String(
                    detailRow.record_time || detailRow.waktu || detailRow.time || ""
                  ).slice(0, 5)}{" "}
                  WIB
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 text-sm">
                {detailPhotoUrl && (
                  <a href={detailPhotoUrl} target="_blank" rel="noreferrer">
                    <img
                      src={detailPhotoUrl}
                      alt="Foto absensi"
                      className="max-h-72 w-full rounded object-cover"
                    />
                  </a>
                )}
                <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2">
                  <dt className="text-muted-foreground">Karyawan</dt>
                  <dd className="font-medium">
                    {(() => {
                      const emp = employeeByUid.get(String(detailRow.uid))
                      return emp ? employeeName(emp) : String(detailRow.uid)
                    })()}
                  </dd>
                  <dt className="text-muted-foreground">Aksi</dt>
                  <dd className="capitalize">
                    {isCheckIn(detailRow)
                      ? "Masuk"
                      : isCheckOut(detailRow)
                        ? "Pulang"
                        : String(detailRow.action_type || "")}
                  </dd>
                  <dt className="text-muted-foreground">Metode</dt>
                  <dd className="capitalize">
                    {textValue(detailRow.method, "-")}
                  </dd>
                  <dt className="text-muted-foreground">Jadwal</dt>
                  <dd>
                    {textValue(detailRow.timetable_name, "-")}
                    {detailRow.work_start && detailRow.work_end
                      ? ` (${String(detailRow.work_start).slice(0, 5)}–${String(detailRow.work_end).slice(0, 5)})`
                      : ""}
                  </dd>
                  <dt className="text-muted-foreground">Office</dt>
                  <dd>{textValue(detailRow.office_name, "-")}</dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{statusText(detailRow)}</dd>
                  <dt className="text-muted-foreground">Jarak / Radius</dt>
                  <dd>
                    {detailRow.distance_meter !== undefined
                      ? `${detailRow.distance_meter} m / ${detailRow.radius_meter || 0} m`
                      : "-"}
                  </dd>
                  <dt className="text-muted-foreground">Sumber</dt>
                  <dd>{textValue(detailRow.source, "-")}</dd>
                </dl>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
