/**
 * Halaman Pengaturan Notifikasi — mengikuti mockup
 * notification-settings.html: Global Settings (Push, In-App), Pengingat
 * Presensi Otomatis (master + 6 toggle pre/now/late × masuk/pulang +
 * input menit), Kategori Notifikasi (4 toggle), Pengaturan Lanjutan
 * Scheduler (interval, jam aktif, libur). Logika mengikuti
 * NotificationSettings.tsx myadmin lama (RTDB node
 * notification_settings/main, clamp + mirror legacy saat simpan).
 */
import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
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
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"
import { PageHeader } from "@/components/page"
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { createUserNotificationAndPush } from "@/lib/firebase-notify"
import { CompanySelect, FirebaseNotConfigured } from "../shared"
import type { NotificationSettings } from "@/lib/firebase-types"
import {
  saveNotificationSettings,
  useInstalledUsers,
  useNotificationSettings,
} from "./api"

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
        <span>
          {label}
          {hint && (
            <span className="block text-xs text-muted-foreground">{hint}</span>
          )}
        </span>
      </label>
      {children}
    </div>
  )
}

function MinutesInput({
  label,
  value,
  disabled,
  min,
  max,
  onChange,
}: {
  label: string
  value: number | undefined
  disabled?: boolean
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        className="w-20"
        min={min}
        max={max}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      mnt
    </label>
  )
}

/**
 * Kirim Push Langsung — kartu di luar form pengaturan (tombolnya tidak
 * ikut submit). Penerima hanya karyawan yang sudah menginstal aplikasi
 * (punya token FCM aktif); pesan masuk inbox + antrean push, lalu
 * Worker FCM mengirimkannya (biasanya < 1 menit). Status pengiriman
 * bisa dicek di Log Notifikasi.
 */
function DirectPushCard({
  companyId,
  actor,
}: {
  companyId: string
  actor: { uid: string; name: string }
}) {
  const installedQuery = useInstalledUsers(companyId)
  const installed = installedQuery.data ?? []
  const [targetUid, setTargetUid] = useState("")
  const [pushTitle, setPushTitle] = useState("")
  const [pushBody, setPushBody] = useState("")
  const send = useMutation({
    mutationFn: async () => {
      if (!targetUid) throw new Error("Pilih dulu karyawan penerima.")
      if (!pushTitle.trim() || !pushBody.trim())
        throw new Error("Judul dan pesan wajib diisi.")
      const queueId = await createUserNotificationAndPush(
        companyId,
        targetUid,
        {
          title: pushTitle.trim(),
          message: pushBody.trim(),
          type: "info",
          ref_type: "manual",
          skipSettingsCheck: true,
          created_by: actor.uid,
          created_by_name: actor.name,
        },
      )
      if (!queueId) throw new Error("Firebase belum dikonfigurasi.")
      return queueId
    },
    onSuccess: () => {
      toast.success(
        "Push masuk antrean. Cek Log Notifikasi untuk status pengiriman.",
      )
      setPushBody("")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kirim Push Langsung</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Kirim notifikasi push ke satu karyawan yang sudah menginstal
          aplikasi (punya token FCM aktif). Pesan masuk inbox karyawan dan
          antrean push; Worker FCM mengirimkannya, biasanya kurang dari 1
          menit.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="push-target">Penerima (sudah menginstal)</Label>
          <Select
            value={targetUid}
            onValueChange={setTargetUid}
            disabled={installedQuery.isLoading}
          >
            <SelectTrigger id="push-target">
              <SelectValue
                placeholder={
                  installedQuery.isLoading
                    ? "Memuat..."
                    : installed.length === 0
                      ? "Belum ada karyawan yang menginstal"
                      : "Pilih karyawan"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {installed.map((u) => (
                <SelectItem key={u.uid} value={u.uid}>
                  {u.name} ({u.tokenCount} perangkat)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="push-title">Judul</Label>
          <Input
            id="push-title"
            value={pushTitle}
            onChange={(e) => setPushTitle(e.target.value)}
            placeholder="cth. Pengumuman"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="push-body">Pesan</Label>
          <Textarea
            id="push-body"
            value={pushBody}
            onChange={(e) => setPushBody(e.target.value)}
            placeholder="Tulis pesan push..."
          />
        </div>
        <div>
          <Button
            type="button"
            onClick={() => send.mutate()}
            disabled={send.isPending || !targetUid}
          >
            {send.isPending ? "Mengirim..." : "Kirim Push"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function NotificationSettingsPage() {
  const { companies, companyId, isOwner, selectCompany } = useCompanyScope()
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<NotificationSettings | null>(null)

  const settingsQuery = useNotificationSettings(companyId)
  // Sinkronisasi form dari data query (pola "adjusting state during
  // render" React): reset form saat data perusahaan berubah/dimuat ulang.
  const [prevSettingsData, setPrevSettingsData] = useState(
    settingsQuery.data,
  )
  if (settingsQuery.data !== prevSettingsData) {
    setPrevSettingsData(settingsQuery.data)
    setSettings(settingsQuery.data ?? null)
  }

  const save = useMutation({
    mutationFn: () => {
      if (!settings) throw new Error("Pengaturan belum dimuat.")
      return saveNotificationSettings(companyId, settings, actor)
    },
    onSuccess: () => {
      toast.success("Pengaturan notifikasi berhasil disimpan.")
      void queryClient.invalidateQueries({
        queryKey: ["ks", "notification-settings", companyId],
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Pengaturan Notifikasi"
          description="Konfigurasi push notification dan pengingat presensi."
        />
        <FirebaseNotConfigured title="Pengaturan notifikasi belum dapat dimuat." />
      </div>
    )

  const patch = (p: Partial<NotificationSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...p } : prev))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Pengaturan Notifikasi"
        description="Konfigurasi push notification dan pengingat presensi untuk karyawan."
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

      {!settings || settingsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Menyimpan..." : "Simpan Pengaturan"}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pengaturan Global</CardTitle>
            </CardHeader>
            <CardContent>
              <ToggleRow
                label="Push Notification"
                hint="Kirim notifikasi push ke perangkat karyawan"
                checked={settings.push_enabled ?? true}
                onChange={(c) => patch({ push_enabled: c })}
              />
              <ToggleRow
                label="Notifikasi In-App"
                hint="Tampilkan notifikasi di dalam aplikasi"
                checked={settings.in_app_enabled ?? true}
                onChange={(c) => patch({ in_app_enabled: c })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pengingat Presensi Otomatis</CardTitle>
            </CardHeader>
            <CardContent>
              <ToggleRow
                label="Aktifkan pengingat presensi"
                hint="Master switch seluruh pengingat masuk dan pulang"
                checked={settings.attendance_reminder_enabled ?? true}
                onChange={(c) => patch({ attendance_reminder_enabled: c })}
              />
              <div className="grid gap-1 sm:grid-cols-2">
                <ToggleRow
                  label="Sebelum masuk"
                  checked={settings.reminder_check_in_pre_enabled ?? true}
                  onChange={(c) =>
                    patch({ reminder_check_in_pre_enabled: c })
                  }
                >
                  <MinutesInput
                    label="H-"
                    value={settings.reminder_check_in_pre_minutes}
                    disabled={!settings.reminder_check_in_pre_enabled}
                    min={0}
                    max={120}
                    onChange={(v) =>
                      patch({ reminder_check_in_pre_minutes: v })
                    }
                  />
                </ToggleRow>
                <ToggleRow
                  label="Sebelum pulang"
                  checked={settings.reminder_check_out_pre_enabled ?? true}
                  onChange={(c) =>
                    patch({ reminder_check_out_pre_enabled: c })
                  }
                >
                  <MinutesInput
                    label="H-"
                    value={settings.reminder_check_out_pre_minutes}
                    disabled={!settings.reminder_check_out_pre_enabled}
                    min={0}
                    max={120}
                    onChange={(v) =>
                      patch({ reminder_check_out_pre_minutes: v })
                    }
                  />
                </ToggleRow>
                <ToggleRow
                  label="Saat jam masuk"
                  checked={settings.reminder_check_in_now_enabled ?? true}
                  onChange={(c) =>
                    patch({ reminder_check_in_now_enabled: c })
                  }
                >
                  <MinutesInput
                    label="Jendela"
                    value={settings.reminder_check_in_now_window_minutes}
                    disabled={!settings.reminder_check_in_now_enabled}
                    min={0}
                    max={30}
                    onChange={(v) =>
                      patch({ reminder_check_in_now_window_minutes: v })
                    }
                  />
                </ToggleRow>
                <ToggleRow
                  label="Saat jam pulang"
                  checked={settings.reminder_check_out_now_enabled ?? true}
                  onChange={(c) =>
                    patch({ reminder_check_out_now_enabled: c })
                  }
                >
                  <MinutesInput
                    label="Jendela"
                    value={settings.reminder_check_out_now_window_minutes}
                    disabled={!settings.reminder_check_out_now_enabled}
                    min={0}
                    max={30}
                    onChange={(v) =>
                      patch({ reminder_check_out_now_window_minutes: v })
                    }
                  />
                </ToggleRow>
                <ToggleRow
                  label="Terlambat masuk"
                  checked={settings.reminder_check_in_late_enabled ?? false}
                  onChange={(c) =>
                    patch({ reminder_check_in_late_enabled: c })
                  }
                >
                  <MinutesInput
                    label="Setelah"
                    value={settings.reminder_check_in_late_minutes}
                    disabled={!settings.reminder_check_in_late_enabled}
                    min={1}
                    max={180}
                    onChange={(v) =>
                      patch({ reminder_check_in_late_minutes: v })
                    }
                  />
                </ToggleRow>
                <ToggleRow
                  label="Terlambat pulang"
                  checked={settings.reminder_check_out_late_enabled ?? false}
                  onChange={(c) =>
                    patch({ reminder_check_out_late_enabled: c })
                  }
                >
                  <MinutesInput
                    label="Setelah"
                    value={settings.reminder_check_out_late_minutes}
                    disabled={!settings.reminder_check_out_late_enabled}
                    min={1}
                    max={240}
                    onChange={(v) =>
                      patch({ reminder_check_out_late_minutes: v })
                    }
                  />
                </ToggleRow>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kategori Notifikasi</CardTitle>
            </CardHeader>
            <CardContent>
              <ToggleRow
                label="Pengumuman"
                checked={settings.announcement_push_enabled ?? true}
                onChange={(c) => patch({ announcement_push_enabled: c })}
              />
              <ToggleRow
                label="Persetujuan (sakit/cuti/izin)"
                checked={settings.approval_push_enabled ?? true}
                onChange={(c) => patch({ approval_push_enabled: c })}
              />
              <ToggleRow
                label="Perubahan jadwal"
                checked={settings.schedule_change_push_enabled ?? true}
                onChange={(c) => patch({ schedule_change_push_enabled: c })}
              />
              <ToggleRow
                label="Pemberitahuan libur"
                checked={settings.holiday_notice_push_enabled ?? true}
                onChange={(c) => patch({ holiday_notice_push_enabled: c })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pengaturan Lanjutan Scheduler</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sched-interval">Interval (menit)</Label>
                <Input
                  id="sched-interval"
                  type="number"
                  min={1}
                  max={120}
                  value={settings.reminder_scheduler_interval_minutes ?? 15}
                  onChange={(e) =>
                    patch({
                      reminder_scheduler_interval_minutes: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sched-catchup">Catch-up (menit)</Label>
                <Input
                  id="sched-catchup"
                  type="number"
                  min={5}
                  max={30}
                  value={settings.reminder_scheduler_catchup_minutes ?? 6}
                  onChange={(e) =>
                    patch({
                      reminder_scheduler_catchup_minutes: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sched-active-at">Jam Aktif Scheduler</Label>
                <Input
                  id="sched-active-at"
                  type="time"
                  value={settings.reminder_scheduler_active_at ?? ""}
                  onChange={(e) =>
                    patch({ reminder_scheduler_active_at: e.target.value })
                  }
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-3">
                <Checkbox
                  checked={settings.reminder_scheduler_skip_holidays ?? true}
                  onCheckedChange={(c) =>
                    patch({ reminder_scheduler_skip_holidays: c === true })
                  }
                />
                Lewati hari libur
              </label>
            </CardContent>
          </Card>
        </form>
        <DirectPushCard companyId={companyId} actor={actor} />
        </>
      )}
    </div>
  )
}
