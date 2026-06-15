import admin from "firebase-admin";

function parseArgs(argv) {
  const args = {};

  argv.slice(2).forEach((arg) => {
    if (!arg.startsWith("--")) return;

    const eq = arg.indexOf("=");
    if (eq === -1) {
      args[arg.slice(2)] = true;
      return;
    }

    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    args[key] = value;
  });

  return args;
}

function isValidDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function inDateRange(date, startDate, endDate) {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function getRecordTime(record) {
  return record?.record_time || record?.time || record?.waktu || "00:00:00";
}

function getRecordTimestamp(record, date) {
  if (record?.created_at) {
    const n = Number(record.created_at);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const parsed = new Date(`${date}T${getRecordTime(record)}`).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function chunkObjectEntries(obj, size) {
  const entries = Object.entries(obj);
  const chunks = [];

  for (let i = 0; i < entries.length; i += size) {
    chunks.push(Object.fromEntries(entries.slice(i, i + size)));
  }

  return chunks;
}

function pickRecentPayload(payload, companyId, uid, date, actionType, ts) {
  return {
    record_id: payload.record_id || `${companyId}_${uid}_${date}_${actionType}`,
    company_id: payload.company_id || companyId,
    uid: payload.uid || uid,
    date: payload.date || payload.tanggal || date,
    action_type: payload.action_type || actionType,
    time: payload.time || payload.waktu || payload.record_time || "00:00:00",
    created_at: ts,
    attendance_status: payload.attendance_status || payload.status_absen || payload.status || "",
    status: payload.status || "",
    method: payload.method || "",
    photo_url: payload.photo_url || payload.foto_url || "",
    foto_url: payload.foto_url || payload.photo_url || "",
    office_id: payload.office_id || "",
    department_id: payload.department_id || "",
    sub_department_id: payload.sub_department_id || "",
    group_id: payload.group_id || "",
    distance_meter: payload.distance_meter ?? "",
    radius_meter: payload.radius_meter ?? "",
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const companyId = args.companyId;
  const startDate = args.startDate || "";
  const endDate = args.endDate || "";
  const dryRun = Boolean(args.dryRun);
  const batchSize = Number(args.batchSize || 400);

  if (!companyId) {
    console.error("ERROR: --companyId wajib diisi.");
    console.error("Contoh:");
    console.error("node scripts/backfillAttendanceByDate.mjs --companyId=COMPANY_ID --dryRun");
    process.exit(1);
  }

  if (startDate && !isValidDateKey(startDate)) {
    console.error("ERROR: --startDate harus format YYYY-MM-DD.");
    process.exit(1);
  }

  if (endDate && !isValidDateKey(endDate)) {
    console.error("ERROR: --endDate harus format YYYY-MM-DD.");
    process.exit(1);
  }

  if (startDate && endDate && startDate > endDate) {
    console.error("ERROR: startDate tidak boleh lebih besar dari endDate.");
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }

  const db = admin.database();

  console.log("=== Backfill Attendance Index ===");
  console.log(`companyId : ${companyId}`);
  console.log(`startDate : ${startDate || "-"}`);
  console.log(`endDate   : ${endDate || "-"}`);
  console.log(`dryRun    : ${dryRun ? "YES" : "NO"}`);
  console.log(`batchSize : ${batchSize}`);
  console.log("");

  if (!process.env.FIREBASE_DATABASE_URL) {
    console.warn("WARNING: FIREBASE_DATABASE_URL tidak ditemukan di environment.");
    console.warn("Pastikan Admin SDK bisa menemukan databaseURL dari konfigurasi environment.");
    console.log("");
  }

  const sourcePath = `attendance/${companyId}`;
  console.log(`Membaca source: ${sourcePath}`);

  const sourceSnap = await db.ref(sourcePath).get();

  if (!sourceSnap.exists()) {
    console.log("Tidak ada data attendance lama untuk company ini.");
    return;
  }

  const source = sourceSnap.val();
  const updates = {};
  let scanned = 0;
  let selected = 0;
  let skippedInvalid = 0;

  for (const uid of Object.keys(source || {})) {
    const userNode = source[uid];

    if (!userNode || typeof userNode !== "object") {
      skippedInvalid++;
      continue;
    }

    for (const date of Object.keys(userNode)) {
      if (!isValidDateKey(date)) {
        skippedInvalid++;
        continue;
      }

      if (!inDateRange(date, startDate, endDate)) {
        continue;
      }

      const dateNode = userNode[date];

      if (!dateNode || typeof dateNode !== "object") {
        skippedInvalid++;
        continue;
      }

      for (const actionType of Object.keys(dateNode)) {
        scanned++;

        const record = dateNode[actionType];

        if (!record || typeof record !== "object") {
          skippedInvalid++;
          continue;
        }

        const payload = {
          ...record,
          company_id: record.company_id || companyId,
          uid: record.uid || uid,
          date: record.date || record.tanggal || date,
          action_type: record.action_type || actionType,
          record_id: record.record_id || `${companyId}_${uid}_${date}_${actionType}`,
        };

        const ts = getRecordTimestamp(payload, date);
        const safeAction = String(actionType).replace(/[.#$/\[\]]/g, "_");
        const recordPath = `attendance_by_date/${companyId}/${date}/${uid}/${safeAction}`;
        const recentKey = `${ts}_${uid}_${safeAction}`.replace(/[.#$/\[\]]/g, "_");
        const recentPath = `attendance_recent/${companyId}/${recentKey}`;

        updates[recordPath] = payload;
        updates[recentPath] = pickRecentPayload(payload, companyId, uid, date, safeAction, ts);

        selected++;
      }
    }
  }

  console.log(`Scanned records : ${scanned}`);
  console.log(`Selected records: ${selected}`);
  console.log(`Skipped invalid : ${skippedInvalid}`);
  console.log(`Update paths    : ${Object.keys(updates).length}`);

  if (dryRun) {
    console.log("");
    console.log("DRY RUN aktif. Tidak ada data yang ditulis.");
    return;
  }

  if (Object.keys(updates).length === 0) {
    console.log("Tidak ada update untuk ditulis.");
    return;
  }

  console.log("");
  console.log("Menulis update multi-location dalam batch...");
  const chunks = chunkObjectEntries(updates, batchSize);

  for (let i = 0; i < chunks.length; i++) {
    await db.ref().update(chunks[i]);
    console.log(`Batch ${i + 1}/${chunks.length} selesai.`);
  }

  console.log("");
  console.log("Backfill selesai.");
}

main().catch((err) => {
  console.error("Backfill gagal:");
  console.error(err);
  process.exit(1);
});
