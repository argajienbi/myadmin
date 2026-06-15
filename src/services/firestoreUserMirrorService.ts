import { doc, setDoc } from "firebase/firestore";
import { firestore } from "../firebase";

export type FirestoreUserMirrorPayload = {
  uid: string;
  company_id?: string;
  role?: string;
  status_akun?: string;
  nama_lengkap?: string;
  email?: string;
  nip?: string;
  no_hp?: string;
  position?: string;
  area_id?: string;
  office_id?: string;
  department_id?: string;
  sub_department_id?: string;
  group_id?: string;
  photo_url?: string;
  photo_path?: string;
};

export function normalizeFirestoreUserMirror(
  payload: FirestoreUserMirrorPayload
) {
  return {
    uid: payload.uid,
    company_id: payload.company_id || "",
    role: payload.role || "employee",
    status_akun: payload.status_akun || "active",
    nama_lengkap: payload.nama_lengkap || "",
    email: payload.email || "",
    nip: payload.nip || "",
    no_hp: payload.no_hp || "",
    position: payload.position || "",
    area_id: payload.area_id || "",
    office_id: payload.office_id || "",
    department_id: payload.department_id || "",
    sub_department_id: payload.sub_department_id || "",
    group_id: payload.group_id || "",
    photo_url: payload.photo_url || "",
    photo_path: payload.photo_path || "",
    updated_at: Date.now(),
  };
}

export async function mirrorUserToFirestore(
  payload: FirestoreUserMirrorPayload
) {
  if (!payload.uid) return;

  setDoc(
    doc(firestore, "users", payload.uid),
    normalizeFirestoreUserMirror(payload),
    { merge: true }
  ).catch(err => {
    console.warn("Failed to mirror user to Firestore:", err);
  });
}

export async function mirrorUsersToFirestore(
  users: FirestoreUserMirrorPayload[]
) {
  for (const user of users) {
    await mirrorUserToFirestore(user);
  }
}
