import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { QueryClientProvider } from "@tanstack/react-query"

import "@workspace/ui/globals.css"
import "leaflet/dist/leaflet.css"
import { router } from "./router.tsx"
import { queryClient } from "@/lib/query-client"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { ThemeProvider } from "@/components/theme-provider.tsx"

// PWA: service worker didaftarkan otomatis oleh vite-plugin-pwa
// (injectRegister "auto", bawaan plugin). Impor eksplisit
// `virtual:pwa-register` TIDAK dipakai: di Vite 8/Rolldown + pnpm,
// impor `workbox-window` dari modul virtual itu gagal di-resolve
// (modul virtual tidak punya path file; workbox-window hanya ada di
// node_modules privat plugin), sehingga `vite build` gagal.

function AppRouter() {
  const auth = useAuth()
  return <RouterProvider router={router} context={{ auth }} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <AppRouter />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
)
