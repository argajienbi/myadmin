function isActiveEmployee(emp: any) {
  const status = String(
    emp.status_akun ??
    emp.status ??
    emp.account_status ??
    ""
  ).toLowerCase();

  return (
    status === "active" ||
    status === "aktif" ||
    status === "enabled" ||
    status === "approved" ||
    status === "1" ||
    emp.active === true ||
    emp.is_active === true
  );
}

export function resolveAnnouncementTargetUids(
  employees: any[],
  targetType: string,
  targetIds: string[]
) {
  const safeTargetIds = Array.isArray(targetIds)
    ? targetIds.map((id) => String(id))
    : [];

  const activeEmployees = employees.filter(isActiveEmployee);

  if (targetType === "all") {
    return activeEmployees.map((emp) => emp.uid).filter(Boolean);
  }

  if (targetType === "user") {
    return activeEmployees
      .filter((emp) => safeTargetIds.includes(String(emp.uid)))
      .map((emp) => emp.uid)
      .filter(Boolean);
  }

  if (targetType === "office") {
    return activeEmployees
      .filter((emp) => safeTargetIds.includes(String(emp.office_id ?? emp.officeId ?? "")))
      .map((emp) => emp.uid)
      .filter(Boolean);
  }

  if (targetType === "area") {
    return activeEmployees
      .filter((emp) => safeTargetIds.includes(String(emp.area_id ?? emp.areaId ?? "")))
      .map((emp) => emp.uid)
      .filter(Boolean);
  }

  if (targetType === "department") {
    return activeEmployees
      .filter((emp) => safeTargetIds.includes(String(emp.department_id ?? emp.departmentId ?? "")))
      .map((emp) => emp.uid)
      .filter(Boolean);
  }

  if (targetType === "sub_department") {
    return activeEmployees
      .filter((emp) =>
        safeTargetIds.includes(String(emp.sub_department_id ?? emp.subDepartmentId ?? ""))
      )
      .map((emp) => emp.uid)
      .filter(Boolean);
  }

  if (targetType === "group") {
    return activeEmployees
      .filter((emp) => safeTargetIds.includes(String(emp.group_id ?? emp.groupId ?? "")))
      .map((emp) => emp.uid)
      .filter(Boolean);
  }

  return [];
}
