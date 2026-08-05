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

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const displayDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB')
}

/** The M.L. Enterprises invoice: one line item, printed A4, self-contained. */
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
      /* Self-contained by necessity: this file is stored in Supabase and
         opened straight from storage, so no external fonts or assets. */
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #0f1e33;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { width: 186mm; margin: 0 auto; padding: 6mm 0 0; }

      /* Masthead ------------------------------------------------------ */
      .masthead { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; }
      .mark { width: 54px; height: 54px; flex: none; }
      .brand-name { font-size: 21pt; font-weight: 800; letter-spacing: .04em; line-height: 1.1; }
      .brand-meta { margin-top: 3px; font-size: 8.4pt; line-height: 1.45; color: #5a6a80; }
      .doc { text-align: right; }
      .doc-kind { font-size: 8.5pt; font-weight: 800; letter-spacing: .22em; color: #1f7a8c; }
      .doc-no { margin-top: 2px; font-size: 15pt; font-weight: 800; }
      .doc-date { margin-top: 2px; font-size: 8.6pt; color: #5a6a80; }
      .rule { height: 3px; margin-top: 10px; background: #1f7a8c; border-radius: 2px; }

      /* Billed-to ----------------------------------------------------- */
      .parties { display: grid; grid-template-columns: 1fr 62mm; gap: 12px; margin-top: 14px; }
      .label { font-size: 7.6pt; font-weight: 800; letter-spacing: .16em; color: #8494a8; text-transform: uppercase; }
      .party-name { margin-top: 5px; font-size: 12.5pt; font-weight: 700; }
      .party-addr { margin-top: 3px; font-size: 9.4pt; line-height: 1.5; color: #44536a; }
      .panel { background: #f4f8fa; border: 1px solid #dbe6ec; border-radius: 6px; padding: 9px 11px; }
      .panel-row { display: flex; justify-content: space-between; gap: 10px; font-size: 9.2pt; padding: 2px 0; }
      .panel-row span:first-child { color: #6b7b90; }
      .panel-row span:last-child { font-weight: 700; }

      /* Items --------------------------------------------------------- */
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      thead th { background: #0f1e33; color: #fff; font-size: 8pt; font-weight: 700;
        letter-spacing: .14em; text-transform: uppercase; text-align: left; padding: 9px 12px; }
      thead th.num { text-align: right; }
      tbody td { padding: 12px; font-size: 10.5pt; border-bottom: 1px solid #e6ecf2; vertical-align: top; }
      tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .item-title { font-weight: 700; }
      .item-sub { margin-top: 2px; font-size: 8.6pt; color: #7a8798; }

      /* Totals -------------------------------------------------------- */
      .totals { display: grid; grid-template-columns: 1fr 74mm; gap: 12px; margin-top: 14px; align-items: start; }
      .words { font-size: 9.4pt; line-height: 1.5; color: #44536a; }
      .words strong { display: block; margin-top: 3px; color: #0f1e33; font-size: 10pt; }
      .grand { display: flex; justify-content: space-between; align-items: baseline;
        background: #0f1e33; color: #fff; border-radius: 6px; padding: 11px 14px; }
      .grand span { font-size: 8.4pt; letter-spacing: .16em; text-transform: uppercase; opacity: .82; }
      .grand strong { font-size: 15pt; font-variant-numeric: tabular-nums; }

      /* Footer -------------------------------------------------------- */
      .foot { margin-top: 18px; border-top: 1px solid #e6ecf2; padding-top: 12px;
        display: grid; grid-template-columns: 1fr 1fr; gap: 18px; font-size: 8.4pt;
        line-height: 1.55; color: #5a6a80; }
      .foot h4 { margin: 0 0 4px; font-size: 7.6pt; font-weight: 800; letter-spacing: .14em;
        text-transform: uppercase; color: #8494a8; }
      .foot ul { margin: 0; padding-left: 14px; }
      .sign { margin-top: 26px; text-align: right; }
      .sign-line { display: inline-block; width: 56mm; border-top: 1px solid #b9c5d2; padding-top: 5px;
        font-size: 9.6pt; font-weight: 700; color: #0f1e33; }
      @page { size: A4 portrait; margin: 12mm; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="masthead">
        <svg class="mark" viewBox="0 0 64 64" role="img" aria-label="M.L. Enterprises">
          <rect width="64" height="64" rx="15" fill="#0f1e33" />
          <path d="M14 44V21h6.2l6.1 12.4L32.4 21h6.1v23h-5.4V30.6l-4.6 9.2h-3.4l-4.6-9.2V44z" fill="#fff" />
          <path d="M41.6 44V21H47v17.6h8.2V44z" fill="#1f7a8c" />
        </svg>
        <div>
          <div class="brand-name">${VENDOR_NAME}</div>
          <div class="brand-meta">${VENDOR_ADDRESS}<br />${VENDOR_PHONE}</div>
        </div>
        <div class="doc">
          <div class="doc-kind">Invoice</div>
          <div class="doc-no">${escapeHtml(input.billNumber)}</div>
          <div class="doc-date">${escapeHtml(displayDate(input.billDate))}</div>
        </div>
      </div>
      <div class="rule"></div>

      <div class="parties">
        <div>
          <div class="label">Billed to</div>
          <div class="party-name">${escapeHtml(input.patientName)}</div>
          <div class="party-addr">${escapeHtml(line1)}<br />${escapeHtml(line2)}</div>
        </div>
        <div class="panel">
          <div class="panel-row"><span>Invoice No.</span><span>${escapeHtml(input.billNumber)}</span></div>
          <div class="panel-row"><span>Date</span><span>${escapeHtml(displayDate(input.billDate))}</span></div>
          <div class="panel-row"><span>Amount Due</span><span>${money(input.amount)}</span></div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:52%">Description</th>
            <th class="num" style="width:12%">Qty</th>
            <th class="num" style="width:18%">Rate</th>
            <th class="num" style="width:18%">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div class="item-title">Surgical Implant</div>
              <div class="item-sub">Supplied for the above patient</div>
            </td>
            <td class="num">01</td>
            <td class="num">${money(input.amount)}</td>
            <td class="num">${money(input.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="totals">
        <div class="words">
          Amount in words
          <strong>Rupees ${escapeHtml(words)}.</strong>
        </div>
        <div class="grand"><span>Grand Total</span><strong>${money(input.amount)}</strong></div>
      </div>

      <div class="foot">
        <div>
          <h4>Declaration</h4>
          We declare that this invoice shows the actual price of the goods described
          and that all particulars are true and correct.
          <h4 style="margin-top:9px">Registration</h4>
          B.S.T. No.: 4400008/S/2562 Dt. 08/12/99<br />
          C.S.T. No.: 440008/C/2195 Dt. 08/12/99
        </div>
        <div>
          <h4>Terms &amp; Conditions</h4>
          <ul>
            <li>Payable immediately on presentation, otherwise interest @ 24% will be charged.</li>
            <li>Our risk and responsibility ceases once goods leave our premises.</li>
            <li>Cheques to be drawn crossed in favour of the company.</li>
          </ul>
        </div>
      </div>

      <div class="sign">
        <div class="sign-line">For ${VENDOR_NAME}</div>
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
