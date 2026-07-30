/**
 * Renders a generated discharge summary to a PDF, with or without the hospital
 * logo in the header band.
 *
 * The two variants exist because the portal copy and the patient copy are not
 * the same document: one goes out on hospital letterhead, the other has to be
 * plain. The input is the summary *text* rather than a patient, so the official
 * IPD discharge summary can be fed through the same renderer later.
 */

export const stripMarkdownForPdf = (value: string) =>
  value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();

/** Logo drawn into the header band, keyed by hospital. Hospitals without an
 *  asset fall back to the text-only header rather than a broken image. */
const HOSPITAL_LOGOS: Record<string, string> = {
  hope: "/hope-hospital-logo-mark.png",
};

export function hospitalLogoSrc(hospitalName: string | null | undefined): string | null {
  return HOSPITAL_LOGOS[String(hospitalName || "").toLowerCase()] ?? null;
}

/** Read a same-origin image into a data URL for jsPDF.addImage. */
async function loadImageDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load ${src}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface ArshiyaSummaryPdfInput {
  summaryText: string;
  withLogo: boolean;
  hospitalName: string;
  patientName: string | null | undefined;
  patientId: string | null | undefined;
  visitNumber: string | null | undefined;
  registrationId: string | null | undefined;
  portalUrl: string;
}

export async function buildArshiyaSummaryPdfBlob(
  input: ArshiyaSummaryPdfInput,
): Promise<Blob> {
  const summary = input.summaryText.trim();
  if (!summary) throw new Error("Generate the discharge summary first.");

  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 14;
  const pageWidth = 210;
  const maxWidth = pageWidth - marginX * 2;
  let y = 16;

  const addFooter = () => {
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text(`Patient Portal: ${input.portalUrl}`, marginX, 288);
      pdf.text(`Page ${page} of ${pageCount}`, 196, 288, { align: "right" });
    }
  };

  pdf.setFillColor(22, 101, 52);
  pdf.rect(0, 0, 210, 26, "F");

  // The logo sits at the left of the band and pushes the hospital name across.
  // A missing or unreadable asset must not cost the user their PDF, so a
  // failure here degrades to the plain header.
  let textX = marginX;
  if (input.withLogo) {
    const logoSrc = hospitalLogoSrc(input.hospitalName);
    if (logoSrc) {
      try {
        const dataUrl = await loadImageDataUrl(logoSrc);
        pdf.addImage(dataUrl, "PNG", marginX, 4, 18, 18);
        textX = marginX + 22;
      } catch {
        // Fall through to the text-only header.
      }
    }
  }

  pdf.setTextColor(255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(input.hospitalName, textX, 11);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text("Arshiya Generated Discharge Summary", textX, 19);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, 196, 11, { align: "right" });
  pdf.text(`Visit ID: ${input.visitNumber || "-"}`, 196, 19, { align: "right" });

  y = 34;
  pdf.setTextColor(20);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(`Patient: ${input.patientName || "-"}`, marginX, y);
  pdf.text(`Patient ID: ${input.patientId || "-"}`, 112, y);
  y += 7;
  pdf.text(`Yojana Registration ID: ${input.registrationId || "-"}`, marginX, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const lines = pdf.splitTextToSize(stripMarkdownForPdf(summary), maxWidth);
  lines.forEach((line: string) => {
    if (y > 278) {
      pdf.addPage();
      y = 16;
    }
    pdf.text(line, marginX, y);
    y += 5.5;
  });

  addFooter();
  return pdf.output("blob") as Blob;
}
