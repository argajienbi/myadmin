import admin from "firebase-admin";
import { readFileSync } from "node:fs";

const [, , uid, role, companyId = ""] = process.argv;

if (!uid || !role) {
  console.error("Usage: node scripts/setCustomClaims.mjs <uid> <owner|admin|user> [company_id]");
  process.exit(1);
}

if (!["owner", "admin", "user"].includes(role)) {
  console.error("Invalid role. Use owner, admin, or user.");
  process.exit(1);
}

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!serviceAccountPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://mypresence-prod-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "mypresence-prod.firebasestorage.app",
});

await admin.auth().setCustomUserClaims(uid, {
  role,
  company_id: companyId,
});

console.log(`Custom claims updated for ${uid}:`, {
  role,
  company_id: companyId,
});

console.log("User must logout/login again to refresh token.");
