import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
}) => {
  const { currentUser, userData, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950 font-sans">
        <div className="text-blue-500">Memuat data...</div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!userData) {
    // Missing /users/{uid}
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200">
        <div className="text-red-500 mb-4 text-xl font-bold">Akses Ditolak</div>
        <p className="mb-4 text-slate-600 dark:text-slate-400">Akun belum terdaftar dalam sistem indeks.</p>
        <button
          onClick={() => auth.signOut()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
        >
          Logout
        </button>
      </div>
    );
  }

  if (userData.status_akun !== "active") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200">
        <div className="text-orange-500 mb-4 text-xl font-bold">Akun Belum Aktif</div>
        <p className="mb-4 text-slate-600 dark:text-slate-400">Status akun Anda: {userData.status_akun}</p>
        <button
          onClick={() => auth.signOut()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
        >
          Logout
        </button>
      </div>
    );
  }

  if (userData.role === "user") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200">
        <div className="text-red-500 mb-4 text-xl font-bold">Akses Ditolak</div>
        <p className="mb-4 text-slate-600 dark:text-slate-400">Pengguna aplikasi mobile tidak dapat mengakses Web Admin.</p>
        <button
          onClick={() => auth.signOut()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
        >
          Logout
        </button>
      </div>
    );
  }

  if (userData.role === "admin" && !userData.company_id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200">
        <div className="text-red-500 mb-4 text-xl font-bold">Akses Ditolak</div>
        <p className="mb-4 text-slate-600 dark:text-slate-400">Admin belum memiliki company_id. Hubungi owner untuk assign admin ke company.</p>
        <button
          onClick={() => auth.signOut()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
        >
          Logout
        </button>
      </div>
    );
  }

  if (allowedRoles && !allowedRoles.includes(userData.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// we need to make sure auth is imported
import { auth } from "../firebase";
