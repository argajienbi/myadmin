// Baca ringan RTDB satu-shot — port helper dari seam Kelola (yang sendiri
// port dari myadmin lama). Satu-satunya tempat readList/readValue/
// snapshotToArray tinggal; halaman memakai ini, bukan get() mentah.
import { get, ref, type DataSnapshot } from "firebase/database"
import { getDb } from "./firebase"

/** Ubah snapshot RTDB (object keyed by id) menjadi array dengan field `id`. */
export function snapshotToArray<T extends object>(
  snapshot: DataSnapshot
): (T & { id: string })[] {
  const val = snapshot.val()
  if (!val || typeof val !== "object") return []
  return Object.entries(val as Record<string, T>).map(([id, item]) => ({
    ...(item ?? {}),
    id,
  }))
}

/** Satu-shot read sebuah path RTDB; [] bila tidak ada / tidak terkonfigurasi. */
export async function readList<T extends object>(
  path: string
): Promise<(T & { id: string })[]> {
  const d = getDb()
  if (!d) return []
  const snap = await get(ref(d, path))
  return snapshotToArray<T>(snap)
}

/** Satu-shot read satu node RTDB; null bila tidak ada. */
export async function readValue<T>(path: string): Promise<T | null> {
  const d = getDb()
  if (!d) return null
  const snap = await get(ref(d, path))
  return (snap.val() as T | null) ?? null
}
