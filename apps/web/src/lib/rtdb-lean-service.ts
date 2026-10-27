// Port of myadmin lama: src/services/rtdbLeanService.ts (repo argajienbi/myadmin, main HEAD 31e4b9b). Disalin verbatim (hanya import diubah).
import { get, limitToLast, orderByChild, query, ref } from "firebase/database";
import { db } from "./firebase";
import { paths } from "./firebase-paths";

export const RTDB_LEAN_LIMITS = {
  defaultRangeDays: 7,
  maxRangeDays: 31,
  recentLimit: 10,
};

export type AttendanceRow = Record<string, unknown>;

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Tanggal lokal (komponen kalender perangkat, bukan UTC) — port
// localDateString dari Organization.tsx myadmin lama. Dipakai untuk
// tanggal tampilan/filter (bukan untuk key rentang RTDB — itu toDateKey).
export function localDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

export function buildDateRange(startDate: string, endDate: string): string[] {
  const total = daysBetween(startDate, endDate);
  if (total <= 0) return [];

  const start = new Date(`${startDate}T00:00:00`);
  const result: string[] = [];

  for (let i = 0; i < total; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    result.push(toDateKey(d));
  }

  return result;
}

export function assertSafeDateRange(startDate: string, endDate: string) {
  if (!startDate || !endDate) {
    throw new Error("Tanggal awal dan tanggal akhir wajib diisi.");
  }

  const total = daysBetween(startDate, endDate);

  if (total <= 0) {
    throw new Error("Range tanggal tidak valid.");
  }

  if (total > RTDB_LEAN_LIMITS.maxRangeDays) {
    throw new Error(`Range terlalu besar. Maksimal ${RTDB_LEAN_LIMITS.maxRangeDays} hari sekali ambil data.`);
  }
}

function flattenAttendanceByDateNode(companyId: string, date: string, data: unknown): AttendanceRow[] {
  if (!data || typeof data !== "object") return [];

  const rows: AttendanceRow[] = [];
  const node = data as Record<string, unknown>;

  for (const uid of Object.keys(node)) {
    const userNode = node[uid];

    if (!userNode || typeof userNode !== "object") continue;

    const userRec = userNode as Record<string, unknown>;
    for (const actionType of Object.keys(userRec)) {
      const rec = userRec[actionType];

      if (!rec || typeof rec !== "object") continue;

      const recObj = rec as Record<string, unknown>;
      rows.push({
        ...recObj,
        company_id: companyId,
        record_uid: recObj.uid || uid,
        uid: recObj.uid || uid,
        record_date: recObj.date || recObj.tanggal || date,
        dateKey: recObj.date || recObj.tanggal || date,
        record_action: recObj.action_type || actionType,
        action_type: recObj.action_type || actionType,
        id: recObj.record_id || `${companyId}_${uid}_${date}_${actionType}`,
      });
    }
  }

  return rows;
}

export async function loadAttendanceByDateRange(params: {
  companyId: string;
  startDate: string;
  endDate: string;
}) {
  const { companyId, startDate, endDate } = params;

  assertSafeDateRange(startDate, endDate);

  const dates = buildDateRange(startDate, endDate);
  const snapshots = await Promise.all(
    dates.map((date) => get(ref(db, paths.attendanceByDate(companyId, date))))
  );

  const rows: AttendanceRow[] = [];

  snapshots.forEach((snap, index) => {
    if (!snap.exists()) return;
    rows.push(...flattenAttendanceByDateNode(companyId, dates[index], snap.val()));
  });

  rows.sort((a, b) => {
    const aTime = new Date(`${a.record_date || a.dateKey || ""}T${a.record_time || a.waktu || a.time || "00:00:00"}`).getTime();
    const bTime = new Date(`${b.record_date || b.dateKey || ""}T${b.record_time || b.waktu || b.time || "00:00:00"}`).getTime();
    return bTime - aTime;
  });

  return rows;
}

export async function loadRecentAttendance(companyId: string, limit = RTDB_LEAN_LIMITS.recentLimit) {
  const recentQuery = query(
    ref(db, paths.attendanceRecent(companyId)),
    orderByChild("created_at"),
    limitToLast(limit)
  );

  const snap = await get(recentQuery);

  if (!snap.exists()) return [];

  const rows = Object.keys(snap.val()).map((id) => ({
    id,
    ...snap.val()[id],
  }));

  rows.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));

  return rows;
}

export async function loadDashboardSummary(companyId: string, date: string) {
  const snap = await get(ref(db, paths.dashboardSummary(companyId, date)));
  return snap.exists() ? snap.val() : null;
}
