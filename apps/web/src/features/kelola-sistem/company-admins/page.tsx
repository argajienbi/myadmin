/**
 * Halaman Admin PT — mengikuti mockup company-admins.html: tabel
 * Perusahaan / Nama Admin / Aksi (Ganti Admin, Cabut) + form "Tunjuk
 * Admin PT" (Perusahaan, Pilih User, Simpan). Logika mengikuti
 * CompanyAdmins.tsx myadmin lama.
 *
 * Deviasi dari kode lama: tombol "Hapus Akun Admin" (hapus permanen akun)
 * tidak dibawa — mockup hanya menyediakan Ganti dan Cabut.
 */
import { useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
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
import { ConfirmAction } from "@/components/confirm-action"
import { TableState } from "@/components/list-controls"
import { PageHeader } from "@/components/page"
import { useCurrentActor } from "@/lib/use-company"
import { isFirebaseConfigured } from "@/lib/firebase"
import { FirebaseNotConfigured } from "../shared"
import type { Company } from "@/lib/firebase-types"
import {
  assignCompanyAdmin,
  potentialAdmins,
  revokeCompanyAdmin,
  useCompanyAdmins,
} from "./api"

export function CompanyAdminsPage() {
  const actor = useCurrentActor()
  const queryClient = useQueryClient()
  const [assignOpen, setAssignOpen] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState("")
  const [selectedAdminUid, setSelectedAdminUid] = useState("")

  const adminsQuery = useCompanyAdmins()
  const data = adminsQuery.data
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["ks", "company-admins"] })

  const assign = useMutation({
    mutationFn: () =>
      assignCompanyAdmin(selectedCompanyId, selectedAdminUid, actor),
    onSuccess: () => {
      toast.success("Berhasil menetapkan Admin PT.")
      setAssignOpen(false)
      setSelectedCompanyId("")
      setSelectedAdminUid("")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal menetapkan admin: ${e.message}`),
  })
  const revoke = useMutation({
    mutationFn: (args: { companyId: string; adminUid: string }) =>
      revokeCompanyAdmin(args.companyId, args.adminUid, actor),
    onSuccess: () => {
      toast.success("Akses admin berhasil dicabut.")
      void invalidate()
    },
    onError: (e: Error) => toast.error(`Gagal mencabut admin: ${e.message}`),
  })

  const selectedCompany: Company | undefined = data?.companies.find(
    (c) => c.id === selectedCompanyId,
  )
  const candidates = selectedCompany
    ? potentialAdmins(data?.users ?? [], selectedCompany.id ?? "")
    : []

  if (!isFirebaseConfigured())
    return (
      <div className="space-y-6">
        <PageHeader
          title="Admin PT"
          description="Tunjuk dan cabut admin perusahaan."
        />
        <FirebaseNotConfigured title="Data admin PT belum dapat dimuat." />
      </div>
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin PT"
        description="Tunjuk dan cabut admin perusahaan."
        actions={
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button>Tunjuk Admin PT</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Tunjuk Admin PT</DialogTitle>
              </DialogHeader>
              <form
                className="grid gap-4"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  assign.mutate()
                }}
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="assign-company">Perusahaan</Label>
                  <Select
                    value={selectedCompanyId || undefined}
                    onValueChange={(v) => {
                      setSelectedCompanyId(v)
                      setSelectedAdminUid("")
                    }}
                  >
                    <SelectTrigger id="assign-company">
                      <SelectValue placeholder="Pilih perusahaan" />
                    </SelectTrigger>
                    <SelectContent>
                      {data?.companies.map((c) => (
                        <SelectItem key={c.id} value={c.id ?? ""}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="assign-user">Pilih User</Label>
                  <Select
                    value={selectedAdminUid || undefined}
                    onValueChange={setSelectedAdminUid}
                    disabled={!selectedCompany}
                  >
                    <SelectTrigger id="assign-user">
                      <SelectValue placeholder="Pilih user" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((u) => (
                        <SelectItem key={u.uid} value={u.uid}>
                          {u.nama_lengkap ?? u.email ?? u.uid}
                          {u.email ? ` (${u.email})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={
                      assign.isPending || !selectedCompanyId || !selectedAdminUid
                    }
                  >
                    {assign.isPending ? "Menyimpan..." : "Simpan"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Daftar Admin PT</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Perusahaan</TableHead>
                <TableHead>Nama Admin</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={3}
                loading={adminsQuery.isLoading}
                empty={(data?.companies.length ?? 0) === 0}
                error={adminsQuery.error as Error | null}
                emptyText="Belum ada perusahaan."
              />
              {data?.companies.map((c) => {
                const admin = c.admin_uid
                  ? data.users.find((u) => u.uid === c.admin_uid)
                  : undefined
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {admin ? (
                        <>
                          {admin.nama_lengkap ?? admin.email ?? admin.uid}
                          <Badge variant="outline" className="ml-2">
                            Admin PT
                          </Badge>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          Belum ada admin
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedCompanyId(c.id ?? "")
                            setSelectedAdminUid(c.admin_uid ?? "")
                            setAssignOpen(true)
                          }}
                        >
                          {c.admin_uid ? "Ganti Admin" : "Set Admin"}
                        </Button>
                        {c.admin_uid && (
                          <ConfirmAction
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                              >
                                Cabut
                              </Button>
                            }
                            title="Cabut Akses Admin?"
                            description={`Cabut akses admin dari ${c.name}? Peran user kembali menjadi user biasa.`}
                            confirmLabel="Cabut"
                            onConfirm={() =>
                              revoke.mutate({
                                companyId: c.id ?? "",
                                adminUid: c.admin_uid ?? "",
                              })
                            }
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
