import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import firebaseAppletConfig from "../firebase-applet-config.json";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || (firebaseAppletConfig as any).databaseURL || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseAppletConfig.storageBucket || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseAppletConfig.messagingSenderId || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId || "",
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

