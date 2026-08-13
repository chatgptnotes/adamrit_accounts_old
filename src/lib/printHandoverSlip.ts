/**
 * The printed cash handover slip — the piece of paper the three people sign.
 *
 * Deliberately its own printer rather than printTallyVoucher(): this is not a
 * voucher, it never enters the books, and it needs a denomination grid and
 * three signature lines rather than a Dr/Cr table.
 */
import { amountInWords } from "@/lib/amountInWords";
import type { CashHandover } from "@/lib/cashHandover";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const money = (n: number): string =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(n || 0));

const dateLabel = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export function printHandoverSlip(
  h: CashHandover,
  denominations: { denomination: number; qty: number; line_total: number }[],
  orgName: string,
): boolean {
  const variance = Number(h.counted_cash) - Number(h.expected_cash);
  const denomRows = denominations
    .filter((d) => d.qty > 0)
    .map(
      (d) => `<tr>
        <td class="r">${d.denomination}</td>
        <td class="c">x</td>
        <td class="r">${d.qty}</td>
        <td class="r">${money(d.line_total)}</td>
      </tr>`,
    )
    .join("");

  const varianceBlock =
    Math.round(variance * 100) === 0
      ? `<tr class="ok"><td colspan="3">Counted cash matches the software figure</td><td class="r">0.00</td></tr>`
      : `<tr class="warn">
           <td colspan="3">${variance > 0 ? "EXCESS in drawer" : "SHORT against software"} — reason recorded below</td>
           <td class="r">${money(Math.abs(variance))}</td>
         </tr>`;

  const body = `
    <div class="head">
      <div class="org">${esc(orgName)}</div>
      <div class="title">CASH HANDOVER</div>
      <div class="no">${esc(h.handover_no)}</div>
    </div>

    <table class="meta">
      <tr><td class="k">Handed over by</td><td>${esc(h.from_user_name)}</td>
          <td class="k">Date</td><td>${esc(dateLabel(h.submitted_at))}</td></tr>
      <tr><td class="k">Received by</td><td>${esc(h.to_user_name)}</td>
          <td class="k">Received at</td><td>${esc(dateLabel(h.accepted_at))}</td></tr>
      <tr><td class="k">Verified by</td><td>${esc(h.verified_by_name || "—")}</td>
          <td class="k">Verified at</td><td>${esc(dateLabel(h.verified_at))}</td></tr>
      <tr><td class="k">Receipts covered</td><td>${h.source_count}</td>
          <td class="k">Status</td><td>${esc(h.status)}</td></tr>
    </table>

    <table class="grid">
      <thead><tr><th class="r">Note</th><th class="c"></th><th class="r">Count</th><th class="r">Amount</th></tr></thead>
      <tbody>
        ${denomRows || `<tr><td colspan="4" class="c">No denominations recorded</td></tr>`}
        <tr class="tot"><td colspan="3">Physically counted</td><td class="r">${money(h.counted_cash)}</td></tr>
        <tr><td colspan="3">Software figure</td><td class="r">${money(h.expected_cash)}</td></tr>
        ${varianceBlock}
      </tbody>
    </table>

    <div class="words">${esc(amountInWords(Number(h.counted_cash)))}</div>

    ${
      h.variance_reason
        ? `<div class="reason"><b>Reason for difference:</b> ${esc(h.variance_reason)}</div>`
        : ""
    }
    ${h.notes ? `<div class="reason"><b>Notes:</b> ${esc(h.notes)}</div>` : ""}

    <div class="ref">
      For reference only, not part of this handover —
      UPI/online ${money(h.ref_upi_total)} &nbsp;·&nbsp; Card ${money(h.ref_card_total)}
    </div>

    <div class="sign">
      <div><div class="line"></div>Handed over by<br/><b>${esc(h.from_user_name)}</b></div>
      <div><div class="line"></div>Received by<br/><b>${esc(h.to_user_name)}</b></div>
      <div><div class="line"></div>Verified by<br/><b>${esc(h.verified_by_name || "")}</b></div>
    </div>`;

  const css = `
    @page { size: A5 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; }
    .head { text-align: center; border-bottom: 1.5px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
    .org { font-size: 12pt; font-weight: bold; }
    .title { font-size: 11pt; font-weight: bold; letter-spacing: 2px; margin-top: 2px; }
    .no { font-size: 9pt; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    .meta td { padding: 2px 4px; font-size: 9pt; vertical-align: top; }
    .meta .k { color: #444; width: 22%; }
    .grid { margin-top: 10px; border: 1px solid #000; }
    .grid th, .grid td { border-bottom: 1px solid #ccc; padding: 3px 6px; font-size: 9.5pt; }
    .grid th { background: #eee; border-bottom: 1px solid #000; }
    .r { text-align: right; } .c { text-align: center; }
    .tot td { font-weight: bold; border-top: 1px solid #000; }
    .warn td { background: #fff3cd; font-weight: bold; }
    .ok td { color: #155724; }
    .words { margin-top: 8px; font-size: 9pt; font-style: italic; }
    .reason { margin-top: 6px; font-size: 9pt; }
    .ref { margin-top: 8px; font-size: 8pt; color: #555; border-top: 1px dotted #999; padding-top: 4px; }
    .sign { display: flex; justify-content: space-between; gap: 10px; margin-top: 18mm; font-size: 8.5pt; text-align: center; }
    .sign > div { flex: 1; }
    .line { border-top: 1px solid #000; margin-bottom: 3px; }`;

  const win = window.open("", "_blank", "width=800,height=1000");
  if (!win) return false;
  win.document.write(
    `<!doctype html><html><head><title>${esc(h.handover_no)}</title><style>${css}</style></head>` +
      `<body>${body}<script>window.onload=function(){setTimeout(function(){window.print()},150)}<\/script></body></html>`,
  );
  win.document.close();
  return true;
}
