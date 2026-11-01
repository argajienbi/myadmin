/**
 * Halaman Log Notifikasi — mengikuti mockup notification-logs.html:
 * 6 blok (Antrean Push, Log Aksi Sistem, Log Detail FCM per Token,
 * Debug Center, Kesehatan Token FCM, Log Scheduler Reminder) + filter
 * (Status, Tipe/Ref, Karyawan, Tanggal, ID teknis). Logika mengikuti
 * NotificationLogs.tsx myadmin lama (test event bypass filtering,
 * retry antrean, reset dedupe hari ini, token Firestore + mirror RTDB).
 *
 * Deviasi dari mockup: tombol "Hapus Token" diimplementasikan sebagai
 * Nonaktifkan (set active=false + invalid_reason, seperti kode lama —
 * dokumen token tidak dihapus); "stage production/staging" pada form
 * custom disimpan ke dalam data notifikasi sebagai `stage`.
 */
import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { localDateString } from "@/lib/rtdb-lean-service"
import { CompanySelect, FirebaseNotConfigured } from "../shared"
import { formatDateTime, maskId } from "@/lib/display-utils"
import {
  TEST_EVENT_TYPES,
  deactivateToken,
  fetchTokenHealth,
  removeNotificationQueueItem,
  resetDedupeToday,
  retryQueueItem,
  sendTestEvent,
  useNotificationLogs,
  type FcmToken,
  type NotificationLogRow,
  type TestEventType,
} from "./api"

const ANY = "any"

function statusBadge(status?: string) {
  const s = (status ?? "").toLowerCase()
  if (s === "sent" || s === "delivered" || s === "success")
    return <Badge variant="default">{status}</Badge>
  if (s === "pending" || s === "queued")
    return <Badge variant="outline">{status}</Badge>
  if (s === "failed" || s === "error")
    return <Badge variant="destructive">{status}</Badge>
  return <Badge variant="secondary">{status ?? "—"}</Badge>
}

export function NotificationLogsPage() {
  const { companies, companyId, isOwner, selectCompany } = useCompanyScope()
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [typeFilter, setTypeFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState(ANY)
  const [dateFilter, setDateFilter] = useState("")
  const [showTechnicalIds, setShowTechnicalIds] = useState(false)
  const [tokens, setTokens] = useState<FcmToken[] | null>(null)
  const [tokensLoading, setTokensLoading] = useState(false)

  // Debug Center
  const [testTargetUid, setTestTargetUid] = useState("")
  const [customTitle, setCustomTitle] = useState("")
  const [customBody, setCustomBody] = useState("")
  const [customStage, setCustomStage] = useState("production")
  const [customAction, setCustomAction] = useState<TestEventType>("test_push")
  const [reminderDirection, setReminderDirection] = useState<"check_in" | "check_out">("check_in")
  const [reminderStage, setReminderStage] = useState<"pre" | "now" | "late">("pre")
  const [testSending, setTestSending] = useState(false)

  const logsQuery = useNotificationLogs(companyId)
  const data = logsQuery.data
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["ks", "notification-logs", companyId],
    })

  const retry = useMutation({
    mutationFn: (item: Parameters<typeof retryQueueItem>[1]) =>
      retryQueueItem(companyId, item),
    onSuccess: () => {
      toast.success("Antrean berhasil dipicu ulang.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal me-retry antrean: ${e.message}`),
  })
  const removeItem = useMutation({
    mutationFn: (id: string) => removeNotificationQueueItem(companyId, id),
    onSuccess: () => {
      toast.success("Antrean berhasil dihapus.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const resetDedupe = useMutation({
    mutationFn: () => resetDedupeToday(companyId),
    onSuccess: (result) => {
      toast.success(
        `Reset selesai. Terhapus: ${result.deleted}, cocok: ${result.matched} (${result.dateKey}).`,
      )
    },
    onError: (e: Error) => toast.error(`Gagal reset dedupe: ${e.message}`),
  })
  const deactivate = useMutation({
    mutationFn: (token: FcmToken) => deactivateToken(companyId, token),
    onSuccess: () => {
      toast.success("Token berhasil dinonaktifkan.")
      setTokens(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const userName = (uid?: string) => {
    const user = data?.users.find((u) => (u.uid ?? u.id) === uid)
    return user?.nama_lengkap ?? user?.email ?? uid ?? "—"
  }

  const matchesFilters = (row: {
    status?: string
    type?: string
    ref_type?: string
    uid?: string
    created_at?: number
  }) => {
    if (statusFilter !== ANY && (row.status ?? "") !== statusFilter) return false
    if (typeFilter) {
      const hay = `${row.type ?? ""} ${row.ref_type ?? ""}`.toLowerCase()
      if (!hay.includes(typeFilter.toLowerCase())) return false
    }
    if (employeeFilter !== ANY && row.uid !== employeeFilter) return false
    if (dateFilter && row.created_at) {
      if (localDateString(new Date(row.created_at)) !== dateFilter) return false
    }
    return true
  }

  const filteredQueue = useMemo(
    () => (data?.queue ?? []).filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, statusFilter, typeFilter, employeeFilter, dateFilter],
  )
  const filteredLogs = useMemo(
    () =>
      (data?.logs ?? []).filter((row: NotificationLogRow) =>
        matchesFilters({
          status: row.status,
          type: row.type ?? (row.action as string | undefined),
          ref_type: row.ref_type,
          uid: row.uid,
          created_at: row.created_at,
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, statusFilter, typeFilter, employeeFilter, dateFilter],
  )

  const runTest = async (eventType: TestEventType, uidOverride?: string) => {
    const targetUid = uidOverride ?? testTargetUid
    if (!targetUid) {
      toast.error("Silakan pilih target karyawan.")
      return
    }
    setTestSending(true)
    try {
      await sendTestEvent(companyId, targetUid, eventType, {
        title: customTitle || undefined,
        body: customBody || undefined,
        reminderDirection,
        reminderStage,
        stage: customStage,
        targetAction: customAction,
      })
      toast.success(`Berhasil mengirimkan test [${eventType}]. Cek antrean.`)
      void invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim test.")
    } finally {
      setTestSending(false)
    }
  }

  const runAllScenarios = async () => {
    if (!testTargetUid) {
      toast.error("Silakan pilih target karyawan.")
      return
    }
    setTestSending(true)
    try {
      for (const { id } of TEST_EVENT_TYPES) {
        await sendTestEvent(companyId, testTargetUid, id, {
          title: customTitle || undefined,
          body: customBody || undefined,
          reminderDirection,
          reminderStage,
          stage: customStage,
          targetAction: customAction,
        })
      }
      toast.success("4 skenario test berhasil dikirim. Cek antrean.")
      void invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim skenario.")
    } finally {
      setTestSending(false)
    }
  }

  const loadTokens = async () => {
    if (!data) return
    setTokensLoading(true)
    try {
      const list = await fetchTokenHealth(companyId, data.users)
      setTokens(list)
      toast.success("Kesehatan Token FCM berhasil diperbarui.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat token.")
    } finally {
      setTokensLoading(false)
    }
  }

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Log Notifikasi"
          description="Antrean push, log pengiriman, token FCM, dan debug center."
        />
        <FirebaseNotConfigured title="Data log notifikasi belum dapat dimuat." />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Log Notifikasi"
        description="Antrean push, log pengiriman, token FCM, dan debug center."
        actions={
          <div className="flex gap-2">
            {isOwner && (
              <CompanySelect
                companies={companies}
                value={companyId}
                onChange={selectCompany}
              />
            )}
            <Button
              variant="outline"
              onClick={() => void invalidate()}
              disabled={logsQuery.isFetching}
            >
              Muat Ulang
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-6">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" aria-label="Filter status">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Semua Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-44"
            placeholder="Tipe / Ref..."
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          />
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-52" aria-label="Filter karyawan">
              <SelectValue placeholder="Semua Karyawan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Semua Karyawan</SelectItem>
              {(data?.users ?? []).map((u) => (
                <SelectItem key={u.uid ?? u.id} value={u.uid ?? u.id ?? ""}>
                  {u.nama_lengkap ?? u.email ?? u.uid}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            className="w-44"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter tanggal"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={showTechnicalIds}
              onCheckedChange={(c) => setShowTechnicalIds(c === true)}
            />
            Tampilkan ID teknis
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Antrean Push</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jadwal Buat</TableHead>
                <TableHead>Judul & Isi</TableHead>
                <TableHead>Status & Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={3}
                loading={logsQuery.isLoading}
                empty={filteredQueue.length === 0}
                error={logsQuery.error as Error | null}
                emptyText="Tidak ada antrean push yang cocok dengan filter."
              />
              {filteredQueue.slice(0, 50).map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(item.created_at)}
                    {item.scheduled_at
                      ? ` (jadwal ${formatDateTime(item.scheduled_at)})`
                      : ""}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{item.title ?? "—"}</p>
                    <p className="max-w-md truncate text-xs text-muted-foreground">
                      {item.message ?? ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {userName(item.uid)}
                      {showTechnicalIds && item.uid ? ` · ${item.uid}` : ""}
                      {item.retry_count ? ` · retry ${item.retry_count}` : ""}
                      {item.error ? ` · ${item.error}` : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(item.status)}
                      {(item.status === "failed" || item.status === "error") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retry.mutate(item)}
                          disabled={retry.isPending}
                        >
                          Retry
                        </Button>
                      )}
                      <ConfirmAction
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                          >
                            Hapus
                          </Button>
                        }
                        title="Hapus antrean?"
                        description={`Hapus antrean "${item.title ?? ""}" dari daftar?`}
                        confirmLabel="Hapus"
                        onConfirm={() => removeItem.mutate(item.id ?? "")}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredQueue.length > 50 && (
            <p className="pt-2 text-xs text-muted-foreground">
              Menampilkan 50 dari {filteredQueue.length} antrean.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log Aksi Sistem</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Aksi / Judul</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={4}
                loading={logsQuery.isLoading}
                empty={filteredLogs.length === 0}
                error={logsQuery.error as Error | null}
                emptyText="Tidak ada log aksi sistem yang cocok dengan filter."
              />
              {filteredLogs.slice(0, 50).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">
                      {row.title ?? row.action ?? row.type ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.message ?? row.body ?? ""}
                    </p>
                  </TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.error ?? row.ref_type ?? "—"}
                    {showTechnicalIds && row.uid ? (
                      <span className="block font-mono">{row.uid}</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log Detail FCM per Token</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>UID / Token</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={4}
                loading={logsQuery.isLoading}
                empty={(data?.deliveryLogs.length ?? 0) === 0}
                error={logsQuery.error as Error | null}
                emptyText="Belum ada log detail FCM."
              />
              {(data?.deliveryLogs ?? []).slice(0, 50).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{userName(row.uid)}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {showTechnicalIds
                        ? (row.token ?? row.token_id ?? "—")
                        : maskId(row.token ?? row.token_id ?? "")}
                    </p>
                  </TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.error ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Debug Center</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Test push melewati filter pengaturan (skipSettingsCheck) — dipakai
            untuk menguji pengiriman ke satu karyawan.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="debug-target">Target Karyawan</Label>
              <Select value={testTargetUid || undefined} onValueChange={setTestTargetUid}>
                <SelectTrigger id="debug-target">
                  <SelectValue placeholder="Pilih karyawan" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.users ?? []).map((u) => (
                    <SelectItem key={u.uid ?? u.id} value={u.uid ?? u.id ?? ""}>
                      {u.nama_lengkap ?? u.email ?? u.uid}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="debug-stage">Stage</Label>
              <Select value={customStage} onValueChange={setCustomStage}>
                <SelectTrigger id="debug-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="debug-title">Judul</Label>
              <Input
                id="debug-title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Test Push MYPRESENCE"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="debug-action">Target Action</Label>
              <Select
                value={customAction}
                onValueChange={(v) => setCustomAction(v as TestEventType)}
              >
                <SelectTrigger id="debug-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEST_EVENT_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="debug-body">Isi</Label>
              <Textarea
                id="debug-body"
                rows={2}
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                placeholder="Ini adalah test push dari dashboard admin."
              />
            </div>
            {customAction === "reminder" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="debug-direction">Arah Reminder</Label>
                  <Select
                    value={reminderDirection}
                    onValueChange={(v) =>
                      setReminderDirection(v as "check_in" | "check_out")
                    }
                  >
                    <SelectTrigger id="debug-direction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="check_in">Masuk</SelectItem>
                      <SelectItem value="check_out">Pulang</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="debug-reminder-stage">Tahap Reminder</Label>
                  <Select
                    value={reminderStage}
                    onValueChange={(v) =>
                      setReminderStage(v as "pre" | "now" | "late")
                    }
                  >
                    <SelectTrigger id="debug-reminder-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pre">Sebelum (pre)</SelectItem>
                      <SelectItem value="now">Saat ini (now)</SelectItem>
                      <SelectItem value="late">Terlambat (late)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {TEST_EVENT_TYPES.map((t) => (
              <Button
                key={t.id}
                variant="outline"
                disabled={testSending || !testTargetUid}
                onClick={() => void runTest(t.id)}
              >
                {t.label}
              </Button>
            ))}
            <Button
              disabled={testSending || !testTargetUid}
              onClick={() => void runTest(customAction)}
            >
              Kirim Test
            </Button>
            <Button
              variant="secondary"
              disabled={testSending || !testTargetUid}
              onClick={() => void runAllScenarios()}
            >
              Jalankan 4 Skenario
            </Button>
            <ConfirmAction
              trigger={
                <Button variant="outline" disabled={resetDedupe.isPending}>
                  Reset Dedupe Hari Ini
                </Button>
              }
              title="Reset Dedupe Reminder?"
              description="Reminder yang sudah terkirim hari ini bisa dikirim ulang. Hanya untuk testing."
              confirmLabel="Reset"
              onConfirm={() => resetDedupe.mutate()}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Aktor: {actor.name || "Admin"} — test tercatat di antrean push.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kesehatan Token FCM</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button onClick={() => void loadTokens()} disabled={tokensLoading}>
              {tokensLoading ? "Memeriksa..." : "Periksa Token"}
            </Button>
          </div>
          {tokens && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  colSpan={5}
                  loading={false}
                  empty={tokens.length === 0}
                  emptyText="Tidak ada token FCM."
                />
                {tokens.map((token) => (
                  <TableRow key={`${token.uid}-${token.token_id}`}>
                    <TableCell>
                      <p className="font-medium">{token.userName}</p>
                      <p className="text-xs text-muted-foreground">
                        {token.source_label}
                        {token.device_name ? ` · ${token.device_name}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {showTechnicalIds
                        ? token.token_id
                        : maskId(token.token_id)}
                      {token.is_current ? " · saat ini" : ""}
                    </TableCell>
                    <TableCell className="text-sm">
                      {token.platform ?? "—"}
                      {token.app_source ? ` (${token.app_source})` : ""}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          token.effective_status === "current_ok"
                            ? "default"
                            : token.effective_status === "inactive"
                              ? "secondary"
                              : token.effective_status === "current_blocked"
                                ? "destructive"
                                : "outline"
                        }
                      >
                        {token.effective_status}
                      </Badge>
                      {token.invalid_reason && (
                        <span className="block text-xs text-muted-foreground">
                          {token.invalid_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={testSending}
                          onClick={() => {
                            void runTest("test_push", token.uid)
                          }}
                        >
                          Test Push
                        </Button>
                        {token.active && (
                          <ConfirmAction
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                              >
                                Nonaktifkan
                              </Button>
                            }
                            title="Nonaktifkan token?"
                            description={`Token ${maskId(token.token_id)} milik ${token.userName} akan dinonaktifkan.`}
                            confirmLabel="Nonaktifkan"
                            onConfirm={() => deactivate.mutate(token)}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log Scheduler Reminder</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Karyawan</TableHead>
                <TableHead>Judul</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={4}
                loading={logsQuery.isLoading}
                empty={(data?.schedulerLogs.length ?? 0) === 0}
                error={logsQuery.error as Error | null}
                emptyText="Belum ada log scheduler reminder."
              />
              {(data?.schedulerLogs ?? []).slice(0, 50).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(row.created_at)}
                  </TableCell>
                  <TableCell>{userName(row.uid)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{row.title ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.message ?? ""}
                    </p>
                  </TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
