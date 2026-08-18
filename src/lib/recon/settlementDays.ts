/**
 * Date-wise settlement totals for a payment phone, and the paperwork filed
 * against each day.
 *
 * The totals are DERIVED from recon_transactions every time rather than stored.
 * A stored daily total becomes a second copy of the truth the first time a
 * screenshot is re-read or a duplicate is dropped, and then two screens
 * disagree about the day's takings.
 */

import { supabase } from '@/integrations/supabase/client';

const DOC_BUCKET = 'uploads';
/** Same ceiling as the handover photographs, for the same reason: a phone
 *  photograph of a slip is comfortably under this, a video is not. */
const MAX_DOC_SIZE = 12 * 1024 * 1024;

export interface SettlementDay {
  settlementDate: string;
  txnCount: number;
  moneyIn: number;
  moneyOut: number;
  /** In minus out. Shown beside both sides, never instead of them. */
  netTotal: number;
  docCount: number;
}

export interface SettlementDoc {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
}

/** Every day this phone took money, newest first. */
export async function fetchSettlementDays(sourceId: string): Promise<SettlementDay[]> {
  const { data, error } = await (supabase as any)
    .from('v_recon_settlement_days')
    .select('settlement_date, txn_count, money_in, money_out, net_total, doc_count')
    .eq('source_id', sourceId)
    .order('settlement_date', { ascending: false })
    .limit(120);
  // A rejected read must not render as "this phone took no money".
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    settlementDate: String(r.settlement_date),
    txnCount: Number(r.txn_count) || 0,
    moneyIn: Number(r.money_in) || 0,
    moneyOut: Number(r.money_out) || 0,
    netTotal: Number(r.net_total) || 0,
    docCount: Number(r.doc_count) || 0,
  }));
}

/** The documents filed against one settlement day, oldest first. */
export async function fetchSettlementDocs(
  sourceId: string,
  settlementDate: string,
): Promise<SettlementDoc[]> {
  const { data, error } = await (supabase as any)
    .from('recon_settlement_docs')
    .select('id, file_name, file_url, file_type, uploaded_by, created_at')
    .eq('source_id', sourceId)
    .eq('settlement_date', settlementDate)
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    fileName: r.file_name ?? 'document',
    fileUrl: r.file_url ?? '',
    fileType: r.file_type ?? null,
    uploadedBy: r.uploaded_by ?? null,
    uploadedAt: r.created_at ?? null,
  }));
}

/**
 * Attach documents to a settlement day.
 *
 * Each file is attempted on its own, so one unreadable photo out of four does
 * not throw the other three away, and the caller is told exactly which failed.
 * The storage object is removed again if the row cannot be written — an orphan
 * file nobody can see is worse than a clean failure.
 */
export async function uploadSettlementDocs(input: {
  sourceId: string;
  settlementDate: string;
  files: File[];
  uploadedBy: string | null;
  note?: string | null;
}): Promise<{ saved: number; failed: string[] }> {
  const failed: string[] = [];
  let saved = 0;

  for (const file of input.files) {
    if (file.size > MAX_DOC_SIZE) {
      failed.push(`${file.name} is ${Math.round(file.size / (1024 * 1024))} MB — the limit is 12 MB`);
      continue;
    }
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
    const path = `settlement-docs/${input.sourceId}/${input.settlementDate}/${Date.now()}-${safe}`;

    const { error: upErr } = await supabase.storage
      .from(DOC_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) {
      failed.push(`${file.name}: ${upErr.message}`);
      continue;
    }

    const { data: urlData } = supabase.storage.from(DOC_BUCKET).getPublicUrl(path);

    const { error: rowErr } = await (supabase as any).from('recon_settlement_docs').insert({
      source_id: input.sourceId,
      settlement_date: input.settlementDate,
      file_name: file.name,
      file_path: path,
      file_url: urlData?.publicUrl ?? null,
      file_type: file.type || null,
      file_size: file.size,
      note: input.note ?? null,
      uploaded_by: input.uploadedBy,
    });
    if (rowErr) {
      // Never leave a file in storage that no screen can reach.
      await supabase.storage.from(DOC_BUCKET).remove([path]);
      failed.push(`${file.name}: ${rowErr.message}`);
      continue;
    }
    saved += 1;
  }

  return { saved, failed };
}

/** "18 Aug 2026" — the phone's own date, not a timestamp in another zone. */
export function settlementDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
