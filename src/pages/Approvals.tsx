import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ref, onValue, update, get } from "firebase/database";
import { db } from "../firebase";
import { paths } from "../services/paths";
import { Company } from "../types";
import { createNotification } from "../services/notificationService";
import { writeAuditLog } from "../services/auditService";
import { getFileUrl } from "../services/storageService";
import { resolveScheduleForUser } from "../services/scheduleResolver";
import toast from "react-hot-toast";

const textValue = (...values: any[]) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
};

const leaveTypeValue = (req: any) => textValue(req.type, req.leave_type, "izin").toLowerCase();

const isPendingStatus = (status?: string) => {
  const value = String(status || "pending").toLowerCase();
  return value === "pending" || value === "pending_admin" || value === "processing";
};

const statusLabel = (status?: string) => {
  const value = String(status || "").toLowerCase();
  if (value === "approved" || value === "success") return "Disetujui";
  if (value === "rejected" || value === "failed") return "Ditolak";
  return "Selesai";
};

const meterValue = (value: any) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(0)}m` : "-";
};

const leaveTypeLabel = (type: string) => {
  switch (type.toLowerCase()) {
    case "sakit":
      return "Sakit";
    case "cuti":
      return "Cuti";
    case "lembur":
      return "Lembur";
    default:
      return "Izin";
  }
};

const employeeName = (req: any) => textValue(req.user_name, req.nama_lengkap, req.employee_name, req.name, "-");
const employeeNip = (req: any) => textValue(req.nip, req.employee_id, "-");
const startDateValue = (req: any) => textValue(req.date_start, req.tanggal_mulai, req.date, req.tanggal, "-");
const endDateValue = (req: any) => textValue(req.date_end, req.tanggal_selesai, req.date_start, req.tanggal_mulai, req.date, req.tanggal, "-");
const reasonValue = (req: any) => textValue(req.reason, req.alasan, "-");
const attachmentSource = (req: any) => textValue(req.attachment_url, req.attachment_path);
const attachmentName = (req: any) => textValue(req.attachment_name, "Lampiran");

const formatDateRange = (req: any) => {
  const start = startDateValue(req);
  const end = endDateValue(req);
  if (!end || end === "-" || end === start) return start;
  return `${start} - ${end}`;
};

const formatDuration = (minuteValue: any) => {
  const minutes = Number(minuteValue || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "-";
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  if (hours <= 0) return `${minutes} menit`;
  if (remain <= 0) return `${hours} jam`;
  return `${hours} jam ${remain} menit`;
};

export const Approvals: React.FC = () => {
  const { userData } = useAuth();
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [qrRequests, setQrRequests] = useState<any[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"leave" | "qr" | "correction">("leave");
  const [error, setError] = useState("");
  const [queryStatus, setQueryStatus] = useState("");
  
  const [searchParams] = useSearchParams();

  const isOwner = userData?.role === "owner";

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "leave" || tab === "qr" || tab === "correction") {
      setActiveTab(tab);
    }
    setQueryStatus(searchParams.get("status") || "");
  }, [searchParams]);

  useEffect(() => {
    if (isOwner) {
      get(ref(db, paths.companies())).then((snapshot) => {
        if (snapshot.exists()) {
           const data = snapshot.val();
           const compList = Object.keys(data).map(k => ({...data[k], id: k}));
           setCompanies(compList);
           if (compList.length > 0 && !targetCompanyId) {
             setTargetCompanyId(compList[0].id);
           }
        }
      });
    } else if (userData?.company_id) {
      setTargetCompanyId(userData.company_id);
    }
  }, [isOwner, userData]);

  useEffect(() => {
    if (!targetCompanyId) {
       setLoading(false);
       setLeaveRequests([]);
       setQrRequests([]);
       setCorrectionRequests([]);
       return;
    }

    setLoading(true);
    setError("");
    
    const leaveRef = ref(db, paths.leaveRequests(targetCompanyId));
    const qrRef = ref(db, paths.qrRequests(targetCompanyId));
    const correctionRef = ref(db, paths.attendanceCorrections(targetCompanyId));

    let loadedCount = 0;
    const checkDone = () => {
        loadedCount++;
        if (loadedCount >= 3) setLoading(false);
    };

    const unsubLeave = onValue(leaveRef, (snapshot) => {
       if (snapshot.exists()) {
          const data = snapshot.val();
          setLeaveRequests(Object.keys(data).map(key => ({...data[key], request_id: key})));
       } else {
          setLeaveRequests([]);
       }
       checkDone();
    }, (err) => {
       setError((prev) => prev ? prev + "\n" + err.message : err.message);
       checkDone();
    });

    const unsubQR = onValue(qrRef, (snapshot) => {
       if (snapshot.exists()) {
          const data = snapshot.val();
          setQrRequests(Object.keys(data).map(key => ({...data[key], request_id: key})));
       } else {
          setQrRequests([]);
       }
       checkDone();
    }, (err) => {
       setError((prev) => prev ? prev + "\n" + err.message : err.message);
       checkDone();
    });

    const unsubCorrection = onValue(correctionRef, (snapshot) => {
       if (snapshot.exists()) {
          const data = snapshot.val();
          setCorrectionRequests(Object.keys(data).map(key => ({...data[key], request_id: key})));
       } else {
          setCorrectionRequests([]);
       }
       checkDone();
    }, (err) => {
       setError((prev) => prev ? prev + "\n" + err.message : err.message);
       checkDone();
    });

    return () => {
        unsubLeave();
        unsubQR();
        unsubCorrection();
    };
  }, [targetCompanyId]);

  const [actionReq, setActionReq] = useState<any>(null);
  const [actionType, setActionType] = useState<"leave" | "qr" | "correction">("leave");
  const [actionStatus, setActionStatus] = useState<"approved" | "rejected">("approved");
  const [adminNote, setAdminNote] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [resolvedPhotoUrl, setResolvedPhotoUrl] = useState<string | null>(null);
  const [detailReq, setDetailReq] = useState<any | null>(null);
  const [detailType, setDetailType] = useState<"leave" | "qr" | "correction">("leave");

  useEffect(() => {
    setImageLoadError(false);
  }, [previewAttachment]);

  useEffect(() => {
    if (detailReq) {
      if (detailType === "qr") {
        const source = detailReq.photo_url || detailReq.photo_path;
        if (source) {
          if (typeof source === "string" && source.startsWith("http")) {
            setResolvedPhotoUrl(source);
          } else {
            getFileUrl(source).then(url => {
              setResolvedPhotoUrl(url);
            }).catch(() => {
              setResolvedPhotoUrl(null);
            });
          }
        } else {
          setResolvedPhotoUrl(null);
        }
      } else {
        setResolvedPhotoUrl(null);
      }
    } else {
      setResolvedPhotoUrl(null);
    }
  }, [detailReq, detailType]);

  const openAttachment = async (req: any) => {
    let source = "";
    if (typeof req === "string") {
      source = req;
    } else if (req) {
      if (req.photo_url || req.photo_path) {
        source = req.photo_url || req.photo_path;
      } else {
        source = req.attachment_url || req.attachment_path || "";
      }
    }

    if (!source) {
      toast.error("Foto/lampiran tidak tersedia.");
      return;
    }

    try {
      const url = await getFileUrl(source);
      if (url) {
        setPreviewAttachment(url);
      } else {
        toast.error("Foto/lampiran belum bisa dimuat.");
      }
    } catch (error: any) {
      toast.error(error?.message || "Foto/lampiran belum bisa dimuat.");
    }
  };

  const openDetail = (req: any, type: "leave" | "qr" | "correction") => {
      setDetailReq(req);
      setDetailType(type);
  };

  const processingRef = React.useRef(false);

  const confirmAction = async () => {
    if (!actionReq) return;
    if (processingRef.current) return;
    if (actionStatus === "rejected" && !adminNote.trim()) {
        toast.error("Alasan penolakan wajib diisi.");
        return;
    }
    processingRef.current = true;
    setSavingAction(true);
    
    const processApproval = async () => {
      let currentStatus = "pending";
      if (actionType === "leave") {
          const snap = await get(ref(db, paths.leaveRequest(targetCompanyId, actionReq.request_id)));
          if (snap.exists()) {
              currentStatus = snap.val().status;
          } else {
              throw new Error("Request tidak ditemukan.");
          }
      } else if (actionType === "qr") {
          const snap = await get(ref(db, paths.qrRequest(targetCompanyId, actionReq.request_id)));
          if (snap.exists()) {
              currentStatus = snap.val().status;
          } else {
              throw new Error("Request tidak ditemukan.");
          }
      } else if (actionType === "correction") {
          const snap = await get(ref(db, paths.attendanceCorrection(targetCompanyId, actionReq.request_id)));
          if (snap.exists()) {
              currentStatus = snap.val().status;
          } else {
              throw new Error("Request tidak ditemukan.");
          }
      }

      if (!isPendingStatus(currentStatus)) {
          throw new Error(`Request ini sudah diproses (${currentStatus}). Muat ulang halaman untuk melihat status terbaru.`);
      }

      if (actionType === "leave") {
          const currentType = leaveTypeValue(actionReq);
          const currentLabel = leaveTypeLabel(currentType);
          const noteText = adminNote.trim();

          const updates: any = {};
          updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/status`] = actionStatus;
          updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/admin_note`] = noteText;
          if (actionStatus === "approved") {
              updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/approved_by`] = userData?.uid;
              updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/approved_by_name`] = userData?.nama_lengkap;
              updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/approved_at`] = Date.now();
          } else {
              updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/rejected_by`] = userData?.uid;
              updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/rejected_by_name`] = userData?.nama_lengkap;
              updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/rejected_at`] = Date.now();
          }
          updates[`${paths.leaveRequest(targetCompanyId, actionReq.request_id)}/updated_at`] = Date.now();

          await update(ref(db), updates);

          await writeAuditLog(targetCompanyId, {
             action: actionStatus === "approved" ? "APPROVE_LEAVE" : "REJECT_LEAVE",
             details: `Request ${actionReq.request_id}, type ${currentType}, status ${actionStatus}. Admin note: ${noteText || "-"}`,
             user_uid: userData?.uid || "",
             user_name: userData?.nama_lengkap || "",
             target_path: paths.leaveRequest(targetCompanyId, actionReq.request_id)
          });
          
          await createNotification(actionReq.uid, {
             company_id: targetCompanyId,
             title: actionStatus === "approved" ? `${currentLabel} Disetujui` : `${currentLabel} Ditolak`,
             message: noteText
               ? `Admin note: ${noteText}`
               : (actionStatus === "approved"
                   ? `Pengajuan ${currentLabel.toLowerCase()} Anda disetujui.`
                   : `Pengajuan ${currentLabel.toLowerCase()} Anda ditolak.`),
             type: actionStatus === "approved" ? "success" : "danger",
             ref_type: "leave_request",
             ref_id: actionReq.request_id
          });

      } else if (actionType === "qr") {
          const updates: any = {};
          updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/status`] = actionStatus;
          updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/admin_note`] = adminNote;
          updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/updated_at`] = Date.now();

          if (actionStatus === "approved") {
              const safeDate = actionReq.date || actionReq.tanggal;
              const safeTime = actionReq.time || actionReq.waktu || new Date().toISOString().split('T')[1].split('.')[0];
              const safeAction = actionReq.action_type || "masuk";

              const existingAttendance = await get(
                  ref(
                      db,
                      paths.attendanceRecord(
                          targetCompanyId,
                          actionReq.target_uid,
                          safeDate,
                          safeAction
                      )
                  )
              );

              if (existingAttendance.exists()) {
                  throw new Error("Attendance untuk user, tanggal, dan action ini sudah ada.");
              }

              const employeeSnap = await get(
                  ref(db, paths.companyUser(targetCompanyId, actionReq.target_uid))
              );
              
              const employee = employeeSnap.exists() ? employeeSnap.val() : {};
              
              const schedule = await resolveScheduleForUser({
                  companyId: targetCompanyId,
                  uid: actionReq.target_uid,
                  date: safeDate,
              });

              updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/approved_by`] = userData?.uid;
              updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/approved_by_name`] = userData?.nama_lengkap;
              updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/approved_at`] = Date.now();

              const attendanceRecord = {
                  company_id: actionReq.company_id,
                  uid: actionReq.target_uid,
                  date: safeDate,
                  tanggal: safeDate,
                  time: safeTime,
                  waktu: safeTime,
                  action_type: safeAction,
                  method: "qr",
                  source: "admin_web",
                  status: "approved",
                  validation_status: "approved",
                  attendance_status: schedule.attendance_status || "hadir",
                  
                  photo_url: actionReq.photo_url || "",
                  photo_path: actionReq.photo_path || "",
                  photo_quality_status: actionReq.photo_quality_status || null,
                  photo_quality_warning: actionReq.photo_quality_warning || null,
                  photo_file_size: actionReq.photo_file_size || null,
                  photo_width: actionReq.photo_width || null,
                  photo_height: actionReq.photo_height || null,

                  latitude: actionReq.latitude || null,
                  longitude: actionReq.longitude || null,
                  accuracy: actionReq.accuracy || 0,
                  location_accuracy: actionReq.location_accuracy || null,
                  location_accuracy_warning: actionReq.location_accuracy_warning || null,
                  mock_location_detected: actionReq.mock_location_detected !== undefined ? actionReq.mock_location_detected : null,
                  location_mock_warning: actionReq.location_mock_warning || null,
                  location_risk_level: actionReq.location_risk_level || null,
                  location_warning: actionReq.location_warning || null,
                  location_provider: actionReq.location_provider || null,

                  office_latitude: actionReq.office_latitude || null,
                  office_longitude: actionReq.office_longitude || null,
                  distance_meter: actionReq.distance_meter || 0,
                  radius_meter: actionReq.radius_meter || 0,
                  geofence_status: actionReq.geofence_status || (Number(actionReq.radius_meter || 0) > 0 && Number(actionReq.distance_meter || 0) <= Number(actionReq.radius_meter || 0) ? "inside" : "outside"),

                  office_id: actionReq.target_office_id || employee.office_id || actionReq.office_id || "",
                  office_name: actionReq.target_office_name || employee.office_name || actionReq.office_name || "",
                  department_id: actionReq.target_department_id || employee.department_id || actionReq.department_id || "",
                  department_name: actionReq.target_department_name || employee.department_name || actionReq.department_name || "",
                  sub_department_id: actionReq.target_sub_department_id || employee.sub_department_id || actionReq.sub_department_id || "",
                  sub_department_name: actionReq.target_sub_department_name || employee.sub_department_name || actionReq.sub_department_name || "",
                  group_id: actionReq.target_group_id || employee.group_id || actionReq.group_id || "",
                  group_name: actionReq.target_group_name || employee.group_name || actionReq.group_name || "",

                  helper_office_id: actionReq.helper_office_id || "",
                  helper_office_name: actionReq.helper_office_name || "",
                  helper_department_id: actionReq.helper_department_id || "",
                  helper_department_name: actionReq.helper_department_name || "",
                  helper_sub_department_id: actionReq.helper_sub_department_id || "",
                  helper_sub_department_name: actionReq.helper_sub_department_name || "",
                  helper_group_id: actionReq.helper_group_id || "",
                  helper_group_name: actionReq.helper_group_name || "",

                  assignment_id: schedule.assignment_id || "",
                  assignment_start_date: schedule.assignment_start_date || "",
                  assignment_end_date: schedule.assignment_end_date || "",
                  shift_id: schedule.shift_id || "",
                  shift_name: schedule.shift_name || "",
                  timetable_id: schedule.timetable_id || "",
                  timetable_name: schedule.timetable_name || "",
                  schedule_source: schedule.schedule_source || "none",
                  work_start: schedule.work_start || "",
                  work_end: schedule.work_end || "",
                  check_in_start: schedule.check_in_start || "",
                  check_in_end: schedule.check_in_end || "",
                  check_out_start: schedule.check_out_start || "",
                  check_out_end: schedule.check_out_end || "",
                  late_tolerance_minute: schedule.late_tolerance_minute || 0,
                  early_out_tolerance_minute: schedule.early_out_tolerance_minute || 0,
                  crosses_midnight: schedule.crosses_midnight !== undefined ? schedule.crosses_midnight : false,
                  overtime_flag: schedule.overtime_flag !== undefined ? schedule.overtime_flag : false,
                  overtime_schedule_id: schedule.overtime_schedule_id || "",
                  is_holiday_work: schedule.is_holiday_work !== undefined ? schedule.is_holiday_work : false,

                  created_by_qr: true,
                  proxy_request_id: actionReq.request_id,
                  qr_request_id: actionReq.request_id,
                  qr_helper_uid: actionReq.helper_uid || "",
                  qr_helper_name: actionReq.helper_name || "",
                  
                  approved_by: userData?.uid || "",
                  approved_by_name: userData?.nama_lengkap || "",
                  approved_at: Date.now(),
                  created_at: Date.now(),
                  updated_at: Date.now()
              };

              updates[paths.attendanceRecord(targetCompanyId, actionReq.target_uid, safeDate, safeAction)] = attendanceRecord;
          } else {
              updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/rejected_by`] = userData?.uid;
              updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/rejected_by_name`] = userData?.nama_lengkap;
              updates[`${paths.qrRequest(targetCompanyId, actionReq.request_id)}/rejected_at`] = Date.now();
          }

          await update(ref(db), updates);

          await writeAuditLog(targetCompanyId, {
             action: actionStatus === "approved" ? "APPROVE_QR" : "REJECT_QR",
             details: `Admin note: ${adminNote}`,
             user_uid: userData?.uid || "",
             user_name: userData?.nama_lengkap || "",
             target_path: paths.qrRequest(targetCompanyId, actionReq.request_id)
          });
          
          await createNotification(actionReq.target_uid, {
             company_id: targetCompanyId,
             title: actionStatus === "approved" ? "QR Attendance Disetujui" : "QR Attendance Ditolak",
             message: adminNote ? `Admin note: ${adminNote}` : (actionStatus === "approved" ? "Kehadiran melalui QR teman disetujui." : "Kehadiran melalui QR ditolak."),
             type: actionStatus === "approved" ? "success" : "danger",
             ref_type: "qr_attendance_request",
             ref_id: actionReq.request_id
          });
          
          if (actionReq.helper_uid) {
             await createNotification(actionReq.helper_uid, {
                 company_id: targetCompanyId,
                 title: actionStatus === "approved" ? "Approve Scanner QR" : "Reject Scanner QR",
                 message: `Pengajuan Anda scan untuk ${actionReq.target_name} telah di${actionStatus === "approved" ? 'setujui' : 'tolak'}.`,
                 type: "info",
                 ref_type: "qr_attendance_request",
                 ref_id: actionReq.request_id
             });
          }
      } else if (actionType === "correction") {
          const noteText = adminNote.trim();
          const safeDate = actionReq.date || actionReq.tanggal || "";
          const updates: any = {};
          
          updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/status`] = actionStatus;
          updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/admin_note`] = noteText;
          if (actionStatus === "approved") {
              updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/approved_by`] = userData?.uid;
              updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/approved_by_name`] = userData?.nama_lengkap;
              updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/approved_at`] = Date.now();
          } else {
              updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/rejected_by`] = userData?.uid;
              updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/rejected_by_name`] = userData?.nama_lengkap;
              updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/rejected_at`] = Date.now();
          }
          updates[`${paths.attendanceCorrection(targetCompanyId, actionReq.request_id)}/updated_at`] = Date.now();

          if (actionStatus === "approved") {
              const corrType = actionReq.correction_type || "masuk"; // masuk, pulang, masuk_pulang
              
              const employeeSnap = await get(
                  ref(db, paths.companyUser(targetCompanyId, actionReq.uid))
              );
              const employee = employeeSnap.exists() ? employeeSnap.val() : {};

              const schedule = await resolveScheduleForUser({
                  companyId: targetCompanyId,
                  uid: actionReq.uid,
                  date: safeDate,
              });

              // Write masuk if needed
              if (corrType === "masuk" || corrType === "masuk_pulang") {
                  const safeTime = actionReq.requested_check_in_time || "08:00:00";
                  const existingSnap = await get(ref(db, paths.attendanceRecord(targetCompanyId, actionReq.uid, safeDate, "masuk")));
                  const existing = existingSnap.exists() ? existingSnap.val() : {};

                  const attendanceRecord = {
                      ...existing,
                      company_id: targetCompanyId,
                      uid: actionReq.uid,
                      date: safeDate,
                      tanggal: safeDate,
                      time: safeTime,
                      waktu: safeTime,
                      action_type: "masuk",
                      method: "correction",
                      source: "admin_web",
                      status: "approved",
                      validation_status: "approved",
                      attendance_status: schedule.attendance_status || "hadir",
                      correction_request_id: actionReq.request_id,
                      corrected_by: userData?.uid || "",
                      corrected_by_name: userData?.nama_lengkap || "",
                      corrected_at: Date.now(),
                      admin_note: noteText,

                      office_id: actionReq.office_id || employee.office_id || existing.office_id || "",
                      office_name: actionReq.office_name || employee.office_name || existing.office_name || "",
                      department_id: actionReq.department_id || employee.department_id || existing.department_id || "",
                      department_name: actionReq.department_name || employee.department_name || existing.department_name || "",
                      sub_department_id: actionReq.sub_department_id || employee.sub_department_id || existing.sub_department_id || "",
                      sub_department_name: actionReq.sub_department_name || employee.sub_department_name || existing.sub_department_name || "",
                      group_id: actionReq.group_id || employee.group_id || existing.group_id || "",
                      group_name: actionReq.group_name || employee.group_name || existing.group_name || "",

                      assignment_id: schedule.assignment_id || "",
                      assignment_start_date: schedule.assignment_start_date || "",
                      assignment_end_date: schedule.assignment_end_date || "",
                      shift_id: schedule.shift_id || "",
                      shift_name: schedule.shift_name || "",
                      timetable_id: schedule.timetable_id || "",
                      timetable_name: schedule.timetable_name || "",
                      schedule_source: schedule.schedule_source || "none",
                      work_start: schedule.work_start || "",
                      work_end: schedule.work_end || "",
                      check_in_start: schedule.check_in_start || "",
                      check_in_end: schedule.check_in_end || "",
                      check_out_start: schedule.check_out_start || "",
                      check_out_end: schedule.check_out_end || "",
                      late_tolerance_minute: schedule.late_tolerance_minute || 0,
                      early_out_tolerance_minute: schedule.early_out_tolerance_minute || 0,
                      crosses_midnight: schedule.crosses_midnight !== undefined ? schedule.crosses_midnight : false,
                      overtime_flag: schedule.overtime_flag !== undefined ? schedule.overtime_flag : false,
                      overtime_schedule_id: schedule.overtime_schedule_id || "",
                      is_holiday_work: schedule.is_holiday_work !== undefined ? schedule.is_holiday_work : false,

                      created_at: existing.created_at || Date.now(),
                      updated_at: Date.now()
                  };

                  if (actionReq.attachment_url) {
                      attendanceRecord.photo_url = actionReq.attachment_url;
                  }
                  if (actionReq.attachment_path) {
                      attendanceRecord.photo_path = actionReq.attachment_path;
                  }

                  updates[paths.attendanceRecord(targetCompanyId, actionReq.uid, safeDate, "masuk")] = attendanceRecord;
              }

              // Write pulang if needed
              if (corrType === "pulang" || corrType === "masuk_pulang") {
                  const safeTime = actionReq.requested_check_out_time || "17:00:00";
                  const existingSnap = await get(ref(db, paths.attendanceRecord(targetCompanyId, actionReq.uid, safeDate, "pulang")));
                  const existing = existingSnap.exists() ? existingSnap.val() : {};

                  const attendanceRecord = {
                      ...existing,
                      company_id: targetCompanyId,
                      uid: actionReq.uid,
                      date: safeDate,
                      tanggal: safeDate,
                      time: safeTime,
                      waktu: safeTime,
                      action_type: "pulang",
                      method: "correction",
                      source: "admin_web",
                      status: "approved",
                      validation_status: "approved",
                      attendance_status: schedule.attendance_status || "hadir",
                      correction_request_id: actionReq.request_id,
                      corrected_by: userData?.uid || "",
                      corrected_by_name: userData?.nama_lengkap || "",
                      corrected_at: Date.now(),
                      admin_note: noteText,

                      office_id: actionReq.office_id || employee.office_id || existing.office_id || "",
                      office_name: actionReq.office_name || employee.office_name || existing.office_name || "",
                      department_id: actionReq.department_id || employee.department_id || existing.department_id || "",
                      department_name: actionReq.department_name || employee.department_name || existing.department_name || "",
                      sub_department_id: actionReq.sub_department_id || employee.sub_department_id || existing.sub_department_id || "",
                      sub_department_name: actionReq.sub_department_name || employee.sub_department_name || existing.sub_department_name || "",
                      group_id: actionReq.group_id || employee.group_id || existing.group_id || "",
                      group_name: actionReq.group_name || employee.group_name || existing.group_name || "",

                      assignment_id: schedule.assignment_id || "",
                      assignment_start_date: schedule.assignment_start_date || "",
                      assignment_end_date: schedule.assignment_end_date || "",
                      shift_id: schedule.shift_id || "",
                      shift_name: schedule.shift_name || "",
                      timetable_id: schedule.timetable_id || "",
                      timetable_name: schedule.timetable_name || "",
                      schedule_source: schedule.schedule_source || "none",
                      work_start: schedule.work_start || "",
                      work_end: schedule.work_end || "",
                      check_in_start: schedule.check_in_start || "",
                      check_in_end: schedule.check_in_end || "",
                      check_out_start: schedule.check_out_start || "",
                      check_out_end: schedule.check_out_end || "",
                      late_tolerance_minute: schedule.late_tolerance_minute || 0,
                      early_out_tolerance_minute: schedule.early_out_tolerance_minute || 0,
                      crosses_midnight: schedule.crosses_midnight !== undefined ? schedule.crosses_midnight : false,
                      overtime_flag: schedule.overtime_flag !== undefined ? schedule.overtime_flag : false,
                      overtime_schedule_id: schedule.overtime_schedule_id || "",
                      is_holiday_work: schedule.is_holiday_work !== undefined ? schedule.is_holiday_work : false,

                      created_at: existing.created_at || Date.now(),
                      updated_at: Date.now()
                  };

                  if (actionReq.attachment_url) {
                      attendanceRecord.photo_url = actionReq.attachment_url;
                  }
                  if (actionReq.attachment_path) {
                      attendanceRecord.photo_path = actionReq.attachment_path;
                  }

                  updates[paths.attendanceRecord(targetCompanyId, actionReq.uid, safeDate, "pulang")] = attendanceRecord;
              }
          }

          await update(ref(db), updates);

          await writeAuditLog(targetCompanyId, {
             action: actionStatus === "approved" ? "APPROVE_CORRECTION" : "REJECT_CORRECTION",
             details: `Koreksi request ${actionReq.request_id}, status ${actionStatus}. Admin note: ${noteText || "-"}`,
             user_uid: userData?.uid || "",
             user_name: userData?.nama_lengkap || "",
             target_path: paths.attendanceCorrection(targetCompanyId, actionReq.request_id)
          });

          await createNotification(actionReq.uid, {
             company_id: targetCompanyId,
             title: actionStatus === "approved" ? "Koreksi Presensi Disetujui" : "Koreksi Presensi Ditolak",
             message: actionStatus === "approved"
                ? `Koreksi presensi tanggal ${safeDate} telah disetujui.`
                : `Koreksi presensi tanggal ${safeDate} ditolak. Admin note: ${noteText}`,
             type: actionStatus === "approved" ? "success" : "danger",
             ref_type: "attendance_correction",
             ref_id: actionReq.request_id
          });
      }
      return "Aksi berhasil diproses";
    };

    toast.promise(processApproval(), {
      loading: 'Memproses persetujuan...',
      success: (msg) => {
        setActionReq(null);
        setAdminNote("");
        return msg;
      },
      error: (err) => {
        return `Gagal memproses aksi: ${err.message}`;
      }
    }).finally(() => {
      setSavingAction(false);
      processingRef.current = false;
    });
  };

  const handleUpdateLeave = (req: any, status: "approved" | "rejected") => {
      setActionReq(req);
      setActionType("leave");
      setActionStatus(status);
      setAdminNote("");
  };

  const handleUpdateQR = (req: any, status: "approved" | "rejected") => {
      setActionReq(req);
      setActionType("qr");
      setActionStatus(status);
      setAdminNote("");
  };

  const handleUpdateCorrection = (req: any, status: "approved" | "rejected") => {
      setActionReq(req);
      setActionType("correction");
      setActionStatus(status);
      setAdminNote("");
  };

  const pendingLeaves = leaveRequests.filter(r => isPendingStatus(r.status));
  const pendingQR = qrRequests.filter(r => r.status === "pending_admin" || r.status === "pending");
  const pendingCorrections = correctionRequests.filter(r => r.status === "pending" || !r.status);

  const visibleLeaves = leaveRequests.filter(req => {
    if (queryStatus === "pending") return isPendingStatus(req.status);
    return true;
  });

  const visibleQR = qrRequests.filter(req => {
    if (queryStatus === "pending") return req.status === "pending_admin" || req.status === "pending";
    return true;
  });

  const visibleCorrections = correctionRequests.filter(req => {
    if (queryStatus === "pending") return req.status === "pending" || !req.status;
    return true;
  });

  const pendingLeaveCount = pendingLeaves.length;
  const pendingQrCount = pendingQR.length;
  const pendingCorrectionCount = pendingCorrections.length;
  const totalPending = pendingLeaveCount + pendingQrCount + pendingCorrectionCount;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">
            Persetujuan & Ajuan
            {totalPending > 0 && (
              <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                {totalPending} pending
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 font-sans">Izin, Cuti, Sakit, Lembur, Koreksi Presensi & QR Attendance</p>
        </div>
      </div>

      {isOwner && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg flex items-center gap-4">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-400">Pilih Perusahaan:</label>
          <select 
            value={targetCompanyId} 
            onChange={(e) => setTargetCompanyId(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded p-2 text-sm focus:outline-none focus:border-blue-500 min-w-[200px]"
          >
            <option value="" disabled>-- Pilih Perusahaan --</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-blue-500">Memuat data persetujuan...</div>
      ) : !targetCompanyId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 rounded-lg text-center text-slate-500">
          Silakan pilih perusahaan terlebih dahulu, atau Anda tidak memiliki akses perusahaan.
        </div>
      ) : (
        <>
          <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800 pb-2">
            {[
              { id: "leave", label: `Izin/Cuti/Sakit/Lembur (${pendingLeaves.length})` },
              { id: "qr", label: `QR Attendance (${pendingQR.length})` },
              { id: "correction", label: `Koreksi Presensi (${pendingCorrections.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
                  activeTab === tab.id 
                    ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500" 
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 p-4 rounded-lg text-sm italic">
              Diagnosis: {error}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            {activeTab === "leave" && (
                visibleLeaves.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200 mb-1">Semua pengajuan sudah ditinjau</h3>
                    <p className="text-slate-500 max-w-sm">Tidak ada izin, cuti, sakit, atau lembur yang menunggu persetujuan Anda saat ini.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium font-sans">Karyawan</th>
                        <th className="px-6 py-3 font-medium font-sans">Tipe</th>
                        <th className="px-6 py-3 font-medium font-sans">Tanggal</th>
                        <th className="px-6 py-3 font-medium font-sans">Detail</th>
                        <th className="px-6 py-3 font-medium font-sans">Lampiran</th>
                        <th className="px-6 py-3 font-medium text-right font-sans">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {visibleLeaves.map((req) => {
                        const currentType = leaveTypeValue(req);
                        const currentLabel = leaveTypeLabel(currentType);
                        const fileSource = attachmentSource(req);
                        return (
                        <tr key={req.request_id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-800 dark:text-slate-200 font-sans">{employeeName(req)}</div>
                            <div className="text-xs text-slate-500 font-mono">{employeeNip(req)}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                {currentLabel}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {currentType === "lembur" ? (
                                <>
                                    <div className="font-sans">{textValue(req.overtime_date, startDateValue(req))}</div>
                                    <div className="text-xs text-slate-500 font-mono">
                                        {textValue(req.overtime_start_time, "-")} - {textValue(req.overtime_end_time, "-")}
                                    </div>
                                    <div className="text-xs text-slate-500 font-mono">{formatDuration(req.overtime_duration_minute)}</div>
                                </>
                            ) : (
                                <div className="font-sans">{formatDateRange(req)}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate font-sans">
                            {reasonValue(req)}
                            {currentType === "lembur" && (
                                <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-sans">
                                  Lembur user request. Baru dihitung valid setelah disetujui admin.
                                </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs">
                            {fileSource ? (
                                <button 
                                    onClick={() => openAttachment(req)}
                                    className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-sans"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                    {attachmentName(req)}
                                </button>
                            ) : (
                                <div className="text-slate-400 font-sans">Tidak ada lampiran</div>
                            )}
                            {(req.attachment_required || currentType === "sakit") && !fileSource && (
                                <div className="mt-1 text-[10px] text-red-500 font-sans">
                                    Bukti sakit wajib untuk data baru.
                                </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                            {isPendingStatus(req.status) ? (
                              <>
                                <button 
                                  onClick={() => handleUpdateLeave(req, "approved")}
                                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-300 text-xs font-medium bg-emerald-500/10 px-2 py-1 rounded font-sans"
                                >
                                  Setujui
                                </button>
                                <button 
                                  onClick={() => handleUpdateLeave(req, "rejected")}
                                  className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium bg-red-500/10 px-2 py-1 rounded font-sans"
                                >
                                  Tolak
                                </button>
                              </>
                            ) : (
                              <span className={`text-xs font-medium px-2 py-1 rounded ${
                                req.status === 'approved' || req.status === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                              }`}>{statusLabel(req.status)}</span>
                            )}
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                )
            )}

            {activeTab === "qr" && (
                visibleQR.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200 mb-1">Semua pengajuan sudah ditinjau</h3>
                    <p className="text-slate-500 max-w-sm">Tidak ada QR attendance yang menunggu persetujuan Anda saat ini.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium font-sans">Target User</th>
                        <th className="px-6 py-3 font-medium font-sans">Didaftarkan Oleh</th>
                        <th className="px-6 py-3 font-medium font-sans">Tanggal/Waktu</th>
                        <th className="px-6 py-3 font-medium font-sans">Aksi/Tipe</th>
                        <th className="px-6 py-3 font-medium text-right font-sans">Approval</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {visibleQR.map((req) => (
                        <tr key={req.request_id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-800 dark:text-slate-200 font-sans">{req.target_name}</div>
                            <div className="text-xs text-slate-500 font-sans">Target Office: {req.target_office_name || "-"}</div>
                            <button 
                              onClick={() => openDetail(req, "qr")}
                              className="text-blue-500 hover:underline text-xs mt-1 block font-sans"
                            >
                              Detail Audit & Foto Bukti
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-700 dark:text-slate-300 font-sans">{req.helper_name}</div>
                            <div className="text-xs text-slate-500 font-sans">Helper Office: {req.helper_office_name || "-"}</div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-sans">{req.tanggal}</span> <br/><span className="text-xs text-slate-500 font-mono">{req.waktu}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                {req.action_type || "-"}
                            </span>
                            <div className="mt-2 text-xs font-sans">
                              {Number(req.distance_meter || 0) <= Number(req.radius_meter || 0) ? (
                                  <span className="text-teal-600 dark:text-teal-400">Dalam Radius ({meterValue(req.distance_meter)} / {meterValue(req.radius_meter)})</span>
                              ) : (
                                  <span className="text-red-600 dark:text-red-400">Luar Radius ({meterValue(req.distance_meter)} / {meterValue(req.radius_meter)})</span>
                              )}
                            </div>
                            {req.latitude && req.longitude && (
                                <div className="mt-1">
                                    <a href={`https://maps.google.com/?q=${req.latitude},${req.longitude}`} target="_blank" rel="noreferrer" className="text-teal-600 dark:text-teal-400 hover:underline text-xs inline-flex items-center gap-1 font-sans">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                      Lihat Lokasi
                                    </a>
                                </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                            {req.status === "pending_admin" || req.status === "pending" ? (
                              <>
                                <button 
                                  onClick={() => handleUpdateQR(req, "approved")}
                                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-300 text-xs font-medium bg-emerald-500/10 px-2 py-1 rounded font-sans"
                                >
                                  Setujui
                                </button>
                                <button 
                                  onClick={() => handleUpdateQR(req, "rejected")}
                                  className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium bg-red-500/10 px-2 py-1 rounded font-sans"
                                >
                                  Tolak
                                </button>
                              </>
                            ) : (
                               <span className={`text-xs font-medium px-2 py-1 rounded ${
                                  req.status === 'approved' || req.status === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                               }`}>{statusLabel(req.status)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            )}

            {activeTab === "correction" && (
                visibleCorrections.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200 mb-1">Semua pengajuan sudah ditinjau</h3>
                    <p className="text-slate-500 max-w-sm">Tidak ada koreksi presensi yang menunggu persetujuan Anda saat ini.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium font-sans">Karyawan</th>
                        <th className="px-6 py-3 font-medium font-sans">Tanggal</th>
                        <th className="px-6 py-3 font-medium font-sans">Tipe Koreksi</th>
                        <th className="px-6 py-3 font-medium font-sans">Aksi Diajukan</th>
                        <th className="px-6 py-3 font-medium font-sans">Alasan & Lampiran</th>
                        <th className="px-6 py-3 font-medium text-right font-sans">Approval</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {visibleCorrections.map((req) => {
                        const fileSource = attachmentSource(req);
                        return (
                          <tr key={req.request_id} className="hover:bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                            <td className="px-6 py-4 flex-col">
                              <div className="font-medium text-slate-800 dark:text-slate-200 font-sans">{employeeName(req)}</div>
                              <div className="text-xs text-slate-500 font-mono">{employeeNip(req)}</div>
                              <button 
                                onClick={() => openDetail(req, "correction")}
                                className="text-blue-500 hover:underline text-xs mt-1 block font-sans"
                              >
                                Lihat Detail & Data Lama
                              </button>
                            </td>
                            <td className="px-6 py-4 font-sans">{req.date || req.tanggal || "-"}</td>
                            <td className="px-6 py-4">
                              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                {req.correction_type || "-"}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs font-mono">
                              {req.correction_type === "masuk" || req.correction_type === "masuk_pulang" ? (
                                <div>Masuk: <span className="font-semibold text-slate-800 dark:text-slate-200">{req.requested_check_in_time || "-"}</span></div>
                              ) : null}
                              {req.correction_type === "pulang" || req.correction_type === "masuk_pulang" ? (
                                <div>Pulang: <span className="font-semibold text-slate-800 dark:text-slate-200">{req.requested_check_out_time || "-"}</span></div>
                              ) : null}
                            </td>
                            <td className="px-6 py-4 text-xs max-w-xs font-sans">
                              <div className="truncate mb-1">{req.reason || "-"}</div>
                              {fileSource ? (
                                  <button 
                                      onClick={() => openAttachment(req)}
                                      className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-sans"
                                  >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                      {attachmentName(req)}
                                  </button>
                              ) : (
                                  <span className="text-slate-400 font-sans">Tanpa lampiran</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                              {req.status === "pending" || !req.status ? (
                                <>
                                  <button 
                                    onClick={() => handleUpdateCorrection(req, "approved")}
                                    className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-300 text-xs font-medium bg-emerald-500/10 px-2 py-1 rounded font-sans"
                                  >
                                    Setujui
                                  </button>
                                  <button 
                                    onClick={() => handleUpdateCorrection(req, "rejected")}
                                    className="text-red-600 dark:text-red-400 hover:text-red-300 text-xs font-medium bg-red-500/10 px-2 py-1 rounded font-sans"
                                  >
                                    Tolak
                                  </button>
                                </>
                              ) : (
                                <span className={`text-xs font-medium px-2 py-1 rounded ${
                                   req.status === 'approved' || req.status === 'success' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                }`}>{statusLabel(req.status)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
            )}
          </div>
        </>
      )}

      {/* Action Modal */}
      {actionReq && (
          <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-md">
                  <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-100 dark:bg-slate-800/50">
                      <h3 className={`font-bold text-lg font-sans ${actionStatus === 'approved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {actionStatus === 'approved' ? 'Konfirmasi Setujui' : 'Konfirmasi Tolak'} {actionType === 'leave' ? leaveTypeLabel(leaveTypeValue(actionReq)) : (actionType === 'qr' ? 'QR' : 'Koreksi')}
                      </h3>
                      <button disabled={savingAction} onClick={() => setActionReq(null)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
                  </div>
                  <div className="p-6">
                      <div className="text-slate-700 dark:text-slate-300 text-sm mb-4 font-sans">
                          Anda akan {actionStatus === 'approved' ? 'menyetujui' : 'menolak'} pengajuan dari: <br/>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{actionType === 'leave' ? employeeName(actionReq) : (actionType === 'qr' ? actionReq.target_name : employeeName(actionReq))}</span>
                      </div>
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2 font-sans">
                          Catatan Admin {actionStatus === 'rejected' ? '(Wajib)' : '(Opsional)'}
                      </label>
                      <textarea 
                          rows={3}
                          value={adminNote} 
                          onChange={e => setAdminNote(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 text-slate-800 dark:text-slate-200 text-sm placeholder-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-sans"
                          placeholder="Masukkan alasan atau pesan..."
                      />
                  </div>
                  <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-100 dark:bg-slate-800/30">
                      <button disabled={savingAction} onClick={() => setActionReq(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm font-medium hover:bg-slate-700 font-sans">Cancel</button>
                      <button disabled={savingAction} onClick={confirmAction} className={`px-4 py-2 text-slate-900 rounded text-sm font-medium font-sans ${actionStatus === 'approved' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-red-600 hover:bg-red-500 text-white'}`}>
                          {savingAction ? 'Memproses...' : 'Konfirmasi'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Detail Modal */}
      {detailReq && (
          <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                  <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-100 dark:bg-slate-800/50">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200 font-sans">
                          Detail Pengajuan {detailType === 'qr' ? 'QR Attendance' : 'Koreksi Presensi'}
                      </h3>
                      <button onClick={() => setDetailReq(null)} className="text-slate-500 hover:text-slate-700 dark:text-slate-300">✕</button>
                  </div>
                  <div className="p-6 overflow-y-auto space-y-4">
                      {detailType === 'qr' ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3 font-sans">
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Karyawan Target</span>
                                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{detailReq.target_name}</span>
                                      <span className="text-xs text-slate-500 block">Unit Target: {detailReq.target_office_name || detailReq.helper_office_name || "-"}</span>
                                  </div>
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Didaftarkan Oleh</span>
                                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{detailReq.helper_name}</span>
                                      <span className="text-xs text-slate-500 block">Unit Helper: {detailReq.helper_office_name || "-"}</span>
                                  </div>
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Tanggal & Waktu</span>
                                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{detailReq.tanggal} ({detailReq.waktu})</span>
                                  </div>
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Tipe Aksi</span>
                                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                          {detailReq.action_type || "-"}
                                      </span>
                                  </div>
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Status Radius</span>
                                      <span className={`text-xs font-semibold ${Number(detailReq.distance_meter || 0) <= Number(detailReq.radius_meter || 0) ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {Number(detailReq.distance_meter || 0) <= Number(detailReq.radius_meter || 0) 
                                              ? `Dalam Radius (${meterValue(detailReq.distance_meter)} / ${meterValue(detailReq.radius_meter)})` 
                                              : `Luar Radius (${meterValue(detailReq.distance_meter)} / ${meterValue(detailReq.radius_meter)})`}
                                      </span>
                                  </div>
                                  {detailReq.latitude && (
                                      <div>
                                          <span className="text-xs text-slate-400 block uppercase font-semibold">Lokasi Koordinat & Akurasi</span>
                                          <div className="text-xs text-slate-700 dark:text-slate-300">
                                              Lat/Lon: {detailReq.latitude}, {detailReq.longitude} <br/>
                                              Akurasi GPS: {detailReq.location_accuracy !== undefined ? `${detailReq.location_accuracy}m` : (detailReq.accuracy ? `${detailReq.accuracy}m` : "-")} {detailReq.location_accuracy_warning && <span className="text-amber-500 block">({detailReq.location_accuracy_warning})</span>}
                                          </div>
                                          {detailReq.mock_location_detected && (
                                              <div className="text-red-500 text-xs font-bold mt-1 uppercase">
                                                  ⚠️ Lokasi Palsu Terdeteksi! ({detailReq.location_mock_warning || "Mock Location"})
                                              </div>
                                          )}
                                          <div className="text-xs text-slate-500">Risk Level: {detailReq.location_risk_level || "low"}</div>
                                          {detailReq.location_warning && <div className="text-amber-500 text-xs italic">Warning: {detailReq.location_warning}</div>}
                                      </div>
                                  )}
                              </div>
                              <div className="space-y-3 font-sans">
                                  <span className="text-xs text-slate-400 block uppercase font-semibold">Foto Bukti & Kualitas</span>
                                  {detailReq.photo_url || detailReq.photo_path ? (
                                      <div className="space-y-2">
                                          <button 
                                              onClick={() => openAttachment(detailReq)}
                                              className="border border-slate-200 dark:border-slate-800 rounded p-1 block w-full hover:opacity-80 bg-slate-50 dark:bg-slate-950"
                                          >
                                              {resolvedPhotoUrl ? (
                                                  <img 
                                                      src={resolvedPhotoUrl} 
                                                      alt="Foto bukti" 
                                                      className="max-h-40 mx-auto object-cover rounded"
                                                      referrerPolicy="no-referrer"
                                                  />
                                              ) : (
                                                  <div className="py-8 text-center text-xs text-slate-500 font-sans">
                                                      Memuat preview foto...
                                                  </div>
                                              )}
                                              <span className="text-[10px] text-blue-500 block text-center mt-1">Perbesar Foto</span>
                                          </button>
                                          <div className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                                              <div>Status Foto: <span className="font-semibold">{detailReq.photo_quality_status || "OK"}</span></div>
                                              {detailReq.photo_quality_warning && <div className="text-amber-500 italic">Warning: {detailReq.photo_quality_warning}</div>}
                                              <div>Specs: {detailReq.photo_width || "-"}x{detailReq.photo_height || "-"} ({(detailReq.photo_file_size ? (detailReq.photo_file_size / 1024).toFixed(1) : "-")} KB)</div>
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs p-3 rounded">
                                          Foto bukti belum tersedia. Request ini kemungkinan berasal dari versi mobile lama atau gagal upload foto.
                                      </div>
                                  )}
                              </div>
                          </div>
                      ) : (
                          <div className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-slate-200 dark:border-slate-800 pb-3 font-sans">
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Karyawan</span>
                                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{employeeName(detailReq)}</span>
                                      <span className="text-xs text-slate-500 block">NIP: {employeeNip(detailReq)}</span>
                                      <span className="text-xs text-slate-500 block">Unit: {detailReq.department_name || "-"} / {detailReq.office_name || "-"}</span>
                                  </div>
                                  <div>
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Tipe Koreksi</span>
                                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 inline-block mt-1">
                                          {detailReq.correction_type || "-"}
                                      </span>
                                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                                          Tanggal Koreksi: {detailReq.date || detailReq.tanggal || "-"} <br/>
                                          Diajukan pada: {detailReq.created_at ? new Date(detailReq.created_at).toLocaleString('id-ID') : "-"}
                                      </div>
                                  </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-sans">
                                  <div className="space-y-2">
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Data Baru yang Diajukan</span>
                                      <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                                          {detailReq.correction_type === "masuk" || detailReq.correction_type === "masuk_pulang" ? (
                                              <div>Jam Masuk: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{detailReq.requested_check_in_time || "-"}</span></div>
                                          ) : null}
                                          {detailReq.correction_type === "pulang" || detailReq.correction_type === "masuk_pulang" ? (
                                              <div>Jam Pulang: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{detailReq.requested_check_out_time || "-"}</span></div>
                                          ) : null}
                                          <div className="text-[10px] text-slate-500 mt-2 italic">Alasan Kehadiran: <br/>{detailReq.reason || "-"}</div>
                                      </div>
                                  </div>

                                  <div className="space-y-2">
                                      <span className="text-xs text-slate-400 block uppercase font-semibold">Data Lama / Existing Snapshot</span>
                                      <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                                          {detailReq.old_attendance ? (
                                              <>
                                                  {detailReq.old_attendance.masuk ? (
                                                      <div>Masuk Lama: <span className="font-semibold">{detailReq.old_attendance.masuk.time || detailReq.old_attendance.masuk.waktu || "-"}</span></div>
                                                  ) : (
                                                      <div>Masuk Lama: <span className="text-slate-400 italic">Kosong/belum absen</span></div>
                                                  )}
                                                  {detailReq.old_attendance.pulang ? (
                                                      <div>Pulang Lama: <span className="font-semibold">{detailReq.old_attendance.pulang.time || detailReq.old_attendance.pulang.waktu || "-"}</span></div>
                                                  ) : (
                                                      <div>Pulang Lama: <span className="text-slate-400 italic">Kosong/belum absen</span></div>
                                                  )}
                                              </>
                                          ) : (
                                              detailReq.old_attendance_snapshot ? (
                                                  <div className="whitespace-pre-wrap font-mono text-[10px]">
                                                      {JSON.stringify(detailReq.old_attendance_snapshot, null, 2)}
                                                  </div>
                                              ) : (
                                                  <span className="text-slate-400 italic font-medium block">Tidak ada snapshot data lama</span>
                                              )
                                          )}
                                      </div>
                                  </div>
                              </div>

                              {attachmentSource(detailReq) && (
                                  <div className="p-3 border border-slate-200 dark:border-slate-800 rounded font-sans">
                                      <span className="text-xs text-slate-400 block uppercase font-semibold mb-2">Dokumen Lampiran Bukti</span>
                                      <button 
                                          onClick={() => openAttachment(detailReq)}
                                          className="text-blue-500 hover:underline flex items-center gap-1 text-xs"
                                      >
                                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                          {attachmentName(detailReq)}
                                      </button>
                                  </div>
                              )}
                          </div>
                      )}
                  </div>
                  <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-100 dark:bg-slate-800/30">
                      <button onClick={() => setDetailReq(null)} className="px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-sm font-medium hover:bg-slate-700 font-sans">Tutup</button>
                      
                      <button 
                         onClick={() => {
                             const r = detailReq;
                             setDetailReq(null);
                             if (detailType === "qr") {
                                 handleUpdateQR(r, "approved");
                             } else {
                                 handleUpdateCorrection(r, "approved");
                             }
                         }}
                         className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium font-sans"
                      >
                         Setujui Request
                      </button>
                      <button 
                         onClick={() => {
                             const r = detailReq;
                             setDetailReq(null);
                             if (detailType === "qr") {
                                 handleUpdateQR(r, "rejected");
                             } else {
                                 handleUpdateCorrection(r, "rejected");
                             }
                         }}
                         className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium font-sans"
                      >
                         Tolak Request
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Attachment Preview Modal */}
      {previewAttachment && (
          <div className="fixed inset-0 bg-slate-50 dark:bg-slate-950/90 flex flex-col items-center justify-center z-[60] p-4">
              <div className="w-full max-w-4xl flex justify-end mb-2">
                  <button onClick={() => setPreviewAttachment(null)} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 p-2 rounded-full font-sans">
                      ✕ Tutup
                  </button>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 max-w-4xl max-h-[80vh] overflow-auto flex flex-col justify-center items-center">
                   {imageLoadError ? (
                       <div className="p-8 text-center text-slate-500 font-sans">
                           <p className="font-bold text-red-500 mb-2">Preview tidak tersedia.</p>
                           <p className="text-xs text-slate-400">Coba buka file langsung atau cek Storage.</p>
                       </div>
                   ) : (
                       <img 
                           src={previewAttachment} 
                           alt="Attachment" 
                           className="max-w-full max-h-[70vh] object-contain rounded animate-in fade-in" 
                           onError={() => setImageLoadError(true)}
                           referrerPolicy="no-referrer"
                       />
                   )}
              </div>
          </div>
      )}
    </div>
  );
};
