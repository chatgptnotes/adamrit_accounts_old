import { supabase } from '@/integrations/supabase/client';
import {
  uploadVoucherAttachments,
  discardVoucherAttachments,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
} from '@/lib/voucher-attachments';
import { fetchLedgerQr, saveLedgerQr } from '@/lib/expense-bills/paymentEvidence';

// DATA SOURCE: ledger_payment_qr (the pharmacy's own receiving QR, held against
// its Canara Bank ledger) and pharmacy_sales.payment_proof_path / _url.
//
// The patient scans the pharmacy's code; the expense-bill register scans the
// payee's. Same table, opposite direction of money — so the QR helpers are
// shared and only the ledger differs.

const PHARMACY_COMPANY_KEY = 'hope_pharmacy';
const PHARMACY_RECEIVING_LEDGER = 'Canara Bank';

/** The pharmacy's Canara Bank ledger — where non-cash counter takings land. */
export async function fetchPharmacyReceivingLedgerId(): Promise<string | null> {
  const { data: company } = await (supabase as any)
    .from('companies')
    .select('id')
    .eq('company_key', PHARMACY_COMPANY_KEY)
    .maybeSingle();
  if (!company?.id) return null;

  const { data: ledger } = await (supabase as any)
    .from('chart_of_accounts')
    .select('id')
    .eq('company_id', company.id)
    .eq('account_name', PHARMACY_RECEIVING_LEDGER)
    .eq('is_active', true)
    .maybeSingle();
  return ledger?.id ?? null;
}

/** The QR the patient scans, or null when nobody has uploaded one yet. */
export async function fetchPharmacyReceivingQr(): Promise<{ ledgerId: string; qrUrl: string | null } | null> {
  const ledgerId = await fetchPharmacyReceivingLedgerId();
  if (!ledgerId) return null;
  const qr = await fetchLedgerQr(ledgerId);
  return { ledgerId, qrUrl: qr?.qrUrl ?? null };
}

/** Set (or replace) the pharmacy's own receiving QR. */
export async function savePharmacyReceivingQr(file: File, updatedBy?: string | null): Promise<string> {
  const ledgerId = await fetchPharmacyReceivingLedgerId();
  if (!ledgerId) throw new Error('The pharmacy Canara Bank ledger is missing — cannot hold a QR against it');
  return saveLedgerQr(ledgerId, file, updatedBy ?? null);
}

/** The bank / UPI confirmation for one pharmacy bill. */
export async function savePharmacySalePaymentProof(
  saleId: number | string,
  file: File,
  uploadedBy?: string | null,
): Promise<string> {
  const [uploaded] = await uploadVoucherAttachments([file], VOUCHER_PAYMENT_PROOF_CATEGORY);
  try {
    const { error } = await (supabase as any)
      .from('pharmacy_sales')
      .update({
        payment_proof_path: uploaded.storagePath,
        payment_proof_url: uploaded.fileUrl,
        payment_proof_at: new Date().toISOString(),
        payment_proof_by: uploadedBy ?? null,
      })
      .eq('sale_id', saleId);
    if (error) throw new Error(error.message);
    return uploaded.fileUrl;
  } catch (error) {
    // A failed write must not leave an orphan file behind.
    await discardVoucherAttachments([uploaded]);
    throw error;
  }
}

/** The voucher a pharmacy bill produced — 'INV' for the JV, 'REC' for the receipt. */
export async function fetchPharmacySaleVoucher(
  saleId: number | string,
  kind: 'INV' | 'REC',
): Promise<string | null> {
  const { data } = await (supabase as any)
    .from('vouchers')
    .select('voucher_number')
    .eq('reference_number', `PHARMACY-${kind}-${saleId}`)
    .neq('status', 'CANCELLED')
    .maybeSingle();
  return data?.voucher_number ?? null;
}
