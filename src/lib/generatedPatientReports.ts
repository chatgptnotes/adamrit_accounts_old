import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';

const DEFAULT_LETTERHEAD_URL = '/hope-letterhead.png';

export type GeneratedPatientReportCategory =
  | 'clinic_notes'
  | 'treatment_sheet'
  | 'monitor_chart'
  | 'lab_investigation'
  | 'radiology_investigation';

export interface GeneratedPatientReportSection {
  title: string;
  lines: string[];
}

export interface PublishGeneratedPatientReportInput {
  category: GeneratedPatientReportCategory;
  patientId: string | null;
  patientName: string;
  title: string;
  subtitle?: string | null;
  visitId?: string | null;
  notes?: string | null;
  letterheadUrl?: string | null;
  sections: GeneratedPatientReportSection[];
}

function safePart(value: string | null | undefined): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'patient';
}

function wrapLines(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
}

async function loadImageDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Could not load ${src}`);
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function addPageIfNeeded(
  doc: jsPDF,
  y: number,
  onNewPage: () => void,
  topY = 56,
  minBottom = 56,
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y < pageHeight - minBottom) return y;
  doc.addPage();
  onNewPage();
  return topY;
}

async function renderReportPdf(input: PublishGeneratedPatientReportInput): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const marginX = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  const letterheadUrl = input.letterheadUrl || DEFAULT_LETTERHEAD_URL;
  const letterhead = letterheadUrl ? await loadImageDataUrl(letterheadUrl) : null;
  const letterheadTop = letterhead ? 132 : 48;
  const paintLetterhead = () => {
    if (letterhead) {
      doc.addImage(letterhead, "PNG", 0, 0, pageWidth, pageHeight);
    }
  };
  if (letterhead) paintLetterhead();
  let y = letterheadTop;
  const now = new Date();

  const renderMetaLines = (lines: string[]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    for (const line of lines) {
      y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, letterhead ? 72 : 56);
      doc.text(wrapLines(doc, line, contentWidth), marginX, y);
      y += 13;
    }
  };

  const renderClinicNotes = async () => {
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(letterhead ? 15 : 16);
    doc.text('CLINICAL NOTES', pageWidth / 2, letterhead ? 116 : y, { align: 'center' });
    y = letterhead ? 142 : y + 20;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const metaLines = [
      `Patient: ${input.patientName}`,
      input.patientId ? `Patient ID: ${input.patientId}` : null,
      input.visitId ? `Visit ID: ${input.visitId}` : null,
      input.subtitle ? input.subtitle : null,
      `Generated: ${now.toLocaleString('en-IN')}`,
    ].filter(Boolean) as string[];
    renderMetaLines(metaLines);

    y += 5;
    const sectionGap = 6;
    const writeLine = (text: string, options: { bold?: boolean; size?: number } = {}) => {
      y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, 120);
      doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
      doc.setFontSize(options.size || 10.5);
      const wrapped = wrapLines(doc, text, contentWidth);
      doc.text(wrapped, marginX, y);
      y += Math.max(12, wrapped.length * 12);
    };

    writeLine('Subjective:', { bold: true });
    writeLine(
      'Patient is a known case of chronic kidney disease on maintenance hemodialysis. Complains of mild generalized weakness. No history of fever, breathlessness, chest pain, or vomiting today. Overall condition improved after dialysis sessions.',
    );
    y += sectionGap;

    writeLine('Objective:', { bold: true });
    writeLine('Patient is conscious, cooperative, and oriented.');
    writeLine('Vitals: BP - Stable; PR - Within normal limits. Afebrile');
    y += sectionGap;

    writeLine('Systemic Examination:', { bold: true });
    writeLine('- CVS: S1 S2 heard, no murmurs');
    writeLine('- RS: Bilateral air entry is equal, with no added sounds.');
    writeLine('- Urine Output: Reduced');
    y += sectionGap;

    writeLine('Assessment:', { bold: true });
    writeLine('Chronic Kidney Disease on maintenance haemodialysis - stable condition');
    y += sectionGap;

    writeLine('Plan / Advice:', { bold: true });
    const planLines = [
      'Haemodialysis session completed',
      'Patient tolerated procedure well without complications',
      'Continue supportive treatment',
      'Maintain strict fluid restriction and renal diet',
      'Monitor vitals and renal parameters',
      'Advised for regular dialysis sessions as per schedule',
      'Follow-up with consultant',
    ];
    for (const line of planLines) writeLine(`- ${line}`);

    if (input.additionalNotes?.trim()) {
      y += 4;
      writeLine('Additional remarks:', { bold: true, size: 11 });
      for (const line of input.additionalNotes.trim().split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
        writeLine(`- ${line}`);
      }
    }

    const stampTop = Math.max(y + 10, 452);
    const stampSize = 76;
    const stampX = pageWidth / 2 + 12;
    await renderHospitalSeal(stampX, stampTop, stampSize);

    y = Math.max(y + 12, stampTop + stampSize + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.text('Signature:', marginX, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('Dr. Milind Dekate', marginX, y);
  };

  if (input.category === 'clinic_notes') {
    await renderClinicNotes();
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(letterhead ? 16 : 18);
    if (letterhead) {
      doc.text(input.title, pageWidth / 2, 116, { align: 'center' });
      y = 138;
    } else {
      doc.text(input.title, marginX, y);
      y += 22;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const metaLines = [
      `Patient: ${input.patientName}`,
      input.patientId ? `Patient ID: ${input.patientId}` : null,
      input.visitId ? `Visit ID: ${input.visitId}` : null,
      input.subtitle ? input.subtitle : null,
      `Generated: ${now.toLocaleString('en-IN')}`,
    ].filter(Boolean) as string[];

    for (const line of metaLines) {
      y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, letterhead ? 72 : 56);
      doc.text(wrapLines(doc, line, contentWidth), marginX, y);
      y += 14;
    }

    y += 6;
    for (const section of input.sections) {
      y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, 72);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(section.title, marginX, y);
      y += 14;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      const lines = section.lines.length > 0 ? section.lines : ['-'];
      for (const line of lines) {
        y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, 72);
        const wrapped = wrapLines(doc, `• ${line}`, contentWidth);
        doc.text(wrapped, marginX, y);
        y += wrapped.length * 12;
      }
      y += 8;
    }
  }

  if (!letterhead) {
    const footer = 'Generated automatically by Adamrit HMIS';
    const footerY = doc.internal.pageSize.getHeight() - 32;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(footer, marginX, footerY);
  }

  return doc.output('blob');
}

/**
 * Publish a generated system report into file_uploads + uploads bucket.
 * Best-effort by design: source workflows should still succeed even if report
 * publication fails, but the error is logged for follow-up.
 */
export async function publishGeneratedPatientReport(
  input: PublishGeneratedPatientReportInput,
): Promise<boolean> {
  try {
    const blob = await renderReportPdf(input);
    const datePart = new Date().toISOString().slice(0, 10);
    const fileName = `${safePart(input.patientName)}_${input.category}_${datePart}_${Date.now()}.pdf`;
    const storagePath = `generated-reports/${input.category}/${datePart}/${fileName}`;

    const { error: uploadError } = await (supabase as any).storage
      .from('uploads')
      .upload(storagePath, blob, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(storagePath);
    const fileUrl = urlData?.publicUrl || '';

    const { error: insertError } = await (supabase as any).from('file_uploads').insert({
      file_name: fileName,
      file_url: fileUrl,
      file_type: 'application/pdf',
      file_size: blob.size,
      storage_path: storagePath,
      category: input.category,
      patient_id: input.patientId,
      patient_name: input.patientName,
      notes: input.notes ?? null,
    });
    if (insertError) throw insertError;
    return true;
  } catch (error) {
    console.error('Failed to publish generated patient report:', error);
    return false;
  }
}
