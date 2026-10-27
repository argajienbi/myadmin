/**
 * Data Karyawan — port logika Employees.tsx myadmin lama ke TanStack Query
 * + satu-shot `get()` (bukan listener `onValue`). Mutasi menulis ke dua
 * node (`users/{uid}` + `company_users/{company}/{uid}`) seperti lama,
 * lalu mirror ke Firestore + audit.
 */
import { useQuery } from "@tanstack/react-query"
import { createUserWithEmailAndPassword, getAuth, signOut } from "firebase/auth"
import { initializeApp } from "firebase/app"
import { push, ref, set, update } from "firebase/database"
import { writeAuditLog } from "@/lib/firebase-audit"
import { firebaseConfig, getDb, isFirebaseConfigured } from "@/lib/firebase"
import { mirrorUserToFirestore } from "@/lib/firebase-user-mirror"
import { readList } from "@/lib/rtdb-read"
import { createUserNotification } from "@/lib/firebase-notify"
import { paths } from "@/lib/firebase-paths"
import type {
  AccountStatus,
  Area,
  CompanyUser,
  Department,
  EmployeeGroup,
  EmployeeTransferLog,
  Office,
  Position,
  ScheduleAssignment,
  SubDepartment,
} from "@/lib/firebase-types"

export interface EmployeesData {
  employees: CompanyUser[]
  areas: Area[]
  offices: Office[]
  departments: Department[]
  subDepartments: SubDepartment[]
  groups: EmployeeGroup[]
  assignments: ScheduleAssignment[]
}

export function useEmployees(companyId: string) {
  return useQuery({
    queryKey: ["ks", "employees", companyId],
    queryFn: async (): Promise<EmployeesData> => {
      const [employees, areas, offices, departments, subDepartments, groups, assignments] =
        await Promise.all([
          readList<CompanyUser>(paths.companyUsers(companyId)),
          readList<Area>(paths.areas(companyId)),
          readList<Office>(paths.offices(companyId)),
          readList<Department>(paths.departments(companyId)),
          readList<SubDepartment>(paths.subDepartments(companyId)),
          readList<EmployeeGroup>(paths.employeeGroups(companyId)),
          readList<ScheduleAssignment>(paths.scheduleAssignments(companyId)),
        ])
      return { employees, areas, offices, departments, subDepartments, groups, assignments }
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

export interface EmployeeForm {
  nama_lengkap: string
  email: string
  password: string
  nip: string
  no_hp: string
  position: Position | ""
  area_id: string
  office_id: string
  department_id: string
  sub_department_id: string
  group_id: string
}

/**
 * Tambah karyawan via secondary Firebase app (agar sesi admin tidak
 * tertukar), persis seperti myadmin lama.
 */
export async function createEmployee(
  companyId: string,
  form: EmployeeForm,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!form.nama_lengkap.trim()) throw new Error("Nama lengkap wajib diisi.")
  if (!form.email.trim()) throw new Error("Email wajib diisi.")
  if (!form.password || form.password.length < 6)
    throw new Error("Kata sandi minimal 6 karakter.")

  const secondaryApp = initializeApp(firebaseConfig, `SecondaryApp${Date.now()}`)
  const secondaryAuth = getAuth(secondaryApp)
  try {
    const cred = await createUserWithEmailAndPassword(
      secondaryAuth,
      form.email.trim(),
      form.password,
    )
    const newUid = cred.user.uid
    const now = Date.now()
    const base = {
      email: form.email.trim(),
      nama_lengkap: form.nama_lengkap.trim(),
      role: "user" as const,
      position: (form.position || "USER") as Position,
      status_akun: "active" as const,
      company_id: companyId,
      nip: form.nip || "",
      no_hp: form.no_hp || "",
      area_id: form.area_id || "",
      office_id: form.office_id || "",
      department_id: form.department_id || "",
      sub_department_id: form.sub_department_id || "",
      group_id: form.group_id || "",
      profile_completed: true,
      face_registered: false,
      face_registered_at: null,
      device_id: null,
      device_name: null,
      qr_token: null,
      qr_active: false,
      photo_url: "",
      photo_path: "",
      created_at: now,
      updated_at: now,
    }
    const updates: Record<string, unknown> = {}
    updates[paths.userIndex(newUid)] = { uid: newUid, ...base }
    updates[paths.companyUser(companyId, newUid)] = { uid: newUid, ...base }
    await update(ref(db), updates)
    try {
      await mirrorUserToFirestore({ uid: newUid, ...base })
    } catch (mirrorErr) {
      console.warn("Failed to mirror added user", mirrorErr)
    }
    await writeAuditLog(companyId, {
      action: "CREATE_USER",
      details: `Menambah karyawan ${form.nama_lengkap.trim()} (${form.email.trim()})`,
      user_uid: actor.uid,
      user_name: actor.name,
      target_path: paths.companyUser(companyId, newUid),
      new_value: { uid: newUid, ...base },
    })
  } finally {
    await signOut(secondaryAuth).catch(() => undefined)
  }
}

export interface EmployeeEditForm {
  nama_lengkap: string
  nip: string
  no_hp: string
  position: Position | ""
  status_akun: AccountStatus
  area_id: string
  office_id: string
  department_id: string
  sub_department_id: string
  group_id: string
}

export async function updateEmployee(
  companyId: string,
  uid: string,
  form: EmployeeEditForm,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!form.nama_lengkap.trim()) throw new Error("Nama lengkap wajib diisi.")
  const patch = {
    nama_lengkap: form.nama_lengkap.trim(),
    nip: form.nip || "",
    no_hp: form.no_hp || "",
    position: form.position || "USER",
    status_akun: form.status_akun,
    area_id: form.area_id || "",
    office_id: form.office_id || "",
    department_id: form.department_id || "",
    sub_department_id: form.sub_department_id || "",
    group_id: form.group_id || "",
    updated_at: Date.now(),
  }
  // Tulis PER FIELD: multi-path update() dengan nilai objek akan
  // MENIMPA seluruh node (RTDB). Jangan pernah menaruh objek patch
  // langsung sebagai nilai sebuah path — itu menghapus email, role,
  // foto, data wajah, perangkat, dst. dari kedua node.
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    updates[`${paths.userIndex(uid)}/${key}`] = value
    updates[`${paths.companyUser(companyId, uid)}/${key}`] = value
  }
  await update(ref(db), updates)
  try {
    await mirrorUserToFirestore({ uid, company_id: companyId, ...patch })
  } catch (mirrorErr) {
    console.warn("Failed to mirror updated user", mirrorErr)
  }
  await writeAuditLog(companyId, {
    action: "UPDATE_USER",
    details: `Mengubah data karyawan ${form.nama_lengkap.trim()}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyUser(companyId, uid),
    new_value: patch,
  })
}

export async function setEmployeeStatus(
  companyId: string,
  uid: string,
  status: AccountStatus,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const patch = { status_akun: status, updated_at: Date.now() }
  const updates: Record<string, unknown> = {}
  updates[`${paths.userIndex(uid)}/status_akun`] = status
  updates[`${paths.userIndex(uid)}/updated_at`] = patch.updated_at
  updates[`${paths.companyUser(companyId, uid)}/status_akun`] = status
  updates[`${paths.companyUser(companyId, uid)}/updated_at`] = patch.updated_at
  await update(ref(db), updates)
  await writeAuditLog(companyId, {
    action: status === "active" ? "ACTIVATE_USER" : "DEACTIVATE_USER",
    details: `Mengubah status karyawan ${uid} menjadi ${status}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyUser(companyId, uid),
    new_value: patch,
  })
}

export async function resetEmployeeDevice(
  companyId: string,
  uid: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const updates: Record<string, unknown> = {}
  updates[`${paths.companyUser(companyId, uid)}/device_id`] = null
  updates[`${paths.companyUser(companyId, uid)}/device_name`] = null
  await update(ref(db), updates)
  await writeAuditLog(companyId, {
    action: "RESET_DEVICE_DATA",
    details: `Mereset device karyawan ${uid}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyUser(companyId, uid),
  })
}

export async function resetEmployeeFace(
  companyId: string,
  uid: string,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const updates: Record<string, unknown> = {}
  updates[`${paths.companyUser(companyId, uid)}/face_registered`] = false
  updates[`${paths.companyUser(companyId, uid)}/face_registered_at`] = null
  updates[`companies/${companyId}/face_descriptors/${uid}`] = null
  await update(ref(db), updates)
  await writeAuditLog(companyId, {
    action: "RESET_FACE_DATA",
    details: `Menghapus data wajah karyawan ${uid}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyUser(companyId, uid),
  })
  await createUserNotification(uid, {
    company_id: companyId,
    title: "Pendaftaran Wajah Ulang Diperlukan",
    message:
      "Data wajah Anda telah di-reset oleh admin. Harap mendaftar ulang wajah sebelum absensi berikutnya.",
    type: "warning",
    ref_type: "face_reset",
    ref_id: uid,
  })
}

export interface TransferForm {
  area_id: string
  office_id: string
  department_id: string
  sub_department_id: string
  group_id: string
  reason: string
  effective_date: string
}

export async function transferEmployee(
  companyId: string,
  employee: CompanyUser,
  form: TransferForm,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const uid = employee.uid ?? employee.id ?? ""
  if (!uid) throw new Error("UID karyawan tidak ditemukan.")
  const now = Date.now()
  // Bentuk log mengikuti Employees.tsx lama (old_*/new_* + nama +
  // effective_date + status) — BUKAN from_*/to_*.
  const log: Omit<EmployeeTransferLog, "id"> = {
    uid,
    company_id: companyId,
    employee_name: employee.nama_lengkap ?? "",
    employee_email: employee.email ?? "",
    old_area_id: employee.area_id ?? "",
    old_office_id: employee.office_id ?? "",
    old_department_id: employee.department_id ?? "",
    old_sub_department_id: employee.sub_department_id ?? "",
    old_group_id: employee.group_id ?? "",
    new_area_id: form.area_id,
    new_office_id: form.office_id,
    new_department_id: form.department_id,
    new_sub_department_id: form.sub_department_id,
    new_group_id: form.group_id,
    effective_date: form.effective_date,
    reason: form.reason,
    status: "completed",
    created_by: actor.uid,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now,
  }
  const logRef = push(ref(db, paths.employeeTransferLogs(companyId)))
  await set(logRef, log)
  const patch = {
    area_id: form.area_id,
    office_id: form.office_id,
    department_id: form.department_id,
    sub_department_id: form.sub_department_id,
    group_id: form.group_id,
    last_transfer_id: logRef.key ?? "",
    last_transfer_at: now,
    last_transfer_reason: form.reason ?? "",
    updated_by: actor.uid,
    updated_at: now,
  }
  // Tulis PER FIELD (lihat updateEmployee): nilai objek langsung pada
  // sebuah path akan menimpa seluruh node karyawan.
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    updates[`${paths.userIndex(uid)}/${key}`] = value
    updates[`${paths.companyUser(companyId, uid)}/${key}`] = value
  }
  await update(ref(db), updates)
  await writeAuditLog(companyId, {
    action: "TRANSFER_EMPLOYEE",
    details: `Memindahkan karyawan ${employee.nama_lengkap ?? uid} ke struktur baru`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: paths.companyUser(companyId, uid),
    new_value: patch,
  })
  await createUserNotification(uid, {
    company_id: companyId,
    title: "Struktur Organisasi Anda Berubah",
    message: `Anda dipindahkan ke struktur organisasi baru${form.effective_date ? ` efektif ${form.effective_date}` : ""}.`,
    type: "info",
    ref_type: "employee_transfer",
    ref_id: logRef.key ?? "",
  })
}
