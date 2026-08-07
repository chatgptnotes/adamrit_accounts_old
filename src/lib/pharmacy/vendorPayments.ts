import { supabase } from '@/integrations/supabase/client';
import { fetchLedgerQr, saveLedgerQr } from '@/lib/expense-bills/paymentEvidence';
import {
  uploadVoucherAttachments,
  VOUCHER_PAYMENT_PROOF_CATEGORY,
} from '@/lib/voucher-attachments';

// Paying a vendor's bill, shared by the desktop Purchase Order page and
// Lalit's tablet tile so the two cannot drift.
//
// Receiving the goods already posted the liability (Dr Medicine Purchase / Cr
// the supplier, by trg_grn_supplier_bill). Paying is the other half, and
// post_grn_vendor_payment writes it: Dr the supplier, Cr Cash or Canara Bank.
// Paying twice returns the voucher already raised rather than posting another.

export const VENDOR_PAYMENT_MODES = ['CASH', 'UPI', 'NEFT', 'CHEQUE'] as const;
export type VendorPaymentMode = (typeof VENDOR_PAYMENT_MODES)[number];

export interface VendorPaymentResult {
  posted: boolean;
  voucherNumber: string | null;
  reason: string | null;
}

/** The vendor's QR, held against its creditor ledger. */
export async function fetchVendorQr(ledgerId: string | null | undefined): Promise<string | null> {
  if (!ledgerId) return null;
  try {
    const qr = await fetchLedgerQr(ledgerId);
    return qr?.qrUrl ?? null;
  } catch {
    return null;
  }
}

/** Set (or replace) the QR held for this vendor. */
export async function saveVendorQr(
  ledgerId: string,
  file: File,
  updatedBy?: string | null,
): Promise<string> {
  return saveLedgerQr(ledgerId, file, updatedBy ?? null);
}

/** Post the payment voucher for a GRN's bill. */
export async function payGrnBill(input: {
  grnId: string;
  mode: VendorPaymentMode | string;
  amount: number;
  reference?: string | null;
  user?: string | null;
}): Promise<VendorPaymentResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Enter the amount paid');
  }
  const { data, error } = await (supabase as any).rpc('post_grn_vendor_payment', {
    p_grn_id: input.grnId,
    p_mode: input.mode,
    p_amount: input.amount,
    p_reference: input.reference || null,
    p_user: input.user || null,
  });
  if (error) throw new Error(error.message);
  return {
    posted: Boolean(data?.posted),
    voucherNumber: data?.voucher_number ?? null,
    reason: data?.reason ?? (data?.already ? `Already paid — voucher ${data?.voucher_number}` : null),
  };
}

/** The bank / UPI confirmation, stored on the GRN it paid. */
export async function saveGrnPaymentProof(grnId: string, file: File): Promise<string> {
  const [uploaded] = await uploadVoucherAttachments([file], VOUCHER_PAYMENT_PROOF_CATEGORY);
  const { error } = await (supabase as any)
    .from('goods_received_notes')
    .update({
      payment_proof_path: uploaded.storagePath,
      payment_proof_url: uploaded.fileUrl,
    })
    .eq('id', grnId);
  if (error) throw new Error(error.message);
  return uploaded.fileUrl;
}

/** The supplier's creditor ledger, for the QR held against it. */
export async function fetchSupplierLedgerId(supplierId: number | null | undefined): Promise<string | null> {
  if (!supplierId) return null;
  const { data } = await (supabase as any)
    .from('suppliers')
    .select('ledger_account_id')
    .eq('id', supplierId)
    .maybeSingle();
  return data?.ledger_account_id ?? null;
}
