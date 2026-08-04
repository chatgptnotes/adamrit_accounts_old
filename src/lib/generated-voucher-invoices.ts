import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { printSpecialistInvoice } from '@/lib/printSpecialistInvoice';

/**
 * The invoice behind a voucher that the SYSTEM generated — as opposed to one
 * somebody uploaded (those live in file_uploads and show through the existing
 * attachment viewer).
 *
 * Two sources cover every auto-posted JV and payment:
 *  - expense_bills: the accrual JV carries the bill's row id as its
 *    reference_number, and payments carry the bill number — either way the
 *    bill's stored invoice document (and the signed cash voucher, if any) is
 *    the evidence. This includes the M.L. Enterprises referral invoices.
 *  - approval_queue: specialist / OT / referral bills link their vouchers via
 *    jv_voucher_id / payment_voucher_id, and the invoice is printed on demand
 *    from the bill's own data.
 */

export interface GeneratedInvoiceRef {
  label: string;
  /** A directly viewable document, when one is stored. */
  url: string | null;
  /** The signed cash-payment voucher stored beside the invoice, if any. */
  signedVoucherUrl: string | null;
  /** approval_queue id whose invoice is printed on demand (when url is null). */
  approvalId: string | null;
}

export const openGeneratedInvoice = async (ref: GeneratedInvoiceRef): Promise<void> => {
  if (ref.url) {
    window.open(ref.url, '_blank', 'noopener');
    return;
  }
  if (ref.approvalId) await printSpecialistInvoice(ref.approvalId);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** .in() over many ids without building one enormous request URL. */
async function fetchChunked(table: string, columns: string, column: string, values: string[]): Promise<any[]> {
  const rows: any[] = [];
  for (const part of chunk(values, 150)) {
    const { data, error } = await (supabase as any).from(table).select(columns).in(column, part);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

export function useGeneratedInvoiceMap(
  vouchers: Array<{ id: string; referenceNumber: string | null }>,
) {
  const key = vouchers.map((v) => v.id).sort().join('|');
  return useQuery({
    queryKey: ['generated-voucher-invoices', key],
    enabled: vouchers.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, GeneratedInvoiceRef>> => {
      const ids = [...new Set(vouchers.map((v) => v.id).filter(Boolean))];
      const refs = [...new Set(
        vouchers.map((v) => (v.referenceNumber || '').trim()).filter(Boolean),
      )];
      const uuidRefs = refs.filter((r) => UUID_RE.test(r));
      const numberRefs = refs.filter((r) => !UUID_RE.test(r));

      const billColumns = 'id, bill_number, document_url, signed_voucher_url';
      const [billsById, billsByNumber, byJv, byPayment] = await Promise.all([
        uuidRefs.length ? fetchChunked('expense_bills', billColumns, 'id', uuidRefs) : [],
        numberRefs.length ? fetchChunked('expense_bills', billColumns, 'bill_number', numberRefs) : [],
        ids.length ? fetchChunked('approval_queue', 'id, invoice_no, reference_no, jv_voucher_id', 'jv_voucher_id', ids) : [],
        ids.length ? fetchChunked('approval_queue', 'id, invoice_no, reference_no, payment_voucher_id', 'payment_voucher_id', ids) : [],
      ]);

      const billByRef = new Map<string, any>();
      for (const bill of billsById) billByRef.set(bill.id, bill);
      for (const bill of billsByNumber) billByRef.set(bill.bill_number, bill);
      const approvalByVoucher = new Map<string, any>();
      for (const approval of byJv) approvalByVoucher.set(approval.jv_voucher_id, approval);
      for (const approval of byPayment) approvalByVoucher.set(approval.payment_voucher_id, approval);

      const map = new Map<string, GeneratedInvoiceRef>();
      for (const voucher of vouchers) {
        const bill = billByRef.get((voucher.referenceNumber || '').trim());
        if (bill?.document_url) {
          map.set(voucher.id, {
            label: `Invoice ${bill.bill_number}`,
            url: bill.document_url,
            signedVoucherUrl: bill.signed_voucher_url ?? null,
            approvalId: null,
          });
          continue;
        }
        const approval = approvalByVoucher.get(voucher.id);
        if (approval) {
          map.set(voucher.id, {
            label: `Invoice ${approval.invoice_no || approval.reference_no || ''}`.trim(),
            url: null,
            signedVoucherUrl: null,
            approvalId: approval.id,
          });
        }
      }
      return map;
    },
  });
}
