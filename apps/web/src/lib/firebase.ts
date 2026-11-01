import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getDatabase } from "firebase/database"
import { getDownloadURL, getStorage, ref as storageRef } from "firebase/storage"
import { getFirestore } from "firebase/firestore"
import firebaseAppletConfig from "../../firebase-applet-config.json"

const normalizeUrl = (url?: string) => {
  if (!url) return ""
  const trimmed = url.trim()
  if (trimmed.startsWith("tps://")) {
    return "h" + trimmed
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return "https://" + trimmed
  }
  return trimmed
}

export const firebaseConfig = {
  apiKey:
    firebaseAppletConfig.apiKey ||
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "",
  authDomain:
    firebaseAppletConfig.authDomain ||
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "",
  databaseURL: normalizeUrl(
    (firebaseAppletConfig as { databaseURL?: string }).databaseURL ||
      import.meta.env.VITE_FIREBASE_DATABASE_URL ||
      ""
  ),
  projectId:
    firebaseAppletConfig.projectId ||
    import.meta.env.VITE_FIREBASE_PROJECT_ID ||
    "",
  storageBucket:
    firebaseAppletConfig.storageBucket ||
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "",
  messagingSenderId:
    firebaseAppletConfig.messagingSenderId ||
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    "",
  appId:
    firebaseAppletConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID || "",
}

// Check if config is present before initializing to avoid fatal errors
export const isConfigAvailable = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL
)

if (!isConfigAvailable && import.meta.env.DEV) {
  console.warn(
    "Firebase is not configured. Please add the missing config in the environment variables."
  )
}

export const app = isConfigAvailable
  ? initializeApp(firebaseConfig)
  : ({} as ReturnType<typeof initializeApp>)
export const auth = isConfigAvailable
  ? getAuth(app)
  : ({} as ReturnType<typeof getAuth>)
export const db = isConfigAvailable
  ? getDatabase(app)
  : ({} as ReturnType<typeof getDatabase>)
export const storage = isConfigAvailable
  ? getStorage(app)
  : ({} as ReturnType<typeof getStorage>)
export const firestore = isConfigAvailable
  ? getFirestore(app)
  : ({} as ReturnType<typeof getFirestore>)

// Akses lazy (null bila belum terkonfigurasi) — dipakai halaman yang
// menampilkan state kosong jujur, bukan crash, saat Firebase belum diisi.
export function isFirebaseConfigured(): boolean {
  return isConfigAvailable
}

export function getFirebaseApp(): ReturnType<typeof initializeApp> | null {
  return isConfigAvailable ? app : null
}

export function getDb(): ReturnType<typeof getDatabase> | null {
  return isConfigAvailable ? db : null
}

export function getFirestoreDb(): ReturnType<typeof getFirestore> | null {
  return isConfigAvailable ? firestore : null
}

export function getFirebaseAuth(): ReturnType<typeof getAuth> | null {
  return isConfigAvailable ? auth : null
}

export function getFirebaseStorage(): ReturnType<typeof getStorage> | null {
  return isConfigAvailable ? storage : null
}

/**
 * Resolve URL file: URL http(s) dikembalikan apa adanya, path Storage
 * diubah ke download URL. Gagal resolve -> kembalikan nilai mentah.
 * (Port dari myadmin lama.)
 */
export async function getFileUrl(pathOrUrl: string): Promise<string> {
  if (!pathOrUrl) return ""
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const s = getFirebaseStorage()
  if (!s) return pathOrUrl
  try {
    return await getDownloadURL(storageRef(s, pathOrUrl))
  } catch {
    return pathOrUrl
  }
}
