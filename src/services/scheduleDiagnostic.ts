import { get, ref } from "firebase/database";
import { db } from "../firebase";
import { paths } from "./paths";

export interface DiagnosticResult {
    ok: boolean;
    canAttend: boolean;
    status: string;
    reason: string;
    employee?: any;
    groupName?: string;
    officeName?: string;
    dayKey?: string;
    details?: {
        assignment?: any;
        shift?: any;
        timetable?: any;
        source?: string;
    };
}

const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const dayKeyOf = (dateStr: string) => {
  const date = new Date(dateStr);
  return dayNames[date.getDay()];
};

const inDateRange = (dateStr: string, start: string, end: string) => {
  if (!start || !end) return false;
  return dateStr >= start && dateStr <= end;
};

const dateMatches = (item: any, dateStr: string) => {
  if (item.dates && typeof item.dates === "object") {
    return item.dates[dateStr] === true || item.dates[dateStr] === "true";
  }

  // fallback struktur lama
  if (item.date) return item.date === dateStr;
  if (item.date_start && item.date_end) return dateStr >= item.date_start && dateStr <= item.date_end;

  return false;
};

const targetMatches = (targetUids: any, uid: string) => {
  if (!targetUids) return false;
  if (Array.isArray(targetUids)) return targetUids.includes(uid);
  return targetUids[uid] === true || targetUids[uid] === "true";
};

const isActiveValue = (value: unknown, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "active" || text === "yes";
};

export async function diagnoseEmployeeSchedule(companyId: string, uid: string, dateStr: string): Promise<DiagnosticResult> {
    try {
        const userRef = ref(db, paths.companyUser(companyId, uid));
        const userSnap = await get(userRef);

        if (!userSnap.exists()) {
            return {
                ok: false,
                canAttend: false,
                status: "Tidak Ditemukan",
                reason: "Data karyawan tidak ditemukan dalam organisasi."
            };
        }

        const employee = userSnap.val();

        if (!employee.office_id) {
            return {
                ok: false,
                canAttend: false,
                status: "Belum Lengkap",
                reason: "Karyawan belum memiliki penempatan kantor yang mengaktifkan lokasi / radius absen.",
                employee
            };
        }

        if (!employee.group_id) {
            return {
                ok: false,
                canAttend: false,
                status: "Belum Lengkap",
                reason: "Karyawan belum dimasukkan ke Grup Karyawan.",
                employee
            };
        }

        let groupName = "Grup belum ditemukan";
        try {
            const groupSnap = await get(ref(db, paths.employeeGroup(companyId, employee.group_id)));
            if (groupSnap.exists()) groupName = groupSnap.val().name;
        } catch(e) {}

        let officeName = "Kantor belum ditemukan";
        try {
            const offSnap = await get(ref(db, paths.office(companyId, employee.office_id)));
            if (offSnap.exists()) officeName = offSnap.val().name;
        } catch(e) {}

        const dayKey = dayKeyOf(dateStr);

        const overtimeSnap = await get(ref(db, paths.overtimeSchedules(companyId)));
        let applicableOvertime: any = null;

        if (overtimeSnap.exists()) {
            const overtimeRows = Object.keys(overtimeSnap.val())
                .map(k => ({ ...overtimeSnap.val()[k], id: k }))
                .filter((item: any) => item.active !== false && item.status !== "inactive");

            applicableOvertime = overtimeRows.find((item: any) => {
                return dateMatches(item, dateStr) && targetMatches(item.target_uids, uid);
            });
        }

        if (applicableOvertime) {
            const holidaySnap = await get(ref(db, paths.holiday(companyId, dateStr)));
            const isHoliday = holidaySnap.exists() && holidaySnap.val().active !== false;

            return {
                ok: true,
                canAttend: true,
                status: "Jadwal Lembur Aktif",
                reason: isHoliday
                    ? "User memiliki Jadwal Lembur aktif pada hari libur. Libur nasional tidak memblokir presensi untuk user ini."
                    : "User memiliki Jadwal Lembur aktif pada tanggal ini.",
                employee,
                groupName,
                officeName,
                dayKey,
                details: {
                    source: "Jadwal Lembur",
                    assignment: applicableOvertime,
                    timetable: {
                        name: applicableOvertime.name,
                        work_start: applicableOvertime.work_start,
                        work_end: applicableOvertime.work_end,
                        check_in_start: applicableOvertime.check_in_start,
                        check_in_end: applicableOvertime.check_in_end,
                        check_out_start: applicableOvertime.check_out_start,
                        check_out_end: applicableOvertime.check_out_end,
                    }
                }
            };
        }

        // Check holiday
        const holidaySnap = await get(ref(db, paths.holiday(companyId, dateStr)));
        if (holidaySnap.exists() && holidaySnap.val().active !== false) {
             return {
                 ok: true,
                 canAttend: false,
                 status: "Hari Libur",
                 reason: `Tanggal ini adalah hari libur: ${holidaySnap.val().title || "Hari Libur"}. Karyawan tidak perlu melakukan presensi.`,
                 employee,
                 groupName,
                 officeName,
                 details: { source: "Hari Libur" }
             };
        }

        // Check special schedule for this specific user or their group on this date
        const specialsSnap = await get(ref(db, paths.scheduleSpecials(companyId)));
        let applicableSpecial: any = null;
        if (specialsSnap.exists()) {
            const specials = specialsSnap.val();
            // Prioritize user-specific special over group-specific special
            const specialsArr = Object.keys(specials).map(k => ({...specials[k], id: k})).filter(s => s.active !== false && s.date === dateStr);
            
            applicableSpecial = specialsArr.find(s => s.type === "user" && s.target_id === uid) 
                                || specialsArr.find(s => s.type === "group" && s.target_id === employee.group_id);
        }

        let shiftId = "";
        let source = "";
        let assignmentDetails = null;

        if (applicableSpecial) {
             shiftId = applicableSpecial.shift_id;
             source = "Jadwal Khusus " + applicableSpecial.title;
             assignmentDetails = applicableSpecial;
        } else {
             // Normal assignment
             const assignmentsSnap = await get(ref(db, paths.scheduleAssignments(companyId)));
             let assignmentsArr: any[] = [];
             if (assignmentsSnap.exists()) {
                 const data = assignmentsSnap.val();
                 assignmentsArr = Object.keys(data).map(k => ({...data[k], id: k})).filter(a => a.active !== false);
             }

             // match assignment
             const dateObj = new Date(dateStr);
             const matchedAssignment = assignmentsArr.find(assign => {
                const targetMatches = (assign.type === 'user' && assign.target_id === uid) || (assign.type === 'group' && assign.target_id === employee.group_id);
                if (!targetMatches) return false;
                
                const start = new Date(assign.start_date);
                const end = assign.end_date ? new Date(assign.end_date) : new Date("2100-01-01"); // far future
                
                return dateObj >= start && dateObj <= end;
             });

             if (!matchedAssignment) {
                 return {
                     ok: false,
                     canAttend: false,
                     status: "Tanpa Jadwal",
                     reason: "Belum ada penerapan jadwal kerja yang berlaku untuk karyawan atau grup ini pada tanggal yang dipilih.",
                     employee,
                     groupName,
                     officeName
                 };
             }

             shiftId = matchedAssignment.shift_id;
             source = "Penerapan Jadwal Rutin";
             assignmentDetails = matchedAssignment;
        }

        if (!shiftId) {
             return {
                 ok: false,
                 canAttend: false,
                 status: "Shift Tidak Ditemukan",
                 reason: "Penerapan jadwal belum memilih pola shift.",
                 employee,
                 groupName,
                 officeName,
                 details: { source }
             };
        }

        const shiftSnap = await get(ref(db, paths.shift(companyId, shiftId)));
        if (!shiftSnap.exists() || shiftSnap.val().active === false) {
             return {
                 ok: false,
                 canAttend: false,
                 status: "Pola Shift Tidak Aktif",
                 reason: "Pola Shift yang diterapkan sudah dihapus atau dinonaktifkan.",
                 employee,
                 groupName,
                 officeName,
                 details: { source, assignment: assignmentDetails }
             };
        }

        const shift = shiftSnap.val();
        
        const dayConfig = (shift.days || {})[dayKey];

        if (!isActiveValue(dayConfig?.active, false)) {
            return {
                 ok: true,
                 canAttend: false,
                 status: "Hari Libur Rutin",
                 reason: "Sesuai pola shift, tanggal ini bukan hari kerja aktif. Karyawan tidak perlu melakukan presensi.",
                 employee,
                 groupName,
                 officeName,
                 dayKey,
                 details: { source, assignment: assignmentDetails, shift }
             };
        }

        const timetableId = String(dayConfig.timetable_id || "").trim();
        if (!timetableId) {
             return {
                 ok: false,
                 canAttend: false,
                 status: "Jam Kerja Belum Dipilih",
                 reason: "Jam kerja untuk tanggal ini belum dipilih pada pola shift.",
                 employee,
                 groupName,
                 officeName,
                 dayKey,
                 details: { source, assignment: assignmentDetails, shift }
             };
        }

        const ttSnap = await get(ref(db, paths.timetable(companyId, timetableId)));
        if (!ttSnap.exists() || ttSnap.val().active === false) {
             return {
                 ok: false,
                 canAttend: false,
                 status: "Jam Kerja Tidak Valid",
                 reason: "Data Jam Kerja yang dipilih pada pola shift ini sudah dihapus atau dinonaktifkan.",
                 employee,
                 groupName,
                 officeName,
                 dayKey,
                 details: { source, assignment: assignmentDetails, shift }
             };
        }

        const timetable = ttSnap.val();

        return {
             ok: true,
             canAttend: true,
             status: "Jadwal Siap",
             reason: "Karyawan sudah bisa menggunakan fitur presensi untuk jadwal ini.",
             employee,
             groupName,
             officeName,
             dayKey,
             details: { source, assignment: assignmentDetails, shift, timetable }
        };

    } catch (e: any) {
        return {
            ok: false,
            canAttend: false,
            status: "Error Sistem",
            reason: e.message || "Gagal melakukan pengecekan jadwal."
        };
    }
}
