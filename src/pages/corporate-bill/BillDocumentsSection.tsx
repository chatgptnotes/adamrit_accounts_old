import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  visit_id: string | null;
  package_name: string | null;
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
      const { data, error } = await supabase
        .from("visits")
        .select("visit_id, package_name")
        .eq("visit_id", visitId)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as VisitSummary | null;
    },
  });
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
  const packageName = params.packageName || "Selected package";
  const packageType = params.packageType || "As per package";
  const otRequired = params.otRequired || "As per package";

  return [
    "OT NOTES",
    `Patient Name: ${params.patientName || "N/A"}`,
    `Visit ID: ${params.visitId || "N/A"}`,
    `Registration ID: ${params.patientRegistrationNo || "N/A"}`,
    `Package: ${packageName}`,
    params.packageCode ? `Package Code: ${params.packageCode}` : null,
    `Package Type: ${packageType}`,
    `OT Required: ${otRequired}`,
    "",
    "Procedure Note",
    "1. Verify the correct patient, package, and operative site before proceeding.",
    packageType === "Conservative"
      ? "2. Manage the case under the approved conservative package pathway with no operative intervention, and continue monitoring, medication, and follow-up as indicated."
      : otRequired === "Yes"
        ? "2. Prepare the patient for operation theatre with the planned anaesthesia and standard monitoring as per the approved package."
        : "2. Proceed according to the package protocol and final clinical decision, with operative or non-operative management as applicable.",
    "3. Maintain aseptic precautions, complete the approved package steps, and document all findings and interventions clearly.",
    "4. Confirm haemostasis or clinical stability, complete dressing or post-procedure transfer, and hand over to recovery, ward, or follow-up care as appropriate.",
  ]
    .filter((line) => line !== null)
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
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PatientDocCategory>(
    PATIENT_DOC_CATEGORIES[0].id,
  );
  const [viewing, setViewing] = useState<PatientDoc | null>(null);
  const [pdfBusyCategory, setPdfBusyCategory] = useState<string | null>(null);
  const [pdfBusyDocId, setPdfBusyDocId] = useState<string | null>(null);
  const docs = usePatientAllDocs(patientId);
  const visitSummary = useBillVisitSummary(visitId);
  const packageSummary = usePackageSummary(visitSummary.data);
  const packageDisplayName = getPackageDisplayName(packageSummary.data, visitSummary.data?.package_name);
  const packageDisplayType = getPackageDisplayType(packageSummary.data);
  const registrationId = patientId || "-";
  const registrationNo = patientRegistrationNo || "-";
  const otRequired = deriveOtRequirement(packageDisplayType);

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

  const safeName = (patientName || "patient").replace(/[^a-zA-Z0-9._-]/g, "_");

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

  // Group all docs by category so every tab (even empty ones) can render.
  const byCategory = new Map<string, PatientDoc[]>();
  for (const cat of PATIENT_DOC_CATEGORIES) byCategory.set(cat.id, []);
  for (const doc of docs.data || []) {
    if (byCategory.has(doc.category)) byCategory.get(doc.category)!.push(doc);
  }
  const total = docs.data?.length || 0;

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
                  const count = byCategory.get(cat.id)?.length || 0;
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
                            onClick={handleDownloadGeneratedOtNotes}
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

                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Auto-generated OT Notes
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                          {generatedOtNotes}
                        </pre>
                      </div>
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
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
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
