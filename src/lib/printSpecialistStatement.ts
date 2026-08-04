import { supabase } from '@/integrations/supabase/client';
import type { SurgeryInvoiceRow } from '@/lib/approval-queue-service';

/**
 * One person's complete OT-fee statement for a period — every invoice of a
 * surgeon / anesthetist / assistant across BOTH hospitals on one printable
 * page: patient, surgery, invoice, JV and payment voucher numbers, amount and
 * status, with billed / paid / outstanding totals.
 */

const money = (v: number) =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const dateLabel = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function printSpecialistStatement(input: {
  name: string;
  fromDate: string;
  toDate: string;
  rows: SurgeryInvoiceRow[];
}): Promise<void> {
  const { name, fromDate, toDate, rows } = input;
  if (!rows.length) throw new Error('No invoices in this period');

  // Voucher numbers and company names, so the statement reads like the books.
  const voucherIds = [...new Set(
    rows.flatMap((r) => [r.jv_voucher_id, r.payment_voucher_id]).filter(Boolean) as string[],
  )];
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean) as string[])];
  const [vouchersRes, companiesRes] = await Promise.all([
    voucherIds.length
      ? (supabase as any).from('vouchers').select('id, voucher_number').in('id', voucherIds)
      : Promise.resolve({ data: [] }),
    companyIds.length
      ? (supabase as any).from('companies').select('id, company_name').in('id', companyIds)
      : Promise.resolve({ data: [] }),
  ]);
  const voucherNo = new Map<string, string>(
    ((vouchersRes.data || []) as any[]).map((v) => [v.id, v.voucher_number]),
  );
  const companyName = new Map<string, string>(
    ((companiesRes.data || []) as any[]).map((c) => [c.id, c.company_name]),
  );

  const sorted = [...rows].sort((a, b) =>
    (a.surgery_date || a.created_at || '').localeCompare(b.surgery_date || b.created_at || ''),
  );
  const billed = sorted.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const paid = sorted
    .filter((r) => r.is_paid)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const bodyRows = sorted
    .map((r, i) => {
      const status = r.status === 'REJECTED' ? 'Rejected' : r.is_paid ? 'Paid' : r.status === 'APPROVED' ? 'Approved' : 'Pending';
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(dateLabel(r.surgery_date || (r.created_at || '').slice(0, 10)))}</td>
        <td>${esc(r.company_id ? companyName.get(r.company_id) || '-' : '-')}</td>
        <td>${esc(r.patient_name || '-')}</td>
        <td>${esc(r.surgery_name || r.narration || '-')}</td>
        <td class="mono">${esc((r as any).invoice_no || r.reference_no || '-')}</td>
        <td class="mono">${esc(r.jv_voucher_id ? voucherNo.get(r.jv_voucher_id) || '-' : '-')}</td>
        <td class="mono">${esc(r.payment_voucher_id ? voucherNo.get(r.payment_voucher_id) || '-' : '-')}</td>
        <td class="right mono">${money(Number(r.amount))}</td>
        <td class="status-${status.toLowerCase()}">${status}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Statement - ${esc(name)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0; text-align: center; }
  .sub { text-align: center; color: #555; font-size: 11px; margin: 4px 0 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; text-align: left; padding: 6px; border-bottom: 2px solid #111; font-size: 10px; text-transform: uppercase; }
  th.right, td.right { text-align: right; }
  td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  td.num { color: #666; width: 24px; }
  td.mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
  .status-paid { color: #047857; font-weight: 600; }
  .status-approved { color: #1d4ed8; font-weight: 600; }
  .status-pending { color: #b45309; font-weight: 600; }
  .totals { margin-top: 14px; margin-left: auto; width: 300px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 6px; }
  .totals .grand { border-top: 2px solid #111; font-weight: 700; }
  .foot { margin-top: 20px; text-align: center; color: #888; font-size: 9px; border-top: 1px solid #ddd; padding-top: 8px; }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { body { margin: 0; } tr { page-break-inside: avoid; } }
</style></head>
<body>
  <h1>Specialist Statement - ${esc(name)}</h1>
  <div class="sub">All hospitals - ${esc(dateLabel(fromDate))} to ${esc(dateLabel(toDate))} - ${sorted.length} case(s)</div>
  <table>
    <thead><tr>
      <th>#</th><th>Date</th><th>Company</th><th>Patient</th><th>Surgery / Narration</th>
      <th>Invoice</th><th>JV</th><th>Payment</th><th class="right">Amount (Rs)</th><th>Status</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="totals">
    <div><span>Billed</span><span>Rs ${money(billed)}</span></div>
    <div><span>Paid</span><span>Rs ${money(paid)}</span></div>
    <div class="grand"><span>Outstanding</span><span>Rs ${money(billed - paid)}</span></div>
  </div>
  <div class="foot">Generated ${esc(new Date().toLocaleString('en-IN'))} - Adamrit Specialist Payouts</div>
</body></html>`;

  const win = window.open('', '_blank', 'width=1100,height=760');
  if (!win) throw new Error('Pop-up blocked. Allow pop-ups for this site to print.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.onload = () => {
    win.focus();
    win.print();
  };
}
