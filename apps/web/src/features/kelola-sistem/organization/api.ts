/**
 * Data Organisasi — port logika Organization.tsx myadmin lama ke TanStack
 * Query + satu-shot `get()`. CRUD generik per entitas (Area, Kantor,
 * Departemen, Sub Departemen, Grup) dengan guard dependensi yang sama
 * seperti lama, plus Pola jam (timetable reuse + shift + assignment).
 */
import { useQuery } from "@tanstack/react-query"
import { push, ref, remove, set, update } from "firebase/database"
import { writeAuditLog } from "@/lib/firebase-audit"
import { getDb, isFirebaseConfigured } from "@/lib/firebase"
import { localDateString } from "@/lib/rtdb-lean-service"
import { readList } from "@/lib/rtdb-read"
import { paths } from "@/lib/firebase-paths"
import type {
  Area,
  CompanyUser,
  Department,
  EmployeeGroup,
  Office,
  ScheduleAssignment,
  Shift,
  ShiftDayKey,
  SubDepartment,
  Timetable,
} from "@/lib/firebase-types"
import { SHIFT_DAY_KEYS } from "@/lib/firebase-types"

export type EntityType =
  | "area"
  | "office"
  | "department"
  | "subdepartment"
  | "group"

export const ENTITY_LABEL: Record<EntityType, string> = {
  area: "Area",
  office: "Kantor",
  department: "Departemen",
  subdepartment: "Sub Departemen",
  group: "Grup Karyawan",
}

export function isActiveRecord(item: {
  active?: boolean
  status_akun?: string
}): boolean {
  return item.active !== false
}

export interface OrganizationData {
  areas: Area[]
  offices: Office[]
  departments: Department[]
  subDepartments: SubDepartment[]
  groups: EmployeeGroup[]
  timetables: Timetable[]
  shifts: Shift[]
  assignments: ScheduleAssignment[]
  employees: CompanyUser[]
  scheduleSpecials: { id?: string; type?: string; target_id?: string; active?: boolean }[]
}

export function useOrganization(companyId: string) {
  return useQuery({
    queryKey: ["ks", "organization", companyId],
    queryFn: async (): Promise<OrganizationData> => {
      const [
        areas,
        offices,
        departments,
        subDepartments,
        groups,
        timetables,
        shifts,
        assignments,
        employees,
        scheduleSpecials,
      ] = await Promise.all([
        readList<Area>(paths.areas(companyId)),
        readList<Office>(paths.offices(companyId)),
        readList<Department>(paths.departments(companyId)),
        readList<SubDepartment>(paths.subDepartments(companyId)),
        readList<EmployeeGroup>(paths.employeeGroups(companyId)),
        readList<Timetable>(paths.timetables(companyId)),
        readList<Shift>(paths.shifts(companyId)),
        readList<ScheduleAssignment>(paths.scheduleAssignments(companyId)),
        readList<CompanyUser>(paths.companyUsers(companyId)),
        readList<{ type?: string; target_id?: string; active?: boolean }>(
          paths.scheduleSpecials(companyId),
        ),
      ])
      return {
        areas,
        offices,
        departments,
        subDepartments,
        groups,
        timetables,
        shifts,
        assignments,
        employees,
        scheduleSpecials,
      }
    },
    enabled: isFirebaseConfigured() && Boolean(companyId),
  })
}

export function entityListPath(companyId: string, type: EntityType): string {
  if (type === "area") return paths.areas(companyId)
  if (type === "office") return paths.offices(companyId)
  if (type === "department") return paths.departments(companyId)
  if (type === "subdepartment") return paths.subDepartments(companyId)
  return paths.employeeGroups(companyId)
}

export function entityItemPath(
  companyId: string,
  type: EntityType,
  id: string,
): string {
  if (type === "area") return paths.area(companyId, id)
  if (type === "office") return paths.office(companyId, id)
  if (type === "department") return paths.department(companyId, id)
  if (type === "subdepartment") return paths.subDepartment(companyId, id)
  return paths.employeeGroup(companyId, id)
}

/** Guard dependensi — port getDependencyUsage Organization.tsx lama. */
export function getDependencyUsage(
  data: OrganizationData,
  type: EntityType,
  id: string,
): string[] {
  const usages: string[] = []
  if (type === "area") {
    const officeCount = data.offices.filter(
      (i) => i.area_id === id && isActiveRecord(i),
    ).length
    const deptCount = data.departments.filter(
      (i) => i.area_id === id && isActiveRecord(i),
    ).length
    const groupCount = data.groups.filter(
      (i) => i.area_id === id && isActiveRecord(i),
    ).length
    if (officeCount > 0) usages.push(`${officeCount} kantor`)
    if (deptCount > 0) usages.push(`${deptCount} departemen`)
    if (groupCount > 0) usages.push(`${groupCount} grup karyawan`)
  }
  if (type === "office") {
    const deptCount = data.departments.filter(
      (i) => i.office_id === id && isActiveRecord(i),
    ).length
    const groupCount = data.groups.filter(
      (i) => i.office_id === id && isActiveRecord(i),
    ).length
    const employeeCount = data.employees.filter(
      (i) => i.office_id === id && isActiveRecord(i),
    ).length
    if (deptCount > 0) usages.push(`${deptCount} departemen`)
    if (groupCount > 0) usages.push(`${groupCount} grup karyawan`)
    if (employeeCount > 0) usages.push(`${employeeCount} karyawan`)
  }
  if (type === "department") {
    const subDeptCount = data.subDepartments.filter(
      (i) => i.department_id === id && isActiveRecord(i),
    ).length
    const groupCount = data.groups.filter(
      (i) => i.department_id === id && isActiveRecord(i),
    ).length
    const employeeCount = data.employees.filter(
      (i) => i.department_id === id && isActiveRecord(i),
    ).length
    if (subDeptCount > 0) usages.push(`${subDeptCount} sub departemen`)
    if (groupCount > 0) usages.push(`${groupCount} grup karyawan`)
    if (employeeCount > 0) usages.push(`${employeeCount} karyawan`)
  }
  if (type === "subdepartment") {
    const groupCount = data.groups.filter(
      (i) => i.sub_department_id === id && isActiveRecord(i),
    ).length
    const employeeCount = data.employees.filter(
      (i) => i.sub_department_id === id && isActiveRecord(i),
    ).length
    if (groupCount > 0) usages.push(`${groupCount} grup karyawan`)
    if (employeeCount > 0) usages.push(`${employeeCount} karyawan`)
  }
  if (type === "group") {
    const employeeCount = data.employees.filter(
      (i) => i.group_id === id && isActiveRecord(i),
    ).length
    const assignmentCount = data.assignments.filter(
      (i) =>
        String(i.type ?? "").toLowerCase() === "group" &&
        i.target_id === id &&
        isActiveRecord(i),
    ).length
    const specialCount = data.scheduleSpecials.filter(
      (i) =>
        String(i.type ?? "").toLowerCase() === "group" &&
        i.target_id === id &&
        isActiveRecord(i),
    ).length
    if (employeeCount > 0) usages.push(`${employeeCount} karyawan`)
    if (assignmentCount > 0) usages.push(`${assignmentCount} penerapan jadwal`)
    if (specialCount > 0) usages.push(`${specialCount} jadwal khusus`)
  }
  return usages
}

export interface EntityForm {
  name: string
  area_id: string
  office_id: string
  department_id: string
  sub_department_id: string
  latitude: number
  longitude: number
  radius_meter: number
}

export async function saveEntity(
  companyId: string,
  type: EntityType,
  editingId: string | null,
  form: EntityForm,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!form.name.trim()) throw new Error("Nama wajib diisi.")
  const raw: Record<string, unknown> = { name: form.name.trim() }
  if (type === "office") {
    if (!form.area_id) throw new Error("Area wajib dipilih.")
    if (!Number.isFinite(form.latitude)) throw new Error("Latitude tidak valid.")
    if (!Number.isFinite(form.longitude))
      throw new Error("Longitude tidak valid.")
    if (!Number.isFinite(form.radius_meter) || form.radius_meter <= 0)
      throw new Error("Radius wajib lebih dari 0 meter.")
    raw.area_id = form.area_id
    raw.latitude = form.latitude
    raw.longitude = form.longitude
    raw.radius_meter = form.radius_meter
    raw.map_provider = "leaflet_osm"
    raw.geofence_source = "web_admin_leaflet"
  }
  if (type === "department") {
    if (!form.office_id) throw new Error("Kantor wajib dipilih.")
    if (form.area_id) raw.area_id = form.area_id
    raw.office_id = form.office_id
  }
  if (type === "subdepartment") {
    if (!form.department_id) throw new Error("Departemen wajib dipilih.")
    if (form.office_id) raw.office_id = form.office_id
    raw.department_id = form.department_id
  }
  if (type === "group") {
    if (!form.office_id) throw new Error("Kantor wajib dipilih.")
    if (!form.department_id) throw new Error("Departemen wajib dipilih.")
    if (form.area_id) raw.area_id = form.area_id
    raw.office_id = form.office_id
    raw.department_id = form.department_id
    if (form.sub_department_id) raw.sub_department_id = form.sub_department_id
  }
  const now = Date.now()
  const label = ENTITY_LABEL[type]
  if (editingId) {
    const targetPath = entityItemPath(companyId, type, editingId)
    await update(ref(db, targetPath), {
      ...raw,
      updated_at: now,
      updated_by: actor.uid,
      updated_by_name: actor.name,
    })
    await writeAuditLog(companyId, {
      action: "UPDATE_MASTER_DATA",
      details: `Mengubah ${label.toLowerCase()} "${form.name.trim()}"`,
      user_uid: actor.uid,
      user_name: actor.name,
      target_path: targetPath,
      new_value: raw,
    })
    return
  }
  const listRef = push(ref(db, entityListPath(companyId, type)))
  const payload = {
    id: listRef.key,
    ...raw,
    company_id: companyId,
    active: true,
    created_at: now,
    created_by: actor.uid,
    created_by_name: actor.name,
    updated_at: now,
    updated_by: actor.uid,
    updated_by_name: actor.name,
  }
  await set(listRef, payload)
  await writeAuditLog(companyId, {
    action: "CREATE_MASTER_DATA",
    details: `Menambah ${label.toLowerCase()} "${form.name.trim()}"`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: `${entityListPath(companyId, type)}/${listRef.key}`,
    new_value: payload,
  })
}

export async function toggleEntity(
  companyId: string,
  type: EntityType,
  id: string,
  active: boolean,
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await update(ref(db, entityItemPath(companyId, type, id)), {
    active,
    updated_at: Date.now(),
    updated_by: actor.uid,
    updated_by_name: actor.name,
  })
  await writeAuditLog(companyId, {
    action: "UPDATE_MASTER_DATA",
    details: `${active ? "Mengaktifkan" : "Menonaktifkan"} ${ENTITY_LABEL[type].toLowerCase()} ${id}`,
    user_uid: actor.uid,
    user_name: actor.name,
    target_path: entityItemPath(companyId, type, id),
    new_value: { active },
  })
}

export async function deleteEntity(
  companyId: string,
  type: EntityType,
  id: string,
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  await remove(ref(db, entityItemPath(companyId, type, id)))
}

export interface PatternForm {
  name: string
  work_start: string
  work_end: string
  days: Record<ShiftDayKey, boolean>
}

/** Port handleAddPattern Organization.tsx lama. */
export async function addPattern(
  companyId: string,
  groupId: string,
  form: PatternForm,
  timetables: Timetable[],
  actor: { uid: string; name: string },
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  if (!form.work_start || !form.work_end)
    throw new Error("Jam masuk dan jam keluar wajib diisi.")
  const activeDays = SHIFT_DAY_KEYS.filter((d) => form.days[d])
  if (activeDays.length === 0)
    throw new Error("Minimal satu hari kerja harus dipilih.")
  const now = Date.now()
  const by = actor.uid
  const byName = actor.name

  let timetable = timetables.find(
    (t) =>
      t.work_start === form.work_start &&
      t.work_end === form.work_end &&
      isActiveRecord(t),
  )
  if (!timetable) {
    const ttRef = push(ref(db, paths.timetables(companyId)))
    timetable = {
      id: ttRef.key ?? "",
      name: form.name || `${form.work_start}-${form.work_end}`,
      work_start: form.work_start,
      work_end: form.work_end,
      late_tolerance_minute: 0,
      early_out_tolerance_minute: 0,
      crosses_midnight: form.work_end < form.work_start,
      company_id: companyId,
      active: true,
      created_at: now,
      created_by: by,
      created_by_name: byName,
      updated_at: now,
    }
    await set(ttRef, timetable)
  }

  const shiftRef = push(ref(db, paths.shifts(companyId)))
  const days: Partial<Record<ShiftDayKey, { active: boolean; timetable_id: string }>> = {}
  SHIFT_DAY_KEYS.forEach((d) => {
    days[d] = {
      active: Boolean(form.days[d]),
      timetable_id: form.days[d] ? (timetable?.id ?? "") : "",
    }
  })
  const shiftPayload = {
    id: shiftRef.key,
    name: form.name || `Pola ${form.work_start}-${form.work_end}`,
    workday_mode: "custom",
    days,
    company_id: companyId,
    active: true,
    created_at: now,
    created_by: by,
    created_by_name: byName,
    updated_at: now,
    updated_by: by,
    updated_by_name: byName,
  }
  await set(shiftRef, shiftPayload)

  const assignRef = push(ref(db, paths.scheduleAssignments(companyId)))
  const assignPayload = {
    id: assignRef.key,
    type: "group" as const,
    target_id: groupId,
    shift_id: shiftRef.key,
    start_date: localDateString(),
    end_date: "",
    company_id: companyId,
    active: true,
    created_at: now,
    created_by: by,
  }
  await set(assignRef, assignPayload)

  await writeAuditLog(companyId, {
    action: "CREATE_MASTER_DATA",
    details: `Menambah pola jam "${shiftPayload.name}" (${form.work_start}-${form.work_end}) untuk grup ${groupId}`,
    user_uid: by,
    user_name: byName,
    target_path: `${paths.scheduleAssignments(companyId)}/${assignRef.key}`,
    new_value: assignPayload,
  })
}

/** Port handleDeletePattern: hapus assignment + shift-nya (bukan timetable). */
export async function deletePattern(
  companyId: string,
  assignmentId: string,
  shiftId: string | null,
): Promise<void> {
  const db = getDb()
  if (!db) throw new Error("Firebase belum dikonfigurasi.")
  const updates: Record<string, unknown> = {}
  updates[paths.scheduleAssignment(companyId, assignmentId)] = null
  if (shiftId) updates[paths.shift(companyId, shiftId)] = null
  await update(ref(db), updates)
}
