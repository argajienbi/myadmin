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
        try {
          const OWNER_UID = "tWtZoVGg3qgwU4Odtl1FPCGC6zZ2";
          const OWNER_EMAIL = "armin.gandi@gmail.com";
          const isOwner = user.uid === OWNER_UID || user.email?.toLowerCase() === OWNER_EMAIL;
          const userRef = ref(db, paths.userIndex(user.uid));
          const snapshot = await get(userRef);
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (isOwner) {
              if (data.role !== "owner" || data.status_akun !== "active" || !data.is_owner || !data.is_system_owner) {
                data.role = "owner";
                data.status_akun = "active";
                data.is_owner = true;
                data.is_system_owner = true;
                data.bootstrap_owner = true;
                data.updated_at = Date.now();
                const { update } = await import("firebase/database");
                await update(userRef, {
                  role: "owner",
                  status_akun: "active",
                  is_owner: true,
                  is_system_owner: true,
                  bootstrap_owner: true,
                  updated_at: Date.now(),
                });
              }
            }
            setUserData(data);

            try {
              mirrorUserToFirestore({
                uid: user.uid,
                company_id: data.company_id || "",
                role: data.role || "employee",
                status_akun: data.status_akun || "active",
                nama_lengkap: data.nama_lengkap || data.name || "",
                email: data.email || user.email || "",
                nip: data.nip || "",
                no_hp: data.no_hp || "",
                position: data.position || "",
                area_id: data.area_id || "",
                office_id: data.office_id || "",
                department_id: data.department_id || "",
                sub_department_id: data.sub_department_id || "",
                group_id: data.group_id || "",
                photo_url: data.photo_url || "",
                photo_path: data.photo_path || "",
              }).catch(mirrorError => {
                console.warn("Failed mirroring current user to Firestore", mirrorError);
              });
            } catch (mirrorError) {
              console.warn("Error running mirrorUserToFirestore", mirrorError);
            }
          } else {
            if (isOwner) {
              const ownerData = {
                uid: user.uid,
                company_id: "",
                role: "owner",
                status_akun: "active",
                email: user.email || "",
                nama_lengkap: "System Owner",
                created_at: Date.now(),
                is_owner: true,
                is_system_owner: true,
                bootstrap_owner: true,
                updated_at: Date.now(),
              } as UserIndex & Record<string, any>;
              const { set } = await import("firebase/database");
              await set(userRef, ownerData);
              setUserData(ownerData);
              mirrorUserToFirestore(ownerData as any).catch(() => {});
            } else {
              console.error("User not found in RTDB index");
              setUserData(null);
            }
          }
        } catch (error: any) {
          console.error("Error fetching user data", error);
          if (error.message && error.message.includes("Permission denied")) {
             console.warn("Database reading blocked. Please ensure rtdb.rules.json is deployed to your Firebase project.");
          }
          setUserData(null);
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
