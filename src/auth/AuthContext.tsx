import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth, db } from "../firebase";
import { ref, get } from "firebase/database";
import { paths } from "../services/paths";
import { UserIndex } from "../types";
import { mirrorUserToFirestore } from "../services/firestoreUserMirrorService";

interface AuthContextType {
  currentUser: FirebaseUser | null;
  userData: UserIndex | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userData: null,
  loading: true,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<UserIndex | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    auth.signOut();
  };

  useEffect(() => {
    if (!auth || Object.keys(auth).length === 0) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        const OWNER_UID = "BIVgnX2aIwTjMSG2lHkicEfkt9I3";
        const OWNER_EMAIL = "armin.gandi@gmail.com";
        const isOwner = user.uid === OWNER_UID || user.email?.toLowerCase() === OWNER_EMAIL;

        const defaultOwnerData: UserIndex & Record<string, any> = {
          uid: user.uid,
          company_id: "",
          role: "owner",
          status_akun: "active",
          email: user.email || OWNER_EMAIL,
          nama_lengkap: user.displayName || "System Owner",
          created_at: Date.now(),
          is_owner: true,
          is_system_owner: true,
          bootstrap_owner: true,
          updated_at: Date.now(),
        };

        let resolvedUserData: UserIndex | null = isOwner ? defaultOwnerData : null;

        try {
          if (db && Object.keys(db).length > 0) {
            const userRef = ref(db, paths.userIndex(user.uid));
            let snapshot: any = null;
            try {
              snapshot = await get(userRef);
            } catch (readErr: any) {
              if (isOwner) {
                console.warn("RTDB read restricted for owner, continuing with verified owner session:", readErr?.message || readErr);
              } else {
                console.warn("RTDB read restricted for user:", readErr?.message || readErr);
              }
            }

            if (snapshot && snapshot.exists()) {
              const data = snapshot.val();
              if (isOwner) {
                data.role = "owner";
                data.status_akun = "active";
                data.is_owner = true;
                data.is_system_owner = true;
                data.bootstrap_owner = true;
                try {
                  const { update } = await import("firebase/database");
                  await update(userRef, {
                    role: "owner",
                    status_akun: "active",
                    is_owner: true,
                    is_system_owner: true,
                    bootstrap_owner: true,
                    updated_at: Date.now(),
                  });
                } catch (updateErr) {
                  console.warn("Owner update to RTDB restricted:", updateErr);
                }
              }
              resolvedUserData = data;
            } else if (isOwner) {
              resolvedUserData = defaultOwnerData;
              try {
                const { set } = await import("firebase/database");
                await set(userRef, defaultOwnerData);
              } catch (writeErr) {
                console.warn("Owner bootstrap to RTDB restricted:", writeErr);
              }
            } else {
              resolvedUserData = null;
            }
          }
        } catch (error: any) {
          if (!isOwner) {
            console.warn("Notice reading user profile:", error?.message || error);
            resolvedUserData = null;
          }
        }

        setUserData(resolvedUserData);

        if (resolvedUserData) {
          const userMeta = resolvedUserData as any;
          try {
            mirrorUserToFirestore({
              uid: user.uid,
              company_id: userMeta.company_id || "",
              role: userMeta.role || (isOwner ? "owner" : "employee"),
              status_akun: userMeta.status_akun || "active",
              nama_lengkap: userMeta.nama_lengkap || user.displayName || (isOwner ? "System Owner" : ""),
              email: userMeta.email || user.email || "",
              nip: userMeta.nip || "",
              no_hp: userMeta.no_hp || "",
              position: userMeta.position || "",
              area_id: userMeta.area_id || "",
              office_id: userMeta.office_id || "",
              department_id: userMeta.department_id || "",
              sub_department_id: userMeta.sub_department_id || "",
              group_id: userMeta.group_id || "",
              photo_url: userMeta.photo_url || "",
              photo_path: userMeta.photo_path || "",
            }).catch((mirrorError) => {
              console.warn("Failed mirroring current user to Firestore", mirrorError);
            });
          } catch (mirrorError) {
            console.warn("Error running mirrorUserToFirestore", mirrorError);
          }
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    userData,
    loading,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
