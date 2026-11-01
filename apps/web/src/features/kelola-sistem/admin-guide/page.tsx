/**
 * Halaman Buku Petunjuk — isi disalin verbatim dari guideSections
 * AdminGuide.tsx myadmin lama (lihat guide-data.ts), hanya ditata ulang
 * mengikuti mockup admin-guide.html: nav kiri sticky + langkah bernomor
 * + pencarian. Filter peran: seksi/langkah/catatan dengan visibleFor
 * owner hanya tampil untuk owner.
 */
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  CheckCircle,
  ClipboardCheck,
  Database,
  HelpCircle,
  Home,
  ListChecks,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { PageHeader } from "@/components/page"
import { useIsOwner } from "@/lib/use-company"
import { cn } from "@workspace/ui/lib/utils"
import { guideSections, type GuideSection } from "./guide-data"

const ICONS: Record<string, LucideIcon> = {
  HomeIcon: Home,
  Building2,
  Users,
  Calendar,
  ClipboardCheck,
  ListChecks,
  CheckCircle,
  Shield,
  Bell,
  AlertTriangle,
  Database,
  HelpCircle,
}

type Role = "owner" | "admin"

function visibleForRole(
  visibleFor: ("owner" | "admin")[] | undefined,
  role: Role,
): boolean {
  if (!visibleFor) return true
  return visibleFor.includes(role)
}

export function AdminGuidePage() {
  const isOwner = useIsOwner()
  const role: Role = isOwner ? "owner" : "admin"
  const [search, setSearch] = useState("")
  const [activeId, setActiveId] = useState(guideSections[0]?.id ?? "")

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase()
    return guideSections
      .filter((s) => visibleForRole(s.visibleFor, role))
      .filter((s) => {
        if (!q) return true
        const haystack = [
          s.title,
          s.menu,
          s.summary,
          ...s.steps.map((st) => `${st.title} ${st.description}`),
        ]
          .join(" ")
          .toLowerCase()
        return haystack.includes(q)
      })
  }, [search, role])

  const active: GuideSection | undefined =
    sections.find((s) => s.id === activeId) ?? sections[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buku Petunjuk Admin"
        description="Panduan langkah demi langkah mengelola presensi, jadwal, dan persetujuan."
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Input
            placeholder="Cari panduan..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Cari panduan"
          />
          <nav className="mt-3 grid gap-1" aria-label="Daftar panduan">
            {sections.map((s) => {
              const Icon = ICONS[s.icon] ?? HelpCircle
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  aria-current={active?.id === s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                    active?.id === s.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "block truncate text-xs",
                        active?.id === s.id
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground",
                      )}
                    >
                      {s.menu}
                    </span>
                  </span>
                </button>
              )
            })}
            {sections.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Tidak ada panduan yang cocok.
              </p>
            )}
          </nav>
        </div>

        <div className="space-y-6">
          {active ? (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div>
                  <h2 className="text-xl font-semibold">{active.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {active.menu} — {active.summary}
                  </p>
                </div>
                <ol className="grid gap-4">
                  {active.steps
                    .filter((st) => visibleForRole(st.visibleFor, role))
                    .map((step, i) => (
                      <li key={`${step.title}-${i}`} className="flex gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-medium">{step.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {step.description}
                          </p>
                        </div>
                      </li>
                    ))}
                </ol>
                {active.notes && active.notes.length > 0 && (
                  <div className="space-y-2 rounded-lg bg-muted p-4">
                    <p className="text-sm font-medium">Catatan</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {active.notes
                        .filter((note) =>
                          typeof note === "string"
                            ? true
                            : visibleForRole(note.visibleFor, role),
                        )
                        .map((note, i) => (
                          <li key={i}>
                            {typeof note === "string" ? note : note.text}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Pilih panduan di sebelah kiri.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
