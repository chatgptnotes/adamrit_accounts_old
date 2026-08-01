// Prints the justification as a document the hospital can sign, stamp and send
// back with the claim.
//
// One signature only: the doctor chosen from the credentials master. The
// hospital gets a stamp box but no signature line of its own — a second ruled
// space with nobody's name against it is just a blank nobody fills.
//
// WHY THE STAMP IS A RULED BOX AND NOT AN IMAGE
// Nothing is stamped that nobody stamped. There is no scan of the hospital's
// round stamp on file, so what prints is a space to be stamped by hand — the
// same way the pre-authorisation summary already behaves.

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
   * The hospital's seal. Null when no seal has been uploaded for this hospital,
   * in which case a box is printed to stamp by hand.
   */
  hospitalSealUrl?: string | null;
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
  body { font-family: Arial, Helvetica, sans-serif; color: #000; line-height: 1.6; font-size: 12.5px; }
  .date { text-align: right; margin-bottom: 14px; }
  .addressee { white-space: pre-line; margin-bottom: 14px; }
  .through { margin-bottom: 14px; }
  .subject { margin-bottom: 6px; }
  .ref { margin-bottom: 14px; }
  .salutation { margin-bottom: 12px; }
  p { margin: 0 0 12px; text-align: justify; }
  .observation { margin: 0 0 12px 24px; white-space: pre-wrap; }
  .closing { margin-top: 22px; page-break-inside: avoid; }
  .sig, .sig-space { height: 40px; display: block; }
  .sig { max-width: 160px; object-fit: contain; }
  .signname { font-weight: bold; margin-top: 4px; }
  .stamprow { display: flex; gap: 40px; margin-top: 12px; page-break-inside: avoid; }
  .stampimg { width: 92px; height: 92px; object-fit: contain; display: block; }
  .stamp-space { width: 92px; height: 92px; border: 1px dashed #999; }
  .stamp-caption { font-size: 9.5px; color: #666; width: 92px; text-align: center; margin-top: 2px; }
</style>
</head>
<body>
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
    <div>Regards,</div>
    ${doctor
      ? `${doctor.signatureUrl ? `<img class="sig" src="${escapeHtml(doctor.signatureUrl)}" alt="" />` : '<div class="sig-space"></div>'}
    <div class="signname">${escapeHtml(doctor.name)}</div>
    ${doctor.qualification ? `<div>${escapeHtml(doctor.qualification)}</div>` : ''}
    ${doctor.registrationNo ? `<div>Reg. No. ${escapeHtml(doctor.registrationNo)}</div>` : ''}`
      : '<div class="sig-space"></div>'}
    <div>${escapeHtml(options.hospitalName)}, Nagpur</div>

    <div class="stamprow">
      ${doctor?.stampUrl
        ? `<div><img class="stampimg" src="${escapeHtml(doctor.stampUrl)}" alt="" /><div class="stamp-caption">Doctor's stamp</div></div>`
        : ''}
      <div>
        ${options.hospitalSealUrl
          ? `<img class="stampimg" src="${escapeHtml(options.hospitalSealUrl)}" alt="" />`
          : '<div class="stamp-space"></div>'}
        <div class="stamp-caption">Hospital stamp</div>
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
