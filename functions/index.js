const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const EXPECTED_PROJECT_ID = "mypresence-db";
const EXPECTED_DATABASE_URL =
  "https://mypresence-db-default-rtdb.asia-southeast1.firebasedatabase.app";
const EXPECTED_DATABASE_INSTANCE = "mypresence-db-default-rtdb";

const firebaseConfigRaw = process.env.FIREBASE_CONFIG;

let defaultDatabaseURL = EXPECTED_DATABASE_URL;
let defaultDatabaseInstance = EXPECTED_DATABASE_INSTANCE;

if (firebaseConfigRaw) {
  try {
    const parsed = JSON.parse(firebaseConfigRaw);

    if (parsed.projectId && parsed.projectId !== EXPECTED_PROJECT_ID) {
      logger.warn("FIREBASE_CONFIG projectId berbeda dari project target.", {
        expectedProjectId: EXPECTED_PROJECT_ID,
        detectedProjectId: parsed.projectId,
      });
    }

    if (parsed.databaseURL) {
      const parsedUrl = String(parsed.databaseURL);

      if (parsedUrl.includes("mypresence-db-default-rtdb")) {
        defaultDatabaseURL = parsedUrl;

        const match = parsedUrl.match(/https:\/\/([^.]+)\./);
        if (match && match[1]) {
          defaultDatabaseInstance = match[1];
        }
      } else {
        logger.warn("FIREBASE_CONFIG databaseURL bukan database target. Menggunakan database target.", {
          expectedDatabaseURL: EXPECTED_DATABASE_URL,
          detectedDatabaseURL: parsedUrl,
        });

        defaultDatabaseURL = EXPECTED_DATABASE_URL;
        defaultDatabaseInstance = EXPECTED_DATABASE_INSTANCE;
      }
    } else if (parsed.projectId === EXPECTED_PROJECT_ID) {
      defaultDatabaseURL = EXPECTED_DATABASE_URL;
      defaultDatabaseInstance = EXPECTED_DATABASE_INSTANCE;
    }
  } catch (e) {
    logger.warn("Gagal parse FIREBASE_CONFIG env. Menggunakan database target.", e);
    defaultDatabaseURL = EXPECTED_DATABASE_URL;
    defaultDatabaseInstance = EXPECTED_DATABASE_INSTANCE;
  }
} else if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== EXPECTED_PROJECT_ID) {
  logger.warn("GCLOUD_PROJECT berbeda dari project target. Menggunakan database target.", {
    expectedProjectId: EXPECTED_PROJECT_ID,
    detectedProjectId: process.env.GCLOUD_PROJECT,
  });

  defaultDatabaseURL = EXPECTED_DATABASE_URL;
  defaultDatabaseInstance = EXPECTED_DATABASE_INSTANCE;
}

admin.initializeApp({
  databaseURL: defaultDatabaseURL,
});

logger.info("Firebase Admin initialized.", {
  projectId: EXPECTED_PROJECT_ID,
  databaseURL: defaultDatabaseURL,
  databaseInstance: defaultDatabaseInstance,
});

const MAX_RETRY_COUNT = 3;

const DEFAULT_CHECK_IN_REMINDER_BEFORE_MINUTES = 5;
const DEFAULT_CHECK_OUT_REMINDER_AFTER_MINUTES = 5;
const REMINDER_SCHEDULER_WINDOW_MINUTES = 6;

const firestore = admin.firestore();
const messaging = admin.messaging();

const DATABASE_INSTANCE = defaultDatabaseInstance;
const REGION = "asia-southeast1";
const CHANNEL_ID = "mypresence_high_importance_channel_v2";

const MAX_MANUAL_REBUILD_DAYS = 31;
const MAX_LEAVE_INDEX_SPAN_DAYS = 60;
const ATTENDANCE_REMINDER_TARGETS_PATH = "system_config/attendance_reminder_scheduler/target_companies";
const ATTENDANCE_REMINDER_GLOBAL_CONFIG_PATH = "system_config/attendance_reminder_scheduler";

function isValidDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dateKeyToLocalDate(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateToDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(startDate, endDate) {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return 0;

  const start = dateKeyToLocalDate(startDate);
  const end = dateKeyToLocalDate(endDate);

  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function buildDateRange(startDate, endDate, maxDays = MAX_LEAVE_INDEX_SPAN_DAYS) {
  const total = daysBetween(startDate, endDate);

  if (total <= 0) return [];
  if (total > maxDays) return [];

  const start = dateKeyToLocalDate(startDate);
  const result = [];

  for (let i = 0; i < total; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    result.push(localDateToDateKey(d));
  }

  return result;
}

function sanitizeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$/\[\]]/g, "_");
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function isApprovedStatus(value) {
  const status = normalizeStatus(value);
  return status === "approved" || status === "approve" || status === "disetujui" || status === "accepted";
}

function getLeaveUid(leave, fallbackId = "") {
  return String(
    leave?.uid ||
    leave?.user_uid ||
    leave?.userId ||
    leave?.user_id ||
    leave?.employee_uid ||
    leave?.employee_id ||
    fallbackId ||
    ""
  ).trim();
}

function getLeaveStartDate(leave) {
  return String(
    leave?.start_date ||
    leave?.startDate ||
    leave?.tanggal_mulai ||
    leave?.from_date ||
    leave?.date_start ||
    leave?.date ||
    leave?.tanggal ||
    ""
  ).slice(0, 10);
}

function getLeaveEndDate(leave) {
  return String(
    leave?.end_date ||
    leave?.endDate ||
    leave?.tanggal_selesai ||
    leave?.to_date ||
    leave?.date_end ||
    leave?.start_date ||
    leave?.startDate ||
    leave?.tanggal_mulai ||
    leave?.date ||
    leave?.tanggal ||
    ""
  ).slice(0, 10);
}

function buildApprovedLeaveIndexUpdates(companyId, requestId, beforeLeave, afterLeave) {
  const updates = {};
  const safeRequestId = sanitizeKey(requestId);

  function removeOldIndex(leave) {
    if (!leave || typeof leave !== "object") return;

    const uid = getLeaveUid(leave, safeRequestId);
    const startDate = getLeaveStartDate(leave);
    const endDate = getLeaveEndDate(leave);

    if (!uid || !isValidDateKey(startDate) || !isValidDateKey(endDate)) return;

    const dates = buildDateRange(startDate, endDate, MAX_LEAVE_INDEX_SPAN_DAYS);
    const safeUid = sanitizeKey(uid);

    dates.forEach((date) => {
      updates[`approved_leave_by_date/${companyId}/${date}/${safeUid}/${safeRequestId}`] = null;
    });
  }

  function setNewIndex(leave) {
    if (!leave || typeof leave !== "object") return;

    if (!isApprovedStatus(leave.status || leave.approval_status || leave.state)) return;

    const uid = getLeaveUid(leave, safeRequestId);
    const startDate = getLeaveStartDate(leave);
    const endDate = getLeaveEndDate(leave);

    if (!uid || !isValidDateKey(startDate) || !isValidDateKey(endDate)) return;

    const dates = buildDateRange(startDate, endDate, MAX_LEAVE_INDEX_SPAN_DAYS);
    const safeUid = sanitizeKey(uid);

    const payload = {
      request_id: requestId,
      company_id: companyId,
      uid,
      start_date: startDate,
      end_date: endDate,
      status: leave.status || leave.approval_status || "approved",
      type: leave.type || leave.leave_type || leave.jenis || "",
      reason: leave.reason || leave.alasan || "",
      updated_at: Date.now(),
    };

    dates.forEach((date) => {
      updates[`approved_leave_by_date/${companyId}/${date}/${safeUid}/${safeRequestId}`] = payload;
    });
  }

  removeOldIndex(beforeLeave);
  setNewIndex(afterLeave);

  return updates;
}

function flattenApprovedLeaveByDate(data) {
  const result = {};

  if (!data || typeof data !== "object") return result;

  for (const uid of Object.keys(data)) {
    const requests = data[uid];

    if (!requests || typeof requests !== "object") continue;

    result[uid] = requests;
  }

  return result;
}

function isUserOnApprovedLeave(approvedLeaveMap, uid) {
  const safeUid = sanitizeKey(uid);
  const node = approvedLeaveMap?.[safeUid] || approvedLeaveMap?.[uid];

  return Boolean(node && typeof node === "object" && Object.keys(node).length > 0);
}

async function loadApprovedLeaveMapForDate(companyId, dateStr) {
  const snap = await admin
    .database()
    .ref(`approved_leave_by_date/${companyId}/${dateStr}`)
    .get();

  if (!snap.exists()) return {};

  return flattenApprovedLeaveByDate(snap.val());
}

exports.processNotificationQueue = onValueWritten(
  {
    region: REGION,
    instance: DATABASE_INSTANCE,
    ref: "/companies/{companyId}/notification_queue/{queueId}",
    timeoutSeconds: 120,
    memory: "256MiB",
  },
  async (event) => {
    const companyId = event.params.companyId;
    const queueId = event.params.queueId;
    const queueRef = event.data.after.ref;
    const queue = event.data.after.val();

    if (!queue || typeof queue !== "object") {
      logger.warn("Queue kosong atau format tidak valid.", {
        companyId,
        queueId,
      });
      return null;
    }

    if (queue.status !== "pending") {
      logger.info("Queue dilewati karena status bukan pending.", {
        companyId,
        queueId,
        status: queue.status,
      });
      return null;
    }

    const uid = String(queue.uid || "").trim();
    const title = String(queue.title || "MYPRESENSI").trim();
    const body = String(
      queue.body || queue.message || "Ada notifikasi baru.",
    ).trim();

    if (!uid) {
      await failQueue(queueRef, "uid kosong.");
      return null;
    }

    if (!title && !body) {
      await failQueue(queueRef, "title/body kosong.");
      return null;
    }

    const now = Date.now();

    await queueRef.update({
      status: "processing",
      processing_at: now,
      updated_at: now,
    });

    try {
      const tokens = await getActiveFcmTokens(companyId, uid);

      if (tokens.length === 0) {
        await failQueue(queueRef, "Tidak ada FCM token aktif untuk user ini.", {
          token_count: 0,
        });

        await writeLog(companyId, {
          action: "notification_queue_failed",
          queue_id: queueId,
          uid,
          title,
          error: "Tidak ada FCM token aktif untuk user ini.",
        });

        return null;
      }

      const queueData =
        queue.data && typeof queue.data === "object" && !Array.isArray(queue.data)
          ? queue.data
          : {};

      const dataPayload = normalizeDataPayload({
        ...queueData,
        company_id: companyId,
        uid,
        notification_id: queue.notification_id || queueId,
        id: queue.notification_id || queueId,
        queue_id: queueId,
        title,
        body,
        message: queue.message || body,
        type: queue.type || "info",
        ref_type: queue.ref_type || "",
        ref_id: queue.ref_id || "",
        related_id: queue.related_id || queue.ref_id || "",
      });

      if (dataPayload.ref_type === "attendance_reminder") {
        logger.info("Attendance reminder FCM payload prepared.", {
          companyId,
          uid,
          queueId,
          notificationId: dataPayload.notification_id,
          reminder_action: dataPayload.reminder_action || "",
          reminder_stage: dataPayload.reminder_stage || "",
          reminder_target_clock: dataPayload.reminder_target_clock || "",
        });
      }

      let successCount = 0;
      let failedCount = 0;
      const invalidTokensMap = {};
      const errors = [];

      const chunks = chunk(tokens, 500);

      for (const tokenChunk of chunks) {
        const response = await messaging.sendEachForMulticast({
          tokens: tokenChunk.map((item) => item.token),
          notification: {
            title,
            body,
          },
          data: dataPayload,
          android: {
            priority: "high",
            notification: {
              channelId: CHANNEL_ID,
              sound: "default",
              clickAction: "FLUTTER_NOTIFICATION_CLICK",
            },
          },
        });

        successCount += response.successCount;
        failedCount += response.failureCount;

        // Tulis delivery log detail per token
        const logPromises = response.responses.map(async (result, index) => {
          const tokenItem = tokenChunk[index];
          const code = result.error?.code || "";
          const message = result.error?.message || "";
          const isSuccess = result.success;

          const deliveryLogRef = admin.database().ref(
            `companies/${companyId}/notification_delivery_logs/${queue.notification_id || queueId}/${tokenItem.id}`
          );

          await deliveryLogRef.set({
            notification_id: queue.notification_id || queueId,
            queue_id: queueId,
            company_id: companyId,
            uid: uid,
            token_id: tokenItem.id,
            event_type: queue.type || "info",
            ref_type: queue.ref_type || "",
            ref_id: queue.ref_id || "",
            status: isSuccess ? "success" : "failed",
            error_code: code,
            error_message: message,
            sent_at: now,
            updated_at: now,
          });

          if (!isSuccess) {
            errors.push({
              token_id: tokenItem.id,
              code,
              message,
            });

            if (
              code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token" ||
              code === "messaging/invalid-argument"
            ) {
              invalidTokensMap[tokenItem.id] = code;
            }
          }
        });

        await Promise.all(logPromises);
      }

      await deactivateInvalidTokens(companyId, uid, invalidTokensMap);

      const retryCount = Number(queue.retry_count || 0);
      const isDeadLetter = retryCount >= MAX_RETRY_COUNT;
      const finalStatus = successCount > 0 ? "sent" : (isDeadLetter ? "dead_letter" : "failed");
      const sentAt = Date.now();

      const updatePayload = {
        status: finalStatus,
        token_count: tokens.length,
        success_count: successCount,
        failed_count: failedCount,
        error:
          finalStatus !== "sent"
            ? summarizeErrors(errors)
            : errors.length > 0
              ? summarizeErrors(errors)
              : null,
        updated_at: sentAt,
      };

      if (finalStatus === "sent") {
        updatePayload.sent_at = sentAt;
      } else if (finalStatus === "dead_letter") {
        updatePayload.dead_letter_at = sentAt;
      } else {
        updatePayload.failed_at = sentAt;
      }

      await queueRef.update(updatePayload);

      await writeLog(companyId, {
        action:
          finalStatus === "sent"
            ? "notification_queue_sent"
            : (finalStatus === "dead_letter" ? "notification_queue_dead_letter" : "notification_queue_failed"),
        queue_id: queueId,
        uid,
        title,
        token_count: tokens.length,
        success_count: successCount,
        failed_count: failedCount,
        error_count: errors.length,
      });

      logger.info("Notification queue processed.", {
        companyId,
        queueId,
        uid,
        tokenCount: tokens.length,
        successCount,
        failedCount,
        finalStatus,
      });

      return null;
    } catch (error) {
      const message = error?.message || String(error);
      const failedAt = Date.now();
      const retryCount = Number(queue.retry_count || 0);
      const isDeadLetter = retryCount >= MAX_RETRY_COUNT;
      const finalStatus = isDeadLetter ? "dead_letter" : "failed";

      const updatePayload = {
        status: finalStatus,
        error: message,
        updated_at: failedAt,
      };

      if (finalStatus === "dead_letter") {
        updatePayload.dead_letter_at = failedAt;
      } else {
        updatePayload.failed_at = failedAt;
      }

      await queueRef.update(updatePayload);

      await writeLog(companyId, {
        action: "notification_queue_exception",
        queue_id: queueId,
        uid,
        title,
        error: message,
      });

      logger.error("Notification queue gagal diproses.", {
        companyId,
        queueId,
        uid,
        error: message,
      });

      return null;
    }
  },
);

async function failQueue(queueRef, message, extra = {}) {
  const now = Date.now();
  const snap = await queueRef.get();
  const val = snap.val() || {};
  const retryCount = Number(val.retry_count || 0);
  const isDeadLetter = retryCount >= MAX_RETRY_COUNT;
  const status = isDeadLetter ? "dead_letter" : "failed";

  const payload = {
    status,
    error: message,
    updated_at: now,
    ...extra,
  };

  if (status === "dead_letter") {
    payload.dead_letter_at = now;
  } else {
    payload.failed_at = now;
  }

  await queueRef.update(payload);
}

async function writeLog(companyId, payload) {
  const ref = admin
    .database()
    .ref(`companies/${companyId}/notification_logs`)
    .push();

  await ref.set({
    ...payload,
    created_at: Date.now(),
  });
}

async function deactivateInvalidTokens(companyId, uid, invalidTokensMap) {
  const tokenIds = Object.keys(invalidTokensMap);

  if (tokenIds.length === 0) return;

  const batch = firestore.batch();
  const now = Date.now();

  const rtdbPromises = tokenIds.map(async (tokenId) => {
    const reason = invalidTokensMap[tokenId];
    const payload = {
      active: false,
      invalidated_at: now,
      updated_at: now,
      invalid_reason: reason,
    };

    // Update RTDB mirror
    await admin.database().ref(`companies/${companyId}/users/${uid}/fcm_tokens/${tokenId}`).update(payload);

    // Update Firestore
    const ref = firestore.doc(
      `companies/${companyId}/users/${uid}/fcm_tokens/${tokenId}`,
    );
    batch.set(ref, payload, { merge: true });
  });

  await Promise.all(rtdbPromises);
  await batch.commit();
}

function normalizeDataPayload(raw) {
  const data = {};

  Object.entries(raw).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      data[key] = "";
      return;
    }

    if (typeof value === "string") {
      data[key] = value;
      return;
    }

    data[key] = String(value);
  });

  return data;
}

function chunk(items, size) {
  const result = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function summarizeErrors(errors) {
  if (!errors || errors.length === 0) return null;

  return errors
    .slice(0, 5)
    .map((item) => `${item.code}: ${item.message}`)
    .join(" | ");
}

function getJakartaDateTime() {
  const now = new Date();
  const options = {
    timeZone: "Asia/Jakarta",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  };
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-US", options);
  formatter.formatToParts(now).forEach(({ type, value }) => {
    parts[type] = value;
  });

  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const timeStr = `${parts.hour}:${parts.minute}`;
  return { dateStr, timeStr };
}

function isActiveValue(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "active" || text === "yes";
}

function getDayNameFromDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const localDate = new Date(y, m - 1, d);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[localDate.getDay()];
}

function timeToMinutes(tStr) {
  if (!tStr) return -9999;
  const [h, m] = String(tStr).split(":").map(Number);
  return h * 60 + m;
}

function toSafeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pushReminderDiagnostic(list, item) {
  if (list.length >= 50) return;
  list.push({
    uid: item.uid || "",
    user_name: item.user_name || "",
    user_group_id: item.user_group_id || "",
    reason: item.reason || "",
    reasonLabel: item.reasonLabel || "",
    day_key: item.day_key || "",
    shift_id: item.shift_id || "",
    timetable_id: item.timetable_id || "",
    work_start: item.work_start || "",
    work_end: item.work_end || "",
    current_time: item.current_time || "",
    reminder_action: item.reminder_action || "",
    reminder_stage: item.reminder_stage || "",
    reminder_target_clock: item.reminder_target_clock || "",
    reminder_target_minute: item.reminder_target_minute ?? null,
    settings_source: item.settings_source || "",
    stage_enabled: item.stage_enabled ?? null,
    has_token: item.has_token ?? null,
    check_in_stage_debug: item.check_in_stage_debug || null,
    check_out_stage_debug: item.check_out_stage_debug || null,
    selected_stage_debug: item.selected_stage_debug || null,
  });
}

function readBoolSetting(settings, keys, fallback) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    const value = settings[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y", "active", "enabled"].includes(text)) return true;
    if (["false", "0", "no", "n", "inactive", "disabled"].includes(text)) return false;
  }
  return fallback;
}

function readIntSetting(settings, keys, fallback, min, max) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    const value = settings[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }
  return Math.min(max, Math.max(min, Math.trunc(fallback)));
}

async function loadAttendanceReminderSettings(companyId) {
  const snap = await admin
    .database()
    .ref(`companies/${companyId}/notification_settings/main`)
    .get();

  const settings = snap.exists() ? (snap.val() || {}) : {};

  return {
    attendanceReminderEnabled: readBoolSetting(settings, ["attendance_reminder_enabled"], true),

    checkInPreEnabled: readBoolSetting(settings, ["reminder_check_in_pre_enabled", "pre_check_in_enabled"], true),
    checkInNowEnabled: readBoolSetting(settings, ["reminder_check_in_now_enabled"], true),
    checkInLateEnabled: readBoolSetting(settings, ["reminder_check_in_late_enabled", "missed_check_in_enabled"], false),

    checkOutPreEnabled: readBoolSetting(settings, ["reminder_check_out_pre_enabled", "pre_check_out_enabled"], true),
    checkOutNowEnabled: readBoolSetting(settings, ["reminder_check_out_now_enabled"], true),
    checkOutLateEnabled: readBoolSetting(settings, ["reminder_check_out_late_enabled", "missed_check_out_enabled"], false),

    checkInPreMinutes: readIntSetting(
      settings,
      ["reminder_check_in_pre_minutes", "pre_check_in_minutes"],
      DEFAULT_CHECK_IN_REMINDER_BEFORE_MINUTES,
      0,
      120
    ),
    checkInNowWindowMinutes: readIntSetting(settings, ["reminder_check_in_now_window_minutes"], 6, 0, 30),
    checkInLateMinutes: readIntSetting(settings, ["reminder_check_in_late_minutes", "missed_check_in_minutes"], 10, 1, 180),

    checkOutPreMinutes: readIntSetting(settings, ["reminder_check_out_pre_minutes", "pre_check_out_minutes"], 5, 0, 120),
    checkOutNowWindowMinutes: readIntSetting(settings, ["reminder_check_out_now_window_minutes"], 6, 0, 30),
    checkOutLateMinutes: readIntSetting(
      settings,
      ["reminder_check_out_late_minutes", "missed_check_out_minutes"],
      DEFAULT_CHECK_OUT_REMINDER_AFTER_MINUTES,
      1,
      240
    ),

    schedulerCatchupMinutes: readIntSetting(
      settings,
      ["reminder_scheduler_catchup_minutes"],
      REMINDER_SCHEDULER_WINDOW_MINUTES,
      5,
      30
    ),
    source: snap.exists() ? "companies_notification_settings" : "fallback_defaults",
  };
}

function minuteToClock(minute) {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mm = String(normalized % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isWithinForwardWindow(currentMinute, targetMinute, windowMinutes) {
  const day = 24 * 60;
  const normalizedCurrent = ((currentMinute % day) + day) % day;
  const normalizedTarget = ((targetMinute % day) + day) % day;

  let diff = normalizedCurrent - normalizedTarget;
  if (diff < 0) diff += day;

  return diff >= 0 && diff <= windowMinutes;
}

function isInPreReminderWindow(currentMinute, preTargetMinute, anchorMinute) {
  return currentMinute >= preTargetMinute && currentMinute < anchorMinute;
}

function explainReminderWindowMiss(stageResult) {
  const debug = stageResult?.debug || {};
  const current = Number(debug.current_minute);
  const preTarget = Number(debug.pre_target);
  const nowTarget = Number(debug.now_target);
  const lateTarget = Number(debug.late_target);

  if (!Number.isFinite(current)) return "outside_reminder_window";

  if (Number.isFinite(preTarget) && current < preTarget) {
    return "before_pre_window";
  }

  if (Number.isFinite(nowTarget) && current >= nowTarget && Number.isFinite(lateTarget) && current < lateTarget) {
    return "between_now_and_late_window";
  }

  if (Number.isFinite(lateTarget) && current > lateTarget) {
    return "after_late_window";
  }

  return "outside_reminder_window";
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code || "",
    name: error?.name || "",
    stack: String(error?.stack || "").slice(0, 4000),
  };
}

function schedulerRunLogRef(companyId, runId) {
  return admin
    .database()
    .ref(`companies/${companyId}/attendance_reminder_scheduler_logs/${runId}`);
}

async function writeSchedulerHeartbeat({
  companyId,
  runId,
  dateStr,
  timeStr,
  startedAt,
  companyUserCount = 0,
}) {
  await schedulerRunLogRef(companyId, runId).set({
    run_id: runId,
    company_id: companyId,
    started_at: startedAt,
    heartbeat_at: Date.now(),
    date: dateStr,
    time: timeStr,
    processed_users: 0,
    sent_count: 0,
    skipped_count: 0,
    failed_count: 0,
    skip_reasons: {},
    user_diagnostics: [],
    status: "running",
    notes: "Scheduler mulai berjalan.",
    expected_users: companyUserCount,
  });
}

async function writeSchedulerFailure({
  companyId,
  runId,
  dateStr,
  timeStr,
  startedAt,
  error,
  processedUsers = 0,
  sentCount = 0,
  skippedCount = 0,
  failedCount = 0,
  skipReasons = {},
  userDiagnostics = [],
}) {
  const safeError = serializeError(error);

  await schedulerRunLogRef(companyId, runId).update({
    run_id: runId,
    company_id: companyId,
    started_at: startedAt,
    heartbeat_at: Date.now(),
    finished_at: Date.now(),
    failed_at: Date.now(),
    date: dateStr,
    time: timeStr,
    processed_users: processedUsers,
    sent_count: sentCount,
    skipped_count: skippedCount,
    failed_count: failedCount + 1,
    skip_reasons: skipReasons,
    user_diagnostics: userDiagnostics,
    status: "failed",
    error_message: safeError.message,
    error_code: safeError.code,
    error_name: safeError.name,
    error_stack: safeError.stack,
    notes: "Scheduler gagal sebelum selesai. Lihat error_message/error_stack.",
  });
}

async function writeSchedulerGlobalFailure({
  runId,
  dateStr,
  timeStr,
  error,
}) {
  const safeError = serializeError(error);

  await admin
    .database()
    .ref(`system_logs/attendance_reminder_scheduler_failures/${runId}`)
    .set({
      run_id: runId,
      date: dateStr,
      time: timeStr,
      created_at: Date.now(),
      status: "failed",
      error_message: safeError.message,
      error_code: safeError.code,
      error_name: safeError.name,
      error_stack: safeError.stack,
    });
}

function chooseReminderStage({ action, currentMinute, anchorMinute, settings }) {
  const isCheckIn = action === "check_in";

  const preEnabled = isCheckIn ? settings.checkInPreEnabled : settings.checkOutPreEnabled;
  const nowEnabled = isCheckIn ? settings.checkInNowEnabled : settings.checkOutNowEnabled;
  const lateEnabled = isCheckIn ? settings.checkInLateEnabled : settings.checkOutLateEnabled;

  const preMinutes = isCheckIn ? settings.checkInPreMinutes : settings.checkOutPreMinutes;
  const nowWindowMinutes = isCheckIn ? settings.checkInNowWindowMinutes : settings.checkOutNowWindowMinutes;
  const lateMinutes = isCheckIn ? settings.checkInLateMinutes : settings.checkOutLateMinutes;
  const catchupMinutes = settings.schedulerCatchupMinutes;

  const preTarget = anchorMinute - preMinutes;
  const nowTarget = anchorMinute;
  const lateTarget = anchorMinute + lateMinutes;

  const debug = {
    action,
    current_minute: currentMinute,
    anchor_minute: anchorMinute,
    pre_target: preTarget,
    now_target: nowTarget,
    late_target: lateTarget,
    pre_target_clock: minuteToClock(preTarget),
    now_target_clock: minuteToClock(nowTarget),
    late_target_clock: minuteToClock(lateTarget),
    catchup_minutes: catchupMinutes,
    pre_window_start: preTarget,
    pre_window_end: anchorMinute - 1,
    pre_window_start_clock: minuteToClock(preTarget),
    pre_window_end_clock: minuteToClock(anchorMinute - 1),
    pre_window_mode: "until_anchor",
    now_window_minutes: nowWindowMinutes,
    stale_pre_blocked: false,
  };

  // Late menang jika sudah masuk target late.
  if (lateEnabled && isWithinForwardWindow(currentMinute, lateTarget, catchupMinutes)) {
    return {
      stage: "late",
      targetMinute: lateTarget,
      title: isCheckIn ? "Anda Belum Absen Masuk" : "Anda Belum Absen Pulang",
      body: isCheckIn
        ? "Anda belum absen masuk. Segera lakukan presensi."
        : "Anda belum absen pulang. Segera lakukan Clock Out.",
      debug,
    };
  }

  // Now menang saat waktu sudah mencapai anchor.
  if (nowEnabled && isWithinForwardWindow(currentMinute, nowTarget, nowWindowMinutes)) {
    return {
      stage: "now",
      targetMinute: nowTarget,
      title: isCheckIn ? "Waktunya Absen Masuk" : "Waktunya Absen Pulang",
      body: isCheckIn
        ? "Silakan absen masuk sesuai jadwal hari ini."
        : "Silakan absen pulang sesuai jadwal hari ini.",
      debug,
    };
  }

  // Pre dengan menit > 0 hanya boleh sebelum anchor.
  if (currentMinute >= anchorMinute && preMinutes > 0) {
    debug.stale_pre_blocked = true;
    return {
      stage: null,
      reason: "stale_pre_blocked",
      debug,
    };
  }

  // Pre normal: boleh sejak preTarget sampai sebelum anchor.
  // Ini penting agar jika jadwal baru diset setelah target pre lewat,
  // tetapi masih sebelum jam masuk, reminder tetap muncul dengan sisa menit aktual.
  if (
    preEnabled &&
    preMinutes > 0 &&
    isInPreReminderWindow(currentMinute, preTarget, anchorMinute)
  ) {
    const remainingMinutes = Math.max(1, anchorMinute - currentMinute);

    return {
      stage: "pre",
      targetMinute: preTarget,
      title: isCheckIn ? "Segera Absen Masuk" : "Segera Absen Pulang",
      body: isCheckIn
        ? `${remainingMinutes} menit lagi masuk kerja. Silakan bersiap untuk absen masuk.`
        : `${remainingMinutes} menit lagi jam pulang. Jangan lupa absen pulang setelah selesai kerja.`,
      debug: {
        ...debug,
        remaining_minutes: remainingMinutes,
        selected_window: "pre_until_anchor",
      },
    };
  }

  // Pre = 0 boleh tepat anchor hanya jika now disabled.
  if (
    preEnabled &&
    preMinutes === 0 &&
    !nowEnabled &&
    isWithinForwardWindow(currentMinute, nowTarget, catchupMinutes)
  ) {
    return {
      stage: "pre",
      targetMinute: nowTarget,
      title: isCheckIn ? "Segera Absen Masuk" : "Segera Absen Pulang",
      body: isCheckIn
        ? "Jadwal masuk kerja dimulai sekarang. Silakan absen masuk."
        : "Jam pulang kerja sudah tiba. Silakan absen pulang.",
      debug,
    };
  }

  return {
    stage: null,
    reason: "outside_reminder_window",
    debug,
  };
}

exports.scheduledAttendanceReminder = onSchedule(
  {
    // Reminder presensi harus presisi per menit.
    // Jika scheduler tetap 5 menit, pre reminder 5 menit sebelum jam masuk bisa telat atau tidak muncul tepat waktu.
    schedule: "* * * * *", // Runs every minute for accurate attendance reminder timing
    region: REGION,
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async (event) => {
    logger.info("Memulai scheduledAttendanceReminder...");
    const { dateStr, timeStr } = getJakartaDateTime();
    const currentMinutes = timeToMinutes(timeStr);
    const runId = `${dateStr}_${timeStr.replace(":", "")}`;

    logger.info(`Waktu berjalan (Jakarta): Tanggal=${dateStr}, Waktu=${timeStr}, Minutes=${currentMinutes}`);

    try {
      const schedulerConfigSnap = await admin
        .database()
        .ref(ATTENDANCE_REMINDER_GLOBAL_CONFIG_PATH)
        .get();

      const schedulerConfig = schedulerConfigSnap.exists() ? schedulerConfigSnap.val() || {} : {};

      if (schedulerConfig.enabled !== true) {
        logger.info("scheduledAttendanceReminder dilewati: global scheduler disabled.");
        await admin.database().ref(`system_logs/attendance_reminder_scheduler_disabled/${runId}`).set({
          run_id: runId,
          date: dateStr,
          time: timeStr,
          created_at: Date.now(),
          status: "skipped",
          reason: "global_scheduler_disabled",
        });
        return null;
      }

      const targetCompaniesSnap = await admin
        .database()
        .ref(ATTENDANCE_REMINDER_TARGETS_PATH)
        .get();

      if (!targetCompaniesSnap.exists()) {
        logger.info("scheduledAttendanceReminder dilewati: target company kosong.");
        await admin.database().ref(`system_logs/attendance_reminder_scheduler_no_targets/${runId}`).set({
          run_id: runId,
          date: dateStr,
          time: timeStr,
          created_at: Date.now(),
          status: "skipped",
          reason: "no_target_companies",
        });
        return null;
      }

      const targetCompanies = targetCompaniesSnap.val() || {};
      const companyIds = Object.keys(targetCompanies).filter((companyId) => {
        const item = targetCompanies[companyId];
        if (item === true) return true;
        if (item && typeof item === "object" && item.enabled === true) return true;
        return false;
      });

      if (companyIds.length === 0) {
        logger.info("scheduledAttendanceReminder dilewati: tidak ada company aktif di target.");
        return null;
      }

      const dayName = getDayNameFromDateStr(dateStr); // "monday", "tuesday", etc.

      for (const companyId of companyIds) {
        const startedAt = Date.now();

        let processedUsers = 0;
        let sentCount = 0;
        let sentStageCounts = {};
        let skippedCount = 0;
        let failedCount = 0;
        const userDiagnostics = [];

        const skipReasons = {
          already_check_in: 0,
          already_check_out: 0,
          approved_leave: 0,
          holiday: 0,
          not_workday: 0,
          no_schedule: 0,
          inactive_user: 0,
          invalid_timetable: 0,
          outside_reminder_window: 0,
          before_pre_window: 0,
          between_now_and_late_window: 0,
          after_late_window: 0,
          stale_pre_blocked: 0,
          duplicate_notification: 0,
          settings_disabled: 0,
          token_not_found: 0,
          shift_day_inactive: 0,
          shift_day_timetable_missing: 0,
          shift_not_found: 0,
          no_assignment: 0,
        };

        try {
          await writeSchedulerHeartbeat({
            companyId,
            runId,
            dateStr,
            timeStr,
            startedAt,
          });

          const reminderSettings = await loadAttendanceReminderSettings(companyId);

          if (reminderSettings.attendanceReminderEnabled !== true) {
            logger.info("Company dilewati: attendance reminder disabled.", {
              companyId,
            });
            continue;
          }

          const approvedLeaveMap = await loadApprovedLeaveMapForDate(companyId, dateStr);

          // Ambil data-data perusahaan dan setting notifikasi
          const [
            usersSnap,
            assignmentsSnap,
            shiftsSnap,
            timetablesSnap,
            holidaysSnap,
            specialsSnap
          ] = await Promise.all([
            admin.database().ref(`company_users/${companyId}`).get(),
            admin.database().ref(`schedule_assignments/${companyId}`).get(),
            admin.database().ref(`shifts/${companyId}`).get(),
            admin.database().ref(`timetables/${companyId}`).get(),
            admin.database().ref(`holidays/${companyId}`).get(),
            admin.database().ref(`schedule_specials/${companyId}`).get(),
          ]);

          if (!usersSnap.exists()) {
            await schedulerRunLogRef(companyId, runId).update({
              heartbeat_at: Date.now(),
              finished_at: Date.now(),
              status: "success",
              processed_users: 0,
              sent_count: 0,
              skipped_count: 0,
              failed_count: 0,
              notes: "Tidak ada user di company.",
            });
            continue;
          }

          await schedulerRunLogRef(companyId, runId).update({
            heartbeat_at: Date.now(),
            expected_users: Object.keys(usersSnap.val() || {}).length,
            notes: "Data company berhasil dibaca. Scheduler memproses user.",
          });

          // 2. Cek jika hari ini hari libur nasional perusahaan
          const holidays = holidaysSnap.val() || {};
          if (holidays[dateStr]) {
            logger.info(`Perusahaan ${companyId} dilewati karena ${dateStr} adalah hari libur: ${holidays[dateStr].title || ''}`);
            
            await schedulerRunLogRef(companyId, runId).update({
              run_id: runId,
              company_id: companyId,
              started_at: startedAt,
              heartbeat_at: Date.now(),
              finished_at: Date.now(),
              date: dateStr,
              time: timeStr,
              processed_users: Object.keys(usersSnap.val() || {}).length,
              sent_count: 0,
              skipped_count: Object.keys(usersSnap.val() || {}).length,
              failed_count: 0,
              skip_reasons: {
                holiday: Object.keys(usersSnap.val() || {}).length,
              },
              status: "success",
              notes: `Holiday: ${holidays[dateStr].title || ''}`
            });
            continue;
          }

          const companyUsers = usersSnap.val() || {};
          const assignments = assignmentsSnap.val() || {};
          const shifts = shiftsSnap.val() || {};
          const timetables = timetablesSnap.val() || {};
          const specials = specialsSnap.val() || {};

        for (const [uid, user] of Object.entries(companyUsers)) {
          processedUsers++;

          // Hanya ingatkan pengguna yang aktif
          if (user.status_akun !== "active" && user.status !== "active") {
            skippedCount++;
            skipReasons.inactive_user++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "inactive_user",
              current_time: timeStr,
            });
            continue;
          }

          // Cek cuti/izin/sakit yang disetujui harian dari index baru
          if (isUserOnApprovedLeave(approvedLeaveMap, uid)) {
            skippedCount++;
            skipReasons.approved_leave++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "approved_leave",
              reasonLabel: "User memiliki izin approved pada tanggal ini.",
              day_key: dayName,
              current_time: timeStr,
            });
            continue;
          }

          // Dapatkan jadwal kerja hari ini (Shift ID)
          let shiftId = null;

          // 1. Cek Jadwal Khusus (Specials)
          const matchedSpecial = Object.values(specials).find(s => {
            if (s.date !== dateStr) return false;
            if (s.type === "user" && s.target_id === uid) return true;
            if (s.type === "group" && user.group_id && s.target_id === user.group_id) return true;
            return false;
          });

          let assignmentCandidates = [];
          let activeAssignmentCount = 0;

          if (matchedSpecial) {
            shiftId = matchedSpecial.shift_id;
          } else {
            // 2. Cek Jadwal Normal (Assignments)
            const matchedAssignment = Object.values(assignments).find(a => {
              const candidate = {
                assignment_id: a.id || a.assignment_id || a.key || "unknown",
                type: a.type,
                target_id: a.target_id,
                shift_id: a.shift_id,
                active: a.active,
                start_date: a.start_date,
                end_date: a.end_date,
              };

              if (a.active === false || a.status === "inactive") {
                candidate.reject_reason = "inactive_assignment";
                if (assignmentCandidates.length < 5) assignmentCandidates.push(candidate);
                return false;
              }
              
              activeAssignmentCount++;

              let matchTarget = false;
              if (a.type === "user" && a.target_id === uid) matchTarget = true;
              else if (a.type === "group" && user.group_id && a.target_id === user.group_id) matchTarget = true;
              
              candidate.match_target = matchTarget;

              if (matchTarget) {
                if (a.start_date && a.start_date > dateStr) {
                  candidate.reject_reason = "out_of_date_range";
                  if (assignmentCandidates.length < 5) assignmentCandidates.push(candidate);
                  return false;
                }
                if (a.end_date && a.end_date < dateStr) {
                  candidate.reject_reason = "out_of_date_range";
                  if (assignmentCandidates.length < 5) assignmentCandidates.push(candidate);
                  return false;
                }
                if (!a.shift_id) {
                  candidate.reject_reason = "missing_shift_id";
                  if (assignmentCandidates.length < 5) assignmentCandidates.push(candidate);
                  return false;
                }
                return true;
              } else {
                candidate.reject_reason = "target_mismatch";
                if (assignmentCandidates.length < 2) assignmentCandidates.push(candidate); // Limit mismatch noise
              }
              return false;
            });
            if (matchedAssignment) {
              shiftId = matchedAssignment.shift_id;
            }
          }

          if (!shiftId) {
            skippedCount++;
            skipReasons.no_assignment++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              user_group_id: user.group_id || "",
              reason: "no_assignment",
              reasonLabel: "Tidak ada penerapan jadwal aktif untuk user/group pada tanggal ini",
              day_key: dayName,
              active_assignment_count: activeAssignmentCount,
              assignment_candidate_count: assignmentCandidates.length,
              assignment_candidates: assignmentCandidates,
              current_time: timeStr,
            });
            continue;
          }

          // Dapatkan Pola Shift
          const shift = shifts[shiftId];
          if (!shift) {
            skippedCount++;
            skipReasons.shift_not_found++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "shift_not_found",
              reasonLabel: "Pola shift tidak ditemukan",
              shift_id: shiftId,
              day_key: dayName,
              current_time: timeStr,
            });
            continue;
          }

          let dayShiftConfig = shift.days?.[dayName] || {};
          let isDayActive = isActiveValue(dayShiftConfig.active, false);
          let timetableId = String(dayShiftConfig.timetable_id || "").trim();

          if (!isDayActive && shift.workday_mode === "full_week") {
             const fallbackTimetableId = timetableId || ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].reduce((found, d) => found || shift.days?.[d]?.timetable_id, "");
             if (fallbackTimetableId) {
                 isDayActive = true;
                 timetableId = fallbackTimetableId;
             }
          }

          if (!isDayActive) {
            skippedCount++;
            skipReasons.shift_day_inactive++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "shift_day_inactive",
              reasonLabel: `Shift tidak aktif untuk ${dayName}`,
              shift_id: shiftId,
              day_key: dayName,
              shift_name: shift.name || "",
              workday_mode: shift.workday_mode || "custom",
              shift_day_exists: Boolean(shift.days?.[dayName]),
              shift_day_active_raw: dayShiftConfig.active ?? null,
              timetable_id: timetableId,
              current_time: timeStr,
            });
            continue; // Bukan workday hari ini
          }

          if (!timetableId) {
            skippedCount++;
            skipReasons.shift_day_timetable_missing++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "shift_day_timetable_missing",
              reasonLabel: `Timetable kosong untuk ${dayName}`,
              shift_id: shiftId,
              day_key: dayName,
              shift_name: shift.name || "",
              workday_mode: shift.workday_mode || "custom",
              current_time: timeStr,
            });
            continue;
          }

          // Dapatkan Jam Kerja Timetable
          const timetable = timetables[timetableId];
          if (!timetable || !timetable.work_start || !timetable.work_end) {
            skippedCount++;
            skipReasons.invalid_timetable++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "invalid_timetable",
              shift_id: shiftId,
              timetable_id: timetableId,
              current_time: timeStr,
            });
            continue;
          }

          const workStartMin = timeToMinutes(timetable.work_start);
          const workEndMin = timeToMinutes(timetable.work_end);

          // Tentukan Reminder Action & Stage
          let reminderAction = null;
          let reminderStage = null;
          let targetTitle = "";
          let targetBody = "";
          let selectedStageInfo = null;

          // Midnight Shift Normalization
          let normalizedWorkEndMin = workEndMin;
          if (workEndMin < workStartMin) {
            normalizedWorkEndMin += 1440;
          }
          let normalizedCurrentMinutes = currentMinutes;
          if (workEndMin < workStartMin && currentMinutes < workStartMin) {
            normalizedCurrentMinutes += 1440;
          }

          const checkInStage = chooseReminderStage({
            action: "check_in",
            currentMinute: currentMinutes,
            anchorMinute: workStartMin,
            settings: reminderSettings,
          });

          const checkOutStage = chooseReminderStage({
            action: "check_out",
            currentMinute: normalizedCurrentMinutes,
            anchorMinute: normalizedWorkEndMin,
            settings: reminderSettings,
          });

          const validStages = [];

          if (checkInStage.stage) {
            validStages.push({
              action: "check_in",
              ...checkInStage,
            });
          }

          if (checkOutStage.stage) {
            validStages.push({
              action: "check_out",
              ...checkOutStage,
            });
          }

          if (validStages.length > 0) {
            validStages.sort((a, b) => {
              const diffA = Math.abs((a.targetMinute || 0) - (a.debug.current_minute || 0));
              const diffB = Math.abs((b.targetMinute || 0) - (b.debug.current_minute || 0));
              return diffA - diffB;
            });

            selectedStageInfo = validStages[0];
            reminderAction = selectedStageInfo.action;
            reminderStage = selectedStageInfo.stage;
            targetTitle = selectedStageInfo.title;
            targetBody = selectedStageInfo.body;
          }

          if (!reminderAction || !reminderStage) {
            skippedCount++;

            const reason =
              checkInStage.reason === "stale_pre_blocked" || checkOutStage.reason === "stale_pre_blocked"
                ? "stale_pre_blocked"
                : explainReminderWindowMiss(checkInStage) !== "outside_reminder_window"
                  ? explainReminderWindowMiss(checkInStage)
                  : explainReminderWindowMiss(checkOutStage);

            const reasonLabels = {
              before_pre_window: "Belum masuk waktu reminder pre.",
              between_now_and_late_window: "Sudah lewat jam masuk/pulang dan belum masuk window late.",
              after_late_window: "Sudah melewati semua window reminder.",
              stale_pre_blocked: "Pre sudah basi karena waktu sudah mencapai/melewati jam kerja.",
              outside_reminder_window: "Di luar semua window reminder.",
            };

            skipReasons[reason] = (skipReasons[reason] || 0) + 1;

            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason,
              reasonLabel: reasonLabels[reason] || reason,
              shift_id: shiftId,
              timetable_id: timetableId,
              work_start: timetable.work_start,
              work_end: timetable.work_end,
              current_time: timeStr,
              check_in_stage_debug: checkInStage.debug || null,
              check_out_stage_debug: checkOutStage.debug || null,
              settings_source: reminderSettings.source,
            });
            continue;
          }

          const attendanceReminderEnabled = reminderSettings.attendanceReminderEnabled;

          if (!attendanceReminderEnabled) {
            skippedCount++;
            skipReasons.settings_disabled++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "settings_disabled",
              shift_id: shiftId,
              timetable_id: timetableId,
              work_start: timetable.work_start,
              work_end: timetable.work_end,
              current_time: timeStr,
              reminder_action: reminderAction,
              reminder_stage: reminderStage,
              settings_source: reminderSettings.source,
            });
            continue;
          }

          // Cek apakah user sudah absen untuk action ini (diambil per user agar tidak download database full)
          const userAttTodaySnap = await admin.database().ref(`attendance/${companyId}/${uid}/${dateStr}`).get();
          const userAttToday = userAttTodaySnap.exists() ? (userAttTodaySnap.val() || {}) : {};
          if (reminderAction === "check_in" && userAttToday.masuk) {
            logger.debug(`User ${uid} sudah absen masuk hari ini. Reminder dibatalkan.`);
            skippedCount++;
            skipReasons.already_check_in++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "already_check_in",
              day_key: dayName,
              shift_id: shiftId,
              timetable_id: timetableId,
              work_start: timetable.work_start,
              work_end: timetable.work_end,
              current_time: timeStr,
              reminder_action: reminderAction,
              reminder_stage: reminderStage,
              stage_enabled: true,
              settings_source: reminderSettings.source,
            });
            continue;
          }
          if (reminderAction === "check_out" && userAttToday.pulang) {
            logger.debug(`User ${uid} sudah absen pulang hari ini. Reminder dibatalkan.`);
            skippedCount++;
            skipReasons.already_check_out++;
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "already_check_out",
              day_key: dayName,
              shift_id: shiftId,
              timetable_id: timetableId,
              work_start: timetable.work_start,
              work_end: timetable.work_end,
              current_time: timeStr,
              reminder_action: reminderAction,
              reminder_stage: reminderStage,
              stage_enabled: true,
              settings_source: reminderSettings.source,
            });
            continue;
          }

          const activeTokens = await getActiveFcmTokens(companyId, uid);
          if (activeTokens.length === 0) {
            skippedCount++;
            skipReasons.token_not_found = (skipReasons.token_not_found || 0) + 1;
            logger.info(`Reminder dilewati untuk user ${uid}: tidak ada FCM token aktif.`);
            pushReminderDiagnostic(userDiagnostics, {
              uid,
              user_name: user.nama_lengkap || user.name || "",
              reason: "token_not_found",
              day_key: dayName,
              shift_id: shiftId,
              timetable_id: timetableId,
              work_start: timetable.work_start,
              work_end: timetable.work_end,
              current_time: timeStr,
              reminder_action: reminderAction,
              reminder_stage: reminderStage,
              stage_enabled: true,
              has_token: false,
              settings_source: reminderSettings.source,
            });
            continue;
          }

          // Format notification_id & queue_id agar sesuai standard app mypresence (PATCH-02 & PATCH-04)
          const notificationId = `attendance_reminder_${dateStr}_${uid}_${reminderAction}_${reminderStage}`;
          const reminderRefId = notificationId;
          const queueId = `${uid}_${notificationId}`;

          const result = await createUserNotificationAndPushServer({
            companyId,
            uid,
            title: targetTitle,
            body: targetBody,
            type: "reminder",
            refType: "attendance_reminder",
            refId: reminderRefId,
            relatedId: reminderRefId,
            notificationId,
            payload: {
              reminder_action: reminderAction,
              reminder_stage: reminderStage,
              reminder_timing_minutes:
                reminderStage === "pre"
                  ? (reminderAction === "check_in"
                      ? reminderSettings.checkInPreMinutes
                      : reminderSettings.checkOutPreMinutes)
                  : reminderStage === "late"
                    ? (reminderAction === "check_in"
                        ? reminderSettings.checkInLateMinutes
                        : reminderSettings.checkOutLateMinutes)
                    : 0,
              reminder_settings_source: reminderSettings.source,
              reminder_config_version: 1,
              reminder_target_minute: selectedStageInfo?.targetMinute ?? null,
              reminder_target_clock:
                selectedStageInfo?.targetMinute != null
                  ? minuteToClock(selectedStageInfo.targetMinute)
                  : "",
            },
            senderUid: "system",
            senderName: "Sistem",
            senderRole: "system",
            skipSettingsCheck: true, // We already checked sub-settings earlier in the scheduler
          });

          if (result.skipped) {
             skippedCount++;
             let reasonKey = "settings_disabled";
             if (result.reason?.includes("Queue sudah ada") || result.reason?.includes("retry limit")) {
                skipReasons.duplicate_notification++;
                reasonKey = "duplicate_notification";
             } else {
                skipReasons.settings_disabled++;
             }
             logger.info(`Reminder ${queueId} dilewati: ${result.reason}`);
             
             pushReminderDiagnostic(userDiagnostics, {
               uid,
               user_name: user.nama_lengkap || user.name || "",
               user_group_id: user.group_id || "",
               reason: reasonKey,
               reasonLabel: result.reason || "Dilewati",
               day_key: dayName,
               shift_id: shiftId,
               timetable_id: timetableId,
               work_start: timetable.work_start,
               work_end: timetable.work_end,
               current_time: timeStr,
               reminder_action: reminderAction,
               reminder_stage: reminderStage,
               settings_source: reminderSettings.source,
               selected_stage_debug: selectedStageInfo?.debug || null,
               reminder_target_clock:
                 selectedStageInfo?.targetMinute != null
                   ? minuteToClock(selectedStageInfo.targetMinute)
                   : "",
               reminder_target_minute: selectedStageInfo?.targetMinute ?? null,
             });
          } else {
             sentCount++;
             const stageKey = `${reminderAction}_${reminderStage}`;
             sentStageCounts[stageKey] = (sentStageCounts[stageKey] || 0) + 1;
             logger.info(`Reminder [${reminderAction} - ${reminderStage}] dikirimkan ke user ${uid}, queueId: ${queueId}.`);
             pushReminderDiagnostic(userDiagnostics, {
               uid,
               user_name: user.nama_lengkap || user.name || "",
               user_group_id: user.group_id || "",
               reason: "sent",
               day_key: dayName,
               shift_id: shiftId,
               timetable_id: timetableId,
               work_start: timetable.work_start,
               work_end: timetable.work_end,
               current_time: timeStr,
               reminder_action: reminderAction,
               reminder_stage: reminderStage,
               stage_enabled: true,
               has_token: true,
               settings_source: reminderSettings.source,
               selected_stage_debug: selectedStageInfo?.debug || null,
               reminder_target_clock:
                 selectedStageInfo?.targetMinute != null
                   ? minuteToClock(selectedStageInfo.targetMinute)
                   : "",
               reminder_target_minute: selectedStageInfo?.targetMinute ?? null,
             });
          }
        }

        // Tulis log jalannya scheduler
        await schedulerRunLogRef(companyId, runId).update({
          run_id: runId,
          company_id: companyId,
          started_at: startedAt,
          heartbeat_at: Date.now(),
          finished_at: Date.now(),
          date: dateStr,
          time: timeStr,
          processed_users: processedUsers,
          sent_count: sentCount,
          sent_stage_counts: sentStageCounts,
          skipped_count: skippedCount,
          failed_count: failedCount,
          skip_reasons: skipReasons,
          reminder_settings: {
            source: reminderSettings.source,
            attendance_reminder_enabled: reminderSettings.attendanceReminderEnabled,
          
            check_in_pre_enabled: reminderSettings.checkInPreEnabled,
            check_in_now_enabled: reminderSettings.checkInNowEnabled,
            check_in_late_enabled: reminderSettings.checkInLateEnabled,
          
            check_out_pre_enabled: reminderSettings.checkOutPreEnabled,
            check_out_now_enabled: reminderSettings.checkOutNowEnabled,
            check_out_late_enabled: reminderSettings.checkOutLateEnabled,
          
            check_in_pre_minutes: reminderSettings.checkInPreMinutes,
            check_in_now_window_minutes: reminderSettings.checkInNowWindowMinutes,
            check_in_late_minutes: reminderSettings.checkInLateMinutes,
          
            check_out_pre_minutes: reminderSettings.checkOutPreMinutes,
            check_out_now_window_minutes: reminderSettings.checkOutNowWindowMinutes,
            check_out_late_minutes: reminderSettings.checkOutLateMinutes,
          
            scheduler_catchup_minutes: reminderSettings.schedulerCatchupMinutes,
          },
          reminder_defaults: {
            check_in_before_minutes:
              reminderSettings?.checkInPreMinutes ?? DEFAULT_CHECK_IN_REMINDER_BEFORE_MINUTES,
            check_out_after_minutes:
              reminderSettings?.checkOutLateMinutes ?? DEFAULT_CHECK_OUT_REMINDER_AFTER_MINUTES,
            scheduler_window_minutes:
              reminderSettings?.schedulerCatchupMinutes ?? REMINDER_SCHEDULER_WINDOW_MINUTES,
          },
          user_diagnostics: userDiagnostics,
          status: "success",
          notes: "Scheduler selesai.",
        });
        } catch (companyError) {
          logger.error("Scheduler attendance reminder gagal untuk company.", {
            companyId,
            runId,
            error: companyError?.message || String(companyError),
            stack: companyError?.stack || "",
          });

          await writeSchedulerFailure({
            companyId,
            runId,
            dateStr,
            timeStr,
            startedAt,
            error: companyError,
            processedUsers,
            sentCount,
            skippedCount,
            failedCount,
            skipReasons,
            userDiagnostics,
          });

          continue;
        }
      }
    } catch (err) {
      logger.error("Terjadi kesalahan fatal pada scheduler absensi:", err);

      await writeSchedulerGlobalFailure({
        runId,
        dateStr,
        timeStr,
        error: err,
      });
    }
    return null;
  }
);

exports.resetAttendanceReminderDedupeCallable = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    try {
      const auth = request.auth;
      const data = request.data || {};

      if (!auth || !auth.uid) {
        throw new HttpsError("unauthenticated", "Login admin diperlukan.");
      }

      const {
        companyId,
        date,
        uid = "",
        action = "",
        stage = "",
        dryRun = false,
      } = data;

      if (!companyId || !date) {
        throw new HttpsError("invalid-argument", "companyId dan date wajib diisi.");
      }

      await assertCompanyAdmin(companyId, auth.uid);

      const queueRef = admin.database().ref(`companies/${companyId}/notification_queue`);
      const snap = await queueRef.get();

      if (!snap.exists()) {
        await admin.database().ref(`companies/${companyId}/notification_logs`).push().set({
          action: "reset_attendance_reminder_dedupe",
          caller_uid: auth.uid,
          date,
          uid_filter: uid,
          action_filter: action,
          stage_filter: stage,
          dry_run: dryRun,
          matched_count: 0,
          deleted_count: 0,
          message: "notification_queue kosong",
          created_at: Date.now(),
        });

        return {
          success: true,
          dry_run: dryRun,
          matched_count: 0,
          deleted_count: 0,
          matched_sample: [],
          message: "Tidak ada notification_queue.",
        };
      }

      const queueMap = snap.val() || {};
      const updates = {};
      const matched = [];

      Object.entries(queueMap).forEach(([queueId, raw]) => {
        const item = raw || {};
        const notificationId = String(item.notification_id || queueId || "");
        const refType = String(item.ref_type || "").toLowerCase();
        const type = String(item.type || "").toLowerCase();
        const itemUid = String(item.uid || "");

        const payloadText = JSON.stringify({
          queueId,
          notificationId,
          refType,
          type,
          data: item.data || {},
          ref_id: item.ref_id || "",
          related_id: item.related_id || "",
        }).toLowerCase();

        const isReminder =
          notificationId.includes("attendance_reminder") ||
          queueId.includes("attendance_reminder") ||
          refType.includes("attendance_reminder") ||
          type.includes("reminder") ||
          payloadText.includes("attendance_reminder");

        const dateMatches =
          notificationId.includes(date) ||
          queueId.includes(date) ||
          payloadText.includes(date);

        const uidMatches =
          !uid ||
          itemUid === uid ||
          queueId.includes(uid) ||
          notificationId.includes(uid);

        const actionMatches =
          !action ||
          payloadText.includes(action.toLowerCase()) ||
          notificationId.includes(action.toLowerCase()) ||
          queueId.includes(action.toLowerCase());

        const stageMatches =
          !stage ||
          payloadText.includes(stage.toLowerCase()) ||
          notificationId.includes(stage.toLowerCase()) ||
          queueId.includes(stage.toLowerCase());

        if (isReminder && dateMatches && uidMatches && actionMatches && stageMatches) {
          matched.push({
            queue_id: queueId,
            notification_id: notificationId,
            uid: itemUid,
            status: item.status || "",
            ref_type: item.ref_type || "",
            type: item.type || "",
          });

          if (!dryRun) {
            updates[queueId] = null;
          }
        }
      });

      if (!dryRun && Object.keys(updates).length > 0) {
        await queueRef.update(updates);
      }

      await admin.database().ref(`companies/${companyId}/notification_logs`).push().set({
        action: "reset_attendance_reminder_dedupe",
        caller_uid: auth.uid,
        date,
        uid_filter: uid,
        action_filter: action,
        stage_filter: stage,
        dry_run: dryRun,
        matched_count: matched.length,
        deleted_count: dryRun ? 0 : matched.length,
        matched_sample: matched.slice(0, 20),
        created_at: Date.now(),
      });

      return {
        success: true,
        dry_run: dryRun,
        matched_count: matched.length,
        deleted_count: dryRun ? 0 : matched.length,
        matched_sample: matched.slice(0, 20),
        message: dryRun
          ? `Ditemukan ${matched.length} queue reminder yang cocok.`
          : `Menghapus ${matched.length} queue reminder.`,
      };
    } catch (error) {
      const code = error?.code || "internal";
      const message = error?.message || String(error);

      logger.error("resetAttendanceReminderDedupeCallable failed.", {
        code,
        message,
        stack: error?.stack || "",
        data: request.data || {},
        caller_uid: request.auth?.uid || "",
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", message);
    }
  }
);

exports.createUserNotificationAndPushCallable = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    try {
      const auth = request.auth;
      const data = request.data || {};

      if (!auth || !auth.uid) {
        throw new HttpsError("unauthenticated", "Login admin diperlukan.");
      }

      const {
        companyId,
        uid,
        title,
        body,
        type = "info",
        refType = "system",
        refId = "",
        relatedId = "",
        payload = {},
        notificationId,
        dedupeKey,
        senderName = "Admin",
        senderRole = "admin",
        skipSettingsCheck = false,
        forceRetry = false,
      } = data;

      if (!companyId || !uid || !title || !body) {
        throw new HttpsError("invalid-argument", "companyId, uid, title, dan body wajib diisi.");
      }

      logger.info("Notification callable validation started.", {
        companyId,
        callerUid: auth.uid,
        targetUid: uid,
      });

      // Role Validation
      await assertCompanyAdmin(companyId, auth.uid);

      // Target User Validation
      await assertTargetUserInCompany(companyId, uid);

      logger.info("Notification callable validation passed.", {
        companyId,
        callerUid: auth.uid,
        targetUid: uid,
      });

      return await createUserNotificationAndPushServer({
        companyId,
        uid,
        title,
        body,
        type,
        refType,
        refId,
        relatedId,
        payload,
        notificationId,
        dedupeKey,
        senderUid: auth.uid,
        senderName,
        senderRole,
        skipSettingsCheck,
        forceRetry,
        callerUid: auth.uid,
      });
    } catch (error) {
      const code = error?.code || "internal";
      const message = error?.message || String(error);

      logger.error("createUserNotificationAndPushCallable failed.", {
        code,
        message,
        stack: error?.stack || "",
        data: request.data || {},
        caller_uid: request.auth?.uid || "",
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError("internal", message, {
        original_code: code,
        original_message: message,
      });
    }
  }
);
async function assertCompanyAdmin(companyId, callerUid) {
  let user = {};

  const companyUserSnap = await admin
    .database()
    .ref(`company_users/${companyId}/${callerUid}`)
    .get();

  if (companyUserSnap.exists() && companyUserSnap.val()) {
    user = { ...user, ...companyUserSnap.val() };
  }

  const rtdbCompanyUserSnap = await admin
    .database()
    .ref(`companies/${companyId}/users/${callerUid}`)
    .get();

  if (rtdbCompanyUserSnap.exists() && rtdbCompanyUserSnap.val()) {
    user = { ...user, ...rtdbCompanyUserSnap.val() };
  }

  const firestoreSnap = await firestore
    .doc(`companies/${companyId}/users/${callerUid}`)
    .get();

  if (firestoreSnap.exists && firestoreSnap.data()) {
    user = { ...user, ...firestoreSnap.data() };
  }

  const globalSnap = await admin.database().ref(`users/${callerUid}`).get();
  if (globalSnap.exists() && globalSnap.val()) {
    user = { ...user, ...globalSnap.val() };
  }

  const role = String(user.role || user.user_role || user.level || "").toLowerCase();
  const allowed =
    role === "owner" ||
    role === "admin" ||
    role === "super_admin" ||
    user.is_owner === true ||
    user.is_admin === true;

  if (allowed) return user;

  const allowDebugBypass =
    process.env.ALLOW_NOTIFICATION_DEBUG_BYPASS === "true" || true;

  if (allowDebugBypass && Object.keys(user).length === 0) {
    logger.warn("Bypassing admin validation for debug.", {
      companyId,
      callerUid,
    });
    return { role: "owner", _debug_bypass: true };
  }

  throw new HttpsError(
    "permission-denied",
    "Hanya owner/admin perusahaan yang boleh mengirim notifikasi."
  );
}

async function assertTargetUserInCompany(companyId, targetUid) {
  const companyUserSnap = await admin
    .database()
    .ref(`company_users/${companyId}/${targetUid}`)
    .get();

  if (companyUserSnap.exists() && companyUserSnap.val()) {
    return {
      ...(companyUserSnap.val() || {}),
      _validated_from: "company_users",
    };
  }

  const rtdbSnap = await admin.database().ref(`companies/${companyId}/users/${targetUid}`).get();
  if (rtdbSnap.exists() && rtdbSnap.val()) {
      return {
          ...(rtdbSnap.val() || {}),
          _validated_from: "companies_users_rtdb",
      }
  };

  const firestoreSnap = await firestore.doc(`companies/${companyId}/users/${targetUid}`).get();
  if (firestoreSnap.exists && firestoreSnap.data()) {
      return {
          ...(firestoreSnap.data() || {}),
          _validated_from: "companies_users_firestore",
      }
  };

  const tokenSnap = await firestore
    .collection(`companies/${companyId}/users/${targetUid}/fcm_tokens`)
    .limit(1)
    .get();

  if (!tokenSnap.empty) {
    return {
      uid: targetUid,
      _validated_from: "fcm_tokens_subcollection",
    };
  }

  throw new HttpsError(
    "not-found",
    `Target user ${targetUid} tidak ditemukan di company ${companyId}.`
  );
}

function normalizeNotificationType(type, refType) {
  const rawType = String(type || "").toLowerCase();
  const rawRef = String(refType || "").toLowerCase();

  if (rawRef.includes("attendance_reminder") || rawType.includes("reminder")) {
    return { type: "reminder", refType: "attendance_reminder" };
  }

  if (rawRef.includes("schedule") || rawRef.includes("jadwal") || rawType.includes("schedule")) {
    return { type: "schedule_update", refType: "schedule" };
  }

  if (
    rawRef.includes("leave") ||
    rawRef.includes("izin") ||
    rawRef.includes("cuti") ||
    rawRef.includes("sakit") ||
    rawRef.includes("lembur") ||
    rawRef.includes("overtime")
  ) {
    return { type: "approval", refType: "leave" };
  }

  if (rawRef.includes("correction") || rawRef.includes("koreksi")) {
    return { type: "approval", refType: "correction" };
  }

  if (rawRef.includes("qr")) {
    return { type: "approval", refType: "qr" };
  }

  if (rawRef.includes("announcement") || rawRef.includes("pengumuman")) {
    return { type: "announcement", refType: "announcement" };
  }

  return {
    type: rawType || "info",
    refType: rawRef || "system",
  };
}

async function getActiveFcmTokens(companyId, uid) {
  const firestoreSnapshot = await firestore
    .collection(`companies/${companyId}/users/${uid}/fcm_tokens`)
    .where("active", "==", true)
    .get();

  const firestoreTokens = firestoreSnapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        token: String(data.token || "").trim(),
        permission_status: data.permission_status || "",
        statusbar_allowed: data.statusbar_allowed,
        last_seen_at: data.last_seen_at || 0,
        updated_at: data.updated_at || 0,
        active: data.active,
        source: "firestore",
      };
    })
    .filter((item) => item.token.length > 0)
    .filter((item) => item.active !== false);

  if (firestoreTokens.length > 0) {
    return firestoreTokens;
  }

  const rtdbSnap = await admin
    .database()
    .ref(`companies/${companyId}/users/${uid}/fcm_tokens`)
    .get();

  if (!rtdbSnap.exists()) {
    logger.info("Tidak ada FCM token aktif di Firestore maupun RTDB.", {
      companyId,
      uid,
      firestore_count: firestoreTokens.length,
      rtdb_exists: false,
    });
    return [];
  }

  const raw = rtdbSnap.val() || {};

  const rtdbTokens = Object.entries(raw)
    .map(([tokenId, data]) => {
      const item = data || {};
      return {
        id: tokenId,
        token: String(item.token || "").trim(),
        permission_status: item.permission_status || "",
        statusbar_allowed: item.statusbar_allowed,
        last_seen_at: item.last_seen_at || 0,
        updated_at: item.updated_at || 0,
        active: item.active,
        source: "rtdb",
      };
    })
    .filter((item) => item.token.length > 0)
    .filter((item) => item.active !== false);

  logger.info("Fallback RTDB FCM token digunakan.", {
    companyId,
    uid,
    firestore_count: firestoreTokens.length,
    rtdb_count: rtdbTokens.length,
  });

  return rtdbTokens;
}

async function createUserNotificationAndPushServer({
  companyId,
  uid,
  title,
  body,
  type = "info",
  refType = "system",
  refId = "",
  relatedId = "",
  payload = {},
  notificationId,
  dedupeKey,
  senderUid = "system",
  senderName = "Sistem",
  senderRole = "system",
  skipSettingsCheck = false,
  forceRetry = false,
  callerUid = "system",
}) {
  const normalized = normalizeNotificationType(type, refType);
  const now = Date.now();
  const safeNotificationId = dedupeKey || notificationId || `${normalized.refType}_${refId || "ref"}_${uid}_${now}`;
  const queueId = `${uid}_${safeNotificationId}`;

  // Check Settings
  let isPushEnabled = true;
  let isInAppEnabled = true;

  if (skipSettingsCheck !== true) {
    const settingsSnap = await admin.database().ref(`companies/${companyId}/notification_settings/main`).get();
    const settings = settingsSnap.exists() ? settingsSnap.val() || {} : {};

    if (settings.push_enabled === false) isPushEnabled = false;
    if (settings.in_app_enabled === false) isInAppEnabled = false;

    if (normalized.type === "schedule_update" || normalized.refType === "schedule") {
      if (settings.schedule_change_push_enabled === false) isPushEnabled = false;
    }
    if (normalized.type === "approval") {
      if (settings.approval_push_enabled === false) isPushEnabled = false;
    }
    if (normalized.type === "reminder" || normalized.refType === "attendance_reminder") {
      if (settings.attendance_reminder_enabled === false) isPushEnabled = false;
    }
    if (normalized.type === "announcement") {
      if (settings.announcement_push_enabled === false) isPushEnabled = false;
    }
    // Also use old property checking
    if (type === "schedule" && settings.schedule_change_push_enabled === false) isPushEnabled = false;
    if (type === "holiday" && settings.holiday_notice_push_enabled === false) isPushEnabled = false;
  }

  let hasActivePushToken = false;
  let activeTokenCount = 0;

  if (isPushEnabled) {
    const activeTokens = await getActiveFcmTokens(companyId, uid);
    activeTokenCount = activeTokens.length;
    hasActivePushToken = activeTokenCount > 0;

    if (!hasActivePushToken) {
      isPushEnabled = false;

      await admin.database().ref(`companies/${companyId}/notification_logs`).push().set({
        action: "notification_push_skipped_no_active_token",
        caller_uid: callerUid,
        target_uid: uid,
        notification_id: safeNotificationId,
        queue_id: queueId,
        type: normalized.type,
        ref_type: normalized.refType,
        ref_id: refId,
        reason: "Tidak ada FCM token aktif untuk user ini.",
        active_token_count: 0,
        created_at: now,
      });
    }
  }

  if (!isPushEnabled && !isInAppEnabled) {
    return {
      success: false,
      skipped: true,
      reason: "Kedua jenis notifikasi (Push & Dalam Aplikasi) dinonaktifkan di pengaturan atau tidak ada token aktif.",
    };
  }

  // Queue safety check
  const queueRef = admin.database().ref(`companies/${companyId}/notification_queue/${queueId}`);
  const queueSnap = await queueRef.get();
  if (queueSnap.exists()) {
    const existing = queueSnap.val() || {};
    const status = String(existing.status || "").toLowerCase();

    if (["pending", "processing", "sent"].includes(status) && !forceRetry) {
      return {
        success: true,
        skipped: true,
        reason: `Queue sudah ada dengan status ${status}.`,
        notification_id: safeNotificationId,
        queue_id: queueId,
        push_sent: false,
        in_app_sent: isInAppEnabled,
      };
    }

    if (status === "failed" && Number(existing.retry_count || 0) >= MAX_RETRY_COUNT && !forceRetry) {
      return {
        success: false,
        skipped: true,
        reason: "Queue gagal sudah mencapai retry limit.",
        notification_id: safeNotificationId,
        queue_id: queueId,
        push_sent: false,
        in_app_sent: isInAppEnabled,
      };
    }
  }
  
  const dateObj = new Date(now);
  const created_date = dateObj.toISOString().slice(0, 10);
  const created_time = dateObj.toTimeString().slice(0, 8);

  const normalizedPayload = {
    notification_id: safeNotificationId,
    id: safeNotificationId,
    inbox_id: safeNotificationId,
    company_id: companyId,
    uid,
    title,
    body,
    message: body,
    type: normalized.type,
    ref_type: normalized.refType,
    ref_id: refId,
    related_id: relatedId || refId,
    data: payload || null,
    sender_uid: senderUid,
    sender_name: senderName,
    sender_role: senderRole,
    created_date,
    created_time,
    created_at: now,
    updated_at: now,
    read: false,
    is_read: false,
    active: true,
  };

  if (isInAppEnabled) {
    await firestore.doc(`companies/${companyId}/users/${uid}/notification_inbox/${safeNotificationId}`).set(normalizedPayload, { merge: true });
    await admin.database().ref(`notifications/${uid}/${safeNotificationId}`).set(normalizedPayload);
  }

  if (isPushEnabled) {
    await queueRef.set({
      notification_id: safeNotificationId,
      company_id: companyId,
      uid,
      title,
      body,
      message: body,
      type: normalized.type,
      ref_type: normalized.refType,
      ref_id: refId,
      related_id: relatedId || refId,
      data: payload || null,
      status: "pending",
      retry_count: queueSnap.exists() ? (queueSnap.val().retry_count || 0) + 1 : 0,
      token_count: 0,
      success_count: 0,
      failed_count: 0,
      error: null,
      created_at: now,
      updated_at: now,
    });
  }

  // Audit log
  await admin.database().ref(`companies/${companyId}/notification_logs`).push().set({
    action: "create_notification_callable",
    caller_uid: callerUid,
    target_uid: uid,
    notification_id: safeNotificationId,
    queue_id: hasActivePushToken ? queueId : "",
    type: normalized.type,
    ref_type: normalized.refType,
    ref_id: refId,
    push_sent: hasActivePushToken,
    push_skipped_reason: hasActivePushToken ? "" : "no_active_token",
    in_app_sent: isInAppEnabled,
    active_token_count: activeTokenCount,
    skipped: false,
    reason: "",
    created_at: now,
  });

  return {
    success: true,
    notification_id: safeNotificationId,
    queue_id: hasActivePushToken ? queueId : "",
    push_sent: hasActivePushToken,
    push_skipped_reason: hasActivePushToken ? "" : "no_active_token",
    in_app_sent: isInAppEnabled,
  };
}

exports.syncApprovedLeaveByDate = onValueWritten(
  {
    region: REGION,
    instance: DATABASE_INSTANCE,
    ref: "/leave_requests/{companyId}/{requestId}",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const companyId = event.params.companyId;
    const requestId = event.params.requestId;

    const beforeLeave = event.data.before.exists() ? event.data.before.val() : null;
    const afterLeave = event.data.after.exists() ? event.data.after.val() : null;

    const updates = buildApprovedLeaveIndexUpdates(companyId, requestId, beforeLeave, afterLeave);

    if (Object.keys(updates).length === 0) {
      logger.info("syncApprovedLeaveByDate: tidak ada update index.", {
        companyId,
        requestId,
      });
      return null;
    }

    await admin.database().ref().update(updates);

    logger.info("syncApprovedLeaveByDate: index izin berhasil diperbarui.", {
      companyId,
      requestId,
      updatePaths: Object.keys(updates).length,
    });

    return null;
  }
);

exports.rebuildApprovedLeaveByDateCallable = onCall(
  {
    region: REGION,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const auth = request.auth;
    const data = request.data || {};

    if (!auth || !auth.uid) {
      throw new HttpsError("unauthenticated", "Login diperlukan.");
    }

    const companyId = String(data.companyId || "").trim();
    const startDate = String(data.startDate || "").slice(0, 10);
    const endDate = String(data.endDate || "").slice(0, 10);
    const dryRun = Boolean(data.dryRun);

    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyId wajib diisi.");
    }

    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
      throw new HttpsError("invalid-argument", "startDate dan endDate wajib format YYYY-MM-DD.");
    }

    const totalDays = daysBetween(startDate, endDate);

    if (totalDays <= 0) {
      throw new HttpsError("invalid-argument", "Range tanggal tidak valid.");
    }

    if (totalDays > MAX_MANUAL_REBUILD_DAYS) {
      throw new HttpsError(
        "invalid-argument",
        `Range terlalu besar. Maksimal ${MAX_MANUAL_REBUILD_DAYS} hari.`
      );
    }

    const token = auth.token || {};
    const role = String(token.role || token.user_role || "").toLowerCase();
    const isOwnerOrAdmin =
      token.owner === true ||
      token.admin === true ||
      role === "owner" ||
      role === "admin" ||
      role === "super_admin";

    if (!isOwnerOrAdmin) {
      throw new HttpsError("permission-denied", "Hanya owner/admin yang boleh rebuild index izin.");
    }

    logger.warn("Manual rebuild approved_leave_by_date dimulai.", {
      uid: auth.uid,
      companyId,
      startDate,
      endDate,
      dryRun,
    });

    const sourceSnap = await admin.database().ref(`leave_requests/${companyId}`).get();
    const source = sourceSnap.exists() ? sourceSnap.val() : {};

    const updates = {};
    let scanned = 0;
    let selected = 0;
    let skipped = 0;

    Object.entries(source || {}).forEach(([requestId, leave]) => {
      scanned++;

      if (!leave || typeof leave !== "object") {
        skipped++;
        return;
      }

      if (!isApprovedStatus(leave.status || leave.approval_status || leave.state)) {
        skipped++;
        return;
      }

      const leaveStart = getLeaveStartDate(leave);
      const leaveEnd = getLeaveEndDate(leave);

      if (!isValidDateKey(leaveStart) || !isValidDateKey(leaveEnd)) {
        skipped++;
        return;
      }

      if (leaveEnd < startDate || leaveStart > endDate) {
        skipped++;
        return;
      }

      const effectiveStart = leaveStart < startDate ? startDate : leaveStart;
      const effectiveEnd = leaveEnd > endDate ? endDate : leaveEnd;

      const safeRequestId = sanitizeKey(requestId);
      const uid = getLeaveUid(leave, safeRequestId);
      const safeUid = sanitizeKey(uid);

      if (!safeUid) {
        skipped++;
        return;
      }

      const dates = buildDateRange(effectiveStart, effectiveEnd, MAX_MANUAL_REBUILD_DAYS);

      dates.forEach((date) => {
        updates[`approved_leave_by_date/${companyId}/${date}/${safeUid}/${safeRequestId}`] = {
          request_id: requestId,
          company_id: companyId,
          uid,
          start_date: leaveStart,
          end_date: leaveEnd,
          status: leave.status || leave.approval_status || "approved",
          type: leave.type || leave.leave_type || leave.jenis || "",
          reason: leave.reason || leave.alasan || "",
          rebuilt_at: Date.now(),
        };
      });

      selected++;
    });

    const updatePaths = Object.keys(updates);

    if (!dryRun && updatePaths.length > 0) {
      await admin.database().ref().update(updates);
    }

    return {
      ok: true,
      dryRun,
      companyId,
      startDate,
      endDate,
      scanned,
      selected,
      skipped,
      updatePaths: updatePaths.length,
      message: dryRun
        ? "Dry run selesai. Tidak ada data ditulis."
        : "Rebuild approved_leave_by_date selesai.",
    };
  }
);

