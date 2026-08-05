import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';

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
  const letterhead = input.letterheadUrl ? await loadImageDataUrl(input.letterheadUrl) : null;
  const letterheadTop = letterhead ? 154 : 48;
  const letterheadBottom = letterhead ? 720 : pageHeight - 56;
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

  const renderClinicNotes = () => {
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(input.title, pageWidth / 2, y, { align: 'center' });
    y += 18;

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

    y += 8;
    y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, 90);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text('Clinic note', marginX, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = input.sections.flatMap((section) => section.lines);
    const safeLines = lines.length > 0 ? lines : ['-'];
    for (const line of safeLines) {
      y = addPageIfNeeded(doc, y, paintLetterhead, letterheadTop, 90);
      const wrapped = wrapLines(doc, `• ${line}`, contentWidth);
      doc.text(wrapped, marginX, y);
      y += Math.max(14, wrapped.length * 13);
    }
  };

  if (input.category === 'clinic_notes' && letterhead) {
    renderClinicNotes();
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(input.title, marginX, y);
    y += 22;

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

  const footer = 'Generated automatically by Adamrit HMIS';
  const footerY = doc.internal.pageSize.getHeight() - 32;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text(footer, marginX, footerY);

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
