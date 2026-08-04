import { supabase } from '@/integrations/supabase/client'
import { amountInWords } from '@/lib/amountInWords'

/**
 * Per-row Daily Revenue Report approval.
 *
 * Approving a cut generates an M.L. Enterprises implant-purchase invoice for
 * that one patient, uploads it as the bill's evidence document, and calls the
 * database function that posts both companies' entries in one transaction:
 *
 *   Hospital:          Dr Implant Purchase / Cr M.L. Enterprises  (expense bill)
 *   M.L. Enterprises:  Dr <hospital> / Cr Sales, and
 *                      Dr Referral Commission / Cr <the manager>
 *
 * Nothing is paid here — the bill lands outstanding on the Expense Bill page.
 */

const VENDOR_NAME = 'M.L. ENTERPRISES'
const VENDOR_ADDRESS = 'B-6, PLOT NO. 3, CHAYA COMPLEX, WATHODA RING ROAD, NAGPUR'
const VENDOR_PHONE = 'TEL. 0712-2715156'
const BUCKET = 'uploads'

const HOSPITAL_ADDRESS: Record<'hope' | 'ayushman', [string, string]> = {
  hope: ['Hope Hospital, 02, Tekanaka, Kamptee Road,', 'Nagpur-440017'],
  ayushman: ['Ayushman Hospital, Ramdas Peth,', 'Nagpur'],
}

export interface ReferralInvoiceInput {
  /** daily_revenue_entries.id of the cut being approved. */
  entryId: string
  patientName: string
  rmName: string
  /** patients.hospital_name / hospital_type — anything mentioning ayushman goes to Ayushman. */
  hospital: string
  amount: number
  /** yyyy-mm-dd, printed on the invoice. */
  entryDate: string
  createdBy?: string
}

export interface ReferralInvoiceResult {
  billId: string
  billNumber: string
  companyKey: string
  salesVoucher: string
  commissionVoucher: string
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

const money = (n: number) => `${n.toLocaleString('en-IN')}/-`

const displayDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB')
}

/** Same layout as the Corporate Bill implant invoice, with one line item. */
export function buildReferralInvoiceHtml(input: {
  billNumber: string
  billDate: string
  patientName: string
  hospital: string
  amount: number
}): string {
  const isAyushman = input.hospital.toLowerCase().includes('ayush')
  const [line1, line2] = HOSPITAL_ADDRESS[isAyushman ? 'ayushman' : 'hope']
  const words = amountInWords(input.amount).replace('Rupees ', '')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Implant Bill - ${escapeHtml(input.billNumber)}</title>
    <style>
      body { margin: 0; background: white; color: #000; font-family: "Times New Roman", serif; }
      .bill-page { width: 190mm; margin: 0 auto; padding: 8mm 0; }
      .title { text-align: center; font-size: 30pt; font-weight: 700; }
      .vendor-address { text-align: center; font-size: 14pt; font-weight: 700; margin-top: 8px; }
      .vendor-phone { text-align: center; font-size: 13pt; font-weight: 700; margin-top: 4px; }
      .top-box { display: grid; grid-template-columns: 1.55fr 1fr; border: 1px solid #000; min-height: 116px; margin-top: 10px; }
      .top-left { border-right: 1px solid #000; padding: 10px 12px; font-size: 15pt; line-height: 1.35; }
      .top-right { padding: 10px 12px; font-size: 15pt; line-height: 1.35; }
      .under { display: inline-block; border-bottom: 1px solid #000; min-width: 342px; }
      .item-grid { display: grid; grid-template-columns: 1fr 28mm 28mm 32mm; border: 1px solid #000; border-top: 0; min-height: 90mm; }
      .head > div { background: #eef2f6; text-align: center; padding: 7px 4px; font-family: Arial, sans-serif;
        font-size: 10pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
        border-top: 1px solid #000; border-bottom: 1px solid #000; }
      .head, .bill-item { display: contents; }
      .bill-item > div { padding: 8px 10px; font-size: 14pt; }
      .qty, .rate, .amount, .col-border { border-left: 1px solid #000; text-align: center; }
      .total-row { display: grid; grid-template-columns: 1fr 28mm 32mm; border: 1px solid #000; border-top: 0; font-size: 14pt; font-weight: 700; }
      .total-row > div { padding: 9px 8px; }
      .total-label, .total-amount { border-left: 1px solid #000; }
      .tax-box { border: 1px solid #000; margin-top: 18px; }
      .declaration { display: grid; grid-template-columns: 1fr 58mm; padding: 8px 10px; font-size: 10.5pt; border-bottom: 1px solid #000; }
      .terms { padding: 8px 10px 10px; font-size: 9.5pt; min-height: 66px; position: relative; }
      .terms ul { margin: 2px 0 0 48px; padding-left: 14px; }
      .sign { position: absolute; right: 14px; bottom: 10px; font-size: 14pt; font-weight: 700; }
      @page { size: A4 portrait; margin: 10mm; }
    </style>
  </head>
  <body>
    <div class="bill-page">
      <div class="title">${VENDOR_NAME}</div>
      <div class="vendor-address">${VENDOR_ADDRESS}</div>
      <div class="vendor-phone">${VENDOR_PHONE}</div>
      <div class="top-box">
        <div class="top-left">
          <div>M/S&nbsp;&nbsp;&nbsp;<strong>${escapeHtml(input.patientName)}</strong></div>
          <div class="under">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(line1)}</div>
          <div class="under">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(line2)}</div>
        </div>
        <div class="top-right">
          <div>Bill No.: <strong>${escapeHtml(input.billNumber)}</strong></div>
          <div style="margin-top: 64px;">Date: ${escapeHtml(displayDate(input.billDate))}</div>
        </div>
      </div>
      <div class="item-grid">
        <div class="head">
          <div>Description</div><div class="col-border">Qty</div><div class="col-border">Rate</div><div class="col-border">Amount</div>
        </div>
        <div class="bill-item">
          <div><strong>1.&nbsp;&nbsp;Surgical Implant</strong></div>
          <div class="qty"><strong>01</strong></div>
          <div class="rate"><strong>${money(input.amount)}</strong></div>
          <div class="amount"><strong>${money(input.amount)}</strong></div>
        </div>
      </div>
      <div class="total-row">
        <div>Rupees: ${escapeHtml(words)}.</div>
        <div class="total-label">Grand Total</div>
        <div class="total-amount" style="text-align:center;">${money(input.amount)}</div>
      </div>
      <div class="tax-box">
        <div class="declaration">
          <div>
            <div>Declaration:</div>
            <div>We declare that this invoice shows the actual price of the goods</div>
            <div>Described and that all particulars are true and correct</div>
          </div>
          <div>
            <div>B.S.T. No.:4400008/S/2562 Dt. 08/12/99</div>
            <div>C.S. T. No.:440008/C/2195 Dt. 08/12/99</div>
          </div>
        </div>
        <div class="terms">
          <div>Terms &amp; Conditions</div>
          <ul>
            <li>This bill is payable immediately on presentation, otherwise interest @ 24% will be charged.</li>
            <li>Our risk and responsibility creases on goods our premises.</li>
            <li>Cheques are to be made cross other in favour of&nbsp; the company.</li>
          </ul>
          <div class="sign">For ${VENDOR_NAME}</div>
        </div>
      </div>
    </div>
  </body>
</html>`
}

/**
 * The full approval: number → invoice document → storage → one posting RPC.
 * If the posting fails the uploaded document is removed so a retry starts clean.
 */
export async function approveReferralRow(input: ReferralInvoiceInput): Promise<ReferralInvoiceResult> {
  if (!input.entryId) throw new Error('The report row has no saved entry')
  if (input.amount <= 0) throw new Error('This row has no cut to approve')

  const { data: billNumber, error: numberError } = await (supabase as any).rpc('next_ml_invoice_number')
  if (numberError) throw new Error(numberError.message)

  const html = buildReferralInvoiceHtml({
    billNumber: billNumber as string,
    billDate: input.entryDate,
    patientName: input.patientName,
    hospital: input.hospital,
    amount: input.amount,
  })

  const documentPath = `expense-bills/${crypto.randomUUID()}.html`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(documentPath, new Blob([html], { type: 'text/html' }), { contentType: 'text/html' })
  if (uploadError) throw new Error(`Could not store the invoice: ${uploadError.message}`)
  const documentUrl = supabase.storage.from(BUCKET).getPublicUrl(documentPath).data?.publicUrl ?? null
  if (!documentUrl) {
    await supabase.storage.from(BUCKET).remove([documentPath])
    throw new Error('Could not create a URL for the generated invoice')
  }

  const { data, error } = await (supabase as any).rpc('approve_daily_revenue_referral', {
    p_entry_id: input.entryId,
    p_bill_number: billNumber,
    p_document_path: documentPath,
    p_document_url: documentUrl,
    p_created_by: input.createdBy ?? null,
  })
  if (error) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([documentPath])
    if (cleanupError) console.error('Could not remove rejected invoice upload:', cleanupError)
    throw new Error(error.message)
  }

  const result = data as any
  return {
    billId: result.bill_id,
    billNumber: result.bill_number,
    companyKey: result.company_key,
    salesVoucher: result.sales_voucher,
    commissionVoucher: result.commission_voucher,
  }
}
