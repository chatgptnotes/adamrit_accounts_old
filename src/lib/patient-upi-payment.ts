/**
 * Per-bill UPI payment links.
 *
 * Competitors advertise "online payments"; in India the working version of
 * that — with no gateway, no merchant onboarding and no fees — is a UPI deep
 * link carrying the exact amount and a note identifying the bill. The patient
 * taps it on their phone, their UPI app opens pre-filled, and they pay into
 * the hospital's existing account.
 *
 * The hospital's UPI identity is the same one the Payment QR screen already
 * uses, so money lands where it always has. Override it per environment with
 * VITE_HOSPITAL_UPI_ID / VITE_HOSPITAL_UPI_NAME when Ayushman gets its own.
 *
 * NOTE: a UPI link cannot confirm payment by itself — the patient still shows
 * the transaction, and the receipt is raised as usual. Automatic confirmation
 * needs a payment gateway with webhooks; this is deliberately the version that
 * works today without handling anyone's card details.
 */

// Same VPA as "PhonePe QR 1" on the Payment QR screen (PaymentSupportPanel).
const DEFAULT_UPI_ID = '9373111709-4@axl';
const DEFAULT_PAYEE = 'DRM Hope Hospital Private Limited';

export const hospitalUpiId = (): string =>
  (import.meta as any).env?.VITE_HOSPITAL_UPI_ID || DEFAULT_UPI_ID;

const hospitalPayeeName = (): string =>
  (import.meta as any).env?.VITE_HOSPITAL_UPI_NAME || DEFAULT_PAYEE;

export interface UpiRequest {
  amount: number;
  /** Shown in the payer's app and on the bank statement — keep it identifiable. */
  note: string;
}

/** The `upi://` deep link a phone opens directly. */
export const buildUpiLink = ({ amount, note }: UpiRequest): string => {
  const params = new URLSearchParams({
    pa: hospitalUpiId(),
    pn: hospitalPayeeName(),
    am: Math.max(0, Number(amount) || 0).toFixed(2),
    cu: 'INR',
    tn: note.slice(0, 50),
  });
  return `upi://pay?${params.toString()}`;
};

/**
 * A QR image for the same link, for the counter screen or a printed bill.
 * Rendered by a public QR service — the link itself carries no patient data
 * beyond the note, so nothing sensitive leaves the building.
 */
export const buildUpiQrUrl = (req: UpiRequest, size = 260): string =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(buildUpiLink(req))}`;

/** The note that identifies a hospital bill on the payer's statement. */
export const billPaymentNote = (billNumber: string | null | undefined, patientName?: string | null): string => {
  const bill = String(billNumber || '').trim();
  const who = String(patientName || '').trim().split(/\s+/)[0] || '';
  return [bill ? `Bill ${bill}` : 'Hospital bill', who].filter(Boolean).join(' ');
};
