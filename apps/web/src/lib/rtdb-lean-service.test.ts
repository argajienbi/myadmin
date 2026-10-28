// Regresi audit 28 Okt 2026: `attendance_by_date` tidak ada di RTDB,
// halaman Absensi harus membaca jalur lama `attendance/{companyId}`.
import { describe, expect, it } from "vitest"
import { buildDateRange, flattenAttendanceLegacyNode } from "./rtdb-lean-service"

// Bentuk node jalur lama (disederhanakan dari data live FMI):
// {uid: {date: {actionType: rec}}}.
const legacyNode = {
  f0MSPOC8wqUElxldUMc6uYeDU0d2: {
    "2026-10-20": {
      masuk: { uid: "f0MSPOC8wqUElxldUMc6uYeDU0d2", date: "2026-10-20", record_time: "07:58", action_type: "masuk" },
    },
  },
  RjkLpCEnHsSNiIz2NsQlOMkVxkq2: {
    "2026-10-22": {
      masuk: { uid: "RjkLpCEnHsSNiIz2NsQlOMkVxkq2", date: "2026-10-22", record_time: "08:02", action_type: "masuk" },
    },
    "2026-10-27": {
      masuk: { uid: "RjkLpCEnHsSNiIz2NsQlOMkVxkq2", date: "2026-10-27", record_time: "07:55", action_type: "masuk" },
    },
  },
}

describe("buildDateRange", () => {
  // Kunci tanggal RTDB adalah tanggal kalender lokal (WIB) — bukan UTC:
  // di zona UTC+7, `toISOString()` pada tengah malam lokal mundur sehari.
  it("mengembalikan kunci yang sama persis dengan rentang yang diminta", () => {
    expect(buildDateRange("2026-10-20", "2026-10-22")).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
    ])
  })

  it("tidak bergeser di batas bulan", () => {
    expect(buildDateRange("2026-10-31", "2026-11-02")).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ])
  })

  it("satu hari mengembalikan satu kunci", () => {
    expect(buildDateRange("2026-10-27", "2026-10-27")).toEqual([
      "2026-10-27",
    ])
  })
})

describe("flattenAttendanceLegacyNode", () => {
  it("hanya mengembalikan tanggal dalam rentang yang diminta", () => {
    const rows = flattenAttendanceLegacyNode("FMI", ["2026-10-20", "2026-10-21", "2026-10-22"], legacyNode)
    expect(rows.map((r) => String(r.dateKey)).sort()).toEqual([
      "2026-10-20",
      "2026-10-22",
    ])
    expect(rows).toHaveLength(2)
  })

  it("membentuk baris seperti jalur indeks (uid, dateKey, action_type, id)", () => {
    const rows = flattenAttendanceLegacyNode("FMI", ["2026-10-27"], legacyNode)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.uid).toBe("RjkLpCEnHsSNiIz2NsQlOMkVxkq2")
    expect(row.dateKey).toBe("2026-10-27")
    expect(row.action_type).toBe("masuk")
    expect(row.record_time).toBe("07:55")
    expect(String(row.id)).toContain("2026-10-27")
  })

  it("mengembalikan [] untuk node kosong atau tanggal tanpa record", () => {
    expect(flattenAttendanceLegacyNode("FMI", ["2026-10-28"], legacyNode)).toEqual([])
    expect(flattenAttendanceLegacyNode("FMI", ["2026-10-20"], null)).toEqual([])
    expect(flattenAttendanceLegacyNode("FMI", ["2026-10-20"], {})).toEqual([])
  })
})
