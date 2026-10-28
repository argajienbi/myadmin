/**
 * Komponen bersama halaman Kelola + Sistem: state Firebase belum
 * dikonfigurasi, pemilih perusahaan, tab sederhana (tidak ada komponen
 * Tabs di packages/ui), dan state kosong.
 */
import { AlertTriangleIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import type { Company } from "@/lib/firebase-types"

export function FirebaseNotConfigured({ title }: { title: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-6">
        <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Firebase belum dikonfigurasi — isi variabel{" "}
            <code className="font-mono text-xs">VITE_FIREBASE_*</code> di{" "}
            <code className="font-mono text-xs">apps/web/.env</code> agar data
            perusahaan dapat dimuat.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function CompanySelect({
  companies,
  value,
  onChange,
  label = "Perusahaan",
}: {
  companies: Company[]
  value: string
  onChange: (id: string) => void
  label?: string
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="w-64" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {companies.map((c) => (
          <SelectItem key={c.id} value={c.id ?? ""}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Tab sederhana (tombol) mengikuti struktur tab di mockup. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
    >
      {tabs.map((t) => (
        <Button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          variant={active === t.id ? "default" : "ghost"}
          size="sm"
          onClick={() => onChange(t.id)}
          className={cn(active !== t.id && "text-muted-foreground")}
        >
          {t.label}
        </Button>
      ))}
    </div>
  )
}

export function EmptyState({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>
}
