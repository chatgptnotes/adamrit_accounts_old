/**
 * One dialysis patient's bundle: where they are in the current block of
 * sessions, what is still outstanding, and whether it can be closed and billed.
 *
 * Built entirely on `scheme.ts`, which already owns the scheme rules
 *
 *   PMJAY  -> 3 sessions per block
 *   MJPJAY -> 6 sessions per block
 *
 * and already loads each patient's sessions with the billed state of each one
 * from dialysis_session_billing. Nothing here is a second copy of that: this
 * module only turns a DialysisPatientSessions row into the cycle-wise view the
 * Dialysis Bundle report shows -- current cycle, completed, remaining, status
 * and the pending list -- and joins in the latest lab report.
 *
 * THE CYCLE NUMBER IS COUNTED, NOT TYPED. Sessions are already recorded as
 * visits, so the position in the bundle is derived from that history. A number
 * typed at registration drifts out of step the first time somebody registers
 * out of order or a session is cancelled, and then the report states a cycle
 * that did not happen.
 */

import {
  SCHEME_BLOCK,
  SCHEME_LABEL,
  type DialysisPatientSessions,
  type DialysisScheme,
} from './scheme';
import { LAB_REPORT_INTERVAL_DAYS } from '@/lib/nephroplus/dialysisTracker';

export type BundleStatus = 'In progress' | 'Completed' | 'No bundle';

export interface DialysisBundleRow {
  patientId: string;
  patientName: string;
  patientsId: string | null;
  phone: string | null;

  scheme: DialysisScheme;
  schemeLabel: string;
  /** Sessions in one bundle: 6 MJPJAY, 3 PMJAY, 1 for anything with no block rule. */
  cyclesPerBundle: number;
  /** True only for the schemes that actually run in bundles. */
  hasBundle: boolean;

  /** Sessions recorded across all time. */
  totalSessions: number;
  /** Sessions already put on a claim. */
  billedSessions: number;
  /** Sessions not yet claimed for. */
  unbilledSessions: number;

  /** Which bundle they are on, 1-based. */
  bundleNumber: number;
  /** Sessions completed inside the CURRENT bundle. */
  completedCycles: number;
  /** The cycle they are on now, 1-based; equals cyclesPerBundle once full. */
  currentCycle: number;
  /** Sessions still to do before this bundle closes. */
  remainingCycles: number;
  status: BundleStatus;
  /** Every eligible session done — the bundle can be closed and claimed. */
  bundleComplete: boolean;
  /** Whole bundles finished but not yet claimed. */
  bundlesAwaitingBilling: number;

  lastSessionDate: string | null;
  lastLabDate: string | null;
  daysSinceLab: number | null;
  labDue: boolean;

  /** Plain-language list of what is outstanding, for the report's Pending column. */
  pending: string[];

  /**
   * The loaded patient this row was built from. Carried so closing a bundle can
   * hand the exact sessions to billOneBlock rather than re-deriving which ones
   * are unbilled — the two must never disagree about what has been claimed.
   */
  source: DialysisPatientSessions;
}

function daysBetween(from: string, to: Date): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.floor((end - start) / 86_400_000);
}

/**
 * Turn one loaded patient into the cycle-wise bundle view.
 *
 * `lastLabDate` comes from the lab module (lab_results), looked up by the
 * caller so this stays a plain function.
 */
export function buildBundleRow(
  patient: DialysisPatientSessions,
  lastLabDate: string | null = null,
  today: Date = new Date(),
): DialysisBundleRow {
  const perBundle = SCHEME_BLOCK[patient.scheme];
  // OTHER has a block of 1, which is "billable per session" rather than a real
  // bundle. Saying so keeps the report honest instead of showing every private
  // patient as a permanently complete one-cycle bundle.
  const hasBundle = patient.scheme !== 'OTHER';

  const totalSessions = patient.sessions.length;
  const unbilled = patient.unbilledCount;
  const billed = totalSessions - unbilled;

  const bundlesAwaitingBilling = Math.floor(unbilled / perBundle);

  // Position inside the bundle currently open. A patient sitting exactly on a
  // boundary (6 of 6) is FULL, not zero into the next one -- that is the state
  // the Bundle Complete button exists for.
  const intoCurrent = unbilled % perBundle;
  const bundleComplete = hasBundle && unbilled > 0 && intoCurrent === 0;
  const completedCycles = bundleComplete ? perBundle : intoCurrent;
  const remainingCycles = hasBundle ? perBundle - completedCycles : 0;

  const daysSinceLab = lastLabDate ? daysBetween(lastLabDate, today) : null;
  const labDue = daysSinceLab === null || daysSinceLab >= LAB_REPORT_INTERVAL_DAYS;

  const lastSessionDate = patient.sessions.reduce<string | null>(
    (latest, s) => (!latest || s.visitDate > latest ? s.visitDate : latest),
    null,
  );

  const pending: string[] = [];
  if (hasBundle && remainingCycles > 0) {
    pending.push(
      `${remainingCycles} of ${perBundle} dialysis ${remainingCycles === 1 ? 'cycle' : 'cycles'} remaining`,
    );
  }
  if (lastLabDate === null) {
    pending.push('No lab report on file');
  } else if (labDue) {
    pending.push(`Lab report older than ${LAB_REPORT_INTERVAL_DAYS} days`);
  }
  if (bundleComplete) {
    pending.push('Bundle complete — ready to close and bill');
  }
  if (bundlesAwaitingBilling > 0) {
    pending.push(
      `${bundlesAwaitingBilling} completed ${bundlesAwaitingBilling === 1 ? 'bundle' : 'bundles'} not yet billed`,
    );
  }
  if (!hasBundle) {
    pending.push('No Yojana block rule — billed per session');
  }

  return {
    patientId: patient.patientId,
    patientName: patient.patientName,
    patientsId: patient.patientsId,
    phone: patient.phone,
    scheme: patient.scheme,
    schemeLabel: SCHEME_LABEL[patient.scheme],
    cyclesPerBundle: perBundle,
    hasBundle,
    totalSessions,
    billedSessions: billed,
    unbilledSessions: unbilled,
    bundleNumber: Math.floor(billed / perBundle) + 1,
    completedCycles,
    currentCycle: completedCycles,
    remainingCycles,
    status: !hasBundle ? 'No bundle' : bundleComplete ? 'Completed' : 'In progress',
    bundleComplete,
    bundlesAwaitingBilling,
    lastSessionDate,
    lastLabDate,
    daysSinceLab,
    labDue,
    pending,
    source: patient,
  };
}

/** Bundle rows for every dialysis patient, whatever needs a decision first. */
export function buildBundleRows(
  patients: readonly DialysisPatientSessions[],
  lastLabDates: ReadonlyMap<string, string>,
  today: Date = new Date(),
): DialysisBundleRow[] {
  const rows = patients.map((p) => buildBundleRow(p, lastLabDates.get(p.patientId) ?? null, today));

  return rows.sort((a, b) => {
    const score = (r: DialysisBundleRow) =>
      (r.bundleComplete ? 4 : 0) + (r.bundlesAwaitingBilling > 0 ? 2 : 0) + (r.labDue ? 1 : 0);
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return b.completedCycles - a.completedCycles;
  });
}
