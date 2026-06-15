import { get, ref } from "firebase/database";
import { db, auth } from "../firebase";
import { paths } from "./paths";
import { mirrorUserToFirestore } from "./firestoreUserMirrorService";

export async function syncFirestoreUsersFromRtdb(companyId?: string) {
  const usersSnap = await get(ref(db, paths.users()));
  if (!usersSnap.exists()) {
    return {
      total: 0,
      success: 0,
      failed: 0,
    };
  }

  const users = usersSnap.val();
  let total = 0;
  let success = 0;
  let failed = 0;

  const currentUid = auth.currentUser?.uid;
  const userKeys = Object.keys(users);
  
  // Sort user keys so the current user is synced FIRST. This bootstraps their
  // Firestore document allowing them to bypass company scoping issues 
  // on subsequent writes if their document doesn't exist yet.
  userKeys.sort((a, b) => {
    if (a === currentUid) return -1;
    if (b === currentUid) return 1;
    return 0;
  });

  for (const uid of userKeys) {
    const user = users[uid];

    if (companyId && user.company_id !== companyId) {
      continue;
    }

    total += 1;

    try {
      await mirrorUserToFirestore({
        uid,
        company_id: user.company_id || "",
        role: user.role || "employee",
        status_akun: user.status_akun || "active",
        nama_lengkap: user.nama_lengkap || user.name || "",
        email: user.email || "",
        nip: user.nip || "",
        no_hp: user.no_hp || "",
        position: user.position || "",
        area_id: user.area_id || "",
        office_id: user.office_id || "",
        department_id: user.department_id || "",
        sub_department_id: user.sub_department_id || "",
        group_id: user.group_id || "",
        photo_url: user.photo_url || "",
        photo_path: user.photo_path || "",
      });
      success += 1;
    } catch (error) {
      console.error("Failed syncing Firestore user mirror", uid, error);
      failed += 1;
    }
  }

  return {
    total,
    success,
    failed,
  };
}
