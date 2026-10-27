/**
 * Halaman Kesehatan Database — mengikuti mockup database-health.html:
 * Perusahaan, Scan Database, Ringkasan Path (Data, Path, Children,
 * Estimasi Size, 17 checkbox), Node Terbesar, Danger Zone (Reset Data
 * Dummy, ketik "RESET DATABASE" untuk konfirmasi). Logika mengikuti
 * DatabaseHealth.tsx myadmin lama (owner saja; reset menulis audit
 * OWNER_DATABASE_RESET). Halaman ini hanya membaca status saat scan —
 * tidak ada data dummy yang ditulis.
 *
 * Deviasi dari kode lama: bagian foto/storage tidak dibawa (mockup tidak
 * memintanya; ukuran file lama adalah estimasi deterministik dari hash,
 * bukan ukuran nyata).
 */
import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangleIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { PageHeader } from "@/components/page"
import { useCompanyScope, useCurrentActor } from "@/lib/use-company"
import { CompanySelect, FirebaseNotConfigured } from "../shared"
import {
  EXTRA_RESET_KEYS,
  RESET_OPTIONS,
  formatBytes,
  isDbConfigured,
  makeHealthTargets,
  resetDummyData,
  scanDatabase,
  type HealthRow,
} from "./api"

export function DatabaseHealthPage() {
  const { companies, companyId, company, isOwner, selectCompany } =
    useCompanyScope()
  const actor = useCurrentActor()
  const [selectedScan, setSelectedScan] = useState<Record<string, boolean>>({})
  const [rows, setRows] = useState<HealthRow[]>([])
  const [deepNodeCount, setDeepNodeCount] = useState(0)
  const [hasScanned, setHasScanned] = useState(false)
  const [selectedReset, setSelectedReset] = useState<Record<string, boolean>>(
    () => ({
      ...RESET_OPTIONS.reduce<Record<string, boolean>>(
        (acc, item) => ({ ...acc, [item.key]: item.defaultChecked }),
        {},
      ),
      notifications: true,
      notification_queue: true,
    }),
  )
  const [confirmText, setConfirmText] = useState("")

  const targets = useMemo(() => makeHealthTargets(companyId), [companyId])
  const totalBytes = rows.reduce((sum, r) => sum + r.estimatedBytes, 0)
  const totalCount = rows.reduce((sum, r) => sum + r.count, 0)
  const biggestRows = useMemo(
    () => [...rows].sort((a, b) => b.estimatedBytes - a.estimatedBytes).slice(0, 5),
    [rows],
  )

  const scan = useMutation({
    mutationFn: () => {
      const selected = targets
        .filter((t) => selectedScan[t.label])
        .map((t) => t.label)
      return scanDatabase(companyId, selected)
    },
    onSuccess: (result) => {
      setRows(result.rows)
      setDeepNodeCount(result.deepNodeCount)
      setHasScanned(true)
      toast.success("Scan database selesai.")
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const reset = useMutation({
    mutationFn: () =>
      resetDummyData(companyId, company?.name ?? "", selectedReset, actor),
    onSuccess: (deletedPaths) => {
      toast.success(`Reset data dummy selesai (${deletedPaths.length} path dihapus).`)
      setConfirmText("")
      setRows([])
      setHasScanned(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleScan = (label: string) =>
    setSelectedScan((prev) => ({ ...prev, [label]: !prev[label] }))
  const toggleReset = (key: string) =>
    setSelectedReset((prev) => ({ ...prev, [key]: !prev[key] }))

  if (!isDbConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Kesehatan Database"
          description="Pindai ukuran data per perusahaan dan reset data dummy."
        />
        <FirebaseNotConfigured title="Data database belum dapat dipindai." />
      </div>
    )

  if (!isOwner)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Kesehatan Database"
          description="Pindai ukuran data per perusahaan dan reset data dummy."
        />
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              Hanya owner yang dapat membuka halaman ini.
            </p>
          </CardContent>
        </Card>
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kesehatan Database"
        description="Pindai ukuran data per perusahaan dan reset data dummy."
        actions={
          <CompanySelect
            companies={companies}
            value={companyId}
            onChange={selectCompany}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Path</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => scan.mutate()}
              disabled={scan.isPending || !companyId}
            >
              {scan.isPending ? "Memindai..." : "Scan Database"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setSelectedScan(
                  Object.fromEntries(targets.map((t) => [t.label, true])),
                )
              }
            >
              Pilih Semua
            </Button>
            <Button variant="outline" onClick={() => setSelectedScan({})}>
              Hapus Pilihan
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {targets.map((t) => (
              <label
                key={t.label}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={Boolean(selectedScan[t.label])}
                  onCheckedChange={() => toggleScan(t.label)}
                />
                {t.label}
              </label>
            ))}
          </div>
          {hasScanned && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  Total children: {totalCount}
                </Badge>
                <Badge variant="secondary">
                  Estimasi ukuran: {formatBytes(totalBytes)}
                </Badge>
                <Badge variant="secondary">
                  Deep node: {deepNodeCount}
                </Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead className="text-right">Children</TableHead>
                    <TableHead className="text-right">Estimasi Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.path}
                      </TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right">
                        {formatBytes(row.estimatedBytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div>
                <h3 className="mb-2 font-medium">Node Terbesar</h3>
                <div className="grid gap-2 sm:grid-cols-5">
                  {biggestRows.map((row) => (
                    <Card key={row.label}>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">
                          {row.label}
                        </p>
                        <p className="text-lg font-bold">
                          {formatBytes(row.estimatedBytes)}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangleIcon className="size-5" />
            Danger Zone — Reset Data Dummy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Menghapus permanen data yang dipilih di perusahaan{" "}
            <strong>{company?.name ?? "—"}</strong>. Data master (perusahaan,
            karyawan, organisasi) tidak termasuk dalam daftar ini dan tidak
            ikut terhapus. Tindakan ini dicatat di audit log.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {RESET_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={Boolean(selectedReset[opt.key])}
                  onCheckedChange={() => toggleReset(opt.key)}
                />
                {opt.label}
              </label>
            ))}
            {EXTRA_RESET_KEYS.map((opt) => (
              <label
                key={opt.key}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={Boolean(selectedReset[opt.key])}
                  onCheckedChange={() => toggleReset(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <div className="grid max-w-md gap-1.5">
            <Label htmlFor="reset-confirm">
              Ketik RESET DATABASE untuk konfirmasi
            </Label>
            <Input
              id="reset-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET DATABASE"
              autoComplete="off"
            />
          </div>
          <Button
            variant="destructive"
            disabled={reset.isPending || confirmText !== "RESET DATABASE"}
            onClick={() => reset.mutate()}
          >
            {reset.isPending ? "Mereset..." : "Reset Data Dummy"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
