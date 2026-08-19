import { supabase } from '@/integrations/supabase/client';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL } from '@/lib/gemini';
import { fileToBase64 } from '@/lib/accounting-ai';
import { uploadVoucherAttachments, VOUCHER_PAYMENT_PROOF_CATEGORY } from '@/lib/voucher-attachments';

// Reads a PhonePe history screenshot or a bank statement into transaction
// lines, on the same ai-proxy rail as the invoice scanner — no new keys.
//
// The reading is deliberately literal: whatever the screen says, nothing
// inferred. A line the model is unsure of is better dropped than invented,
// because every line here ends up either matched against a bill or raised as
// an exception to the management.

export interface ScannedTxn {
  txn_date: string | null;      // yyyy-mm-dd
  txn_time: string | null;      // as printed
  direction: 'DEBIT' | 'CREDIT';
  amount: number | null;
  counterparty: string | null;
  reference: string | null;     // UTR / transaction id
  raw_line: string | null;
}

const PROMPT = `You are reading a payment statement: either a PhonePe transaction
history screenshot or a bank statement.

Return JSON: { "transactions": [ { "txn_date": "yyyy-mm-dd", "txn_time": "as
printed or null", "direction": "DEBIT" or "CREDIT", "amount": number,
"counterparty": "who was paid or who paid, as printed", "reference": "UTR or
transaction id if visible, else null", "raw_line": "the line as it reads" } ] }

Rules:
- DEBIT is money leaving the account ("Paid to", "Debited", withdrawal).
  CREDIT is money coming in ("Received from", "Credited", deposit).
- amount is a plain number, no currency symbol or commas.
- If the year is not printed, use the current year.
- Read every visible row. Do not invent rows, and do not guess an amount or a
  date you cannot see — leave the field null instead.`;

/**
 * How much the model may write back.
 *
 * A PhonePe screenshot is a dozen rows; a month of a bank statement is
 * hundreds, and each row costs roughly sixty tokens of JSON. With no limit set
 * the model stopped at its default and the reply was cut off mid-string, which
 * arrived at the cashier as "Unterminated string in JSON at position 6879 (line
 * 172 column 64)" -- the raw parser message for a statement that had been read
 * correctly as far as line 172 and then guillotined (Dr M, 19 Aug).
 *
 * 65,536 is the output ceiling for gemini-2.5-flash, so this asks for all of it
 * -- around a thousand rows. It costs nothing when the answer is short.
 */
const MAX_OUTPUT_TOKENS = 65536;

/** Read one screenshot or statement page into transaction lines. */
export async function scanStatement(file: File): Promise<ScannedTxn[]> {
  const { base64, mimeType } = await fileToBase64(file);
  const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    }),
  });
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error('The statement could not be read — try a clearer screenshot');

  // Ask WHY it stopped before trusting what it said. A reply that ran out of
  // room is not a reply with a few rows missing -- it ends mid-word, and the
  // only honest thing is to refuse it. Keeping the rows that did parse would
  // report "412 lines read" for a statement that has 600 and reconcile the
  // month against two thirds of it, which is worse than not importing at all.
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    if (candidate.finishReason === 'MAX_TOKENS') {
      throw new Error(
        'The statement is too long to read in one go — upload it a page at a time, '
        + 'or split the month into two files. Nothing has been imported.',
      );
    }
    throw new Error(
      `The statement could not be read (${candidate.finishReason}). Nothing has been imported.`,
    );
  }

  let parsed: { transactions?: ScannedTxn[] };
  try {
    // responseMimeType should rule fences out, but a fenced reply has been seen
    // on this rail before and costs one line to survive.
    parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')) as {
      transactions?: ScannedTxn[];
    };
  } catch {
    // Never surface a parser message to a cashier: "Unterminated string in JSON
    // at position 6879" tells them nothing they can act on.
    throw new Error(
      'The statement came back unreadable — try a clearer scan, or upload it a page '
      + 'at a time. Nothing has been imported.',
    );
  }
  return (parsed.transactions || []).filter((t) => Number(t.amount) > 0 && t.txn_date);
}

export interface ImportResult {
  uploadId: string;
  read: number;
  saved: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  unmatchedValue: number;
}

/**
 * Upload the image, read it, save the lines, then match them against the
 * payment vouchers the books already carry. Lines already seen (same UTR, or
 * same phone + date + amount + payee) are skipped rather than duplicated, so
 * re-uploading the same screenshot is harmless.
 */
export async function importStatement(input: {
  sourceId: string;
  file: File;
  note?: string | null;
  uploadedBy?: string | null;
}): Promise<ImportResult> {
  const rows = await scanStatement(input.file);

  const [uploaded] = await uploadVoucherAttachments([input.file], VOUCHER_PAYMENT_PROOF_CATEGORY);
  const dates = rows.map((r) => r.txn_date).filter(Boolean).sort() as string[];

  const { data: upload, error: uploadError } = await (supabase as any)
    .from('recon_uploads')
    .insert({
      source_id: input.sourceId,
      period_start: dates[0] ?? null,
      period_end: dates[dates.length - 1] ?? null,
      file_url: uploaded.fileUrl,
      file_path: uploaded.storagePath,
      note: input.note ?? null,
      uploaded_by: input.uploadedBy ?? null,
    })
    .select('id')
    .single();
  if (uploadError) throw new Error(uploadError.message);

  let saved = 0;
  let duplicates = 0;
  for (const row of rows) {
    const { error } = await (supabase as any).from('recon_transactions').insert({
      upload_id: upload.id,
      source_id: input.sourceId,
      txn_date: row.txn_date,
      txn_time: row.txn_time,
      direction: row.direction === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      amount: row.amount,
      counterparty: row.counterparty,
      reference: row.reference,
      raw_line: row.raw_line,
    });
    // 23505 is the duplicate guard doing its job on a re-uploaded screenshot.
    if (!error) saved += 1;
    else if ((error as any).code === '23505') duplicates += 1;
    else throw new Error(error.message);
  }

  const { data: match, error: matchError } = await (supabase as any).rpc('match_recon_transactions', {
    p_upload_id: upload.id,
    p_days: 3,
  });
  if (matchError) throw new Error(matchError.message);

  return {
    uploadId: upload.id,
    read: rows.length,
    saved,
    duplicates,
    matched: match?.matched ?? 0,
    unmatched: match?.unmatched ?? 0,
    unmatchedValue: Number(match?.unmatched_value ?? 0),
  };
}
