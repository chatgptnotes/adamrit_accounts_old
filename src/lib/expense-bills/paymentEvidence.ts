import { supabase } from '@/integrations/supabase/client';
import {
  uploadVoucherAttachments,
  discardVoucherAttachments,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
} from '@/lib/voucher-attachments';

// DATA SOURCE: ledger_payment_qr (one QR per chart_of_accounts row) and
// expense_bills.payment_proof_path / _url. Shared by the desktop Expense Bill
// register and the tablet expense-bills module so both show the same QR and
// write the proof to the same place.

export interface LedgerQr {
  accountId: string;
  qrUrl: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** The payee's QR, or null when nobody has uploaded one for that ledger. */
export async function fetchLedgerQr(accountId: string): Promise<LedgerQr | null> {
  const { data, error } = await (supabase as any)
    .from('ledger_payment_qr')
    .select('account_id, qr_url, updated_by, updated_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    accountId: data.account_id,
    qrUrl: data.qr_url,
    updatedBy: data.updated_by ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

/** Set (or replace) the QR held against a ledger. */
export async function saveLedgerQr(
  accountId: string,
  file: File,
  updatedBy?: string | null,
): Promise<string> {
  const [uploaded] = await uploadVoucherAttachments([file], VOUCHER_PAYMENT_PROOF_CATEGORY);
  try {
    const { error } = await (supabase as any)
      .from('ledger_payment_qr')
      .upsert(
        { account_id: accountId, qr_url: uploaded.fileUrl, updated_by: updatedBy ?? null },
        { onConflict: 'account_id' },
      );
    if (error) throw new Error(error.message);
    return uploaded.fileUrl;
  } catch (error) {
    // A failed write must not leave an orphan file behind.
    await discardVoucherAttachments([uploaded]);
    throw error;
  }
}

/**
 * The PhonePe / UPI confirmation for one bill. Distinct from the signed
 * voucher, which is the signature taken when cash changes hands.
 */
export async function savePaymentProof(billId: string, file: File): Promise<string> {
  const [uploaded] = await uploadVoucherAttachments([file], VOUCHER_PAYMENT_PROOF_CATEGORY);
  try {
    // Through the RPC: expense_bills carries no UPDATE policy, so a direct
    // write from the browser silently matched nothing and the proof was lost.
    const { data, error } = await (supabase as any).rpc('save_expense_bill_payment_proof', {
      p_bill_id: billId,
      p_path: uploaded.storagePath,
      p_url: uploaded.fileUrl,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('The proof was uploaded but not attached to the bill.');
    return uploaded.fileUrl;
  } catch (error) {
    await discardVoucherAttachments([uploaded]);
    throw error;
  }
}
