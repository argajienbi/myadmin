/**
 * Halaman Laporan — mengikuti mockup reports.html: filter (Perusahaan,
 * Jenis Laporan, Dari/Sampai, Kantor, Departemen, Grup, Jabatan, Status),
 * Ambil Data, Export Excel/PDF, tab Laporan Presensi + Laporan
 * Perizinan/Cuti, ringkasan. Data dibuka LANGSUNG dari RTDB saat halaman
 * dibuka (tanpa mode Legacy): presensi lean per tanggal (maks 31 hari) +
 * perizinan/QR/lembur langsung dari root perusahaan.
 *
 * Deviasi dari mockup: tabel Presensi dikelompokkan per karyawan per
 * tanggal (Jam In–Out dalam satu baris) karena record presensi lama
 * tersimpan per aksi (check-in / check-out terpisah).
 */
import { useEffect, useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
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
import { TableState } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { localDateString } from "@/lib/rtdb-lean-service"
import { CompanySelect, FirebaseNotConfigured, Tabs } from "../shared"
import type { Position } from "@/lib/firebase-types"
import { formatDate } from "@/lib/display-utils"
import {
  auditExport,
  exportToExcel,
  exportToPdf,
  fetchReportData,
  useReportsMeta,
  type AttendanceRow,
  type LeaveRequestRow,
  type ReportData,
} from "./api"

const ANY = "any"
const POSITIONS: Position[] = [
  "MANAGER",
  "ADMIN",
  "SPV",
  "LEADER",
  "CREW",
  "USER",
  "OWNER",
]

function defaultStart(): string {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return localDateString(d)
}

function minuteOfDay(value: string): number | null {
  const [h, m] = String(value || "").split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function durationMinute(start: string, end: string): number {
  const s = minuteOfDay(start)
  const e = minuteOfDay(end)
  if (s === null || e === null) return 0
  return e >= s ? e - s : e + 1440 - s
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return "-"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h <= 0) return `${minutes} menit`
  if (m <= 0) return `${h} jam`
  return `${h} jam ${m} menit`
}

function isApproved(status: unknown): boolean {
  const value = String(status || "").toLowerCase()
  return value === "approved" || value === "validated"
}

interface GroupedRow {
  key: string
  record_date: string
  user_name: string
  nip: string
  position: string
  method: string
  checkIn: string
  checkOut: string
  durationMinute: number
  status: string
  office_id?: string
  department_id?: string
  group_id?: string
  late_minute: number
}

export function ReportsPage() {
  const { companies, companyId, isOwner, selectCompany } = useCompanyScope()
  const actor = useCurrentActor()
  const [reportType, setReportType] = useState<"presensi" | "perizinan">(
    "presensi",
  )
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(localDateString())
  const [officeFilter, setOfficeFilter] = useState(ANY)
  const [deptFilter, setDeptFilter] = useState(ANY)
  const [groupFilter, setGroupFilter] = useState(ANY)
  const [positionFilter, setPositionFilter] = useState(ANY)
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [hasFetched, setHasFetched] = useState(false)

  const metaQuery = useReportsMeta(companyId)
  const meta = metaQuery.data

  const fetchData = useMutation({
    mutationFn: async () => {
      if (!meta) throw new Error("Metadata belum dimuat.")
      return fetchReportData(companyId, startDate, endDate, meta)
    },
    onSuccess: (data) => {
      setReportData(data)
      setHasFetched(true)
      toast.success(`${data.attendances.length} record presensi dimuat.`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const loading = fetchData.isPending

  // Data dibuka langsung saat halaman siap (tanpa mode Legacy).
  useEffect(() => {
    if (!meta || hasFetched || loading) return
    fetchData.mutate()
    // Sekali saat meta siap; refresh berikutnya lewat tombol Ambil Data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, hasFetched])

  const grouped = useMemo<GroupedRow[]>(() => {
    if (!reportData) return []
    const map = new Map<string, GroupedRow>()
    for (const row of reportData.attendances) {
      const key = `${row.record_uid}_${row.record_date}`
      const existing = map.get(key)
      const action = String(row.record_action ?? row.action_type ?? "")
      const time = (row.record_time ?? "").slice(0, 5)
      if (!existing) {
        map.set(key, {
          key,
          record_date: row.record_date,
          user_name: row.user_name,
          nip: row.nip,
          position: row.position,
          method: row.method ?? "-",
          checkIn: action === "check_in" ? time : "",
          checkOut: action === "check_out" ? time : "",
          durationMinute: Number(row.total_work_minute ?? 0),
          status: row.attendance_status ?? "-",
          office_id: row.office_id,
          department_id: row.department_id,
          group_id: row.group_id,
          late_minute: Number(row.late_minute ?? 0),
        })
      } else {
        if (action === "check_in" && !existing.checkIn) {
          existing.checkIn = time
          existing.status = row.attendance_status ?? existing.status
          existing.late_minute = Number(row.late_minute ?? 0)
        }
        if (action === "check_out") existing.checkOut = time
        if (Number(row.total_work_minute ?? 0) > existing.durationMinute)
          existing.durationMinute = Number(row.total_work_minute ?? 0)
      }
    }
    const rows = [...map.values()]
    for (const r of rows) {
      if (!r.durationMinute && r.checkIn && r.checkOut)
        r.durationMinute = durationMinute(r.checkIn, r.checkOut)
    }
    rows.sort((a, b) => b.record_date.localeCompare(a.record_date))
    return rows
  }, [reportData])

  const filtered = useMemo(() => {
    return grouped.filter((r) => {
      if (officeFilter !== ANY && r.office_id !== officeFilter) return false
      if (deptFilter !== ANY && r.department_id !== deptFilter) return false
      if (groupFilter !== ANY && r.group_id !== groupFilter) return false
      if (positionFilter !== ANY && r.position !== positionFilter) return false
      if (statusFilter !== ANY && r.status !== statusFilter) return false
      return true
    })
  }, [grouped, officeFilter, deptFilter, groupFilter, positionFilter, statusFilter])

  const filteredLeave = useMemo(() => {
    if (!reportData) return []
    return reportData.leaveRequests.filter((x) => {
      const date = x.tanggal_mulai ?? x.date ?? ""
      if (startDate && date < startDate) return false
      if (endDate && date > endDate) return false
      return true
    })
  }, [reportData, startDate, endDate])

  const overtimeRows = useMemo(() => {
    if (!reportData) return []
    const approved = reportData.leaveRequests
      .filter((req) => {
        const type = String(req.type ?? req.leave_type ?? "").toLowerCase()
        return type === "lembur" && isApproved(req.status)
      })
      .map((req) => {
        const minutes =
          Number(req.overtime_duration_minute ?? 0) ||
          durationMinute(
            req.overtime_start_time ?? "",
            req.overtime_end_time ?? "",
          )
        return {
          id: req.request_id ?? req.id ?? "",
          date:
            req.overtime_date ?? req.date_start ?? req.tanggal_mulai ?? req.date ?? "-",
          user_name: req.user_name ?? req.nama_lengkap ?? req.employee_name ?? "-",
          uid: req.uid ?? "",
          time: `${req.overtime_start_time ?? "-"} - ${req.overtime_end_time ?? "-"}`,
          duration_minute: minutes,
          status: String(req.status ?? ""),
          source: "User Request",
        }
      })
    const scheduled = (reportData.attendances ?? [])
      .filter(
        (row: AttendanceRow) =>
          row.schedule_source === "overtime_schedule" ||
          row.overtime_flag === true,
      )
      .map((row: AttendanceRow) => ({
        id: row.id ?? `${row.record_uid}_${row.record_date}`,
        date: row.record_date ?? "-",
        user_name: row.user_name ?? "-",
        uid: row.record_uid ?? "",
        time: `${row.work_start ?? row.check_in_start ?? "-"} - ${row.work_end ?? row.check_out_end ?? "-"}`,
        duration_minute: durationMinute(
          row.work_start ?? row.check_in_start ?? "",
          row.work_end ?? row.check_out_end ?? "",
        ),
        status: "approved",
        source: "Jadwal Lembur",
      }))
    return [...approved, ...scheduled].filter((x) => {
      if (startDate && x.date < startDate) return false
      if (endDate && x.date > endDate) return false
      return true
    })
  }, [reportData, startDate, endDate])

  const summary = useMemo(() => {
    if (!reportData) return null
    return {
      total: filtered.length,
      hadir: filtered.filter((a) => a.status === "hadir").length,
      terlambat: filtered.filter((a) => a.status === "terlambat").length,
      totalLateMin: filtered.reduce((acc, c) => acc + c.late_minute, 0),
      leavePending: filteredLeave.filter((x) => x.status === "pending").length,
      leaveApproved: filteredLeave.filter((x) => isApproved(x.status)).length,
      leaveRejected: filteredLeave.filter((x) => x.status === "rejected").length,
      lemburApproved: overtimeRows.length,
      totalOTMin: overtimeRows.reduce((a, b) => a + (b.duration_minute || 0), 0),
    }
  }, [reportData, filtered, filteredLeave, overtimeRows])

  const handleExportExcel = () => {
    if (!reportData || !meta) return
    const filename = `laporan-${reportType}-${startDate}-sd-${endDate}`
    if (reportType === "presensi") {
      const data = filtered.map((r) => ({
        Nama: r.user_name,
        NIP: r.nip,
        Position: r.position,
        Tanggal: r.record_date,
        "Jam Masuk": r.checkIn,
        "Jam Keluar": r.checkOut,
        Method: r.method,
        Status: r.status,
        "Late Minute": r.late_minute,
        "Durasi (menit)": r.durationMinute,
        Office:
          meta.offices.find((o) => o.id === r.office_id)?.name ?? r.office_id ?? "",
        Department:
          meta.departments.find((d) => d.id === r.department_id)?.name ??
          r.department_id ??
          "",
        Group:
          meta.groups.find((g) => g.id === r.group_id)?.name ?? r.group_id ?? "",
      }))
      exportToExcel(data, filename)
    } else {
      const data = [
        ...filteredLeave.map((x) => ({
          Nama: x.user_name ?? x.nama_lengkap ?? x.employee_name ?? "-",
          Waktu: x.tanggal_mulai ?? x.date ?? "-",
          Tipe: x.type ?? x.leave_type ?? "-",
          Status: x.status ?? "-",
        })),
        ...overtimeRows.map((x) => ({
          Nama: x.user_name,
          Waktu: x.date,
          Tipe: `Lembur (${x.source})`,
          Status: x.status,
          "Durasi (menit)": x.duration_minute,
        })),
      ]
      exportToExcel(data, filename)
    }
    void auditExport(
      companyId,
      `Export laporan ${reportType} (Excel) periode ${startDate} s.d. ${endDate}`,
      actor,
    )
    toast.success("File Excel berhasil diunduh.")
  }

  const handleExportPdf = () => {
    if (!reportData) return
    const filename = `laporan-${reportType}-${startDate}-sd-${endDate}`
    if (reportType === "presensi") {
      exportToPdf(
        ["Tanggal", "Nama", "Jam In", "Jam Out", "Durasi", "Status"],
        filtered.map((r) => [
          r.record_date,
          r.user_name,
          r.checkIn || "-",
          r.checkOut || "-",
          formatDuration(r.durationMinute),
          r.status,
        ]),
        filename,
        `Laporan Presensi ${startDate} s.d. ${endDate}`,
      )
    } else {
      exportToPdf(
        ["Nama", "Waktu", "Tipe", "Status"],
        [
          ...filteredLeave.map((x) => [
            String(x.user_name ?? x.nama_lengkap ?? "-"),
            String(x.tanggal_mulai ?? x.date ?? "-"),
            String(x.type ?? x.leave_type ?? "-"),
            String(x.status ?? "-"),
          ]),
          ...overtimeRows.map((x) => [
            x.user_name,
            x.date,
            `Lembur (${x.source})`,
            x.status,
          ]),
        ],
        filename,
        `Laporan Perizinan/Cuti ${startDate} s.d. ${endDate}`,
      )
    }
    void auditExport(
      companyId,
      `Export laporan ${reportType} (PDF) periode ${startDate} s.d. ${endDate}`,
      actor,
    )
    toast.success("File PDF berhasil diunduh.")
  }

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Laporan"
          description="Laporan presensi dan perizinan/cuti karyawan."
        />
        <FirebaseNotConfigured title="Data laporan belum dapat dimuat." />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan"
        description="Laporan presensi dan perizinan/cuti karyawan."
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

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-2">
            <Select
              value={reportType}
              onValueChange={(v) =>
                setReportType(v as "presensi" | "perizinan")
              }
            >
              <SelectTrigger className="w-48" aria-label="Jenis laporan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="presensi">Laporan Presensi</SelectItem>
                <SelectItem value="perizinan">Laporan Perizinan/Cuti</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="rep-from">Dari</Label>
              <Input
                id="rep-from"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="rep-to">Sampai</Label>
              <Input
                id="rep-to"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Select value={officeFilter} onValueChange={setOfficeFilter}>
              <SelectTrigger className="w-44" aria-label="Filter kantor">
                <SelectValue placeholder="Semua Kantor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Kantor</SelectItem>
                {(meta?.offices ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id ?? ""}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-44" aria-label="Filter departemen">
                <SelectValue placeholder="Semua Departemen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Departemen</SelectItem>
                {(meta?.departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id ?? ""}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="w-44" aria-label="Filter grup">
                <SelectValue placeholder="Semua Grup" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Grup</SelectItem>
                {(meta?.groups ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id ?? ""}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={positionFilter} onValueChange={setPositionFilter}>
              <SelectTrigger className="w-44" aria-label="Filter jabatan">
                <SelectValue placeholder="Semua Jabatan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Jabatan</SelectItem>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44" aria-label="Filter status">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Semua Status</SelectItem>
                <SelectItem value="hadir">Hadir</SelectItem>
                <SelectItem value="terlambat">Terlambat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => fetchData.mutate()}
              disabled={loading || !startDate || !endDate}
            >
              {loading ? "Memuat..." : "Ambil Data"}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportExcel}
              disabled={!hasFetched}
            >
              Export Excel
            </Button>
            <Button
              variant="outline"
              onClick={handleExportPdf}
              disabled={!hasFetched}
            >
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Total: {summary.total}</Badge>
          <Badge variant="secondary">Hadir: {summary.hadir}</Badge>
          <Badge variant="secondary">Terlambat: {summary.terlambat}</Badge>
          <Badge variant="secondary">
            Total keterlambatan: {summary.totalLateMin} menit
          </Badge>
          <Badge variant="secondary">
            Perizinan pending: {summary.leavePending}
          </Badge>
          <Badge variant="secondary">
            Perizinan disetujui: {summary.leaveApproved}
          </Badge>
          <Badge variant="secondary">
            Perizinan ditolak: {summary.leaveRejected}
          </Badge>
          <Badge variant="secondary">
            Lembur disetujui: {summary.lemburApproved} (
            {formatDuration(summary.totalOTMin)})
          </Badge>
        </div>
      )}

      <Tabs
        tabs={[
          { id: "presensi", label: "Laporan Presensi" },
          { id: "perizinan", label: "Laporan Perizinan/Cuti" },
        ]}
        active={reportType}
        onChange={(id) => setReportType(id as "presensi" | "perizinan")}
      />

      <Card>
        <CardContent className="pt-6">
          {reportType === "presensi" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Jam In – Out</TableHead>
                  <TableHead>Durasi</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  colSpan={6}
                  loading={loading}
                  empty={filtered.length === 0}
                  emptyText={
                    hasFetched
                      ? "Tidak ada data presensi pada periode ini."
                      : "Klik Ambil Data untuk memuat laporan."
                  }
                />
                {filtered.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>{formatDate(r.record_date)}</TableCell>
                    <TableCell>
                      <p className="font-medium">{r.user_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.nip} · {r.position}
                      </p>
                    </TableCell>
                    <TableCell>{r.method}</TableCell>
                    <TableCell>
                      {r.checkIn || "-"} – {r.checkOut || "-"}
                    </TableCell>
                    <TableCell>{formatDuration(r.durationMinute)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "terlambat" ? "destructive" : "default"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama / NIP</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Jam Lembur</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  colSpan={5}
                  loading={loading}
                  empty={filteredLeave.length === 0 && overtimeRows.length === 0}
                  emptyText={
                    hasFetched
                      ? "Tidak ada data perizinan/cuti pada periode ini."
                      : "Klik Ambil Data untuk memuat laporan."
                  }
                />
                {filteredLeave.map((x: LeaveRequestRow) => (
                  <TableRow key={x.request_id ?? x.id}>
                    <TableCell>
                      <p className="font-medium">
                        {x.user_name ?? x.nama_lengkap ?? x.employee_name ?? "-"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {formatDate(x.tanggal_mulai ?? x.date ?? "")}
                    </TableCell>
                    <TableCell>{x.type ?? x.leave_type ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{x.status ?? "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      {x.overtime_start_time && x.overtime_end_time
                        ? `${x.overtime_start_time} - ${x.overtime_end_time}`
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
                {overtimeRows.map((x) => (
                  <TableRow key={`ot-${x.id}`}>
                    <TableCell>
                      <p className="font-medium">{x.user_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Lembur ({x.source})
                      </p>
                    </TableCell>
                    <TableCell>{formatDate(x.date)}</TableCell>
                    <TableCell>Lembur</TableCell>
                    <TableCell>
                      <Badge variant="outline">{x.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {x.time} · {formatDuration(x.duration_minute)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
