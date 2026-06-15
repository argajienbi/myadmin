import { get, onValue, ref, Unsubscribe } from "firebase/database";
import { db } from "../firebase";

export type RtdbGateKey =
  | "dashboard_summary"
  | "attendance"
  | "reports"
  | "employees"
  | "companies"
  | "company_users"
  | "leave_requests"
  | "qr_requests"
  | "attendance_corrections"
  | "announcements"
  | "audit_logs"
  | "schedule_assignments"
  | "schedule_specials"
  | "overtime_schedules"
  | "holidays"
  | "schedule_change_logs"
  | "timetables"
  | "shifts"
  | "storage_index"
  | "report_cache"
  | "database_health";

export type RtdbGateState = {
  key: RtdbGateKey;
  path: string;
  openedAt: number;
  mode: "manual_get" | "manual_listener";
};

const openGates = new Map<string, RtdbGateState>();
const activeListeners = new Map<string, Unsubscribe>();

export function makeGateId(key: RtdbGateKey, path: string) {
  return `${key}::${path}`;
}

export function isGateOpen(key: RtdbGateKey, path: string) {
  return openGates.has(makeGateId(key, path));
}

export function getOpenGates() {
  return Array.from(openGates.values());
}

export function closeGate(key: RtdbGateKey, path: string) {
  const id = makeGateId(key, path);

  const unsubscribe = activeListeners.get(id);
  if (unsubscribe) {
    unsubscribe();
    activeListeners.delete(id);
  }

  openGates.delete(id);
}

export function closeAllGates() {
  activeListeners.forEach((unsubscribe) => unsubscribe());
  activeListeners.clear();
  openGates.clear();
}

export async function manualGet<T = any>(params: {
  key: RtdbGateKey;
  path: string;
}) {
  const { key, path } = params;
  const id = makeGateId(key, path);

  openGates.set(id, {
    key,
    path,
    openedAt: Date.now(),
    mode: "manual_get",
  });

  try {
    const snap = await get(ref(db, path));
    return snap.exists() ? (snap.val() as T) : null;
  } finally {
    openGates.delete(id);
  }
}

export function manualListen<T = any>(params: {
  key: RtdbGateKey;
  path: string;
  onData: (value: T | null) => void;
  onError?: (error: Error) => void;
}) {
  const { key, path, onData, onError } = params;
  const id = makeGateId(key, path);

  if (activeListeners.has(id)) {
    return () => closeGate(key, path);
  }

  openGates.set(id, {
    key,
    path,
    openedAt: Date.now(),
    mode: "manual_listener",
  });

  const unsubscribe = onValue(
    ref(db, path),
    (snap) => {
      onData(snap.exists() ? (snap.val() as T) : null);
    },
    (error) => {
      if (onError) onError(error);
    }
  );

  activeListeners.set(id, unsubscribe);

  return () => closeGate(key, path);
}
