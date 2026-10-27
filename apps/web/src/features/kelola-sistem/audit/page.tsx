/**
 * Halaman Audit Log — mengikuti mockup audit.html: Ekspor CSV, filter
 * (Perusahaan, Cari user/aksi, Dari/Sampai, "Tampilkan ID teknis"),
 * tabel Waktu/User/Action/Details. Logika mengikuti Audit.tsx myadmin
 * lama (owner memilih perusahaan; nama user dari company_users; UID
 * di-mask kecuali ID teknis ditampilkan).
 */
import { useMemo, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
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
import { Pagination, TableState } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useCompanyScope } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { localDateString } from "@/lib/rtdb-lean-service"
import { CompanySelect, FirebaseNotConfigured } from "../shared"
import { maskId } from "@/lib/display-utils"
import { exportAuditCsv, resolveAuditUserName, useAuditLogs } from "./api"

const PAGE_SIZE = 20

export function AuditPage() {
  const { companies, companyId, isOwner, selectCompany } = useCompanyScope()
  const [search, setSearch] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [showTechnicalIds, setShowTechnicalIds] = useState(false)
  const [page, setPage] = useState(1)

  const auditQuery = useAuditLogs(companyId)
  const data = auditQuery.data

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return data.logs.filter((log) => {
      if (q) {
        const userName = resolveAuditUserName(log, data.users).toLowerCase()
        const haystack = `${userName} ${log.action} ${log.details ?? ""} ${log.user_uid ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (startDate) {
        const logDate = localDateString(new Date(log.created_at ?? 0))
        if (logDate < startDate) return false
      }
      if (endDate) {
        const logDate = localDateString(new Date(log.created_at ?? 0))
        if (logDate > endDate) return false
      }
      return true
    })
  }, [data, search, startDate, endDate])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Audit Log"
          description="Riwayat aktivitas admin dan sistem per perusahaan."
        />
        <FirebaseNotConfigured title="Data audit log belum dapat dimuat." />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Riwayat aktivitas admin dan sistem per perusahaan."
        actions={
          <Button
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() =>
              exportAuditCsv(filtered, `audit-log-${companyId}.csv`)
            }
          >
            Ekspor CSV
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <CompanySelect
                companies={companies}
                value={companyId}
                onChange={selectCompany}
              />
            )}
            <Input
              className="w-64"
              placeholder="Cari user atau aksi..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            <div className="flex items-center gap-1.5">
              <Label htmlFor="audit-from">Dari</Label>
              <Input
                id="audit-from"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="audit-to">Sampai</Label>
              <Input
                id="audit-to"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setPage(1)
                }}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={showTechnicalIds}
                onCheckedChange={(c) => setShowTechnicalIds(c === true)}
              />
              Tampilkan ID teknis
            </label>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={4}
                loading={auditQuery.isLoading}
                empty={pageRows.length === 0}
                error={auditQuery.error as Error | null}
                emptyText="Belum ada log audit yang cocok dengan filter."
              />
              {data &&
                pageRows.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {log.created_at
                        ? new Date(log.created_at).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {resolveAuditUserName(log, data.users)}
                      {showTechnicalIds && log.user_uid && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {log.user_uid}
                        </span>
                      )}
                      {!showTechnicalIds && log.user_uid && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {maskId(log.user_uid)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.action}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.details ?? "—"}
                      {showTechnicalIds && log.target_path && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {log.target_path}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            onPageChange={setPage}
            pageSize={PAGE_SIZE}
          />
        </CardContent>
      </Card>
    </div>
  )
}
