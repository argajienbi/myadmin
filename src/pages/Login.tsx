import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth, db } from "../firebase";
import { paths } from "../services/paths";
import { ref, get } from "firebase/database";
import { UserIndex } from "../types";
import toast from "react-hot-toast";

export const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleResetPassword = async () => {
    if (!email) {
      toast.error("Masukkan email Anda terlebih dahulu.");
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success("Tautan reset password telah dikirim ke email Anda. Silakan periksa inbox atau spam.");
    } catch (err: any) {
      let errorMsg = "Gagal mengirim email reset password.";
      if (err.code === "auth/user-not-found") {
        errorMsg = "Email tidak ditemukan/belum terdaftar.";
      } else if (err.code === "auth/invalid-email") {
        errorMsg = "Format email tidak valid.";
      }
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    const loginProcess = async () => {
      try {
        let user;
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          user = userCredential.user;
        } catch (authErr: any) {
          const OWNER_EMAIL = "armin.gandi@gmail.com";
          if (email.toLowerCase() === OWNER_EMAIL && (authErr.code === "auth/user-not-found" || authErr.code === "auth/invalid-credential")) {
            try {
              const { createUserWithEmailAndPassword } = await import("firebase/auth");
              const userCredential = await createUserWithEmailAndPassword(auth, email, password);
              user = userCredential.user;
            } catch (createErr: any) {
              if (createErr.code === "auth/email-already-in-use") {
                throw authErr;
              } else {
                throw createErr;
              }
            }
          } else {
            throw authErr;
          }
        }

        // Check /users index
        const userRef = ref(db, paths.userIndex(user.uid));
        const snapshot = await get(userRef);

        const OWNER_UID = "tWtZoVGg3qgwU4Odtl1FPCGC6zZ2";
        const OWNER_EMAIL = "armin.gandi@gmail.com";
        const isOwner = user.uid === OWNER_UID || user.email?.toLowerCase() === OWNER_EMAIL;

        if (!snapshot.exists()) {
          if (isOwner) {
             const ownerData = {
               uid: user.uid,
               company_id: "",
               role: "owner",
               status_akun: "active",
               email: user.email || "",
               nama_lengkap: "System Owner",
               created_at: Date.now(),
               is_owner: true,
               is_system_owner: true,
               bootstrap_owner: true,
               updated_at: Date.now(),
             } as UserIndex & Record<string, any>;
             // bootstrap owner into rtdb
             const { set } = await import("firebase/database");
             await set(userRef, ownerData);
             return "Login berhasil! Akun Owner telah dibuat.";
          }
          await auth.signOut();
          throw new Error("Akun belum terdaftar di sistem.");
        }

        const userData = snapshot.val() as UserIndex & Record<string, any>;

        if (isOwner) {
           if (userData.role !== "owner" || userData.status_akun !== "active" || !userData.is_owner || !userData.is_system_owner) {
             userData.role = "owner";
             userData.status_akun = "active";
             userData.is_owner = true;
             userData.is_system_owner = true;
             userData.bootstrap_owner = true;
             userData.updated_at = Date.now();
             const { update } = await import("firebase/database");
             await update(userRef, {
               role: "owner",
               status_akun: "active",
               is_owner: true,
               is_system_owner: true,
               bootstrap_owner: true,
               updated_at: Date.now(),
             });
           }
        }

        if (userData.status_akun !== "active") {
          await auth.signOut();
          throw new Error(`Status akun Anda: ${userData.status_akun}`);
        }

        if (userData.role === "user") {
          await auth.signOut();
          throw new Error("Pengguna aplikasi mobile tidak dapat mengakses Web Admin.");
        }

        return "Login berhasil!";
      } catch (err: any) {
        let errorMsg = "Login gagal. Periksa kembali email dan password Anda.";
        if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
          errorMsg = "Email atau password yang Anda masukkan salah.";
        } else if (err.code === "auth/too-many-requests") {
          errorMsg = "Terlalu banyak percobaan gagal. Silakan coba lagi nanti.";
        } else if (err.code === "auth/user-disabled") {
          errorMsg = "Akun ini telah dinonaktifkan.";
        } else if (err.code === "auth/network-request-failed") {
          errorMsg = "Gagal terhubung ke server. Periksa koneksi internet Anda.";
        }

        if (err.message && err.message.includes("Permission denied")) {
          throw new Error("Akses ditolak: Aturan database (rules) belum dikonfigurasi dengan benar.");
        } else {
          throw new Error(err.message === "Akun belum terdaftar di sistem." || 
                          err.message.startsWith("Status akun Anda") ||
                          err.message === "Pengguna aplikasi mobile tidak dapat mengakses Web Admin." 
                          ? err.message : errorMsg);
        }
      }
    };

    toast.promise(loginProcess(), {
      loading: 'Memproses login...',
      success: (msg) => {
        navigate("/");
        return msg;
      },
      error: (err) => err.message
    }).finally(() => {
      setLoading(false);
    });
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 font-sans">
      {/* Left Info Panel */}
      <div className="md:w-1/2 lg:w-3/5 bg-blue-600 dark:bg-slate-900 p-8 md:p-12 lg:p-16 flex flex-col justify-between text-white border-r border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center font-bold text-blue-600 text-xl shadow-sm">M</div>
          <h1 className="text-2xl font-bold tracking-tight">MYPRESENCE</h1>
        </div>
        
        <div className="my-12 md:my-auto max-w-xl">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight mb-6">
            Sistem Manajemen Kehadiran Modern & Terintegrasi
          </h2>
          <p className="text-blue-100 dark:text-slate-400 text-lg mb-10 leading-relaxed font-light">
            Portal Web Admin ini adalah pusat kendali untuk mengelola data karyawan, memonitor kehadiran, mengatur jadwal kerja, serta menyetujui izin dan cuti secara real-time.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="bg-blue-700/30 dark:bg-slate-800/50 p-5 rounded-2xl border border-blue-500/30 dark:border-slate-700/50 backdrop-blur-sm">
              <div className="font-semibold text-lg mb-2">Manajemen Terpusat</div>
              <div className="text-sm text-blue-200 dark:text-slate-400 leading-relaxed">Kelola struktur organisasi, area, cabang, jadwal, and data karyawan dengan lebih efisien.</div>
            </div>
            <div className="bg-blue-700/30 dark:bg-slate-800/50 p-5 rounded-2xl border border-blue-500/30 dark:border-slate-700/50 backdrop-blur-sm">
              <div className="font-semibold text-lg mb-2">Monitoring & Laporan</div>
              <div className="text-sm text-blue-200 dark:text-slate-400 leading-relaxed">Pantau kehadiran secara langsung, rekap absen otomatis, dan ekspor laporan lengkap.</div>
            </div>
          </div>
        </div>
        
        <div className="text-sm text-blue-300 dark:text-slate-500">
          &copy; {new Date().getFullYear()} MyPresence. All rights reserved.
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="md:w-1/2 lg:w-2/5 flex items-center justify-center p-8 md:p-12 relative bg-slate-50 dark:bg-slate-950">
        <div className="w-full max-w-md">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 md:p-10 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Admin Login</h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Masuk dengan kredensial admin Anda.</p>
            </div>

            <form className="space-y-5" onSubmit={handleLogin}>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="admin@perusahaan.com"
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-shadow"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-shadow"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={loading}
                  className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                >
                  Lupa Password?
                </button>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-3.5 px-4 rounded-xl text-white font-semibold bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-slate-900 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {loading ? "Memproses..." : "Masuk Aplikasi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
