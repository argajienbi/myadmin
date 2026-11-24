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
import { firestorePaths, paths } from "@/lib/firebase-paths"
import { getAttendanceStatus, getAttendanceStatusLabel, getLateMinutes, isCheckIn, isCheckOut } from "@/lib/attendance-utils"
import { loadAttendanceByDateRange, buildDateRange, todayKey } from "@/lib/rtdb-lean-service"
import {
  DEFAULT_NO_CHECK_IN_CUTOFF,
  excusedUidsOn,
  isActiveEmployee,
  loadScheduleMaster,
  nowMinutesWIB,
  resolveDayFor,
  toMinutes,
} from "@/lib/schedule-batch-resolve"
import type {
  ResolvedDay,
  ScheduleMaster,
} from "@/lib/schedule-batch-resolve"
import { type AttendanceRow } from "@/lib/rtdb-lean-service"
import { AvatarInitials, EmptyState, Field, StatusBadge } from "./ui"
import {
  downloadCsv,
  employeeName,
  formatTanggal,
  textValue,
} from "./format"

const PAGE_SIZE = 8

// S4 — normalisasi jam "HH:mm" untuk batas tidak-absen (cerminan
// asTimeString di lib/auto-detect-scan.ts); tidak valid → default.
function normalizeCutoffTime(value: unknown): string {
  const text = String(value ?? "").trim()
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [h, m] = text.split(":").map(Number)
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    }
  }
  return DEFAULT_NO_CHECK_IN_CUTOFF
}

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
  risk?: string
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

// Baris sintetis "Tidak Absen Masuk" (S2): karyawan yang dijadwalkan
// kerja tapi tidak ada record masuknya. Bukan record RTDB — jangan
// dibuka di dialog Detail dan jangan lolos filter status lain.
function isNoCheckInRow(row: AttendanceRow): boolean {
  return row.synthetic_no_check_in === true
}

// Predikat status yang dipakai filter DAN ringkasan (satu definisi).
function isLateRow(row: AttendanceRow): boolean {
  const status = getAttendanceStatus(row)
  return (
    status.includes("late") ||
    status.includes("terlambat") ||
    status.includes("telat")
  )
}

function isHadirRow(row: AttendanceRow): boolean {
  const status = getAttendanceStatus(row)
  return (
    status.includes("hadir") ||
    ["success", "approved", "valid", "on_time", "tepat_waktu"].some((x) =>
      status.includes(x)
    ) ||
    status === ""
  )
}

// Jam record untuk perbandingan (kosong -> paling akhir, supaya record
// masuk terpagi yang dipilih bila ada beberapa masuk dalam sehari).
function recordTimeOf(row: AttendanceRow): string {
  return String(row.record_time || row.waktu || row.time || "99:99").slice(0, 5)
}

function statusTone(row: AttendanceRow): "success" | "warning" | "danger" {
  if (isNoCheckInRow(row)) return "danger"
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
  if (isNoCheckInRow(row)) return "Tidak Absen Masuk"
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

// Risiko lokasi: aplikasi menulis dua nama field mock
// (mock_location_detected / location_mock_detected) dan
// location_risk_level ("high" bila akurasi buruk / mencurigakan).
function isMockLocation(row: AttendanceRow): boolean {
  return (
    row.mock_location_detected === true ||
    row.location_mock_detected === true
  )
}

function isHighRiskLocation(row: AttendanceRow): boolean {
  return (
    !isMockLocation(row) && String(row.location_risk_level || "") === "high"
  )
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
  const [riskFilter, setRiskFilter] = useState(search.risk || "all")
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

  // Master jadwal + pengajuan untuk sintesis "tidak absen" / "belum
  // pulang" (S2): dibaca sekali per companyId, dipakai displayRows.
  // Bila gagal, halaman tetap menampilkan baris asli saja.
  const [scheduleMaster, setScheduleMaster] =
    useState<ScheduleMaster | null>(null)
  // S4 — batas tidak-absen dari pengaturan notifikasi (sekali per
  // companyId; gagal baca → default, sama seperti pemindai).
  const [noCheckInCutoff, setNoCheckInCutoff] = useState(
    DEFAULT_NO_CHECK_IN_CUTOFF
  )
  // S4 — batas tidak-absen pulang dari pengaturan notifikasi (menit
  // setelah jam pulang; default 60, sama seperti pemindai).
  const [noCheckOutAfterMin, setNoCheckOutAfterMin] = useState(60)
  const [leavesVal, setLeavesVal] = useState<Record<
    string,
    Record<string, unknown>
  > | null>(null)

  useEffect(() => {
    if (!companyId) return
    // Reset ke default saat perusahaan berganti; nilai pengaturan
    // dimuat di bawah dan menimpanya bila ada.
    setNoCheckInCutoff(DEFAULT_NO_CHECK_IN_CUTOFF)
    setNoCheckOutAfterMin(60)
    Promise.all([
      loadScheduleMaster(companyId),
      get(ref(db, paths.leaveRequests(companyId))),
      // S4 — batas tidak-absen dari pengaturan; gagal baca tidak
      // menggagalkan batch (jatuh ke default).
      get(ref(db, firestorePaths.notificationSettings(companyId))).catch(
        () => null
      ),
    ])
      .then(([master, leavesSnap, settingsSnap]) => {
        setScheduleMaster(master)
        setLeavesVal(
          (leavesSnap.val() as Record<string, Record<string, unknown>> | null) ||
            {}
        )
        const settingsVal =
          (settingsSnap?.val() as Record<string, unknown> | null) ?? null
        setNoCheckInCutoff(
          normalizeCutoffTime(settingsVal?.auto_detect_no_check_in_cutoff)
        )
        const afterRaw = Number(
          settingsVal?.auto_detect_no_check_out_after_minutes
        )
        setNoCheckOutAfterMin(
          Number.isFinite(afterRaw) && afterRaw >= 0 && afterRaw <= 720
            ? afterRaw
            : 60
        )
      })
      .catch((err: Error) => {
        toast.error(`Gagal memuat data jadwal: ${err.message}`)
        setScheduleMaster(null)
        setLeavesVal(null)
      })
  }, [companyId])

  // C7 — sinkronkan filter saat search param berubah (navigasi dalam
  // halaman yang sama, mis. klik dua baris Log Terbaru di Dashboard):
  // penyesuaian state saat render (pola React yang didokumentasikan),
  // bukan setState di dalam effect. State hanya berubah saat navigasi;
  // mengetik di filter tidak mengubah search.
  const searchSyncKey = [
    search.startDate || "",
    search.endDate || "",
    search.date || "",
    search.search || "",
    search.method || "",
    search.action || "",
    search.office || "",
    search.department || "",
    search.group || "",
    search.status || "",
    search.geofence || "",
    search.risk || "",
  ].join("|")
  const [prevSearchSyncKey, setPrevSearchSyncKey] =
    useState(searchSyncKey)
  if (searchSyncKey !== prevSearchSyncKey) {
    setPrevSearchSyncKey(searchSyncKey)
    setStartDate(search.startDate || search.date || todayKey())
    setEndDate(search.endDate || search.date || todayKey())
    setSearchText(search.search || "")
    setMethodFilter(search.method || "all")
    setActionFilter(search.action || "all")
    setOfficeFilter(search.office || "all")
    setDepartmentFilter(search.department || "all")
    setGroupFilter(search.group || "all")
    setStatusFilter(search.status || "all")
    setGeofenceFilter(search.geofence || "all")
    setRiskFilter(search.risk || "all")
    setPage(1)
  }

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

  // Peta nama master untuk pencarian (C1): nama kantor/departemen/grup
  // tidak tersimpan di record absensi, jadi dicari lewat id-nya.
  const masterNameById = useMemo(() => {
    const build = (list: MasterRow[]) => {
      const map = new Map<string, string>()
      list.forEach((item) =>
        map.set(String(item.id), String(item.name || item.id))
      )
      return map
    }
    return {
      office: build(offices),
      department: build(departments),
      group: build(groups),
    }
  }, [offices, departments, groups])

  // S2 — baris tampilan: baris asli + baris sintetis "Tidak Absen
  // Masuk" + flag "Belum Pulang" pada record masuk terpagi.
  // Sintesis butuh master jadwal + pengajuan; bila belum termuat,
  // tampilkan baris asli saja (halaman tetap berfungsi).
  const displayRows = useMemo(() => {
    if (!scheduleMaster || !leavesVal) return rows
    const today = todayKey()
    const dates = buildDateRange(startDate, endDate).slice(0, 31)
    const nowMin = nowMinutesWIB()
    const cutoffMin = toMinutes(noCheckInCutoff) ?? 600
    const resolvedCache = new Map<string, ResolvedDay>()
    const excusedCache = new Map<string, Set<string>>()
    const getResolved = (
      emp: Record<string, unknown>,
      date: string
    ): ResolvedDay => {
      const key = `${date}|${String(emp.uid || "")}`
      const hit = resolvedCache.get(key)
      if (hit) return hit
      const resolved = resolveDayFor(emp, date, scheduleMaster)
      resolvedCache.set(key, resolved)
      return resolved
    }
    const getExcused = (date: string): Set<string> => {
      const hit = excusedCache.get(date)
      if (hit) return hit
      const set = excusedUidsOn(leavesVal, date)
      excusedCache.set(date, set)
      return set
    }
    // Peta masuk/keluar per hari-karyawan (masuk terpagi saja).
    const checkInByKey = new Map<string, AttendanceRow>()
    const hasCheckOutByKey = new Set<string>()
    for (const row of rows) {
      const uid = String(row.uid || "")
      const dateKey = String(row.dateKey || row.record_date || "")
      if (!uid || !dateKey) continue
      const key = `${dateKey}|${uid}`
      if (isCheckIn(row)) {
        const prev = checkInByKey.get(key)
        if (!prev || recordTimeOf(row) < recordTimeOf(prev)) {
          checkInByKey.set(key, row)
        }
      }
      if (isCheckOut(row)) hasCheckOutByKey.add(key)
    }
    // Flag "Belum Pulang" pada record masuk terpagi (salinan, bukan
    // mutasi state): ada masuk, tidak ada pulang, dijadwalkan kerja,
    // bukan shift malam, dan batas pulang sudah lewat (hari ini:
    // work_end + batas pengaturan, default 60 mnt; tanggal lampau:
    // hari sudah lewat).
    const flaggedCopyByKey = new Map<string, AttendanceRow>()
    for (const [key, checkInRow] of checkInByKey) {
      if (hasCheckOutByKey.has(key)) continue
      const [date, uid] = key.split("|")
      const emp = employeeByUid.get(uid)
      if (!emp) continue
      const resolved = getResolved(emp, date)
      if (!resolved.todayActive) continue
      if (resolved.crossesMidnight) continue
      const workEnd = resolved.workEnd || resolved.checkOutEnd
      const workEndMin = toMinutes(workEnd)
      if (workEndMin === null) continue
      if (date === today && nowMin < workEndMin + noCheckOutAfterMin) continue
      if (date > today) continue
      flaggedCopyByKey.set(key, { ...checkInRow, no_check_out: true })
    }
    const out: AttendanceRow[] = rows.map((row) => {
      const key = `${String(row.dateKey || row.record_date || "")}|${String(row.uid || "")}`
      const copy = flaggedCopyByKey.get(key)
      return copy && checkInByKey.get(key) === row ? copy : row
    })
    // Baris sintetis "Tidak Absen Masuk": karyawan aktif yang
    // dijadwalkan kerja hari itu, tidak sedang izin/cuti/sakit yang
    // disetujui, dan tidak ada record masuknya. Batas yang sama dengan
    // aturan (b) S1 (kini dari pengaturan, default 10:00): tanggal
    // depan tidak pernah disintesis; hari ini hanya bila sudah lewat
    // batas dan shift tidak mulai setelah batas.
    for (const date of dates) {
      if (date > today) continue
      const excused = getExcused(date)
      for (const emp of employees) {
        const uid = String(emp.uid || "")
        if (!uid || !isActiveEmployee(emp)) continue
        if (excused.has(uid)) continue
        if (checkInByKey.has(`${date}|${uid}`)) continue
        const resolved = getResolved(emp, date)
        if (!resolved.todayActive) continue
        if (date === today) {
          if (nowMin < cutoffMin) continue
          const workStartMin = toMinutes(resolved.workStart)
          if (workStartMin !== null && workStartMin > cutoffMin) continue
        }
        out.push({
          id: `no-check-in:${date}:${uid}`
          company_id: companyId,
          record_uid: uid,
          uid,
          record_date: date,
          dateKey: date,
          record_action: "tidak_absen",
          action_type: "tidak_absen",
          work_start: resolved.workStart,
          work_end: resolved.workEnd,
          office_name:
            masterNameById.office.get(String(emp.office_id || "")) || "",
          synthetic_no_check_in: true,
        })
      }
    }
    out.sort((a, b) => {
      const aTime = new Date(`${a.record_date || a.dateKey || ""}T${a.record_time || a.waktu || a.time || "00:00:00"}`).getTime()
      const bTime = new Date(`${b.record_date || b.dateKey || ""}T${b.record_time || b.waktu || b.time || "00:00:00"}`).getTime()
      return bTime - aTime
    })
    return out
  }, [
    rows,
    employees,
    employeeByUid,
    masterNameById,
    scheduleMaster,
    leavesVal,
    noCheckInCutoff,
    noCheckOutAfterMin,
    startDate,
    endDate,
    companyId,
  ])

  // S2 — populasi ringkasan: baris tampilan yang lolos filter populasi
  // (cari + kantor + departemen + grup). Strip ringkasan dihitung dari
  // sini, BUKAN dari filteredRows, supaya strip tetap menjadi ringkasan
  // hari itu saat filter status/metode/aksi/geofence/risiko diganti.
  const populationRows = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return displayRows.filter((row) => {
      const emp = employeeByUid.get(String(row.uid))
      const name = emp ? employeeName(emp) : String(row.uid || "")
      // C1 — pencarian seperti aplikasi lama: nama, NIP, tanggal,
      // kantor, departemen, grup (sub-departemen tidak dimuat — lihat C5).
      if (q) {
        const haystack = [
          name,
          String(emp?.nip || row.nip || ""),
          String(row.dateKey || row.record_date || ""),
          String(
            row.office_name ||
              masterNameById.office.get(
                String(row.office_id || emp?.office_id || "")
              ) ||
              ""
                    ),
          String(
            row.department_name ||
              masterNameById.department.get(
                String(row.department_id || emp?.department_id || "")
              ) ||
              ""
          ),
          String(
            row.group_name ||
              masterNameById.group.get(
                String(row.group_id || emp?.group_id || "")
              ) ||
              ""
          ),
        ]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
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
      return true
    })
  }, [
    displayRows,
    searchText,
    officeFilter,
    departmentFilter,
    groupFilter,
    employeeByUid,
    masterNameById,
  ])

  // S2 — ringkasan harian per hari-karyawan (bukan per record): satu
  // hari-karyawan bisa terhitung di Telat DAN Belum Pulang sekaligus
  // (flag orthogonal); Hadir dihitung hanya bila tidak telat.
  // null = angka turunan yang belum bisa dihitung (master jadwal belum
  // termuat) atau rentang masih dimuat.
  const summary = useMemo(() => {
    const derivedReady = scheduleMaster !== null && leavesVal !== null
    let telat = 0
    let tidakAbsen = 0
    let belumPulang = 0
    let hadir = 0
    const byDay = new Map<
      string,
      {
        late: boolean
        hadir: boolean
        noCheckOut: boolean
        noCheckIn: boolean
      }
    >()
    for (const row of populationRows) {
      const key = `${String(row.dateKey || row.record_date || "")}|${String(row.uid || "")}`
      let day = byDay.get(key)
      if (!day) {
        day = { late: false, hadir: false, noCheckOut: false, noCheckIn: false }
        byDay.set(key, day)
      }
      if (isNoCheckInRow(row)) {
        day.noCheckIn = true
        continue
      }
      if (!isCheckIn(row)) continue
      if (isLateRow(row)) day.late = true
      else if (isHadirRow(row)) day.hadir = true
      if (row.no_check_out === true) day.noCheckOut = true
    }
    for (const day of byDay.values()) {
      if (day.noCheckIn) tidakAbsen++
      if (day.late) telat++
      if (day.noCheckOut) belumPulang++
      if (day.hadir && !day.late) hadir++
    }
    return {
      telat: loading ? null : telat,
      tidakAbsen: loading || !derivedReady ? null : tidakAbsen,
      belumPulang: loading || !derivedReady ? null : belumPulang,
      hadir: loading ? null : hadir,
    }
  }, [populationRows, loading, scheduleMaster, leavesVal])

  const filteredRows = useMemo(() => {
    return populationRows.filter((row) => {
      const method = String(row.method || "").toLowerCase()
      if (methodFilter !== "all" && method !== methodFilter) return false
      if (actionFilter === "masuk" && !isCheckIn(row)) return false
      if (actionFilter === "pulang" && !isCheckOut(row)) return false
      // C4 — lembur bisa difilter khusus (isCheckIn/isCheckOut sudah
      // menggabungkan lembur ke Masuk/Pulang; di sini dicocokkan persis).
      if (
        actionFilter === "lembur_masuk" &&
        String(row.action_type || row.record_action || "").toLowerCase() !==
          "lembur_masuk"
      )
        return false
      if (
        actionFilter === "lembur_pulang" &&
        String(row.action_type || row.record_action || "").toLowerCase() !==
          "lembur_pulang"
      )
        return false
      // S2 — status: baris sintetis hanya lolos "tidak_absen".
      if (isNoCheckInRow(row)) {
        if (statusFilter !== "all" && statusFilter !== "tidak_absen")
          return false
      } else if (statusFilter === "tidak_absen") {
        return false
      } else if (statusFilter === "belum_pulang") {
        if (row.no_check_out !== true) return false
      } else if (statusFilter === "hadir") {
        // Seperti aplikasi lama: "Hadir" mencakup approved/success/
        // valid/on_time/tepat_waktu (record approved tanpa
        // attendance_status ikut masuk); status kosong tetap Hadir
        // (getAttendanceStatusLabel("") = "Hadir").
        if (!isHadirRow(row)) return false
      } else if (statusFilter === "izin") {
        if (!getAttendanceStatus(row).includes("izin")) return false
      } else if (statusFilter === "sakit") {
        if (!getAttendanceStatus(row).includes("sakit")) return false
      } else if (statusFilter === "cuti") {
        if (!getAttendanceStatus(row).includes("cuti")) return false
      } else if (statusFilter === "alpha") {
        const status = getAttendanceStatus(row)
        if (!(status.includes("alpha") || status.includes("alpa")))
          return false
      } else if (statusFilter === "libur") {
        if (!getAttendanceStatus(row).includes("libur")) return false
      } else if (statusFilter === "terlambat") {
        if (!isLateRow(row)) return false
      } else if (statusFilter === "luar_radius") {
        const status = getAttendanceStatus(row)
        if (
          !(status.includes("luar_radius") || status.includes("luar radius"))
        )
          return false
      } else if (statusFilter === "pulang_cepat") {
        const status = getAttendanceStatus(row)
        if (!(status.includes("early") || status.includes("pulang cepat")))
          return false
      }
      // S2 — baris sintetis tidak punya data lokasi.
      if (isNoCheckInRow(row) && geofenceFilter !== "all") return false
      const distance = Number(row.distance_meter || 0)
      const radius = Number(row.radius_meter || 0)
      const outside = radius > 0 && distance > radius
      if (geofenceFilter === "inside" && outside) return false
      if (geofenceFilter === "outside" && !outside) return false
      // Risiko lokasi: "mock" = lokasi palsu terdeteksi;
      // "high" = risk level high tanpa mock.
      if (riskFilter === "mock" && !isMockLocation(row)) return false
      if (riskFilter === "high" && !isHighRiskLocation(row)) return false
      return true
    })
  }, [
    populationRows,
    methodFilter,
    actionFilter,
    statusFilter,
    geofenceFilter,
    riskFilter,
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

      {/* S2 — ringkasan harian (Frame B mockup): jumlah hari-karyawan
          per keadaan dalam rentang yang dipilih. "–" bila rentang masih
          dimuat, atau (untuk Tidak Absen / Belum Pulang) bila data
          jadwal belum termuat. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-amber-600">
              {summary.telat === null ? "–" : summary.telat}
            </div>
            <div className="text-sm text-muted-foreground">Telat</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600">
              {summary.tidakAbsen === null ? "–" : summary.tidakAbsen}
            </div>
            <div className="text-sm text-muted-foreground">
              Tidak absen masuk
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-amber-600">
              {summary.belumPulang === null ? "–" : summary.belumPulang}
            </div>
            <div className="text-sm text-muted-foreground">Belum pulang</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-teal-600">
              {summary.hadir === null ? "–" : summary.hadir}
            </div>
            <div className="text-sm text-muted-foreground">Hadir</div>
          </CardContent>
        </Card>
      </div>

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
                placeholder="Cari nama, NIP, kantor, atau tanggal..."
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
                <SelectItem value="lembur_masuk">Lembur Masuk</SelectItem>
                <SelectItem value="lembur_pulang">Lembur Pulang</SelectItem>
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
                <SelectItem value="tidak_absen">Tidak Absen</SelectItem>
                <SelectItem value="belum_pulang">Belum Pulang</SelectItem>
                <SelectItem value="luar_radius">Luar Radius</SelectItem>
                <SelectItem value="pulang_cepat">Pulang Cepat</SelectItem>
                <SelectItem value="izin">Izin</SelectItem>
                <SelectItem value="sakit">Sakit</SelectItem>
                <SelectItem value="cuti">Cuti</SelectItem>
                <SelectItem value="alpha">Alpha</SelectItem>
                <SelectItem value="libur">Libur</SelectItem>
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
          <Field label="Risiko" className="w-44">
            <Select
              value={riskFilter}
              onValueChange={(v) => {
                setRiskFilter(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Semua Risiko" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Risiko</SelectItem>
                <SelectItem value="mock">Hanya Lokasi Palsu</SelectItem>
                <SelectItem value="high">Hanya Risiko Tinggi</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="outline"
            onClick={() => {
              // C6 — kembalikan tombol Reset Filters aplikasi lama:
              // semua filter ke bawaan, rentang ke hari ini.
              setStartDate(todayKey())
              setEndDate(todayKey())
              setSearchText("")
              setMethodFilter("all")
              setActionFilter("all")
              setOfficeFilter("all")
              setDepartmentFilter("all")
              setGroupFilter("all")
              setStatusFilter("all")
              setGeofenceFilter("all")
              setRiskFilter("all")
              setPage(1)
            }}
          >
            Reset Filter
          </Button>
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
            <>
            {/* R4: tabel penuh hanya tampil di md+; di bawah md diganti
                daftar kartu (blok md:hidden setelah tabel ini). */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Karyawan</th>
                    <th className="px-4 py-3 font-medium">Tanggal / Waktu</th>
                    <th className="px-4 py-3 font-medium">Jadwal &amp; Office</th>
                    <th className="px-4 py-3 font-medium">Tipe / Metode</th>
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
                            {isNoCheckInRow(row) ? (
                              "—"
                            ) : (
                              <>
                                {String(
                                  row.record_time || row.waktu || row.time || ""
                                ).slice(0, 5)}{" "}
                                WIB
                              </>
                            )}
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
                          {isNoCheckInRow(row) ? (
                            "—"
                          ) : (
                            <>
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
                            </>
                          )}
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
                          {row.no_check_out === true ? (
                            <div className="mt-1">
                              <StatusBadge tone="warning">
                                Belum Pulang
                              </StatusBadge>
                            </div>
                          ) : null}
                          {isMockLocation(row) ? (
                            <div className="mt-1">
                              <StatusBadge tone="danger">
                                ⚠️ Lokasi Palsu
                              </StatusBadge>
                            </div>
                          ) : isHighRiskLocation(row) ? (
                            <div className="mt-1">
                              <StatusBadge tone="warning">
                                Risiko Tinggi
                              </StatusBadge>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isNoCheckInRow(row)}
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
            {/* R4 — daftar kartu mobile (<md): nama + status + jam
                masuk/pulang + aksi Detail (target sentuh 40px), tanpa
                scroll horizontal di 360px. Data sama dengan tabel
                desktop (pageRows yang sama). */}
            <div className="flex flex-col divide-y md:hidden">
              {pageRows.map((row) => {
                const emp = employeeByUid.get(String(row.uid))
                const radius = Number(row.radius_meter || 0)
                const distance = Number(row.distance_meter || 0)
                const outside = radius > 0 && distance > radius
                return (
                  <div
                    key={String(row.id)}
                    className="flex flex-col gap-2 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <AvatarInitials
                        name={emp ? employeeName(emp) : String(row.uid)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {emp ? employeeName(emp) : String(row.uid)}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {textValue(
                            emp?.nip || row.nip,
                            String(row.uid || "")
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge tone={statusTone(row)}>
                          {statusText(row)}
                        </StatusBadge>
                        {row.no_check_out === true ? (
                          <StatusBadge tone="warning">
                            Belum Pulang
                          </StatusBadge>
                        ) : null}
                        {isMockLocation(row) ? (
                          <StatusBadge tone="danger">
                            ⚠️ Lokasi Palsu
                          </StatusBadge>
                        ) : isHighRiskLocation(row) ? (
                          <StatusBadge tone="warning">
                            Risiko Tinggi
                          </StatusBadge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span>{formatTanggal(String(row.dateKey || ""))}</span>
                      {isNoCheckInRow(row) ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>—</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-mono">
                            {String(
                              row.record_time || row.waktu || row.time || ""
                            ).slice(0, 5)}{" "}
                            WIB
                          </span>
                          <span aria-hidden>·</span>
                          <span>
                            {isCheckIn(row)
                              ? "Masuk"
                              : isCheckOut(row)
                                ? "Pulang"
                                : String(row.action_type || "")}
                            {" · "}
                            <span className="capitalize">
                              {textValue(row.method, "-")}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.work_start && row.work_end
                        ? `Jadwal ${String(row.work_start).slice(0, 5)} – ${String(row.work_end).slice(0, 5)}`
                        : textValue(row.timetable_name, "-")}
                      {" · "}
                      {textValue(row.office_name, "-")}
                      {radius > 0
                        ? ` · ${distance} m (${outside ? "di luar radius" : "di dalam radius"})`
                        : ""}
                    </div>
                    <Button
                      variant="outline"
                      className="h-10 w-full"
                      disabled={isNoCheckInRow(row)}
                      onClick={() => void openDetail(row)}
                    >
                      Detail
                    </Button>
                  </div>
                )
              })}
            </div>
            </>
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
                  {/* C3 — koordinat + tautan peta (seperti modal lokasi
                      aplikasi lama) supaya klaim "Luar Radius" bisa
                      diverifikasi; koordinat ikut terbawa di row. */}
                  {Boolean(detailRow.latitude) &&
                    Boolean(detailRow.longitude) && (
                    <>
                      <dt className="text-muted-foreground">Latitude</dt>
                      <dd className="font-mono">
                        {String(detailRow.latitude)}
                      </dd>
                      <dt className="text-muted-foreground">Longitude</dt>
                      <dd className="font-mono">
                        {String(detailRow.longitude)}
                      </dd>
                    </>
                  )}
                  {detailRow.mock_location_detected ? (
                    <>
                      <dt className="text-muted-foreground">Lokasi</dt>
                      <dd className="font-medium text-red-600">
                        ⚠️ Lokasi Palsu Terdeteksi!
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Sumber</dt>
                  <dd>{textValue(detailRow.source, "-")}</dd>
                </dl>
                {Boolean(detailRow.latitude) &&
                  Boolean(detailRow.longitude) && (
                  <Button variant="outline" asChild>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${detailRow.latitude}&mlon=${detailRow.longitude}#map=18/${detailRow.latitude}/${detailRow.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Buka di OpenStreetMap
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
