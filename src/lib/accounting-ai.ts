import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL, GEMINI_MODEL_LITE } from '@/lib/gemini';

/**
 * AI helpers for the accounting automations. Everything routes through the
 * existing ai-proxy edge function via geminiFetch — same rail as the
 * discharge-summary generator, no new keys.
 */

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function aiJson<T>(parts: Part[], model = GEMINI_MODEL_LITE): Promise<T | null> {
  try {
    const response = await geminiFetch(geminiGenerateContentUrl('', model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface InvoiceExtraction {
  party_name: string | null;
  bill_number: string | null;
  bill_date: string | null;
  amount: number | null;
  description: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/** Feature 2: read a photographed vendor invoice into a draft bill. */
export async function extractInvoiceFromImage(
  base64: string,
  mimeType: string,
): Promise<InvoiceExtraction | null> {
  return aiJson<InvoiceExtraction>(
    [
      {
        text:
          'Read this Indian vendor invoice/bill image. Return ONLY JSON: ' +
          '{"party_name": string|null (the seller/vendor), "bill_number": string|null, ' +
          '"bill_date": "YYYY-MM-DD"|null, "amount": number|null (grand total in rupees), ' +
          '"description": string|null (what was supplied, max 8 words), ' +
          '"confidence": "high"|"medium"|"low"}. Use null when unreadable; never guess amounts.',
      },
      { inline_data: { mime_type: mimeType, data: base64 } },
    ],
    GEMINI_MODEL,
  );
}

export interface ProofVerification {
  amount_seen: number | null;
  payee_seen: string | null;
  matches: boolean;
  note: string;
}

/** Feature 3: does a payment screenshot match the voucher it proves? */
export async function verifyPaymentProof(
  base64: string,
  mimeType: string,
  expectedAmount: number,
  expectedPayee: string,
): Promise<ProofVerification | null> {
  return aiJson<ProofVerification>(
    [
      {
        text:
          'This is a payment screenshot (UPI/bank) uploaded as proof. Expected: ' +
          `Rs ${expectedAmount} paid to "${expectedPayee}". Return ONLY JSON: ` +
          '{"amount_seen": number|null, "payee_seen": string|null, ' +
          '"matches": boolean (true only if the visible amount equals the expected amount), ' +
          '"note": string (one short sentence, e.g. mismatch details)}.',
      },
      { inline_data: { mime_type: mimeType, data: base64 } },
    ],
    GEMINI_MODEL,
  );
}

export interface LedgerSuggestion {
  ledger: string | null;
  narration_ok: boolean;
  narration_advice: string | null;
}

/** Feature 4: suggest the expense ledger and critique a vague narration. */
export async function suggestExpenseLedger(
  narration: string,
  partyName: string,
  ledgerNames: string[],
): Promise<LedgerSuggestion | null> {
  return aiJson<LedgerSuggestion>([
    {
      text:
        `A hospital expense bill: paid to "${partyName}", narration "${narration}". ` +
        `Available expense ledgers: ${ledgerNames.join('; ')}. Return ONLY JSON: ` +
        '{"ledger": the single best ledger name from the list or null, ' +
        '"narration_ok": boolean (false if the narration does not say WHAT the payment was for), ' +
        '"narration_advice": string|null (what to add, max 12 words)}.',
    },
  ]);
}

/** Feature 5: three-sentence plain-language briefing of a day's books. */
export async function dailyBooksBriefing(stats: {
  date: string;
  receipts: { count: number; total: number };
  payments: { count: number; total: number };
  journals: { count: number; total: number };
  manualCount: number;
  openAnomalies: number;
}): Promise<string | null> {
  const result = await aiJson<{ briefing: string }>([
    {
      text:
        'You brief a hospital director on one day of accounting. Data: ' +
        JSON.stringify(stats) +
        '. Return ONLY JSON {"briefing": string} — exactly 3 short sentences, plain language, ' +
        'amounts as Rs X,XX,XXX, mention manual entries and open anomalies only if nonzero.',
    },
  ]);
  return result?.briefing ?? null;
}

/** Feature 1 (narrative layer): one-line explanations for anomaly findings. */
export async function explainAnomalies(
  findings: { kind: string; detail: string; amount: number }[],
): Promise<string | null> {
  if (findings.length === 0) return null;
  const result = await aiJson<{ summary: string }>([
    {
      text:
        'Accounting anomalies found today in a hospital: ' +
        JSON.stringify(findings.slice(0, 10)) +
        '. Return ONLY JSON {"summary": string} — max 2 sentences telling the director ' +
        'what to check first and why.',
    },
  ]);
  return result?.summary ?? null;
}

export async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mimeType: file.type || 'image/jpeg' };
}
