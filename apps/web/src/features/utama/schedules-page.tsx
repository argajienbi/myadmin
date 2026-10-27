// Jadwal Kerja — halaman Utama (Dewi).
// Mengikuti mockup schedules.html (9 tab) + logika Schedules.tsx lama.
// Form Jam Kerja tampil inline seperti mockup; form tab lain memakai Dialog.
// Sinkronisasi Google Calendar TIDAK dibawa (butuh workspaceAuth Google —
// domain auth Raka); CRUD hari libur tetap jalan. Aksi per tab mengikuti
// mockup (Jam Kerja: Edit + Nonaktifkan; Shift: Edit; Terapkan/Khusus/
// Lembur: Edit + Hapus; Libur: Hapus) — penonaktifan tab lain tetap bisa
// lewat checkbox "Aktif" di form edit.
import { useEffect, useMemo, useState } from "react"
import { get, ref } from "firebase/database"
import {
  AlertCircle,
  BadgeCheck,
  Clock,
  Info,
  Plus,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@workspace/ui/components/textarea"
import { PageHeader } from "@/components/page"
import { useCompany } from "@/lib/use-company"
import { companyDisplayName } from "@/lib/display-utils"
import { db } from "@/lib/firebase"
import { paths } from "@/lib/firebase-paths"
import { manualListen } from "@/lib/rtdb-data-gate"
import { todayKey } from "@/lib/rtdb-lean-service"
import {
  SHIFT_DAY_KEYS,
  dateKeyToLabel,
  dayKeyFromDate,
  dayLabelMap,
  diagnoseEmployeeSchedule,
  getActiveEmployees,
  isActiveValue,
  resolveTargetUids,
  sortDateKeys,
} from "./schedule-data"
import type { DiagnosticResult } from "./schedule-data"
import {
  createLabel,
  defaultFormData,
  deleteScheduleItem,
  impactedByTimetableOrShift,
  impactedPreviewForForm,
  saveScheduleItem,
  toggleScheduleActive,
} from "./schedules-forms"
import type {
  ScheduleLists,
  ScheduleRow,
  ScheduleTabId,
} from "./schedules-forms"
import { AvatarInitials, EmptyState, Field, StatusBadge, UtamaTabs } from "./ui"
import { employeeName, formatTanggal, formatTanggalWaktu } from "./format"

function snapshotToList(
  val: Record<string, unknown> | null
): ScheduleRow[] {
  if (!val) return []
  return Object.keys(val).map((k) => ({
    ...((val[k] as Record<string, unknown>) || {}),
    id: k,
  }))
}

function ScheduleForm(props: {
  tab: ScheduleTabId
  formData: Record<string, unknown>
  setFormData: (next: Record<string, unknown>) => void
  lists: ScheduleLists
}) {
  const { tab, formData, setFormData, lists } = props
  const set = (key: string, value: unknown) =>
    setFormData({ ...formData, [key]: value })
  const [overtimeDateInput, setOvertimeDateInput] = useState("")

  if (tab === "timetable") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nama Jam Kerja" htmlFor="jk-nama">
            <Input
              id="jk-nama"
              placeholder="mis. Pagi"
              value={String(formData.name || "")}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Toleransi Telat (Menit)" htmlFor="jk-toleransi">
            <Input
              id="jk-toleransi"
              type="number"
              value={String(formData.late_tolerance_minute ?? 15)}
              onChange={(e) =>
                set("late_tolerance_minute", Number(e.target.value))
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam Kerja Mulai" htmlFor="jk-mulai">
            <Input
              id="jk-mulai"
              type="time"
              value={String(formData.work_start || "")}
              onChange={(e) => set("work_start", e.target.value)}
            />
          </Field>
          <Field label="Jam Kerja Selesai" htmlFor="jk-selesai">
            <Input
              id="jk-selesai"
              type="time"
              value={String(formData.work_end || "")}
              onChange={(e) => set("work_end", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batas Check In (Mulai)" htmlFor="jk-ci-mulai">
            <Input
              id="jk-ci-mulai"
              type="time"
              value={String(formData.check_in_start || "")}
              onChange={(e) => set("check_in_start", e.target.value)}
            />
          </Field>
          <Field label="Batas Check In (Akhir)" htmlFor="jk-ci-akhir">
            <Input
              id="jk-ci-akhir"
              type="time"
              value={String(formData.check_in_end || "")}
              onChange={(e) => set("check_in_end", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batas Check Out (Mulai)" htmlFor="jk-co-mulai">
            <Input
              id="jk-co-mulai"
              type="time"
              value={String(formData.check_out_start || "")}
              onChange={(e) => set("check_out_start", e.target.value)}
            />
          </Field>
          <Field label="Batas Check Out (Akhir)" htmlFor="jk-co-akhir">
            <Input
              id="jk-co-akhir"
              type="time"
              value={String(formData.check_out_end || "")}
              onChange={(e) => set("check_out_end", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Toleransi Pulang Cepat (Menit)">
            <Input
              type="number"
              value={String(formData.early_out_tolerance_minute ?? 0)}
              onChange={(e) =>
                set("early_out_tolerance_minute", Number(e.target.value))
              }
            />
          </Field>
          <div className="flex items-end gap-4 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={formData.crosses_midnight === true}
                onCheckedChange={(v) => set("crosses_midnight", v === true)}
              />
              Lewat tengah malam
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={formData.active !== false}
                onCheckedChange={(v) => set("active", v === true)}
              />
              Aktif
            </label>
          </div>
        </div>
      </div>
    )
  }

  if (tab === "shift") {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nama Pola Shift">
            <Input
              placeholder="mis. Pagi–Siang"
              value={String(formData.name || "")}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Mode Hari Kerja">
            <Select
              value={String(formData.workday_mode || "custom")}
              onValueChange={(v) => set("workday_mode", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Kustom (pilih hari)</SelectItem>
                <SelectItem value="full_week">Senin–Minggu</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Hari kerja &amp; jam kerja per hari</Label>
          {SHIFT_DAY_KEYS.map((day) => (
            <div key={day} className="flex items-center gap-3">
              <label className="flex w-28 items-center gap-2 text-sm">
                <Checkbox
                  checked={isActiveValue(formData[`day_${day}`], false)}
                  onCheckedChange={(v) => set(`day_${day}`, v === true)}
                />
                {dayLabelMap[day]}
              </label>
              <Select
                value={String(formData[`timetable_${day}`] || "")}
                onValueChange={(v) => set(`timetable_${day}`, v)}
                disabled={!isActiveValue(formData[`day_${day}`], false)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Pilih jam kerja" />
                </SelectTrigger>
                <SelectContent>
                  {lists.timetables
                    .filter((t) => t.active !== false)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {String(t.name || t.id)} ({String(t.work_start || "")}
                        –{String(t.work_end || "")})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={formData.active !== false}
            onCheckedChange={(v) => set("active", v === true)}
          />
          Aktif
        </label>
      </div>
    )
  }

  if (tab === "assignment") {
    const type = String(formData.type || "group")
    const targetId = String(formData.target_id || "")
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target">
            <Select
              value={type}
              onValueChange={(v) => {
                setFormData({ ...formData, type: v, target_id: "" })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group">Grup Karyawan</SelectItem>
                <SelectItem value="user">Karyawan (perorangan)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={type === "group" ? "Grup" : "Karyawan"}>
            <Select
              value={targetId}
              onValueChange={(v) => set("target_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih target" />
              </SelectTrigger>
              <SelectContent>
                {type === "group"
                  ? lists.groups.map((g) => (
                      <SelectItem key={String(g.id)} value={String(g.id)}>
                        {String(g.name || g.id)}
                      </SelectItem>
                    ))
                  : lists.employees.map((e) => (
                      <SelectItem key={String(e.uid)} value={String(e.uid)}>
                        {employeeName(e)}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Pola Shift">
          <Select
            value={String(formData.shift_id || "")}
            onValueChange={(v) => set("shift_id", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pilih pola shift" />
            </SelectTrigger>
            <SelectContent>
              {lists.shifts
                .filter((s) => s.active !== false)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {String(s.name || s.id)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal Mulai">
            <Input
              type="date"
              value={String(formData.start_date || "")}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </Field>
          <Field label="Tanggal Akhir (opsional)">
            <Input
              type="date"
              value={String(formData.end_date || "")}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </Field>
        </div>
        {type === "group" && targetId && (
          <div className="flex flex-col gap-2">
            <Label>
              Tambahkan karyawan berikut ke grup ini juga (opsional)
            </Label>
            <div className="max-h-36 overflow-y-auto rounded-lg border p-2">
              {lists.employees
                .filter((e) => e.group_id !== targetId)
                .map((e) => {
                  const addMap =
                    (formData._add_to_group as Record<string, boolean>) || {}
                  return (
                    <label
                      key={String(e.uid)}
                      className="flex items-center gap-2 py-1 text-sm"
                    >
                      <Checkbox
                        checked={addMap[String(e.uid)] === true}
                        onCheckedChange={(v) =>
                          set("_add_to_group", {
                            ...addMap,
                            [String(e.uid)]: v === true,
                          })
                        }
                      />
                      {employeeName(e)}
                    </label>
                  )
                })}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={formData.active !== false}
            onCheckedChange={(v) => set("active", v === true)}
          />
          Aktif
        </label>
      </div>
    )
  }

  if (tab === "holiday") {
    return (
      <div className="flex flex-col gap-3">
        <Field label="Tanggal">
          <Input
            type="date"
            value={String(formData.date || "")}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
        <Field label="Judul Libur">
          <Input
            placeholder="mis. Hari Raya Natal"
            value={String(formData.title || "")}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
      </div>
    )
  }

  if (tab === "special") {
    const type = String(formData.type || "group")
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal">
            <Input
              type="date"
              value={String(formData.date || "")}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="Judul">
            <Input
              placeholder="mis. Jaga Malam Event"
              value={String(formData.title || "")}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target">
            <Select
              value={type}
              onValueChange={(v) => {
                setFormData({ ...formData, type: v, target_id: "" })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group">Grup Karyawan</SelectItem>
                <SelectItem value="user">Karyawan (perorangan)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={type === "group" ? "Grup" : "Karyawan"}>
            <Select
              value={String(formData.target_id || "")}
              onValueChange={(v) => set("target_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih target" />
              </SelectTrigger>
              <SelectContent>
                {type === "group"
                  ? lists.groups.map((g) => (
                      <SelectItem key={String(g.id)} value={String(g.id)}>
                        {String(g.name || g.id)}
                      </SelectItem>
                    ))
                  : lists.employees.map((e) => (
                      <SelectItem key={String(e.uid)} value={String(e.uid)}>
                        {employeeName(e)}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Pola Shift">
          <Select
            value={String(formData.shift_id || "")}
            onValueChange={(v) => set("shift_id", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pilih pola shift" />
            </SelectTrigger>
            <SelectContent>
              {lists.shifts
                .filter((s) => s.active !== false)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {String(s.name || s.id)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    )
  }

  if (tab === "overtime") {
    const dates = sortDateKeys(
      (formData.dates as Record<string, boolean>) || {}
    )
    const activeEmployees = getActiveEmployees(lists.employees)
    return (
      <div className="flex flex-col gap-3">
        <Field label="Nama Grup Lembur">
          <Input
            placeholder="mis. Lembur IT Support"
            value={String(formData.name || "")}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <Label>Tanggal lembur</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={overtimeDateInput}
              onChange={(e) => setOvertimeDateInput(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!overtimeDateInput) return
                const next = {
                  ...((formData.dates as Record<string, boolean>) || {}),
                  [overtimeDateInput]: true,
                }
                set("dates", next)
                setOvertimeDateInput("")
              }}
            >
              Tambah tanggal
            </Button>
          </div>
          {dates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {dates.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium hover:bg-destructive/10"
                  title="Hapus tanggal ini"
                  onClick={() => {
                    const next = {
                      ...((formData.dates as Record<string, boolean>) || {}),
                    }
                    delete next[d]
                    set("dates", next)
                  }}
                >
                  {dateKeyToLabel(d)} ✕
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam Kerja Mulai">
            <Input
              type="time"
              value={String(formData.work_start || "")}
              onChange={(e) => set("work_start", e.target.value)}
            />
          </Field>
          <Field label="Jam Kerja Selesai">
            <Input
              type="time"
              value={String(formData.work_end || "")}
              onChange={(e) => set("work_end", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batas Check In (Mulai)">
            <Input
              type="time"
              value={String(formData.check_in_start || "")}
              onChange={(e) => set("check_in_start", e.target.value)}
            />
          </Field>
          <Field label="Batas Check In (Akhir)">
            <Input
              type="time"
              value={String(formData.check_in_end || "")}
              onChange={(e) => set("check_in_end", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batas Check Out (Mulai)">
            <Input
              type="time"
              value={String(formData.check_out_start || "")}
              onChange={(e) => set("check_out_start", e.target.value)}
            />
          </Field>
          <Field label="Batas Check Out (Akhir)">
            <Input
              type="time"
              value={String(formData.check_out_end || "")}
              onChange={(e) => set("check_out_end", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Catatan (opsional)">
          <Textarea
            value={String(formData.note || "")}
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <Label>Karyawan lembur</Label>
          <div className="max-h-48 overflow-y-auto rounded-lg border p-2">
            {activeEmployees.map((e) => (
              <label
                key={String(e.uid)}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <Checkbox
                  checked={formData[`target_${String(e.uid)}`] === true}
                  onCheckedChange={(v) =>
                    set(`target_${String(e.uid)}`, v === true)
                  }
                />
                {employeeName(e)}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={formData.active !== false}
            onCheckedChange={(v) => set("active", v === true)}
          />
          Aktif
        </label>
      </div>
    )
  }

  return null
}

const TAB_ITEMS: { id: ScheduleTabId; label: string }[] = [
  { id: "summary", label: "Ringkasan" },
  { id: "timetable", label: "Jam Kerja" },
  { id: "shift", label: "Pola Shift" },
  { id: "assignment", label: "Terapkan Jadwal" },
  { id: "holiday", label: "Hari Libur" },
  { id: "special", label: "Jadwal Khusus" },
  { id: "overtime", label: "Jadwal Lembur" },
  { id: "diagnostic", label: "Cek Jadwal Karyawan" },
  { id: "logs", label: "Riwayat Perubahan" },
]

export function SchedulesPage({ initialTab }: { initialTab?: string }) {
  const {
    userData,
    companyId,
    companies,
    setCompanyId,
    isOwner,
    loading: companyLoading,
  } = useCompany()
  const [tab, setTab] = useState<ScheduleTabId>(
    (TAB_ITEMS.find((t) => t.id === initialTab)?.id as ScheduleTabId) ||
      "summary"
  )
  const [timetables, setTimetables] = useState<ScheduleRow[]>([])
  const [shifts, setShifts] = useState<ScheduleRow[]>([])
  const [assignments, setAssignments] = useState<ScheduleRow[]>([])
  const [holidays, setHolidays] = useState<ScheduleRow[]>([])
  const [specials, setSpecials] = useState<ScheduleRow[]>([])
  const [overtimeSchedules, setOvertimeSchedules] = useState<ScheduleRow[]>([])
  const [logs, setLogs] = useState<ScheduleRow[]>([])
  const [groups, setGroups] = useState<Record<string, unknown>[]>([])
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([])
  const [formTab, setFormTab] = useState<ScheduleTabId | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [savePreview, setSavePreview] = useState<{
    title: string
    summary: string
    impactedUids: string[]
    notify: boolean
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    tab: ScheduleTabId
    item: ScheduleRow
  } | null>(null)
  const [diagnosticUid, setDiagnosticUid] = useState("")
  const [diagnosticDate, setDiagnosticDate] = useState(todayKey())
  const [diagnosticResult, setDiagnosticResult] =
    useState<DiagnosticResult | null>(null)
  const [diagnosticLoading, setDiagnosticLoading] = useState(false)

  const lists: ScheduleLists = useMemo(
    () => ({
      timetables,
      shifts,
      assignments,
      holidays,
      specials,
      overtimeSchedules,
      groups,
      employees,
    }),
    [
      timetables,
      shifts,
      assignments,
      holidays,
      specials,
      overtimeSchedules,
      groups,
      employees,
    ]
  )

  useEffect(() => {
    if (!companyId) return
    const unsubs = [
      manualListen({
        key: "timetables",
        path: paths.timetables(companyId),
        onData: (value) =>
          setTimetables(
            snapshotToList(value as Record<string, unknown> | null)
          ),
      }),
      manualListen({
        key: "shifts",
        path: paths.shifts(companyId),
        onData: (value) =>
          setShifts(
            snapshotToList(value as Record<string, unknown> | null)
          ),
      }),
      manualListen({
        key: "schedule_assignments",
        path: paths.scheduleAssignments(companyId),
        onData: (value) =>
          setAssignments(
            snapshotToList(value as Record<string, unknown> | null)
          ),
      }),
      manualListen({
        key: "holidays",
        path: paths.holidays(companyId),
        onData: (value) =>
          setHolidays(
            snapshotToList(value as Record<string, unknown> | null)
          ),
      }),
      manualListen({
        key: "schedule_specials",
        path: paths.scheduleSpecials(companyId),
        onData: (value) =>
          setSpecials(
            snapshotToList(value as Record<string, unknown> | null)
          ),
      }),
      manualListen({
        key: "overtime_schedules",
        path: paths.overtimeSchedules(companyId),
        onData: (value) =>
          setOvertimeSchedules(
            snapshotToList(value as Record<string, unknown> | null)
          ),
      }),
      manualListen({
        key: "schedule_change_logs",
        path: paths.scheduleChangeLogs(companyId),
        onData: (value) => {
          const rows = snapshotToList(
            value as Record<string, unknown> | null
          )
          rows.sort(
            (a, b) => Number(b.created_at || 0) - Number(a.created_at || 0)
          )
          setLogs(rows)
        },
      }),
    ]
    Promise.all([
      get(ref(db, paths.employeeGroups(companyId))),
      get(ref(db, paths.companyUsers(companyId))),
    ])
      .then(([groupsSnap, usersSnap]) => {
        if (groupsSnap.exists()) {
          const val = groupsSnap.val() as Record<string, Record<string, unknown>>
          setGroups(
            Object.keys(val).map((k) => ({ ...val[k], id: k }))
          )
        }
        if (usersSnap.exists()) {
          const val = usersSnap.val() as Record<string, Record<string, unknown>>
          setEmployees(
            Object.keys(val).map((k) => ({ ...val[k], uid: k }))
          )
        }
      })
      .catch((err: Error) => {
        toast.error(`Gagal memuat data master: ${err.message}`)
      })
    return () => unsubs.forEach((u) => u())
  }, [companyId])

  const openForm = (tabId: ScheduleTabId, item?: ScheduleRow | null) => {
    setFormTab(tabId)
    setFormData(defaultFormData(tabId, item || null))
  }

  const runSave = () => {
    if (!formTab) return
    toast.promise(
      saveScheduleItem({
        tab: formTab,
        formData,
        companyId,
        userData,
        lists,
      }),
      {
        loading: "Menyimpan...",
        success: (msg) => {
          setFormTab(null)
          setFormData({})
          return msg
        },
        error: (err: Error) => `Gagal menyimpan: ${err.message}`,
      }
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formTab) return
    if (
      formTab === "assignment" ||
      formTab === "special" ||
      formTab === "overtime"
    ) {
      const preview = impactedPreviewForForm({ tab: formTab, formData, lists })
      setSavePreview({
        title: `Simpan ${createLabel(formTab)}`,
        summary: preview.summary,
        impactedUids: preview.impactedUids,
        notify: preview.notify,
      })
      return
    }
    runSave()
  }

  const formImpactedUids = useMemo(() => {
    if (!formTab) return []
    return impactedByTimetableOrShift({ tab: formTab, formData, lists })
  }, [formTab, formData, lists])

  // Ringkasan
  const summary = useMemo(() => {
    const activeTimetables = timetables.filter((t) => t.active !== false).length
    const activeShifts = shifts.filter((s) => s.active !== false).length
    const scheduledUids = new Set<string>()
    assignments
      .filter((a) => a.active !== false)
      .forEach((a) => {
        resolveTargetUids(
          employees,
          String(a.type || a.target_type || "individual"),
          String(a.target_id || "")
        ).forEach((uid) => scheduledUids.add(uid))
      })
    const now = new Date()
    const holidaysThisMonth = holidays.filter((h) => {
      const d = String(h.date || "")
      if (!d) return false
      const parsed = new Date(`${d}T00:00:00`)
      return (
        parsed.getFullYear() === now.getFullYear() &&
        parsed.getMonth() === now.getMonth() &&
        h.active !== false
      )
    }).length
    // Penerapan hari ini: per timetable, jumlah karyawan yang jadwal
    // aktifnya memakai timetable itu (dari assignment aktif hari ini).
    const today = todayKey()
    const dayKey = dayKeyFromDate(today)
    const perTimetable = new Map<string, Set<string>>()
    assignments
      .filter((a) => {
        if (a.active === false) return false
        const start = String(a.start_date || "")
        const end = String(a.end_date || "")
        if (start && today < start) return false
        if (end && today > end) return false
        return true
      })
      .forEach((a) => {
        const shift = shifts.find((s) => s.id === a.shift_id)
        if (!shift) return
        const days = (shift.days as Record<string, Record<string, unknown>>) || {}
        const day = days[dayKey]
        if (!isActiveValue(day?.active, false) || !day?.timetable_id) return
        const ttId = String(day.timetable_id)
        const uids = resolveTargetUids(
          employees,
          String(a.type || a.target_type || "individual"),
          String(a.target_id || "")
        )
        if (!perTimetable.has(ttId)) perTimetable.set(ttId, new Set())
        uids.forEach((uid) => perTimetable.get(ttId)?.add(uid))
      })
    return {
      activeTimetables,
      activeShifts,
      scheduledCount: scheduledUids.size,
      totalEmployees: employees.length,
      holidaysThisMonth,
      perTimetable,
    }
  }, [timetables, shifts, assignments, holidays, employees])

  const runDiagnostic = async () => {
    if (!companyId || !diagnosticUid || !diagnosticDate) {
      toast.error("Pilih karyawan dan tanggal terlebih dahulu.")
      return
    }
    setDiagnosticLoading(true)
    setDiagnosticResult(null)
    try {
      const result = await diagnoseEmployeeSchedule(
        companyId,
        diagnosticUid,
        diagnosticDate
      )
      setDiagnosticResult(result)
    } finally {
      setDiagnosticLoading(false)
    }
  }

  const shiftName = (id: string) => {
    const s = shifts.find((x) => x.id === id)
    return s ? String(s.name || id) : "Shift tidak ditemukan"
  }
  const groupName = (id: string) => {
    const g = groups.find((x) => x.id === id)
    return g ? String(g.name || id) : "Grup tidak ditemukan"
  }
  const employeeLabel = (uid: string) => {
    const e = employees.find((x) => x.uid === uid)
    return e ? employeeName(e) : "Karyawan tidak ditemukan"
  }

  if (!userData && !companyLoading) {
    return (
      <EmptyState>
        <p>Silakan masuk untuk melihat jadwal kerja.</p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Jam Kerja & Penjadwalan"
        description={`Jam kerja, pola shift, penerapan jadwal, hari libur, jadwal khusus, dan lembur${companyId ? ` — ${companyDisplayName(companies.find((c) => c.id === companyId))}` : ""}`}
        actions={
          isOwner && companies.length > 0 ? (
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
          ) : undefined
        }
      />

      <UtamaTabs
        active={tab}
        onChange={(id) => setTab(id as ScheduleTabId)}
        tabs={TAB_ITEMS.map((t) => ({ id: t.id, label: t.label }))}
      />

      {tab === "summary" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">
                  Jam Kerja Aktif
                </div>
                <div className="text-2xl font-bold">
                  {summary.activeTimetables}
                </div>
                <div className="text-xs text-muted-foreground">
                  dari {timetables.length} jam kerja
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">
                  Pola Shift Aktif
                </div>
                <div className="text-2xl font-bold">{summary.activeShifts}</div>
                <div className="text-xs text-muted-foreground">
                  dari {shifts.length} pola shift
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">
                  Karyawan Terjadwal
                </div>
                <div className="text-2xl font-bold">
                  {summary.scheduledCount}
                </div>
                <div className="text-xs text-muted-foreground">
                  Dari {summary.totalEmployees} karyawan
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-muted-foreground">
                  Hari Libur Bulan Ini
                </div>
                <div className="text-2xl font-bold">
                  {summary.holidaysThisMonth}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatTanggal(todayKey()).slice(3)}
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                Status Penerapan Jadwal Hari Ini ({formatTanggal(todayKey())})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Jumlah karyawan per jam kerja yang berlaku hari ini
              </p>
            </CardHeader>
            <CardContent>
              {summary.perTimetable.size === 0 ? (
                <EmptyState>
                  <p>Belum ada penerapan jadwal yang berlaku hari ini.</p>
                </EmptyState>
              ) : (
                <ul className="flex flex-col divide-y">
                  {Array.from(summary.perTimetable.entries()).map(
                    ([ttId, uids]) => {
                      const tt = timetables.find((t) => t.id === ttId)
                      return (
                        <li
                          key={ttId}
                          className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                        >
                          <AvatarInitials
                            name={String(tt?.name || "?")}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">
                              {String(tt?.name || ttId)} ·{" "}
                              {String(tt?.work_start || "").slice(0, 5)}–
                              {String(tt?.work_end || "").slice(0, 5)}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              Check-in{" "}
                              {String(tt?.check_in_start || "").slice(0, 5)}–
                              {String(tt?.check_in_end || "").slice(0, 5)} ·
                              toleransi{" "}
                              {Number(tt?.late_tolerance_minute || 0)} menit
                            </span>
                          </span>
                          <StatusBadge tone="primary">
                            {uids.size} karyawan
                          </StatusBadge>
                        </li>
                      )
                    }
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b className="text-foreground">
                Ringkasan operasional jadwal.
              </b>{" "}
              Angka di atas mengikuti penerapan jadwal yang aktif hari ini.
              Mengedit jam kerja atau pola shift memengaruhi jadwal aktif
              karyawan — aplikasi menampilkan peringatan dampak sebelum
              menyimpan.
            </span>
          </div>
        </div>
      )}

      {tab === "timetable" && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Jam Kerja</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Daftar jam kerja beserta jendela absennya
                  </p>
                </div>
                <Button onClick={() => openForm("timetable")}>
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Jam Kerja
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {timetables.length === 0 ? (
                <EmptyState>
                  <p>Belum ada jam kerja.</p>
                </EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Nama Jam Kerja</th>
                        <th className="px-4 py-3 font-medium">Waktu Kerja</th>
                        <th className="px-4 py-3 font-medium">Jendela Absen</th>
                        <th className="px-4 py-3 text-right font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {timetables.map((t) => (
                        <tr key={t.id}>
                          <td className="px-4 py-3 font-medium">
                            {String(t.name || "-")}
                            {t.active === false && (
                              <StatusBadge tone="neutral" className="ml-2">
                                Nonaktif
                              </StatusBadge>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {String(t.work_start || "").slice(0, 5)} –{" "}
                            {String(t.work_end || "").slice(0, 5)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            Masuk {String(t.check_in_start || "").slice(0, 5)}–
                            {String(t.check_in_end || "").slice(0, 5)} · Pulang{" "}
                            {String(t.check_out_start || "").slice(0, 5)}–
                            {String(t.check_out_end || "").slice(0, 5)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openForm("timetable", t)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void toggleScheduleActive({
                                    tab: "timetable",
                                    item: t,
                                    companyId,
                                    userData,
                                  }).catch((err: Error) =>
                                    toast.error(err.message)
                                  )
                                }
                              >
                                {t.active === false
                                  ? "Aktifkan"
                                  : "Nonaktifkan"}
                              </Button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          {formTab === "timetable" && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {formData.id ? "Edit Jam Kerja" : "Tambah Jam Kerja"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Isi semua batas waktu — jendela absen menentukan kapan
                  check-in/out dianggap valid
                </p>
              </CardHeader>
              <CardContent>
                <form
                  className="flex flex-col gap-3"
                  onSubmit={handleSubmit}
                >
                  {formImpactedUids.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <AlertCircle className="h-4 w-4" />
                        Peringatan Dampak: Mengedit Jam Kerja ini akan
                        memengaruhi jadwal aktif {formImpactedUids.length}{" "}
                        karyawan!
                      </div>
                      <div className="mt-2 max-h-24 overflow-y-auto font-mono text-muted-foreground">
                        {formImpactedUids.slice(0, 10).map((uid) => (
                          <div key={uid} className="flex justify-between py-0.5">
                            <span>{employeeLabel(uid)}</span>
                          </div>
                        ))}
                        {formImpactedUids.length > 10 && (
                          <div>
                            +{formImpactedUids.length - 10} karyawan lainnya
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <ScheduleForm
                    tab="timetable"
                    formData={formData}
                    setFormData={setFormData}
                    lists={lists}
                  />
                  <div className="flex gap-2">
                    <Button type="submit">Simpan</Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setFormTab(null)
                        setFormData({})
                      }}
                    >
                      Batal
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "shift" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Pola Shift</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Pola hari kerja Senin–Minggu per timetable
                </p>
              </div>
              <Button onClick={() => openForm("shift")}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Pola
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {shifts.length === 0 ? (
              <EmptyState>
                <p>Belum ada pola shift.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Nama Pola Shift</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Target Penerapan</th>
                      <th className="px-4 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {shifts.map((s) => {
                      const using = assignments.filter(
                        (a) => a.shift_id === s.id && a.active !== false
                      )
                      const targetSummary =
                        using.length === 0
                          ? "Belum diterapkan"
                          : using
                              .slice(0, 2)
                              .map((a) =>
                                a.type === "group"
                                  ? groupName(String(a.target_id))
                                  : employeeLabel(String(a.target_id))
                              )
                              .join(", ") +
                            (using.length > 2
                              ? ` +${using.length - 2} lainnya`
                              : "")
                      const days = (s.days as Record<string, Record<string, unknown>>) || {}
                      const activeDays = SHIFT_DAY_KEYS.filter((d) =>
                        isActiveValue(days[d]?.active, false)
                      )
                      return (
                        <tr key={s.id}>
                          <td className="px-4 py-3">
                            <div className="font-medium">
                              {String(s.name || "-")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {activeDays
                                .map((d) => dayLabelMap[d])
                                .join(", ") || "Tidak ada hari aktif"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={s.active === false ? "neutral" : "success"}
                            >
                              {s.active === false ? "Nonaktif" : "Aktif"}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {targetSummary}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openForm("shift", s)}
                            >
                              Edit
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
        </Card>
      )}

      {tab === "assignment" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Terapkan Jadwal</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Pasangkan pola shift ke karyawan atau grup, dengan periode
                  berlaku
                </p>
              </div>
              <Button onClick={() => openForm("assignment")}>
                <Plus className="mr-2 h-4 w-4" />
                Terapkan Jadwal
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {assignments.length === 0 ? (
              <EmptyState>
                <p>Belum ada penerapan jadwal.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Target Penerapan</th>
                      <th className="px-4 py-3 font-medium">Pola Shift</th>
                      <th className="px-4 py-3 font-medium">Periode</th>
                      <th className="px-4 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {assignments.map((a) => (
                      <tr key={a.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {a.type === "group"
                              ? groupName(String(a.target_id))
                              : employeeLabel(String(a.target_id))}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {a.type === "group" ? "Grup" : "Perorangan"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {shiftName(String(a.shift_id || ""))}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {a.start_date
                            ? formatTanggal(String(a.start_date))
                            : "—"}
                          {a.end_date
                            ? ` – ${formatTanggal(String(a.end_date))}`
                            : ""}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openForm("assignment", a)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDeleteTarget({ tab: "assignment", item: a })
                              }
                            >
                              Hapus
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "holiday" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Hari Libur</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Libur nasional dan libur perusahaan
                </p>
              </div>
              <Button onClick={() => openForm("holiday")}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Hari Libur
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {holidays.length === 0 ? (
              <EmptyState>
                <p>Belum ada hari libur yang dijadwalkan.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Tanggal</th>
                      <th className="px-4 py-3 font-medium">Keterangan</th>
                      <th className="px-4 py-3 font-medium">Sumber</th>
                      <th className="px-4 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...holidays]
                      .sort((a, b) =>
                        String(a.date || "").localeCompare(String(b.date || ""))
                      )
                      .map((h) => (
                        <tr key={String(h.date || h.id)}>
                          <td className="px-4 py-3 font-mono">
                            {formatTanggal(String(h.date || ""))}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {String(h.title || h.name || "-")}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={
                                h.source === "google_calendar"
                                  ? "info"
                                  : "neutral"
                              }
                            >
                              {h.source === "google_calendar"
                                ? "Google Calendar"
                                : "Manual"}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDeleteTarget({ tab: "holiday", item: h })
                              }
                            >
                              Hapus
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "special" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Jadwal Khusus</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Perubahan jam kerja satu kali untuk tanggal tertentu
                </p>
              </div>
              <Button onClick={() => openForm("special")}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Jadwal Khusus
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {specials.length === 0 ? (
              <EmptyState>
                <p>Belum ada jadwal khusus.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Nama</th>
                      <th className="px-4 py-3 font-medium">Tanggal</th>
                      <th className="px-4 py-3 font-medium">Jam Kerja</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {specials.map((s) => {
                      const tt = timetables.find(
                        (t) =>
                          t.id ===
                          (shifts.find((sh) => sh.id === s.shift_id)?.days as Record<string, Record<string, unknown>> | undefined)?.[
                            dayKeyFromDate(String(s.date || ""))
                          ]?.timetable_id
                      )
                      return (
                        <tr key={s.id}>
                          <td className="px-4 py-3">
                            <div className="font-medium">
                              {String(s.title || s.name || "-")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {s.type === "group"
                                ? groupName(String(s.target_id))
                                : employeeLabel(String(s.target_id))}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {formatTanggal(String(s.date || ""))}
                          </td>
                          <td className="px-4 py-3">
                            {shiftName(String(s.shift_id || ""))}
                            {tt
                              ? ` (${String(tt.work_start || "").slice(0, 5)}–${String(tt.work_end || "").slice(0, 5)})`
                              : ""}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={s.active === false ? "neutral" : "success"}
                            >
                              {s.active === false ? "Nonaktif" : "Aktif"}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openForm("special", s)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setDeleteTarget({ tab: "special", item: s })
                                }
                              >
                                Hapus
                              </Button>
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
      )}

      {tab === "overtime" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Jadwal Lembur</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Grup lembur terjadwal — berbeda dari lembur yang diajukan
                  mandiri
                </p>
              </div>
              <Button onClick={() => openForm("overtime")}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Jadwal Lembur
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {overtimeSchedules.length === 0 ? (
              <EmptyState>
                <p>Belum ada jadwal lembur.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Nama Grup Lembur</th>
                      <th className="px-4 py-3 font-medium">Tanggal</th>
                      <th className="px-4 py-3 font-medium">Karyawan</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {overtimeSchedules.map((o) => {
                      const dates = sortDateKeys(
                        (o.dates as Record<string, boolean>) || {}
                      )
                      const dateLabel =
                        dates.length === 0
                          ? o.date
                            ? formatTanggal(String(o.date))
                            : `${o.date_start ? formatTanggal(String(o.date_start)) : "—"}`
                          : dates.length === 1
                            ? formatTanggal(dates[0])
                            : `${formatTanggal(dates[0])} – ${formatTanggal(dates[dates.length - 1])}`
                      return (
                        <tr key={String(o.schedule_id || o.id)}>
                          <td className="px-4 py-3 font-medium">
                            {String(o.name || "-")}
                          </td>
                          <td className="px-4 py-3 font-mono">{dateLabel}</td>
                          <td className="px-4 py-3">
                            {Number(o.target_count || 0)} karyawan
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={o.active === false ? "neutral" : "success"}
                            >
                              {o.active === false ? "Nonaktif" : "Aktif"}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openForm("overtime", o)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setDeleteTarget({ tab: "overtime", item: o })
                                }
                              >
                                Hapus
                              </Button>
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
      )}

      {tab === "diagnostic" && (
        <Card>
          <CardHeader>
            <CardTitle>Cek Jadwal Karyawan</CardTitle>
            <p className="text-sm text-muted-foreground">
              Diagnostik: jadwal aktif mana yang dipakai karyawan pada tanggal
              tertentu (overtime vs hari libur vs shift)
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Pilih Karyawan" className="min-w-64 flex-1">
                <Select value={diagnosticUid} onValueChange={setDiagnosticUid}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih karyawan" />
                  </SelectTrigger>
                  <SelectContent>
                    {getActiveEmployees(employees).map((e) => (
                      <SelectItem key={String(e.uid)} value={String(e.uid)}>
                        {employeeName(e)}
                        {e.nip ? ` · ${String(e.nip)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Tanggal" className="w-44">
                <Input
                  type="date"
                  value={diagnosticDate}
                  onChange={(e) => setDiagnosticDate(e.target.value)}
                />
              </Field>
              <Button onClick={() => void runDiagnostic()} disabled={diagnosticLoading}>
                <Search className="mr-2 h-4 w-4" />
                {diagnosticLoading ? "Mengecek..." : "Cek Jadwal"}
              </Button>
            </div>
            {diagnosticResult && (
              <>
                <div
                  className={
                    diagnosticResult.ok
                      ? "flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/10 dark:text-emerald-300"
                      : "flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300"
                  }
                >
                  {diagnosticResult.ok ? (
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>
                    <b>{diagnosticResult.status}.</b>{" "}
                    {diagnosticResult.reason}
                  </span>
                </div>
                <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Karyawan</dt>
                  <dd>
                    {diagnosticResult.employee
                      ? employeeName(diagnosticResult.employee)
                      : "—"}
                    {diagnosticResult.groupName
                      ? ` · ${diagnosticResult.groupName}`
                      : ""}
                  </dd>
                  <dt className="text-muted-foreground">Sumber</dt>
                  <dd>{diagnosticResult.details?.source || "—"}</dd>
                  <dt className="text-muted-foreground">Jadwal aktif</dt>
                  <dd>
                    {diagnosticResult.details?.timetable
                      ? `${String(diagnosticResult.details.timetable.name || "")} · ${String(diagnosticResult.details.timetable.work_start || "").slice(0, 5)}–${String(diagnosticResult.details.timetable.work_end || "").slice(0, 5)}`
                      : diagnosticResult.details?.shift
                        ? String(
                            (diagnosticResult.details.shift as Record<string, unknown>).name || ""
                          )
                        : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Jendela check-in</dt>
                  <dd>
                    {diagnosticResult.details?.timetable
                      ? `${String(diagnosticResult.details.timetable.check_in_start || "").slice(0, 5)} – ${String(diagnosticResult.details.timetable.check_in_end || "").slice(0, 5)}`
                      : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Jendela check-out</dt>
                  <dd>
                    {diagnosticResult.details?.timetable
                      ? `${String(diagnosticResult.details.timetable.check_out_start || "").slice(0, 5)} – ${String(diagnosticResult.details.timetable.check_out_end || "").slice(0, 5)}`
                      : "—"}
                  </dd>
                  <dt className="text-muted-foreground">Hari libur?</dt>
                  <dd>
                    {diagnosticResult.status === "Hari Libur"
                      ? `Ya — ${formatTanggal(diagnosticDate)} hari libur`
                      : `Tidak — ${formatTanggal(diagnosticDate)} hari kerja biasa`}
                  </dd>
                </dl>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "logs" && (
        <Card>
          <CardHeader>
            <CardTitle>Riwayat Perubahan</CardTitle>
            <p className="text-sm text-muted-foreground">
              Catatan perubahan jadwal — siapa mengubah apa dan kapan
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {logs.length === 0 ? (
              <EmptyState>
                <p>Belum ada riwayat perubahan jadwal.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Waktu</th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Perubahan</th>
                      <th className="px-4 py-3 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-4 py-3 font-mono">
                          {formatTanggalWaktu(Number(log.created_at || 0))}
                        </td>
                        <td className="px-4 py-3">
                          {String(log.admin_name || log.user_name || "-")}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone="info">
                            {String(log.action || "-")}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {String(log.new_value || "-")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog form untuk tab selain Jam Kerja (Jam Kerja inline) */}
      <Dialog
        open={formTab !== null && formTab !== "timetable"}
        onOpenChange={(open) => {
          if (!open) {
            setFormTab(null)
            setFormData({})
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {formTab && formTab !== "timetable" && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {formData.id ? "Edit" : "Tambah"} {createLabel(formTab)}
                </DialogTitle>
                <DialogDescription>
                  {formTab === "shift"
                    ? "Pola hari kerja Senin–Minggu per timetable"
                    : formTab === "assignment"
                      ? "Pasangkan pola shift ke karyawan atau grup"
                      : formTab === "holiday"
                        ? "Libur nasional atau libur perusahaan"
                        : formTab === "special"
                          ? "Perubahan jam kerja satu kali untuk tanggal tertentu"
                          : "Grup lembur terjadwal"}
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col gap-3"
                onSubmit={handleSubmit}
              >
                {formImpactedUids.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertCircle className="h-4 w-4" />
                      Peringatan Dampak: Mengedit {createLabel(formTab)} ini
                      akan memengaruhi jadwal aktif {formImpactedUids.length}{" "}
                      karyawan!
                    </div>
                  </div>
                )}
                <ScheduleForm
                  tab={formTab}
                  formData={formData}
                  setFormData={setFormData}
                  lists={lists}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setFormTab(null)
                      setFormData({})
                    }}
                  >
                    Batal
                  </Button>
                  <Button type="submit">Simpan</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Konfirmasi simpan (dampak) untuk Terapkan/Khusus/Lembur */}
      <AlertDialog
        open={savePreview !== null}
        onOpenChange={(open) => {
          if (!open) setSavePreview(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{savePreview?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {savePreview?.summary}
              {savePreview?.notify &&
                " Notifikasi akan dikirim ke karyawan yang terdampak."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(savePreview?.impactedUids.length || 0) > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 font-mono text-xs text-muted-foreground">
              {savePreview?.impactedUids.slice(0, 10).map((uid) => (
                <div key={uid} className="py-0.5">
                  - {employeeLabel(uid)} ({uid})
                </div>
              ))}
              {(savePreview?.impactedUids.length || 0) > 10 && (
                <div>
                  +{(savePreview?.impactedUids.length || 0) - 10} karyawan
                  lainnya
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSavePreview(null)
                runSave()
              }}
            >
              Simpan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi hapus */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus {deleteTarget ? createLabel(deleteTarget.tab) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${String(deleteTarget.item.name || deleteTarget.item.title || deleteTarget.item.date || deleteTarget.item.id)}" akan dihapus permanen.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteTarget) return
                const target = deleteTarget
                setDeleteTarget(null)
                deleteScheduleItem({
                  tab: target.tab,
                  item: target.item,
                  companyId,
                  userData,
                }).catch((err: Error) => toast.error(err.message))
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        Sinkronisasi Google Calendar belum tersedia di redesain ini — hari
        libur ditambah manual di tab Hari Libur.
      </p>
    </div>
  )
}
