import { supabase } from '@/integrations/supabase/client';

// The invoice a consultant, anesthetist or OT assistant "gives" the hospital
// — except none of them ever hands one in, so the system raises it on their
// behalf from the approved bill: who is billing, which patient and surgery,
// the fee decided beforehand, and the surgery's date and time. Payments are
// then searched and mapped against these invoice numbers.

const money = (v: number) =>
  `Rs. ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const dateLabel = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Fetches the bill (+ its OT context and company) and opens the print window.
 * Throws with a readable message when the bill cannot be found.
 */
export async function printSpecialistInvoice(approvalId: string): Promise<void> {
  const { data: bill, error } = await (supabase as any)
    .from('approval_queue')
    .select('id, invoice_no, party_name, amount, narration, created_at, status, is_paid, company_id, ot_schedule_id, reference_no')
    .eq('id', approvalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!bill) throw new Error('This bill no longer exists');

  let ot: any = null;
  if (bill.ot_schedule_id) {
    const { data } = await (supabase as any)
      .from('ot_schedule')
      .select('surgery_name, scheduled_date, scheduled_time, patients(name), visits(visit_id)')
      .eq('id', bill.ot_schedule_id)
      .maybeSingle();
    ot = data || null;
  }

  let companyName = 'The Hospital';
  if (bill.company_id) {
    const { data } = await (supabase as any)
      .from('companies')
      .select('company_name')
      .eq('id', bill.company_id)
      .maybeSingle();
    if (data?.company_name) companyName = data.company_name;
  }

  const patientName = Array.isArray(ot?.patients) ? ot?.patients[0]?.name : ot?.patients?.name;
  const visitCode = Array.isArray(ot?.visits) ? ot?.visits[0]?.visit_id : ot?.visits?.visit_id;
  const surgeryWhen = ot?.scheduled_date
    ? `${dateLabel(ot.scheduled_date)}${ot.scheduled_time ? ` at ${String(ot.scheduled_time).slice(0, 5)}` : ''}`
    : null;

  const win = window.open('', '_blank');
  if (!win) throw new Error('The browser blocked the print window');

  win.document.write(`<!doctype html><html><head><title>Invoice ${bill.invoice_no || ''}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, Helvetica, Arial, sans-serif; color: #1f2937; padding: 40px; }
  .sheet { max-width: 760px; margin: 0 auto; }
  .topbar { height: 6px; background: #16437e; border-radius: 3px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 28px; }
  h1 { font-size: 34px; letter-spacing: 4px; color: #16437e; }
  .meta { text-align: right; font-size: 13px; line-height: 1.7; }
  .meta b { font-size: 15px; }
  .badge { display: inline-block; margin-top: 6px; padding: 2px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .paid { background: #d1fae5; color: #065f46; } .unpaid { background: #fef3c7; color: #92400e; }
  .parties { display: flex; gap: 40px; margin-top: 32px; font-size: 13.5px; line-height: 1.7; }
  .parties .label { font-size: 11px; letter-spacing: 1.5px; color: #6b7280; font-weight: 700; }
  .parties b { font-size: 15px; }
  table { width: 100%; border-collapse: collapse; margin-top: 32px; font-size: 13.5px; }
  th { background: #16437e; color: white; text-align: left; padding: 9px 12px; font-size: 12px; letter-spacing: 1px; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
  .total-row td { border-bottom: none; border-top: 2px solid #16437e; font-weight: 700; font-size: 16px; padding-top: 14px; }
  .detail { margin-top: 26px; font-size: 13px; }
  .detail div { display: flex; padding: 5px 0; border-bottom: 1px dashed #e5e7eb; }
  .detail span:first-child { width: 200px; color: #6b7280; }
  .foot { margin-top: 44px; font-size: 11.5px; color: #6b7280; line-height: 1.7; border-top: 1px solid #e5e7eb; padding-top: 14px; }
  @media print { body { padding: 16px; } }
</style></head><body><div class="sheet">
  <div class="topbar"></div>
  <div class="head">
    <div>
      <h1>INVOICE</h1>
      <span class="badge ${bill.is_paid ? 'paid' : 'unpaid'}">${bill.is_paid ? 'PAID' : 'UNPAID'}</span>
    </div>
    <div class="meta">
      <b>${bill.invoice_no || bill.reference_no || '-'}</b><br/>
      Invoice date: ${dateLabel(bill.created_at)}<br/>
      ${visitCode ? `Visit: ${visitCode}` : ''}
    </div>
  </div>
  <div class="parties">
    <div style="flex:1">
      <div class="label">FROM</div>
      <b>${bill.party_name}</b><br/>
      Consultant / Specialist services
    </div>
    <div style="flex:1">
      <div class="label">BILLED TO</div>
      <b>${companyName}</b><br/>
      Nagpur, Maharashtra
    </div>
  </div>
  <table>
    <thead><tr><th>DESCRIPTION</th><th style="width:160px">AMOUNT</th></tr></thead>
    <tbody>
      <tr>
        <td>Professional fees${ot?.surgery_name ? ` — ${ot.surgery_name}` : bill.narration ? ` — ${bill.narration}` : ''}</td>
        <td>${money(bill.amount)}</td>
      </tr>
      <tr class="total-row"><td>TOTAL</td><td>${money(bill.amount)}</td></tr>
    </tbody>
  </table>
  <div class="detail">
    ${patientName ? `<div><span>Patient</span><span><b>${patientName}</b></span></div>` : ''}
    ${ot?.surgery_name ? `<div><span>Surgery / Procedure</span><span>${ot.surgery_name}</span></div>` : ''}
    ${surgeryWhen ? `<div><span>Date &amp; time of surgery</span><span>${surgeryWhen}</span></div>` : ''}
    <div><span>Fees (decided beforehand)</span><span>${money(bill.amount)}</span></div>
    ${bill.narration ? `<div><span>Notes</span><span>${bill.narration}</span></div>` : ''}
  </div>
  <div class="foot">
    System-generated invoice raised by ${companyName} on behalf of ${bill.party_name}, who provides services
    without issuing an invoice. Payments are mapped against the invoice number above. No signature is required.
  </div>
</div>
<script>window.print();</script>
</body></html>`);
  win.document.close();
}
