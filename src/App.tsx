import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { GenericPage } from './pages/GenericPage';
import { Companies } from './pages/Companies';
import { CompanyAdmins } from './pages/CompanyAdmins';
import { Organization } from './pages/Organization';
import { Employees } from './pages/Employees';
import { Approvals } from './pages/Approvals';
import { Schedules } from './pages/Schedules';
import { Attendance } from './pages/Attendance';
import { Reports } from './pages/Reports';
import { Audit } from './pages/Audit';
import { AttendanceCorrections } from './pages/AttendanceCorrections';
import { Settings } from './pages/Settings';
import { SetupWizard } from './pages/SetupWizard';
import { Announcements } from './pages/Announcements';
import { NotificationSettings } from './pages/NotificationSettings';
import { NotificationLogs } from './pages/NotificationLogs';
import { DatabaseHealth } from './pages/DatabaseHealth';
import { AdminGuide } from './pages/AdminGuide';
import { useTheme } from './hooks/useTheme';

import { isConfigAvailable } from './firebase';

const AppContent = () => {
  useTheme(); // Initialize theme on mount
  if (!isConfigAvailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">Konfigurasi Firebase Belum Ada</h1>
          <p className="text-slate-600 dark:text-slate-400 mb-6 text-sm">
            Silakan masukkan environment variables `VITE_FIREBASE_*` (API Key, Database URL, dll) ke dalam aplikasi.
          </p>
        </div>
      </div>
    );
  }
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="setup" element={<SetupWizard />} />
          <Route path="buku-petunjuk" element={<AdminGuide />} />
          <Route path="companies" element={<ProtectedRoute allowedRoles={['owner', 'system_owner', 'admin']}><Companies /></ProtectedRoute>} />
          <Route path="company-admins" element={<ProtectedRoute allowedRoles={['owner']}><CompanyAdmins /></ProtectedRoute>} />
          <Route path="organization" element={<Organization />} />
          <Route path="employees" element={<Employees />} />
          <Route path="schedules" element={<Schedules />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="attendance/corrections" element={<AttendanceCorrections />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="notification-settings" element={<ProtectedRoute allowedRoles={['owner']}><NotificationSettings /></ProtectedRoute>} />
          <Route path="notification-logs" element={<ProtectedRoute allowedRoles={['owner']}><NotificationLogs /></ProtectedRoute>} />
          <Route path="reports" element={<Reports />} />
          <Route path="audit" element={<ProtectedRoute allowedRoles={['owner']}><Audit /></ProtectedRoute>} />
          <Route path="database-health" element={<ProtectedRoute allowedRoles={['owner']}><DatabaseHealth /></ProtectedRoute>} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
