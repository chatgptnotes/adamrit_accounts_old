import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL } from '@/lib/gemini';
import { toast } from '@/hooks/use-toast';

const generateDischargeText = async (record: string) => {
  const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `You are preparing a professional hospital discharge-summary draft for another doctor. Use ONLY the recorded clinical data below. Do not invent diagnoses, symptoms, findings, laboratory values, radiology findings, hospital events, procedures, complications, medicines, medicine brands, doses, or clinician names. Do not include the patient's name, sex, or age. Start with **Diagnosis**, followed immediately by **Discharge Medications** in a Markdown table with Name, Strength, Route, Dosage, and Days. Include the Hindi dosage line only when it is present in the recorded medication instructions. Use clear headings and concise clinical language. Include operative notes only for a procedure explicitly present in the record. Mark unavailable sections as "Not recorded". End with exactly this line: URGENT CARE/ EMERGENCY CARE IS AVAILABLE 24 X 7. PLEASE CONTACT:-7030974619, 9373111709.\n\nRECORDED CLINICAL DATA:\n${record}`,
        }],
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Unable to generate the discharge summary.');
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text?.trim()) throw new Error('The AI returned an empty discharge summary.');
  return text.trim();
};

const QuickDischargeSummary = () => {
  const { visitId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;

    const loadAndGenerate = async () => {
      setLoading(true);
      setError('');
      setSummary('');
      if (!visitId) {
        setError('Visit ID is missing.');
        setLoading(false);
        return;
      }

      try {
        const { data: visit, error: visitError } = await supabase
          .from('visits')
          .select(`
            id, visit_id, admission_date, discharge_date, reason_for_visit, treatment_type, ipd_admission_notes,
            patients!inner(id, hospital_name),
            diagnoses!diagnosis_id(id, name),
            visit_diagnoses(diagnoses(id, name)),
            visit_surgeries(*, cghs_surgery(name, code, category))
          `)
          .eq('visit_id', visitId)
          .single();
        if (visitError || !visit) throw new Error('Visit record was not found.');

        const [savedSummaryResult, labResult, radiologyResult] = await Promise.all([
          supabase
            .from('ipd_discharge_summary')
            .select('*')
            .eq('visit_id', visit.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('lab_results')
            .select('test_name, main_test_name, test_category, result_value, result_unit, created_at')
            .eq('visit_id', visit.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('visit_radiology')
            .select('ordered_date, completed_date, findings, impression, notes, radiology(name, category)')
            .eq('visit_id', visit.id)
            .order('ordered_date', { ascending: false }),
        ]);

        // A missing or restricted ancillary source must not prevent a summary
        // from being created from the rest of the patient's actual record.
        let laboratoryResults = labResult.error ? [] : (labResult.data || []);
        if (laboratoryResults.length === 0) {
          const { data: fallbackLabs, error: fallbackLabsError } = await supabase
            .from('lab_results')
            .select('test_name, main_test_name, test_category, result_value, result_unit, created_at')
            .eq('visit_id', visitId)
            .order('created_at', { ascending: false });
          if (!fallbackLabsError) laboratoryResults = fallbackLabs || [];
        }

        const diagnoses = [
          visit.diagnoses?.name,
          ...(visit.visit_diagnoses || []).map((item: any) => item.diagnoses?.name),
        ].filter(Boolean);
        const clinicalRecord = {
          admission_date: visit.admission_date,
          discharge_date: visit.discharge_date,
          reason_for_visit: visit.reason_for_visit,
          treatment_type: visit.treatment_type,
          diagnoses: [...new Set(diagnoses)],
          admission_notes: visit.ipd_admission_notes,
          recorded_procedures: visit.visit_surgeries || [],
          saved_discharge_summary: !savedSummaryResult.error && savedSummaryResult.data ? {
            primary_diagnosis: savedSummaryResult.data.primary_diagnosis,
            chief_complaints: savedSummaryResult.data.chief_complaints,
            vital_signs: savedSummaryResult.data.vital_signs,
            investigations: savedSummaryResult.data.lab_investigations,
            hospital_stay_notes: savedSummaryResult.data.hospital_stay_notes,
            discharge_advice: savedSummaryResult.data.discharge_advice,
            discharge_medications: savedSummaryResult.data.discharge_medications,
            procedures_performed: savedSummaryResult.data.procedures_performed,
            condition_on_discharge: savedSummaryResult.data.condition_on_discharge,
          } : null,
          laboratory_results: laboratoryResults,
          radiology_results: radiologyResult.error ? [] : (radiologyResult.data || []),
        };

        const generated = await generateDischargeText(JSON.stringify(clinicalRecord, null, 2));
        if (active) setSummary(generated);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to create discharge summary.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadAndGenerate();
    return () => { active = false; };
  }, [visitId, retryToken]);

  const downloadPdf = async () => {
    if (!summary) return;
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const lines = pdf.splitTextToSize(summary.replace(/\*\*/g, ''), 180);
    const lineHeight = 6;
    let y = 18;
    lines.forEach((line: string) => {
      if (y > 280) {
        pdf.addPage();
        y = 18;
      }
      pdf.text(line, 15, y);
      y += lineHeight;
    });
    pdf.save(`Discharge_Summary_${visitId}.pdf`);
    toast({ title: 'PDF downloaded', description: 'The discharge summary has been saved as a PDF.' });
  };

  return (
    <main className="container mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Generated Discharge Summary</h1>
          <p className="text-sm text-muted-foreground">Visit ID: {visitId}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate('/advance-statement-report')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Report
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Discharge Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
              <span>Fetching patient data and generating discharge summary…</span>
            </div>
          )}
          {!loading && error && (
            <div className="space-y-4 rounded-md bg-destructive/10 p-4 text-destructive">
              <p>{error}</p>
              <Button type="button" variant="outline" onClick={() => setRetryToken((value) => value + 1)}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry generation
              </Button>
            </div>
          )}
          {!loading && summary && <article className="whitespace-pre-wrap break-words leading-7">{summary}</article>}
        </CardContent>
      </Card>

      {summary && (
        <div className="flex justify-center pb-8">
          <Button type="button" size="lg" onClick={downloadPdf}>
            <Download className="mr-2 h-5 w-5" /> Download PDF
          </Button>
        </div>
      )}
    </main>
  );
};

export default QuickDischargeSummary;
