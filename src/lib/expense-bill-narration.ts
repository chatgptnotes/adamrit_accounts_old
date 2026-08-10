// The narration written on an expense invoice.
//
// Every invoice should read, months later, as a sentence explaining what was
// bought, for whom and against which procedure — not "bill 4471". The fields
// on the Record Invoice form already carry that; this turns them into prose.
//
// Templates are the floor, not the fallback of last resort: they are
// deterministic, cost nothing and are always available. The model is asked to
// improve on the template, and anything it returns that looks wrong (empty,
// overlong, or inventing a figure that was never entered) is discarded in
// favour of the template. An accounting narration is not a place to let a
// language model be creative unchecked.

import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL_LITE } from '@/lib/gemini';

export interface NarrationFacts {
  partyName?: string | null;
  expenseHead?: string | null;
  categoryName?: string | null;
  billNumber?: string | null;
  billDate?: string | null;
  amount?: number | null;
  patientName?: string | null;
  patientId?: string | null;
  surgeryName?: string | null;
  dateOfProcedure?: string | null;
  dateOfReceivingBill?: string | null;
  dateOfPayment?: string | null;
}

const asDate = (value?: string | null): string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

/**
 * The deterministic narration. Reads as a sentence, names only what was
 * actually entered, and never guesses.
 */
export function templateNarration(f: NarrationFacts): string {
  const what = f.categoryName?.trim() || f.expenseHead?.trim() || 'Expense';
  const parts: string[] = [];

  parts.push(f.partyName?.trim() ? `${what} — ${f.partyName.trim()}` : what);

  if (f.billNumber?.trim()) {
    parts.push(`invoice ${f.billNumber.trim()}${asDate(f.billDate) ? ` dated ${asDate(f.billDate)}` : ''}`);
  }

  if (f.patientName?.trim()) {
    const who = f.patientId?.trim()
      ? `${f.patientName.trim()} (${f.patientId.trim()})`
      : f.patientName.trim();
    parts.push(
      f.surgeryName?.trim()
        ? `for ${who} — ${f.surgeryName.trim()}`
        : `for ${who}`,
    );
  } else if (f.surgeryName?.trim()) {
    parts.push(`for ${f.surgeryName.trim()}`);
  }

  if (asDate(f.dateOfProcedure)) parts.push(`procedure on ${asDate(f.dateOfProcedure)}`);
  if (asDate(f.dateOfReceivingBill)) parts.push(`bill received ${asDate(f.dateOfReceivingBill)}`);
  if (asDate(f.dateOfPayment)) parts.push(`payable ${asDate(f.dateOfPayment)}`);

  return parts.join(', ').replace(/\s+/g, ' ').trim();
}

/** Digits in the text that are not any figure or date we supplied. */
function inventsNumbers(text: string, f: NarrationFacts): boolean {
  const allowed = new Set<string>();
  const add = (v?: string | null) => {
    if (!v) return;
    for (const n of String(v).match(/\d+/g) ?? []) allowed.add(n);
  };
  add(f.billNumber);
  add(f.patientId);
  add(f.amount != null ? String(Math.round(f.amount)) : null);
  add(f.billDate); add(f.dateOfProcedure); add(f.dateOfReceivingBill); add(f.dateOfPayment);
  // Month names carry a year; allow any 4-digit year we already mention.
  for (const d of [f.billDate, f.dateOfProcedure, f.dateOfReceivingBill, f.dateOfPayment]) {
    if (d) add(asDate(d));
  }
  return (text.match(/\d+/g) ?? []).some((n) => !allowed.has(n));
}

/**
 * Ask the model to write the narration, falling back to the template whenever
 * the answer is missing, oversized, or contains a number nobody entered.
 */
export async function generateNarration(f: NarrationFacts): Promise<{ text: string; source: 'ai' | 'template' }> {
  const fallback = templateNarration(f);
  const supplied = Object.entries({
    Vendor: f.partyName,
    'Expense head': f.expenseHead,
    Category: f.categoryName,
    'Invoice number': f.billNumber,
    'Invoice date': asDate(f.billDate),
    Amount: f.amount != null ? `Rs ${Math.round(f.amount)}` : '',
    Patient: f.patientName,
    'Patient ID': f.patientId,
    Surgery: f.surgeryName,
    'Date of procedure': asDate(f.dateOfProcedure),
    'Bill received on': asDate(f.dateOfReceivingBill),
    'Payable on': asDate(f.dateOfPayment),
  }).filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}: ${v}`).join('\n');

  if (!supplied) return { text: fallback, source: 'template' };

  try {
    const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text:
              'Write the narration line for an Indian hospital accounting voucher, recording a supplier '
              + 'invoice. One sentence, under 200 characters, plain English, no invented facts, no currency '
              + 'symbol other than Rs, no bullet points, no quotes. Use ONLY these details:\n\n'
              + `${supplied}\n\n`
              + `For reference, a mechanical version reads: "${fallback}". Improve on it if you can; `
              + 'return only the narration text.',
          }],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
      }),
    });
    const data = await response.json();
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ');
    if (!text || text.length < 10 || text.length > 300 || inventsNumbers(text, f)) {
      return { text: fallback, source: 'template' };
    }
    return { text, source: 'ai' };
  } catch {
    return { text: fallback, source: 'template' };
  }
}
