// Prints the justification as a document the hospital can sign, stamp and send
// back with the claim.
//
// One signature only: the doctor chosen from the credentials master, and only
// where a real scan of it exists. Stamps are not drawn at all — the hospital
// stamps the paper by hand once it is printed, which is how the document is
// actually made official.

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

/** A doctor from the credentials master, as chosen in the print dialog. */
export interface JustificationSignatory {
  name: string;
  qualification?: string | null;
  registrationNo?: string | null;
  signatureUrl?: string | null;
  stampUrl?: string | null;
}

export interface JustificationPrintOptions {
  hospitalName: string;
  hospitalAddress: string;
  /** Omitted when nobody was picked — the page then carries the hospital block alone. */
  doctor?: JustificationSignatory | null;
  /**
   * The printed letterhead sheet, drawn behind the letter. Null when the
   * hospital has no letterhead artwork, in which case the name and address are
   * typed at the top instead.
   */
  letterheadUrl?: string | null;
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
  const doctor = options.doctor;
  const letterhead = options.letterheadUrl;
  // Only a real signature is printed. Stamps are applied to the paper by hand
  // after it comes off the printer, so nothing here draws one.
  const signatureImage = doctor?.signatureUrl || null;
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
  /* The letterhead is a printed sheet, so the page carries no margin of its
     own and the text is inset far enough to clear the printed header and the
     two addresses along the foot. Without artwork the same inset would leave a
     large hole, so those paddings drop back to an ordinary letter margin. */
  @page { size: A4; margin: ${letterhead ? '0' : '18mm'}; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; line-height: 1.6; font-size: 12.5px; margin: 0; }
  .sheet { position: relative; ${letterhead ? 'width: 210mm; min-height: 297mm;' : ''} }
  /* An <img>, not a CSS background: Chrome prints background images only when
     the user has ticked "Background graphics", and nobody remembers to. */
  .letterhead-sheet { position: absolute; top: 0; left: 0; width: 210mm; height: 262mm; z-index: 0; }
  .content { position: relative; z-index: 1; ${letterhead ? 'padding: 52mm 20mm 46mm;' : ''} }
  .typed-head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 16px; }
  .typed-head .nm { font-size: 16px; font-weight: bold; }
  .typed-head .ad { font-size: 10.5px; }
  .date { text-align: right; margin-bottom: 14px; }
  .addressee { white-space: pre-line; margin-bottom: 14px; }
  .through { margin-bottom: 14px; }
  .subject { margin-bottom: 6px; }
  .ref { margin-bottom: 14px; }
  .salutation { margin-bottom: 12px; }
  p { margin: 0 0 12px; text-align: justify; }
  .observation { margin: 0 0 12px 24px; white-space: pre-wrap; }
  /* The closing sits against the right margin, which is where a signature goes
     on a letter and — more to the point — keeps the stamps clear of the two
     addresses printed across the foot of the letterhead. Everything here is
     sized to fit above that band on a one-page letter. */
  .closing { margin-top: 10px; text-align: right; page-break-inside: avoid; }
  /* The sign-off stays on the left where the letter's own text ends; only who
     signs it, and their stamps, move to the right margin. */
  .regards { text-align: left; margin-bottom: 6px; }
  .sig-space { height: 28px; display: block; margin-left: auto; }
  .sig { display: block; margin-left: auto; max-width: 165px; max-height: 44px; object-fit: contain; }
  .signname { font-weight: bold; margin-top: 2px; }
</style>
</head>
<body>
<div class="sheet">
  ${letterhead ? `<img class="letterhead-sheet" src="${escapeHtml(letterhead)}" alt="" />` : ''}
  <div class="content">
  ${letterhead ? '' : `<div class="typed-head">
    <div class="nm">${escapeHtml(options.hospitalName)}</div>
    <div class="ad">${escapeHtml(options.hospitalAddress)}</div>
  </div>`}

  <div class="date">Date: ${escapeHtml(printedOn)}</div>

  <div class="addressee">To,
State Medical Officer,
Regional Office Maharashtra,
Employees State Insurance Corporation,
Ground Floor, Panchdeep Bhavan,
Near Strand Cinema Bus Stop, S.B.S Marg,
Colaba, Mumbai – 400005</div>

  <div class="through">Through :- The Superintendent, ESIS Hospital, Somwarpeth, Nagpur</div>

  <div class="subject"><b>Subject:</b> Justification against scrutiny remark raised on claim of ${escapeHtml(claim.patient_name || 'the beneficiary')}</div>

  <div class="ref"><b>Ref:</b> Claim ID ${escapeHtml(claim.claim_id)}${claim.uhid ? `, UHID ${escapeHtml(claim.uhid)}` : ''}${claim.card_id ? `, Card ID ${escapeHtml(claim.card_id)}` : ''}${claim.approved_amount != null ? `, approved amount ${escapeHtml(formatAmount(claim.approved_amount))}` : ''}</div>

  <div class="salutation">Dear Sir,</div>

  <p>The following observation has been raised at scrutiny on the above claim:</p>

  <div class="observation">"${escapeHtml(claim.l2_remark || '')}"</div>

  <p>${escapeHtml(claim.justification || '')}</p>

  <div class="closing">
    <div class="regards">Regards,</div>
    ${doctor
      ? `${signatureImage ? `<img class="sig" src="${escapeHtml(signatureImage)}" alt="" />` : '<div class="sig-space"></div>'}
    <div class="signname">${escapeHtml(doctor.name)}</div>
    ${doctor.qualification ? `<div>${escapeHtml(doctor.qualification)}</div>` : ''}
    ${doctor.registrationNo ? `<div>Reg. No. ${escapeHtml(doctor.registrationNo)}</div>` : ''}`
      : '<div class="sig-space"></div>'}
    <div>${escapeHtml(options.hospitalName)}, Nagpur</div>

  </div>
  </div>
</div>
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
