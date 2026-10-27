// Dashboard Presensi — halaman Utama (Dewi).
// Mengikuti mockup dashboard.html + logika Dashboard.tsx lama.
// Ringkasan dibaca LANGSUNG dari RTDB dan dihitung di klien saat halaman
// dibuka (tanpa node pre-computed dashboard_summary /
// pending_approval_summary dan tanpa tombol "Ambil Ringkasan"): proyek
// sudah Spark tanpa billing, jadi baca mentah tidak lagi berisiko biaya.
// Kartu "Terlambat Hari Ini" mengikuti mockup (di kode lama tempat ini
// masih placeholder "Papan Kedisiplinan").
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { format, isSameMonth, parseISO, subDays } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Calendar as CalendarIcon,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Flag,
  TrendingUp,
} from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
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
import { companyDisplayName } from "@/lib/display-utils"
import { getAttendanceStatus, getLateMinutes, isCheckIn } from "@/lib/attendance-utils"
import { manualGet } from "@/lib/rtdb-data-gate"
import { loadAttendanceByDateRange, todayKey } from "@/lib/rtdb-lean-service"
import { type AttendanceRow } from "@/lib/rtdb-lean-service"
import { paths } from "@/lib/firebase-paths"
import { AvatarInitials, EmptyState, StatCard } from "./ui"
import { employeeName, leaveTypeValue } from "./format"

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

interface DashboardData {
  employees: MasterRow[]
  offices: MasterRow[]
  departments: MasterRow[]
  groups: MasterRow[]
  holidays: MasterRow[]
  specials: MasterRow[]
  dayRows: AttendanceRow[]
  rangeRows: AttendanceRow[]
  recentLogs: AttendanceRow[]
  leaves: MasterRow[]
  pendingCount: number
}

// Baca LANGSUNG dari data mentah RTDB (tanpa node pre-computed):
// presensi tanggal terpilih + tren 30 hari (satu range read) + daftar
// pengajuan mentah (izin/QR/koreksi). Fungsi murni — tanpa setState —
// supaya bisa dipanggil dari mutation maupun effect.
async function loadDashboardData(
  companyId: string,
  selectedDate: string
): Promise<DashboardData> {
  const [usersSnap, officesSnap, deptsSnap, groupsSnap, holidaysSnap, specialsSnap] =
    await Promise.all([
      manualGet<Record<string, unknown>>({
        key: "company_users",
        path: `company_users/${companyId}`,
      }),
      manualGet<Record<string, unknown>>({
        key: "companies",
        path: `offices/${companyId}`,
      }),
      manualGet<Record<string, unknown>>({
        key: "companies",
        path: `departments/${companyId}`,
      }),
      manualGet<Record<string, unknown>>({
        key: "companies",
        path: `employee_groups/${companyId}`,
      }),
      manualGet<Record<string, unknown>>({
        key: "holidays",
        path: `holidays/${companyId}`,
      }),
      manualGet<Record<string, unknown>>({
        key: "companies",
        path: `schedule_specials/${companyId}`,
      }),
    ])
  const trendStart = format(subDays(new Date(), 29), "yyyy-MM-dd")
  const [dayRows, rangeRows, leaveSnap, qrSnap, corrSnap] =
    await Promise.all([
      loadAttendanceByDateRange({
        companyId,
        startDate: selectedDate,
        endDate: selectedDate,
      }),
      loadAttendanceByDateRange({
        companyId,
        startDate: trendStart,
        endDate: todayKey(),
      }),
      manualGet<Record<string, unknown>>({
        key: "leave_requests",
        path: paths.leaveRequests(companyId),
      }),
      manualGet<Record<string, unknown>>({
        key: "qr_requests",
        path: paths.qrRequests(companyId),
      }),
      manualGet<Record<string, unknown>>({
        key: "attendance_corrections",
        path: paths.attendanceCorrections(companyId),
      }),
    ])
  const recentLogs = [...rangeRows]
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .slice(0, 10)
  const leaves = toMasterList(leaveSnap, "id")
  const pendingLeaves = leaves.filter((r) =>
    ["pending", "pending_admin", "processing"].includes(String(r.status || ""))
  ).length
  const pendingQr = toMasterList(qrSnap, "id").filter(
    (r) => r.status === "pending_admin" || r.status === "pending"
  ).length
  const pendingCorr = toMasterList(corrSnap, "id").filter(
    (r) => r.status === "pending" || !r.status
  ).length
  return {
    employees: toMasterList(usersSnap, "uid"),
    offices: toMasterList(officesSnap, "id"),
    departments: toMasterList(deptsSnap, "id"),
    groups: toMasterList(groupsSnap, "id"),
    holidays: toMasterList(holidaysSnap, "id"),
    specials: toMasterList(specialsSnap, "id"),
    dayRows,
    rangeRows,
    recentLogs,
    leaves,
    pendingCount: pendingLeaves + pendingQr + pendingCorr,
  }
}

export function DashboardPage() {
  const navigate = useNavigate()
  const {
    userData,
    companyId,
    companies,
    setCompanyId,
    isOwner,
    loading: companyLoading,
  } = useCompany()

  const [selectedDate, setSelectedDate] = useState<string>(todayKey())
  const [selectedOffice, setSelectedOffice] = useState("all")
  const [selectedDepartment, setSelectedDepartment] = useState("all")
  const [selectedGroup, setSelectedGroup] = useState("all")

  const [employees, setEmployees] = useState<MasterRow[]>([])
  const [offices, setOffices] = useState<MasterRow[]>([])
  const [departments, setDepartments] = useState<MasterRow[]>([])
  const [groups, setGroups] = useState<MasterRow[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRow[]>([])
  const [trendRows, setTrendRows] = useState<AttendanceRow[]>([])
  const [recentLogs, setRecentLogs] = useState<AttendanceRow[]>([])
  const [leaveRequests, setLeaveRequests] = useState<MasterRow[]>([])
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const [holidays, setHolidays] = useState<MasterRow[]>([])
  const [specials, setSpecials] = useState<MasterRow[]>([])
  // Penanda request terakhir: bila perusahaan/tanggal berganti sebelum
  // fetch selesai, hasil basi dibuang.
  const requestIdRef = useRef(0)

  const companyName = useMemo(() => {
    const company = companies.find((c) => c.id === companyId)
    return company ? companyDisplayName(company) : ""
  }, [companies, companyId])

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      if (emp.status_akun !== "active") return false
      if (selectedOffice !== "all" && String(emp.office_id) !== selectedOffice)
        return false
      if (
        selectedDepartment !== "all" &&
        String(emp.department_id) !== selectedDepartment
      )
        return false
      if (selectedGroup !== "all" && String(emp.group_id) !== selectedGroup)
        return false
      return true
    })
  }, [employees, selectedOffice, selectedDepartment, selectedGroup])

  const activeEmployeeIds = useMemo(
    () => new Set(filteredEmployees.map((e) => String(e.uid))),
    [filteredEmployees]
  )

  // Muat ringkasan lewat mutation (pola yang sama dengan halaman
  // Laporan): data dibaca langsung dari RTDB oleh loadDashboardData,
  // lalu diterapkan ke state di onSuccess.
  const dashboardMutation = useMutation({
    mutationFn: async (vars: { silent?: boolean }) => {
      const requestId = ++requestIdRef.current
      const data = await loadDashboardData(companyId, selectedDate)
      return { ...data, requestId, silent: vars.silent ?? false }
    },
    onSuccess: (result) => {
      if (requestIdRef.current !== result.requestId) return
      setEmployees(result.employees)
      setOffices(result.offices)
      setDepartments(result.departments)
      setGroups(result.groups)
      setHolidays(result.holidays)
      setSpecials(result.specials)
      setAttendanceRecords(result.dayRows)
      setTrendRows(result.rangeRows)
      setRecentLogs(result.recentLogs)
      setLeaveRequests(result.leaves)
      setPendingApprovalsCount(result.pendingCount)
      if (!result.silent) toast.success("Ringkasan dashboard berhasil dimuat.")
    },
    onError: (e: Error) =>
      toast.error(e.message || "Gagal memuat ringkasan."),
  })
  const summaryLoading = dashboardMutation.isPending

  // Muat otomatis saat perusahaan/tanggal berubah.
  useEffect(() => {
    if (!companyId || !selectedDate) return
    dashboardMutation.mutate({ silent: true })
    // Sekali per perusahaan/tanggal; refresh berikutnya lewat tombol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedDate])

  // Statistik hari ini — selalu dihitung dari data mentah: presensi
  // tanggal terpilih + pengajuan izin yang disetujui dan mencakup tanggal
  // tersebut. Tidak lagi memakai node dashboard_summary.
  const todayStats = useMemo(() => {
    let telat = 0
    const presentUsers = new Set<string>()
    attendanceRecords
      .filter(
        (r) =>
          (String(r.dateKey) === selectedDate ||
            String(r.parsedDate) === selectedDate) &&
          activeEmployeeIds.has(String(r.uid))
      )
      .forEach((r) => {
        if (isCheckIn(r)) {
          presentUsers.add(String(r.uid))
          const status = getAttendanceStatus(r)
          if (
            status.includes("late") ||
            status.includes("terlambat") ||
            status.includes("telat")
          ) {
            telat++
          }
        }
      })
    const hadir = presentUsers.size
    // "Belum Absen" belum sama dengan Alpa: tanpa resolver jadwal, jangan
    // tampilkan sebagai mangkir (catatan dari kode lama).
    const absen = Math.max(0, filteredEmployees.length - hadir)
    let izin = 0
    let sakit = 0
    let cuti = 0
    leaveRequests.forEach((r) => {
      if (String(r.status || "") !== "approved") return
      const start = String(r.tanggal_mulai ?? r.date ?? "")
      if (!start) return
      const end = String(r.tanggal_selesai ?? start)
      if (selectedDate < start || selectedDate > end) return
      const type = leaveTypeValue(r)
      if (type === "sakit") sakit++
      else if (type === "cuti") cuti++
      else izin++
    })
    return { hadir, telat, absen, izin, sakit, cuti }
  }, [
    attendanceRecords,
    leaveRequests,
    activeEmployeeIds,
    selectedDate,
    filteredEmployees.length,
  ])

  // Tren 30 hari — dihitung dari range read yang sama (trendRows) +
  // pengajuan izin yang disetujui, per hari.
  const trendSummaryData = useMemo(() => {
    const data: Record<string, unknown>[] = []
    for (let i = 29; i >= 0; i--) {
      const d = subDays(new Date(), i)
      const dayStr = format(d, "yyyy-MM-dd")
      const dayLabel = format(d, "dd MMM", { locale: idLocale })
      const presentUsers = new Set<string>()
      let telat = 0
      trendRows
        .filter(
          (r) =>
            (String(r.dateKey) === dayStr ||
              String(r.parsedDate) === dayStr) &&
            activeEmployeeIds.has(String(r.uid))
        )
        .forEach((r) => {
          if (isCheckIn(r)) {
            presentUsers.add(String(r.uid))
            const status = getAttendanceStatus(r)
            if (
              status.includes("late") ||
              status.includes("terlambat") ||
              status.includes("telat")
            ) {
              telat++
            }
          }
        })
      let izinSakitCuti = 0
      leaveRequests.forEach((r) => {
        if (String(r.status || "") !== "approved") return
        const start = String(r.tanggal_mulai ?? r.date ?? "")
        if (!start) return
        const end = String(r.tanggal_selesai ?? start)
        if (dayStr >= start && dayStr <= end) izinSakitCuti++
      })
      data.push({
        name: dayLabel,
        Hadir: presentUsers.size,
        Terlambat: telat,
        "Izin/Sakit/Cuti": izinSakitCuti,
        "Belum Absen": Math.max(0, filteredEmployees.length - presentUsers.size),
      })
    }
    return data
  }, [trendRows, leaveRequests, activeEmployeeIds, filteredEmployees.length])

  const currentHolidays = useMemo(() => {
    const todayDate = new Date()
    const items: { date: string; name: string; type: string }[] = []
    holidays.forEach((h) => {
      const date = String(h.date || "")
      if (date && isSameMonth(parseISO(date), todayDate)) {
        items.push({
          date,
          name: String(h.name || h.title || "Hari libur"),
          type: "holiday",
        })
      }
    })
    specials.forEach((s) => {
      const date = String(s.date || "")
      if (date && isSameMonth(parseISO(date), todayDate)) {
        items.push({
          date,
          name: String(s.title || s.name || "Jadwal khusus"),
          type: "special",
        })
      }
    })
    return items.sort((a, b) => a.date.localeCompare(b.date))
  }, [holidays, specials])

  const recentLogsComputed = useMemo(() => {
    return recentLogs
      .filter((r) => activeEmployeeIds.has(String(r.uid)))
      .slice(0, 10)
  }, [recentLogs, activeEmployeeIds])

  // Terlambat Hari Ini (mockup): check-in hari ini yang terlambat atau di
  // luar radius, diurutkan dari yang paling lama terlambat.
  const lateToday = useMemo(() => {
    const rows = attendanceRecords.filter(
      (r) =>
        String(r.dateKey) === selectedDate &&
        isCheckIn(r) &&
        activeEmployeeIds.has(String(r.uid))
    )
    const flagged = rows
      .map((r) => {
        const status = getAttendanceStatus(r)
        const isLate =
          status.includes("late") ||
          status.includes("terlambat") ||
          status.includes("telat")
        const isOutside =
          status.includes("luar_radius") || status.includes("luar radius")
        if (!isLate && !isOutside) return null
        const emp = employees.find((e) => e.uid === r.uid)
        return {
          uid: String(r.uid),
          name: emp ? employeeName(emp) : String(r.uid),
          time: String(r.record_time || r.waktu || r.time || ""),
          workStart: String(
            r.work_start || r.schedule_work_start || ""
          ),
          lateMinutes: isLate ? getLateMinutes(r) : null,
          isOutside,
          distance: r.distance_meter ?? r.distance ?? null,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    flagged.sort((a, b) => {
      const am = a.lateMinutes ?? -1
      const bm = b.lateMinutes ?? -1
      if (am !== bm) return bm - am
      return b.time.localeCompare(a.time)
    })
    return flagged.slice(0, 5)
  }, [attendanceRecords, selectedDate, activeEmployeeIds, employees])

  const goToAttendance = (params: {
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
  }) => {
    void navigate({
      to: "/admin/attendance",
      search: {
        date: params.date,
        startDate: params.startDate,
        endDate: params.endDate,
        search: params.search,
        method: params.method,
        action: params.action,
        office: params.office,
        department: params.department,
        group: params.group,
        status: params.status,
        geofence: params.geofence,
      },
    })
  }

  if (!userData && !companyLoading) {
    return (
      <EmptyState>
        <p>Silakan masuk untuk melihat dashboard.</p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Dashboard Presensi"
        description={`${format(new Date(), "EEEE, d MMMM yyyy", { locale: idLocale })}${companyName ? ` · ${companyName}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && companies.length > 0 && (
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Pilih Perusahaan" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id ?? ""}>
                      {companyDisplayName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" asChild>
              <Link to="/admin/reports">
                <Download className="mr-2 h-4 w-4" />
                Ekspor Laporan
              </Link>
            </Button>
          </div>
        }
      />

      {!companyId ? (
        <Card>
          <EmptyState>
            <p className="font-medium text-foreground">
              Silakan pilih perusahaan
            </p>
            <p>Pilih perusahaan dari menu di atas atau hubungi Administrator.</p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="f-tanggal"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Tanggal
                </label>
                <Input
                  id="f-tanggal"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="f-kantor"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Kantor
                </label>
                <Select value={selectedOffice} onValueChange={setSelectedOffice}>
                  <SelectTrigger id="f-kantor" className="w-44">
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
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="f-dept"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Departemen
                </label>
                <Select
                  value={selectedDepartment}
                  onValueChange={setSelectedDepartment}
                >
                  <SelectTrigger id="f-dept" className="w-44">
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
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="f-grup"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Grup Karyawan
                </label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger id="f-grup" className="w-44">
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
              </div>
              <Button
                type="button"
                onClick={() => dashboardMutation.mutate({})}
                disabled={summaryLoading}
              >
                {summaryLoading ? "Memproses..." : "Refresh"}
              </Button>
            </CardContent>
          </Card>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  title="Hadir Hari Ini"
                  value={todayStats.hadir}
                  subtitle={`Dari ${filteredEmployees.length} karyawan`}
                  icon={
                    <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  }
                  onClick={() =>
                    goToAttendance({
                      date: selectedDate,
                      startDate: selectedDate,
                      endDate: selectedDate,
                      status: "hadir",
                      action: "masuk",
                    })
                  }
                />
                <StatCard
                  title="Terlambat"
                  value={todayStats.telat}
                  subtitle="Absen lewat jam kerja"
                  icon={
                    <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  }
                  onClick={() =>
                    goToAttendance({
                      date: selectedDate,
                      startDate: selectedDate,
                      endDate: selectedDate,
                      status: "terlambat",
                      action: "masuk",
                    })
                  }
                />
                <StatCard
                  title="Belum Absen"
                  value={todayStats.absen}
                  subtitle="Belum ada data check-in"
                  icon={
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  }
                  onClick={() => {
                    // Deep-link lama (?date=&view=belum_absen) tidak dipakai
                    // halaman Laporan — Laporan tidak membaca search params.
                    void navigate({ to: "/admin/reports" })
                  }}
                />
                <StatCard
                  title="Izin/Sakit/Cuti"
                  value={todayStats.izin + todayStats.sakit + todayStats.cuti}
                  subtitle={`Izin: ${todayStats.izin} · Sakit: ${todayStats.sakit} · Cuti: ${todayStats.cuti}`}
                  icon={
                    <CalendarIcon className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  }
                  onClick={() =>
                    void navigate({
                      to: "/admin/approvals",
                      search: { tab: "izin", status: undefined, date: selectedDate },
                    })
                  }
                />
                <StatCard
                  title="Approval Pending"
                  value={pendingApprovalsCount}
                  subtitle="Butuh aksi Admin/HR"
                  icon={
                    <FileText className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  }
                  onClick={() =>
                    void navigate({
                      to: "/admin/approvals",
                      search: { tab: undefined, status: "pending", date: undefined },
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      <CardTitle>Grafik Tren Presensi (30 Hari)</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendSummaryData}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#334155"
                            opacity={0.2}
                          />
                          <XAxis
                            dataKey="name"
                            stroke="#64748b"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                            minTickGap={30}
                          />
                          <YAxis
                            stroke="#64748b"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#1e293b",
                              border: "none",
                              borderRadius: "8px",
                              color: "#f8fafc",
                            }}
                            itemStyle={{ color: "#e2e8f0", fontSize: "13px" }}
                            labelStyle={{
                              color: "#94a3b8",
                              marginBottom: "4px",
                              fontSize: "12px",
                            }}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: "13px", paddingTop: "16px" }}
                            iconType="circle"
                          />
                          <Line
                            type="monotone"
                            name="Hadir"
                            dataKey="Hadir"
                            stroke="#10b981"
                            strokeWidth={3}
                            dot={false}
                            activeDot={{ r: 6, fill: "#10b981" }}
                          />
                          <Line
                            type="monotone"
                            name="Terlambat"
                            dataKey="Terlambat"
                            stroke="#eab308"
                            strokeWidth={3}
                            dot={false}
                            activeDot={{ r: 6, fill: "#eab308" }}
                          />
                          <Line
                            type="monotone"
                            name="Belum Absen"
                            dataKey="Belum Absen"
                            stroke="#ef4444"
                            strokeWidth={3}
                            dot={false}
                            activeDot={{ r: 6, fill: "#ef4444" }}
                          />
                          <Line
                            type="monotone"
                            name="Izin/Cuti"
                            dataKey="Izin/Sakit/Cuti"
                            stroke="#3b82f6"
                            strokeWidth={3}
                            dot={false}
                            activeDot={{ r: 6, fill: "#3b82f6" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Flag className="h-5 w-5" />
                      <CardTitle>Hari Libur Bulan Ini</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {currentHolidays.length === 0 ? (
                      <EmptyState>
                        <CalendarIcon className="mb-3 h-10 w-10 text-muted-foreground/20" />
                        <p>Tidak ada hari libur atau jadwal khusus bulan ini.</p>
                      </EmptyState>
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {currentHolidays.map((h) => (
                          <li
                            key={`${h.type}-${h.date}`}
                            className="flex items-start gap-3 rounded-lg border p-3"
                          >
                            <div className="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded border text-center shadow-sm">
                              <span className="text-[11px] font-semibold uppercase text-red-500">
                                {format(parseISO(h.date), "MMM", {
                                  locale: idLocale,
                                })}
                              </span>
                              <span className="text-lg font-bold leading-none">
                                {format(parseISO(h.date), "dd")}
                              </span>
                            </div>
                            <div className="pt-1">
                              <div className="text-sm font-bold">{h.name}</div>
                              <div className="mt-1 text-xs capitalize text-muted-foreground">
                                {h.type === "holiday"
                                  ? "Hari Libur Nasional"
                                  : "Jadwal Khusus"}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        <CardTitle>Log Presensi Terbaru</CardTitle>
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          goToAttendance({ date: selectedDate })
                        }
                      >
                        Lihat Lengkap
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {recentLogsComputed.length === 0 ? (
                      <EmptyState>
                        <p>Belum ada data presensi.</p>
                      </EmptyState>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                            <tr>
                              <th className="px-4 py-3 font-medium">Karyawan</th>
                              <th className="px-4 py-3 font-medium">Waktu</th>
                              <th className="px-4 py-3 font-medium">Jenis</th>
                              <th className="px-4 py-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {recentLogsComputed.map((log) => {
                              const emp = employees.find(
                                (e) => e.uid === log.uid
                              )
                              const status = getAttendanceStatus(log)
                              const isLate =
                                status.includes("late") ||
                                status.includes("terlambat")
                              const isEarly =
                                status.includes("early") ||
                                status.includes("pulang cepat")
                              return (
                                <tr
                                  key={String(log.id)}
                                  className="cursor-pointer hover:bg-muted/30"
                                  onClick={() =>
                                    goToAttendance({
                                      date: String(
                                        log.dateKey ||
                                          log.parsedDate ||
                                          selectedDate
                                      ),
                                      startDate: String(
                                        log.dateKey ||
                                          log.parsedDate ||
                                          selectedDate
                                      ),
                                      endDate: String(
                                        log.dateKey ||
                                          log.parsedDate ||
                                          selectedDate
                                      ),
                                      search: emp
                                        ? employeeName(emp)
                                        : String(log.uid || ""),
                                    })
                                  }
                                >
                                  <td className="px-4 py-3 font-medium">
                                    {emp
                                      ? employeeName(emp)
                                      : "Karyawan Tanpa Nama"}
                                  </td>
                                  <td className="px-4 py-3 text-muted-foreground">
                                    {(() => {
                                      const ts = Number(log.created_at || 0)
                                      if (!ts) return "-"
                                      return format(
                                        new Date(ts),
                                        "dd MMM yyyy, HH:mm",
                                        { locale: idLocale }
                                      )
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 capitalize text-muted-foreground">
                                    {isCheckIn(log) ? "masuk" : "pulang"}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span
                                      className={
                                        isLate
                                          ? "rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/30"
                                          : isEarly
                                            ? "rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-orange-100 text-orange-700 dark:bg-orange-900/30"
                                            : "rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30"
                                      }
                                    >
                                      {isLate
                                        ? "Terlambat"
                                        : isEarly
                                          ? "Pulang Cepat"
                                          : "Hadir"}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      <CardTitle>Terlambat Hari Ini</CardTitle>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Diurutkan dari yang paling lama terlambat
                    </p>
                  </CardHeader>
                  <CardContent>
                    {lateToday.length === 0 ? (
                      <EmptyState>
                        <p>Tidak ada karyawan yang terlambat hari ini.</p>
                      </EmptyState>
                    ) : (
                      <ul className="flex flex-col divide-y">
                        {lateToday.map((item) => (
                          <li
                            key={item.uid}
                            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                          >
                            <AvatarInitials name={item.name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {item.name}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {item.workStart
                                  ? `Jadwal ${item.workStart} · masuk ${item.time}`
                                  : `Masuk ${item.time}`}
                                {item.isOutside && item.distance !== null
                                  ? ` · di luar radius ${item.distance} m`
                                  : ""}
                              </span>
                            </span>
                            {item.isOutside && item.lateMinutes === null ? (
                              <span className="rounded bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 dark:bg-red-900/30">
                                Luar Radius
                              </span>
                            ) : (
                              <span className="rounded bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700 dark:bg-amber-900/30">
                                Telat {item.lateMinutes ?? "?"} mnt
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
        </>
      )}
    </div>
  )
}
