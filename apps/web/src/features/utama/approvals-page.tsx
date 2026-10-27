// Persetujuan — halaman Utama (Dewi).
// Mengikuti mockup approvals.html + logika Approvals.tsx lama (3 jenis
// pengajuan: izin/cuti, QR absensi, koreksi presensi).
// FIX BUG 2b WAJIB (lihat FIX-approvals-2b.md): saat koreksi disetujui,
// lampiran ditulis ke correction_attachment_url / correction_attachment_path
// — JANGAN PERNAH menimpa photo_url / photo_path. Kode lama (baris 608–613
// dan 678–683) justru menimpa photo_url; baris itu diganti di sini dan
// ditandai "FIX 2b". Modal detail menampilkan dua kartu terpisah
// (Foto Absensi vs Lampiran Koreksi) seperti mockup.
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearch } from "@tanstack/react-router"
import { get, ref, update } from "firebase/database"
import {
  Download,
  Paperclip,
  Shield,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
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
import { db, getFileUrl } from "@/lib/firebase"
import { paths } from "@/lib/firebase-paths"
import { manualListen } from "@/lib/rtdb-data-gate"
import { writeAuditLog } from "@/lib/firebase-audit"
import { createNotification } from "@/lib/firebase-notify"
import { resolveScheduleForUser } from "./schedule-data"
import {
  AvatarInitials,
  EmptyState,
  StatusBadge,
  UtamaTabs,
} from "./ui"
import {
  dateReason,
  downloadCsv,
  durationLabel,
  employeeName,
  employeeNip,
  formatTanggal,
  formatTanggalWaktu,
  leaveTypeLabel,
  leaveTypeValue,
  statusBadgeVariant,
  statusLabel,
  textValue,
} from "./format"

type RequestKind = "leave" | "qr" | "correction"
type ApprovalRequest = Record<string, unknown> & {
  id: string
  request_id: string
  kind: RequestKind
}

type ApprovalTab = "semua" | "izin" | "qr" | "koreksi"

// B3: nilai tab lama (?tab=leave|correction) dipetakan ke id baru; nilai
// tak dikenal mengembalikan null supaya tab lokal tidak diacak-acak.
function normalizeTab(value: string | undefined): ApprovalTab | null {
  if (value === "izin" || value === "leave") return "izin"
  if (value === "qr") return "qr"
  if (value === "koreksi" || value === "correction") return "koreksi"
  if (value === "semua") return "semua"
  return null
}

function formatOvertimeDuration(minuteValue: unknown): string {
  const minutes = Number(minuteValue || 0)
  if (!Number.isFinite(minutes) || minutes <= 0) return ""
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  if (hours <= 0) return `${minutes} menit`
  if (remain <= 0) return `${hours} jam`
  return `${hours} jam ${remain} menit`
}

// B4: satu tanggal pengajuan (lembur memakai overtime_date; izin memakai
// rentang date_start..date_end bila ada).
function requestDateKey(req: ApprovalRequest): string {
  return String(
    req.overtime_date ||
      req.date ||
      req.tanggal ||
      req.start_date ||
      req.date_start ||
      req.tanggal_mulai ||
      ""
  )
}

function requestMatchesDate(req: ApprovalRequest, dateKey: string): boolean {
  if (!dateKey) return true
  if (req.kind === "leave") {
    const start = String(
      req.date_start ||
        req.tanggal_mulai ||
        req.overtime_date ||
        req.date ||
        req.tanggal ||
        req.start_date ||
        ""
    )
    const end = String(
      req.date_end ||
        req.tanggal_selesai ||
        req.date_start ||
        req.tanggal_mulai ||
        req.overtime_date ||
        req.date ||
        req.tanggal ||
        req.start_date ||
        ""
    )
    if (start && end) return start <= dateKey && dateKey <= end
    if (start) return start === dateKey
    return false
  }
  return requestDateKey(req) === dateKey
}

const PENDING_LEAVE = ["pending", "pending_admin", "processing"]

function isPendingStatus(status: unknown): boolean {
  return PENDING_LEAVE.includes(String(status || ""))
}

function snapshotToList(
  val: Record<string, unknown> | null,
  kind: RequestKind
): ApprovalRequest[] {
  if (!val) return []
  const rows = Object.keys(val).map((k) => {
    const row = (val[k] as Record<string, unknown>) || {}
    return {
      ...row,
      id: k,
      request_id: String(row.request_id || k),
      kind,
    } as ApprovalRequest
  })
  rows.sort(
    (a, b) => Number(b.created_at || 0) - Number(a.created_at || 0)
  )
  return rows
}

function correctionTypeLabel(req: ApprovalRequest): string {
  const t = String(req.correction_type || req.corr_type || "masuk")
  if (t === "pulang") return "Koreksi Pulang"
  if (t === "masuk_pulang") return "Koreksi Masuk & Pulang"
  return "Koreksi Masuk"
}

function requestDetailText(req: ApprovalRequest): string {
  if (req.kind === "leave") {
    // B7: pengajuan lembur menampilkan tanggal + jam lembur + durasi,
    // seperti aplikasi lama (Approvals.tsx:883-887).
    if (
      leaveTypeValue(req) === "lembur" &&
      (req.overtime_date || req.overtime_start_time || req.overtime_end_time)
    ) {
      const date = String(
        req.overtime_date ||
          req.date_start ||
          req.tanggal_mulai ||
          req.date ||
          req.tanggal ||
          ""
      )
      const start = String(req.overtime_start_time || "")
      const end = String(req.overtime_end_time || "")
      const dur = formatOvertimeDuration(req.overtime_duration_minute)
      const reason = dateReason(req)
      return [
        date ? formatTanggal(date) : "",
        start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : "",
        dur,
        reason !== "-" ? reason : "",
      ]
        .filter(Boolean)
        .join(" · ")
    }
    const parts = [durationLabel(req)]
    const reason = dateReason(req)
    if (reason !== "-") parts.push(reason)
    return parts.join(" · ")
  }
  if (req.kind === "qr") {
    const action =
      String(req.action_type || "masuk") === "pulang"
        ? "Check-out"
        : "Check-in"
    const time = String(req.time || req.waktu || "")
    const distance = Number(req.distance_meter || 0)
    const radius = Number(req.radius_meter || 0)
    let text = `${action}${time ? ` ${time.slice(0, 5)}` : ""}`
    // B2: status radius selalu tampil (Dalam/Luar + meter), seperti lama.
    if (distance > 0 && radius > 0) {
      text += ` · ${distance <= radius ? "Dalam" : "Luar"} radius (${distance} m / ${radius} m)`
    }
    return text
  }
  // correction
  const corrType = String(req.correction_type || req.corr_type || "masuk")
  const oldIn = String(req.old_check_in_time || req.old_time || "")
  const newIn = String(req.requested_check_in_time || "")
  const oldOut = String(req.old_check_out_time || "")
  const newOut = String(req.requested_check_out_time || "")
  const reason = dateReason(req)
  if (corrType === "pulang") {
    return `Pulang ${oldOut ? `${oldOut.slice(0, 5)} → ` : ""}${newOut.slice(0, 5)}${reason !== "-" ? ` · ${reason}` : ""}`
  }
  if (corrType === "masuk_pulang") {
    // B8: koreksi gabungan menampilkan Masuk DAN Pulang (lama: :1084-1090).
    const masuk = `Masuk ${oldIn ? `${oldIn.slice(0, 5)} → ` : ""}${newIn.slice(0, 5)}`
    const pulang = `Pulang ${oldOut ? `${oldOut.slice(0, 5)} → ` : ""}${newOut.slice(0, 5)}`
    return `${masuk} · ${pulang}${reason !== "-" ? ` · ${reason}` : ""}`
  }
  return `Masuk ${oldIn ? `${oldIn.slice(0, 5)} → ` : ""}${newIn.slice(0, 5)}${reason !== "-" ? ` · ${reason}` : ""}`
}

function requestTypeBadge(req: ApprovalRequest) {
  if (req.kind === "leave") {
    return (
      <StatusBadge tone="info">
        {leaveTypeLabel(leaveTypeValue(req))}
      </StatusBadge>
    )
  }
  if (req.kind === "qr") {
    return <StatusBadge tone="neutral">QR Absensi</StatusBadge>
  }
  return <StatusBadge tone="primary">{correctionTypeLabel(req)}</StatusBadge>
}

function requestDate(req: ApprovalRequest): string {
  // B7: overtime_date (lembur) + date_start/tanggal_mulai ikut dibaca.
  const d = String(
    req.overtime_date ||
      req.date ||
      req.tanggal ||
      req.start_date ||
      req.date_start ||
      req.tanggal_mulai ||
      ""
  )
  if (d) return formatTanggal(d)
  const created = Number(req.created_at || 0)
  if (created) return formatTanggalWaktu(created).slice(0, 11)
  return "-"
}

// B9: sumber lampiran per jenis (izin: attachment_url; koreksi:
// correction_attachment_* dulu, lalu attachment_url; QR: tidak ada).
function requestAttachment(req: ApprovalRequest): string {
  if (req.kind === "correction") {
    return String(
      req.correction_attachment_url ||
        req.correction_attachment_path ||
        req.attachment_url ||
        req.attachment_path ||
        ""
    )
  }
  if (req.kind === "leave") {
    return String(req.attachment_url || req.attachment_path || "")
  }
  return ""
}

export function ApprovalsPage({
  initialTab,
  initialStatus,
}: {
  initialTab?: string
  initialStatus?: string
}) {
  const {
    userData,
    companyId,
    companies,
    isOwner,
    selectCompany,
    loading: companyLoading,
  } = useCompany()
  // B4: param `date` dibaca langsung dari search route (route hanya
  // meneruskan tab/status sebagai prop) — deep-link ?date=... kini memfilter.
  const search = useSearch({ from: "/admin/approvals" })
  const [leaveRequests, setLeaveRequests] = useState<ApprovalRequest[]>([])
  const [qrRequests, setQrRequests] = useState<ApprovalRequest[]>([])
  const [correctionRequests, setCorrectionRequests] = useState<
    ApprovalRequest[]
  >([])
  const [employees, setEmployees] = useState<Record<string, Record<string, unknown>>>({})
  // B6: tiap listener menandai sudah pernah mengembalikan data (termasuk
  // null = tidak ada data) — sebelum itu tabel menampilkan status muat,
  // bukan "Tidak ada pengajuan".
  const [loadedKeys, setLoadedKeys] = useState({
    leave: false,
    qr: false,
    correction: false,
  })
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<ApprovalTab>(
    normalizeTab(initialTab) ?? "semua"
  )
  const [dateFilter, setDateFilter] = useState(search.date || "")
  const [detailReq, setDetailReq] = useState<ApprovalRequest | null>(null)
  const [detailPhotoUrl, setDetailPhotoUrl] = useState("")
  const [detailAttachmentUrl, setDetailAttachmentUrl] = useState("")
  const [detailAttachmentField, setDetailAttachmentField] = useState("—")
  const [detailOldTime, setDetailOldTime] = useState("")
  const [detailNewTime, setDetailNewTime] = useState("")
  // B8: pasangan jam Pulang untuk koreksi masuk_pulang (selain Masuk).
  const [detailOldOutTime, setDetailOldOutTime] = useState("")
  const [detailNewOutTime, setDetailNewOutTime] = useState("")
  const [adminNote, setAdminNote] = useState("")
  const [savingAction, setSavingAction] = useState(false)
  const processingRef = useRef(false)

  const queryStatus = initialStatus || ""

  // B3/B4: sinkronkan tab & filter tanggal dari search param saat
  // navigasi dalam halaman yang sama (mis. klik kartu Dashboard) —
  // penyesuaian state saat render (pola React yang didokumentasikan),
  // bukan setState di dalam effect. Nilai tak dikenal tidak mengacak
  // tab lokal.
  const searchSyncKey = `${initialTab || ""}|${search.date || ""}`
  const [prevSearchSyncKey, setPrevSearchSyncKey] =
    useState(searchSyncKey)
  if (searchSyncKey !== prevSearchSyncKey) {
    setPrevSearchSyncKey(searchSyncKey)
    const next = normalizeTab(initialTab)
    if (next) setTab(next)
    setDateFilter(search.date || "")
  }

  // B6: ganti perusahaan (B5) mengulang status muat dari nol —
  // penyesuaian state saat render, bukan setState di dalam effect.
  const [prevCompanyIdForLoad, setPrevCompanyIdForLoad] =
    useState(companyId)
  if (companyId !== prevCompanyIdForLoad) {
    setPrevCompanyIdForLoad(companyId)
    setLoadedKeys({ leave: false, qr: false, correction: false })
    setLoadError("")
  }

  useEffect(() => {
    if (!companyId) return
    const markLoaded = (key: "leave" | "qr" | "correction") => () =>
      setLoadedKeys((prev) => ({ ...prev, [key]: true }))
    const unsubs = [
      manualListen({
        key: "leave_requests",
        path: paths.leaveRequests(companyId),
        onData: (value) => {
          markLoaded("leave")()
          setLeaveRequests(
            snapshotToList(
              (value as Record<string, unknown> | null) || null,
              "leave"
            )
          )
        },
        onError: (err) => {
          setLoadError(`Gagal memuat pengajuan izin: ${err.message}`)
          toast.error(`Gagal memuat pengajuan izin: ${err.message}`)
        },
      }),
      manualListen({
        key: "qr_requests",
        path: paths.qrRequests(companyId),
        onData: (value) => {
          markLoaded("qr")()
          setQrRequests(
            snapshotToList(
              (value as Record<string, unknown> | null) || null,
              "qr"
            )
          )
        },
        onError: (err) => {
          setLoadError(`Gagal memuat pengajuan QR: ${err.message}`)
          toast.error(`Gagal memuat pengajuan QR: ${err.message}`)
        },
      }),
      manualListen({
        key: "attendance_corrections",
        path: paths.attendanceCorrections(companyId),
        onData: (value) => {
          markLoaded("correction")()
          setCorrectionRequests(
            snapshotToList(
              (value as Record<string, unknown> | null) || null,
              "correction"
            )
          )
        },
        onError: (err) => {
          setLoadError(`Gagal memuat pengajuan koreksi: ${err.message}`)
          toast.error(`Gagal memuat pengajuan koreksi: ${err.message}`)
        },
      }),
    ]
    // Peta karyawan untuk NIP / departemen di modal detail.
    get(ref(db, paths.companyUsers(companyId)))
      .then((snap) => {
        if (snap.exists()) {
          setEmployees(
            snap.val() as Record<string, Record<string, unknown>>
          )
        }
      })
      .catch(() => undefined)
    return () => unsubs.forEach((u) => u())
  }, [companyId])

  const pendingLeaves = useMemo(
    () => leaveRequests.filter((r) => isPendingStatus(r.status)),
    [leaveRequests]
  )
  const pendingQR = useMemo(
    () =>
      qrRequests.filter(
        (r) => r.status === "pending_admin" || r.status === "pending"
      ),
    [qrRequests]
  )
  const pendingCorrections = useMemo(
    () =>
      correctionRequests.filter(
        (r) => r.status === "pending" || !r.status
      ),
    [correctionRequests]
  )
  const pendingTotal =
    pendingLeaves.length + pendingQR.length + pendingCorrections.length

  const visibleRequests = useMemo(() => {
    const onlyPending = queryStatus === "pending"
    const leaves = leaveRequests.filter(
      (req) => !onlyPending || isPendingStatus(req.status)
    )
    const qrs = qrRequests.filter(
      (req) =>
        !onlyPending ||
        req.status === "pending_admin" ||
        req.status === "pending"
    )
    const corrections = correctionRequests.filter(
      (req) => !onlyPending || req.status === "pending" || !req.status
    )
    let merged: ApprovalRequest[]
    if (tab === "izin") merged = leaves
    else if (tab === "qr") merged = qrs
    else if (tab === "koreksi") merged = corrections
    else merged = [...leaves, ...qrs, ...corrections]
    // B4: filter tanggal dari deep-link (?date=...) — izin dicocokkan
    // dengan rentang tanggalnya, QR/koreksi dengan tanggal tunggalnya.
    const dated = dateFilter
      ? merged.filter((req) => requestMatchesDate(req, dateFilter))
      : merged
    dated.sort(
      (a, b) => Number(b.created_at || 0) - Number(a.created_at || 0)
    )
    return dated
  }, [leaveRequests, qrRequests, correctionRequests, tab, queryStatus, dateFilter])

  // B1: NIP baris QR tidak ada di record pengajuan — ambil dari peta
  // karyawan (company_users) lewat uid/target_uid bila field langsung kosong.
  const nipFor = (req: ApprovalRequest): string => {
    const direct = employeeNip(req)
    if (direct !== "-") return direct
    const emp = employees[String(req.uid || req.target_uid || "")]
    return emp ? employeeNip(emp as Record<string, unknown>) : "-"
  }

  // B9: buka lampiran tabel (resolve URL file seperti openDetail).
  const openAttachment = async (req: ApprovalRequest) => {
    const source = requestAttachment(req)
    if (!source) return
    const url = await getFileUrl(source)
    if (url) window.open(url, "_blank")
    else toast.error("Lampiran tidak dapat dibuka.")
  }

  const openDetail = async (req: ApprovalRequest) => {
    setDetailReq(req)
    setAdminNote("")
    setDetailPhotoUrl("")
    setDetailAttachmentUrl("")
    setDetailAttachmentField("—")
    setDetailOldTime("")
    setDetailNewTime("")
    setDetailOldOutTime("")
    setDetailNewOutTime("")
    if (!companyId) return
    if (req.kind === "qr") {
      const url = await getFileUrl(
        String(req.photo_url || req.photo_path || "")
      )
      setDetailPhotoUrl(url)
    } else if (req.kind === "leave") {
      const url = await getFileUrl(
        String(req.attachment_url || req.attachment_path || "")
      )
      setDetailAttachmentUrl(url)
      setDetailAttachmentField("attachment_url")
    } else {
      // Koreksi: foto absensi diambil dari record absensi yang sudah ada
      // (photo_url milik record itu), lampiran dari field koreksi.
      const safeDate = String(req.date || req.tanggal || "")
      const uid = String(req.uid || "")
      const [masukSnap, pulangSnap] = await Promise.all([
        get(ref(db, paths.attendanceRecord(companyId, uid, safeDate, "masuk"))),
        get(ref(db, paths.attendanceRecord(companyId, uid, safeDate, "pulang"))),
      ])
      const masuk = masukSnap.exists()
        ? (masukSnap.val() as Record<string, unknown>)
        : null
      const pulang = pulangSnap.exists()
        ? (pulangSnap.val() as Record<string, unknown>)
        : null
      const corrType = String(
        req.correction_type || req.corr_type || "masuk"
      )
      const photoSource = corrType === "pulang" ? pulang || masuk : masuk || pulang
      if (photoSource) {
        const url = await getFileUrl(
          String(photoSource.photo_url || photoSource.photo_path || "")
        )
        setDetailPhotoUrl(url)
      }
      const attachmentSource =
        req.correction_attachment_url ||
        req.correction_attachment_path ||
        req.attachment_url ||
        req.attachment_path ||
        ""
      if (attachmentSource) {
        const url = await getFileUrl(String(attachmentSource))
        setDetailAttachmentUrl(url)
        setDetailAttachmentField(
          req.correction_attachment_url || req.correction_attachment_path
            ? "correction_attachment_url"
            : "attachment_url"
        )
      }
      const oldTime =
        corrType === "pulang"
          ? String(pulang?.waktu || pulang?.time || "")
          : String(masuk?.waktu || masuk?.time || "")
      const newTime =
        corrType === "pulang"
          ? String(req.requested_check_out_time || "")
          : String(req.requested_check_in_time || "")
      setDetailOldTime(oldTime)
      setDetailNewTime(newTime)
      // B8: pasangan Pulang dihitung juga, untuk koreksi masuk_pulang.
      setDetailOldOutTime(String(pulang?.waktu || pulang?.time || ""))
      setDetailNewOutTime(String(req.requested_check_out_time || ""))
    }
  }

  const confirmAction = async (actionStatus: "approved" | "rejected") => {
    if (!detailReq || !companyId) return
    if (processingRef.current) return
    if (actionStatus === "rejected" && !adminNote.trim()) {
      toast.error("Alasan penolakan wajib diisi.")
      return
    }
    processingRef.current = true
    setSavingAction(true)
    const actionReq = detailReq
    const actionType = actionReq.kind
    const noteText = adminNote.trim()
    const processApproval = async () => {
      let currentStatus: string
      if (actionType === "leave") {
        const snap = await get(
          ref(db, paths.leaveRequest(companyId, actionReq.request_id))
        )
        if (snap.exists()) currentStatus = String(snap.val().status)
        else throw new Error("Request tidak ditemukan.")
      } else if (actionType === "qr") {
        const snap = await get(
          ref(db, paths.qrRequest(companyId, actionReq.request_id))
        )
        if (snap.exists()) currentStatus = String(snap.val().status)
        else throw new Error("Request tidak ditemukan.")
      } else {
        const snap = await get(
          ref(db, paths.attendanceCorrection(companyId, actionReq.request_id))
        )
        if (snap.exists()) currentStatus = String(snap.val().status)
        else throw new Error("Request tidak ditemukan.")
      }
      const stillPending =
        actionType === "leave"
          ? isPendingStatus(currentStatus)
          : actionType === "qr"
            ? currentStatus === "pending_admin" || currentStatus === "pending"
            : currentStatus === "pending" || !currentStatus
      if (!stillPending) {
        throw new Error(
          `Request ini sudah diproses (${currentStatus}). Muat ulang halaman untuk melihat status terbaru.`
        )
      }

      if (actionType === "leave") {
        const currentType = leaveTypeValue(actionReq)
        const currentLabel = leaveTypeLabel(currentType)
        const updates: Record<string, unknown> = {}
        const base = paths.leaveRequest(companyId, actionReq.request_id)
        updates[`${base}/status`] = actionStatus
        updates[`${base}/admin_note`] = noteText
        if (actionStatus === "approved") {
          updates[`${base}/approved_by`] = userData?.uid
          updates[`${base}/approved_by_name`] = userData?.nama_lengkap
          updates[`${base}/approved_at`] = Date.now()
        } else {
          updates[`${base}/rejected_by`] = userData?.uid
          updates[`${base}/rejected_by_name`] = userData?.nama_lengkap
          updates[`${base}/rejected_at`] = Date.now()
        }
        updates[`${base}/updated_at`] = Date.now()
        await update(ref(db), updates)
        await writeAuditLog(companyId, {
          action: actionStatus === "approved" ? "APPROVE_LEAVE" : "REJECT_LEAVE",
          details: `Request ${actionReq.request_id}, type ${currentType}, status ${actionStatus}. Admin note: ${noteText || "-"}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "",
          target_path: base,
        })
        await createNotification(String(actionReq.uid || ""), {
          company_id: companyId,
          title:
            actionStatus === "approved"
              ? `${currentLabel} Disetujui`
              : `${currentLabel} Ditolak`,
          message: noteText
            ? `Admin note: ${noteText}`
            : actionStatus === "approved"
              ? `Pengajuan ${currentLabel.toLowerCase()} Anda disetujui.`
              : `Pengajuan ${currentLabel.toLowerCase()} Anda ditolak.`,
          type: actionStatus === "approved" ? "success" : "danger",
          ref_type: "leave_request",
          ref_id: actionReq.request_id,
        })
      } else if (actionType === "qr") {
        const updates: Record<string, unknown> = {}
        const base = paths.qrRequest(companyId, actionReq.request_id)
        updates[`${base}/status`] = actionStatus
        // B12: pakai noteText (sudah di-trim) seperti izin/koreksi.
        updates[`${base}/admin_note`] = noteText
        updates[`${base}/updated_at`] = Date.now()
        if (actionStatus === "approved") {
          const safeDate = String(actionReq.date || actionReq.tanggal || "")
          const safeTime =
            String(actionReq.time || actionReq.waktu || "") ||
            new Date().toISOString().split("T")[1].split(".")[0]
          const safeAction = String(actionReq.action_type || "masuk")
          const existingAttendance = await get(
            ref(
              db,
              paths.attendanceRecord(
                companyId,
                String(actionReq.target_uid || ""),
                safeDate,
                safeAction
              )
            )
          )
          if (existingAttendance.exists()) {
            throw new Error(
              "Attendance untuk user, tanggal, dan action ini sudah ada."
            )
          }
          const employeeSnap = await get(
            ref(
              db,
              paths.companyUser(companyId, String(actionReq.target_uid || ""))
            )
          )
          const employee = employeeSnap.exists()
            ? (employeeSnap.val() as Record<string, unknown>)
            : {}
          const schedule = await resolveScheduleForUser({
            companyId,
            uid: String(actionReq.target_uid || ""),
            date: safeDate,
          })
          updates[`${base}/approved_by`] = userData?.uid
          updates[`${base}/approved_by_name`] = userData?.nama_lengkap
          updates[`${base}/approved_at`] = Date.now()
          const attendanceRecord = {
            company_id: String(actionReq.company_id || companyId),
            uid: actionReq.target_uid,
            date: safeDate,
            tanggal: safeDate,
            time: safeTime,
            waktu: safeTime,
            action_type: safeAction,
            method: "qr",
            source: "admin_web",
            status: "approved",
            validation_status: "approved",
            attendance_status: schedule.attendance_status || "hadir",
            photo_url: actionReq.photo_url || "",
            photo_path: actionReq.photo_path || "",
            photo_quality_status: actionReq.photo_quality_status || null,
            photo_quality_warning: actionReq.photo_quality_warning || null,
            photo_file_size: actionReq.photo_file_size || null,
            photo_width: actionReq.photo_width || null,
            photo_height: actionReq.photo_height || null,
            latitude: actionReq.latitude || null,
            longitude: actionReq.longitude || null,
            accuracy: actionReq.accuracy || 0,
            location_accuracy: actionReq.location_accuracy || null,
            location_accuracy_warning:
              actionReq.location_accuracy_warning || null,
            mock_location_detected:
              actionReq.mock_location_detected !== undefined
                ? actionReq.mock_location_detected
                : null,
            location_mock_warning: actionReq.location_mock_warning || null,
            location_risk_level: actionReq.location_risk_level || null,
            location_warning: actionReq.location_warning || null,
            location_provider: actionReq.location_provider || null,
            office_latitude: actionReq.office_latitude || null,
            office_longitude: actionReq.office_longitude || null,
            distance_meter: actionReq.distance_meter || 0,
            radius_meter: actionReq.radius_meter || 0,
            geofence_status:
              actionReq.geofence_status ||
              (Number(actionReq.radius_meter || 0) > 0 &&
              Number(actionReq.distance_meter || 0) <=
                Number(actionReq.radius_meter || 0)
                ? "inside"
                : "outside"),
            office_id:
              actionReq.target_office_id ||
              employee.office_id ||
              actionReq.office_id ||
              "",
            office_name:
              actionReq.target_office_name ||
              employee.office_name ||
              actionReq.office_name ||
              "",
            department_id:
              actionReq.target_department_id ||
              employee.department_id ||
              actionReq.department_id ||
              "",
            department_name:
              actionReq.target_department_name ||
              employee.department_name ||
              actionReq.department_name ||
              "",
            sub_department_id:
              actionReq.target_sub_department_id ||
              employee.sub_department_id ||
              actionReq.sub_department_id ||
              "",
            sub_department_name:
              actionReq.target_sub_department_name ||
              employee.sub_department_name ||
              actionReq.sub_department_name ||
              "",
            group_id:
              actionReq.target_group_id ||
              employee.group_id ||
              actionReq.group_id ||
              "",
            group_name:
              actionReq.target_group_name ||
              employee.group_name ||
              actionReq.group_name ||
              "",
            helper_office_id: actionReq.helper_office_id || "",
            helper_office_name: actionReq.helper_office_name || "",
            helper_department_id: actionReq.helper_department_id || "",
            helper_department_name: actionReq.helper_department_name || "",
            helper_sub_department_id:
              actionReq.helper_sub_department_id || "",
            helper_sub_department_name:
              actionReq.helper_sub_department_name || "",
            helper_group_id: actionReq.helper_group_id || "",
            helper_group_name: actionReq.helper_group_name || "",
            assignment_id: schedule.assignment_id || "",
            assignment_start_date: schedule.assignment_start_date || "",
            assignment_end_date: schedule.assignment_end_date || "",
            shift_id: schedule.shift_id || "",
            shift_name: schedule.shift_name || "",
            timetable_id: schedule.timetable_id || "",
            timetable_name: schedule.timetable_name || "",
            schedule_source: schedule.schedule_source || "none",
            work_start: schedule.work_start || "",
            work_end: schedule.work_end || "",
            check_in_start: schedule.check_in_start || "",
            check_in_end: schedule.check_in_end || "",
            check_out_start: schedule.check_out_start || "",
            check_out_end: schedule.check_out_end || "",
            late_tolerance_minute: schedule.late_tolerance_minute || 0,
            early_out_tolerance_minute:
              schedule.early_out_tolerance_minute || 0,
            crosses_midnight:
              schedule.crosses_midnight !== undefined
                ? schedule.crosses_midnight
                : false,
            overtime_flag:
              schedule.overtime_flag !== undefined
                ? schedule.overtime_flag
                : false,
            overtime_schedule_id: schedule.overtime_schedule_id || "",
            is_holiday_work:
              schedule.is_holiday_work !== undefined
                ? schedule.is_holiday_work
                : false,
            created_by_qr: true,
            proxy_request_id: actionReq.request_id,
            qr_request_id: actionReq.request_id,
            qr_helper_uid: actionReq.helper_uid || "",
            qr_helper_name: actionReq.helper_name || "",
            approved_by: userData?.uid || "",
            approved_by_name: userData?.nama_lengkap || "",
            approved_at: Date.now(),
            created_at: Date.now(),
            updated_at: Date.now(),
          }
          updates[
            paths.attendanceRecord(
              companyId,
              String(actionReq.target_uid || ""),
              safeDate,
              safeAction
            )
          ] = attendanceRecord
        } else {
          updates[`${base}/rejected_by`] = userData?.uid
          updates[`${base}/rejected_by_name`] = userData?.nama_lengkap
          updates[`${base}/rejected_at`] = Date.now()
        }
        await update(ref(db), updates)
        await writeAuditLog(companyId, {
          action: actionStatus === "approved" ? "APPROVE_QR" : "REJECT_QR",
          details: `Admin note: ${noteText}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "",
          target_path: base,
        })
        await createNotification(String(actionReq.target_uid || ""), {
          company_id: companyId,
          title:
            actionStatus === "approved"
              ? "QR Attendance Disetujui"
              : "QR Attendance Ditolak",
          message: noteText
            ? `Admin note: ${noteText}`
            : actionStatus === "approved"
              ? "Kehadiran melalui QR teman disetujui."
              : "Kehadiran melalui QR ditolak.",
          type: actionStatus === "approved" ? "success" : "danger",
          ref_type: "qr_attendance_request",
          ref_id: actionReq.request_id,
        })
        if (actionReq.helper_uid) {
          await createNotification(String(actionReq.helper_uid), {
            company_id: companyId,
            title:
              actionStatus === "approved"
                ? "Approve Scanner QR"
                : "Reject Scanner QR",
            message: `Pengajuan Anda scan untuk ${String(actionReq.target_name || "")} telah di${actionStatus === "approved" ? "setujui" : "tolak"}.`,
            type: "info",
            ref_type: "qr_attendance_request",
            ref_id: actionReq.request_id,
          })
        }
      } else {
        // correction — FIX 2b: lampiran ke correction_attachment_url/path.
        const safeDate = String(actionReq.date || actionReq.tanggal || "")
        const updates: Record<string, unknown> = {}
        const base = paths.attendanceCorrection(companyId, actionReq.request_id)
        updates[`${base}/status`] = actionStatus
        updates[`${base}/admin_note`] = noteText
        if (actionStatus === "approved") {
          updates[`${base}/approved_by`] = userData?.uid
          updates[`${base}/approved_by_name`] = userData?.nama_lengkap
          updates[`${base}/approved_at`] = Date.now()
        } else {
          updates[`${base}/rejected_by`] = userData?.uid
          updates[`${base}/rejected_by_name`] = userData?.nama_lengkap
          updates[`${base}/rejected_at`] = Date.now()
        }
        updates[`${base}/updated_at`] = Date.now()
        if (actionStatus === "approved") {
          // B12: fallback `corr_type` seperti openDetail/requestDetailText.
          const corrType = String(
            actionReq.correction_type || actionReq.corr_type || "masuk"
          )
          const employeeSnap = await get(
            ref(db, paths.companyUser(companyId, String(actionReq.uid || "")))
          )
          const employee = employeeSnap.exists()
            ? (employeeSnap.val() as Record<string, unknown>)
            : {}
          const schedule = await resolveScheduleForUser({
            companyId,
            uid: String(actionReq.uid || ""),
            date: safeDate,
          })
          const buildRecord = async (
            action: "masuk" | "pulang",
            safeTime: string
          ) => {
            const existingSnap = await get(
              ref(
                db,
                paths.attendanceRecord(
                  companyId,
                  String(actionReq.uid || ""),
                  safeDate,
                  action
                )
              )
            )
            const existing = existingSnap.exists()
              ? (existingSnap.val() as Record<string, unknown>)
              : {}
            // FIX 2b: {...existing} mempertahankan photo_url/photo_path
            // record lama; lampiran HANYA ditulis ke
            // correction_attachment_url/path — photo_url TIDAK PERNAH
            // disentuh di sini (kode lama menimpanya dengan attachment).
            const record: Record<string, unknown> = {
              ...existing,
              company_id: companyId,
              uid: actionReq.uid,
              date: safeDate,
              tanggal: safeDate,
              time: safeTime,
              waktu: safeTime,
              action_type: action,
              method: "correction",
              source: "admin_web",
              status: "approved",
              validation_status: "approved",
              attendance_status: schedule.attendance_status || "hadir",
              correction_request_id: actionReq.request_id,
              corrected_by: userData?.uid || "",
              corrected_by_name: userData?.nama_lengkap || "",
              corrected_at: Date.now(),
              admin_note: noteText,
              office_id:
                actionReq.office_id ||
                employee.office_id ||
                existing.office_id ||
                "",
              office_name:
                actionReq.office_name ||
                employee.office_name ||
                existing.office_name ||
                "",
              department_id:
                actionReq.department_id ||
                employee.department_id ||
                existing.department_id ||
                "",
              department_name:
                actionReq.department_name ||
                employee.department_name ||
                existing.department_name ||
                "",
              sub_department_id:
                actionReq.sub_department_id ||
                employee.sub_department_id ||
                existing.sub_department_id ||
                "",
              sub_department_name:
                actionReq.sub_department_name ||
                employee.sub_department_name ||
                existing.sub_department_name ||
                "",
              group_id:
                actionReq.group_id ||
                employee.group_id ||
                existing.group_id ||
                "",
              group_name:
                actionReq.group_name ||
                employee.group_name ||
                existing.group_name ||
                "",
              assignment_id: schedule.assignment_id || "",
              assignment_start_date: schedule.assignment_start_date || "",
              assignment_end_date: schedule.assignment_end_date || "",
              shift_id: schedule.shift_id || "",
              shift_name: schedule.shift_name || "",
              timetable_id: schedule.timetable_id || "",
              timetable_name: schedule.timetable_name || "",
              schedule_source: schedule.schedule_source || "none",
              work_start: schedule.work_start || "",
              work_end: schedule.work_end || "",
              check_in_start: schedule.check_in_start || "",
              check_in_end: schedule.check_in_end || "",
              check_out_start: schedule.check_out_start || "",
              check_out_end: schedule.check_out_end || "",
              late_tolerance_minute: schedule.late_tolerance_minute || 0,
              early_out_tolerance_minute:
                schedule.early_out_tolerance_minute || 0,
              crosses_midnight:
                schedule.crosses_midnight !== undefined
                  ? schedule.crosses_midnight
                  : false,
              overtime_flag:
                schedule.overtime_flag !== undefined
                  ? schedule.overtime_flag
                  : false,
              overtime_schedule_id: schedule.overtime_schedule_id || "",
              is_holiday_work:
                schedule.is_holiday_work !== undefined
                  ? schedule.is_holiday_work
                  : false,
              created_at: existing.created_at || Date.now(),
              updated_at: Date.now(),
            }
            // FIX 2b — lampiran ke field terpisah. B11: bila pengajuan
            // membawa lampiran di correction_attachment_url/path, pakai
            // itu dulu (openDetail sudah membacanya) — jangan buang.
            const attachUrl =
              actionReq.correction_attachment_url || actionReq.attachment_url
            const attachPath =
              actionReq.correction_attachment_path ||
              actionReq.attachment_path
            if (attachUrl) {
              record.correction_attachment_url = attachUrl
            }
            if (attachPath) {
              record.correction_attachment_path = attachPath
            }
            return record
          }
          if (corrType === "masuk" || corrType === "masuk_pulang") {
            const safeTime = String(
              actionReq.requested_check_in_time || "08:00:00"
            )
            updates[
              paths.attendanceRecord(
                companyId,
                String(actionReq.uid || ""),
                safeDate,
                "masuk"
              )
            ] = await buildRecord("masuk", safeTime)
          }
          if (corrType === "pulang" || corrType === "masuk_pulang") {
            const safeTime = String(
              actionReq.requested_check_out_time || "17:00:00"
            )
            updates[
              paths.attendanceRecord(
                companyId,
                String(actionReq.uid || ""),
                safeDate,
                "pulang"
              )
            ] = await buildRecord("pulang", safeTime)
          }
        }
        await update(ref(db), updates)
        await writeAuditLog(companyId, {
          action:
            actionStatus === "approved"
              ? "APPROVE_CORRECTION"
              : "REJECT_CORRECTION",
          details: `Koreksi request ${actionReq.request_id}, status ${actionStatus}. Admin note: ${noteText || "-"}`,
          user_uid: userData?.uid || "",
          user_name: userData?.nama_lengkap || "",
          target_path: base,
        })
        await createNotification(String(actionReq.uid || ""), {
          company_id: companyId,
          title:
            actionStatus === "approved"
              ? "Koreksi Presensi Disetujui"
              : "Koreksi Presensi Ditolak",
          message:
            actionStatus === "approved"
              ? `Koreksi presensi tanggal ${safeDate} telah disetujui.`
              : `Koreksi presensi tanggal ${safeDate} ditolak. Admin note: ${noteText}`,
          type: actionStatus === "approved" ? "success" : "danger",
          ref_type: "attendance_correction",
          ref_id: actionReq.request_id,
        })
      }
      return "Aksi berhasil diproses"
    }
    toast
      .promise(processApproval(), {
        loading: "Memproses persetujuan...",
        success: (msg) => {
          setDetailReq(null)
          setAdminNote("")
          return msg
        },
        error: (err: Error) => `Gagal memproses aksi: ${err.message}`,
      })
      .unwrap()
      .catch(() => undefined)
      .finally(() => {
        setSavingAction(false)
        processingRef.current = false
      })
  }

  const exportCsv = () => {
    downloadCsv(
      `persetujuan-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Pengaju", "NIP", "Jenis", "Detail", "Tanggal", "Status"],
      visibleRequests.map((req) => [
        employeeName(req),
        nipFor(req),
        req.kind === "leave"
          ? leaveTypeLabel(leaveTypeValue(req))
          : req.kind === "qr"
            ? "QR Absensi"
            : correctionTypeLabel(req),
        requestDetailText(req),
        requestDate(req),
        statusLabel(String(req.status || "pending")),
      ])
    )
  }

  const detailEmployee = detailReq
    ? employees[String(detailReq.uid || detailReq.target_uid || "")]
    : undefined

  // B8: jenis koreksi untuk pasangan jam di modal (masuk/pulang/masuk_pulang).
  const detailCorrType = detailReq
    ? String(detailReq.correction_type || detailReq.corr_type || "masuk")
    : "masuk"

  // B6: semua listener sudah pernah mengembalikan data.
  const dataLoaded =
    loadedKeys.leave && loadedKeys.qr && loadedKeys.correction

  if (!userData && !companyLoading) {
    return (
      <EmptyState>
        <p>Silakan masuk untuk melihat pengajuan.</p>
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Persetujuan"
        description={`${pendingTotal} pengajuan menunggu keputusan — izin, QR absensi, dan koreksi presensi`}
        actions={
          <div className="flex items-center gap-2">
            {/* B5: owner bisa ganti perusahaan dari halaman ini,
                seperti aplikasi lama (Approvals.tsx:792-800). */}
            {isOwner && companies.length > 0 && (
              <Select value={companyId || undefined} onValueChange={selectCompany}>
                <SelectTrigger className="w-64" aria-label="Perusahaan">
                  <SelectValue placeholder="Perusahaan" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id ?? ""}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Ekspor CSV
            </Button>
          </div>
        }
      />

      {/* B4: chip filter tanggal dari deep-link — bisa dihapus. */}
      {dateFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            Filter tanggal: <b>{formatTanggal(dateFilter)}</b>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDateFilter("")}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Hapus filter
          </Button>
        </div>
      )}

      {/* B6: error muat tampil persisten, bukan hanya toast. */}
      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/50 dark:bg-red-900/10 dark:text-red-300">
          {loadError}
        </div>
      )}

      <UtamaTabs
        active={tab}
        onChange={(id) => setTab(normalizeTab(id) ?? "semua")}
        tabs={[
          { id: "semua", label: "Semua", count: pendingTotal },
          { id: "izin", label: "Izin & Cuti", count: pendingLeaves.length },
          { id: "qr", label: "QR Absensi", count: pendingQR.length },
          {
            id: "koreksi",
            label: "Koreksi",
            count: pendingCorrections.length,
          },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {/* B6: selama listener belum mengembalikan data, tampilkan
              status muat — bukan daftar kosong palsu. */}
          {companyLoading || !dataLoaded ? (
            <EmptyState>
              <p>Memuat data persetujuan...</p>
            </EmptyState>
          ) : visibleRequests.length === 0 ? (
            <EmptyState>
              <p>Tidak ada pengajuan pada tab ini.</p>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Pengaju</th>
                    <th className="px-4 py-3 font-medium">Jenis</th>
                    <th className="px-4 py-3 font-medium">Detail</th>
                    <th className="px-4 py-3 font-medium">Tanggal</th>
                    <th className="px-4 py-3 font-medium">Lampiran</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleRequests.map((req) => (
                    <tr key={`${req.kind}-${req.id}`} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <AvatarInitials name={employeeName(req)} />
                          <div>
                            <div className="font-medium">
                              {employeeName(req)}
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {nipFor(req)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{requestTypeBadge(req)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {requestDetailText(req)}
                      </td>
                      <td className="px-4 py-3">{requestDate(req)}</td>
                      {/* B9: kolom Lampiran (lama: Approvals.tsx:905-915)
                          + peringatan bukti sakit bila wajib tapi tak ada. */}
                      <td className="px-4 py-3">
                        {req.kind === "qr" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : requestAttachment(req) ? (
                          <button
                            type="button"
                            onClick={() => void openAttachment(req)}
                            className="inline-flex items-center gap-1 text-primary underline"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {textValue(
                              req.attachment_name || req.attachmentName,
                              "Lampiran"
                            )}
                          </button>
                        ) : (
                          <div>
                            <span className="text-muted-foreground">
                              Tidak ada lampiran
                            </span>
                            {req.kind === "leave" &&
                              (req.attachment_required ||
                                leaveTypeValue(req) === "sakit") && (
                                <div className="mt-1 text-[11px] text-red-500">
                                  Bukti sakit wajib untuk data baru.
                                </div>
                              )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          tone={
                            statusBadgeVariant(
                              String(req.status || "pending")
                            ) as
                              | "success"
                              | "warning"
                              | "danger"
                              | "info"
                              | "primary"
                              | "neutral"
                          }
                        >
                          {statusLabel(String(req.status || "pending"))}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openDetail(req)}
                        >
                          Detail
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

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <b>Aturan tampilan foto &amp; lampiran (inti fix bug 2b).</b> Foto
          absensi dan lampiran koreksi adalah dua dokumen berbeda dengan field
          penyimpanan berbeda. Menyetujui koreksi <b>tidak pernah</b> menimpa
          foto absensi. Di modal detail, keduanya tampil di kartu terpisah
          dengan nama field-nya.
        </div>
      </div>

      <Dialog
        open={detailReq !== null}
        onOpenChange={(open) => {
          if (!open) setDetailReq(null)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detailReq && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Detail Pengajuan —{" "}
                  {detailReq.kind === "leave"
                    ? leaveTypeLabel(leaveTypeValue(detailReq))
                    : detailReq.kind === "qr"
                      ? "QR Absensi"
                      : "Koreksi Presensi"}
                </DialogTitle>
                <DialogDescription>
                  Diajukan{" "}
                  {formatTanggalWaktu(Number(detailReq.created_at || 0))}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Karyawan</dt>
                  <dd className="font-medium">{employeeName(detailReq)}</dd>
                  <dt className="text-muted-foreground">NIP</dt>
                  <dd className="font-mono">{nipFor(detailReq)}</dd>
                  <dt className="text-muted-foreground">Departemen</dt>
                  <dd>
                    {textValue(
                      detailEmployee?.department_name ||
                        detailReq.department_name ||
                        detailReq.department_id,
                      "-"
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Jenis</dt>
                  <dd>
                    {detailReq.kind === "leave"
                      ? `${leaveTypeLabel(leaveTypeValue(detailReq))} — ${durationLabel(detailReq)}`
                      : detailReq.kind === "qr"
                        ? "QR Absensi"
                        : correctionTypeLabel(detailReq)}
                  </dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge
                      tone={
                        statusBadgeVariant(
                          String(detailReq.status || "pending")
                        ) as
                          | "success"
                          | "warning"
                          | "danger"
                          | "info"
                          | "primary"
                          | "neutral"
                      }
                    >
                      {statusLabel(String(detailReq.status || "pending"))}
                    </StatusBadge>
                  </dd>
                </dl>

                {/* B2: info audit QR (lama: Approvals.tsx:1185-1230) —
                    tanpa ini admin menyetujui QR secara buta. */}
                {detailReq.kind === "qr" && (
                  <div className="rounded-lg border p-3">
                    <div className="mb-2 text-sm font-medium">
                      Audit Lokasi QR
                    </div>
                    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
                      <dt className="text-muted-foreground">
                        Karyawan Target
                      </dt>
                      <dd className="font-medium">
                        {textValue(detailReq.target_name, "-")}
                      </dd>
                      <dt className="text-muted-foreground">
                        Didaftarkan Oleh
                      </dt>
                      <dd>
                        {textValue(detailReq.helper_name, "-")}
                        {detailReq.helper_office_name
                          ? ` (${String(detailReq.helper_office_name)})`
                          : ""}
                      </dd>
                      <dt className="text-muted-foreground">Unit Target</dt>
                      <dd>
                        {textValue(
                          detailReq.target_office_name ||
                            detailReq.helper_office_name,
                          "-"
                        )}
                      </dd>
                      <dt className="text-muted-foreground">
                        Status Radius
                      </dt>
                      <dd
                        className={
                          Number(detailReq.distance_meter || 0) <=
                          Number(detailReq.radius_meter || 0)
                            ? "font-medium text-teal-600"
                            : "font-medium text-red-600"
                        }
                      >
                        {Number(detailReq.distance_meter || 0) <=
                        Number(detailReq.radius_meter || 0)
                          ? "Dalam Radius"
                          : "Luar Radius"}{" "}
                        ({Number(detailReq.distance_meter || 0)} m /{" "}
                        {Number(detailReq.radius_meter || 0)} m)
                      </dd>
                      <dt className="text-muted-foreground">Lokasi</dt>
                      <dd>
                        {detailReq.latitude && detailReq.longitude ? (
                          <>
                            <span className="font-mono text-xs">
                              {String(detailReq.latitude)},{" "}
                              {String(detailReq.longitude)}
                            </span>{" "}
                            <a
                              href={`https://maps.google.com/?q=${detailReq.latitude},${detailReq.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline"
                            >
                              Lihat Lokasi
                            </a>
                            <span className="block text-xs text-muted-foreground">
                              Akurasi GPS:{" "}
                              {detailReq.location_accuracy !== undefined
                                ? `${String(detailReq.location_accuracy)} m`
                                : detailReq.accuracy
                                  ? `${String(detailReq.accuracy)} m`
                                  : "—"}
                              {detailReq.location_accuracy_warning
                                ? ` (${String(detailReq.location_accuracy_warning)})`
                                : ""}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </dd>
                      <dt className="text-muted-foreground">Risk Level</dt>
                      <dd>
                        {textValue(detailReq.location_risk_level, "low")}
                      </dd>
                      <dt className="text-muted-foreground">Foto Bukti</dt>
                      <dd>
                        {detailReq.photo_width && detailReq.photo_height
                          ? `${String(detailReq.photo_width)}×${String(detailReq.photo_height)} px`
                          : "—"}
                        {detailReq.photo_file_size
                          ? ` · ${(Number(detailReq.photo_file_size) / 1024).toFixed(0)} KB`
                          : ""}
                        {detailReq.photo_quality_status
                          ? ` · kualitas: ${String(detailReq.photo_quality_status)}`
                          : ""}
                        {detailReq.photo_quality_warning
                          ? ` (${String(detailReq.photo_quality_warning)})`
                          : ""}
                      </dd>
                    </dl>
                    {detailReq.mock_location_detected ? (
                      <p className="mt-2 text-sm font-bold uppercase text-red-500">
                        ⚠️ Lokasi Palsu Terdeteksi!
                        {detailReq.location_mock_warning
                          ? ` (${String(detailReq.location_mock_warning)})`
                          : ""}
                      </p>
                    ) : null}
                    {detailReq.location_warning ? (
                      <p className="mt-1 text-xs italic text-amber-500">
                        Warning: {String(detailReq.location_warning)}
                      </p>
                    ) : null}
                  </div>
                )}

                {/* B8: pasangan Masuk DAN Pulang untuk masuk_pulang
                    (lama: Approvals.tsx:1293-1299). */}
                {detailReq.kind === "correction" &&
                  detailCorrType !== "pulang" &&
                  detailNewTime && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-lg border p-3 text-center">
                        <div className="text-xs text-muted-foreground">
                          Tercatat (Masuk)
                        </div>
                        <div className="text-lg font-bold">
                          {detailOldTime ? detailOldTime.slice(0, 5) : "—"}
                        </div>
                      </div>
                      <span aria-hidden>→</span>
                      <div className="flex-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-center">
                        <div className="text-xs text-muted-foreground">
                          Diajukan (Masuk)
                        </div>
                        <div className="text-lg font-bold">
                          {detailNewTime.slice(0, 5)}
                        </div>
                      </div>
                    </div>
                  )}
                {detailReq.kind === "correction" &&
                  detailCorrType !== "masuk" &&
                  detailNewOutTime && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-lg border p-3 text-center">
                        <div className="text-xs text-muted-foreground">
                          Tercatat (Pulang)
                        </div>
                        <div className="text-lg font-bold">
                          {detailOldOutTime
                            ? detailOldOutTime.slice(0, 5)
                            : "—"}
                        </div>
                      </div>
                      <span aria-hidden>→</span>
                      <div className="flex-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-center">
                        <div className="text-xs text-muted-foreground">
                          Diajukan (Pulang)
                        </div>
                        <div className="text-lg font-bold">
                          {detailNewOutTime.slice(0, 5)}
                        </div>
                      </div>
                    </div>
                  )}

                <div>
                  <div className="mb-1 text-sm font-medium">Alasan</div>
                  <p className="text-sm text-muted-foreground">
                    {dateReason(detailReq)}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border">
                    <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4" />
                      Foto Absensi
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        photo_url
                      </span>
                    </div>
                    <div className="p-3 text-sm">
                      {detailPhotoUrl ? (
                        <a
                          href={detailPhotoUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={detailPhotoUrl}
                            alt="Foto absensi"
                            className="max-h-56 w-full rounded object-cover"
                          />
                        </a>
                      ) : (
                        <p className="py-4 text-center text-muted-foreground">
                          {detailReq.kind === "leave"
                            ? "Pengajuan izin tidak memerlukan foto absensi."
                            : "Tidak ada foto absensi pada pengajuan ini."}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border">
                    <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                      <Paperclip className="h-4 w-4" />
                      {/* B9: judul kartu mengikuti jenis pengajuan —
                          sebelumnya hardcoded "Lampiran Koreksi". */}
                      {detailReq.kind === "leave"
                        ? "Lampiran Izin"
                        : detailReq.kind === "correction"
                          ? "Lampiran Koreksi"
                          : "Lampiran"}
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        {detailAttachmentField}
                      </span>
                    </div>
                    <div className="p-3 text-sm">
                      {detailAttachmentUrl ? (
                        <a
                          href={detailAttachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          Buka lampiran
                        </a>
                      ) : (
                        <p className="py-4 text-center text-muted-foreground">
                          Tidak ada lampiran pada pengajuan ini.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* B9: catatan field ini hanya benar untuk koreksi. */}
                {detailReq.kind === "correction" && (
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Lampiran disimpan di field{" "}
                      <code className="font-mono">correction_attachment_url</code>{" "}
                      — foto absensi di{" "}
                      <code className="font-mono">photo_url</code>{" "}
                      <b>tetap utuh</b> setelah koreksi disetujui.
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="m-catatan"
                    className="text-sm font-medium"
                  >
                    Catatan admin
                  </label>
                  <Textarea
                    id="m-catatan"
                    placeholder="Tulis catatan keputusan di sini (wajib bila menolak)"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDetailReq(null)}
                >
                  Tutup
                </Button>
                <Button
                  variant="destructive"
                  disabled={savingAction}
                  onClick={() => void confirmAction("rejected")}
                >
                  Tolak
                </Button>
                <Button
                  disabled={savingAction}
                  onClick={() => void confirmAction("approved")}
                >
                  Setujui
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
