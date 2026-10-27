// Komponen kecil bersama halaman Utama — komposisi dari primitives
// packages/ui (TIDAK mengedit primitives). Gaya mengikuti mockup:
// tab tombol, avatar inisial, kartu stat, field berlabel, empty state.
import type { ReactNode } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import { initials } from "./format"

const AVATAR_COLORS = [
  "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
]

export function AvatarInitials({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % 997
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length]
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        color,
        className
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

export function EmptyState({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  )
}

export interface TabItem {
  id: string
  label: string
  count?: number
}

export function UtamaTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div
      className="flex flex-wrap gap-1 border-b"
      role="tablist"
      aria-label="Tab halaman"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
          {typeof tab.count === "number" && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// Badge status mengikuti warna mockup (success/warning/danger/info/
// primary/neutral) — di atas primitive Badge template via className.
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: "success" | "warning" | "danger" | "info" | "primary" | "neutral"
  children: ReactNode
  className?: string
}) {
  const tones: Record<string, string> = {
    success:
      "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    warning:
      "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    danger:
      "border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    info: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    primary:
      "border-transparent bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
    neutral: "border-transparent bg-muted text-muted-foreground",
  }
  return (
    <Badge variant="outline" className={cn(tones[tone], className)}>
      {children}
    </Badge>
  )
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  onClick,
}: {
  title: string
  value: number | string
  subtitle: string
  icon: ReactNode
  onClick?: () => void
}) {
  const inner = (
    <CardContent className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {title}
        </span>
        {icon}
      </div>
      <span className="text-2xl font-bold tracking-tight">{value}</span>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </CardContent>
  )
  if (!onClick) {
    return <Card>{inner}</Card>
  }
  return (
    <Card
      className="cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
      onClick={onClick}
    >
      {inner}
    </Card>
  )
}
