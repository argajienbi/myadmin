import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { app, db, firestore } from "../firebase";
import { paths } from "../services/paths";
import { ref, onValue, update, get } from "firebase/database";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import toast from "react-hot-toast";
import { ConfirmModal } from "../components/ConfirmModal";
import { employeeDisplayName, maskId } from "../utils/safeDisplay";
import { useTechnicalIds } from "../hooks/useTechnicalIds";
import { 
  RefreshCw, 
  Activity, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Send, 
  Sliders, 
  HeartPulse, 
  Calendar, 
  History, 
  Database,
  ArrowRight,
  Shield,
  FileText,
  User,
  XCircle,
  HelpCircle,
  Power,
  ListRestart
} from "lucide-react";

function tokenTime(token: any) {
  return Number(
    token.permission_last_checked_at ||
    token.last_seen_at ||
    token.updated_at ||
    0
  );
}

function isPermissionAllowed(token: any) {
  const status = String(token.permission_status || "").toLowerCase();
  return token.statusbar_allowed === true ||
    status === "authorized" ||
    status === "provisional";
}

function getCurrentTokenIdForUser(tokens: any[]) {
  const sorted = [...tokens].sort((a, b) => {
    const activeDiff = Number(Boolean(b.active)) - Number(Boolean(a.active));
    if (activeDiff !== 0) return activeDiff;

    const allowedDiff = Number(isPermissionAllowed(b)) - Number(isPermissionAllowed(a));
    if (allowedDiff !== 0) return allowedDiff;

    return tokenTime(b) - tokenTime(a);
  });

  return sorted[0]?.token_id || "";
}

export const NotificationLogs: React.FC = () => {
    const { userData } = useAuth();
    
    if (userData?.role !== "owner") {
      return (
        <div className="p-8">
          <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
            <div className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
              Akses khusus Owner
            </div>
            <p className="text-sm text-slate-500">
              Pengaturan dan log notifikasi hanya dapat dikelola oleh Owner.
            </p>
          </div>
        </div>
      );
    }
    
    const [targetCompanyId, setTargetCompanyId] = useState<string>("");
    const [companyWarning, setCompanyWarning] = useState("");
    const [lastCallableError, setLastCallableError] = useState("");
    
    // Core data lists
    const [queueLogs, setQueueLogs] = useState<any[]>([]);
    const [actionLogs, setActionLogs] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [deliveryLogs, setDeliveryLogs] = useState<any[]>([]);
    const [schedulerLogs, setSchedulerLogs] = useState<any[]>([]);
    const [tokenHealthList, setTokenHealthList] = useState<any[]>([]);
    
    // UI state
    const [activeTab, setActiveTab] = useState<string>("logs"); // logs, debug, tokens, scheduler
    const [loadingTokens, setLoadingTokens] = useState<boolean>(false);
    const [resetDedupeLoading, setResetDedupeLoading] = useState(false);
    const [resetDedupeResult, setResetDedupeResult] = useState<any>(null);
    const [resetDedupeError, setResetDedupeError] = useState("");
    const [resetDedupeLastRunAt, setResetDedupeLastRunAt] = useState<number>(0);
    
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        isDestructive?: boolean;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: "",
        message: "",
        onConfirm: () => {}
    });

    // Filters for delivery logs
    const [statusFilter, setStatusFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [uidFilter, setUidFilter] = useState("all");
    const [dateFilter, setDateFilter] = useState("");

    // Token Health Filters
    const [tokenActiveFilter, setTokenActiveFilter] = useState("all"); // all, active, inactive
    const [tokenPermFilter, setTokenPermFilter] = useState("all"); // all, granted, denied
    const [tokenStatusFilter, setTokenStatusFilter] = useState("all"); // all, current, active, push_ready, blocked, inactive
    
    // Debug & Test form values
    const [testTargetUid, setTestTargetUid] = useState("");
    const [customTitle, setCustomTitle] = useState("Test Push MYPRESENCE");
    const [customBody, setCustomBody] = useState("Ini adalah test push dari dashboard admin.");
    const [testSending, setTestSending] = useState(false);
    
    // Test reminder specific state
    const [reminderTestStage, setReminderTestStage] = useState("now");

    const { showTechnicalIds, setShowTechnicalIds } = useTechnicalIds();

    const getUserLabel = (uid: string) => {
        const user = users.find((u: any) => u.uid === uid);
        return employeeDisplayName(user, "Karyawan");
    };
    const [reminderTestDirection, setReminderTestDirection] = useState("check_in");

    useEffect(() => {
        if (!userData) return;
        const selectedCompany = localStorage.getItem("admin_selected_company") || "";
        const role = String(userData.role || "").toLowerCase();

        const resolvedCompanyId =
          role === "owner" || role === "system_owner"
            ? selectedCompany || userData.company_id || ""
            : userData.company_id || "";

        setTargetCompanyId(resolvedCompanyId);

        if (!resolvedCompanyId) {
          setCompanyWarning(
            "Company aktif belum dipilih. Pilih perusahaan terlebih dahulu sebelum membuka log, test push, atau reset dedupe."
          );
        } else {
          setCompanyWarning("");
        }
    }, [userData]);

    useEffect(() => {
        if (!targetCompanyId) {
            setQueueLogs([]);
            setActionLogs([]);
            setUsers([]);
            setDeliveryLogs([]);
            setSchedulerLogs([]);
            setTokenHealthList([]);
            return;
        }

        // Queue
        const unsubQueue = onValue(ref(db, `companies/${targetCompanyId}/notification_queue`), snap => {
            if (snap.exists()) {
                const arr = Object.entries(snap.val()).map(([key, value]: any) => ({ ...value, id: key }));
                arr.sort((a, b) => b.created_at - a.created_at);
                setQueueLogs(arr.slice(0, 100));
            } else {
                setQueueLogs([]);
            }
        });

        // Logs
        const unsubLogs = onValue(ref(db, `companies/${targetCompanyId}/notification_logs`), snap => {
            if (snap.exists()) {
                const arr = Object.entries(snap.val()).map(([key, value]: any) => ({ ...value, id: key }));
                arr.sort((a, b) => b.created_at - a.created_at);
                setActionLogs(arr.slice(0, 100));
            } else {
                setActionLogs([]);
            }
        });

        // Users
        const unsubUsers = onValue(ref(db, paths.companyUsers(targetCompanyId)), snap => {
            if (snap.exists()) {
                const arr = Object.entries(snap.val()).map(([key, value]: any) => ({ ...value, uid: value.uid || key }));
                setUsers(arr);
            } else {
                setUsers([]);
            }
        });

        // Delivery Logs
        const unsubDelivery = onValue(ref(db, `companies/${targetCompanyId}/notification_delivery_logs`), snap => {
            if (snap.exists()) {
                const logsMap = snap.val();
                const arr: any[] = [];
                Object.entries(logsMap).forEach(([notifId, tokensMap]: any) => {
                    if (tokensMap && typeof tokensMap === "object") {
                        Object.entries(tokensMap).forEach(([tokenId, logVal]: any) => {
                            arr.push({
                                ...logVal,
                                notification_id: notifId,
                                token_id: tokenId,
                            });
                        });
                    }
                });
                arr.sort((a, b) => (b.sent_at || 0) - (a.sent_at || 0));
                setDeliveryLogs(arr);
            } else {
                setDeliveryLogs([]);
            }
        });

        // Scheduler Run Logs (PATCH-05)
        const unsubScheduler = onValue(ref(db, `companies/${targetCompanyId}/attendance_reminder_scheduler_logs`), snap => {
            if (snap.exists()) {
                const arr = Object.entries(snap.val()).map(([key, value]: any) => ({ ...value, id: key }));
                arr.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
                setSchedulerLogs(arr.slice(0, 50));
            } else {
                setSchedulerLogs([]);
            }
        });

        return () => { 
            unsubQueue(); 
            unsubLogs(); 
            unsubUsers(); 
            unsubDelivery(); 
            unsubScheduler(); 
        };
    }, [targetCompanyId]);

    // Refresh Token Health manually (PATCH-08)
    const fetchTokenHealth = async () => {
        if (!targetCompanyId || users.length === 0) return;
        setLoadingTokens(true);
        try {
            let allTokens: any[] = [];
            const promises = users.map(async (user) => {
                const uid = user.uid;
                const tokensSnap = await getDocs(collection(firestore, "companies", targetCompanyId, "users", uid, "fcm_tokens"));
                const rtdbTokensSnap = await get(ref(db, `companies/${targetCompanyId}/users/${uid}/fcm_tokens`));

                const userTokens: any[] = [];
                const firestoreTokenIds = new Set<string>();

                tokensSnap.forEach((docSnap) => {
                    const data = docSnap.data();
                    // Setup basic fallback parsing
                    const permissionStatusRaw = String(data.permission_status || "").toLowerCase();
                    const statusbarAllowed = data.statusbar_allowed !== undefined 
                      ? data.statusbar_allowed 
                      : (permissionStatusRaw === 'authorized' || permissionStatusRaw === 'provisional');
                      
                    const permissionCheckedAt = data.permission_last_checked_at || data.updated_at || data.last_seen_at || 0;
                    
                    firestoreTokenIds.add(docSnap.id);
                    userTokens.push({
                        ...data,
                        token_id: docSnap.id,
                        uid,
                        userName: user.nama_lengkap || user.name || "Karyawan Tanpa Nama",
                        role: user.role || "staff",
                        
                        permission_status: data.permission_status || "",
                        statusbar_allowed: statusbarAllowed,
                        active: Boolean(data.active),
                        permission_last_checked_at: permissionCheckedAt,
                        last_seen_at: data.last_seen_at || 0,
                        updated_at: data.updated_at || 0,
                        invalidated_at: data.invalidated_at || 0,
                        invalid_reason: data.invalid_reason || "",
                        superseded_by: data.superseded_by || "",
                        app_source: data.app_source || "",
                        platform: data.platform || "",
                        device_name: data.device_name || "",
                        source: "firestore",
                        source_label: "Firestore",
                    });
                });

                if (rtdbTokensSnap.exists()) {
                    const rtdbData = rtdbTokensSnap.val() || {};
                    Object.entries(rtdbData).forEach(([tokenId, data]: [string, any]) => {
                        if (data && typeof data === "object" && !firestoreTokenIds.has(tokenId)) {
                            const permissionStatusRaw = String(data.permission_status || "").toLowerCase();
                            const statusbarAllowed = data.statusbar_allowed !== undefined 
                              ? data.statusbar_allowed 
                              : (permissionStatusRaw === 'authorized' || permissionStatusRaw === 'provisional');
                            const permissionCheckedAt = data.permission_last_checked_at || data.updated_at || data.last_seen_at || 0;

                            userTokens.push({
                                ...data,
                                token_id: tokenId,
                                uid,
                                userName: user.nama_lengkap || user.name || "Karyawan Tanpa Nama",
                                role: user.role || "staff",
                                
                                permission_status: data.permission_status || "",
                                statusbar_allowed: statusbarAllowed,
                                active: Boolean(data.active),
                                permission_last_checked_at: permissionCheckedAt,
                                last_seen_at: data.last_seen_at || 0,
                                updated_at: data.updated_at || 0,
                                invalidated_at: data.invalidated_at || 0,
                                invalid_reason: data.invalid_reason || "",
                                superseded_by: data.superseded_by || "",
                                app_source: data.app_source || "",
                                platform: data.platform || "",
                                device_name: data.device_name || "",
                                source: "rtdb_mirror",
                                source_label: "RTDB Mirror",
                            });
                        }
                    });
                }
                
                // Add to total tokens
                allTokens = allTokens.concat(userTokens);
            });
            await Promise.all(promises);

            // Group by UID to calculate is_current
            const tokensByUid: Record<string, any[]> = {};
            allTokens.forEach(t => {
                if (!tokensByUid[t.uid]) tokensByUid[t.uid] = [];
                tokensByUid[t.uid].push(t);
            });

            const processedTokens = allTokens.map(token => {
                const currentTokenId = getCurrentTokenIdForUser(tokensByUid[token.uid] || []);
                const is_current = token.token_id === currentTokenId;
                const effective_permission_allowed = isPermissionAllowed(token);
                
                let effective_status = "old";
                if (!token.active) effective_status = "inactive";
                else if (token.invalid_reason === "superseded_by_new_token") effective_status = "superseded";
                else if (is_current && effective_permission_allowed) effective_status = "current_ok";
                else if (is_current && !effective_permission_allowed) effective_status = "current_blocked";
                
                return {
                    ...token,
                    is_current,
                    effective_permission_allowed,
                    effective_status
                };
            });

            setTokenHealthList(processedTokens);
            toast.success("Kesehatan Token FCM berhasil diperbarui!");
        } catch (err: any) {
            console.error("Failed to load token health:", err);
            toast.error(`Gagal memuat Token Health: ${err.message}`);
        } finally {
            setLoadingTokens(false);
        }
    };

    // Load token health automatically once users are fetched
    useEffect(() => {
        if (users.length > 0 && activeTab === "tokens") {
            fetchTokenHealth();
        }
    }, [users.length, activeTab]);

    const formatTime = (ts: number) => {
        if (!ts) return "-";
        return new Date(ts).toLocaleString('id-ID');
    };

    // Manual Retry trigger for failed queues (PATCH-03)
    const handleRetryQueue = async (item: any) => {
        if (!targetCompanyId) return;
        try {
            const retryRef = ref(db, `companies/${targetCompanyId}/notification_queue/${item.id}`);
            const nextRetry = (item.retry_count || 0) + 1;
            
            await update(retryRef, {
                status: "pending",
                retry_count: nextRetry,
                previous_error: item.error || "",
                error: null,
                retried_at: Date.now(),
                updated_at: Date.now()
            });
            
            toast.success(`Antrean #${item.id} berhasil dipicu ulang (Percobaan #${nextRetry})`);
        } catch (err: any) {
            toast.error(`Gagal me-retry antrean: ${err.message}`);
        }
    };

    const getJakartaDateKey = () => {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
    };

    // Reset dedupe for today (testing/debug)
    const handleResetDedupeToday = () => {
        if (!targetCompanyId) {
            toast.error("Company aktif belum dipilih. Pilih perusahaan terlebih dahulu.");
            return;
        }
        const dateKey = getJakartaDateKey();
        
        setConfirmModal({
            isOpen: true,
            title: "Reset Dedupe Reminder",
            message: `Reset dedupe reminder absensi tanggal ${dateKey}?\n\nIni hanya untuk testing. Reminder yang sudah terkirim hari ini bisa dikirim ulang.`,
            isDestructive: false,
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                setResetDedupeLoading(true);
                setResetDedupeResult(null);
                setResetDedupeError("");
                setResetDedupeLastRunAt(Date.now());
                setLastCallableError("");

                const toastId = "reset_dedupe_today";
                toast.loading("Mereset dedupe reminder...", { id: toastId });

                try {
                    const functions = getFunctions(app, "asia-southeast1");
                    const callable = httpsCallable<any, any>(
                        functions,
                        "resetAttendanceReminderDedupeCallable"
                    );

                    const result = await callable({
                        companyId: targetCompanyId,
                        date: dateKey,
                        dryRun: false,
                    });

                    const data = result.data || {};
                    setResetDedupeResult({
                        ...data,
                        date: dateKey,
                        ran_at: Date.now(),
                    });

                    toast.success(
                        `Reset selesai. Terhapus: ${data.deleted_count || 0}, cocok: ${data.matched_count || 0}.`,
                        { id: toastId }
                    );
                } catch (err: any) {
                    const details = err?.details || {};
                    const detailMessage =
                        details?.original_message ||
                        details?.message ||
                        details?.reason ||
                        details?.error ||
                        "";

                    const message = [
                        err?.code || "",
                        detailMessage || err?.message || String(err),
                    ]
                        .filter(Boolean)
                        .join(": ");

                    setResetDedupeError(message);
                    setLastCallableError(message);
                    toast.error(
                        `Gagal reset dedupe: ${message}`,
                        { id: toastId }
                    );
                } finally {
                    setResetDedupeLoading(false);
                }
            }
        });
    };

    // Deactivate Token manually (PATCH-08)
    const handleDeactivateToken = async (tokenObj: any) => {
        try {
            const now = Date.now();
            const tokenRef = doc(firestore, "companies", targetCompanyId, "users", tokenObj.uid, "fcm_tokens", tokenObj.token_id);
            const tokenPayload = {
                active: false,
                invalidated_at: now,
                updated_at: now,
                invalid_reason: "manual_deactivation_by_admin"
            };

            await setDoc(tokenRef, tokenPayload, { merge: true });
            
            const tokenRtdbRef = ref(db, `companies/${targetCompanyId}/users/${tokenObj.uid}/fcm_tokens/${tokenObj.token_id}`);
            await update(tokenRtdbRef, tokenPayload);
            
            toast.success("Token berhasil dinonaktifkan!");
            fetchTokenHealth();
        } catch (err: any) {
            toast.error(`Gagal menonaktifkan token: ${err.message}`);
        }
    };

    // Centralised Test Event Triggering (PATCH-01 & PATCH-02)
    const handleSendTestEvent = async (eventType: string) => {
        if (!targetCompanyId) {
            toast.error("Company aktif belum dipilih. Pilih perusahaan terlebih dahulu.");
            return;
        }
        setLastCallableError("");

        if (!testTargetUid) {
            toast.error("Silakan pilih target karyawan");
            return;
        }
        setTestSending(true);
        try {
            let options: any = {
                companyId: targetCompanyId,
                uid: testTargetUid,
                skipSettingsCheck: true, // Test push bypass setting (PATCH-07)
            };

            if (eventType === "test_push") {
                options = {
                    ...options,
                    title: customTitle || "Test Push MYPRESENCE",
                    body: customBody || "Ini adalah test push dari dashboard admin.",
                    type: "test_push",
                    refType: "system",
                    refId: "test_push"
                };
            } else if (eventType === "schedule_update") {
                options = {
                    ...options,
                    title: "Jadwal Kerja Diperbarui",
                    body: "Ini test notifikasi perubahan jadwal.",
                    type: "schedule_update",
                    refType: "schedule",
                    refId: "test_schedule"
                };
            } else if (eventType === "approval") {
                options = {
                    ...options,
                    title: "Cuti Disetujui",
                    body: "Ini test notifikasi approval pengajuan.",
                    type: "approval",
                    refType: "leave_request",
                    refId: "test_approval"
                };
            } else if (eventType === "reminder") {
                let reminderTitle = "Pengingat Absensi";
                
                if (reminderTestDirection === "check_in") {
                    if (reminderTestStage === "pre") reminderTitle = "Segera Absen Masuk";
                    else if (reminderTestStage === "now") reminderTitle = "Waktunya Absen Masuk";
                    else if (reminderTestStage === "late") reminderTitle = "Anda Belum Absen Masuk";
                } else {
                    if (reminderTestStage === "pre") reminderTitle = "Segera Absen Pulang";
                    else if (reminderTestStage === "now") reminderTitle = "Waktunya Absen Pulang";
                    else if (reminderTestStage === "late") reminderTitle = "Anda Belum Absen Pulang";
                }

                options = {
                    ...options,
                    title: reminderTitle,
                    body: `Ini test reminder absen ${reminderTestDirection === "check_in" ? "masuk" : "pulang"} (${reminderTestStage}).`,
                    type: "reminder",
                    refType: "attendance_reminder",
                    refId: `attendance_reminder_test_${reminderTestDirection}_${reminderTestStage}`,
                    relatedId: `attendance_reminder_test_${reminderTestDirection}_${reminderTestStage}`,
                    data: {
                        reminder_action: reminderTestDirection,
                        reminder_stage: reminderTestStage,
                        reminder_timing_minutes: reminderTestStage === "now" ? 0 : 10
                    }
                };
            }

            const { createUserNotificationAndPush } = await import("../services/notificationDeliveryService");
            const result = await createUserNotificationAndPush(options);
            
            if (result.success && !result.skipped) {
                toast.success(`Berhasil mengirimkan test [${eventType}]! Cek antrean.`);
            } else if (result.skipped) {
                toast(`Test dilewati: ${result.reason}`);
            }
        } catch (err: any) {
            const details = err?.details || {};
            const detailMessage =
                details?.original_message ||
                details?.message ||
                details?.reason ||
                details?.error ||
                "";

            const message = [
                err?.code || "",
                detailMessage || err?.message || String(err),
            ]
                .filter(Boolean)
                .join(": ");

            setLastCallableError(message);
            toast.error(`Kirim test gagal: ${message}`);
        } finally {
            setTestSending(false);
        }
    };

    // Filter Delivery Logs
    const filteredDeliveryLogs = deliveryLogs.filter(log => {
        if (statusFilter !== "all" && log.status !== statusFilter) return false;
        
        if (typeFilter !== "all") {
            const eventType = String(log.event_type || log.type || "").toLowerCase();
            const refType = String(log.ref_type || "").toLowerCase();
            if (!eventType.includes(typeFilter) && !refType.includes(typeFilter)) return false;
        }

        if (uidFilter !== "all" && log.uid !== uidFilter) return false;

        if (dateFilter) {
            const logDate = new Date(log.sent_at).toISOString().split('T')[0];
            if (logDate !== dateFilter) return false;
        }

        return true;
    });

    // Filter Token Health list
    const filteredTokenHealth = tokenHealthList.filter(tok => {
        // legacy filters
        if (tokenActiveFilter === "active" && !tok.active) return false;
        if (tokenActiveFilter === "inactive" && tok.active) return false;

        // new robust status filter (PATCH-05)
        if (tokenStatusFilter === "current" && !tok.is_current) return false;
        if (tokenStatusFilter === "active" && !tok.active) return false;
        if (tokenStatusFilter === "push_ready" && (!tok.active || !tok.effective_permission_allowed)) return false;
        if (tokenStatusFilter === "blocked" && (!tok.is_current || tok.effective_permission_allowed)) return false;
        if (tokenStatusFilter === "inactive" && (tok.active && tok.is_current)) return false; // inactive or old

        if (tokenPermFilter !== "all" && tokenStatusFilter === "all") {
            if (tokenPermFilter === "granted" && !tok.effective_permission_allowed) return false;
            if (tokenPermFilter === "denied" && tok.effective_permission_allowed) return false;
        }

        return true;
    });

    // Summary Stats per User (PATCH-03)
    const tokenHealthSummary = {
        totalUsers: users.length,
        pushReady: 0,
        permissionBlocked: 0,
        noActiveToken: 0,
        oldTokenOnly: 0
    };

    if (users.length > 0 && tokenHealthList.length > 0) {
        users.forEach(user => {
            const userTokens = tokenHealthList.filter(t => t.uid === user.uid);
            
            if (userTokens.length === 0) {
                tokenHealthSummary.noActiveToken++; // technically no token at all
                return;
            }

            const activeTokens = userTokens.filter(t => t.active);
            if (activeTokens.length === 0) {
                tokenHealthSummary.noActiveToken++;
                return;
            }

            const currentToken = userTokens.find(t => t.is_current);

            // Push ready check: minimal 1 active token that is allowed (effective_permission_allowed)
            const hasAllowed = activeTokens.some(t => t.effective_permission_allowed);
            if (hasAllowed) {
                tokenHealthSummary.pushReady++;
            } else if (currentToken) {
                if (currentToken.active === false || currentToken.invalid_reason) {
                    tokenHealthSummary.oldTokenOnly++;
                } else {
                     tokenHealthSummary.permissionBlocked++;
                }
            } else {
                 tokenHealthSummary.noActiveToken++;
            }
        });
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm">
                <div>
                   <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Pusat Debug & Monitoring Notifikasi</h1>
                   <p className="text-sm text-slate-500 mt-1">Lacak antrean delivery, uji coba push, monitor kesehatan token, dan amati scheduler pengingat secara real-time</p>
                </div>
            </div>

            {companyWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-200">
                {companyWarning}
              </div>
            )}

            {targetCompanyId && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-3 text-xs text-slate-700 dark:text-slate-300">
                Company aktif: <span className="font-mono text-emerald-600 dark:text-emerald-300 font-bold">{targetCompanyId}</span>
              </div>
            )}

            {lastCallableError && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-200">
                <div className="font-semibold mb-1">Error Callable Terakhir</div>
                <div className="break-words font-mono text-xs">{lastCallableError}</div>
              </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex border-b border-slate-200 dark:border-slate-800 p-1 bg-slate-100 dark:bg-slate-900/50 rounded-lg max-w-fit flex-wrap">
                    <button 
                        onClick={() => setActiveTab("logs")}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === "logs" ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm" : "text-slate-550 hover:text-slate-800 dark:hover:text-slate-200"}`}
                    >
                        <Activity className="w-4 h-4" /> Antrean & Log Aksi
                    </button>
                    <button 
                        onClick={() => setActiveTab("debug")}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === "debug" ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm" : "text-slate-550 hover:text-slate-800 dark:hover:text-slate-200"}`}
                    >
                        <Send className="w-4 h-4" /> Debug Center
                    </button>
                    <button 
                        onClick={() => setActiveTab("tokens")}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === "tokens" ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm" : "text-slate-550 hover:text-slate-800 dark:hover:text-slate-200"}`}
                    >
                        <HeartPulse className="w-4 h-4" /> Kesehatan Token ({users.length > 0 ? tokenHealthList.length : 0})
                    </button>
                    <button 
                        onClick={() => setActiveTab("scheduler")}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === "scheduler" ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm" : "text-slate-550 hover:text-slate-800 dark:hover:text-slate-200"}`}
                    >
                        <Clock className="w-4 h-4" /> Log Scheduler Reminder
                    </button>
                </div>
                
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                    <input
                        type="checkbox"
                        checked={showTechnicalIds}
                        onChange={(e) => setShowTechnicalIds(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                    />
                    Tampilkan ID teknis
                </label>
            </div>

            {/* TAB 1: Antrean & Logs */}
            {activeTab === "logs" && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
                        {/* Queue list */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/30">
                                <h2 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                   <Activity className="w-5 h-5 text-blue-500" /> Antrean Push Notification
                                </h2>
                            </div>
                            {queueLogs.length === 0 ? (
                                <div className="p-12 text-center text-slate-400 text-sm">Belum ada antrean pengiriman.</div>
                            ) : (
                                <div className="overflow-auto max-h-[600px]">
                                    <table className="w-full text-left text-sm whitespace-nowrap">
                                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 sticky top-0 z-10 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                            <tr>
                                                <th className="px-4 py-3 font-medium">Jadwal Buat</th>
                                                <th className="px-4 py-3 font-medium">Judul & Isi</th>
                                                <th className="px-4 py-3 font-medium">Status & Aksi</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {queueLogs.map(item => {
                                                const isFailed = item.status === "failed";
                                                const isDead = item.status === "dead_letter";
                                                return (
                                                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                                                            {formatTime(item.created_at)}
                                                            {item.updated_at && item.updated_at !== item.created_at && (
                                                                <div className="text-[9px] text-slate-400 mt-0.5">Up: {formatTime(item.updated_at)}</div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="font-semibold text-slate-800 dark:text-slate-200 max-w-[200px] truncate" title={item.title}>{item.title}</div>
                                                            <div className="text-xs text-slate-500 max-w-[220px] truncate" title={item.body || item.message}>{item.body || item.message}</div>
                                                            <div className="text-[10px] text-slate-400 mt-1 capitalize">{item.type} • {item.ref_type}</div>
                                                            <div className="text-[10px] text-slate-400 font-mono truncate max-w-[220px]">
                                                                Karyawan: {getUserLabel(item.uid)}
                                                            </div>
                                                            {showTechnicalIds && (
                                                                <details className="text-[10px] text-slate-400 font-mono mt-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                                                                    <summary className="cursor-pointer font-semibold outline-none hover:text-slate-600 dark:hover:text-slate-200">ID Teknis</summary>
                                                                    <div className="mt-1 space-y-0.5">
                                                                        <div>UID: {maskId(item.uid, "UID")}</div>
                                                                        <div>Queue: {maskId(item.id, "Queue")}</div>
                                                                        {item.notification_id && <div>Notif: {maskId(item.notification_id, "Notif")}</div>}
                                                                    </div>
                                                                </details>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                {item.status === 'pending' ? (
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30">Menunggu</span>
                                                                ) : item.status === 'processing' ? (
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 font-mono animate-pulse">Processing</span>
                                                                ) : item.status === 'sent' ? (
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30">Terkirim</span>
                                                                ) : isDead ? (
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-150 text-slate-700 dark:bg-slate-800 border border-red-300 dark:border-red-900/40">Gagal Permanen</span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/30">Gagal</span>
                                                                )}

                                                                {/* Retry Button (PATCH-03) */}
                                                                {isFailed && (
                                                                    <button 
                                                                        onClick={() => handleRetryQueue(item)}
                                                                        className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded transition"
                                                                        title="Coba ulang antrean secara manual"
                                                                    >
                                                                        <RefreshCw className="w-2.5 h-2.5" /> Retry
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {item.retry_count !== undefined && (
                                                                <div className="text-[10px] text-slate-500">
                                                                    Retry Count: <span className="font-semibold">{item.retry_count}/3</span>
                                                                </div>
                                                            )}
                                                            {item.error && (
                                                                <div className="text-[10px] text-red-500 max-w-[260px] whitespace-normal font-mono" title={item.error}>
                                                                    {item.error}
                                                                </div>
                                                            )}
                                                            {item.token_count !== undefined && (
                                                               <div className="text-[10px] text-slate-500 mt-1">
                                                                   {item.token_count} device {item.success_count>0 && <span className="text-emerald-600 font-medium ml-1">({item.success_count} ok)</span>} {item.failed_count>0 && <span className="text-red-500 font-medium ml-1">({item.failed_count} fail)</span>}
                                                               </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* System action log */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/30">
                                <h2 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                   <Clock className="w-5 h-5 text-purple-500" /> Log Aksi Sistem
                                </h2>
                            </div>
                            {actionLogs.length === 0 ? (
                                <div className="p-12 text-center text-slate-400 text-sm">Belum ada log operasional.</div>
                            ) : (
                                <div className="overflow-auto max-h-[600px] border-t border-slate-100 dark:divide-slate-800">
                                     <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {actionLogs.map(log => {
                                            const isSkippedNoToken = log.action === "notification_push_skipped_no_active_token";
                                            const isResetDedupe = log.action === "reset_attendance_reminder_dedupe";
                                            return (
                                            <div key={log.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                <div className="flex justify-between items-start mb-1">
                                                    <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">
                                                        {isSkippedNoToken ? (
                                                            <span className="flex items-center gap-2">
                                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30">DILEWATI</span>
                                                                Tidak Ada Token Aktif
                                                            </span>
                                                        ) : isResetDedupe ? (
                                                            <span className="flex items-center gap-2">
                                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 dark:bg-rose-900/30">RESET DEDUPE</span>
                                                                Reset Dedupe Reminder
                                                            </span>
                                                        ) : (
                                                            (log.action ? String(log.action).replaceAll('_', ' ').replace(/\b\w/g, (c:string) => c.toUpperCase()) : "Aksi Sistem")
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-mono">
                                                        {formatTime(log.created_at)}
                                                    </div>
                                                </div>
                                                <div className="text-xs text-slate-600 dark:text-slate-400 whitespace-normal font-mono">
                                                    {log.error && !isSkippedNoToken && <span className="text-red-500 font-medium block">Error: {log.error}</span>}
                                                    {log.reason && isSkippedNoToken && <span className="text-amber-600 dark:text-amber-500 font-medium block">Alasan: {log.reason}</span>}
                                                    {log.uid && <span className="block">Karyawan: {getUserLabel(log.uid)}</span>}
                                                    {showTechnicalIds && (
                                                        <details className="mt-1">
                                                            <summary className="cursor-pointer font-semibold outline-none hover:text-slate-500">ID Teknis</summary>
                                                            <div className="pl-2 border-l-2 border-slate-200 dark:border-slate-800">
                                                                {log.uid && <span className="block">UID: {maskId(log.uid, "UID")}</span>}
                                                                {log.queue_id && <span className="block">Queue ID: {maskId(log.queue_id, "Queue")}</span>}
                                                            </div>
                                                        </details>
                                                    )}
                                                    {log.token_count !== undefined && <span className="block mt-1">Device Count: {log.token_count} (Sukses: {log.success_count || 0}, Gagal: {log.failed_count || 0})</span>}
                                                    {isResetDedupe && (
                                                        <>
                                                            <span className="block">Tanggal: {log.date}</span>
                                                            <span className="block">Matched: {log.matched_count || 0}</span>
                                                            <span className="block">Deleted: {log.deleted_count || 0}</span>
                                                            <span className="block">Dry Run: {String(Boolean(log.dry_run))}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )})}
                                     </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* FCM Delivery Logs */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col w-full">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-4 bg-slate-50 dark:bg-slate-800/30">
                            <div className="flex items-center justify-between">
                                <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                   <Activity className="w-5 h-5 text-emerald-500" /> Log Detail Pengiriman FCM (Per Token)
                                </h2>
                            </div>

                            {/* Filters Row */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Filter Status</label>
                                    <select 
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={statusFilter} 
                                        onChange={e => setStatusFilter(e.target.value)}
                                    >
                                        <option value="all">Semua Status</option>
                                        <option value="success">Success</option>
                                        <option value="failed">Failed</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Filter Tipe / Ref</label>
                                    <select 
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={typeFilter} 
                                        onChange={e => setTypeFilter(e.target.value)}
                                    >
                                        <option value="all">Semua Tipe</option>
                                        <option value="info">Info</option>
                                        <option value="reminder">Reminder</option>
                                        <option value="schedule">Schedule / Jadwal</option>
                                        <option value="leave_request">Leave / Izin</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Filter Karyawan</label>
                                    <select 
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={uidFilter} 
                                        onChange={e => setUidFilter(e.target.value)}
                                    >
                                        <option value="all">Semua Karyawan</option>
                                        {users.map((u: any, idx: number) => (
                                            <option key={u.uid || `user-filter-${idx}`} value={u.uid}>{u.nama_lengkap || u.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Filter Tanggal</label>
                                    <input 
                                        type="date"
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={dateFilter}
                                        onChange={e => setDateFilter(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        {filteredDeliveryLogs.length === 0 ? (
                            <div className="p-12 text-center text-slate-400 text-sm">Tidak ada log detail pengiriman token yang cocok.</div>
                        ) : (
                            <div className="overflow-auto max-h-[500px]">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 sticky top-0 z-10 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Tanggal Kirim</th>
                                            <th className="px-4 py-3 font-medium">Notifikasi</th>
                                            <th className="px-4 py-3 font-medium">Karyawan & Perangkat</th>
                                            <th className="px-4 py-3 font-medium">Status & Error</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {filteredDeliveryLogs.map((log, idx) => {
                                            return (
                                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                                                        {formatTime(log.sent_at)}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs">
                                                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[250px]">
                                                            Karyawan: {getUserLabel(log.target_uid)}
                                                        </div>
                                                        {showTechnicalIds && (
                                                            <details className="text-[10px] text-slate-500 font-mono mt-1">
                                                                <summary className="cursor-pointer font-semibold outline-none">ID Teknis</summary>
                                                                <div className="mt-1">
                                                                    <div title={log.notification_id}>Notif: {maskId(log.notification_id, "Notif")}</div>
                                                                    <div>Queue: {maskId(log.queue_id, "Queue")}</div>
                                                                    <div>UID: {maskId(log.target_uid, "UID")}</div>
                                                                </div>
                                                            </details>
                                                        )}
                                                        <div className="text-[10px] text-slate-400 mt-1">
                                                          Meta: <span className="capitalize">{log.event_type || "info"}</span>
                                                          {log.ref_type ? ` • ${log.ref_type}` : ""}
                                                        </div>
                                                        {showTechnicalIds && log.ref_id && (
                                                          <div className="text-[10px] text-slate-400 mt-0.5">Ref: {maskId(log.ref_id, "Ref")}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs">
                                                        <div className="font-medium text-slate-800 dark:text-slate-200">
                                                            {getUserLabel(log.uid || log.target_uid || "")}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400">
                                                          Perangkat: {log.platform || log.device_name || "Android"}
                                                        </div>

                                                        {showTechnicalIds && (
                                                          <details className="text-[10px] text-slate-400 font-mono mt-1">
                                                            <summary className="cursor-pointer font-semibold outline-none hover:text-slate-600 dark:hover:text-slate-200">
                                                              ID teknis perangkat
                                                            </summary>
                                                            <div className="mt-1 space-y-0.5">
                                                              {log.token_id && <div title={log.token_id}>Token: {maskId(log.token_id, "Token")}</div>}
                                                              {log.token && <div title={log.token}>FCM: {maskId(log.token, "FCM")}</div>}
                                                              {log.uid && <div>UID: {maskId(log.uid, "UID")}</div>}
                                                              {log.target_uid && <div>Target UID: {maskId(log.target_uid, "UID")}</div>}
                                                            </div>
                                                          </details>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs">
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            {log.status === 'success' ? (
                                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30">Success</span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/30">Failed</span>
                                                            )}
                                                        </div>
                                                        {log.error_code && (
                                                            <div className="text-[10px] text-red-500 font-medium font-mono">
                                                                Code: {log.error_code}
                                                            </div>
                                                        )}
                                                        {log.error_message && (
                                                            <div className="text-[10px] text-slate-500 whitespace-normal max-w-[250px]">
                                                                Msg: {log.error_message}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 2: Debug Center (PATCH-01 & PATCH-02) */}
            {activeTab === "debug" && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-between items-center">
                            <h2 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <Send className="w-5 h-5 text-indigo-500" /> Notification Debug Center (Pusat Tes)
                            </h2>
                            <span className="text-[11px] bg-indigo-150 text-indigo-700 dark:bg-indigo-900/30 font-bold px-2.5 py-1 rounded bg-indigo-100 uppercase tracking-wider">Test Sandbox</span>
                        </div>

                        <div className="m-4 p-4 border border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-900/10 rounded-lg text-xs text-blue-800 dark:text-blue-300">
                            <strong>Note:</strong> Test Target Spesifik di halaman ini HANYALAH untuk menguji jalur FCM dan validasi payload. 
                            <ul className="list-disc pl-4 mt-2 space-y-1">
                                <li><strong>Scheduler otomatis</strong> mengikuti konfigurasi pada menu Pengaturan Notifikasi, termasuk pre, now, late, dan catch-up window.</li>
                                <li>Untuk mengetes <strong>scheduler otomatis</strong>: Atur konfigurasi reminder, lalu buat jadwal baru dengan `work_start` atau `work_end` beberapa menit dari waktu sekarang. Tunggu scheduler berjalan otomatis.</li>
                            </ul>
                        </div>

                        {/* Deployment Checklist Panel (PATCH-12) */}
                        <div className="bg-yellow-50 dark:bg-yellow-900/10 border-b border-yellow-200 dark:border-yellow-900/30 p-4">
                            <h3 className="text-sm font-bold text-yellow-800 dark:text-yellow-600 mb-2">Checklist setelah update:</h3>
                            <ul className="text-xs text-yellow-700 dark:text-yellow-500 list-decimal list-inside space-y-1">
                                <li>npm run build</li>
                                <li>firebase deploy --only functions</li>
                                <li>firebase deploy --only firestore:rules</li>
                                <li>firebase deploy --only database</li>
                                <li>firebase deploy --only storage</li>
                                <li>buka app mypresence dan login ulang user</li>
                                <li>cek Token Health</li>
                                <li>kirim Test Push</li>
                            </ul>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="max-w-xl space-y-4">
                                <p className="text-xs text-slate-500">Gunakan menu ini untuk memicu push notification tiruan menggunakan jalur yang sama dengan notifikasi operasional (FCM + Bell + Status Bar). Jalur ini melewati/bypass filtering settings agar tes tetap bisa berjalan.</p>
                                
                                <div className="space-y-2">
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Pilih Target Karyawan</label>
                                    <select 
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2.5 text-sm" 
                                        value={testTargetUid} 
                                        onChange={e => setTestTargetUid(e.target.value)}
                                    >
                                        <option value="">-- Pilih Karyawan --</option>
                                        {users.map((u: any, idx: number) => (
                                            <option key={u.uid || `user-debug-${idx}`} value={u.uid}>{u.nama_lengkap || u.name} ({u.role})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <hr className="border-slate-100 dark:border-slate-800" />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                                {/* Template 1: Test Push Umum */}
                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-500 dark:hover:border-blue-500 transition shadow-sm bg-slate-25 hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-1">
                                        <Sliders className="w-4 h-4 text-blue-500" /> 1. Test Push Umum (Custom)
                                    </h3>
                                    <p className="text-xs text-slate-500 mb-4">Kirimkan notifikasi bebas dengan kustomisasi judul dan pesan.</p>
                                    
                                    <div className="space-y-3 mb-4">
                                        <div>
                                            <label className="block text-[11px] text-slate-555 text-slate-500 font-medium mb-1">Judul Kustom</label>
                                            <input 
                                                type="text" 
                                                value={customTitle} 
                                                onChange={e => setCustomTitle(e.target.value)}
                                                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-slate-555 text-slate-500 font-medium mb-1">Isi Pesan Kustom</label>
                                            <textarea 
                                                value={customBody} 
                                                onChange={e => setCustomBody(e.target.value)}
                                                rows={2}
                                                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                                            />
                                        </div>
                                    </div>

                                    <button 
                                        disabled={testSending || !targetCompanyId} 
                                        onClick={() => handleSendTestEvent("test_push")}
                                        className={`w-full py-2 font-medium text-xs rounded transition flex items-center justify-center gap-2 ${
                                            (!targetCompanyId || testSending)
                                                ? "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed"
                                                : "bg-blue-600 hover:bg-blue-700 text-white"
                                        }`}
                                    >
                                        <Send className="w-3.5 h-3.5" /> Kirim Custom Test Push
                                    </button>
                                </div>

                                {/* Template 2: Test Perubahan Jadwal */}
                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-emerald-500 dark:hover:border-emerald-500 transition shadow-sm bg-slate-25 hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-1">
                                        <Calendar className="w-4 h-4 text-emerald-500" /> 2. Test Jadwal Kerja (`schedule_update`)
                                    </h3>
                                    <p className="text-xs text-slate-500 mb-6">Memicu notifikasi uji coba pergantian shift/detail jadwal kerja karyawan.</p>
                                    
                                    <div className="bg-white dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 p-3 mb-6 font-mono text-[10px] text-slate-550 text-slate-500 space-y-1">
                                        <div>• Key: <span className="text-emerald-600">"schedule_update"</span></div>
                                        <div>• Title: "Jadwal Kerja Diperbarui"</div>
                                        <div>• Action: Buka Halaman Jadwal (Mobile)</div>
                                    </div>

                                    <button 
                                        disabled={testSending || !targetCompanyId} 
                                        onClick={() => handleSendTestEvent("schedule_update")}
                                        className={`w-full py-2 font-medium text-xs rounded transition flex items-center justify-center gap-2 ${
                                            (!targetCompanyId || testSending)
                                                ? "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed"
                                                : "bg-emerald-600 hover:bg-emerald-700 text-white"
                                        }`}
                                    >
                                        <Send className="w-3.5 h-3.5" /> Kirim Test Jadwal
                                    </button>
                                </div>

                                {/* Template 3: Test Approval */}
                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-amber-500 dark:hover:border-amber-500 transition shadow-sm bg-slate-25 hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-1">
                                        <Shield className="w-4 h-4 text-amber-500" /> 3. Test Approval Pengajuan (`approval`)
                                    </h3>
                                    <p className="text-xs text-slate-500 mb-6">Memicu notifikasi status approval cuti, izin, sakit, lembur, maupun koreksi.</p>
                                    
                                    <div className="bg-white dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 p-3 mb-6 font-mono text-[10px] text-slate-550 text-slate-500 space-y-1">
                                        <div>• Key: <span className="text-amber-600">"approval"</span></div>
                                        <div>• Title: "Cuti Disetujui"</div>
                                        <div>• Action: Buka Halaman Pengajuan (Mobile)</div>
                                    </div>

                                    <button 
                                        disabled={testSending || !targetCompanyId} 
                                        onClick={() => handleSendTestEvent("approval")}
                                        className={`w-full py-2 font-medium text-xs rounded transition flex items-center justify-center gap-2 ${
                                            (!targetCompanyId || testSending)
                                                ? "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed"
                                                : "bg-amber-600 hover:bg-amber-700 text-white"
                                        }`}
                                    >
                                        <Send className="w-3.5 h-3.5" /> Kirim Test Approval
                                    </button>
                                </div>

                                {/* Template 4: Test Attendance Reminder */}
                                <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-purple-500 dark:hover:border-purple-500 transition shadow-sm bg-slate-25 hover:bg-slate-50 dark:hover:bg-slate-800/20">
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-1">
                                        <Clock className="w-4 h-4 text-purple-500" /> 4. Test Reminder Absen (`reminder`)
                                    </h3>
                                    <p className="text-xs text-slate-500 mb-6">Memicu notifikasi pengingat absen masuk / pulang (sebelum atau setelah jam kerja).</p>
                                    
                                    <div className="flex gap-2 mb-4">
                                        <div className="flex-1">
                                            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Target Action</label>
                                            <select
                                                value={reminderTestDirection}
                                                onChange={e => setReminderTestDirection(e.target.value)}
                                                className="w-full text-xs p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                                            >
                                                <option value="check_in">Masuk (check_in)</option>
                                                <option value="check_out">Pulang (check_out)</option>
                                            </select>
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Stage</label>
                                            <select
                                                value={reminderTestStage}
                                                onChange={e => setReminderTestStage(e.target.value)}
                                                className="w-full text-xs p-1.5 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                                            >
                                                <option value="pre">Sebelum waktu / pre</option>
                                                <option value="now">Tepat waktu / now</option>
                                                <option value="late">Terlambat / late</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="bg-white dark:bg-slate-950 rounded border border-slate-100 dark:border-slate-800 p-3 mb-6 font-mono text-[10px] text-slate-550 text-slate-500 space-y-1">
                                        <div>• Key: <span className="text-purple-600">"attendance_reminder"</span></div>
                                        <div>• Action: Buka Kamera Absensi (Mobile)</div>
                                        <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800/50">
                                            <span className="text-slate-400">payload: </span>
                                            {`{ reminder_action: "${reminderTestDirection}", reminder_stage: "${reminderTestStage}" }`}
                                        </div>
                                    </div>

                                    <button 
                                        disabled={testSending || !targetCompanyId} 
                                        onClick={() => handleSendTestEvent("reminder")}
                                        className={`w-full py-2 font-medium text-xs rounded transition flex items-center justify-center gap-2 ${
                                            (!targetCompanyId || testSending)
                                                ? "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed"
                                                : "bg-purple-600 hover:bg-purple-700 text-white"
                                        }`}
                                    >
                                        <Send className="w-3.5 h-3.5" /> Kirim Test Reminder
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 3: Token Health Panel (PATCH-08) */}
            {activeTab === "tokens" && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h2 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                    <HeartPulse className="w-5 h-5 text-emerald-500" /> Monitor Kesehatan Token FCM Karyawan
                                </h2>
                                <p className="text-[11px] text-slate-500 mt-0.5">Daftar token terdaftar yang dipetakan langsung dari Firestore (Zero Trust ABAC Validation)</p>
                            </div>
                            
                            <button 
                                onClick={fetchTokenHealth} 
                                disabled={loadingTokens}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold disabled:opacity-50 transition border border-transparent"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${loadingTokens ? "animate-spin" : ""}`} /> 
                                {loadingTokens ? "Menghubungkan..." : "Refresh Token Health"}
                            </button>
                        </div>

                        {/* Top Summary Stats (PATCH-03) */}
                        <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800">
                            <p className="text-[11px] text-slate-500 mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">Status izin dibaca dari data terakhir yang dikirim aplikasi MYPRESENCE. Jika baru mengubah izin di Android Settings, buka ulang aplikasi MYPRESENCE lalu masuk Home.</p>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase">Total User</div>
                                    <div className="text-xl font-bold text-slate-800 dark:text-slate-200">{tokenHealthSummary.totalUsers}</div>
                                </div>
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                                    <div className="text-[10px] font-bold text-emerald-600 uppercase">Push Ready</div>
                                    <div className="text-xl font-bold text-emerald-700 dark:text-emerald-500">{tokenHealthSummary.pushReady}</div>
                                </div>
                                <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg">
                                    <div className="text-[10px] font-bold text-rose-600 uppercase">Permission Blocked</div>
                                    <div className="text-xl font-bold text-rose-700 dark:text-rose-500">{tokenHealthSummary.permissionBlocked}</div>
                                </div>
                                <div className="p-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                                    <div className="text-[10px] font-bold text-slate-500 uppercase">No Active Token</div>
                                    <div className="text-xl font-bold text-slate-700 dark:text-slate-300">{tokenHealthSummary.noActiveToken}</div>
                                </div>
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                                    <div className="text-[10px] font-bold text-amber-600 uppercase">Old Token Only</div>
                                    <div className="text-xl font-bold text-amber-700 dark:text-amber-500">{tokenHealthSummary.oldTokenOnly}</div>
                                </div>
                            </div>
                        </div>

                        {/* Token Filters Row */}
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-25 flex flex-wrap gap-4 items-end">
                            <div>
                                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Filter Notifikasi</label>
                                <div className="flex flex-wrap gap-2">
                                    <button 
                                        onClick={() => setTokenStatusFilter("all")}
                                        className={`px-3 py-1 text-xs rounded border transition ${tokenStatusFilter === "all" ? "bg-slate-800 text-white dark:bg-slate-700 border-slate-800" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
                                    >
                                        Semua
                                    </button>
                                    <button 
                                        onClick={() => setTokenStatusFilter("current")}
                                        className={`px-3 py-1 text-xs rounded border transition ${tokenStatusFilter === "current" ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
                                    >
                                        Current Only
                                    </button>
                                    <button 
                                        onClick={() => setTokenStatusFilter("active")}
                                        className={`px-3 py-1 text-xs rounded border transition ${tokenStatusFilter === "active" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
                                    >
                                        Active Only
                                    </button>
                                    <button 
                                        onClick={() => setTokenStatusFilter("push_ready")}
                                        className={`px-3 py-1 text-xs rounded border transition ${tokenStatusFilter === "push_ready" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
                                    >
                                        Push Ready
                                    </button>
                                    <button 
                                        onClick={() => setTokenStatusFilter("blocked")}
                                        className={`px-3 py-1 text-xs rounded border transition ${tokenStatusFilter === "blocked" ? "bg-rose-600 text-white border-rose-600" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
                                    >
                                        Permission Blocked
                                    </button>
                                    <button 
                                        onClick={() => setTokenStatusFilter("inactive")}
                                        className={`px-3 py-1 text-xs rounded border transition ${tokenStatusFilter === "inactive" ? "bg-slate-500 text-white border-slate-500" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800"}`}
                                    >
                                        Inactive/Old
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Filter Notifikasi Izin Klien</label>
                                <select 
                                    value={tokenPermFilter}
                                    onChange={e => setTokenPermFilter(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-xs text-slate-700 dark:text-slate-300"
                                >
                                    <option value="all">Semua Izin</option>
                                    <option value="granted">Diizinkan</option>
                                    <option value="denied">Diblokir / Ditolak</option>
                                </select>
                            </div>
                        </div>

                        {loadingTokens ? (
                            <div className="p-16 flex flex-col items-center justify-center text-slate-400 gap-2">
                                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">Menghubungkan ke db. scanning token karyawan...</div>
                            </div>
                        ) : filteredTokenHealth.length === 0 ? (
                            <div className="p-16 text-center text-slate-400 text-sm">Tidak ada Token terdaftar untuk filter ini atau data belum dipindai. Silakan klik tombol "Pindai Sembari Sinkron".</div>
                        ) : (
                            <div className="overflow-auto max-h-[550px]">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-500 sticky top-0 z-10 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Karyawan</th>
                                            <th className="px-4 py-3 font-medium">Platform & Izin</th>
                                            <th className="px-4 py-3 font-medium">Token ID Ringkas</th>
                                            <th className="px-4 py-3 font-medium">Kesehatan/Alasan Invalidate</th>
                                            <th className="px-4 py-3 font-medium">Terakhir Diperbarui</th>
                                            <th className="px-4 py-3 font-medium">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {filteredTokenHealth.map((tok, idx) => (
                                            <tr key={`${tok.token_id}_${tok.uid}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs">
                                                <td className="px-4 py-3">
                                                    <div className="font-semibold text-slate-800 dark:text-slate-200">{getUserLabel(tok.uid)}</div>
                                                    <div className="text-[10px] text-slate-400">
                                                        Role: <span className="uppercase">{tok.role}</span>
                                                        {tok.source_label && (
                                                            <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded uppercase">
                                                                {tok.source_label}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {showTechnicalIds && <div className="text-[10px] text-slate-400 font-mono mt-1">UID: {maskId(tok.uid, "UID")}</div>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-slate-700 dark:text-slate-300 capitalize flex items-center gap-1.5">{tok.platform || "android"} {tok.is_current && <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 text-[9px] px-1 py-0.5 rounded uppercase font-bold tracking-wider">Current</span>}</div>
                                                    <div className="mt-0.5">
                                                        {tok.effective_status === "current_ok" && (
                                                            <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-[10px] px-1.5 py-0.5 rounded font-medium">Push Ready</span>
                                                        )}
                                                        {tok.effective_status === "current_blocked" && (
                                                            <span className="bg-rose-50 text-rose-700 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800 text-[10px] px-1.5 py-0.5 rounded font-medium">Izin Statusbar Diblokir</span>
                                                        )}
                                                        {tok.effective_status === "old" && (
                                                            <span className="bg-slate-100 text-slate-500 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] px-1.5 py-0.5 rounded font-medium">Token Lama / Superseded</span>
                                                        )}
                                                        {tok.effective_status === "inactive" && (
                                                            <span className="bg-slate-50 text-slate-400 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 text-[10px] px-1.5 py-0.5 rounded font-medium">Tidak Ada Token Aktif</span>
                                                        )}
                                                        {tok.effective_status === "superseded" && (
                                                            <span className="bg-amber-50 text-amber-600 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-[10px] px-1.5 py-0.5 rounded font-medium">Token Lama / Superseded</span>
                                                        )}
                                                    </div>
                                                    {tok.active && (!tok.permission_last_checked_at || (Date.now() - tok.permission_last_checked_at) > 86400000) && (
                                                        <div className="mt-1 text-[9px] text-amber-600 font-medium max-w-[150px]">
                                                            Status izin belum disinkron terbaru. Minta user buka aplikasi MYPRESENCE.
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 font-mono text-[10px]">
                                                    <div className="max-w-[120px] truncate">
                                                        {showTechnicalIds ? maskId(tok.token_id, "TokenID") : "(Tersembunyi)"}
                                                    </div>
                                                    {showTechnicalIds && <div className="text-[9px] text-slate-400 max-w-[120px] truncate" title={tok.token}>Val: {maskId(tok.token, "TokenVal")}</div>}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        {tok.active ? (
                                                            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30">Active</span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-900/30">Inactive</span>
                                                        )}
                                                    </div>
                                                    {tok.invalid_reason && (
                                                        <div className="text-[10px] text-rose-500 font-medium font-mono whitespace-normal max-w-[180px]">
                                                            {tok.invalid_reason}
                                                        </div>
                                                    )}
                                                    {tok.invalidated_at && (
                                                        <div className="text-[9px] text-slate-400">
                                                            Sebab: {formatTime(tok.invalidated_at)}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-[10px] text-slate-500">
                                                    <div>Up: {tok.updated_at ? formatTime(tok.updated_at) : "-"}</div>
                                                    <div>Seen: {tok.last_seen_at ? formatTime(tok.last_seen_at) : "-"}</div>
                                                    <div>Check: {tok.permission_last_checked_at ? formatTime(tok.permission_last_checked_at) : "-"}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex gap-2">
                                                        {/* Test push user */}
                                                        {tok.is_current && (
                                                            <button 
                                                                onClick={async () => {
                                                                    toast.loading("Mengirim test push...", { id: "test_push" });
                                                                    try {
                                                                        const { createUserNotificationAndPush } = await import("../services/notificationDeliveryService");
                                                                        await createUserNotificationAndPush({
                                                                            companyId: targetCompanyId,
                                                                            uid: tok.uid,
                                                                            title: "Test Push MYPRESENCE",
                                                                            body: "Ini test push untuk token aktif terbaru.",
                                                                            type: "test_push",
                                                                            refType: "system",
                                                                            refId: `token_health_test_${Date.now()}`,
                                                                            skipSettingsCheck: true,
                                                                        });
                                                                        toast.success("Test push terkirim!", { id: "test_push" });
                                                                    } catch(err: any) {
                                                                        toast.error(`Kirim test gagal: ${err.message}`, { id: "test_push" });
                                                                    }
                                                                }}
                                                                className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-semibold transition"
                                                            >
                                                                Uji Push
                                                            </button>
                                                        )}
                                                        
                                                        {/* Force deactivate */}
                                                        {tok.active && (
                                                            <button 
                                                                onClick={() => handleDeactivateToken(tok)}
                                                                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-semibold transition flex items-center gap-0.5"
                                                                title="Nonaktifkan Token secara paksa"
                                                            >
                                                                <Power className="w-2.5 h-2.5" /> Deaktif
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 4: Scheduler Run Logs (PATCH-05 & PATCH-06) */}
            {activeTab === "scheduler" && (
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-between items-start">
                            <div>
                                <h2 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                   <Clock className="w-5 h-5 text-purple-500" /> Log Scheduler Reminder Attendance
                                </h2>
                                <p className="text-[11px] text-slate-500 mt-0.5">Riwayat berjalannya pembuat pengingat otomatis absensi masuk & pulang oleh Cloud Functions secara berkala</p>
                            </div>
                            <button
                                onClick={handleResetDedupeToday}
                                disabled={resetDedupeLoading || !targetCompanyId}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 border ${
                                    (resetDedupeLoading || !targetCompanyId)
                                        ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed border-slate-250 dark:border-slate-700"
                                        : "bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 dark:text-rose-400 border-rose-200 dark:border-rose-800/50"
                                }`}
                                title={!targetCompanyId ? "Pilih perusahaan terlebih dahulu" : "Bypass dedupe untuk keperluan testing hari ini"}
                            >
                                <ListRestart className={`w-3.5 h-3.5 ${resetDedupeLoading ? "animate-spin" : ""}`} />
                                {resetDedupeLoading ? "Mereset..." : "Reset Dedupe Test Hari Ini"}
                            </button>
                        </div>

                        {(resetDedupeLoading || resetDedupeResult || resetDedupeError) && (
                            <div className={`mx-4 mt-3 rounded-lg border p-3 text-xs ${
                                resetDedupeError
                                    ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/50"
                                    : resetDedupeLoading
                                    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-900/50"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/50"
                            }`}>
                                {resetDedupeLoading && (
                                    <div className="font-semibold">
                                        Reset dedupe sedang berjalan...
                                    </div>
                                )}

                                {resetDedupeError && (
                                    <>
                                        <div className="font-bold">Reset dedupe gagal.</div>
                                        <div className="font-mono mt-1 break-all">{resetDedupeError}</div>
                                    </>
                                )}

                                {resetDedupeResult && !resetDedupeError && (
                                    <>
                                        <div className="font-bold">Reset dedupe selesai.</div>
                                        <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2 font-mono">
                                            <div>Tanggal: {resetDedupeResult.date}</div>
                                            <div>Cocok: {resetDedupeResult.matched_count || 0}</div>
                                            <div>Terhapus: {resetDedupeResult.deleted_count || 0}</div>
                                            <div>Waktu: {new Date(resetDedupeResult.ran_at).toLocaleTimeString("id-ID")}</div>
                                        </div>

                                        {(resetDedupeResult.matched_sample || []).length > 0 ? (
                                            <details className="mt-2">
                                                <summary className="cursor-pointer font-semibold">Lihat queue yang direset</summary>
                                                <div className="mt-2 max-h-32 overflow-auto rounded bg-white/60 dark:bg-slate-950/50 p-2 font-mono text-[10px]">
                                                    {(resetDedupeResult.matched_sample || []).map((item: any, index: number) => (
                                                        <div key={`${item.queue_id || index}`} className="border-b border-slate-200 dark:border-slate-800 py-1 last:border-0">
                                                            <div>Queue: {item.queue_id}</div>
                                                            <div>Notification: {item.notification_id}</div>
                                                            <div>UID: {item.uid || "-"}</div>
                                                            <div>Status: {item.status || "-"}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        ) : (
                                            <div className="mt-2 text-amber-600 dark:text-amber-300">
                                                Tidak ada queue reminder yang cocok untuk direset. Jika masih muncul dedupe, cek tanggal Jakarta, UID, action/stage, atau pastikan function terbaru sudah dideploy.
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {schedulerLogs.length === 0 ? (
                            <div className="p-16 text-center text-slate-400 text-sm">Belum ada riwayat berjalan scheduler log. Silakan pastikan Cloud Functions scheduler berjalan lancar di Firebase.</div>
                        ) : (
                            <div className="overflow-auto max-h-[500px]">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-500 sticky top-0 z-10 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                            <th className="px-4 py-3 font-medium">Run ID & Tanggal (Jakarta)</th>
                                            <th className="px-4 py-3 font-medium">Waktu Berjalan</th>
                                            <th className="px-4 py-3 font-medium">Ringkasan Statistik</th>
                                            <th className="px-4 py-3 font-medium">Analisis Skip Reasons (Mengapa Dilewati?)</th>
                                            <th className="px-4 py-3 font-medium">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                        {schedulerLogs.map((log) => {
                                            const duration = log.finished_at && log.started_at ? `${((log.finished_at - log.started_at)/1000).toFixed(2)}s` : "-";
                                            const reasons = log.skip_reasons || {};
                                            return (
                                                <React.Fragment key={log.id}>
                                                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono">
                                                        <div className="font-bold text-slate-800 dark:text-slate-200">{log.run_id}</div>
                                                        <div className="text-[10px] text-slate-500">Jakarta: {log.date} @ {log.time}</div>
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-500">
                                                        <div>Start: {formatTime(log.started_at)}</div>
                                                        <div>Heartbeat: {log.heartbeat_at ? formatTime(log.heartbeat_at) : "-"}</div>
                                                        <div>Durasi: <span className="font-semibold text-slate-750">{duration}</span></div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="space-y-0.5 text-[11px]">
                                                            <div>Processed: <span className="font-bold text-slate-800 dark:text-slate-200">{log.processed_users || 0} user</span></div>
                                                            <div>Sent: <span className="font-bold text-emerald-600">+{log.sent_count || 0}</span></div>
                                                            <div>Skipped: <span className="font-bold text-amber-600">{log.skipped_count || 0}</span></div>
                                                            {log.failed_count > 0 && <div>Failed: <span className="font-bold text-red-600">{log.failed_count || 0}</span></div>}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-normal max-w-[320px]">
                                                        {Object.keys(reasons).length === 0 ? (
                                                            <div className="text-[10px] text-slate-400">Tidak ada rincian log skip.</div>
                                                        ) : (
                                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-100 dark:border-slate-800 text-[10px]">
                                                                {reasons.settings_disabled > 0 && <div className="text-slate-500">Settings Dinonaktifkan: <span className="font-bold">{reasons.settings_disabled}</span></div>}
                                                                {reasons.holiday > 0 && <div className="text-slate-500 font-medium">Hari Libur Perusahaan: <span className="font-bold text-blue-600">{reasons.holiday}</span></div>}
                                                                {reasons.inactive_user > 0 && <div className="text-slate-500">User Inaktif: <span className="font-bold">{reasons.inactive_user}</span></div>}
                                                                {reasons.no_schedule > 0 && <div className="text-slate-500 font-medium">No Schedule/Shift: <span className="font-bold text-slate-700 dark:text-slate-300">{reasons.no_schedule}</span></div>}
                                                                {reasons.not_workday > 0 && <div className="text-slate-500">Bukan Hari Kerja: <span className="font-bold">{reasons.not_workday}</span></div>}
                                                                {reasons.no_assignment > 0 && <div className="text-slate-500 font-medium">No Assignment: <span className="font-bold text-slate-700 dark:text-slate-300">{reasons.no_assignment}</span></div>}
                                                                {reasons.shift_not_found > 0 && <div className="text-rose-500 font-medium">Shift Not Found: <span className="font-bold text-rose-700">{reasons.shift_not_found}</span></div>}
                                                                {reasons.shift_day_inactive > 0 && <div className="text-slate-500">Hari Kerja Inaktif: <span className="font-bold">{reasons.shift_day_inactive}</span></div>}
                                                                {reasons.shift_day_timetable_missing > 0 && <div className="text-rose-500 font-medium">Timetable Hilang: <span className="font-bold text-rose-700">{reasons.shift_day_timetable_missing}</span></div>}
                                                                {reasons.invalid_timetable > 0 && <div className="text-rose-500 font-medium">Timetable Error: <span className="font-bold">{reasons.invalid_timetable}</span></div>}
                                                                {reasons.duplicate_notification > 0 && <div className="text-slate-500 font-medium">Already Sent/Dedupe: <span className="font-bold text-emerald-600">{reasons.duplicate_notification}</span></div>}
                                                                {reasons.outside_reminder_window > 0 && <div className="text-slate-400">Luar Window: <span className="font-bold">{reasons.outside_reminder_window}</span></div>}
                                                                {reasons.stale_pre_blocked > 0 && <div className="text-amber-600 font-medium">Pre Basi Diblokir: <span className="font-bold">{reasons.stale_pre_blocked}</span></div>}
                                                                {reasons.already_check_in > 0 && <div className="text-emerald-600 font-medium font-semibold">Sudah Absen Masuk: <span className="font-bold">{reasons.already_check_in}</span></div>}
                                                                {reasons.already_check_out > 0 && <div className="text-emerald-600 font-medium font-semibold">Sudah Absen Pulang: <span className="font-bold">{reasons.already_check_out}</span></div>}
                                                                {reasons.approved_leave > 0 && <div className="text-blue-500 font-semibold text-blue-600">Cuti Disetujui: <span className="font-bold">{reasons.approved_leave}</span></div>}
                                                                {reasons.duplicate_notification > 0 && <div className="text-slate-500">Already Sent / Dedupe: <span className="font-bold">{reasons.duplicate_notification}</span></div>}
                                                            </div>
                                                        )}
                                                        {log.notes && (
                                                            <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-1 italic">
                                                                Notes: {log.notes}
                                                            </div>
                                                        )}
                                                        {log.status === "failed" && (
                                                            <div className="mt-3 rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-300 whitespace-normal">
                                                                <div className="font-bold mb-1">Scheduler Error</div>
                                                                <div className="font-mono break-all text-[11px] leading-relaxed select-all">{log.error_message || "-"}</div>
                                                                {showTechnicalIds && log.error_stack && (
                                                                    <details className="mt-2 text-[10px]">
                                                                        <summary className="cursor-pointer font-semibold outline-none hover:text-red-800 dark:hover:text-red-400">Stack trace</summary>
                                                                        <pre className="mt-2 whitespace-pre-wrap font-mono text-[9px] bg-red-100/50 dark:bg-slate-950 p-2 rounded max-h-40 overflow-auto">{log.error_stack}</pre>
                                                                    </details>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex flex-col items-start gap-1">
                                                            {log.status === "running" ? (
                                                                <span className="bg-blue-50 text-blue-700 dark:bg-blue-100/10 text-[10px] px-2 py-0.5 rounded-full font-bold border border-blue-300 dark:border-blue-900/30 uppercase tracking-wider animate-pulse">Running</span>
                                                            ) : log.status === "failed" ? (
                                                                <span className="bg-red-50 text-red-700 dark:bg-red-100/10 text-[10px] px-2 py-0.5 rounded-full font-bold border border-red-300 dark:border-red-900/30 uppercase tracking-wider">Failed</span>
                                                            ) : (
                                                                <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-100/10 text-[10px] px-2 py-0.5 rounded-full font-bold border border-emerald-300 dark:border-emerald-900/30 uppercase tracking-wider">Success</span>
                                                            )}
                                                            {log.status === "running" && log.started_at && (Date.now() - log.started_at > 180000) && (
                                                                <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1 whitespace-normal max-w-[124px]">
                                                                    Running terlalu lama. Cek Firebase Function Logs.
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                                <tr key={`diag_${log.id}`}>
                                                    <td colSpan={5} className="p-0 border-t-0 bg-slate-50/50 dark:bg-slate-900/50">
                                                        <details className="w-full">
                                                            <summary className="text-[10px] uppercase font-bold text-slate-500 cursor-pointer outline-none hover:text-slate-800 dark:hover:text-slate-300 p-2 pl-4 border-t border-slate-100 dark:border-slate-800/50">
                                                                &#9656; Tampilkan Diagnostik User & Timing ({log.user_diagnostics ? log.user_diagnostics.length : 0} sample)
                                                            </summary>
                                                            <div className="p-4 flex flex-col lg:flex-row gap-6 bg-slate-50 dark:bg-slate-900">
                                                                {log.timing_settings ? (
                                                                    <div className="flex-none lg:w-1/3 space-y-2">
                                                                        <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Konfigurasi Waktu Tersimpan (Legacy)</h4>
                                                                        <div className="bg-white dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800 text-[10px] font-mono grid grid-cols-2 gap-2 text-slate-600 dark:text-slate-400 opacity-60">
                                                                            <div className="col-span-2">Format log lama.</div>
                                                                        </div>
                                                                    </div>
                                                                ) : log.reminder_settings ? (
                                                                    <div className="flex-none lg:w-1/3 space-y-2">
                                                                        <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Setting Reminder Tersimpan</h4>
                                                                        <div className="bg-white dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800 text-[10px] font-mono flex flex-col gap-2 text-slate-600 dark:text-slate-400">
                                                                            <div>Source: {log.reminder_settings.source}</div>
                                                                            <div className="border-t border-slate-100 dark:border-slate-800 pt-1 mt-1">
                                                                                <span className="font-bold text-slate-800 dark:text-slate-200">Masuk:</span> 
                                                                                {log.reminder_settings.check_in_pre_enabled ? ` pre(${log.reminder_settings.check_in_pre_minutes}m)` : ""}
                                                                                {log.reminder_settings.check_in_now_enabled ? ` now(${log.reminder_settings.check_in_now_window_minutes}m)` : ""}
                                                                                {log.reminder_settings.check_in_late_enabled ? ` late(${log.reminder_settings.check_in_late_minutes}m)` : ""}
                                                                            </div>
                                                                            <div>
                                                                                <span className="font-bold text-slate-800 dark:text-slate-200">Pulang:</span> 
                                                                                {log.reminder_settings.check_out_pre_enabled ? ` pre(${log.reminder_settings.check_out_pre_minutes}m)` : ""}
                                                                                {log.reminder_settings.check_out_now_enabled ? ` now(${log.reminder_settings.check_out_now_window_minutes}m)` : ""}
                                                                                {log.reminder_settings.check_out_late_enabled ? ` late(${log.reminder_settings.check_out_late_minutes}m)` : ""}
                                                                            </div>
                                                                            <div className="text-blue-600 dark:text-blue-400 font-bold border-t border-slate-100 dark:border-slate-800 pt-1 mt-1">
                                                                                Catch-up Window: {log.reminder_settings.scheduler_catchup_minutes}m
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ) : log.reminder_defaults ? (
                                                                     <div className="flex-none lg:w-1/3 space-y-2">
                                                                        <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Default Reminder</h4>
                                                                        <div className="bg-white dark:bg-slate-950 p-2.5 rounded border border-slate-200 dark:border-slate-800 text-[10px] font-mono flex flex-col gap-2 text-slate-600 dark:text-slate-400">
                                                                            <div>Masuk: {log.reminder_defaults.check_in_before_minutes} menit sebelum jam masuk</div>
                                                                            <div>Pulang: {log.reminder_defaults.check_out_after_minutes} menit setelah jam pulang</div>
                                                                            <div className="text-blue-600 dark:text-blue-400 font-bold border-t border-slate-100 dark:border-slate-800 pt-1 mt-1">Window: {log.reminder_defaults.scheduler_window_minutes}m</div>
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                                <div className="flex-1 space-y-2">
                                                                    <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Sampling Diagnostik (Maks 50)</h4>
                                                                    {log.user_diagnostics && log.user_diagnostics.length > 0 ? (
                                                                        <div className="max-h-60 overflow-auto bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded">
                                                                            <table className="w-full text-left border-collapse">
                                                                                <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0">
                                                                                    <tr className="text-[9px] uppercase text-slate-500 font-semibold tracking-wider">
                                                                                        <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-800">User</th>
                                                                                        <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-800">Waktu App</th>
                                                                                        <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-800">Jadwal</th>
                                                                                        <th className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-800">Hasil Evaluasi</th>
                                                                                        <th className="px-2 py-1.5">Action Stage</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="text-[10px] divide-y divide-slate-100 dark:divide-slate-800 font-mono">
                                                                                    {log.user_diagnostics.map((diag: any, i: number) => {
                                                                                        const isSent = diag.reason === "sent";
                                                                                        return (
                                                                                            <tr key={i} className={isSent ? 'bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}>
                                                                                                <td className="px-2 py-1.5 truncate max-w-[120px] border-r border-slate-200 dark:border-slate-800" title={showTechnicalIds ? diag.uid : undefined}>
                                                                                                    {diag.user_name || getUserLabel(diag.uid)}
                                                                                                </td>
                                                                                                <td className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-800">{diag.current_time}</td>
                                                                                                <td className="px-2 py-1.5 border-r border-slate-200 dark:border-slate-800">{diag.work_start}-{diag.work_end}</td>
                                                                                                <td className={`px-2 py-1.5 font-semibold border-r border-slate-200 dark:border-slate-800 ${isSent ? 'text-emerald-600' : (diag.reason === "outside_reminder_window" || diag.reason === "before_pre_window" || diag.reason === "after_late_window" ? "text-slate-400" : "text-amber-600")}`}
                                                                                                    title={`Key: ${diag.day_key || '-'} | Mode: ${diag.workday_mode || '-'} | Shift: ${diag.shift_name || '-'} | Timetable: ${diag.timetable_id || '-'} | Group: ${diag.user_group_id || '-'} \nSource: ${diag.settings_source || '-'}\nCheckIn: pre(${diag.check_in_stage_debug?.pre_target_clock||'-'}) now(${diag.check_in_stage_debug?.now_target_clock||'-'}) late(${diag.check_in_stage_debug?.late_target_clock||'-'})\nCheckOut: pre(${diag.check_out_stage_debug?.pre_target_clock||'-'}) now(${diag.check_out_stage_debug?.now_target_clock||'-'}) late(${diag.check_out_stage_debug?.late_target_clock||'-'})`}
                                                                                                >
                                                                                                    <div>
                                                                                                        {diag.reason === "shift_day_inactive" ? "not_workday: shift_day_inactive" : 
                                                                                                         diag.reason === "shift_day_timetable_missing" ? "not_workday: shift_day_timetable_missing" :
                                                                                                         diag.reason === "shift_not_found" ? "no_assignment: shift_not_found" :
                                                                                                         diag.reason === "no_assignment" ? "no_assignment: cek Terapkan Jadwal" :
                                                                                                         diag.reason === "duplicate_notification" ? "already_sent_dedupe: sudah pernah dikirim" :
                                                                                                         diag.reason === "stale_pre_blocked" ? "stale_pre_blocked: pre lewat, pakai now/late atau skip" :
                                                                                                         diag.reason === "sent" ? `Sent: ${diag.reminder_action}/${diag.reminder_stage}${diag.selected_stage_debug?.remaining_minutes != null ? ` -> ${diag.selected_stage_debug.remaining_minutes}m lagi` : ""} → target ${diag.reminder_target_clock || '-'}` :
                                                                                                         diag.reason === "outside_reminder_window" ? `Luar window: current ${diag.current_time || ''}, pre target ${diag.check_in_stage_debug?.pre_target_clock || '-'}` :
                                                                                                         diag.reason === "before_pre_window" ? "Belum masuk waktu reminder" :
                                                                                                         diag.reason === "between_now_and_late_window" ? "Lewat now, menunggu late" :
                                                                                                         diag.reason === "after_late_window" ? "Lewat semua window" :
                                                                                                         diag.reasonLabel || diag.reason}
                                                                                                    </div>
                                                                                                    {(() => {
                                                                                                        const debug = diag.selected_stage_debug || diag.check_in_stage_debug || diag.check_out_stage_debug;
                                                                                                        if (debug) {
                                                                                                            return (
                                                                                                                <details className="mt-1 text-[10px] text-slate-400 font-mono font-normal">
                                                                                                                    <summary className="cursor-pointer text-[9px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Detail timing</summary>
                                                                                                                    <div className="pl-1 border-l border-slate-200 dark:border-slate-800 mt-1 space-y-0.5 text-[9px]">
                                                                                                                        <div>Pre: {debug.pre_target_clock || "-"}</div>
                                                                                                                        <div>Now: {debug.now_target_clock || "-"}</div>
                                                                                                                        <div>Late: {debug.late_target_clock || "-"}</div>
                                                                                                                        <div>Pre window: {debug.pre_window_start_clock || "-"} - {debug.pre_window_end_clock || "-"}</div>
                                                                                                                        {debug.remaining_minutes != null && <div>Remaining: {debug.remaining_minutes}m</div>}
                                                                                                                        {debug.selected_window && <div>Window: {debug.selected_window}</div>}
                                                                                                                    </div>
                                                                                                                </details>
                                                                                                            );
                                                                                                        }
                                                                                                        return null;
                                                                                                    })()}
                                                                                                </td>
                                                                                                <td className="px-2 py-1.5">
                                                                                                    {isSent ? `[${diag.reminder_action} - ${diag.reminder_stage}]` : "-"}
                                                                                                </td>
                                                                                            </tr>
                                                                                        )
                                                                                    })}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-[10px] text-slate-400">Tidak ada sampel diagnostik tersimpan.</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </details>
                                                    </td>
                                                </tr>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                isDestructive={confirmModal.isDestructive}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal({ ...confirmModal, isOpen: false })}
            />
        </div>
    );
};
