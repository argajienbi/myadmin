import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { ref, get } from 'firebase/database';
import { paths } from '../services/paths';
import { CheckCircle2, Circle } from 'lucide-react';
import { isOwnerLike } from "../utils/roleAccess";

export const SetupWizard: React.FC = () => {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const isOwner = isOwnerLike(userData);
  const [companies, setCompanies] = useState<any[]>([]);
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [stats, setStats] = useState({
    hasCompany: false,
    hasOffice: false,
    hasArea: false,
    hasDept: false,
    hasGroup: false,
    hasTimetable: false,
    hasShift: false,
    hasAssignment: false,
    hasEmployee: false,
  });
  const [loading, setLoading] = useState(true);

  const activeCompany = companies.find((company: any) => company.id === targetCompanyId);
  const activeCompanyName = activeCompany?.name || targetCompanyId || "Tidak ada perusahaan";

  useEffect(() => {
    if (!userData) return;

    const loadCompanies = async () => {
      if (isOwner) {
        const comps = await get(ref(db, paths.companies()));
        const list = comps.exists()
          ? Object.keys(comps.val()).map(id => ({ id, ...comps.val()[id] }))
          : [];

        setCompanies(list);

        const savedCompany = localStorage.getItem("admin_selected_company") || "";
        const savedIsValid = savedCompany && list.some((company: any) => company.id === savedCompany);
        const userCompanyIsValid = userData.company_id && list.some((company: any) => company.id === userData.company_id);

        const initialCompany = savedIsValid
          ? savedCompany
          : userCompanyIsValid
            ? userData.company_id
            : list[0]?.id || "";

        setTargetCompanyId(initialCompany);

        if (initialCompany) {
          localStorage.setItem("admin_selected_company", initialCompany);
        }

        return;
      }

      setCompanies([]);
      setTargetCompanyId(userData.company_id || "");
    };

    loadCompanies();
  }, [userData, isOwner]);


  useEffect(() => {
    if (!userData) return;
    if (!isOwner && !userData.company_id) return;
    if (isOwner && !targetCompanyId) {
       setLoading(false);
       return;
    }
    
    const checkStats = async () => {
      setLoading(true);
      try {
        const hasComp = isOwner ? !!targetCompanyId : !!userData.company_id;

        if (targetCompanyId) {
          const [offices, areas, depts, groups, timetables, shifts, assignments, employees] = await Promise.all([
            get(ref(db, paths.offices(targetCompanyId))),
            get(ref(db, paths.areas(targetCompanyId))),
            get(ref(db, paths.departments(targetCompanyId))),
            get(ref(db, paths.employeeGroups(targetCompanyId))),
            get(ref(db, paths.timetables(targetCompanyId))),
            get(ref(db, paths.shifts(targetCompanyId))),
            get(ref(db, paths.scheduleAssignments(targetCompanyId))),
            get(ref(db, paths.companyUsers(targetCompanyId))),
          ]);

          const getActiveCount = (snap: any) => snap.exists() ? Object.values(snap.val()).filter((x: any) => x.active !== false).length : 0;
          
          setStats({
            hasCompany: hasComp,
            hasOffice: getActiveCount(offices) > 0,
            hasArea: getActiveCount(areas) > 0,
            hasDept: getActiveCount(depts) > 0,
            hasGroup: getActiveCount(groups) > 0,
            hasTimetable: getActiveCount(timetables) > 0,
            hasShift: getActiveCount(shifts) > 0,
            hasAssignment: getActiveCount(assignments) > 0,
            hasEmployee: getActiveCount(employees) > 0,
          });
        }
      } catch (err) {
        console.error("Failed to load setup stats", err);
      }
      setLoading(false);
    };

    checkStats();
  }, [userData, isOwner, targetCompanyId]);

  const steps = [
    stats.hasCompany,
    stats.hasOffice,
    stats.hasArea,
    stats.hasDept,
    stats.hasGroup,
    stats.hasTimetable,
    stats.hasShift,
    stats.hasAssignment,
    stats.hasEmployee
  ];

  const completedCount = steps.filter(Boolean).length;
  const progress = Math.round((completedCount / steps.length) * 100);

  const StepIcon = ({ done }: { done: boolean }) => done ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6 text-slate-300 dark:text-slate-700" />;

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">Setup Awal</h1>
        <p className="text-sm text-slate-500">Panduan implementasi sistem presensi</p>
      </div>

      {isOwner ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg">
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
            Pilih Perusahaan
          </label>
          <select
            value={targetCompanyId}
            onChange={(e) => {
              setTargetCompanyId(e.target.value);
              localStorage.setItem("admin_selected_company", e.target.value);
            }}
            className="w-full md:w-80 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded p-2 text-sm"
          >
            <option value="" disabled>-- Pilih Perusahaan --</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name || company.id}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Mode Admin Perusahaan</div>
          <div className="text-slate-700 dark:text-slate-300">
            Perusahaan aktif:{" "}
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {activeCompanyName}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Anda hanya melihat progress setup untuk perusahaan yang terhubung dengan akun admin ini.
          </div>
        </div>
      )}

      {!isOwner && !userData?.company_id && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 p-4 rounded-lg text-sm">
          Akun admin ini belum terhubung ke perusahaan. Hubungi owner untuk assign admin ke perusahaan.
        </div>
      )}

      {!targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          {isOwner
            ? "Pilih perusahaan terlebih dahulu untuk melihat progress setup."
            : "Akun admin ini belum memiliki perusahaan aktif."}
        </div>
      ) : (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
        <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">Progress Setup</h2>
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{progress}%</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3">
                <div className="bg-blue-600 h-3 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
            </div>
            {progress === 100 ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-3 font-medium">Setup utama sudah selesai. Anda bisa mulai memantau presensi karyawan.</p>
            ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">Selesaikan langkah berikut agar karyawan bisa mulai menggunakan presensi.</p>
            )}
        </div>
        
        <div className="space-y-4">
          
          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasCompany ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasCompany} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">
                {isOwner ? "Kelola Data Perusahaan" : "Lengkapi Profil Perusahaan"}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {isOwner
                  ? "Buat perusahaan, atur admin PT, lalu pilih perusahaan aktif sebelum mengisi setup operasional."
                  : "Periksa nama perusahaan, branding/logo, website, dan kode undangan untuk perusahaan Anda."}
              </p>
              <button onClick={() => navigate("/companies")} className="mt-3 text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">
                {isOwner ? "Kelola Perusahaan →" : "Kelola Profil Perusahaan →"}
              </button>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasOffice ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasOffice} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Kantor / Lokasi Kerja</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Tambahkan lokasi kerja dan radius absensi agar karyawan bisa presensi sesuai lokasi.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasOffice ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/organization')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Kantor →</button>
              </div>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasArea ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasArea} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Area Wilayah</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Kelompokkan lokasi kerja berdasarkan area atau wilayah geografis.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasArea ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/organization')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Area →</button>
              </div>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasDept ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasDept} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Departemen</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Buat departemen untuk struktur laporan dan organisasi perusahaan.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasDept ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/organization')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Departemen →</button>
              </div>
            </div>
          </div>



          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasGroup ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasGroup} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Grup Karyawan</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Kelompokkan karyawan untuk mempermudah pembagian penerapan jadwal secara massal.</p>
               <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasGroup ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/organization')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Grup →</button>
              </div>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasTimetable ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasTimetable} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Jam Kerja</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Tentukan jam masuk, jam pulang, dan toleransi keterlambatan.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasTimetable ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/schedules')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Jam Kerja →</button>
              </div>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasShift ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasShift} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Pola Shift</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Rangkai susunan Jam Kerja dalam pola harian atau mingguan.</p>
               <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasShift ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/schedules')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Pola Shift →</button>
              </div>
            </div>
          </div>
          
           <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasAssignment ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasAssignment} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Terapkan Jadwal</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Terapkan Pola Shift yang sudah dibuat ke Grup atau Karyawan tertentu.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasAssignment ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/schedules')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Terapkan Jadwal →</button>
              </div>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${stats.hasEmployee ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasEmployee} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Karyawan</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Daftarkan akun karyawan, tetapkan ke Kantor dan Grup agar bisa menggunakan aplikasi presensi.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {stats.hasEmployee ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/employees')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Kelola Karyawan →</button>
              </div>
            </div>
          </div>

          <div className={`flex items-start gap-4 p-4 rounded-lg border ${(stats.hasAssignment && stats.hasEmployee) ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800/30' : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
            <div className="pt-1"><StepIcon done={stats.hasAssignment && stats.hasEmployee} /></div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Cek Jadwal Karyawan</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Pastikan karyawan sudah memiliki jadwal aktif dan siap menggunakan presensi.</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded">Status: {(stats.hasAssignment && stats.hasEmployee) ? 'Selesai' : 'Belum Lengkap'}</span>
                <button onClick={() => navigate('/schedules')} className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">Cek Jadwal →</button>
              </div>
            </div>
          </div>

        </div>
      </div>
      )}
    </div>
  );
};

