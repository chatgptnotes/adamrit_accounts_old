import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { draftRadiologyReport, formatRadiologyReport } from '@/lib/radiology/aiReport';
import { uploadPatientDocs } from '@/tablet/hooks/usePatientDocs';
import { buildArshiyaSummaryPdfBlob } from '@/tablet/modules/advance/arshiyaSummaryPdf';

// DATA SOURCE: file_uploads (category radiology_investigation) — the images
// the Sonali tile uploads against the patient. The Radiology Dashboard's View
// Image button showed nothing because its handler was an empty stub; the
// images were there all along, under the patient in Documents & Photos.
//
// Approving writes the report back to visit_radiology (findings / impression,
// the columns the dashboard already reads) AND files a letterhead PDF in the
// same Documents & Photos section, so the report sits beside the image it
// was read from.

const RADIOLOGY_CATEGORY = 'radiology_investigation';

/** Marks the filed PDF so a report is never mistaken for another scan. */
const REPORT_NOTE = 'RADIOLOGY_REPORT';

export interface RadiologyImageReportTarget {
  orderId: string;
  patientUuid: string | null;
  patientName: string;
  patientCode: string | null;
  patientAge?: string | number | null;
  patientGender?: string | null;
  visitId: string | null;
  serviceName: string | null;
  findings?: string | null;
  impression?: string | null;
}

interface DocRow {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  created_at: string | null;
  notes: string | null;
}

async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not read the image file');
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    base64: dataUrl.split(',')[1] ?? '',
    mimeType: blob.type || 'image/jpeg',
  };
}

export function RadiologyImageReportDialog({
  target,
  onClose,
}: {
  target: RadiologyImageReportTarget | null;
  onClose: () => void;
}) {
  const { user, hospitalConfig } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');
  const [studyName, setStudyName] = useState<string | null>(null);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [approving, setApproving] = useState(false);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['radiology-patient-images', target?.patientUuid],
    enabled: !!target?.patientUuid,
    queryFn: async (): Promise<DocRow[]> => {
      const { data, error } = await supabase
        .from('file_uploads')
        .select('id, file_name, file_url, file_type, created_at, notes')
        .eq('patient_id', target!.patientUuid!)
        .eq('category', RADIOLOGY_CATEGORY)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as DocRow[];
    },
  });

  // Reports filed here are not scans; keep them out of the image strip.
  const images = useMemo(
    () => docs.filter((d) => d.notes !== REPORT_NOTE && (d.file_type || '').startsWith('image/')),
    [docs],
  );
  const reports = useMemo(() => docs.filter((d) => d.notes === REPORT_NOTE), [docs]);
  const selected = images.find((i) => i.id === selectedId) ?? images[0] ?? null;

  // Any report already written on the order is what the radiologist edits;
  // the AI draft is only offered when the fields are still empty.
  useEffect(() => {
    if (!target) return;
    setFindings(target.findings ?? '');
    setImpression(target.impression ?? '');
    setStudyName(target.serviceName ?? null);
    setAiAssisted(false);
    setSelectedId(null);
  }, [target]);

  const runDraft = async () => {
    if (!selected) return;
    setDrafting(true);
    try {
      const { base64, mimeType } = await urlToBase64(selected.file_url);
      const draft = await draftRadiologyReport(base64, mimeType, {
        studyName: target?.serviceName,
        patientAge: target?.patientAge,
        patientGender: target?.patientGender,
      });
      if (!draft) {
        toast.error('The AI could not read this image. Write the report by hand.');
        return;
      }
      setFindings(
        draft.limitations
          ? `${draft.findings.trim()}\n\nLimitations: ${draft.limitations.trim()}`
          : draft.findings.trim(),
      );
      setImpression(draft.impression.trim());
      if (draft.study) setStudyName(draft.study);
      setAiAssisted(true);
      toast.success(
        draft.confidence === 'low'
          ? 'Draft ready — the AI rated its own confidence LOW. Read it carefully.'
          : 'Draft ready. Review and edit before approving.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draft the report');
    } finally {
      setDrafting(false);
    }
  };

  const approve = async () => {
    if (!target) return;
    if (!findings.trim() || !impression.trim()) {
      toast.error('Both findings and impression are needed before approving.');
      return;
    }
    setApproving(true);
    try {
      const reportText = formatRadiologyReport({
        studyName,
        findings,
        impression,
        aiAssisted,
      });

      // 1. The order carries the report the dashboard already reads.
      const { error: orderError } = await (supabase as any)
        .from('visit_radiology')
        .update({
          findings: findings.trim(),
          impression: impression.trim(),
          status: 'completed',
          completed_date: new Date().toISOString(),
        })
        .eq('id', target.orderId);
      if (orderError) throw new Error(orderError.message);

      // 2. The letterhead PDF, filed beside the image it was read from.
      if (target.patientUuid) {
        const blob = await buildArshiyaSummaryPdfBlob({
          summaryText: reportText,
          withLogo: true,
          hospitalName: hospitalConfig?.name || 'hope',
          patientName: target.patientName,
          patientId: target.patientCode,
          visitNumber: target.visitId,
          registrationId: null,
          portalUrl: `${window.location.origin}/patient-portal`,
          signatory: { name: user?.email || 'Reporting Radiologist' },
        });
        const fileName = `Radiology_Report_${(target.patientCode || target.visitId || 'patient').replace(
          /[^a-zA-Z0-9._-]/g,
          '_',
        )}_${new Date().toISOString().slice(0, 10)}.pdf`;
        await uploadPatientDocs([new File([blob], fileName, { type: 'application/pdf' })], {
          patientId: target.patientUuid,
          patientName: target.patientName,
          category: RADIOLOGY_CATEGORY,
          uploadedBy: user?.id ?? null,
          notes: REPORT_NOTE,
        });
      }

      toast.success('Report approved and filed in the patient’s Documents & Photos.');
      queryClient.invalidateQueries({ queryKey: ['radiology-patient-images'] });
      queryClient.invalidateQueries({ queryKey: ['radiology-orders'] });
      queryClient.invalidateQueries({ queryKey: ['tablet-patient-docs'] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve the report');
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {target?.patientName}
            {target?.serviceName ? ` — ${target.serviceName}` : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Images uploaded against this patient */}
          <div className="space-y-3">
            {!target?.patientUuid ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This order has no patient linked, so their uploaded images cannot be found.
              </p>
            ) : isLoading ? (
              <p className="py-10 text-center text-muted-foreground">Loading images…</p>
            ) : images.length === 0 ? (
              <p className="rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
                No radiology image uploaded for {target.patientName} yet. Upload it from the
                patient’s profile (Radiology Investigation) and it appears here.
              </p>
            ) : (
              <>
                <a href={selected!.file_url} target="_blank" rel="noreferrer">
                  <img
                    src={selected!.file_url}
                    alt={selected!.file_name}
                    className="max-h-[420px] w-full rounded-md border bg-black object-contain"
                  />
                </a>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setSelectedId(image.id)}
                      className={cn(
                        'h-16 w-16 shrink-0 overflow-hidden rounded border',
                        selected?.id === image.id && 'ring-2 ring-primary',
                      )}
                    >
                      <img src={image.file_url} alt={image.file_name} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {images.length} image{images.length === 1 ? '' : 's'} uploaded from the patient’s
                  profile.
                </p>
              </>
            )}

            {reports.length > 0 && (
              <div className="space-y-1 rounded-md border p-2">
                <p className="text-xs font-medium">Reports already filed</p>
                {reports.map((report) => (
                  <a
                    key={report.id}
                    href={report.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {report.file_name}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* The report the radiologist approves */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              disabled={!selected || drafting}
              onClick={() => void runDraft()}
            >
              {drafting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {drafting ? 'Reading the image…' : 'Draft report with AI'}
            </Button>
            <p className="text-xs text-muted-foreground">
              A draft, not a report. It is filed only after you have read it against the image,
              corrected it, and approved it.
            </p>

            <div>
              <Label htmlFor="rad-findings">Findings</Label>
              <Textarea
                id="rad-findings"
                rows={10}
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                placeholder="Systematic observations…"
              />
            </div>
            <div>
              <Label htmlFor="rad-impression">Impression</Label>
              <Textarea
                id="rad-impression"
                rows={5}
                value={impression}
                onChange={(e) => setImpression(e.target.value)}
                placeholder="Conclusion…"
              />
            </div>

            <Button
              className="w-full"
              disabled={approving || !findings.trim() || !impression.trim()}
              onClick={() => void approve()}
            >
              {approving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Approve and file the report
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
