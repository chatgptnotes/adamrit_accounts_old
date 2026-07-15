import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isUuid } from "@/utils/visitId";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  PATIENT_DOC_CATEGORIES,
  type PatientDoc,
  type PatientDocCategory,
} from "@/tablet/hooks/usePatientDocs";

interface BillDocumentsSectionProps {
  patientId?: string;
  patientName?: string | null;
  patientRegistrationNo?: string | null;
  visitId?: string;
}

function isImage(type: string | null): boolean {
  return !!type && type.startsWith("image/");
}

function isPdf(type: string | null): boolean {
  return !!type && type.includes("pdf");
}

/** Blob download — same pattern as PatientDocsTab.downloadDoc. */
async function downloadDoc(doc: PatientDoc) {
  const response = await fetch(doc.fileUrl);
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = doc.fileName || "document";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/** Load an image via fetch->blob->objectURL so the canvas stays un-tainted. */
function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = objectUrl;
  });
}

/** Build a single A4 PDF (one image per page) from the given image docs. */
async function buildImagesPdf(
  images: PatientDoc[],
  quality: number,
  maxDim: number,
): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 10;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  let first = true;
  for (const d of images) {
    const response = await fetch(d.fileUrl);
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    try {
      const img = await loadImage(objectUrl);
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const cw = Math.max(1, Math.round(img.width * scale));
      const ch = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.fillStyle = "#ffffff"; // flatten any transparency to white
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      const jpeg = canvas.toDataURL("image/jpeg", quality);

      if (!first) doc.addPage();
      first = false;

      // Fit the image into the printable area, preserving aspect ratio.
      const ar = cw / ch;
      let w = availW;
      let h = availW / ar;
      if (h > availH) {
        h = availH;
        w = availH * ar;
      }
      const x = margin + (availW - w) / 2;
      const y = margin + (availH - h) / 2;
      doc.addImage(jpeg, "JPEG", x, y, w, h);
    } finally {
      window.URL.revokeObjectURL(objectUrl);
    }
  }
  return doc.output("blob");
}

const ONE_MB = 1024 * 1024;

/**
 * Combine all image docs of a category into one PDF, stepping quality/size down
 * until the file is under 1 MB, then trigger a download.
 */
async function downloadImagesAsPdf(images: PatientDoc[], baseName: string) {
  const attempts: Array<[number, number]> = [
    [0.7, 1600],
    [0.6, 1400],
    [0.5, 1200],
    [0.4, 1000],
    [0.3, 800],
  ];
  let blob: Blob | null = null;
  for (const [quality, maxDim] of attempts) {
    blob = await buildImagesPdf(images, quality, maxDim);
    if (blob.size <= ONE_MB) break;
  }
  if (!blob) return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

async function downloadTextAsPdf(
  title: string,
  lines: string[],
  baseName: string,
) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const contentW = pageW - margin * 2;
  const lineHeight = 5.2;

  let y = 18;
  const addLine = (text: string, fontSize = 10, bold = false) => {
    const safeText = text.trim();
    const wrapped = doc.splitTextToSize(safeText, contentW);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    for (const line of wrapped) {
      if (y > pageH - 16) {
        doc.addPage();
        y = 18;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
  };

  addLine(title, 14, true);
  y += 2;
  for (const line of lines) {
    if (!line.trim()) {
      y += 2.5;
      continue;
    }
    addLine(line, line.startsWith("OT NOTES") ? 12 : 10, line === "OT NOTES");
  }

  const blob = doc.output("blob");
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${baseName}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

interface CategorizedDoc extends PatientDoc {
  category: string;
}

function mapDoc(r: any): CategorizedDoc {
  return {
    id: r.id,
    fileName: r.file_name ?? "file",
    fileUrl: r.file_url ?? "",
    fileType: r.file_type ?? null,
    storagePath: r.storage_path ?? null,
    uploadedAt: r.created_at ?? null,
    category: r.category ?? "",
  };
}

type VisitSummary = {
  id: string | null;
  visit_id: string | null;
  patient_id?: string | null;
  package_name: string | null;
  appointment_with?: string | null;
  patients?: {
    age?: string | number | null;
    gender?: string | null;
    patients_id?: string | null;
  } | null;
};

type PackageSummary = {
  package_name: string | null;
  procedure_name: string | null;
  procedure_code: string | null;
  package_code: string | null;
  medical_or_surgical: string | null;
  specialty: string | null;
  level_of_care: string | null;
  category: string | null;
  treatment_plan: string | null;
  treatment_code: string | null;
  anaesthesia_type: string | null;
};

const normalizePackageType = (value: string | null | undefined) => {
  const text = (value || "").trim().toLowerCase();
  if (!text) return "As per package";
  if (text.includes("conservative") || text.includes("medical")) return "Conservative";
  if (text.includes("surgical")) return "Surgical";
  return "As per package";
};

const deriveOtRequirement = (packageType: string) => {
  if (packageType === "Surgical") return "Yes";
  if (packageType === "Conservative") return "No";
  return "As per package";
};

type LabReportRow = {
  id: string;
  groupName: string;
  investigation: string;
  result: string;
  unit: string;
  referenceRange: string;
  status: string;
  remarks: string;
  isAbnormal: boolean;
  orderedAt: string | null;
  reportedAt: string | null;
};

type LabReportData = {
  visitUuid: string | null;
  rows: LabReportRow[];
  sourceVisitCount: number;
};

const normalizeText = (value: unknown) => String(value || "").trim();

const normalizeKey = (value: unknown) =>
  normalizeText(value).toLowerCase().replace(/\s+/g, " ");

const extractResultValue = (data: unknown): string => {
  if (data === null || data === undefined) return "";
  if (typeof data === "object" && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>).value ?? (data as Record<string, unknown>).val;
    return value === null || value === undefined ? "" : String(value).trim();
  }
  if (typeof data !== "string") return String(data).trim();

  const trimmed = data.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("{") && !trimmed.includes('"value"')) return trimmed;

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const value = parsed.value ?? parsed.val;
        return value === null || value === undefined ? "" : String(value).trim();
      }
    } catch {
      const match = trimmed.match(/"value"\s*:\s*"?([^",}]+)"?/);
      if (match) return match[1].trim();
    }
  }

  return trimmed;
};

const formatReportDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const safeFileName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

async function loadImageDataUrl(path: string): Promise<string | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not read image"));
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("Could not load PDF letterhead image:", err);
    return null;
  }
}

/** All uploaded docs for a patient, across the 8 profile categories, newest first. */
function usePatientAllDocs(patientId: string | undefined) {
  return useQuery({
    queryKey: ["bill-patient-docs", patientId],
    enabled: !!patientId,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<CategorizedDoc[]> => {
      const { data, error } = await supabase
        .from("file_uploads")
        .select(
          "id, file_name, file_url, file_type, storage_path, created_at, category",
        )
        .eq("patient_id", patientId)
        .in(
          "category",
          PATIENT_DOC_CATEGORIES.map((c) => c.id),
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDoc);
    },
  });
}

function useBillVisitSummary(visitId: string | undefined) {
  return useQuery({
    queryKey: ["bill-visit-summary", visitId],
    enabled: !!visitId,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<VisitSummary | null> => {
      if (!visitId) return null;
      const query = supabase
        .from("visits")
        .select("id, visit_id, patient_id, package_name, appointment_with, patients(age, gender, patients_id)");
      const { data, error } = isUuid(visitId)
        ? await query.eq("id", visitId).maybeSingle()
        : await query.eq("visit_id", visitId).maybeSingle();
      if (error) throw error;
      return (data || null) as VisitSummary | null;
    },
  });
}

function useBillLabInvestigations(params: {
  visitId?: string;
  visitSummary?: VisitSummary | null;
  patientId?: string | null;
  patientName?: string | null;
}) {
  return useQuery({
    queryKey: [
      "bill-lab-investigations",
      params.visitId,
      params.visitSummary?.id,
      params.patientId,
      params.patientName,
    ],
    enabled: !!params.visitId,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<LabReportData> => {
      const visitId = params.visitId;
      if (!visitId) return { visitUuid: null, rows: [], sourceVisitCount: 0 };

      let visitUuid = params.visitSummary?.id || null;
      if (!visitUuid) {
        const visitQuery = supabase.from("visits").select("id");
        const { data, error } = isUuid(visitId)
          ? await visitQuery.eq("id", visitId).maybeSingle()
          : await visitQuery.eq("visit_id", visitId).maybeSingle();
        if (error) throw error;
        visitUuid = data?.id || null;
      }

      if (!visitUuid) return { visitUuid: null, rows: [], sourceVisitCount: 0 };

      let sourceVisitIds = [visitUuid];

      let { data: visitLabsData, error: visitLabsError } = await supabase
        .from("visit_labs")
        .select("id, visit_id, lab_id, status, ordered_date, collected_date, completed_date, result_value, normal_range, notes, created_at, updated_at, is_hidden")
        .eq("visit_id", visitUuid)
        .or("is_hidden.is.null,is_hidden.eq.false")
        .order("ordered_date", { ascending: true });
      if (visitLabsError) throw visitLabsError;

      if ((visitLabsData || []).length === 0 && params.patientId) {
        const { data: patientVisits, error: patientVisitsError } = await supabase
          .from("visits")
          .select("id, visit_id, created_at")
          .eq("patient_id", params.patientId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (patientVisitsError) {
          console.warn("Could not load patient visits for lab report fallback:", patientVisitsError);
        } else {
          sourceVisitIds = (patientVisits || []).map((visit: any) => visit.id).filter(Boolean);

          if (sourceVisitIds.length > 0) {
            const fallback = await supabase
              .from("visit_labs")
              .select("id, visit_id, lab_id, status, ordered_date, collected_date, completed_date, result_value, normal_range, notes, created_at, updated_at, is_hidden")
              .in("visit_id", sourceVisitIds)
              .or("is_hidden.is.null,is_hidden.eq.false")
              .order("ordered_date", { ascending: false });

            if (fallback.error) {
              console.warn("Could not load patient-level lab investigations for bill report:", fallback.error);
            } else {
              visitLabsData = fallback.data || [];
            }
          }
        }
      }

      const visitLabs = visitLabsData || [];
      const labIds = [...new Set(visitLabs.map((row: any) => row.lab_id).filter(Boolean))];
      const { data: labDetails, error: labDetailsError } = labIds.length
        ? await supabase
            .from("lab")
            .select("id, name, category, sample_type, test_method")
            .in("id", labIds)
        : { data: [], error: null };
      if (labDetailsError) {
        console.warn("Could not load lab master details for bill report:", labDetailsError);
      }

      const labMap = new Map((labDetails || []).map((lab: any) => [lab.id, lab]));
      const visitLabIds = visitLabs.map((row: any) => row.id).filter(Boolean);
      const resultMap = new Map<string, any>();

      const addResults = (rows: any[] | null | undefined) => {
        for (const row of rows || []) {
          if (row?.id && !resultMap.has(row.id)) resultMap.set(row.id, row);
        }
      };

      if (visitLabIds.length > 0) {
        const { data, error } = await supabase
          .from("lab_results")
          .select("id, visit_lab_id, visit_id, lab_id, main_test_name, test_name, test_category, result_value, result_unit, reference_range, result_status, comments, is_abnormal, created_at, updated_at, display_order")
          .in("visit_lab_id", visitLabIds)
          .order("display_order", { ascending: true })
          .order("created_at", { ascending: false });
        if (error) {
          console.warn("Could not load lab results by visit_lab_id for bill report:", error);
        } else {
          addResults(data);
        }
      }

      const latestResults = new Map<string, any>();
      Array.from(resultMap.values())
        .sort((a, b) => {
          const aDate = new Date(a.updated_at || a.created_at || 0).getTime();
          const bDate = new Date(b.updated_at || b.created_at || 0).getTime();
          return bDate - aDate;
        })
        .forEach((result: any) => {
          const key = [
            result.visit_lab_id || result.visit_id || "visit",
            result.lab_id || "lab",
            normalizeKey(result.main_test_name || result.test_category),
            normalizeKey(result.test_name),
          ].join("|");
          if (!latestResults.has(key)) latestResults.set(key, result);
        });

      const labResults = Array.from(latestResults.values()).sort((a, b) => {
        const aOrder = Number(a.display_order ?? 9999);
        const bOrder = Number(b.display_order ?? 9999);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      });

      const rows: LabReportRow[] = [];
      const matchedResultIds = new Set<string>();

      for (const visitLab of visitLabs) {
        const lab = labMap.get(visitLab.lab_id);
        const labName = normalizeText(lab?.name) || "Lab Investigation";
        const labKey = normalizeKey(labName);
        const relatedResults = labResults.filter((result: any) => {
          if (result.visit_lab_id) return result.visit_lab_id === visitLab.id;
          if (result.lab_id && result.lab_id === visitLab.lab_id) return true;
          const resultMainKey = normalizeKey(result.main_test_name || result.test_category);
          return !!resultMainKey && resultMainKey === labKey;
        });

        if (relatedResults.length > 0) {
          for (const result of relatedResults) {
            matchedResultIds.add(result.id);
            rows.push({
              id: result.id,
              groupName: normalizeText(result.main_test_name || result.test_category || labName),
              investigation: normalizeText(result.test_name || labName),
              result: extractResultValue(result.result_value),
              unit: normalizeText(result.result_unit),
              referenceRange: normalizeText(result.reference_range || visitLab.normal_range),
              status: normalizeText(result.result_status || visitLab.status),
              remarks: normalizeText(result.comments || visitLab.notes),
              isAbnormal: !!result.is_abnormal,
              orderedAt: visitLab.ordered_date || visitLab.created_at || null,
              reportedAt: result.updated_at || result.created_at || visitLab.completed_date || null,
            });
          }
          continue;
        }

        rows.push({
          id: visitLab.id,
          groupName: labName,
          investigation: labName,
          result: extractResultValue(visitLab.result_value),
          unit: "",
          referenceRange: normalizeText(visitLab.normal_range),
          status: normalizeText(visitLab.status || "Ordered"),
          remarks: normalizeText(visitLab.notes),
          isAbnormal: false,
          orderedAt: visitLab.ordered_date || visitLab.created_at || null,
          reportedAt: visitLab.completed_date || visitLab.updated_at || null,
        });
      }

      for (const result of labResults) {
        if (matchedResultIds.has(result.id)) continue;
        rows.push({
          id: result.id,
          groupName: normalizeText(result.main_test_name || result.test_category || "Lab Investigation"),
          investigation: normalizeText(result.test_name || result.main_test_name || "Lab Investigation"),
          result: extractResultValue(result.result_value),
          unit: normalizeText(result.result_unit),
          referenceRange: normalizeText(result.reference_range),
          status: normalizeText(result.result_status),
          remarks: normalizeText(result.comments),
          isAbnormal: !!result.is_abnormal,
          orderedAt: null,
          reportedAt: result.updated_at || result.created_at || null,
        });
      }

      return {
        visitUuid,
        rows,
        sourceVisitCount: new Set(visitLabs.map((row: any) => row.visit_id).filter(Boolean)).size,
      };
    },
  });
}

async function buildLabReportPdf(params: {
  hospitalName: string;
  hospitalAddress?: string | null;
  hospitalPhone?: string | null;
  hospitalEmail?: string | null;
  primaryColor?: string | null;
  patientName?: string | null;
  patientRegistrationNo?: string | null;
  patientAge?: string | number | null;
  patientGender?: string | null;
  visitId?: string | null;
  consultant?: string | null;
  rows: LabReportRow[];
}): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const contentW = pageW - margin * 2;
  const accent = params.primaryColor || "#334155";
  const accentRgb = accent.match(/^#([0-9a-f]{6})$/i)
    ? [
        parseInt(accent.slice(1, 3), 16),
        parseInt(accent.slice(3, 5), 16),
        parseInt(accent.slice(5, 7), 16),
      ]
    : [51, 65, 85];
  const letterhead = await loadImageDataUrl("/hope-letterhead.png");
  const letterheadW = pageW;
  const letterheadH = pageW * (710 / 568);

  const addLetterhead = () => {
    if (letterhead) {
      doc.addImage(letterhead, "PNG", 0, 0, letterheadW, letterheadH);
      return;
    }

    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, 31, pageW - margin, 31);
  };

  addLetterhead();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text("LAB INVESTIGATION REPORT", pageW / 2, 53, { align: "center" });

  const patientInfo = [
    ["Patient Name", params.patientName || "-"],
    ["Registration No.", params.patientRegistrationNo || "-"],
    ["Visit ID", params.visitId || "-"],
    ["Age / Gender", `${params.patientAge || "-"} / ${params.patientGender || "-"}`],
    ["Report Date", new Date().toLocaleDateString("en-IN")],
    ["Consultant", params.consultant || "-"],
  ];

  let y = 63;
  doc.setFontSize(9);
  patientInfo.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + col * (contentW / 2);
    const lineY = y + row * 7;
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, x, lineY);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), x + 29, lineY, { maxWidth: contentW / 2 - 31 });
  });

  y += 25;

  autoTable(doc, {
    startY: y,
    margin: { top: 56, right: margin, bottom: 62, left: margin },
    head: [["Investigation", "Observed Value", "Unit", "Reference Range", "Status", "Reported"]],
    body: params.rows.map((row) => [
      row.groupName && row.groupName !== row.investigation
        ? `${row.groupName}\n${row.investigation}`
        : row.investigation,
      row.result || "-",
      row.unit || "-",
      row.referenceRange || "-",
      row.isAbnormal ? `${row.status || "Result"} / Abnormal` : row.status || "-",
      formatReportDate(row.reportedAt || row.orderedAt),
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2,
      lineColor: [160, 160, 160],
      lineWidth: 0.15,
      textColor: [20, 20, 20],
      valign: "middle",
    },
    headStyles: {
      fillColor: [accentRgb[0], accentRgb[1], accentRgb[2]],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 47 },
      1: { cellWidth: 34, fontStyle: "bold" },
      2: { cellWidth: 20 },
      3: { cellWidth: 34 },
      4: { cellWidth: 26 },
      5: { cellWidth: 25 },
    },
    didParseCell: (data: any) => {
      if (data.section === "body") {
        const row = params.rows[data.row.index];
        if (row?.isAbnormal) {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
    willDrawPage: (data: any) => {
      if (data.pageNumber > 1) addLetterhead();
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 20;
  const signatureY = Math.min(finalY + 25, 231);
  doc.setDrawColor(80, 80, 80);
  doc.line(pageW - 72, signatureY, pageW - margin, signatureY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Pathologist / Lab In-charge", pageW - 43, signatureY + 5, { align: "center" });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(`Page ${page} of ${pageCount}`, pageW - margin, pageH - 10, { align: "right" });
  }

  return doc.output("blob");
}

function usePackageSummary(visitSummary: VisitSummary | null | undefined) {
  return useQuery({
    queryKey: ["bill-package-summary", visitSummary?.package_name],
    enabled: !!visitSummary?.package_name,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<PackageSummary | null> => {
      const packageName = visitSummary?.package_name?.trim();
      if (!packageName) return null;

      const yojanaSelect =
        "package_name, procedure_name, procedure_code, package_code, medical_or_surgical, specialty, level_of_care";
      const pmjaySelect =
        "treatment_plan, treatment_code, category, anaesthesia_type";

      const yojanaExact = await supabase
        .from("yojana_mh_procedures")
        .select(yojanaSelect)
        .eq("package_name", packageName)
        .maybeSingle();
      if (yojanaExact.data) return yojanaExact.data as PackageSummary;
      if (yojanaExact.error && yojanaExact.error.code !== "PGRST116") throw yojanaExact.error;

      const yojanaProcedure = await supabase
        .from("yojana_mh_procedures")
        .select(yojanaSelect)
        .eq("procedure_name", packageName)
        .maybeSingle();
      if (yojanaProcedure.data) return yojanaProcedure.data as PackageSummary;
      if (yojanaProcedure.error && yojanaProcedure.error.code !== "PGRST116") throw yojanaProcedure.error;

      const pmjayExact = await supabase
        .from("pmjay_mjpjay_packages")
        .select(pmjaySelect)
        .eq("treatment_plan", packageName)
        .maybeSingle();
      if (pmjayExact.data) return pmjayExact.data as PackageSummary;
      if (pmjayExact.error && pmjayExact.error.code !== "PGRST116") throw pmjayExact.error;

      const pmjayCode = await supabase
        .from("pmjay_mjpjay_packages")
        .select(pmjaySelect)
        .eq("treatment_code", packageName)
        .maybeSingle();
      if (pmjayCode.data) return pmjayCode.data as PackageSummary;
      if (pmjayCode.error && pmjayCode.error.code !== "PGRST116") throw pmjayCode.error;

      return null;
    },
  });
}

function buildGeneratedOtNotes(params: {
  patientName?: string | null;
  patientRegistrationNo?: string | null;
  visitId?: string | null;
  packageName?: string | null;
  packageCode?: string | null;
  packageType?: string;
  otRequired?: string;
}) {
  const procedureName = params.packageName || "Approved procedure";
  const packageType = params.packageType || "As per package";

  const accessLine =
    packageType === "Conservative"
      ? "No operative incision was required. The case was managed as per the approved conservative pathway with monitoring and treatment as indicated."
      : "The operative field was painted and draped in the usual sterile fashion, and the access route was established according to the procedure performed.";

  const dissectionLine =
    packageType === "Conservative"
      ? "Clinical examination and treatment steps were completed according to the conservative plan, with no surgical dissection performed."
      : "The relevant anatomical planes were entered, the target tissue or pathology was dissected carefully, and adjacent structures were protected throughout.";

  const findingsLine =
    packageType === "Conservative"
      ? "Clinical and procedural findings were documented, and the intended non-operative endpoint was achieved."
      : "Operative findings were consistent with the planned procedure, with satisfactory exposure, control, and no unexpected injury or uncontrolled bleeding.";

  const closureLine =
    packageType === "Conservative"
      ? "The patient was continued on the prescribed conservative management plan and transferred in stable condition."
      : "Haemostasis was secured, the operative endpoint was confirmed, any specimen was handled as indicated, closure was completed in layers or at access sites, dressings were applied, and the patient was shifted to recovery in stable condition.";

  return [
    "OT NOTES",
    `Patient Name: ${params.patientName || "N/A"}`,
    `Visit ID: ${params.visitId || "N/A"}`,
    `Registration ID: ${params.patientRegistrationNo || "N/A"}`,
    `Procedure: ${procedureName}`,
    "",
    "Operative Note",
    "1. The patient was received in the operating theatre, identity and procedure were confirmed, consent was checked, and anaesthesia was induced as planned.",
    `2. The patient was positioned appropriately and the operative field was prepared and draped under strict aseptic precautions. ${accessLine}`,
    `3. ${dissectionLine}`,
    `4. Operative findings: ${findingsLine}`,
    `5. Haemostasis was confirmed and the intended procedural endpoint was achieved before closure or completion of the case.`,
    `6. ${closureLine}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

type MasterOtSource = {
  treatmentPlan?: string | null;
  treatmentCode?: string | null;
  category?: string | null;
  packageType?: string | null;
};

function buildMasterOtTheme(source: MasterOtSource) {
  const haystack = [
    source.treatmentPlan,
    source.category,
    source.treatmentCode,
    source.packageType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(laparoscopic|laparoscopy|robotic)/.test(haystack) || /cystectomy/.test(haystack)) {
    const procedure =
      /cystectomy/.test(haystack)
        ? "cystic lesion"
        : /hysterectomy/.test(haystack)
          ? "pelvic organs"
          : /cholecystectomy/.test(haystack)
            ? "gallbladder"
            : /append/.test(haystack)
              ? "appendix"
              : /hernia/.test(haystack)
                ? "hernia sac and defect"
                : "target lesion";

    return {
      access: "The patient was positioned appropriately for laparoscopy, the abdomen was painted and draped in a sterile fashion, pneumoperitoneum was created, and the initial port was introduced under direct vision. Additional working ports were placed under vision as required.",
      dissection: `The ${procedure} was identified and carefully dissected from the surrounding tissues using sharp and blunt dissection, with meticulous attention to adjacent bowel, bladder, ureteric, vascular, or other critical structures as applicable.`,
      confirmation: /cholecystectomy/.test(haystack)
        ? "Critical view of safety was obtained, the cystic duct and artery were secured, and the intended anatomical endpoint was achieved without visible leak or bleeding."
        : /append/.test(haystack)
          ? "The appendiceal base was secured and the specimen was delivered intact, with no residual stump bleeding or contamination seen at completion."
          : /hernia/.test(haystack)
            ? "The defect was closed or reinforced as planned, the reduced contents were viable, and no active bleeding or bowel compromise was seen."
            : /hysterectomy/.test(haystack)
              ? "The intended pelvic dissection was completed, the target tissue was removed, and the operative field showed satisfactory haemostasis with preserved adjacent structures."
              : "The intended lesion was completely excised or treated, the operative bed was dry, and no unintended injury or residual target tissue was seen at completion.",
      closure: "The specimen was retrieved in a bag where applicable, ports were removed under vision, pneumoperitoneum was released, fascial closure was performed at larger port sites as required, skin was approximated with sutures or staples, dressings were applied, and the patient was shifted to recovery in stable condition.",
    };
  }

  if (/urology|uro|dj stent|dj stenting|stenting including cystoscopy|ureter|ureteric|pcnl|pyeloplasty|nephrectomy|cysto/.test(haystack)) {
    if (/pcnl/.test(haystack)) {
      return {
        access: "The patient was positioned prone, the flank was prepared and draped, and access to the pelvicalyceal system was obtained under image guidance with tract creation and dilation.",
        dissection: "The collecting system was entered in a controlled manner, the calculi were fragmented and cleared, and the calyceal and ureteric system were inspected for residual obstruction.",
        confirmation: "Stone clearance was confirmed endoscopically and fluoroscopically, the renal system was adequately decompressed, and there was no immediate collecting-system injury.",
        closure: "The tract was secured, haemostasis was confirmed, the access site was dressed or closed as required, and the patient was transferred to recovery in stable condition.",
      };
    }

    if (/pyeloplasty/.test(haystack)) {
      return {
        access: "A flank or laparoscopic approach was used, the operative site was painted and draped, and the ureteropelvic junction was exposed with adequate working space.",
        dissection: "The stenotic ureteropelvic junction was dissected, the fibrotic segment was excised when indicated, the pelvis was mobilised, and the ureter was spatulated to allow a tension-free repair.",
        confirmation: "The anastomosis was inspected for watertight alignment, free drainage, and absence of twist or tension, with adequate patency demonstrated at completion.",
        closure: "Meticulous haemostasis was obtained, the repair was completed in layers with absorbable sutures where appropriate, and dressings were applied before recovery transfer.",
      };
    }

    if (/nephrectomy/.test(haystack)) {
      return {
        access: "The kidney was approached through the planned open or minimally invasive incision after the site was painted and draped, with layered entry through the skin, subcutaneous tissue, fascia, and muscular planes.",
        dissection: "The renal unit and surrounding hilar structures were carefully dissected, the intended segment or tissue was separated from adjacent structures, and vascular control was maintained throughout.",
        confirmation: "The resected specimen was confirmed, haemostasis at the renal bed and hilum was satisfactory, and no active bleeding or urinary leak was seen at completion.",
        closure: "After final count verification, layered closure was completed with appropriate absorbable and skin sutures, dressing was applied, and the patient was shifted stable to recovery.",
      };
    }

    return {
      access: "No external cutaneous incision was required for this endoscopic urology procedure; the bladder and ureteric orifice were accessed cystoscopically under direct vision after sterile preparation and draping.",
      dissection: "The urethra, bladder, and ureteric lumen were inspected, a guidewire was advanced across the ureteric obstruction or target segment, and the double-J stent or endoscopic treatment was deployed in the planned position.",
      confirmation: "Correct proximal and distal curl position or treatment effect was confirmed endoscopically and/or fluoroscopically, urine drainage was checked, and no perforation or active bleeding was seen.",
      closure: "The bladder was emptied, haemostasis was confirmed, no cutaneous incision required closure, and the patient was transferred in stable condition with the prescribed follow-up plan.",
    };
  }

  if (/cardio|angioplasty|ptca|pacemaker|coronary|angiogram|stent/.test(haystack)) {
    return {
      access: "Percutaneous vascular access was obtained under sterile precautions after painting and draping, and the target vessel was cannulated using the standard approach for the approved cardiology procedure.",
      dissection: "Guidewire and catheter manipulation were performed across the relevant vascular or coronary segment, with lesion treatment, dilation, or device deployment according to the operative plan.",
      confirmation: "Final angiographic or procedural confirmation showed the intended result, with preserved flow, stable device position, and no immediate procedural complication.",
      closure: "Access-site haemostasis was secured, the puncture site was dressed, and the patient was transferred to recovery in stable condition.",
    };
  }

  if (/neuro|brain|crani|spine|laminectomy|discectomy/.test(haystack)) {
    return {
      access: "A standard cranial or posterior spinal incision was made as appropriate, after the operative field was painted and draped under strict aseptic precautions.",
      dissection: "The relevant soft tissues, muscle planes, bone window, lamina, disc space, or neural elements were exposed and decompressed carefully according to the planned neurosurgical procedure.",
      confirmation: "Adequate decompression, restoration of the intended anatomy, haemostasis, and absence of obvious neural compromise were confirmed before closure.",
      closure: "The wound was irrigated, layered closure was completed with appropriate sutures, dressing was applied, and the patient was moved to recovery in stable condition.",
    };
  }

  if (/ortho|fracture|plate|nailing|fixation|arthros|tendon|bone|joint/.test(haystack)) {
    return {
      access: "A skin incision was made over the affected segment after painting and draping, and the subcutaneous tissue, fascia, and muscle were dissected to expose the fracture, joint, or operative bone surface.",
      dissection: "The fracture or joint pathology was reduced, debrided, or prepared as needed, and fixation or reconstruction was completed using the planned orthopaedic technique.",
      confirmation: "Alignment, stability, and implant position were checked clinically and/or radiologically, with satisfactory correction and haemostasis at the end of the procedure.",
      closure: "Layered closure was performed with absorbable sutures for deep tissue and appropriate skin sutures or staples, followed by dressing and recovery transfer.",
    };
  }

  if (/general surgery|laparotomy|append|hernia|gastro|chole|lap\./.test(haystack)) {
    return {
      access: "A standard abdominal or operative incision was made after painting and draping, followed by careful entry through the subcutaneous tissues and fascia.",
      dissection: "The target bowel, appendix, gallbladder, hernia sac, or other involved structures were dissected, controlled, and treated according to the operative plan.",
      confirmation: "The operative field was inspected for completeness of treatment, haemostasis, and absence of leak, with the intended anatomical correction confirmed before closure.",
      closure: "The wound was closed in layers with appropriate sutures, dressing was applied, and the patient was transferred to recovery in stable condition.",
    };
  }

  return {
    access: "The operative site was painted and draped under strict aseptic precautions, and the standard incision or access route was used for the procedure.",
    dissection: "The relevant anatomical planes and target structures were carefully dissected, protected, and treated using the accepted technique for the procedure.",
    confirmation: "Completion of the intended operative goal, satisfactory haemostasis, and preservation of adjacent structures were confirmed before the case was closed.",
    closure: "Layered closure was completed with appropriate sutures, dressings were applied, and the patient was shifted to recovery in stable condition.",
  };
}

function buildMasterOtNotes(params: {
  treatmentPlan?: string | null;
  treatmentCode?: string | null;
  category?: string | null;
  packageType?: string | null;
}) {
  const procedureName = params.treatmentPlan || params.treatmentCode || "Approved procedure";
  const theme = buildMasterOtTheme(params);

  return [
    "OT NOTES",
    `Procedure: ${procedureName}`,
    "",
    "Operative Note",
    "1. The patient was brought to the operating theatre, identity was verified, consent was checked, the site and procedure were confirmed, and anaesthesia was induced as planned.",
    `2. The patient was positioned appropriately. The operative field was painted, draped, and prepared in the usual sterile fashion. ${theme.access}`,
    `3. ${theme.dissection}`,
    `4. Operative findings: ${theme.confirmation}`,
    "5. Haemostasis was secured, any specimen or excised tissue was handled as indicated, and the operative endpoint was confirmed before closure.",
    `6. ${theme.closure}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getPackageDisplayName(
  packageSummary: PackageSummary | null | undefined,
  visitPackageName: string | null | undefined,
) {
  return (
    packageSummary?.package_name ||
    packageSummary?.procedure_name ||
    packageSummary?.treatment_plan ||
    visitPackageName ||
    "Selected package"
  );
}

function getPackageDisplayType(packageSummary: PackageSummary | null | undefined) {
  return normalizePackageType(
    packageSummary?.medical_or_surgical ||
      packageSummary?.category ||
      packageSummary?.level_of_care ||
      packageSummary?.specialty,
  );
}

/** Read-only gallery for one category: thumbnails, click to view, download. */
function CategoryGallery({
  items,
  onView,
  onDownloadPdf,
  generating,
  onDownloadOne,
  busyDocId,
}: {
  items: PatientDoc[];
  onView: (doc: PatientDoc) => void;
  onDownloadPdf: () => void;
  generating: boolean;
  onDownloadOne: (doc: PatientDoc) => void;
  busyDocId: string | null;
}) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No files uploaded.
      </p>
    );
  }
  const imageCount = items.filter((d) => isImage(d.fileType)).length;
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={onDownloadPdf}
          disabled={imageCount === 0 || generating}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing PDF…
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" /> Download all as PDF
            </>
          )}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
      {items.map((doc) => (
        <div key={doc.id} className="rounded-lg border p-2">
          <button
            type="button"
            className="block w-full overflow-hidden rounded-md bg-muted"
            onClick={() => onView(doc)}
          >
            {isImage(doc.fileType) ? (
              <img
                src={doc.fileUrl}
                alt={doc.fileName}
                className="h-28 w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-28 w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <FileText className="h-9 w-9" />
                <span className="text-xs">{isPdf(doc.fileType) ? "PDF" : "File"}</span>
              </div>
            )}
          </button>
          <div className="mt-2 flex items-center justify-between gap-1">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {doc.fileName}
            </span>
            <button
              type="button"
              aria-label="Download as PDF"
              title="Download as PDF"
              disabled={busyDocId === doc.id}
              className="rounded-md p-1.5 text-foreground/70 hover:bg-accent disabled:opacity-50"
              onClick={() => onDownloadOne(doc)}
            >
              {busyDocId === doc.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      ))}
      </div>
    </>
  );
}

/**
 * A collapsible side panel next to the Yojna/Final Bill that lets staff view and
 * download the patient's uploaded photos/documents across the 8 profile categories.
 * Read-only — uploading/deleting is done from the tablet Patient Profile.
 */
export function BillDocumentsSection({
  patientId,
  patientName,
  patientRegistrationNo,
  visitId,
}: BillDocumentsSectionProps) {
  const { hospitalConfig } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PatientDocCategory>(
    PATIENT_DOC_CATEGORIES[0].id,
  );
  const [viewing, setViewing] = useState<PatientDoc | null>(null);
  const [generatedLabReportUrl, setGeneratedLabReportUrl] = useState<string | null>(null);
  const [pdfBusyCategory, setPdfBusyCategory] = useState<string | null>(null);
  const [pdfBusyDocId, setPdfBusyDocId] = useState<string | null>(null);
  const [labReportBusy, setLabReportBusy] = useState<"view" | "download" | null>(null);
  const [otNotesView, setOtNotesView] = useState<"auto" | "master">("auto");
  const docs = usePatientAllDocs(patientId);
  const visitSummary = useBillVisitSummary(visitId);
  const labInvestigations = useBillLabInvestigations({
    visitId,
    visitSummary: visitSummary.data,
    patientId: patientId || visitSummary.data?.patient_id,
    patientName,
  });
  const packageSummary = usePackageSummary(visitSummary.data);
  const packageDisplayName = getPackageDisplayName(packageSummary.data, visitSummary.data?.package_name);
  const packageDisplayType = getPackageDisplayType(packageSummary.data);
  const registrationId = patientId || "-";
  const registrationNo = patientRegistrationNo || "-";
  const otRequired = deriveOtRequirement(packageDisplayType);
  const labRows = labInvestigations.data?.rows || [];
  const hasGeneratedLabReport = labRows.length > 0;

  const generatedOtNotes = useMemo(() => {
    return buildGeneratedOtNotes({
      patientName,
      patientRegistrationNo,
      visitId,
      packageName: packageDisplayName,
      packageCode:
        packageSummary.data?.procedure_code ||
        packageSummary.data?.package_code ||
        packageSummary.data?.treatment_code ||
        null,
      packageType: packageDisplayType,
      otRequired,
    });
  }, [otRequired, packageDisplayName, packageDisplayType, packageSummary.data, patientName, patientRegistrationNo, visitId]);

  const masterOtNotes = useMemo(() => {
    return buildMasterOtNotes({
      treatmentPlan:
        packageSummary.data?.package_name ||
        packageSummary.data?.procedure_name ||
        packageSummary.data?.treatment_plan ||
        visitSummary.data?.package_name ||
        null,
      treatmentCode:
        packageSummary.data?.procedure_code ||
        packageSummary.data?.package_code ||
        packageSummary.data?.treatment_code ||
        null,
      category: packageSummary.data?.category || packageSummary.data?.specialty || null,
      packageType: packageDisplayType,
    });
  }, [packageDisplayType, packageSummary.data, visitSummary.data?.package_name]);

  const safeName = safeFileName(patientName || "patient");

  const buildCurrentLabReportPdf = () =>
    buildLabReportPdf({
      hospitalName: hospitalConfig?.fullName || "Hospital",
      hospitalAddress: hospitalConfig?.contactInfo?.address,
      hospitalPhone: hospitalConfig?.contactInfo?.phone,
      hospitalEmail: hospitalConfig?.contactInfo?.email,
      primaryColor: hospitalConfig?.primaryColor,
      patientName,
      patientRegistrationNo,
      patientAge: visitSummary.data?.patients?.age,
      patientGender: visitSummary.data?.patients?.gender || null,
      visitId: visitSummary.data?.visit_id || visitId || null,
      consultant: visitSummary.data?.appointment_with || null,
      rows: labRows,
    });

  const openGeneratedLabReport = async () => {
    if (!hasGeneratedLabReport || labReportBusy) return;
    setLabReportBusy("view");
    try {
      if (generatedLabReportUrl) {
        window.URL.revokeObjectURL(generatedLabReportUrl);
        setGeneratedLabReportUrl(null);
      }
      const blob = await buildCurrentLabReportPdf();
      const url = window.URL.createObjectURL(blob);
      setGeneratedLabReportUrl(url);
      setViewing({
        id: "__generated_lab_report__",
        fileName: `${safeName}_Lab_Investigation_Report.pdf`,
        fileUrl: url,
        fileType: "application/pdf",
        storagePath: null,
        uploadedAt: new Date().toISOString(),
        latitude: null,
        longitude: null,
      });
    } catch (err) {
      console.error("Lab report PDF view failed:", err);
      alert("Could not open the lab investigation report. Please try again.");
    } finally {
      setLabReportBusy(null);
    }
  };

  const downloadGeneratedLabReport = async () => {
    if (!hasGeneratedLabReport || labReportBusy) return;
    setLabReportBusy("download");
    try {
      const blob = await buildCurrentLabReportPdf();
      triggerBlobDownload(blob, `${safeName}_Lab_Investigation_Report.pdf`);
    } catch (err) {
      console.error("Lab report PDF generation failed:", err);
      alert("Could not generate the lab investigation report. Please try again.");
    } finally {
      setLabReportBusy(null);
    }
  };

  const closeViewer = () => {
    if (generatedLabReportUrl) {
      window.URL.revokeObjectURL(generatedLabReportUrl);
      setGeneratedLabReportUrl(null);
    }
    setViewing(null);
  };

  const handleDownloadOne = async (doc: PatientDoc) => {
    const base = (doc.fileName || "document")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    setPdfBusyDocId(doc.id);
    try {
      if (isImage(doc.fileType)) {
        await downloadImagesAsPdf([doc], `${safeName}_${base}`);
      } else {
        // Already a PDF (or other document) — download as-is.
        await downloadDoc(doc);
      }
    } catch (err) {
      console.error("Download failed:", err);
      alert("Could not download the file. Please try again.");
    } finally {
      setPdfBusyDocId(null);
    }
  };

  const handleDownloadPdf = async (categoryId: string, label: string) => {
    const images = (byCategory.get(categoryId) || []).filter((d) =>
      isImage(d.fileType),
    );
    if (images.length === 0) return;
    setPdfBusyCategory(categoryId);
    try {
      await downloadImagesAsPdf(images, `${safeName}_${label}`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Could not generate the PDF. Please try again.");
    } finally {
      setPdfBusyCategory(null);
    }
  };

  const handleDownloadGeneratedOtNotes = async () => {
    const fileNameBase = `${(patientName || "patient").replace(/[^a-zA-Z0-9._-]/g, "_")}_OT_Notes`;
    try {
      await downloadTextAsPdf("OT NOTES", generatedOtNotes.split("\n"), fileNameBase);
    } catch (err) {
      console.error("OT notes PDF generation failed:", err);
      alert("Could not generate the OT notes PDF. Please try again.");
    }
  };

  const handleDownloadMasterOtNotes = async () => {
    const fileNameBase = `${(patientName || "patient").replace(/[^a-zA-Z0-9._-]/g, "_")}_Master_OT_Notes`;
    try {
      await downloadTextAsPdf("OT NOTES", masterOtNotes.split("\n"), fileNameBase);
    } catch (err) {
      console.error("Master OT notes PDF generation failed:", err);
      alert("Could not generate the master OT notes PDF. Please try again.");
    }
  };

  // Group all docs by category so every tab (even empty ones) can render.
  const byCategory = new Map<string, PatientDoc[]>();
  for (const cat of PATIENT_DOC_CATEGORIES) byCategory.set(cat.id, []);
  for (const doc of docs.data || []) {
    if (byCategory.has(doc.category)) byCategory.get(doc.category)!.push(doc);
  }
  const generatedDocCount = hasGeneratedLabReport ? 1 : 0;
  const total = (docs.data?.length || 0) + generatedDocCount;

  return (
    <div className="print:hidden rounded-lg border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Documents &amp; Photos
          {total > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {total}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t p-4">
          {!patientId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No patient linked to this bill.
            </p>
          ) : docs.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : docs.isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Could not load documents. Check the connection.
            </p>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Patient Name
                    </div>
                    <div className="font-medium leading-5 text-slate-900 break-words">
                      {patientName || "-"}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Registration No.
                      </div>
                      <div className="font-medium leading-5 text-slate-900 break-words">
                        {registrationNo}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Registration ID
                      </div>
                      <div className="font-medium leading-5 text-slate-900 break-all">
                        {registrationId}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Visit ID
                      </div>
                      <div className="font-medium leading-5 text-slate-900 break-all">
                        {visitId || "-"}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Package Details
                      </div>
                      <div className="font-medium leading-5 text-slate-900 break-words">
                        {packageDisplayName}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Conservative / Surgical
                      </div>
                      <div className="font-medium leading-5 text-slate-900">
                        {packageDisplayType}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        OT Required
                      </div>
                      <div className="font-medium leading-5 text-slate-900">
                        {otRequired}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as PatientDocCategory)}
            >
              <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                {PATIENT_DOC_CATEGORIES.map((cat) => {
                  const count =
                    (byCategory.get(cat.id)?.length || 0) +
                    (cat.id === "lab_investigation" ? generatedDocCount : 0);
                  return (
                    <TabsTrigger key={cat.id} value={cat.id} className="text-xs">
                      {cat.label}
                      {count > 0 && (
                        <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {PATIENT_DOC_CATEGORIES.map((cat) => (
                <TabsContent key={cat.id} value={cat.id}>
                  {cat.id === "lab_investigation" && (
                    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileText className="h-4 w-4 text-primary" />
                            Generated Lab Investigation Report
                          </div>
                          <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                            <span>
                              <span className="font-semibold text-slate-800">Investigations:</span>{" "}
                              {labInvestigations.isLoading ? "Loading" : labRows.length}
                            </span>
                            <span>
                              <span className="font-semibold text-slate-800">Visit:</span>{" "}
                              {visitSummary.data?.visit_id || visitId || "-"}
                            </span>
                            <span>
                              <span className="font-semibold text-slate-800">Format:</span> PDF
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void openGeneratedLabReport()}
                            disabled={!hasGeneratedLabReport || labInvestigations.isLoading || labReportBusy !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {labReportBusy === "view" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                            View PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadGeneratedLabReport()}
                            disabled={!hasGeneratedLabReport || labInvestigations.isLoading || labReportBusy !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {labReportBusy === "download" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            Download PDF
                          </button>
                        </div>
                      </div>
                      {labInvestigations.isError && (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          Could not load lab investigations for this visit.
                        </p>
                      )}
                      {!labInvestigations.isLoading && !labInvestigations.isError && !hasGeneratedLabReport && (
                        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          No lab investigations are recorded for this visit.
                        </p>
                      )}
                    </div>
                  )}
                  {cat.id === "discharge_summary" && (
                    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            Generated Discharge Summary
                          </div>
                          <p className="mt-1 text-sm text-slate-600">
                            Open the printable discharge summary for this visit and download or print it from the generated view.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!visitId}
                          onClick={() => {
                            if (!visitId) return;
                            window.open(`/discharge-summary-print/${visitId}`, "_blank", "noopener,noreferrer");
                          }}
                          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Generate / Download
                        </button>
                      </div>
                      {!visitId && (
                        <p className="mt-3 text-xs text-amber-700">
                          Visit ID is not available on this bill, so the generated discharge summary cannot be opened from here.
                        </p>
                      )}
                    </div>
                  )}
                  {cat.id === "ot_notes" && (
                    <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Patient Details
                            </div>
                            <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                              <div><span className="font-semibold text-slate-900">Name:</span> {patientName || "-"}</div>
                              <div><span className="font-semibold text-slate-900">Visit ID:</span> {visitId || "-"}</div>
                              <div><span className="font-semibold text-slate-900">Registration ID:</span> {patientRegistrationNo || "-"}</div>
                              <div><span className="font-semibold text-slate-900">OT Required:</span> {deriveOtRequirement(normalizePackageType(packageSummary.data?.medical_or_surgical || packageSummary.data?.category || packageSummary.data?.level_of_care || packageSummary.data?.specialty))}</div>
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Package Context
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-slate-700">
                              <div>
                                <span className="font-semibold text-slate-900">Package:</span>{" "}
                                {packageSummary.data?.package_name ||
                                  packageSummary.data?.procedure_name ||
                                  packageSummary.data?.treatment_plan ||
                                  visitSummary.data?.package_name ||
                                  "-"}
                              </div>
                              <div>
                                <span className="font-semibold text-slate-900">Type:</span>{" "}
                                {normalizePackageType(
                                  packageSummary.data?.medical_or_surgical ||
                                    packageSummary.data?.category ||
                                    packageSummary.data?.level_of_care ||
                                    packageSummary.data?.specialty,
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 sm:min-w-[180px]">
                          <button
                            type="button"
                            onClick={() => {
                              if (otNotesView === "master") {
                                void handleDownloadMasterOtNotes();
                                return;
                              }
                              void handleDownloadGeneratedOtNotes();
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download OT Notes
                          </button>
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            Generated automatically from the selected package.
                          </div>
                        </div>
                      </div>

                      <Tabs value={otNotesView} onValueChange={(v) => setOtNotesView(v as "auto" | "master")} className="mt-4">
                        <TabsList className="grid h-auto w-full grid-cols-2">
                          <TabsTrigger value="auto" className="text-xs">
                            Bill OT Notes
                          </TabsTrigger>
                          <TabsTrigger value="master" className="text-xs">
                            Master OT Notes
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="auto" className="mt-4">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Auto-generated OT Notes
                            </div>
                            <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                              {generatedOtNotes}
                            </pre>
                          </div>
                        </TabsContent>

                        <TabsContent value="master" className="mt-4">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                              PMJAY / MJPJAY Master OT Notes
                            </div>
                            <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                              {masterOtNotes}
                            </pre>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </div>
                  )}
                  <CategoryGallery
                    items={byCategory.get(cat.id) || []}
                    onView={setViewing}
                    onDownloadPdf={() => handleDownloadPdf(cat.id, cat.label)}
                    generating={pdfBusyCategory === cat.id}
                    onDownloadOne={handleDownloadOne}
                    busyDocId={pdfBusyDocId}
                  />
                </TabsContent>
              ))}
            </Tabs>
            </>
          )}
        </div>
      )}

      {/* Full-size viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && closeViewer()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {viewing?.fileName || patientName || "Document"}
            </DialogTitle>
          </DialogHeader>
          {viewing ? (
            isImage(viewing.fileType) ? (
              <img
                src={viewing.fileUrl}
                alt={viewing.fileName}
                className="max-h-[70vh] w-full object-contain"
              />
            ) : (
              <iframe
                title={viewing.fileName}
                src={viewing.fileUrl}
                className="h-[70vh] w-full rounded-lg border"
              />
            )
          ) : null}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => viewing && handleDownloadOne(viewing)}
              disabled={!viewing || (!!viewing && pdfBusyDocId === viewing.id)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {viewing && pdfBusyDocId === viewing.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Preparing PDF…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Download PDF
                </>
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BillDocumentsSection;
