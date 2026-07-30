import { supabase } from '@/integrations/supabase/client';
import type { DialysisTrackerRow } from './dialysisTracker';

interface LabResultRow {
  test_name: string;
  test_category: string | null;
  result_value: string | null;
  result_unit: string | null;
  reference_range: string | null;
  is_abnormal: boolean | null;
  comments: string | null;
  created_at: string;
  patient_age: number | null;
  patient_gender: string | null;
}

/** Every result from the patient's most recent lab report. */
async function fetchLatestReport(patientUuid: string): Promise<LabResultRow[]> {
  const { data, error } = await supabase
    .from('lab_results')
    .select(
      'test_name, test_category, result_value, result_unit, reference_range, is_abnormal, comments, created_at, patient_age, patient_gender, visits!inner(patient_id)'
    )
    .eq('visits.patient_id', patientUuid)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  const rows = (data ?? []) as unknown as LabResultRow[];
  if (rows.length === 0) return [];
  const newestDay = rows[0].created_at.slice(0, 10);
  return rows.filter((r) => r.created_at.slice(0, 10) === newestDay);
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

function buildHtml(row: DialysisTrackerRow, results: LabResultRow[]): string {
  const reportDay = results[0].created_at.slice(0, 10);
  const age = results.find((r) => r.patient_age != null)?.patient_age;
  const gender = results.find((r) => r.patient_gender)?.patient_gender;

  const grouped = new Map<string, LabResultRow[]>();
  for (const r of results) {
    const category = r.test_category?.trim() || 'Investigations';
    const list = grouped.get(category) ?? [];
    list.push(r);
    grouped.set(category, list);
  }

  const body = Array.from(grouped.entries())
    .map(
      ([category, tests]) => `
        <tr class="category"><td colspan="4">${esc(category)}</td></tr>
        ${tests
          .map(
            (t) => `<tr>
              <td>${esc(t.test_name)}${t.comments ? `<div class="note">${esc(t.comments)}</div>` : ''}</td>
              <td class="c${t.is_abnormal ? ' abnormal' : ''}">${esc(t.result_value) || '-'}</td>
              <td class="c">${esc(t.result_unit) || '-'}</td>
              <td class="c">${esc(t.reference_range) || '-'}</td>
            </tr>`
          )
          .join('')}`
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>Dialysis Lab Report — ${esc(row.patientName)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 13px; margin: 0; }
    .logo-row { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .logo-row img { height: 62px; width: auto; }
    .title { font-size: 19px; font-weight: bold; letter-spacing: .5px; text-align: center; }
    .title small { display: block; font-size: 11px; font-weight: normal; color: #555; letter-spacing: 0; margin-top: 2px; }
    .patient { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin: 14px 0 16px; font-size: 12.5px; }
    .patient .label { color: #555; display: inline-block; min-width: 118px; }
    table.results { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    table.results th { background: #f1f1f1; border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    table.results td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
    table.results td.c { text-align: center; }
    tr.category td { background: #fafafa; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
    .abnormal { color: #b91c1c; font-weight: bold; }
    .note { color: #666; font-size: 11px; margin-top: 2px; }
    .signature { margin-top: 42px; text-align: right; }
    .signature img { width: 150px; height: auto; display: block; margin-left: auto; }
    .signature .line { border-top: 1px solid #111; width: 200px; margin: 2px 0 4px auto; }
    .signature .name { font-weight: bold; font-size: 12.5px; }
    .signature .qual { font-size: 11.5px; color: #555; }
    .footer { margin-top: 26px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 10.5px; color: #777; text-align: center; }
  </style></head><body>
    <div class="logo-row">
      <img src="/left_logo.jpeg" alt="NABH" />
      <div class="title">DIALYSIS LAB REPORT<small>Mandatory 30-day investigation for dialysis patients</small></div>
      <img src="/right_logo.jpeg" alt="Hope Hospitals" />
    </div>

    <div class="patient">
      <div><span class="label">Patient Name</span> <strong>${esc(row.patientName)}</strong></div>
      <div><span class="label">Report Date</span> ${formatDate(reportDay)}</div>
      <div><span class="label">Registration No.</span> ${esc(row.patientsId) || '-'}</div>
      <div><span class="label">Age / Sex</span> ${age != null ? `${age} yrs` : '-'} / ${esc(gender) || '-'}</div>
      <div><span class="label">Dialysis Cycles</span> ${row.totalCycles}</div>
      <div><span class="label">Last Session</span> ${formatDate(row.lastSessionDate)}</div>
    </div>

    <table class="results">
      <thead><tr><th>Test</th><th class="c">Result</th><th class="c">Unit</th><th class="c">Reference Range</th></tr></thead>
      <tbody>${body}</tbody>
    </table>

    <div class="signature">
      <img src="/Arun Agre.jpeg" alt="Signature" />
      <div class="line"></div>
      <div class="name">DR. ARUN AGRE</div>
      <div class="qual">MD (PATHOLOGY)</div>
    </div>

    <div class="footer">Generated ${new Date().toLocaleString('en-IN')} · Hope Hospital</div>
  </body></html>`;
}

/**
 * Open the patient's latest lab report in a print window.
 * Returns an error message when there is nothing to print.
 */
export async function printDialysisLabReport(row: DialysisTrackerRow): Promise<string | null> {
  if (!row.patientUuid) return 'This patient has no linked record, so their lab results cannot be found.';
  const results = await fetchLatestReport(row.patientUuid);
  if (results.length === 0) return 'No lab results have been entered for this patient yet.';

  const w = window.open('', '_blank', 'width=1000,height=800');
  if (!w) return 'Allow pop-ups to print the lab report.';
  w.document.write(buildHtml(row, results));
  w.document.close();
  w.focus();
  w.print();
  return null;
}
