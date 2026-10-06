import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import firebaseAppletConfig from "../firebase-applet-config.json";

const normalizeUrl = (url?: string) => {
  if (!url) return "";
  let trimmed = url.trim();
  if (trimmed.startsWith("tps://")) {
    return "h" + trimmed;
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return "https://" + trimmed;
  }
  return trimmed;
};

export const firebaseConfig = {
  apiKey: firebaseAppletConfig.apiKey || import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: firebaseAppletConfig.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  databaseURL: normalizeUrl((firebaseAppletConfig as any).databaseURL || import.meta.env.VITE_FIREBASE_DATABASE_URL || ""),
  projectId: firebaseAppletConfig.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: firebaseAppletConfig.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: firebaseAppletConfig.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: firebaseAppletConfig.appId || import.meta.env.VITE_FIREBASE_APP_ID || "",
};

// Check if config is present before initializing to avoid fatal errors
export const isConfigAvailable = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);

if (!isConfigAvailable && process.env.NODE_ENV !== "production") {
  console.warn("Firebase is not configured. Please add the missing config in the environment variables.");
}

export const app = isConfigAvailable ? initializeApp(firebaseConfig) : {} as any;
export const auth = isConfigAvailable ? getAuth(app) : {} as any;
export const db = isConfigAvailable ? getDatabase(app) : {} as any;
export const storage = isConfigAvailable ? getStorage(app) : {} as any;
export const firestore = isConfigAvailable ? getFirestore(app) : {} as any;

