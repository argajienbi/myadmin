import { BellIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Link } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth-context"
import {
  listRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/firebase-notifications"

export function NotificationBell() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const companyId = profile?.company_id ?? ""
  const uid = profile?.uid ?? ""
  const enabled = Boolean(companyId && uid)

  const notifications = useQuery({
    queryKey: ["firebase-notifications", companyId, uid],
    queryFn: () => listRecentNotifications(companyId, uid, 10),
    enabled,
    refetchInterval: 60_000,
  })
  const items = notifications.data ?? []
  const unread = items.filter((item) => !item.read).length
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["firebase-notifications", companyId, uid],
    })
  const read = useMutation({
    mutationFn: (id: string) => markNotificationRead(companyId, uid, id),
    onSuccess: invalidate,
  })
  const readAll = useMutation({
    mutationFn: () => markAllNotificationsRead(companyId, uid),
    onSuccess: invalidate,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifikasi">
          <span className="relative">
            <BellIcon />
            {unread > 0 && (
              <span className="text-destructive-foreground absolute -top-1 -right-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifikasi</DropdownMenuLabel>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => readAll.mutate()}
            >
              Tandai semua dibaca
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.isPending ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Memuat…</p>
        ) : items.length ? (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="items-start py-2"
              onSelect={(e) => {
                e.preventDefault()
                if (!item.read) read.mutate(item.id)
              }}
            >
              <span
                className={
                  item.read
                    ? "mt-1.5 size-2 rounded-full bg-transparent"
                    : "mt-1.5 size-2 rounded-full bg-primary"
                }
              />
              <span className="grid gap-1">
                <span className="font-medium">{item.title}</span>
                <span className="line-clamp-2 text-muted-foreground">
                  {item.body}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Tidak ada notifikasi.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/notification-logs" className="justify-center">
            Lihat semua
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
