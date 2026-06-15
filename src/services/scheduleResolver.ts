import { get, ref } from "firebase/database";
import { db } from "../firebase";
import { paths } from "./paths";

type ResolverInput = {
  companyId: string;
  uid: string;
  date: string;
};

type ResolverOutput = {
  scheduleReady: boolean;
  todayActive: boolean;
  schedule_source:
    | "holiday"
    | "special_schedule"
    | "user_assignment"
    | "group_assignment"
    | "overtime_schedule"
    | "none";
  attendance_status?: string;
  assignment_id?: string;
  assignment_start_date?: string;
  assignment_end_date?: string;
  shift_id?: string;
  shift_name?: string;
  timetable_id?: string;
  timetable_name?: string;
  work_start?: string;
  work_end?: string;
  check_in_start?: string;
  check_in_end?: string;
  check_out_start?: string;
  check_out_end?: string;
  late_tolerance_minute?: number;
  early_out_tolerance_minute?: number;
  crosses_midnight?: boolean;
  overtime_flag?: boolean;
  overtime_schedule_id?: string;
  is_holiday_work?: boolean;
};

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function dateInRange(date: string, startDate: string, endDate?: string) {
  if (!startDate) return false;
  if (date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function isActiveValue(value: unknown, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "active" || text === "yes";
}

export async function resolveScheduleForUser({
  companyId,
  uid,
  date,
}: ResolverInput): Promise<ResolverOutput> {
  // 1. Load employee dari company_users/{companyId}/{uid}
  const employeeSnap = await get(ref(db, paths.companyUser(companyId, uid)));
  const employee = employeeSnap.exists() ? employeeSnap.val() : null;

  if (!employee) {
    return {
      scheduleReady: false,
      todayActive: false,
      schedule_source: "none",
    };
  }

  // 2. Cek holiday pada tanggal itu
  const holidaySnap = await get(ref(db, paths.holiday(companyId, date)));
  const isHoliday = holidaySnap.exists() && holidaySnap.val()?.active === true;

  // 3. Cek overtime_schedules/{companyId}
  const overtimeSnap = await get(ref(db, paths.overtimeSchedules(companyId)));
  let selectedOvertime: any = null;

  if (overtimeSnap.exists()) {
    const overtimes = overtimeSnap.val();
    for (const id of Object.keys(overtimes)) {
      const item = overtimes[id];
      if (!item.active) continue;

      const isSameDate = item.date === date;
      const isInRange = dateInRange(date, item.date_start || item.start_date, item.date_end || item.end_date);
      if (!isSameDate && !isInRange) continue;

      const matchUser = item.type === "user" && (item.target_id === uid || item.user_id === uid || item.uid === uid);
      const matchGroup = item.type === "group" && (item.target_id === employee.group_id || item.group_id === employee.group_id);

      if (matchUser || matchGroup) {
        selectedOvertime = { ...item, id };
        break;
      }
    }
  }

  // 4. Cek schedule_specials/{companyId}
  const specialsSnap = await get(ref(db, paths.scheduleSpecials(companyId)));
  let selectedSpecial: any = null;

  if (specialsSnap.exists()) {
    const specials = specialsSnap.val();
    for (const id of Object.keys(specials)) {
      const item = specials[id];
      if (!item.active || item.date !== date) continue;

      const matchUser = item.type === "user" && (item.target_id === uid || item.user_id === uid || item.uid === uid);
      const matchGroup = item.type === "group" && (item.target_id === employee.group_id || item.group_id === employee.group_id);

      if (matchUser || matchGroup) {
        selectedSpecial = { ...item, id };
        break;
      }
    }
  }

  // 5. Jika holiday dan tidak ada overtime/special holiday work, return libur
  if (isHoliday && !selectedOvertime && !selectedSpecial) {
    return {
      scheduleReady: true,
      todayActive: false,
      schedule_source: "holiday",
      attendance_status: "libur",
      is_holiday_work: false,
    };
  }

  // If we have selectedOvertime, build output from it first
  if (selectedOvertime) {
    let baseOutput: ResolverOutput;
    if (selectedOvertime.shift_id) {
      baseOutput = await buildFromShift({
        companyId,
        date,
        shiftId: selectedOvertime.shift_id,
        source: "overtime_schedule",
        assignmentId: selectedOvertime.id,
      });
    } else {
      baseOutput = {
        scheduleReady: true,
        todayActive: true,
        schedule_source: "overtime_schedule",
        assignment_id: selectedOvertime.id,
        work_start: selectedOvertime.work_start || selectedOvertime.time_start || "",
        work_end: selectedOvertime.work_end || selectedOvertime.time_end || "",
        check_in_start: selectedOvertime.check_in_start || "",
        check_in_end: selectedOvertime.check_in_end || "",
        check_out_start: selectedOvertime.check_out_start || "",
        check_out_end: selectedOvertime.check_out_end || "",
        late_tolerance_minute: Number(selectedOvertime.late_tolerance_minute || 0),
        early_out_tolerance_minute: Number(selectedOvertime.early_out_tolerance_minute || 0),
      };
    }

    if (baseOutput.crosses_midnight === undefined && baseOutput.work_start && baseOutput.work_end) {
      baseOutput.crosses_midnight = baseOutput.work_end < baseOutput.work_start;
    }

    return {
      ...baseOutput,
      assignment_start_date: selectedOvertime.date_start || selectedOvertime.start_date || selectedOvertime.date || "",
      assignment_end_date: selectedOvertime.date_end || selectedOvertime.end_date || selectedOvertime.date || "",
      attendance_status: selectedOvertime.attendance_status || selectedOvertime.status || "lembur",
      overtime_flag: true,
      overtime_schedule_id: selectedOvertime.id,
      is_holiday_work: isHoliday,
    };
  }

  // If we have selectedSpecial
  if (selectedSpecial) {
    const baseOutput = await buildFromShift({
      companyId,
      date,
      shiftId: selectedSpecial.shift_id,
      source: "special_schedule",
      assignmentId: selectedSpecial.id,
    });
    return {
      ...baseOutput,
      assignment_start_date: selectedSpecial.date || "",
      assignment_end_date: selectedSpecial.date || "",
      is_holiday_work: isHoliday,
    };
  }

  // 6. Cek user assignment aktif
  // 7. Cek group assignment aktif
  const assignmentsSnap = await get(ref(db, paths.scheduleAssignments(companyId)));

  let userAssignment: any = null;
  let groupAssignment: any = null;

  if (assignmentsSnap.exists()) {
    const assignments = assignmentsSnap.val();

    for (const id of Object.keys(assignments)) {
      const item = assignments[id];
      if (!item.active) continue;
      if (!dateInRange(date, item.start_date, item.end_date)) continue;

      if (item.type === "user" && item.target_id === uid) {
        userAssignment = { ...item, id };
      }

      if (item.type === "group" && item.target_id === employee.group_id) {
        groupAssignment = { ...item, id };
      }
    }
  }

  if (userAssignment) {
    const baseOutput = await buildFromShift({
      companyId,
      date,
      shiftId: userAssignment.shift_id,
      source: "user_assignment",
      assignmentId: userAssignment.id,
    });
    return {
      ...baseOutput,
      assignment_start_date: userAssignment.start_date || "",
      assignment_end_date: userAssignment.end_date || "",
      is_holiday_work: isHoliday,
    };
  }

  if (groupAssignment) {
    const baseOutput = await buildFromShift({
      companyId,
      date,
      shiftId: groupAssignment.shift_id,
      source: "group_assignment",
      assignmentId: groupAssignment.id,
    });
    return {
      ...baseOutput,
      assignment_start_date: groupAssignment.start_date || "",
      assignment_end_date: groupAssignment.end_date || "",
      is_holiday_work: isHoliday,
    };
  }

  return {
    scheduleReady: false,
    todayActive: false,
    schedule_source: "none",
  };
}

async function buildFromShift({
  companyId,
  date,
  shiftId,
  source,
  assignmentId,
}: {
  companyId: string;
  date: string;
  shiftId: string;
  source:
    | "special_schedule"
    | "user_assignment"
    | "group_assignment"
    | "overtime_schedule";
  assignmentId: string;
}): Promise<ResolverOutput> {
  const shiftSnap = await get(ref(db, paths.shift(companyId, shiftId)));
  if (!shiftSnap.exists()) {
    return {
      scheduleReady: false,
      todayActive: false,
      schedule_source: "none",
    };
  }

  const shift = shiftSnap.val();
  const dateObj = new Date(`${date}T00:00:00`);
  const dayKey = DAY_KEYS[dateObj.getDay()];
  const day = shift.days?.[dayKey];

  if (!isActiveValue(day?.active, false) || !day?.timetable_id) {
    return {
      scheduleReady: true,
      todayActive: false,
      schedule_source: source,
      assignment_id: assignmentId,
      shift_id: shiftId,
      shift_name: shift.name || "",
    };
  }

  const timetableSnap = await get(
    ref(db, paths.timetable(companyId, day.timetable_id))
  );

  if (!timetableSnap.exists()) {
    return {
      scheduleReady: false,
      todayActive: false,
      schedule_source: source,
      assignment_id: assignmentId,
      shift_id: shiftId,
      shift_name: shift.name || "",
    };
  }

  const timetable = timetableSnap.val();

  return {
    scheduleReady: true,
    todayActive: true,
    schedule_source: source,
    assignment_id: assignmentId,
    shift_id: shiftId,
    shift_name: shift.name || "",
    timetable_id: day.timetable_id,
    timetable_name: timetable.name || "",
    work_start: timetable.work_start || "",
    work_end: timetable.work_end || "",
    check_in_start: timetable.check_in_start || "",
    check_in_end: timetable.check_in_end || "",
    check_out_start: timetable.check_out_start || "",
    check_out_end: timetable.check_out_end || "",
    late_tolerance_minute: Number(timetable.late_tolerance_minute || 0),
    early_out_tolerance_minute: Number(timetable.early_out_tolerance_minute || 0),
    crosses_midnight: timetable.crosses_midnight !== undefined ? !!timetable.crosses_midnight : (timetable.work_end && timetable.work_start ? timetable.work_end < timetable.work_start : false),
  };
}
