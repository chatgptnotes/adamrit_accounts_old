import { amountInWords } from '@/lib/amountInWords';

/**
 * The Tally print formats, shared by every screen that prints.
 *
 * Tally prints two things: a voucher and a report. Both go into their own
 * `window.open` document rather than an `@media print` block on the app, so
 * neither inherits the SPA's styling and both can set their own `@page`.
 *
 * The measurements come from a real TallyPrime payment-voucher printout: the
 * sheet is not full width — the voucher is a left-hand block with a wide right
 * margin — and it prints bold at around 8.5pt.
 */

export const fmtINR = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Tally-style short date, e.g. "4-Jul-26" */
export const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const esc = (t: unknown): string =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Shared by both formats. `print-color-adjust` is there because Chrome drops
 * backgrounds unless the print dialog's "Background graphics" box is ticked,
 * and the shaded band is part of the Tally look.
 */
const BASE_CSS = `
  body { font-family: Arial, Helvetica, sans-serif; margin: 14mm 44mm 14mm 18mm; color: #000; font-size: 8.5pt; font-weight: 700; }
  .org { text-align: center; font-size: 10pt; }
  .addr { text-align: center; }
  .doc { text-align: center; margin: 12px 0 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 0; font-weight: 700; text-align: left; }
  td { padding: 2px 4px 2px 0; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; border-left: 1px solid #000; padding-left: 3px; }
  tr.led td { background: #e2e2e2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 0; }
`;

const letterhead = (orgName: string, addressLines: string[]): string =>
  `<div class="org">${esc(orgName)}</div>` + addressLines.map((l) => `<div class="addr">${esc(l)}</div>`).join('');

/** Opens the popup and prints it. Returns false when the browser blocked it. */
const openAndPrint = (title: string, css: string, bodyHtml: string): boolean => {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(title)}</title>
<style>${BASE_CSS}${css}</style></head><body>
${bodyHtml}
  <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>
</body></html>`);
  win.document.close();
  return true;
};

export interface TallyVoucherPrintData {
  orgName: string;
  addressLines: string[];
  voucherTypeName: string;
  voucherNumber: string;
  /** ISO date; rendered through `tallyDateLabel` */
  voucherDate: string;
  /** Voucher category — only PAYMENT prints a receiver's signature line */
  category: string;
  /** The cash/bank ledger in Tally's single-account modes; null for a journal */
  through: string | null;
  rows: { name: string; dr: number; cr: number }[];
  narration: string;
}

const VOUCHER_CSS = `
  .head { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .through { margin-bottom: 3px; }
  th.part { padding-left: 5mm; }
  td.ind { padding-left: 5mm; }
  td.plain { font-weight: 400; padding-left: 5mm; }
  .num { width: 15%; }
  tr.gap td { height: 38px; }
  tr.tot td.num { border-top: 1px solid #000; border-bottom: 1px solid #000; }
  .sign { margin-top: 16mm; display: flex; justify-content: space-between; }
`;

/**
 * A single voucher, laid out the way TallyPrime prints one.
 *
 * The cash/bank side sits in the header as "Through :" rather than in the
 * table, which is why the Particulars table carries one Amount column in the
 * single-account modes and two only for a journal. The column rule runs
 * unbroken from the Particulars band down to the total, so the narration and
 * amount-in-words blocks live inside the table rather than after it.
 */
export function printTallyVoucher(data: TallyVoucherPrintData): boolean {
  const { orgName, addressLines, voucherTypeName, voucherNumber, voucherDate, category, through, rows, narration } =
    data;
  // Single-account rows all sit on one side, so summing the debits alone would
  // total zero on a Receipt.
  const total = through
    ? rows.reduce((s, r) => s + r.dr + r.cr, 0)
    : rows.reduce((s, r) => s + r.dr, 0);
  // Tally writes "INR Seven Hundred Sixty Only"; the shared helper says
  // "Rupees ..." for its other callers, so swap the prefix here only.
  const words = amountInWords(total).replace(/^Rupees /, 'INR ');
  const blanks = '<td class="num"></td>'.repeat(through ? 1 : 2);
  const body = rows
    .map((r) =>
      through
        ? `<tr class="led"><td class="ind">${esc(r.name)}</td><td class="num">${fmtINR(r.dr + r.cr)}</td></tr>`
        : `<tr class="led"><td class="ind">${r.dr > 0 ? 'Dr' : 'Cr'} ${esc(r.name)}</td><td class="num">${
            r.dr > 0 ? fmtINR(r.dr) : ''
          }</td><td class="num">${r.cr > 0 ? fmtINR(r.cr) : ''}</td></tr>`,
    )
    .join('');
  return openAndPrint(
    `${voucherTypeName} — ${voucherNumber}`,
    VOUCHER_CSS,
    `${letterhead(orgName, addressLines)}
  <div class="doc">${esc(voucherTypeName)}</div>
  <div class="head">
    <div>No.&nbsp;&nbsp; :&nbsp;&nbsp;${esc(voucherNumber)}</div>
    <div>Dated&nbsp;&nbsp; :&nbsp;&nbsp;${esc(tallyDateLabel(voucherDate))}</div>
  </div>
  ${through ? `<div class="through">Through :&nbsp;&nbsp;${esc(through)}</div>` : ''}
  <table>
    <thead><tr><th class="part">Particulars</th>${
      through ? '<th class="num">Amount</th>' : '<th class="num">Debit</th><th class="num">Credit</th>'
    }</tr></thead>
    <tbody>
      ${through ? `<tr><td>Account :</td>${blanks}</tr>` : ''}
      ${body}
      <tr class="gap"><td></td>${blanks}</tr>
      <tr><td>On Account of :</td>${blanks}</tr>
      <tr><td class="plain">${esc(narration || '-')}</td>${blanks}</tr>
      <tr><td>Amount (in words) :</td>${blanks}</tr>
      <tr><td class="plain">${esc(words)}</td>${blanks}</tr>
      <tr class="tot"><td></td>${
        // A journal balances two columns, so both carry the total.
        through ? '' : `<td class="num">₹ ${fmtINR(total)}</td>`
      }<td class="num">₹ ${fmtINR(total)}</td></tr>
    </tbody>
  </table>
  <div class="sign"><div>${category === 'PAYMENT' ? "Receiver's Signature:" : ''}</div><div>Authorised Signatory</div></div>`,
  );
}

export interface TallyReportPrintData {
  title: string;
  columns: string[];
  rows: (string | number | null | undefined)[][];
  /** The period caption Tally prints under a report title */
  period?: string;
}

const REPORT_CSS = `
  body { margin: 12mm 12mm 12mm 14mm; }
  .period { text-align: center; font-weight: 400; margin: -12px 0 14px; }
  th.num, td.num { border-left: none; }
  tbody tr:nth-child(even) td { background: #f1f1f1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tfoot td { border-top: 1px solid #000; border-bottom: 1px solid #000; }
`;

/**
 * A report screen's Alt+P. Tally heads a printed report with the company, the
 * report name and the period, then the same borderless ruled table as a
 * voucher — not a screenshot of the screen, which is what `window.print()`
 * gave before.
 *
 * A report is wider than a voucher, so this one uses the full sheet rather
 * than the voucher's left-hand block.
 */
export function printTallyReport(
  { title, columns, rows, period }: TallyReportPrintData,
  orgName: string,
  addressLines: string[],
): boolean {
  // Right-align a column only when every value in it is a number, so amount
  // columns line up and text columns are left alone.
  const isNumeric = columns.map((_, i) =>
    rows.some((r) => r[i] != null && r[i] !== '') &&
    rows.every((r) => r[i] == null || r[i] === '' || !Number.isNaN(Number(String(r[i]).replace(/,/g, '')))),
  );
  const cell = (v: unknown, i: number) => `<td class="${isNumeric[i] ? 'num' : ''}">${esc(v)}</td>`;
  return openAndPrint(
    title,
    REPORT_CSS,
    `${letterhead(orgName, addressLines)}
  <div class="doc">${esc(title)}</div>
  ${period ? `<div class="period">${esc(period)}</div>` : ''}
  <table>
    <thead><tr>${columns.map((c, i) => `<th class="${isNumeric[i] ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((_, i) => cell(r[i], i)).join('')}</tr>`).join('')}</tbody>
  </table>`,
  );
}
