// Koreksi Absensi — halaman Utama (Dewi).
// Mengikuti mockup corrections.html + logika AttendanceCorrections.tsx lama
// (deteksi masalah hari ini, riwayat koreksi, input koreksi manual).
// Catatan: halaman lama membaca kunci aksi check_in/check_out (sedang
// approval QR menulis masuk/pulang) — pembacaan di sini menangani KEDUA
// bentuk kunci agar masalah tidak terlewat; penulisan koreksi manual tetap
// memakai kunci check_in/check_out seperti kode lama.
// Lampiran pada form manual adalah tambahan mockup (kode lama tidak punya):
// file diunggah ke Storage dan disimpan di correction_attachment_url/path —
// TIDAK PERNAH ke photo_url (inti fix bug 2b).
import { useCallback, useEffect, useMemo, useState } from "react"
import { get, push, ref, set } from "firebase/database"
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage"
import { Paperclip, ShieldCheck } from "lucide-react"
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
import { Textarea } from "@workspace/ui/components/textarea"
import { PageHeader } from "@/components/page"
import { useCompany } from "@/lib/use-company"
import { db, storage } from "@/lib/firebase"
import { paths } from "@/lib/firebase-paths"
import { manualListen } from "@/lib/rtdb-data-gate"
import { todayKey } from "@/lib/rtdb-lean-service"
import { writeAuditLog } from "@/lib/firebase-audit"
import { createNotification } from "@/lib/firebase-notify"
import { resolveScheduleForUser } from "./schedule-data"
import { EmptyState, Field, StatusBadge } from "./ui"
import { employeeName, formatTanggal } from "./format"

interface Problem {
  uid: string
  name: string
  issue: string
  actionType: "check_in" | "check_out"
  tone: "warning" | "danger"
}

interface CorrectionRow {
  id: string
  uid: string
  date: string
  action_type: string
  old_value: string
  new_value: string
  reason: string
  attendance_status: string
  corrected_by_name: string
  created_at: number
  [key: string]: unknown
}

type EmployeeRow = Record<string, unknown> & { uid: string }

// Kunci aksi di attendance/{c}/{uid}/{date} tidak konsisten di data lama:
// approval QR menulis "masuk"/"pulang", koreksi lama membaca
// "check_in"/"check_out". Baca keduanya.
function pickAction(
  actions: Record<string, Record<string, unknown>> | null,
  keys: string[]
): Record<string, unknown> | null {
  if (!actions) return null
  for (const key of keys) {
    if (actions[key]) return actions[key]
  }
  return null
}

export function CorrectionsPage() {
  const { userData, companyId, loading: companyLoading } = useCompany()
  const today = todayKey()
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [problems, setProblems] = useState<Problem[]>([])
  const [problemsLoading, setProblemsLoading] = useState(false)
  const [history, setHistory] = useState<CorrectionRow[]>([])
  const [formUid, setFormUid] = useState("")
  const [formDate, setFormDate] = useState(today)
  const [formActionType, setFormActionType] = useState<
    "check_in" | "check_out"
  >("check_in")
  const [formStatus, setFormStatus] = useState("hadir")
  const [formTime, setFormTime] = useState("07:58")
  const [formReason, setFormReason] = useState("")
  const [formFile, setFormFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const employeeByUid = useMemo(() => {
    const map = new Map<string, EmployeeRow>()
    employees.forEach((e) => map.set(e.uid, e))
    return map
  }, [employees])

  const activeEmployees = useMemo(
    () =>
      employees.filter((e) => {
        const status = String(e.status_akun || "").toLowerCase()
        return status === "active" || status === "verified"
      }),
    [employees]
  )

  const detectProblems = useCallback(async () => {
    if (!companyId) return
    setProblemsLoading(true)
    try {
      const usersSnap = await get(ref(db, paths.companyUsers(companyId)))
      if (!usersSnap.exists()) {
        setEmployees([])
        setProblems([])
        return
      }
      const val = usersSnap.val() as Record<string, Record<string, unknown>>
      const users = Object.keys(val).map((k) => ({
        ...(val[k] as Record<string, unknown>),
        uid: k,
      })) as EmployeeRow[]
      setEmployees(users)
      const active = users.filter((e) => {
        const status = String(e.status_akun || "").toLowerCase()
        return status === "active" || status === "verified"
      })
      const found: Problem[] = []
      await Promise.all(
        active.map(async (emp) => {
          const snap = await get(
            ref(db, paths.attendanceUser(companyId, emp.uid) + `/${today}`)
          )
          const actions = snap.exists()
            ? (snap.val() as Record<string, Record<string, unknown>>)
            : null
          const checkIn = pickAction(actions, [
            "check_in",
            "check-in",
            "in",
            "masuk",
          ])
          const checkOut = pickAction(actions, [
            "check_out",
            "check-out",
            "out",
            "pulang",
          ])
          const name = employeeName(emp)
          if (checkIn) {
            const status = String(
              checkIn.attendance_status || checkIn.status || ""
            ).toLowerCase()
            if (
              status.includes("terlambat") ||
              status.includes("late") ||
              status.includes("telat")
            ) {
              found.push({
                uid: emp.uid,
                name,
                issue: "Terlambat",
                actionType: "check_in",
                tone: "warning",
              })
            }
            if (
              status.includes("luar_radius") ||
              status.includes("luar radius") ||
              status.includes("outside")
            ) {
              found.push({
                uid: emp.uid,
                name,
                issue: "Check-in di luar radius",
                actionType: "check_in",
                tone: "danger",
              })
            }
          }
          if (checkOut) {
            const status = String(
              checkOut.attendance_status || checkOut.status || ""
            ).toLowerCase()
            if (
              status.includes("pulang_cepat") ||
              status.includes("pulang cepat") ||
              status.includes("early")
            ) {
              found.push({
                uid: emp.uid,
                name,
                issue: "Pulang lebih awal",
                actionType: "check_out",
                tone: "warning",
              })
            }
            if (
              status.includes("luar_radius") ||
              status.includes("luar radius") ||
              status.includes("outside")
            ) {
              found.push({
                uid: emp.uid,
                name,
                issue: "Check-out di luar radius",
                actionType: "check_out",
                tone: "danger",
              })
            }
          }
          if (checkIn && !checkOut) {
            found.push({
              uid: emp.uid,
              name,
              issue: "Check-out tidak tercatat",
              actionType: "check_out",
              tone: "warning",
            })
          }
          if (!checkIn) {
            const schedule = await resolveScheduleForUser({
              companyId,
              uid: emp.uid,
              date: today,
            }).catch(() => null)
            if (schedule && schedule.scheduleReady && schedule.todayActive) {
              found.push({
                uid: emp.uid,
                name,
                issue: "Tidak absen masuk",
                actionType: "check_in",
                tone: "warning",
              })
            }
          }
        })
      )
      setProblems(found)
    } catch (err) {
      toast.error(
        (err as Error)?.message || "Gagal mendeteksi masalah hari ini."
      )
    } finally {
      setProblemsLoading(false)
    }
  }, [companyId, today])

  useEffect(() => {
    const timer = setTimeout(() => void detectProblems(), 0)
    return () => clearTimeout(timer)
  }, [detectProblems])

  useEffect(() => {
    if (!companyId) return
    const unsub = manualListen({
      key: "attendance_corrections",
      path: paths.attendanceCorrections(companyId),
      onData: (value) => {
        const val = value as Record<string, Record<string, unknown>> | null
        if (!val) {
          setHistory([])
          return
        }
        const rows = Object.keys(val).map((k) => ({
          ...(val[k] as Record<string, unknown>),
          id: k,
        })) as CorrectionRow[]
        rows.sort(
          (a, b) => Number(b.created_at || 0) - Number(a.created_at || 0)
        )
        setHistory(rows)
      },
      onError: (err) =>
        toast.error(`Gagal memuat riwayat koreksi: ${err.message}`),
    })
    return () => unsub()
  }, [companyId])

  const prefillFromProblem = (problem: Problem) => {
    setFormUid(problem.uid)
    setFormDate(today)
    setFormActionType(problem.actionType)
    setFormReason(problem.issue)
    document
      .getElementById("kr-nama")
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const submitCorrection = async () => {
    if (!companyId || !userData) return
    if (!formUid) {
      toast.error("Pilih karyawan terlebih dahulu.")
      return
    }
    if (!formDate || !formTime) {
      toast.error("Tanggal dan waktu baru wajib diisi.")
      return
    }
    if (!formReason.trim()) {
      toast.error("Alasan koreksi wajib diisi.")
      return
    }
    setSaving(true)
    try {
      const recordPath = paths.attendanceRecord(
        companyId,
        formUid,
        formDate,
        formActionType
      )
      const existingSnap = await get(ref(db, recordPath))
      const existing = existingSnap.exists()
        ? (existingSnap.val() as Record<string, unknown>)
        : {}
      const oldValue = String(existing.waktu || existing.time || "")

      // Lampiran (opsional, tambahan mockup): simpan di field koreksi —
      // TIDAK PERNAH ke photo_url/photo_path.
      let attachmentUrl = ""
      let attachmentPath = ""
      if (formFile) {
        attachmentPath = `correction_attachments/${companyId}/${formUid}/${formDate}/${Date.now()}_${formFile.name}`
        await uploadBytes(storageRef(storage, attachmentPath), formFile)
        attachmentUrl = await getDownloadURL(
          storageRef(storage, attachmentPath)
        )
      }

      const correctionRef = push(
        ref(db, paths.attendanceCorrections(companyId))
      )
      const correctionId = correctionRef.key || ""
      await set(correctionRef, {
        uid: formUid,
        company_id: companyId,
        date: formDate,
        tanggal: formDate,
        action_type: formActionType,
        old_value: oldValue,
        new_value: formTime,
        reason: formReason.trim(),
        attendance_status: formStatus,
        status: "approved",
        corrected_by: userData.uid,
        corrected_by_name: userData.nama_lengkap || "",
        correction_attachment_url: attachmentUrl,
        correction_attachment_path: attachmentPath,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      await set(ref(db, recordPath), {
        ...existing,
        company_id: companyId,
        uid: formUid,
        date: formDate,
        tanggal: formDate,
        time: formTime,
        waktu: formTime,
        action_type: formActionType,
        method: "correction",
        status: "success",
        attendance_status: formStatus,
        correction_id: correctionId,
        corrected_by: userData.uid,
        corrected_by_name: userData.nama_lengkap || "",
        corrected_at: Date.now(),
        updated_at: Date.now(),
      })
      await writeAuditLog(companyId, {
        action: "MANUAL_CORRECTION",
        details: `Koreksi manual ${formUid} ${formDate} ${formActionType}: ${oldValue || "-"} → ${formTime}. Alasan: ${formReason.trim()}`,
        user_uid: userData.uid,
        user_name: userData.nama_lengkap || "",
        target_path: recordPath,
        old_value: oldValue,
        new_value: formTime,
      })
      await createNotification(formUid, {
        company_id: companyId,
        title: "Koreksi Presensi",
        message: `Absensi Anda tanggal ${formatTanggal(formDate)} telah dikoreksi oleh admin (${formActionType === "check_in" ? "masuk" : "pulang"} → ${formTime}).`,
        type: "info",
        ref_type: "attendance_correction",
        ref_id: correctionId,
      })
      setProblems((prev) =>
        prev.filter(
          (p) =>
            !(
              p.uid === formUid &&
              p.actionType === formActionType &&
              p.issue === formReason.trim()
            )
        )
      )
      toast.success("Koreksi berhasil disimpan.")
      setFormReason("")
      setFormFile(null)
    } catch (err) {
      toast.error(
        (err as Error)?.message || "Gagal menyimpan koreksi."
      )
    } finally {
      setSaving(false)
    }
  }

  if (!userData && !companyLoading) {
    return (
      <EmptyState>
        <p>Silakan masuk untuk melihat koreksi absensi.</p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Koreksi Absensi"
        description="Perbaiki catatan absensi karyawan — admin menginput langsung, atau menindaklanjuti pengajuan karyawan"
      />

      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/10 dark:text-emerald-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Lampiran koreksi tidak pernah menimpa foto absensi.</b> Saat
          koreksi disetujui, lampiran disimpan di field{" "}
          <code className="font-mono">correction_attachment_url</code> — foto
          absensi di <code className="font-mono">photo_url</code> tetap utuh.
          Ini inti fix bug 2b, dan desain halaman ini menjaganya: kartu foto
          dan kartu lampiran selalu terpisah.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Masalah Hari Ini</CardTitle>
          <p className="text-sm text-muted-foreground">
            {formatTanggal(today)} · catatan absensi yang terdeteksi bermasalah
            dan butuh koreksi
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {problemsLoading ? (
            <EmptyState>
              <p>Mendeteksi masalah hari ini...</p>
            </EmptyState>
          ) : problems.length === 0 ? (
            <EmptyState>
              <p>Tidak ada masalah absensi hari ini.</p>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Tanggal</th>
                    <th className="px-4 py-3 font-medium">Nama / UID</th>
                    <th className="px-4 py-3 font-medium">Masalah</th>
                    <th className="px-4 py-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {problems.map((problem, i) => (
                    <tr key={`${problem.uid}-${problem.issue}-${i}`}>
                      <td className="px-4 py-3 font-mono">
                        {formatTanggal(today)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{problem.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {problem.uid}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={problem.tone}>
                          {problem.issue}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => prefillFromProblem(problem)}
                        >
                          Koreksi
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

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Riwayat Koreksi</CardTitle>
            <p className="text-sm text-muted-foreground">
              Koreksi yang sudah diinput admin
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <EmptyState>
                <p>Belum ada riwayat koreksi.</p>
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Tgl &amp; Action</th>
                      <th className="px-4 py-3 font-medium">Perubahan Waktu</th>
                      <th className="px-4 py-3 font-medium">Alasan</th>
                      <th className="px-4 py-3 font-medium">Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {history.map((row) => {
                      const emp = employeeByUid.get(row.uid)
                      return (
                        <tr key={row.id}>
                          <td className="px-4 py-3 font-medium">
                            {emp ? employeeName(emp) : row.uid}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono">
                              {formatTanggal(String(row.date || row.tanggal || ""))}
                            </div>
                            <StatusBadge tone="primary" className="mt-1">
                              {row.action_type === "check_out"
                                ? "Pulang"
                                : "Masuk"}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {String(row.old_value || "—").slice(0, 5)} →{" "}
                            <b>{String(row.new_value || "").slice(0, 5)}</b>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {String(row.reason || "-")}
                          </td>
                          <td className="px-4 py-3">
                            {String(row.corrected_by_name || "-")}
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
            <CardTitle>Input Koreksi</CardTitle>
            <p className="text-sm text-muted-foreground">
              Isi form ini untuk memperbaiki satu catatan absensi
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Nama Karyawan" htmlFor="kr-nama">
              <Select value={formUid} onValueChange={setFormUid}>
                <SelectTrigger id="kr-nama">
                  <SelectValue placeholder="Pilih karyawan" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((emp) => (
                    <SelectItem key={emp.uid} value={emp.uid}>
                      {employeeName(emp)}
                      {emp.nip ? ` · ${String(emp.nip)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal" htmlFor="kr-tanggal">
                <Input
                  id="kr-tanggal"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                />
              </Field>
              <Field label="Tipe (check_in / check_out)" htmlFor="kr-tipe">
                <Select
                  value={formActionType}
                  onValueChange={(v) =>
                    setFormActionType(v as "check_in" | "check_out")
                  }
                >
                  <SelectTrigger id="kr-tipe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check_in">check_in — Masuk</SelectItem>
                    <SelectItem value="check_out">check_out — Pulang</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status Absensi" htmlFor="kr-status">
                <Select value={formStatus} onValueChange={setFormStatus}>
                  <SelectTrigger id="kr-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hadir">Hadir</SelectItem>
                    <SelectItem value="terlambat">Terlambat</SelectItem>
                    <SelectItem value="luar_radius">Luar Radius</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Set Waktu Baru" htmlFor="kr-waktu">
                <Input
                  id="kr-waktu"
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Alasan" htmlFor="kr-alasan">
              <Textarea
                id="kr-alasan"
                placeholder="mis. Fingerprint lantai 2 error, ada foto bukti..."
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
              />
            </Field>
            <Field label="Lampiran pendukung (opsional)">
              <label
                htmlFor="kr-lampiran"
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/40"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded bg-muted">
                  <Paperclip className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate">
                    {formFile ? formFile.name : "Pilih file lampiran..."}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Disimpan di correction_attachment_url — bukan photo_url
                  </span>
                </span>
              </label>
              <Input
                id="kr-lampiran"
                type="file"
                className="hidden"
                onChange={(e) => setFormFile(e.target.files?.[0] || null)}
              />
            </Field>
            <div>
              <Button disabled={saving} onClick={() => void submitCorrection()}>
                {saving ? "Menyimpan..." : "Simpan Koreksi"}
              </Button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Masalah hari ini dimuat ulang otomatis tiap buka halaman.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void detectProblems()}
                disabled={problemsLoading}
              >
                Muat ulang
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
