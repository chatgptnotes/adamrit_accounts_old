// Prints the justification as a document the hospital can sign, stamp and send
// back with the claim.
//
// The page carries the hospital's own signature and stamp — this is the
// hospital's submission on the claim, not a clinical note, so it goes out over
// the hospital's authorised signatory rather than a doctor's.
//
// WHY THE STAMP IS A RULED BOX AND NOT AN IMAGE
// Nothing is stamped that nobody stamped. There is no scan of the hospital's
// round stamp on file, so what prints is a ruled space to be signed and stamped
// by hand — the same way the pre-authorisation summary already behaves.

export interface JustificationPrintClaim {
  claim_id: string;
  patient_name: string | null;
  uhid: string | null;
  card_id: string | null;
  approved_amount: number | null;
  process_stage: string | null;
  l2_remark: string | null;
  justification: string | null;
}

export interface JustificationPrintOptions {
  hospitalName: string;
  hospitalAddress: string;
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatAmount = (amount: number | null) =>
  amount == null ? '—' : `₹ ${amount.toLocaleString('en-IN')}`;

export function printClaimJustification(
  claim: JustificationPrintClaim,
  options: JustificationPrintOptions,
): void {
  const printedOn = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Justification – Claim ${escapeHtml(claim.claim_id)}</title>
<style>
  @page { margin: 18mm; }
  body { font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial; color: #111; line-height: 1.55; font-size: 12px; }
  .letterhead { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 16px; }
  .letterhead h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: .3px; }
  .letterhead .addr { font-size: 10.5px; color: #444; }
  .doctitle { text-align: center; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; margin: 14px 0 12px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .meta td { border: 1px solid #bbb; padding: 5px 8px; vertical-align: top; }
  .meta td.k { background: #f4f4f4; font-weight: 600; width: 20%; white-space: nowrap; }
  .section-label { font-weight: 700; margin: 14px 0 4px; }
  .quote { border-left: 3px solid #999; padding: 6px 10px; background: #fafafa; white-space: pre-wrap; }
  .body-text { white-space: pre-wrap; text-align: justify; }
  .signrow { display: flex; gap: 28px; margin-top: 34px; page-break-inside: avoid; }
  .signblock { flex: 1; }
  .sig, .sig-space { height: 34px; display: block; }
  .sig { max-width: 150px; object-fit: contain; }
  .signline { border-top: 1px solid #111; width: 78%; margin-bottom: 4px; }
  .signname { font-weight: 700; }
  .signmeta { font-size: 10.5px; color: #444; }
  .stamp { margin-top: 10px; }
  .stamp img { width: 78px; height: 78px; object-fit: contain; display: block; }
  .stamp-space { width: 78px; height: 78px; border: 1px dashed #999; border-radius: 4px; }
  .stamp-caption { font-size: 9.5px; color: #666; width: 78px; text-align: center; margin-top: 2px; }
  .printed { margin-top: 26px; font-size: 10px; color: #666; }
</style>
</head>
<body>
  <div class="letterhead">
    <h1>${escapeHtml(options.hospitalName)}</h1>
    <div class="addr">${escapeHtml(options.hospitalAddress)}</div>
  </div>

  <div class="doctitle">Justification against scrutiny remark</div>

  <table class="meta">
    <tr><td class="k">Claim ID</td><td>${escapeHtml(claim.claim_id)}</td><td class="k">UHID</td><td>${escapeHtml(claim.uhid || '—')}</td></tr>
    <tr><td class="k">Patient</td><td>${escapeHtml(claim.patient_name || '—')}</td><td class="k">Card ID</td><td>${escapeHtml(claim.card_id || '—')}</td></tr>
    <tr><td class="k">Process stage</td><td>${escapeHtml(claim.process_stage || '—')}</td><td class="k">Approved amount</td><td>${escapeHtml(formatAmount(claim.approved_amount))}</td></tr>
  </table>

  <div class="section-label">Remark raised by the scrutinizer</div>
  <div class="quote">${escapeHtml(claim.l2_remark || '—')}</div>

  <div class="section-label">Justification submitted by the hospital</div>
  <div class="body-text">${escapeHtml(claim.justification || '')}</div>

  <div class="signrow">
    <div class="signblock">
      <div class="sig-space"></div>
      <div class="signline"></div>
      <div class="signname">For ${escapeHtml(options.hospitalName)}</div>
      <div class="signmeta">Authorised signatory</div>
    </div>
    <div class="signblock">
      <div class="stamp-space"></div>
      <div class="stamp-caption">Hospital stamp</div>
    </div>
  </div>

  <div class="printed">Printed on ${escapeHtml(printedOn)}</div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=760');
  if (!win) throw new Error('The print window was blocked — allow pop-ups for this site');
  win.document.write(html);
  win.document.close();
  // Give the stamp and signature images a chance to decode; printing before
  // they load leaves blank squares where a stamp should be.
  win.onload = () => {
    win.focus();
    win.print();
  };
}
