import { buildUpiLink, billPaymentNote } from '@/lib/patient-upi-payment';

/**
 * Patient-facing WhatsApp messages.
 *
 * The hospital already sends INTERNAL alerts through DoubleTick
 * (`send-payment-alerts`), but nothing reaches the patient — every competitor
 * advertises WhatsApp bills, reports and reminders. This composes those
 * messages and opens them in WhatsApp addressed to the patient.
 *
 * Why a wa.me hand-off rather than firing the API directly: WhatsApp only
 * permits business-initiated messages through pre-approved templates, and the
 * patient-facing templates are not approved yet. Opening the chat pre-filled
 * works today, costs nothing, and keeps a human in the loop before anything
 * goes to a patient. When the templates are approved, `sendViaApi` below is
 * the one place to switch on — the message text is already composed here.
 */

const hospitalLabel = (hospital?: string | null): string =>
  String(hospital || '').toLowerCase().includes('ayush') ? 'Ayushman Hospital' : 'Hope Hospital';

/** India-first: 10 digits get +91; anything already carrying a country code is kept. */
export const toWhatsAppNumber = (mobile: string | null | undefined): string | null => {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits.length >= 11 ? digits : null;
};

const rupees = (n: number) => `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;

export interface BillMessage {
  patientName: string;
  billNumber?: string | null;
  amount: number;
  amountPaid?: number;
  hospital?: string | null;
  /** Attach a UPI link so the patient can pay from the message itself. */
  includePaymentLink?: boolean;
}

export const composeBillMessage = (m: BillMessage): string => {
  const due = Math.max(0, (m.amount || 0) - (m.amountPaid || 0));
  const lines = [
    `Dear ${m.patientName},`,
    '',
    `Your bill at ${hospitalLabel(m.hospital)}${m.billNumber ? ` (No. ${m.billNumber})` : ''}:`,
    `Total: ${rupees(m.amount)}`,
  ];
  if (m.amountPaid) lines.push(`Paid: ${rupees(m.amountPaid)}`);
  if (due > 0) lines.push(`Balance due: ${rupees(due)}`);
  if (m.includePaymentLink && due > 0) {
    lines.push('', 'Pay securely by UPI:', buildUpiLink({ amount: due, note: billPaymentNote(m.billNumber, m.patientName) }));
  }
  lines.push('', 'Thank you for choosing us.', hospitalLabel(m.hospital));
  return lines.join('\n');
};

export const composeReportReadyMessage = (patientName: string, what: string, hospital?: string | null): string =>
  [
    `Dear ${patientName},`,
    '',
    `Your ${what} is ready and can be collected from the hospital reception.`,
    '',
    hospitalLabel(hospital),
  ].join('\n');

export const composeAppointmentReminder = (
  patientName: string,
  whenLabel: string,
  doctor?: string | null,
  hospital?: string | null,
): string =>
  [
    `Dear ${patientName},`,
    '',
    `This is a reminder of your appointment on ${whenLabel}${doctor ? ` with ${doctor}` : ''} at ${hospitalLabel(hospital)}.`,
    'Please arrive 15 minutes early and bring any previous reports.',
    '',
    hospitalLabel(hospital),
  ].join('\n');

export const composeDischargeMessage = (patientName: string, hospital?: string | null): string =>
  [
    `Dear ${patientName},`,
    '',
    `Wishing you a speedy recovery. Your discharge summary is available at ${hospitalLabel(hospital)} reception, and your treating doctor's follow-up advice is included in it.`,
    '',
    hospitalLabel(hospital),
  ].join('\n');

/**
 * Open WhatsApp with the message pre-filled, addressed to the patient.
 * Returns false when the number is unusable so the caller can say so.
 */
export const openWhatsApp = (mobile: string | null | undefined, message: string): boolean => {
  const to = toWhatsAppNumber(mobile);
  if (!to) return false;
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  return true;
};
