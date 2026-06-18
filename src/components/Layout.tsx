import React, { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LogOut, Home, Building2, Users, Calendar, CheckSquare, BarChart2, Menu, X, Sun, Moon, List, Database, BookOpen } from "lucide-react";
import clsx from "clsx";
import { useTheme } from "../hooks/useTheme";
import { ConfirmModal } from "./ConfirmModal";

export const Layout: React.FC = () => {
  const { userData, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isDestructive: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    isDestructive: false,
    onConfirm: () => {}
  });

  const requestLogout = () => {
    setConfirmModal({
      isOpen: true,
      title: "Konfirmasi Logout",
      message: "Anda yakin ingin keluar?",
      isDestructive: true,
      onConfirm: handleLogout
    });
  };

  // Close sidebar on path change
  React.useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isOwner = userData?.role === "owner";

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-sans">
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        isDestructive={confirmModal.isDestructive}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
      />
      
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={clsx(
        "fixed md:static inset-y-0 left-0 z-50 w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 flex items-center h-16 border-b border-slate-200 dark:border-slate-800 justify-between md:justify-center">
          <div className="font-bold text-lg text-slate-900 dark:text-white">
            MYPRESENCE
          </div>
          <button 
            className="md:hidden text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-0">
            <NavLink
              to="/"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <Home className="mr-3 h-5 w-5" />
              Dashboard
            </NavLink>

            <NavLink
              to="/setup"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <List className="mr-3 h-5 w-5" />
              Setup Awal
            </NavLink>
            <NavLink
              to="/buku-petunjuk"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <BookOpen className="mr-3 h-5 w-5" />
              Buku Petunjuk
            </NavLink>

            {isOwner && (
              <>
                <NavLink
                  to="/companies"
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center px-6 py-3 text-sm",
                      isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                    )
                  }
                >
                  <Building2 className="mr-3 h-5 w-5" />
                  Perusahaan
                </NavLink>
                <NavLink
                  to="/company-admins"
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center px-6 py-3 text-sm",
                      isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                    )
                  }
                >
                  <Users className="mr-3 h-5 w-5" />
                  Admin PT
                </NavLink>
              </>
            )}

            <NavLink
              to="/organization"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <Building2 className="mr-3 h-5 w-5" />
              Organisasi
            </NavLink>

            <NavLink
              to="/employees"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <Users className="mr-3 h-5 w-5" />
              Karyawan
            </NavLink>

            <NavLink
              to="/schedules"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <Calendar className="mr-3 h-5 w-5" />
              Jadwal Kerja
            </NavLink>

            <NavLink
              to="/attendance"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <CheckSquare className="mr-3 h-5 w-5" />
              Absensi
            </NavLink>

            <NavLink
              to="/attendance/corrections"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <CheckSquare className="mr-3 h-5 w-5" />
              Koreksi Absensi
            </NavLink>

            <NavLink
              to="/approvals"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <CheckSquare className="mr-3 h-5 w-5" />
              Persetujuan
            </NavLink>

            <NavLink
              to="/announcements"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <List className="mr-3 h-5 w-5" />
              Pengumuman
            </NavLink>

            {isOwner && (
              <>
                <NavLink
                  to="/notification-settings"
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center px-6 py-3 text-sm",
                      isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                    )
                  }
                >
                  <List className="mr-3 h-5 w-5 opacity-0" />
                  Pengaturan Notifikasi
                </NavLink>

                <NavLink
                  to="/notification-logs"
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center px-6 py-3 text-sm",
                      isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                    )
                  }
                >
                  <List className="mr-3 h-5 w-5 opacity-0" />
                  Log Notifikasi
                </NavLink>
              </>
            )}

            <NavLink
              to="/reports"
              className={({ isActive }) =>
                clsx(
                  "flex items-center px-6 py-3 text-sm",
                  isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                )
              }
            >
              <BarChart2 className="mr-3 h-5 w-5" />
              Laporan
            </NavLink>

            {isOwner && (
              <>
                <NavLink
                  to="/audit"
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center px-6 py-3 text-sm",
                      isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                    )
                  }
                >
                  <CheckSquare className="mr-3 h-5 w-5" />
                  Audit Log
                </NavLink>
                <NavLink
                  to="/database-health"
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center px-6 py-3 text-sm",
                      isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                    )
                  }
                >
                  <Database className="mr-3 h-5 w-5" />
                  Kesehatan Database
                </NavLink>
              </>
            )}
            
            {isOwner && (
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center px-6 py-3 text-sm",
                    isActive ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800/50"
                  )
                }
              >
                <CheckSquare className="mr-3 h-5 w-5 opacity-0" />
                Settings
              </NavLink>
            )}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Topbar */}
        <header className="h-16 bg-white dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-4">
            <button 
              className="md:hidden text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </button>
            <span className="text-xl font-medium text-slate-800 dark:text-slate-200 hidden sm:block">
              {isOwner ? "Owner Mode" : "Admin Mode"}
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={toggleTheme}
              className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-500 rounded hover:bg-slate-100 dark:bg-slate-800/50"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              onClick={requestLogout}
              className="p-2 flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 dark:bg-slate-800/50 hidden md:flex"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
              <span className="text-sm font-medium">Keluar</span>
            </button>
            
            <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-800">
               <div className="text-right hidden lg:block">
                 <div className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-tight">
                   {userData?.nama_lengkap || "User"}
                 </div>
                 <div className="text-xs text-slate-500 font-mono mt-0.5">
                   {userData?.role?.toUpperCase()}
                 </div>
               </div>
               
               <div className="relative group">
                 <div className="h-9 w-9 rounded-full bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/50 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold cursor-pointer">
                    {(userData?.nama_lengkap || "U").charAt(0).toUpperCase()}
                 </div>
                 
                 <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 lg:hidden">
                       <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{userData?.nama_lengkap}</p>
                       <p className="text-xs text-slate-500 truncate">{userData?.email}</p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => navigate("/settings")}
                        className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Pengaturan Profil
                      </button>
                      <button
                        onClick={requestLogout}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                      >
                        <LogOut className="h-4 w-4" /> Keluar
                      </button>
                    </div>
                 </div>
               </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
