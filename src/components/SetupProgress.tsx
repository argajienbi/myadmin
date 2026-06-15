import React, { useEffect, useState } from "react";
import { ref, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Link } from "react-router-dom";

export const SetupProgress: React.FC<{ companyId: string }> = ({ companyId }) => {
    const [stats, setStats] = useState({
        offices: 0,
        departments: 0,
        subDepartments: 0,
        groups: 0,
        timetables: 0,
        shifts: 0,
        assignments: 0,
        employees: 0,
        loading: true
    });

    useEffect(() => {
        if (!companyId) return;

        const fetchData = async () => {
            try {
                const getCount = async (path: string) => {
                    const snap = await get(ref(db, path));
                    return snap.exists() ? Object.keys(snap.val()).length : 0;
                };

                const [
                    officesCount,
                    deptsCount,
                    groupsCount,
                    timetablesCount,
                    shiftsCount,
                    assignmentsCount,
                    empCount
                ] = await Promise.all([
                    getCount(paths.offices(companyId)),
                    getCount(paths.departments(companyId)),
                    getCount(paths.employeeGroups(companyId)),
                    getCount(paths.timetables(companyId)),
                    getCount(paths.shifts(companyId)),
                    getCount(paths.scheduleAssignments(companyId)),
                    getCount(paths.companyUsers(companyId))
                ]);

                setStats({
                    offices: officesCount,
                    departments: deptsCount,
                    subDepartments: 0, // optional
                    groups: groupsCount,
                    timetables: timetablesCount,
                    shifts: shiftsCount,
                    assignments: Math.max(0, assignmentsCount - 1), // rudimentary assignment filtering could be done
                    employees: empCount,
                    loading: false
                });
            } catch (e) {
                console.error("Failed to fetch setup stats", e);
                setStats(s => ({ ...s, loading: false }));
            }
        };

        fetchData();
    }, [companyId]);

    if (stats.loading || !companyId) return null;

    const steps = [
        { name: "Perusahaan", count: 1, required: true, cta: "", link: "" },
        { name: "Kantor", count: stats.offices, required: true, cta: "Buat Kantor", link: "/companies" },
        { name: "Departemen", count: stats.departments, required: false, cta: "Buat Departemen", link: "/companies" },
        { name: "Grup Karyawan", count: stats.groups, required: true, cta: "Buat Grup", link: "/companies" },
        { name: "Jam Kerja", count: stats.timetables, required: true, cta: "Buat Jam Kerja", link: "/schedules" },
        { name: "Pola Shift", count: stats.shifts, required: true, cta: "Buat Shift", link: "/schedules" },
        { name: "Karyawan", count: stats.employees, required: true, cta: "Tambah Karyawan", link: "/employees" },
    ];

    const completedRequired = steps.filter(s => s.required && s.count > 0).length;
    const totalRequired = steps.filter(s => s.required).length;
    const isCompleted = completedRequired === totalRequired;

    if (isCompleted) {
        return null; // Don't show if all required setup is done
    }

    return (
        <div className="bg-blue-50 dark:bg-slate-900 border border-blue-200 dark:border-slate-800 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">Panduan Setup Jadwal & Organisasi</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Lengkapi pengaturan berikut agar karyawan Anda bisa mulai melakukan absensi.
            </p>
            
            <div className="flex flex-wrap gap-4">
                {steps.map(step => (
                    <div key={step.name} className="flex items-center gap-2 p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg min-w-[160px]">
                        {step.count > 0 ? (
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold text-xs border border-emerald-500/30">✓</div>
                        ) : (
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center font-bold text-xs border border-slate-200 dark:border-slate-700">!</div>
                        )}
                        <div>
                            <div className="font-medium text-slate-800 dark:text-slate-200 text-sm">{step.name}</div>
                            {step.count > 0 ? (
                                <div className="text-[10px] uppercase font-bold text-slate-500">{step.count} terdaftar</div>
                            ) : (
                                <Link to={step.link} className="text-[10px] uppercase font-bold text-blue-600 hover:underline">{step.cta}</Link>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
