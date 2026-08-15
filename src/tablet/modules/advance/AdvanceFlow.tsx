import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, ChevronRight, Download, ExternalLink, FileText, ImageIcon, IndianRupee, Loader2, Maximize2, MessageCircle, Printer, Search, Sparkles, Trash2, Upload, User, Wallet, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { cn } from "@/lib/utils";
import { GEMINI_MODEL, describeGeminiError, geminiFetch, geminiGenerateContentUrl } from "@/lib/gemini";
import { LLM_BACKEND, callVpsClaude, type VpsClaudeImage } from "@/lib/vpsClaude";
import { downscaleImageForVision } from "@/lib/downscaleImage";
import { inr, shortDate } from "@/tablet/lib/format";
import { TabletNumpad } from "@/tablet/components/TabletNumpad";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletConfirm } from "@/tablet/components/TabletConfirm";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { DictationTextarea } from "@/tablet/components/DictationTextarea";
import { OpeningCashBanner } from "@/tablet/components/OpeningCashBanner";
import { syncPortalDataForRegistrationId } from "@/lib/governmentPortalReportDb";
import { derivePackageCodeFromName, resolvePackageCodeFromSavedData } from "@/lib/packageCodeLookup";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { compressImageToLimit } from "@/tablet/lib/image";
import { deletePatientDoc, uploadPatientDocs, usePatientDocs, type PatientDoc } from "@/tablet/hooks/usePatientDocs";
import { MultiShotCamera, type CapturedPhotoItem } from "@/tablet/modules/patient-profile/MultiShotCamera";
import { buildArshiyaSummaryPdfBlob } from "./arshiyaSummaryPdf";
import { loadSummarySignatory } from "./doctorCredentials";
import { resolveDischargeStaff } from "./dischargeStaff";

const MODES = ["CASH", "CARD", "UPI", "CHEQUE", "NEFT"];
const ADVANCE_IMAGE_CATEGORY = "advance_image";
/** Proof that the thumb impression and photo were uploaded to the government
 *  portal. Nothing downstream of discharge unlocks without one of these. */
const THUMB_CONFIRMATION_CATEGORY = "discharge_thumb_confirmation";
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
/** Must not exceed MAX_IMAGES in api/ai-proxy.ts — the proxy rejects the whole
 *  request with 413 "maximum 4 images per request" past this, so cap here and
 *  warn instead of failing the transcription outright. */
const MAX_VISION_IMAGES = 4;
const ARSHIA_EMERGENCY_LINE = "URGENT CARE/ EMERGENCY CARE IS AVAILABLE 24 X 7. PLEASE CONTACT:-7030974619, 9373111709.";
const DEFAULT_ARSHIA_DEATH_PROMPT = `You are a senior medical specialist writing a formal hospital DEATH SUMMARY for the medical record.

DATA RULES:
- Treat everything in the SOURCE CONTEXT as established fact: the diagnoses, procedures, package, OT schedule, treating doctor, labs and radiology, and the date and time of death provided.
- Do NOT mention the patient name. The age and sex provided may be used ("The patient, a 42-year-old female...").
- The terminal narrative may follow the standard course for the documented diagnoses (deterioration, intubation, resuscitation attempted, could not be revived) but must never invent specific documented-sounding events, times, drugs or lab values that were not provided.

STRUCTURE - use these exact "## " headings, in this order, and omit none:
## Final Diagnosis
## Hospital Course
## Cause of Death
## Date & Time of Death

SECTION RULES:
- Final Diagnosis: every documented diagnosis and procedure status as a bullet list (e.g. "Status Post PTCA to LAD" when the system shows that procedure).
- Hospital Course: one or two paragraphs — the known condition on admission, the management given (from the system's procedures and package), the deterioration, and the resuscitation, ending with the fact of death.
- Cause of Death: one sentence in the standard form "X secondary to Y", built from the documented diagnoses.
- Date & Time of Death: exactly as provided.
Output plain Markdown only.`;

const DEFAULT_ARSHIA_DISCHARGE_PROMPT = `You are a senior medical specialist writing a complete, professional hospital discharge summary for another doctor.

DATA RULES:
- Treat everything in the SOURCE CONTEXT as established fact: the diagnoses, the package and procedure from the hospital system, the OT schedule (surgeon, anesthetist, anesthesia type, date and time), the treating doctor, the labs and radiology, the pre-authorization transcription and the dictated medications. Use ALL of it — the procedure done, the package taken and the doctors who performed must all appear.
- Do NOT mention the patient name, sex, or age.
- Where routine details are not recorded, write the STANDARD clinical narrative expected for the documented diagnosis and procedure — typical presenting complaints, an uneventful course, routine post-operative recovery — so every section reads complete. This narrative must stay generic and typical; it must never contradict anything provided, and never invent specific lab values, complication events, transfusions, or drug doses that were not given.
- The summary is a draft: the treating doctor reviews, corrects and signs it before it leaves the hospital.

STRUCTURE - use these exact "## " headings, in this order, and omit none of them:
## Diagnosis
## History and Presenting Complaints
## Medications on Discharge
## Course in Hospital
## Procedure and Surgery Notes
## Investigations
## Condition at Discharge
## Diet and Activity
## Home Care Precautions
## Follow Up
## Report Back Immediately If

SECTION RULES:
- Diagnosis: the working diagnosis as one line, then any secondary diagnoses as bullets.
- History and Presenting Complaints: a short detailed history — presenting complaints, duration, and relevant background — from the pre-authorization transcription where given, otherwise the standard presentation for the documented diagnosis.
- Medications on Discharge: a Markdown table with columns Name | Strength | Route | Dosage | Days. In each Dosage cell put the English dosage first and the Hindi dosage on the next line using <br/>. If no medication is dictated, write "Not provided" instead of the table.
- Course in Hospital: short paragraphs, documented events only.
- Procedure and Surgery Notes: only the details provided. If none, write "Not provided."
- Investigations: a Markdown table with columns Investigation | Finding | Date, one row per reported result. If none were fetched, write "Not recorded."
- Condition at Discharge, Diet and Activity, Home Care Precautions, Follow Up, Report Back Immediately If: bullet points, one instruction per bullet, written for the patient's own doctor to act on. These may follow standard practice for the documented diagnosis and treatment, but must not assert anything patient-specific that was not provided.

STYLE:
- Professional doctor-facing language, no filler and no restating the heading inside the section.
- Keep bullets to a single sentence each. Prefer a table wherever the content is repetitive.
- Use "## " for the section headings above. Do not use bold text as a substitute for a heading, and do not add headings beyond the list.
- End with this exact sentence, on its own line, after the last section: ${ARSHIA_EMERGENCY_LINE}

Return Markdown only.`;

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

interface AdvanceRow {
  id: string;
  advance_amount: number;
  returned_amount: number;
  is_refund: boolean;
  payment_date: string;
  payment_mode: string;
  status: string;
}

interface VisitRow {
  id: string;
  visit_id: string;
  yojana_registration_id: string | null;
  package_code: string | null;
  package_name: string | null;
  corporate: string | null;
  arshiya_discharge_summary: string | null;
  appointment_with: string | null;
}

interface PackageOption {
  id: string;
  code: string | null;
  name: string;
  label: string;
}

interface ImplantOption {
  id: string;
  name: string;
  nabh_nabl_rate: number | null;
  non_nabh_nabl_rate: number | null;
  private_rate: number | null;
  bhopal_nabh_rate: number | null;
  bhopal_non_nabh_rate: number | null;
}

interface AddedImplant {
  id: string;
  implant_name: string;
  rate: number;
  amount: number;
}

interface AdvancePatientRow {
  patient: Patient;
  visitId: string;
  visitNumber: string;
  admissionDate: string | null;
  dischargeDate: string | null;
  registrationId: string | null;
  packageCode: string | null;
  packageName: string | null;
  plannedDischargeDate: string | null;
  todaysDischargeMarked: boolean;
  dischargeBillingStaff: string | null;
  arshiyaSummary: string | null;
  /** The specialist who treated the patient, and so who signs their documents. */
  consultant: string | null;
  billPaid: boolean | null;
  hospitalName: string | null;
  /**
   * Discharged in the IPD workflow — what Save Discharge on the Final Bill
   * sets. The gate pass is only allowed once this is true.
   */
  isDischarged: boolean;
}

interface GeneratedArshiaPdf {
  fileName: string;
  publicUrl: string;
  summaryText: string;
}

const isMaharashtraYojana = (corporate: string | null | undefined) => {
  const value = (corporate || "").toLowerCase().trim();
  return (
    value.includes("yojana") ||
    value.includes("mjpjy") ||
    value.includes("ayushman") ||
    value.includes("mahatma jyotiba") ||
    value.includes("pmjay") ||
    value.includes("ab-pmjay") ||
    value.includes("ab pmjay") ||
    value.includes("maharashtra yojana")
  );
};

const defaultImplantRate = (implant: ImplantOption, corporate: string | null | undefined) => {
  const preferYojana = isMaharashtraYojana(corporate);
  const ordered = preferYojana
    ? [implant.nabh_nabl_rate, implant.private_rate, implant.non_nabh_nabl_rate, implant.bhopal_nabh_rate, implant.bhopal_non_nabh_rate]
    : [implant.private_rate, implant.nabh_nabl_rate, implant.non_nabh_nabl_rate, implant.bhopal_nabh_rate, implant.bhopal_non_nabh_rate];
  return ordered.find((rate) => rate !== null && rate !== undefined) ?? 0;
};

const safeFilePart = (value: string | null | undefined) =>
  String(value || "patient").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 80);

const normalizeWhatsAppPhone = (phone: string | null | undefined) => {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

function extractGeneratedText(data: any): string {
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}


async function runArshiaModel(
  prompt: string,
  images: VpsClaudeImage[] = [],
  opts: { thinkingBudget?: number } = {},
): Promise<string> {
  if (LLM_BACKEND === "vps") {
    return callVpsClaude(prompt, "opus", images);
  }

  const parts: GeminiPart[] = [
    { text: prompt },
    ...images.map((image) => ({
      inline_data: { mime_type: image.mimeType, data: image.base64 },
    })),
  ];

  const response = await geminiFetch(geminiGenerateContentUrl("", GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(describeGeminiError(data, response.status));
  }

  const text = extractGeneratedText(data);
  if (!text) throw new Error("The AI returned an empty response.");
  return text;
}

async function docToVisionImage(doc: PatientDoc): Promise<VpsClaudeImage> {
  const response = await fetch(doc.fileUrl);
  if (!response.ok) throw new Error(`Could not fetch ${doc.fileName || "uploaded image"}.`);
  const blob = await response.blob();
  // Pre-auth forms are handwritten. The app-wide 1600px cap loses the pen
  // strokes on small fields, so this flow pays for the extra pixels.
  const image = await downscaleImageForVision(blob, { maxEdge: 2600, quality: 0.92 });
  return {
    base64: image.base64,
    mimeType: image.mimeType || doc.fileType || blob.type || "image/jpeg",
  };
}

function stringifyInvestigationValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Dedupe by CONTENT, not by row id: the same lab report uploaded or synced
 * twice gets a fresh id each time, and id-based dedupe kept every copy — so
 * discharge summaries repeated the same report over and over. Two rows that
 * say the same thing are one investigation.
 */
const uniqueByContent = (items: any[], keyOf: (item: any) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item).toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return !key ? true : false;
    seen.add(key);
    return true;
  });
};

function describeSupabaseError(error: any): string {
  if (!error) return "Unknown error.";
  if (error.code === "57014") return "the database query timed out (57014). Please try again.";
  if (error instanceof Error) return error.message;
  const code = error.code ? `${error.code}: ` : "";
  return `${code}${error.message || error.details || JSON.stringify(error)}`;
}

const selectVisitLabResults = (visitUuid: string) =>
  supabase
    .from("lab_results" as any)
    .select("id, test_name, main_test_name, test_category, result_value, result_unit, reference_range, comments, result_status, created_at, file_name, file_url")
    .eq("visit_id", visitUuid)
    .order("created_at", { ascending: false })
    .limit(2000);

interface VisitInvestigationText {
  text: string;
  warnings: string[];
}

async function loadVisitInvestigationText(
  visitUuid: string,
  visitNumber?: string | null,
): Promise<VisitInvestigationText> {
  const visitKeys = [visitUuid, visitNumber].filter(Boolean) as string[];
  const [orderedLabsResult, structuredLabsResult, radiologyResult] = await Promise.all([
    supabase
      .from("visit_labs" as any)
      .select("id, status, ordered_date, completed_date, result_value, normal_range, notes, lab:lab_id(name)")
      .eq("visit_id", visitUuid),
    // lab_results is a very large table and can hit the statement timeout, so
    // give it one retry before reporting the section as failed.
    selectVisitLabResults(visitUuid).then((result) =>
      result.error?.code === "57014" ? selectVisitLabResults(visitUuid) : result,
    ),
    supabase
      .from("visit_radiology" as any)
      .select("id, status, ordered_date, completed_date, findings, impression, notes, report_text, file_name, file_url, radiology:radiology_id(name, category)")
      .eq("visit_id", visitUuid)
      .order("ordered_date", { ascending: false }),
  ]);

  const warnings: string[] = [];
  const sectionBody = (label: string, error: any, lines: string[], emptyText: string) => {
    if (error) {
      const message = `Could not load ${label}: ${describeSupabaseError(error)}`;
      warnings.push(message);
      return message;
    }
    return lines.length ? lines.join("\n") : emptyText;
  };

  const orderedLabs = uniqueByContent(
    (orderedLabsResult.data || []) as any[],
    (item) => [item.lab?.name, stringifyInvestigationValue(item.result_value), item.completed_date].filter(Boolean).join("|"),
  );
  const structuredLabs = uniqueByContent(
    (structuredLabsResult.data || []) as any[],
    (item) =>
      item.file_name
        ? `file:${item.file_name}`
        : [item.main_test_name, item.test_name, stringifyInvestigationValue(item.result_value), item.result_unit].filter(Boolean).join("|"),
  );
  const radiologyItems = uniqueByContent(
    (radiologyResult.data || []) as any[],
    (item) => [item.radiology?.name, item.file_name, item.findings, item.impression].filter(Boolean).join("|"),
  );

  const orderedLabLines = orderedLabs.map((item, index) => {
    const labName = item.lab?.name || "Lab investigation";
    const details = [
      item.status ? `status: ${item.status}` : "",
      item.result_value ? `result: ${stringifyInvestigationValue(item.result_value)}` : "",
      item.normal_range ? `normal range: ${item.normal_range}` : "",
      item.notes ? `notes: ${item.notes}` : "",
      item.completed_date ? `completed: ${shortDate(item.completed_date)}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${labName}${details.length ? ` - ${details.join("; ")}` : ""}`;
  });

  const structuredLabLines = structuredLabs.map((item, index) => {
    const testName = [item.main_test_name, item.test_name].filter(Boolean).join(" - ") || item.file_name || "Lab result";
    const details = [
      item.test_category ? `category: ${item.test_category}` : "",
      item.result_value ? `result: ${stringifyInvestigationValue(item.result_value)}` : "",
      item.result_unit ? `unit: ${item.result_unit}` : "",
      item.reference_range ? `reference range: ${item.reference_range}` : "",
      item.comments ? `comments: ${item.comments}` : "",
      item.result_status ? `status: ${item.result_status}` : "",
      item.file_name ? `file: ${item.file_name}` : "",
      item.file_url ? `file url: ${item.file_url}` : "",
      item.created_at ? `date: ${shortDate(item.created_at)}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${testName}${details.length ? ` - ${details.join("; ")}` : ""}`;
  });

  const radiologyLines = radiologyItems.map((item, index) => {
    const radiologyName = item.radiology?.name || "Radiology investigation";
    const details = [
      item.status ? `status: ${item.status}` : "",
      item.findings ? `findings: ${item.findings}` : "",
      item.impression ? `impression: ${item.impression}` : "",
      item.report_text ? `report: ${item.report_text}` : "",
      item.notes ? `notes: ${item.notes}` : "",
      item.file_name ? `file: ${item.file_name}` : "",
      item.file_url ? `file url: ${item.file_url}` : "",
      item.completed_date ? `completed: ${shortDate(item.completed_date)}` : "",
      !item.completed_date && item.ordered_date ? `ordered: ${shortDate(item.ordered_date)}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${radiologyName}${details.length ? ` - ${details.join("; ")}` : ""}`;
  });

  const text = [
    `VISIT KEYS: ${visitKeys.join(", ")}`,
    "",
    "LAB ORDERS / VISIT LABS",
    sectionBody("lab orders", orderedLabsResult.error, orderedLabLines, "No lab orders found for this visit."),
    "",
    "LAB RESULTS",
    sectionBody("lab results", structuredLabsResult.error, structuredLabLines, "No structured lab results found for this visit."),
    "",
    "RADIOLOGY INVESTIGATIONS",
    sectionBody("radiology investigations", radiologyResult.error, radiologyLines, "No radiology investigations found for this visit."),
  ].join("\n");

  return { text, warnings };
}

/** Module 6 — view a patient's advance statement, collect an advance, and
 * (once pre-auth is approved) record the registration ID, package and
 * implant for their visit. */
export default function AdvanceFlow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hospitalConfig, user } = useAuth();
  const { toast } = useToast();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [showAllPatients, setShowAllPatients] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [stage, setStage] = useState<"view" | "collect" | "billing">("view");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  const [remarks, setRemarks] = useState("");
  const [registrationIdInput, setRegistrationIdInput] = useState("");
  const [packageTerm, setPackageTerm] = useState("");
  const [packageCodeInput, setPackageCodeInput] = useState("");
  const [packageNameInput, setPackageNameInput] = useState("");
  const [implantTerm, setImplantTerm] = useState("");
  const [selectedImplant, setSelectedImplant] = useState<ImplantOption | null>(null);
  const [implantRate, setImplantRate] = useState("");
  const [imagesOpen, setImagesOpen] = useState(false);
  const [viewingImage, setViewingImage] = useState<PatientDoc | null>(null);
  /** Pre-auth forms are handwritten, so the dialog-sized preview is often too
   *  small to read. This holds the doc being shown edge to edge. */
  const [fullscreenImage, setFullscreenImage] = useState<PatientDoc | null>(null);

  // Escape should drop out of full screen, not close the whole images dialog
  // underneath it, so intercept the key before the dialog sees it.
  useEffect(() => {
    if (!fullscreenImage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setFullscreenImage(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreenImage]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [arshiaPrompt, setArshiaPrompt] = useState(DEFAULT_ARSHIA_DISCHARGE_PROMPT);
  const [preauthTranscript, setPreauthTranscript] = useState("");
  const [medicationOnDischarge, setMedicationOnDischarge] = useState("");
  const [investigationText, setInvestigationText] = useState("");
  const [generatedDischargeSummary, setGeneratedDischargeSummary] = useState("");
  const [arshiaError, setArshiaError] = useState<string | null>(null);
  const [arshiaWarning, setArshiaWarning] = useState<string | null>(null);
  const [isTranscribingPreauth, setIsTranscribingPreauth] = useState(false);
  const [isLoadingInvestigations, setIsLoadingInvestigations] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  // "discharge" writes the discharge summary; "death" writes the death
  // summary in the same tile, stored in the same field, printed with the
  // matching document title.
  const [summaryMode, setSummaryMode] = useState<"discharge" | "death">("discharge");
  const [deathDate, setDeathDate] = useState("");
  const [deathTime, setDeathTime] = useState("");
  const [generatedArshiaPdf, setGeneratedArshiaPdf] = useState<GeneratedArshiaPdf | null>(null);
  const [isGeneratingArshiaPdf, setIsGeneratingArshiaPdf] = useState(false);
  const [isSendingArshiaWhatsApp, setIsSendingArshiaWhatsApp] = useState(false);
  // Planned-discharge worklist. Busy states are keyed by visit id so one row's
  // spinner does not freeze the whole list.
  const [thumbCameraRow, setThumbCameraRow] = useState<AdvancePatientRow | null>(null);
  const [thumbUploadRow, setThumbUploadRow] = useState<AdvancePatientRow | null>(null);
  const [thumbUploadingVisitId, setThumbUploadingVisitId] = useState<string | null>(null);
  const [gatePassVisitId, setGatePassVisitId] = useState<string | null>(null);
  const [summaryPdfVisitId, setSummaryPdfVisitId] = useState<string | null>(null);
  const [dischargeConfirmRow, setDischargeConfirmRow] = useState<AdvancePatientRow | null>(null);
  const thumbFileInputRef = useRef<HTMLInputElement>(null);

  const patientRows = useQuery({
    queryKey: ["tablet-advance-patient-list", showAllPatients, hospitalConfig?.name, patientSearch.trim()],
    queryFn: async (): Promise<AdvancePatientRow[]> => {
      const searchActive = patientSearch.trim().length > 0;
      let query = supabase
        .from("visits")
        .select(
          "id, visit_id, admission_date, discharge_date, is_discharged, status, yojana_registration_id, package_code, package_name, patient_id, planned_discharge_date, discharge_billing_staff, arshiya_discharge_summary, bill_paid, appointment_with, patients!inner(id, name, patients_id, phone, age, gender, corporate, hospital_name, aadhaar_number)",
        )
        .eq("patient_type", "IPD")
        .not("admission_date", "is", null)
        .order("admission_date", { ascending: false });

      // A search should also find discharged patients; the toggle controls the
      // unfiltered default list, while search itself searches all IPD visits.
      if (!showAllPatients && !searchActive) query = query.is("discharge_date", null);
      if (hospitalConfig?.name) query = query.eq("patients.hospital_name", hospitalConfig.name);

      const { data, error } = await query;
      if (error) throw error;

      const seen = new Set<string>();
      return (data || []).reduce<AdvancePatientRow[]>((rows, row: any) => {
        const relatedPatient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
        if (!relatedPatient?.id || seen.has(relatedPatient.id)) return rows;
        seen.add(relatedPatient.id);
        rows.push({
          patient: {
            ...relatedPatient,
            created_at: relatedPatient.created_at || row.admission_date || new Date().toISOString(),
          } as Patient,
          visitId: row.id,
          visitNumber: row.visit_id,
          admissionDate: row.admission_date,
          dischargeDate: row.discharge_date,
          registrationId: row.yojana_registration_id,
          packageCode: row.package_code,
          packageName: row.package_name,
          plannedDischargeDate: row.planned_discharge_date,
          todaysDischargeMarked: row.planned_discharge_date === todayIso,
          dischargeBillingStaff: row.discharge_billing_staff,
          arshiyaSummary: row.arshiya_discharge_summary,
          consultant: row.appointment_with ?? null,
          billPaid: row.bill_paid,
          hospitalName: relatedPatient.hospital_name ?? null,
          // Save Discharge on the Final Bill sets all three; older visits
          // discharged before that flag existed carry only a discharge date.
          isDischarged:
            row.is_discharged === true ||
            String(row.status || "").toLowerCase() === "discharged" ||
            !!row.discharge_date,
        });
        return rows;
      }, []);
    },
    staleTime: 30_000,
  });

  const filteredPatientRows = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patientRows.data || [];
    return (patientRows.data || []).filter(({ patient: item, registrationId, visitNumber, packageCode, packageName }) =>
      [item.name, item.patients_id, item.phone, registrationId, visitNumber, packageCode, packageName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [patientRows.data, patientSearch]);

  // "Today" in the browser's timezone, matched against the date stored when the
  // discharge was ticked. A tick nobody acted on stops counting as planned when
  // the date rolls over.
  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const plannedRows = useMemo(
    () => filteredPatientRows.filter((row) => row.plannedDischargeDate === todayIso),
    [filteredPatientRows, todayIso],
  );
  const unplannedRows = useMemo(
    () => filteredPatientRows.filter((row) => row.plannedDischargeDate !== todayIso),
    [filteredPatientRows, todayIso],
  );

  const plannedPatientIds = useMemo(
    () => plannedRows.map((row) => row.patient.id).sort(),
    [plannedRows],
  );

  /** One query for the whole planned list — a patient is unlocked when they have
   *  at least one portal thumb confirmation on file. */
  const thumbConfirmations = useQuery({
    queryKey: ["tablet-discharge-thumb-confirmations", plannedPatientIds.join(",")],
    enabled: plannedPatientIds.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<Map<string, PatientDoc>> => {
      const { data, error } = await supabase
        .from("file_uploads")
        .select("id, file_name, file_url, file_type, storage_path, created_at, latitude, longitude, notes, category, patient_id")
        .eq("category", THUMB_CONFIRMATION_CATEGORY)
        .in("patient_id", plannedPatientIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const byPatient = new Map<string, PatientDoc>();
      (data || []).forEach((row: any) => {
        if (!byPatient.has(row.patient_id)) {
          byPatient.set(row.patient_id, {
            id: row.id,
            fileName: row.file_name ?? "file",
            displayName: row.file_name ?? "file",
            fileUrl: row.file_url ?? "",
            fileType: row.file_type ?? null,
            storagePath: row.storage_path ?? null,
            uploadedAt: row.created_at ?? null,
            latitude: row.latitude ?? null,
            longitude: row.longitude ?? null,
            notes: row.notes ?? null,
          });
        }
      });
      return byPatient;
    },
  });

  const refreshDischargePlanning = () => {
    qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
    qc.invalidateQueries({ queryKey: ["tablet-discharge-thumb-confirmations"] });
  };

  const togglePlannedDischarge = useMutation({
    mutationFn: async ({ row, planned }: { row: AdvancePatientRow; planned: boolean }) => {
      const now = new Date();
      const { error } = await supabase
        .from("visits")
        .update(
          (planned
            ? {
                planned_discharge_date: todayIso,
                planned_discharge_marked_at: now.toISOString(),
                planned_discharge_marked_by: user?.id ?? null,
                discharge_billing_staff: resolveDischargeStaff(now),
              }
            : {
                planned_discharge_date: null,
                planned_discharge_marked_at: null,
                planned_discharge_marked_by: null,
                discharge_billing_staff: null,
              }) as any,
        )
        .eq("id", row.visitId);
      if (error) throw error;
    },
    onSuccess: () => refreshDischargePlanning(),
    onError: (error: any) => {
      toast({
        title: "Could not update the discharge plan",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const uploadThumbConfirmation = async (
    row: AdvancePatientRow,
    items: File[] | CapturedPhotoItem[],
  ) => {
    if (!items.length) return;
    setThumbUploadingVisitId(row.visitId);
    try {
      await uploadPatientDocs(items as any, {
        patientId: row.patient.id,
        patientName: row.patient.name,
        category: THUMB_CONFIRMATION_CATEGORY,
        uploadedBy: user?.id ?? null,
        notes: `PORTAL_THUMB_CONFIRMATION|visit:${row.visitNumber}`,
      });
      await qc.invalidateQueries({ queryKey: ["tablet-discharge-thumb-confirmations"] });
      toast({
        title: "Thumb confirmation saved",
        description: "Gate pass, discharge summary and discharge are now unlocked.",
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error?.message || "Could not save the confirmation.",
        variant: "destructive",
      });
    } finally {
      setThumbUploadingVisitId(null);
    }
  };

  const generatePlannedGatePass = async (row: AdvancePatientRow) => {
    // The gate pass is the patient's authority to leave, so it must follow the
    // discharge rather than anticipate it. The button is disabled until then;
    // this guard covers every other way of reaching here.
    if (!row.isDischarged) {
      toast({
        title: "Patient is not discharged yet",
        description:
          "Complete the Final Bill and press Save Discharge first. The gate pass unlocks once the patient is marked discharged.",
        variant: "destructive",
      });
      return;
    }
    setGatePassVisitId(row.visitId);
    try {
      // Reuse an existing pass rather than minting a second number for the same
      // visit — the number is what security checks at the gate.
      const { data: existing, error: existingError } = await supabase
        .from("gate_passes")
        .select("gate_pass_number")
        .eq("visit_id", row.visitId)
        .maybeSingle();
      if (existingError) throw existingError;

      if (!existing) {
        const { data: gatePassNumber, error: numberError } = await supabase.rpc(
          "generate_gate_pass_number",
        );
        if (numberError) throw numberError;

        const { error: insertError } = await supabase.from("gate_passes").insert({
          gate_pass_number: gatePassNumber,
          visit_id: row.visitId,
          patient_id: row.patient.id,
          patient_name: row.patient.name,
          discharge_date: row.dischargeDate || new Date().toISOString(),
          discharge_mode: "recovery",
          bill_paid: row.billPaid ?? false,
          barcode_data: `${gatePassNumber}-${row.visitNumber}`,
        } as any);
        if (insertError) throw insertError;
      }

      // The print route filters on the business visit_id string, not the UUID.
      window.open(`/gate-pass/${row.visitNumber}`, "_blank");
    } catch (error: any) {
      toast({
        title: "Gate pass failed",
        description: error?.message || "Could not generate the gate pass.",
        variant: "destructive",
      });
    } finally {
      setGatePassVisitId(null);
    }
  };

  const downloadPlannedSummaryPdf = async (row: AdvancePatientRow) => {
    const summaryText = (row.arshiyaSummary || "").trim();
    if (!summaryText) {
      toast({
        title: "No discharge summary yet",
        description: "Open this patient and generate the summary in their billing screen first.",
        variant: "destructive",
      });
      return;
    }

    setSummaryPdfVisitId(row.visitId);
    try {
      const blob = await buildArshiyaSummaryPdfBlob({
        summaryText,
        // Discharge summaries are official hospital documents. Every copy uses
        // the hospital letterhead rather than allowing an unbranded variant.
        withLogo: true,
        hospitalName: hospitalConfig?.name || row.hospitalName || "Hospital",
        patientName: row.patient.name,
        patientId: row.patient.patients_id,
        visitNumber: row.visitNumber,
        registrationId: row.registrationId,
        aadhaarNumber: row.patient.aadhaar_number,
        mobileNumber: row.patient.phone,
        portalUrl: `${window.location.origin}/patient-portal`,
        signatory: await loadSummarySignatory(row.consultant),
      });
      const fileName = `Discharge_Summary_Letterhead_${safeFilePart(row.patient.patients_id || row.visitNumber)}.pdf`;
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error: any) {
      toast({
        title: "PDF failed",
        description: error?.message || "Could not create the PDF.",
        variant: "destructive",
      });
    } finally {
      setSummaryPdfVisitId(null);
    }
  };

  const dischargePlannedPatient = useMutation({
    mutationFn: async (row: AdvancePatientRow) => {
      // Mirrors the field set the Final Bill final-payment step writes, because
      // different dashboards each read a different one of these three columns.
      const update: Record<string, unknown> = {
        discharge_date: new Date().toISOString(),
        status: "discharged",
        is_discharged: true,
        discharge_mode: "recovery",
      };

      const { data: current, error: currentError } = await supabase
        .from("visits")
        .select("discharged_sr_no")
        .eq("id", row.visitId)
        .maybeSingle();
      if (currentError) throw currentError;

      if (!(current as any)?.discharged_sr_no) {
        const hospital = hospitalConfig?.name || row.hospitalName;
        let srQuery = supabase
          .from("visits")
          .select("discharged_sr_no, patients!inner(hospital_name)")
          .not("discharged_sr_no", "is", null)
          .order("discharged_sr_no", { ascending: false })
          .limit(1);
        if (hospital) srQuery = srQuery.eq("patients.hospital_name", hospital);
        const { data: highest, error: srError } = await srQuery;
        if (srError) throw srError;
        update.discharged_sr_no = Number((highest?.[0] as any)?.discharged_sr_no || 0) + 1;
      }

      const { error } = await supabase.from("visits").update(update as any).eq("id", row.visitId);
      if (error) throw error;
    },
    onSuccess: () => {
      setDischargeConfirmRow(null);
      refreshDischargePlanning();
      toast({ title: "Patient discharged", description: "The visit is now closed." });
    },
    onError: (error: any) => {
      toast({
        title: "Discharge failed",
        description: error?.message || "Could not discharge the patient.",
        variant: "destructive",
      });
    },
  });

  const advances = useQuery({
    queryKey: ["tablet-advances", patient?.id],
    enabled: !!patient,
    queryFn: async (): Promise<AdvanceRow[]> => {
      const { data, error } = await supabase
        .from("advance_payment")
        .select(
          "id, advance_amount, returned_amount, is_refund, payment_date, payment_mode, status",
        )
        .eq("patient_id", patient!.id)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data || []) as AdvanceRow[];
    },
  });

  const visit = useQuery({
    queryKey: ["tablet-advance-visit", selectedVisitId, patient?.id],
    enabled: !!patient && !!selectedVisitId,
    queryFn: async (): Promise<VisitRow | null> => {
      const query = supabase
        .from("visits")
        .select("id, visit_id, admission_date, discharge_date, planned_discharge_date, yojana_registration_id, package_code, package_name, corporate, arshiya_discharge_summary, appointment_with")
        .eq("id", selectedVisitId!);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as VisitRow | null;
    },
  });

  const autoPackageCode = useQuery({
    queryKey: [
      "tablet-advance-package-code",
      visit.data?.id,
      visit.data?.package_name,
      visit.data?.yojana_registration_id,
    ],
    enabled: !!visit.data?.id && !!visit.data?.package_name && !visit.data?.package_code,
    queryFn: async () => {
      const code = await resolvePackageCodeFromSavedData({
        packageName: visit.data?.package_name,
        registrationId: visit.data?.yojana_registration_id,
      });
      if (!code || !visit.data?.id) return null;

      const { error } = await supabase
        .from("visits")
        .update({ package_code: code } as any)
        .eq("id", visit.data.id);
      if (error) throw error;

      return code;
    },
    staleTime: 1000 * 60 * 5,
  });

  const resolvedPackageCode =
    visit.data?.package_code ||
    autoPackageCode.data ||
    derivePackageCodeFromName(visit.data?.package_name) ||
    "";

  useEffect(() => {
    if (autoPackageCode.data) {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
    }
  }, [autoPackageCode.data, qc]);

  useEffect(() => {
    setRegistrationIdInput(visit.data?.yojana_registration_id || "");
    setPackageCodeInput(resolvedPackageCode || "");
    setPackageNameInput(visit.data?.package_name || "");
  }, [visit.data?.id, visit.data?.yojana_registration_id, visit.data?.package_name, resolvedPackageCode]);

  // Bring back the saved summary when a patient is reopened, so a draft written
  // in the morning is still there when billing picks the patient up later.
  useEffect(() => {
    setGeneratedDischargeSummary(visit.data?.arshiya_discharge_summary || "");
    setGeneratedArshiaPdf(null);
  }, [visit.data?.id]);

  const addedImplants = useQuery({
    queryKey: ["tablet-visit-implants", visit.data?.id],
    enabled: !!visit.data?.id,
    queryFn: async (): Promise<AddedImplant[]> => {
      const { data, error } = await supabase
        .from("visit_implants")
        .select("id, implant_name, rate, amount")
        .eq("visit_id", visit.data!.id)
        .eq("status", "Active");
      if (error) throw error;
      return (data || []) as AddedImplant[];
    },
  });

  const advanceImages = usePatientDocs(patient?.id, ADVANCE_IMAGE_CATEGORY);

  const packageResults = useQuery({
    queryKey: ["tablet-package-search", packageTerm],
    enabled: packageTerm.trim().length >= 2,
    queryFn: async (): Promise<PackageOption[]> => {
      const term = packageTerm.trim().toLowerCase();
      const [pmjayRes, yojanaRes, cghsRes] = await Promise.all([
        supabase
          .from("pmjay_mjpjay_packages")
          .select("id, treatment_code, treatment_plan")
          .eq("is_active", true)
          .order("treatment_plan"),
        supabase
          .from("yojana_mh_procedures")
          .select("id, procedure_code, package_code, package_name, procedure_name, procedure_label")
          .order("package_name"),
        supabase.from("cghs_surgery").select("id, name").eq("is_active", true).order("name"),
      ]);
      if (pmjayRes.error) throw pmjayRes.error;
      if (yojanaRes.error) throw yojanaRes.error;
      if (cghsRes.error) throw cghsRes.error;

      const options = [
        ...(pmjayRes.data || []).map((row: any) => ({
          id: row.id,
          code: row.treatment_code || null,
          name: row.treatment_plan || row.treatment_code || "",
          label: [row.treatment_code, row.treatment_plan].filter(Boolean).join(" - "),
        })),
        ...(yojanaRes.data || []).map((row: any) => ({
          id: row.id,
          code: row.procedure_code || row.package_code || null,
          name: row.package_name || row.procedure_name || row.procedure_label || row.package_code || "",
          label: [
            row.procedure_code || row.package_code,
            row.package_name || row.procedure_name || row.procedure_label || row.package_code,
          ].filter(Boolean).join(" - "),
        })),
        ...(cghsRes.data || []).map((row: any) => ({ id: row.id, code: null, name: row.name || "", label: row.name || "" })),
      ];

      const unique = new Map<string, PackageOption>();
      options
        .filter((option) => option.label && option.label.toLowerCase().includes(term))
        .forEach((option) => {
          if (!unique.has(option.label)) unique.set(option.label, option);
        });
      return Array.from(unique.values()).slice(0, 15);
    },
  });

  const implantResults = useQuery({
    queryKey: ["tablet-implant-options"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ImplantOption[]> => {
      const { data, error } = await supabase
        .from("implants")
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate, bhopal_nabh_rate, bhopal_non_nabh_rate")
        .order("name")
      if (error) throw error;
      return (data || []) as ImplantOption[];
    },
  });

  const implantMatches = useMemo(() => {
    const term = implantTerm.trim().toLowerCase();
    if (!term) return [];
    return (implantResults.data || [])
      .filter((implant) => String(implant.name || "").toLowerCase().includes(term))
      .slice(0, 15);
  }, [implantResults.data, implantTerm]);

  const createImplant = useMutation({
    mutationFn: async (): Promise<ImplantOption> => {
      const name = implantTerm.trim();
      if (!name) throw new Error("Enter an implant name first");

      const { data, error } = await supabase
        .from("implants")
        .insert({ name })
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate, bhopal_nabh_rate, bhopal_non_nabh_rate")
        .single();
      if (error) throw error;
      return data as ImplantOption;
    },
    onSuccess: (implant) => {
      qc.setQueryData<ImplantOption[]>(["tablet-implant-options"], (current) => [
        ...(current || []),
        implant,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setSelectedImplant(implant);
      setImplantRate("");
      setImplantTerm(implant.name);
    },
  });

  const saveRegistrationId = useMutation({
    mutationFn: async () => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const value = registrationIdInput.trim().toUpperCase();
      const { error } = await supabase
        .from("visits")
        .update({ yojana_registration_id: value || null })
        .eq("id", visit.data.id);
      if (error) throw error;
      if (!value) return { portalMatched: false };
      try {
        return { portalMatched: await syncPortalDataForRegistrationId(value) };
      } catch {
        return { portalMatched: false };
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
    },
  });

  const saveRegistrationIfChanged = () => {
    const current = visit.data?.yojana_registration_id || "";
    if (registrationIdInput.trim().toUpperCase() !== current.toUpperCase() && !saveRegistrationId.isPending) {
      saveRegistrationId.mutate();
    }
  };

  const savePackage = useMutation({
    mutationFn: async ({ code, name }: { code: string | null; name: string }) => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const { error } = await supabase
        .from("visits")
        .update({ package_code: code || null, package_name: name } as any)
        .eq("id", visit.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
      setPackageTerm("");
    },
  });

  const createPackage = useMutation({
    mutationFn: async () => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const code = packageCodeInput.trim();
      const name = packageNameInput.trim();
      if (!code || !name) throw new Error("Enter both package code and package name");

      const duplicate = await supabase
        .from("pmjay_mjpjay_packages")
        .select("id")
        .eq("treatment_code", code)
        .eq("treatment_plan", name)
        .maybeSingle();
      if (duplicate.error) throw duplicate.error;
      let packageId = duplicate.data?.id || "";
      if (!packageId) {
        const created = await supabase
          .from("pmjay_mjpjay_packages")
          .insert({
            scheme: "PMJAY/MJPJAY",
            treatment_code: code,
            treatment_plan: name,
            is_active: true,
          })
          .select("id, treatment_code, treatment_plan")
          .single();
        if (created.error) throw created.error;
        packageId = created.data.id;
      }

      const visitUpdate = await supabase
        .from("visits")
        .update({ package_code: code, package_name: name } as any)
        .eq("id", visit.data.id);
      if (visitUpdate.error) throw visitUpdate.error;

      return { id: packageId, code, name, label: `${code} - ${name}` } satisfies PackageOption;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
      setPackageTerm("");
    },
  });

  const addImplant = useMutation({
    mutationFn: async () => {
      if (!visit.data || !selectedImplant) throw new Error("Pick an implant first");
      const rate = Number(implantRate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("Enter a valid implant amount");
      const { error } = await supabase.from("visit_implants").insert({
        implant_id: selectedImplant.id,
        visit_id: visit.data.id,
        implant_name: selectedImplant.name,
        quantity: 1,
        rate,
        amount: rate,
        rate_type: isMaharashtraYojana(visit.data.corporate) ? "nabh_nabl" : "private",
        status: "Active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-visit-implants", visit.data?.id] });
      setSelectedImplant(null);
      setImplantTerm("");
      setImplantRate("");
    },
  });

  const collect = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!patient || !value || value <= 0) throw new Error("Enter a valid amount");
      if (!visit.data?.visit_id) throw new Error("No visit found for this patient");
      const { error } = await supabase.from("advance_payment").insert({
        patient_id: patient.id,
        visit_id: visit.data.visit_id,
        patient_name: patient.name,
        patients_id: patient.patients_id || null,
        advance_amount: value,
        returned_amount: 0,
        is_refund: false,
        payment_date: new Date().toISOString(),
        payment_mode: mode,
        remarks: remarks.trim() || null,
        status: "ACTIVE",
        // Whose drawer this cash lands in, for the cash handover.
        collected_by_user_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advances", patient?.id] });
    },
  });

  const downloadImage = async (doc: PatientDoc) => {
    const response = await fetch(doc.fileUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = doc.fileName || "image";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleDeleteImage = async (doc: PatientDoc) => {
    if (!window.confirm("Delete this image? This cannot be undone.")) return;

    setDeletingImageId(doc.id);
    try {
      await deletePatientDoc(doc);
      if (viewingImage?.id === doc.id) setViewingImage(null);
      if (fullscreenImage?.id === doc.id) setFullscreenImage(null);
      await qc.invalidateQueries({
        queryKey: ["tablet-patient-docs", patient?.id, ADVANCE_IMAGE_CATEGORY],
      });
      toast({ title: "Image deleted", description: "The Advance image was removed." });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete the image.",
        variant: "destructive",
      });
    } finally {
      setDeletingImageId(null);
    }
  };

  const handleImageFiles = async (files: File[]): Promise<boolean> => {
    if (!patient || files.length === 0) return false;
    setUploadingImages(true);
    setCameraError(null);
    try {
      const prepared: File[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const compressed = await compressImageToLimit(file, MAX_FILE_BYTES);
        if (compressed.size <= MAX_FILE_BYTES) prepared.push(compressed);
      }
      if (prepared.length === 0) {
        setCameraError("No usable image was captured. Please retake the photo or use Upload image.");
        return false;
      }
      await uploadPatientDocs(prepared, {
        patientId: patient.id,
        patientName: patient.name,
        category: ADVANCE_IMAGE_CATEGORY,
        uploadedBy: user?.id ?? null,
        placeLabel: `${hospitalConfig.fullName}, ${hospitalConfig.contactInfo.address}, India`,
      });
      await qc.invalidateQueries({
        queryKey: ["tablet-patient-docs", patient.id, ADVANCE_IMAGE_CATEGORY],
      });

      const refreshedImages = await advanceImages.refetch();
      await transcribePreauthImages(refreshedImages.data || []);
      return true;
    } catch (error) {
      console.error("Advance image upload failed:", error);
      setCameraError(error instanceof Error ? error.message : "Unable to save the captured image.");
      return false;
    } finally {
      setUploadingImages(false);
    }
  };

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    if (!cameraOpen) {
      stopCamera();
      return;
    }

    let cancelled = false;
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera capture is not supported in this browser.");
        return;
      }

      setCameraStarting(true);
      setCameraReady(false);
      setCameraError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1600 },
            height: { ideal: 1200 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          const video = cameraVideoRef.current;
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          await video.play();
          setCameraReady(video.readyState >= 2 || video.videoWidth > 0);
        }
      } catch (error) {
        console.error("Advance image camera failed:", error);
        setCameraError(error instanceof Error ? error.message : "Unable to open the camera. Please allow camera access or use Upload image.");
      } finally {
        if (!cancelled) setCameraStarting(false);
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [cameraOpen, stopCamera]);

  const captureCameraImage = async () => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    setCameraError(null);
    if (!patient || !video || !canvas || video.readyState < 2 || !cameraReady) {
      setCameraError("Camera preview is not ready yet.");
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 960;
    if (width <= 0 || height <= 0) {
      setCameraError("Camera preview is not ready yet. Please wait a moment and try again.");
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Unable to capture the camera image.");
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
        return;
      }

      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const [header, data] = dataUrl.split(",");
        const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        resolve(new Blob([bytes], { type: mime }));
      } catch {
        resolve(null);
      }
    });
    if (!blob) {
      setCameraError("Unable to save the captured image.");
      return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safePatientId = (patient.patients_id || patient.id || "patient").replace(/[^a-zA-Z0-9_-]/g, "_");
    const file = new File([blob], `pre_authorization_${safePatientId}_${stamp}.jpg`, {
      type: "image/jpeg",
    });

    const saved = await handleImageFiles([file]);
    if (saved) setCameraOpen(false);
  };

  const transcribePreauthImages = async (uploadedDocs: PatientDoc[] = advanceImages.data || []) => {
    const docs = uploadedDocs;
    if (!patient) return;
    if (docs.length === 0) {
      setArshiaError("Upload or capture the filled pre-authorization form first.");
      return;
    }

    setIsTranscribingPreauth(true);
    setArshiaError(null);
    setArshiaWarning(null);
    try {
      const visionDocs = docs.slice(0, MAX_VISION_IMAGES);
      if (docs.length > MAX_VISION_IMAGES) {
        setArshiaWarning(
          `Transcribed the first ${MAX_VISION_IMAGES} of ${docs.length} uploaded images. Delete or reorder images so the filled pre-authorization pages are first, then transcribe again.`,
        );
      }
      const images = await Promise.all(visionDocs.map(docToVisionImage));
      const text = await runArshiaModel(
        `Extract all visible text from the uploaded filled pre-authorization form images for discharge-summary preparation.

Rules:
- Return factual text only.
- Do not infer hidden or cropped details.
- Mark a field [blank] when the form has that field but nothing was written in it.
- Mark a field [unclear] only when something IS written there but you cannot read it confidently. Never use [unclear] for an empty field.
- Read numeric identifiers (patient ID, package code, package amount, dates, number of days) digit by digit and report your best reading; fall back to [unclear] only if the digits are genuinely illegible.
- Extract every available detail, including patient details, hospital details, diagnosis, history, examination, treatment, requested procedure, doctor details, dates, identifiers, and remarks.
- Preserve the visible wording and values exactly wherever possible.
- Do not add any clinical facts that are not visible in the images.

Return clean, properly formatted plain text with clear headings and field labels. Include all pages/images in the result.`,
        images,
        { thinkingBudget: 2048 },
      );
      setPreauthTranscript(text);
    } catch (error) {
      setArshiaError(error instanceof Error ? error.message : "Could not transcribe the pre-authorization form.");
    } finally {
      setIsTranscribingPreauth(false);
    }
  };

  const fetchArshiaInvestigations = async () => {
    if (!visit.data?.id) {
      setArshiaError("Select a patient visit before fetching investigations.");
      return;
    }

    setIsLoadingInvestigations(true);
    setArshiaError(null);
    setArshiaWarning(null);
    try {
      const { text, warnings } = await loadVisitInvestigationText(visit.data.id, visit.data.visit_id);
      setInvestigationText(text);
      setArshiaWarning(warnings.length ? warnings.join(" ") : null);
    } catch (error) {
      setArshiaError(`Could not fetch investigations: ${describeSupabaseError(error)}`);
    } finally {
      setIsLoadingInvestigations(false);
    }
  };

  const generateArshiaSummary = async () => {
    if (!patient || !visit.data) {
      setArshiaError("Select a patient visit before generating the discharge summary.");
      return;
    }

    setIsGeneratingSummary(true);
    setArshiaError(null);
    setArshiaWarning(null);
    try {
      let currentInvestigationText = investigationText.trim();
      if (!currentInvestigationText) {
        const { text, warnings } = await loadVisitInvestigationText(visit.data.id, visit.data.visit_id);
        currentInvestigationText = text;
        setInvestigationText(text);
        setArshiaWarning(warnings.length ? warnings.join(" ") : null);
      }

      // The system already knows the diagnoses, the procedure, and who
      // operated — the summary must correlate with them, so they are fetched
      // and handed to the model as established facts.
      const [diagnosesRes, surgeriesRes, otRes] = await Promise.all([
        supabase
          .from("visit_diagnoses" as any)
          .select("is_primary, diagnoses(name)")
          .eq("visit_id", visit.data.id),
        supabase
          .from("visit_surgeries" as any)
          .select("sanction_status, cghs_surgery(name, code)")
          .eq("visit_id", visit.data.id),
        supabase
          .from("ot_schedule" as any)
          .select("surgery_name, scheduled_date, scheduled_time, status, surgeon_name, anesthetist_name, special_requirements")
          .eq("visit_id", visit.data.id)
          .order("scheduled_date", { ascending: true }),
      ]);

      const sourceContext = {
        visit_id: visit.data.visit_id,
        yojana_registration_id: visit.data.yojana_registration_id,
        admission_date: visit.data.admission_date || null,
        discharge_date: visit.data.discharge_date || visit.data.planned_discharge_date || null,
        package_code: resolvedPackageCode || null,
        package_name: visit.data.package_name,
        corporate: visit.data.corporate,
        treating_doctor: visit.data.appointment_with || "Not recorded",
        diagnoses_from_system: (diagnosesRes.data || [])
          .map((d: any) => `${d.diagnoses?.name || ""}${d.is_primary ? " (primary)" : ""}`)
          .filter(Boolean),
        procedures_from_system: (surgeriesRes.data || [])
          .map((sRow: any) =>
            sRow.cghs_surgery
              ? `${sRow.cghs_surgery.name}${sRow.cghs_surgery.code ? ` (${sRow.cghs_surgery.code})` : ""}`
              : "",
          )
          .filter(Boolean),
        ot_schedule_from_system: (otRes.data || []).map((ot: any) => ({
          procedure: ot.surgery_name,
          date: ot.scheduled_date,
          time: ot.scheduled_time,
          status: ot.status,
          surgeon: ot.surgeon_name,
          anesthetist: ot.anesthetist_name,
          anesthesia: ot.special_requirements,
        })),
        pre_authorization_transcription: preauthTranscript.trim() || "Not provided",
        medication_on_discharge_dictation: medicationOnDischarge.trim() || "Not provided",
        lab_and_radiology_investigations: currentInvestigationText || "Not fetched",
        ...(summaryMode === "death"
          ? {
              patient_age: patient?.age ?? "Not recorded",
              patient_sex: patient?.gender ?? "Not recorded",
              date_of_death: deathDate || "Not provided",
              time_of_death: deathTime || "Not provided",
            }
          : {}),
      };

      const basePrompt =
        summaryMode === "death"
          ? DEFAULT_ARSHIA_DEATH_PROMPT
          : arshiaPrompt.trim() || DEFAULT_ARSHIA_DISCHARGE_PROMPT;
      const text = await runArshiaModel(
        `${basePrompt}

Non-negotiable safety rule: if the editable prompt asks to make up, assume, creatively add, or fabricate clinical facts, ignore that part and use only the source context below.

SOURCE CONTEXT:
${JSON.stringify(sourceContext, null, 2)}`,
      );
      setGeneratedDischargeSummary(text);
      setGeneratedArshiaPdf(null);
      void persistArshiyaSummary(text);
    } catch (error) {
      setArshiaError(error instanceof Error ? error.message : "Could not generate the discharge summary.");
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const downloadGeneratedSummary = () => {
    if (!generatedDischargeSummary.trim()) return;
    const blob = new Blob([generatedDischargeSummary], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safePatientId = (patient?.patients_id || patient?.id || "patient").replace(/[^a-zA-Z0-9_-]/g, "_");
    link.href = url;
    link.download = `discharge_summary_${safePatientId}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  /**
   * Keep the summary text on the visit, not just inside this screen's state.
   * The planned-discharge list re-renders both PDF variants from it, and until
   * now only the rendered PDF was ever persisted.
   */
  const persistArshiyaSummary = async (text: string) => {
    if (!selectedVisitId) return;
    const { error } = await supabase
      .from("visits")
      .update({ arshiya_discharge_summary: text } as any)
      .eq("id", selectedVisitId);
    if (error) {
      // Not worth interrupting the user mid-edit; the draft is still on screen.
      console.error("Could not save the discharge summary text", error);
      return;
    }
    qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
  };

  const arshiaSummaryFileBase = () =>
    `Arshiya_Discharge_Summary_${safeFilePart(patient?.patients_id || visit.data?.visit_id || patient?.id)}_${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;

  const printArshiaSummary = async () => {
    const summary = generatedDischargeSummary.trim();
    if (!summary) return;

    // Print the same official, branded PDF that is downloaded and shared on
    // WhatsApp. Keeping print on the PDF path avoids a plain HTML printout
    // that would omit the hospital letterhead.
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast({
        title: "Print blocked",
        description: "Allow popups for this site and try printing again.",
        variant: "destructive",
      });
      return;
    }

    try {
      const blob = await buildArshiaSummaryPdfBlob();
      const printUrl = URL.createObjectURL(blob);
      printWindow.location.replace(printUrl);
      // Give the browser's PDF viewer time to load before releasing the blob.
      window.setTimeout(() => URL.revokeObjectURL(printUrl), 60_000);
    } catch (error) {
      printWindow.close();
      const message = error instanceof Error ? error.message : "Could not prepare the discharge summary for printing.";
      setArshiaError(message);
      toast({ title: "Print failed", description: message, variant: "destructive" });
    }
  };

  const buildArshiaSummaryPdfBlob = async () =>
    buildArshiyaSummaryPdfBlob({
      summaryText: generatedDischargeSummary,
      // The official copy: hospital letterhead on every page.
      withLogo: true,
      documentTitle: generatedDischargeSummary.includes("## Cause of Death")
        ? "DEATH SUMMARY"
        : "DISCHARGE SUMMARY",
      hospitalName: hospitalConfig?.name || (patient as any)?.hospital_name || "Hospital",
      patientName: patient?.name,
      patientId: patient?.patients_id,
      visitNumber: visit.data?.visit_id,
      registrationId: registrationIdInput || visit.data?.yojana_registration_id,
      // Both documents this builds — discharge and death — identify the
      // patient to a panel or a registrar, so the number belongs on them.
      aadhaarNumber: patient?.aadhaar_number,
      mobileNumber: patient?.phone,
      portalUrl: `${window.location.origin}/patient-portal`,
      signatory: await loadSummarySignatory(visit.data?.appointment_with),
    });

  const generateAndUploadArshiaSummaryPdf = async (shouldDownload: boolean) => {
    const currentSummary = generatedDischargeSummary.trim();
    if (!currentSummary) {
      setArshiaError("Generate the discharge summary before creating a PDF.");
      throw new Error("Generate the discharge summary before creating a PDF.");
    }

    if (!shouldDownload && generatedArshiaPdf?.summaryText === currentSummary) {
      return generatedArshiaPdf;
    }

    setIsGeneratingArshiaPdf(true);
    setArshiaError(null);
    setArshiaWarning(null);
    try {
      const blob = await buildArshiaSummaryPdfBlob();
      const fileName = `${arshiaSummaryFileBase()}.pdf`;
      const storagePath = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName}`;
      const file = new File([blob], fileName, { type: "application/pdf" });

      const { error: storageError } = await supabase.storage
        .from("uploads")
        .upload(storagePath, file, { contentType: "application/pdf" });
      if (storageError) throw storageError;

      const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(storagePath);
      const publicUrl = urlData?.publicUrl || "";

      const { error: insertError } = await (supabase as any)
        .from("file_uploads")
        .insert({
          file_name: fileName,
          file_url: publicUrl,
          file_type: "application/pdf",
          file_size: file.size,
          storage_path: storagePath,
          category: "discharge_summary",
          patient_id: patient?.id || null,
          patient_name: patient?.name || null,
          notes: `AUTO_GENERATED_ARSHIYA_DISCHARGE_SUMMARY|visit:${visit.data?.visit_id || selectedVisitId || "-"}`,
          uploaded_by: user?.id || null,
          status: "completed",
        });
      if (insertError) throw insertError;

      if (shouldDownload) {
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(downloadUrl);
      }

      const generated = { fileName, publicUrl, summaryText: currentSummary };
      setGeneratedArshiaPdf(generated);
      toast({
        title: "PDF ready",
        description: shouldDownload ? "The discharge summary PDF was downloaded and saved for WhatsApp." : "The discharge summary PDF was saved for WhatsApp.",
      });
      return generated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the PDF.";
      setArshiaError(message);
      toast({ title: "PDF failed", description: message, variant: "destructive" });
      throw error;
    } finally {
      setIsGeneratingArshiaPdf(false);
    }
  };

  const downloadArshiaSummaryPdf = async () => {
    try {
      await generateAndUploadArshiaSummaryPdf(true);
    } catch {
      // generateAndUploadArshiaSummaryPdf shows the user-facing error.
    }
  };

  const sendArshiaSummaryOnWhatsApp = async () => {
    const to = normalizeWhatsAppPhone(patient?.phone);
    if (!to) {
      toast({
        title: "WhatsApp number missing",
        description: "The patient does not have a registered mobile number.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingArshiaWhatsApp(true);
    setArshiaError(null);
    setArshiaWarning(null);
    try {
      const pdf = generatedArshiaPdf?.summaryText === generatedDischargeSummary.trim()
        ? generatedArshiaPdf
        : await generateAndUploadArshiaSummaryPdf(false);
      const portalUrl = `${window.location.origin}/patient-portal`;
      const caption = [
        `Dear ${patient?.name || "Patient"}, your discharge summary from ${hospitalConfig?.name || "the hospital"} is attached.`,
        `Patient Portal: ${portalUrl}`,
        `Patient ID: ${patient?.patients_id || "-"}`,
        "Please use the password provided by the hospital.",
      ].join("\n");

      const response = await fetch("/api/send-discharge-pdf-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          mediaUrl: pdf.publicUrl,
          filename: pdf.fileName,
          caption,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.detail || result?.error || "DoubleTick send failed.");
      }

      toast({
        title: "Sent on WhatsApp",
        description: `The discharge summary PDF was sent to ${patient?.phone}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send the PDF on WhatsApp.";
      setArshiaError(message);
      toast({ title: "WhatsApp send failed", description: message, variant: "destructive" });
    } finally {
      setIsSendingArshiaWhatsApp(false);
    }
  };

  const renderPatientRow = (row: AdvancePatientRow) => {
    const isPlanned = row.plannedDischargeDate === todayIso;
    const isTodayDischarge = isPlanned;
    const confirmation = thumbConfirmations.data?.get(row.patient.id) || null;
    const unlocked = !!confirmation;
    const lockedHint = "Attach the portal thumb confirmation first";
    const notDischargedHint = "Complete the Final Bill and press Save Discharge first";
    const busyUpload = thumbUploadingVisitId === row.visitId;
    // Yojana patients can always take their summary PDF away, whether or not the
    // thumb confirmation has been photographed or uploaded yet.
    const summaryUnlocked = unlocked || isMaharashtraYojana(row.patient.corporate);

    return (
      <div
        key={row.visitId}
        className={cn(
          "rounded-2xl border-2 border-border bg-card sm:rounded-xl sm:border",
          isPlanned && "border-primary/50",
        )}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => {
              setSelectedVisitId(row.visitId);
              setPatient(row.patient);
              setStage("billing");
            }}
            className="grid min-w-0 flex-1 gap-3 p-4 text-left transition-colors hover:bg-primary/10 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_auto] sm:items-center sm:px-4 sm:py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15"><User className="h-6 w-6 text-primary" /></div>
              <div className="min-w-0">
                <p className="truncate font-semibold">{row.patient.name}</p>
                <p className="truncate text-xs text-muted-foreground">{row.patient.patients_id || "No patient ID"}</p>
              </div>
            </div>
            <div className="text-sm"><span className="text-xs text-muted-foreground sm:hidden">Admission: </span>{row.admissionDate ? shortDate(row.admissionDate) : "—"}</div>
            <div className="text-sm"><span className="text-xs text-muted-foreground sm:hidden">Registration: </span>{row.registrationId || "Not added"}</div>
            <div className="min-w-0 text-sm">
              <span className="text-xs text-muted-foreground sm:hidden">Package: </span>
              <span className="block truncate">{row.packageName || "Package not added"}</span>
              {row.packageCode ? <span className="block truncate text-xs text-muted-foreground">{row.packageCode}</span> : null}
            </div>
            <ChevronRight className="hidden h-5 w-5 text-muted-foreground sm:block" />
          </button>
          <label
            className="flex w-16 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 border-l border-border px-2 text-center"
            title="Plan this patient for discharge today"
          >
            <input
              type="checkbox"
              className="h-6 w-6 cursor-pointer accent-primary"
              checked={isTodayDischarge}
              disabled={togglePlannedDischarge.isPending}
              onChange={(event) =>
                togglePlannedDischarge.mutate({ row, planned: event.target.checked })
              }
            />
            <span className="text-[10px] leading-tight text-muted-foreground">Discharge today</span>
          </label>
        </div>

        {isPlanned ? (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-primary/15 px-3 py-1 font-semibold text-primary">
                Billing: {row.dischargeBillingStaff || resolveDischargeStaff(new Date())}
              </span>
              {thumbConfirmations.isLoading ? (
                <span className="text-muted-foreground">Checking thumb confirmation…</span>
              ) : unlocked ? (
                <a
                  href={confirmation!.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800 hover:underline"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Thumb confirmed
                  {confirmation!.uploadedAt ? ` · ${shortDate(confirmation!.uploadedAt)}` : ""}
                </a>
              ) : (
                <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                  {lockedHint}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <TabletButton
                variant="outline"
                onClick={() => setThumbCameraRow(row)}
                disabled={busyUpload}
              >
                {busyUpload ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                Take photo
              </TabletButton>
              <TabletButton
                variant="outline"
                onClick={() => {
                  setThumbUploadRow(row);
                  thumbFileInputRef.current?.click();
                }}
                disabled={busyUpload}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload file
              </TabletButton>
              {/* Opens the existing IPD Final Bill — the same screen as the ₹
                  icon. The route keys on the visit CODE, not the row's uuid. */}
              <TabletButton
                variant="outline"
                onClick={() => navigate(`/final-bill/${row.visitNumber}`)}
                disabled={!row.visitNumber}
              >
                <IndianRupee className="mr-2 h-4 w-4" />
                Final Bill
              </TabletButton>
              <TabletButton
                variant="outline"
                onClick={() => generatePlannedGatePass(row)}
                disabled={!unlocked || !row.isDischarged || gatePassVisitId === row.visitId}
                title={!unlocked ? lockedHint : row.isDischarged ? undefined : notDischargedHint}
              >
                {gatePassVisitId === row.visitId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Generate gate pass
              </TabletButton>
              <TabletButton
                variant="outline"
                onClick={() => void downloadPlannedSummaryPdf(row)}
                disabled={!summaryUnlocked || summaryPdfVisitId === row.visitId}
                title={summaryUnlocked ? undefined : lockedHint}
              >
                <Download className="mr-2 h-4 w-4" />
                Summary PDF
              </TabletButton>
              {/* The hospital's printable discharge summary. This used to hang
                  off the second "Advanced Statement" tile, which was deleted on
                  16-Jul as a duplicate (79b934e) — but this button went with it,
                  and nothing here replaced it. Like the gate pass and final
                  bill, the route keys on the visit CODE, not the row's uuid. */}
              <TabletButton
                variant="outline"
                onClick={() =>
                  window.open(`/discharge-summary-print/${row.visitNumber}`, "_blank", "noopener,noreferrer")
                }
                disabled={!row.visitNumber}
              >
                <FileText className="mr-2 h-4 w-4" />
                Discharge Summary
              </TabletButton>
              <TabletButton
                onClick={() => setDischargeConfirmRow(row)}
                disabled={!unlocked || !!row.dischargeDate}
                title={
                  row.dischargeDate
                    ? "Already marked on the government portal"
                    : unlocked
                      ? undefined
                      : lockedHint
                }
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {row.dischargeDate
                  ? "Marked discharge from government portal"
                  : "Mark discharge from government portal"}
              </TabletButton>
            </div>

            {/* A disabled button has no tooltip to read on a tablet, so the
                reason the gate pass is unavailable is said out loud. */}
            {!row.isDischarged && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Gate pass is locked — {row.patient.name} has not been discharged yet. Open{" "}
                <strong>Final Bill</strong>, complete it and press <strong>Save Discharge</strong>; the gate pass
                unlocks as soon as the patient is marked discharged.
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  if (!patient) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 border-b border-border">
          <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold sm:text-xl">Advance — select patient</h2>
                <p className="text-sm text-muted-foreground">
                  {showAllPatients ? "All admitted and discharged IPD patients" : "Currently admitted IPD patients"}
                </p>
              </div>
              <TabletButton
                variant={showAllPatients ? "default" : "outline"}
                onClick={() => setShowAllPatients((value) => !value)}
                className="shrink-0"
              >
                {showAllPatients ? "Current Patients" : "All Patients"}
              </TabletButton>
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <TabletInput
                  value={patientSearch}
                  onChange={(event) => setPatientSearch(event.target.value)}
                  placeholder="Search patient, patient ID, or registration number"
                  className="pl-10"
                />
              </div>
              {patientSearch ? (
                <TabletButton variant="outline" onClick={() => setPatientSearch("")}>Clear</TabletButton>
              ) : null}
            </div>
          </div>
        </div>
        <div className="tablet-no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
            {patientRows.isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : patientRows.isError ? (
              <p className="py-12 text-center text-destructive">Could not load patients. Please try again.</p>
            ) : filteredPatientRows.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">No matching patients found.</p>
            ) : (
              <div className="space-y-6">
                {plannedRows.length > 0 ? (
                  <section className="space-y-3 sm:space-y-1.5">
                    <h3 className="text-base font-bold text-primary">
                      Planned for discharge today ({plannedRows.length})
                    </h3>
                    {plannedRows.map(renderPatientRow)}
                  </section>
                ) : null}
                {unplannedRows.length > 0 ? (
                  <section className="space-y-3 sm:space-y-1.5">
                    {plannedRows.length > 0 ? (
                      <h3 className="text-base font-bold text-muted-foreground">
                        Other admitted patients ({unplannedRows.length})
                      </h3>
                    ) : null}
                    {unplannedRows.map(renderPatientRow)}
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <input
          ref={thumbFileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            const row = thumbUploadRow;
            event.target.value = "";
            setThumbUploadRow(null);
            if (row && files.length) void uploadThumbConfirmation(row, files);
          }}
        />

        <MultiShotCamera
          open={!!thumbCameraRow}
          onClose={() => setThumbCameraRow(null)}
          onCapture={(photos) => {
            const row = thumbCameraRow;
            setThumbCameraRow(null);
            if (row && photos.length) void uploadThumbConfirmation(row, photos);
          }}
        />

        <Dialog
          open={!!dischargeConfirmRow}
          onOpenChange={(open) => {
            if (!open) setDischargeConfirmRow(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                Mark discharge from government portal for {dischargeConfirmRow?.patient.name}?
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This closes the visit and removes the patient from the admitted list. The portal
              thumb confirmation is on file.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <TabletButton variant="outline" onClick={() => setDischargeConfirmRow(null)}>
                Cancel
              </TabletButton>
              <TabletButton
                onClick={() =>
                  dischargeConfirmRow && dischargePlannedPatient.mutate(dischargeConfirmRow)
                }
                disabled={dischargePlannedPatient.isPending}
              >
                {dischargePlannedPatient.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Mark discharge
              </TabletButton>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (collect.isSuccess) {
    return (
      <TabletConfirm
        status="success"
        title="Advance collected"
        message={`${inr(Number(amount))} recorded for ${patient.name} via ${mode}.`}
        primaryAction={{
          label: "Back to statement",
          onClick: () => {
            setAmount("");
            setRemarks("");
            setStage("view");
            collect.reset();
          },
        }}
        secondaryAction={{ label: "Home", onClick: () => navigate("/") }}
      />
    );
  }

  if (stage === "collect") {
    const value = Number(amount) || 0;
    return (
      <FlowScaffold
        heading="Collect advance"
        subheading={`${patient.name} · ${patient.patients_id || ""}`}
        actions={
          <>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => setStage("view")}
              disabled={collect.isPending}
            >
              Cancel
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={value <= 0 || collect.isPending}
              onClick={() => collect.mutate()}
            >
              {collect.isPending ? "Saving…" : `Collect ${inr(value)}`}
            </TabletButton>
          </>
        }
      >
        <div className="space-y-5">
          {/* Above the amount, because this is the screen where the cash is
              actually taken and the moment a missing count still costs
              nothing to fix. It never blocks the collection. */}
          <OpeningCashBanner />

          <div className="rounded-2xl bg-muted p-5 text-center">
            <p className="text-sm text-muted-foreground">Advance amount</p>
            <p className="text-4xl font-bold">{inr(value)}</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">
              Payment mode
            </p>
            <div className="grid grid-cols-5 gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-12 rounded-xl text-sm font-medium",
                    mode === m ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <TabletNumpad
            value={amount}
            onChange={setAmount}
            allowDecimal
            maxLength={9}
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">
              Remarks
            </p>
            <DictationTextarea
              value={remarks}
              onChange={setRemarks}
              rows={3}
              placeholder="Optional remarks / narration"
            />
          </div>
          {collect.isError ? (
            <p className="text-destructive">
              {(collect.error as Error)?.message || "Could not save advance."}
            </p>
          ) : null}
        </div>
      </FlowScaffold>
    );
  }

  const arshiyaDischargeSummaryPanel = (
    <TabletCard className="mb-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">Arshiya discharge summary</p>
            <p className="text-xs text-muted-foreground">
              Pre-auth transcription, medication dictation, investigations, prompt, and AI draft
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TabletButton
            variant="outline"
            onClick={() => {
              setStage("billing");
              setImagesOpen(true);
            }}
          >
            <ImageIcon className="h-4 w-4" />
            Images
          </TabletButton>
          {isTranscribingPreauth ? (
            <span className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting form text…
            </span>
          ) : (
            <TabletButton
              variant="outline"
              disabled={advanceImages.isLoading}
              onClick={() => void transcribePreauthImages()}
            >
              <FileText className="h-4 w-4" />
              Transcribe
            </TabletButton>
          )}
          <TabletButton
            variant="outline"
            disabled={isLoadingInvestigations || !selectedVisitId}
            onClick={() => void fetchArshiaInvestigations()}
          >
            {isLoadingInvestigations ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Fetch reports
          </TabletButton>
        </div>
      </div>

      {arshiaError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {arshiaError}
        </p>
      ) : null}

      {arshiaWarning ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {arshiaWarning}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <div>
            <TabletLabel htmlFor="arshia-transcribed-text">
              Pre-authorization form transcription
            </TabletLabel>
            <DictationTextarea
              id="arshia-transcribed-text"
              value={preauthTranscript}
              onChange={setPreauthTranscript}
              rows={8}
              placeholder="Upload or capture a filled pre-authorization form to extract its text automatically. You can edit or dictate corrections here."
              className="mt-1.5"
            />
          </div>

          <div>
            <TabletLabel htmlFor="arshia-investigations">Lab and radiology reports</TabletLabel>
            <DictationTextarea
              id="arshia-investigations"
              value={investigationText}
              onChange={setInvestigationText}
              rows={7}
              placeholder="Use Fetch reports to load visit lab and radiology reports, dictate additions, or type/paste report text here."
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <TabletLabel htmlFor="arshia-prompt">Prompt</TabletLabel>
            <DictationTextarea
              id="arshia-prompt"
              value={arshiaPrompt}
              onChange={setArshiaPrompt}
              rows={8}
              placeholder="Edit the discharge summary prompt"
              className="mt-1.5"
            />
          </div>

          <div>
            <TabletLabel htmlFor="arshia-medication">Medication on discharge</TabletLabel>
            <DictationTextarea
              id="arshia-medication"
              value={medicationOnDischarge}
              onChange={setMedicationOnDischarge}
              rows={5}
              placeholder="Dictate discharge medicines, dose, route, frequency, and days."
              className="mt-1.5"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex rounded-xl border p-0.5">
          {(["discharge", "death"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSummaryMode(mode)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${
                summaryMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {mode === "discharge" ? "Discharge summary" : "Death summary"}
            </button>
          ))}
        </div>
        {summaryMode === "death" ? (
          <>
            <TabletInput type="date" value={deathDate} onChange={(e) => setDeathDate(e.target.value)} className="w-40" aria-label="Date of death" />
            <TabletInput type="time" value={deathTime} onChange={(e) => setDeathTime(e.target.value)} className="w-32" aria-label="Time of death" />
          </>
        ) : null}
        <TabletButton
          disabled={
            isGeneratingSummary ||
            (summaryMode === "death"
              ? !deathDate || !deathTime
              : !preauthTranscript.trim() && !medicationOnDischarge.trim() && !investigationText.trim())
          }
          onClick={() => void generateArshiaSummary()}
        >
          {isGeneratingSummary ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {summaryMode === "death" ? "Generate death summary" : "Generate summary"}
        </TabletButton>
        <TabletButton
          variant="outline"
          disabled={!generatedDischargeSummary.trim()}
          onClick={() => void printArshiaSummary()}
        >
          <Printer className="h-4 w-4" />
          Print
        </TabletButton>
        <TabletButton
          variant="outline"
          disabled={!generatedDischargeSummary.trim() || isGeneratingArshiaPdf}
          onClick={() => void downloadArshiaSummaryPdf()}
        >
          {isGeneratingArshiaPdf ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          PDF
        </TabletButton>
        <TabletButton
          variant="outline"
          disabled={!generatedDischargeSummary.trim() || isGeneratingArshiaPdf || isSendingArshiaWhatsApp || !normalizeWhatsAppPhone(patient?.phone)}
          onClick={() => void sendArshiaSummaryOnWhatsApp()}
          title={!normalizeWhatsAppPhone(patient?.phone) ? "Patient mobile number is missing" : "Send PDF on WhatsApp"}
        >
          {isSendingArshiaWhatsApp ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageCircle className="h-4 w-4" />
          )}
          WhatsApp
        </TabletButton>
        <TabletButton
          variant="outline"
          disabled={!generatedDischargeSummary.trim()}
          onClick={downloadGeneratedSummary}
        >
          <Download className="h-4 w-4" />
          Download text
        </TabletButton>
      </div>

      <div>
        <TabletLabel htmlFor="arshia-generated-summary">Generated discharge summary</TabletLabel>
        <textarea
          id="arshia-generated-summary"
          value={generatedDischargeSummary}
          onChange={(event) => {
            setGeneratedDischargeSummary(event.target.value);
            setGeneratedArshiaPdf(null);
          }}
          onBlur={(event) => void persistArshiyaSummary(event.target.value)}
          rows={12}
          placeholder="Generated discharge summary will appear here for review and editing."
          className="mt-1.5 w-full rounded-xl border bg-background p-3 font-mono text-sm leading-6"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Review and correct the draft before saving, printing, or sharing it.
        </p>
      </div>
    </TabletCard>
  );

  if (stage === "billing") {
    return (
      <FlowScaffold
        heading="Registration & implants"
        subheading={`${patient.name} · ${visit.data?.visit_id || ""}`}
        actions={
          <>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => setImagesOpen(true)}
            >
              <ImageIcon className="h-4 w-4" />
              Images
            </TabletButton>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => {
                setPatient(null);
                setSelectedVisitId(null);
                setStage("view");
              }}
            >
              Change patient
            </TabletButton>
          </>
        }
      >
        {visit.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : !visit.data ? (
          <p className="py-8 text-center text-muted-foreground">
            No visit found for this patient.
          </p>
        ) : (
          <div className="space-y-5">
            <TabletCard>
              <TabletLabel htmlFor="reg-id">Yojana registration ID</TabletLabel>
              <div className="mt-1.5 flex gap-2">
                <TabletInput
                  id="reg-id"
                  value={registrationIdInput}
                  onChange={(e) => setRegistrationIdInput(e.target.value)}
                  onBlur={saveRegistrationIfChanged}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveRegistrationIfChanged();
                    }
                  }}
                  placeholder="e.g. R-200"
                  className="flex-1"
                />
                <TabletButton
                  disabled={saveRegistrationId.isPending || registrationIdInput.trim().toUpperCase() === (visit.data.yojana_registration_id || "").toUpperCase()}
                  onClick={() => saveRegistrationId.mutate()}
                >
                  {saveRegistrationId.isPending ? "Saving…" : "Save"}
                </TabletButton>
              </div>
              {saveRegistrationId.isError ? (
                <p className="mt-2 text-sm text-destructive">
                  {(saveRegistrationId.error as Error)?.message || "Could not save registration ID."}
                </p>
              ) : null}
              {saveRegistrationId.isSuccess ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved{saveRegistrationId.data?.portalMatched ? " — portal data auto-filled" : ""}
                </p>
              ) : null}
            </TabletCard>

            <>
                <TabletCard>
                  <TabletLabel>Package</TabletLabel>
                  {resolvedPackageCode || visit.data.package_name ? (
                    <div className="mt-1.5 rounded-lg bg-muted p-3 text-sm">
                      <p><span className="font-medium">Code:</span> {resolvedPackageCode || (autoPackageCode.isLoading ? "Fetching…" : "—")}</p>
                      <p><span className="font-medium">Name:</span> {visit.data.package_name || "—"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Fetched from the saved visit data. Search or edit below only if it needs to be updated.</p>
                    </div>
                  ) : (
                    <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      No saved package found for this visit. Search an existing package or add code and name below.
                    </p>
                  )}
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <TabletInput
                      value={packageTerm}
                      onChange={(e) => setPackageTerm(e.target.value)}
                      placeholder="Search treatment package"
                      className="pl-9"
                    />
                  </div>
                  {packageTerm.trim().length >= 2 ? (
                    <div className="mt-2 space-y-1.5">
                      {packageResults.isLoading ? (
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                      ) : (packageResults.data || []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No matching packages found.</p>
                      ) : (
                        packageResults.data!.map((pkg) => (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => {
                              setPackageCodeInput(pkg.code || "");
                              setPackageNameInput(pkg.name);
                              savePackage.mutate({ code: pkg.code, name: pkg.name });
                            }}
                            disabled={savePackage.isPending}
                            className="w-full rounded-lg border border-input px-3 py-2 text-left text-sm hover:bg-muted"
                          >
                            {pkg.label}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                  <div className="mt-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
                    <p className="text-sm font-medium">Add package to master</p>
                    <div className="mt-2 space-y-2">
                      <TabletInput
                        value={packageCodeInput}
                        onChange={(event) => setPackageCodeInput(event.target.value)}
                        placeholder="Package code"
                      />
                      <TabletInput
                        value={packageNameInput}
                        onChange={(event) => setPackageNameInput(event.target.value)}
                        placeholder="Package name"
                      />
                      <TabletButton
                        className="w-full"
                        onClick={() => createPackage.mutate()}
                        disabled={createPackage.isPending || !packageCodeInput.trim() || !packageNameInput.trim()}
                      >
                        {createPackage.isPending ? "Creating…" : "Save package code & name"}
                      </TabletButton>
                      {createPackage.isError ? (
                        <p className="text-sm text-destructive">
                          {(createPackage.error as Error)?.message || "Could not create package."}
                        </p>
                      ) : createPackage.isSuccess ? (
                        <p className="text-sm text-emerald-700">Package saved to master and patient visit.</p>
                      ) : null}
                    </div>
                  </div>
                </TabletCard>

                <TabletCard>
                  <TabletLabel>Implant</TabletLabel>
                  {(addedImplants.data || []).length > 0 ? (
                    <div className="mt-1.5 space-y-1">
                      {addedImplants.data!.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span>{item.implant_name}</span>
                          <span className="font-medium">{inr(item.amount ?? item.rate)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!selectedImplant ? (
                    <>
                      <div className="relative mt-2">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <TabletInput
                          value={implantTerm}
                          onChange={(e) => setImplantTerm(e.target.value)}
                          placeholder="Search implant"
                          className="pl-9"
                        />
                      </div>
                      {implantTerm.trim().length >= 2 ? (
                        <div className="mt-2 space-y-1.5">
                          {implantResults.isLoading ? (
                            <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                      ) : implantMatches.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
                          <p className="text-sm text-muted-foreground">No matching implant found.</p>
                          <TabletButton
                            className="mt-2 w-full"
                            onClick={() => createImplant.mutate()}
                            disabled={createImplant.isPending}
                          >
                            {createImplant.isPending ? "Creating…" : `Create “${implantTerm.trim()}” in master`}
                          </TabletButton>
                          {createImplant.isError ? (
                            <p className="mt-2 text-sm text-destructive">
                              {(createImplant.error as Error)?.message || "Could not create implant."}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        implantMatches.map((implant) => (
                              <button
                                key={implant.id}
                                type="button"
                                onClick={() => {
                                  setSelectedImplant(implant);
                                  setImplantRate(String(defaultImplantRate(implant, visit.data!.corporate)));
                                }}
                                className="w-full rounded-lg border border-input px-3 py-2 text-left text-sm hover:bg-muted"
                              >
                                {implant.name}
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm font-medium">{selectedImplant.name}</p>
                      <TabletInput
                        value={implantRate}
                        onChange={(e) => setImplantRate(e.target.value.replace(/[^0-9.]/g, ""))}
                        inputMode="decimal"
                        placeholder="Cost"
                      />
                      <div className="flex gap-2">
                        <TabletButton
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setSelectedImplant(null);
                            setImplantTerm("");
                          }}
                        >
                          Cancel
                        </TabletButton>
                        <TabletButton
                          className="flex-1"
                          disabled={addImplant.isPending || !Number.isFinite(Number(implantRate)) || Number(implantRate) <= 0}
                          onClick={() => addImplant.mutate()}
                        >
                          {addImplant.isPending ? "Adding…" : "Add implant"}
                        </TabletButton>
                      </div>
                      {addImplant.isError ? (
                        <p className="text-sm text-destructive">
                          {(addImplant.error as Error)?.message || "Could not add implant."}
                        </p>
                      ) : null}
                    </div>
                  )}
                </TabletCard>
            </>
            {arshiyaDischargeSummaryPanel}
          </div>
        )}
        <Dialog
          open={imagesOpen}
          onOpenChange={(open) => {
            setImagesOpen(open);
            if (!open) {
              setViewingImage(null);
              setFullscreenImage(null);
              setCameraOpen(false);
            }
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-6">
                {viewingImage ? viewingImage.fileName : "Advance images"}
              </DialogTitle>
            </DialogHeader>
            {viewingImage ? (
              <div className="space-y-4">
                <button
                  type="button"
                  className="block w-full cursor-zoom-in"
                  title="Open full screen"
                  onClick={() => setFullscreenImage(viewingImage)}
                >
                  <img
                    src={viewingImage.fileUrl}
                    alt={viewingImage.fileName}
                    className="max-h-[70vh] w-full object-contain"
                  />
                </button>
                <div className="flex flex-wrap gap-2">
                  <TabletButton
                    variant="outline"
                    className="flex-1"
                    onClick={() => setViewingImage(null)}
                  >
                    Back to images
                  </TabletButton>
                  <TabletButton
                    variant="outline"
                    className="flex-1"
                    onClick={() => setFullscreenImage(viewingImage)}
                  >
                    <Maximize2 className="h-5 w-5" />
                    Full screen
                  </TabletButton>
                  <TabletButton
                    variant="outline"
                    className="flex-1"
                    onClick={() => window.open(viewingImage.fileUrl, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="h-5 w-5" />
                    Open in new tab
                  </TabletButton>
                  <TabletButton
                    className="flex-1"
                    onClick={() => void downloadImage(viewingImage)}
                  >
                    <Download className="h-5 w-5" />
                    Download
                  </TabletButton>
                  <TabletButton
                    variant="outline"
                    className="flex-1 text-destructive hover:text-destructive"
                    disabled={deletingImageId === viewingImage.id}
                    onClick={() => void handleDeleteImage(viewingImage)}
                  >
                    {deletingImageId === viewingImage.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Trash2 className="h-5 w-5" />
                    )}
                    Delete
                  </TabletButton>
                </div>
              </div>
            ) : cameraOpen ? (
              <div className="space-y-4">
                <div className="relative overflow-hidden rounded-2xl border border-border bg-zinc-950">
                  <video
                    ref={cameraVideoRef}
                    playsInline
                    muted
                    autoPlay
                    onLoadedMetadata={() => setCameraReady(true)}
                    onCanPlay={() => setCameraReady(true)}
                    onPlaying={() => setCameraReady(true)}
                    className="max-h-[62vh] min-h-[300px] w-full bg-zinc-950 object-contain"
                  />
                  {(cameraStarting || !cameraReady) && !cameraError ? (
                    <div className="absolute inset-0 flex min-h-[300px] items-center justify-center bg-zinc-950/90 text-white">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  ) : null}
                </div>
                <canvas ref={cameraCanvasRef} className="hidden" />
                {cameraError ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {cameraError}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Place the filled pre authorization form inside the frame, then save the captured image.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <TabletButton
                    variant="outline"
                    onClick={() => setCameraOpen(false)}
                  >
                    Cancel
                  </TabletButton>
                  <TabletButton
                    disabled={cameraStarting || !cameraReady || uploadingImages}
                    onClick={() => void captureCameraImage()}
                  >
                    {uploadingImages ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Camera className="h-5 w-5" />
                    )}
                    Save captured image
                  </TabletButton>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleImageFiles(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <TabletButton
                    disabled={uploadingImages || !patient}
                    onClick={() => setCameraOpen(true)}
                  >
                    {uploadingImages ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Camera className="h-5 w-5" />
                    )}
                    Capture image
                  </TabletButton>
                  <TabletButton
                    variant="outline"
                    disabled={uploadingImages || !patient}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    {uploadingImages ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Upload className="h-5 w-5" />
                    )}
                    Upload image
                  </TabletButton>
                </div>
                {advanceImages.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  </div>
                ) : (advanceImages.data || []).length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">
                    No images uploaded yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {advanceImages.data!.map((doc) => (
                      <TabletCard key={doc.id} variant="flat" className="p-2">
                        <button
                          type="button"
                          className="block w-full overflow-hidden rounded-xl bg-muted"
                          onClick={() => setViewingImage(doc)}
                        >
                          <img
                            src={doc.fileUrl}
                            alt={doc.fileName}
                            className="h-32 w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {shortDate(doc.uploadedAt)}
                          </span>
                          <button
                            type="button"
                            aria-label="View image full screen"
                            className="rounded-lg p-2 text-foreground/70 hover:bg-accent"
                            onClick={() => setFullscreenImage(doc)}
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Download image"
                            disabled={deletingImageId === doc.id}
                            className="rounded-lg p-2 text-foreground/70 hover:bg-accent"
                            onClick={() => void downloadImage(doc)}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete image"
                            disabled={deletingImageId === doc.id}
                            className="rounded-lg p-2 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                            onClick={() => void handleDeleteImage(doc)}
                          >
                            {deletingImageId === doc.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </TabletCard>
                    ))}
                  </div>
                )}
              </div>
            )}

            {fullscreenImage ? (
              <div className="fixed inset-0 z-[100] flex flex-col bg-black/95">
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
                  <span className="min-w-0 truncate text-sm">{fullscreenImage.fileName}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      aria-label="Open in new tab"
                      className="rounded-lg p-2 hover:bg-white/10"
                      onClick={() => window.open(fullscreenImage.fileUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Download image"
                      className="rounded-lg p-2 hover:bg-white/10"
                      onClick={() => void downloadImage(fullscreenImage)}
                    >
                      <Download className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Close full screen"
                      className="rounded-lg p-2 hover:bg-white/10"
                      onClick={() => setFullscreenImage(null)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="min-h-0 flex-1 cursor-zoom-out overflow-auto p-2"
                  onClick={() => setFullscreenImage(null)}
                >
                  <img
                    src={fullscreenImage.fileUrl}
                    alt={fullscreenImage.fileName}
                    className="mx-auto max-h-full w-auto max-w-full object-contain"
                  />
                </button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </FlowScaffold>
    );
  }

  const rows = advances.data || [];
  const totalAdvance = rows
    .filter((r) => !r.is_refund)
    .reduce((s, r) => s + (Number(r.advance_amount) || 0), 0);
  const totalReturned = rows.reduce(
    (s, r) => s + (Number(r.returned_amount) || 0),
    0,
  );

  return (
    <FlowScaffold
      heading={patient.name}
      subheading={`${patient.patients_id || ""} — advance statement`}
      actions={
        <>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => {
              setPatient(null);
              setSelectedVisitId(null);
            }}
          >
            Change patient
          </TabletButton>
          <TabletButton className="flex-1" onClick={() => setStage("collect")}>
            Collect advance
          </TabletButton>
        </>
      }
    >
      <TabletCard className="mb-4 flex items-center gap-4 bg-amber-50">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
          <Wallet className="h-7 w-7 text-amber-600" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Net advance balance</p>
          <p className="text-3xl font-bold">{inr(totalAdvance - totalReturned)}</p>
        </div>
      </TabletCard>

      <TabletCard
        interactive
        className="mb-4 flex items-center justify-between py-3"
        onClick={() => setStage("billing")}
      >
        <div>
          <p className="font-medium">Billing details</p>
          <p className="text-xs text-muted-foreground">
            Registration ID, package &amp; implant
          </p>
        </div>
        <span className="text-sm text-primary">Open →</span>
      </TabletCard>

      <TabletCard className="mb-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Arshiya discharge summary</p>
              <p className="text-xs text-muted-foreground">
                Pre-auth transcription, medication dictation, investigations, and AI draft
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <TabletButton
              variant="outline"
              onClick={() => {
                setStage("billing");
                setImagesOpen(true);
              }}
            >
              <ImageIcon className="h-4 w-4" />
              Images
            </TabletButton>
            {isTranscribingPreauth ? (
              <span className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting form text…
              </span>
            ) : (
              <TabletButton
                variant="outline"
                disabled={advanceImages.isLoading}
                onClick={() => void transcribePreauthImages()}
              >
                <FileText className="h-4 w-4" />
                Transcribe
              </TabletButton>
            )}
            <TabletButton
              variant="outline"
              disabled={isLoadingInvestigations || !selectedVisitId}
              onClick={() => void fetchArshiaInvestigations()}
            >
              {isLoadingInvestigations ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Fetch reports
            </TabletButton>
          </div>
        </div>

        {arshiaError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {arshiaError}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <div>
              <TabletLabel htmlFor="arshia-prompt">Prompt</TabletLabel>
              <DictationTextarea
                id="arshia-prompt"
                value={arshiaPrompt}
                onChange={setArshiaPrompt}
                rows={8}
                placeholder="Edit the discharge summary prompt"
              />
            </div>

            <div>
              <TabletLabel htmlFor="arshia-transcribed-text">Pre-authorization form transcription</TabletLabel>
              <DictationTextarea
                id="arshia-transcribed-text"
                value={preauthTranscript}
                onChange={setPreauthTranscript}
                rows={8}
                placeholder="Upload or capture a filled pre-authorization form to extract its text automatically. You can edit or dictate corrections here."
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <TabletLabel htmlFor="arshia-medication">Medication on discharge</TabletLabel>
              <DictationTextarea
                id="arshia-medication"
                value={medicationOnDischarge}
                onChange={setMedicationOnDischarge}
                rows={5}
                placeholder="Dictate discharge medicines, dose, route, frequency, and days."
              />
            </div>

            <div>
              <TabletLabel htmlFor="arshia-investigations">Lab and radiology reports</TabletLabel>
              <DictationTextarea
                id="arshia-investigations"
                value={investigationText}
                onChange={setInvestigationText}
                rows={7}
                placeholder="Use Fetch reports to load visit lab and radiology reports, dictate additions, or type/paste report text here."
                className="mt-1.5"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <TabletButton
            disabled={isGeneratingSummary || (!preauthTranscript.trim() && !medicationOnDischarge.trim() && !investigationText.trim())}
            onClick={() => void generateArshiaSummary()}
          >
            {isGeneratingSummary ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate summary
          </TabletButton>
          <TabletButton
            variant="outline"
            disabled={!generatedDischargeSummary.trim()}
            onClick={() => void printArshiaSummary()}
          >
            <Printer className="h-4 w-4" />
            Print
          </TabletButton>
          <TabletButton
            variant="outline"
            disabled={!generatedDischargeSummary.trim() || isGeneratingArshiaPdf}
            onClick={() => void downloadArshiaSummaryPdf()}
          >
            {isGeneratingArshiaPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            PDF
          </TabletButton>
          <TabletButton
            variant="outline"
            disabled={!generatedDischargeSummary.trim() || isGeneratingArshiaPdf || isSendingArshiaWhatsApp || !normalizeWhatsAppPhone(patient?.phone)}
            onClick={() => void sendArshiaSummaryOnWhatsApp()}
            title={!normalizeWhatsAppPhone(patient?.phone) ? "Patient mobile number is missing" : "Send PDF on WhatsApp"}
          >
            {isSendingArshiaWhatsApp ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            WhatsApp
          </TabletButton>
          <TabletButton
            variant="outline"
            disabled={!generatedDischargeSummary.trim()}
            onClick={downloadGeneratedSummary}
          >
            <Download className="h-4 w-4" />
            Download text
          </TabletButton>
        </div>

        <div>
          <TabletLabel htmlFor="arshia-generated-summary">Generated discharge summary</TabletLabel>
          <textarea
            id="arshia-generated-summary"
            value={generatedDischargeSummary}
            onChange={(event) => {
              setGeneratedDischargeSummary(event.target.value);
              setGeneratedArshiaPdf(null);
            }}
            onBlur={(event) => void persistArshiyaSummary(event.target.value)}
            rows={12}
            placeholder="Generated discharge summary will appear here for review and editing."
            className="mt-1.5 w-full rounded-xl border bg-background p-3 font-mono text-sm leading-6"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Review and correct the draft before saving, printing, or sharing it.
          </p>
        </div>
      </TabletCard>

      {advances.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No advances recorded for this patient.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <TabletCard key={r.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">
                  {r.is_refund ? "Refund" : "Advance"} · {r.payment_mode}
                </p>
                <p className="text-xs text-muted-foreground">
                  {shortDate(r.payment_date)} · {r.status}
                </p>
              </div>
              <span
                className={cn(
                  "font-semibold",
                  r.is_refund ? "text-rose-700" : "text-emerald-700",
                )}
              >
                {r.is_refund ? "−" : "+"}
                {inr(r.advance_amount)}
              </span>
            </TabletCard>
          ))}
        </div>
      )}
    </FlowScaffold>
  );
}
