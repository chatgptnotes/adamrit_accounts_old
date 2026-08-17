import { describe, expect, it } from 'vitest';
import { dialysisScheme, SCHEME_BLOCK, type DialysisPatientSessions } from '../scheme';
import { buildBundleRow, buildBundleRows } from '../bundle';

const MJPJAY_LONG = 'Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)';
const PMJAY_LONG = 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)';

/** A loaded patient with `total` sessions, the first `billed` of them claimed. */
function patient(
  corporate: string | null,
  total: number,
  billed = 0,
  over: Partial<DialysisPatientSessions> = {},
): DialysisPatientSessions {
  const scheme = dialysisScheme(corporate);
  const sessions = Array.from({ length: total }, (_, i) => ({
    visitId: `v${i + 1}`,
    visitCode: `IH26D${i + 1}`,
    // Ascending dates, so the newest is last.
    visitDate: `2026-08-${String(i + 1).padStart(2, '0')}`,
    registeredAt: `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00Z`,
    billed: i < billed,
  }));
  return {
    patientId: 'p1',
    patientName: 'Test Patient',
    patientsId: 'UHHO26A00001',
    phone: null,
    corporate,
    scheme,
    block: SCHEME_BLOCK[scheme],
    sessions,
    unbilledCount: sessions.filter((s) => !s.billed).length,
    readyToBill: false,
    latestRegisteredAt: null,
    ...over,
  };
}

// A fixed "today" so the lab-age assertions never drift with the clock.
const TODAY = new Date('2026-08-17T12:00:00Z');
const FRESH_LAB = '2026-08-16';

describe('dialysisScheme — the spellings actually in patients.corporate', () => {
  it('reads the long MJPJAY name the majority of patients carry', () => {
    expect(dialysisScheme(MJPJAY_LONG)).toBe('MJPJAY');
  });

  it('reads the short MJPJAY name', () => {
    expect(dialysisScheme('MJPJAY')).toBe('MJPJAY');
  });

  it('reads the long PM-JAY name, hyphen and all', () => {
    expect(dialysisScheme(PMJAY_LONG)).toBe('PMJAY');
  });

  it('reads the short PMJAY name', () => {
    expect(dialysisScheme('PMJAY')).toBe('PMJAY');
  });

  it('does not mistake the long MJPJAY name for PM-JAY', () => {
    // Both long names contain "Arogya"; MJPJAY must win.
    expect(dialysisScheme(MJPJAY_LONG)).not.toBe('PMJAY');
  });

  it('treats private and blank as no Yojana block', () => {
    expect(dialysisScheme('private')).toBe('OTHER');
    expect(dialysisScheme(null)).toBe('OTHER');
  });
});

describe('block sizes confirmed by the owner 17-Aug', () => {
  it('is six for MJPJAY', () => expect(SCHEME_BLOCK.MJPJAY).toBe(6));
  it('is three for PMJAY', () => expect(SCHEME_BLOCK.PMJAY).toBe(3));
});

describe('buildBundleRow — MJPJAY, six per bundle', () => {
  it('puts a patient with three sessions at cycle 3 of 6', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 3), FRESH_LAB, TODAY);
    expect(r.cyclesPerBundle).toBe(6);
    expect(r.completedCycles).toBe(3);
    expect(r.currentCycle).toBe(3);
    expect(r.remainingCycles).toBe(3);
    expect(r.status).toBe('In progress');
    expect(r.bundleComplete).toBe(false);
  });

  it('marks exactly six sessions as Completed, not as zero into a new bundle', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 6), FRESH_LAB, TODAY);
    expect(r.completedCycles).toBe(6);
    expect(r.remainingCycles).toBe(0);
    expect(r.status).toBe('Completed');
    expect(r.bundleComplete).toBe(true);
    expect(r.bundlesAwaitingBilling).toBe(1);
  });

  it('starts a fresh bundle at the seventh unbilled session', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 7), FRESH_LAB, TODAY);
    expect(r.completedCycles).toBe(1);
    expect(r.remainingCycles).toBe(5);
    expect(r.status).toBe('In progress');
  });

  it('once six are billed, the seventh session reads as cycle 1 of bundle 2', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 7, 6), FRESH_LAB, TODAY);
    expect(r.completedCycles).toBe(1);
    expect(r.remainingCycles).toBe(5);
    expect(r.bundlesAwaitingBilling).toBe(0);
    expect(r.bundleNumber).toBe(2);
  });

  it('does not report a billed bundle as still awaiting billing', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 6, 6), FRESH_LAB, TODAY);
    expect(r.bundlesAwaitingBilling).toBe(0);
    expect(r.bundleComplete).toBe(false);
  });
});

describe('buildBundleRow — PMJAY, three per bundle', () => {
  it('completes at three, not at six', () => {
    const r = buildBundleRow(patient(PMJAY_LONG, 3), FRESH_LAB, TODAY);
    expect(r.cyclesPerBundle).toBe(3);
    expect(r.completedCycles).toBe(3);
    expect(r.remainingCycles).toBe(0);
    expect(r.status).toBe('Completed');
    expect(r.bundleComplete).toBe(true);
  });

  it('puts a patient with one session at cycle 1 of 3', () => {
    const r = buildBundleRow(patient(PMJAY_LONG, 1), FRESH_LAB, TODAY);
    expect(r.completedCycles).toBe(1);
    expect(r.remainingCycles).toBe(2);
  });

  it('counts six sessions as two whole bundles awaiting billing', () => {
    const r = buildBundleRow(patient(PMJAY_LONG, 6), FRESH_LAB, TODAY);
    expect(r.bundlesAwaitingBilling).toBe(2);
    expect(r.bundleComplete).toBe(true);
  });

  it('is a different answer from MJPJAY for the same three sessions', () => {
    const mj = buildBundleRow(patient(MJPJAY_LONG, 3), FRESH_LAB, TODAY);
    const pm = buildBundleRow(patient(PMJAY_LONG, 3), FRESH_LAB, TODAY);
    expect(mj.status).toBe('In progress');
    expect(pm.status).toBe('Completed');
  });
});

describe('buildBundleRow — patients with no Yojana block', () => {
  it('does not show a private patient as a permanently complete bundle', () => {
    const r = buildBundleRow(patient('private', 4), FRESH_LAB, TODAY);
    expect(r.hasBundle).toBe(false);
    expect(r.status).toBe('No bundle');
    expect(r.bundleComplete).toBe(false);
    expect(r.pending.join(' ')).toContain('billed per session');
  });
});

describe('lab report, read from the lab module', () => {
  it('flags a patient with no lab report at all', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 2), null, TODAY);
    expect(r.labDue).toBe(true);
    expect(r.pending.join(' ')).toContain('No lab report');
  });

  it('flags a lab report older than 30 days', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 2), '2026-06-01', TODAY);
    expect(r.daysSinceLab).toBeGreaterThan(30);
    expect(r.pending.join(' ')).toContain('older than 30 days');
  });

  it('does not flag a fresh lab report', () => {
    const r = buildBundleRow(patient(MJPJAY_LONG, 2), FRESH_LAB, TODAY);
    expect(r.labDue).toBe(false);
    expect(r.pending.some((p) => p.includes('lab'))).toBe(false);
  });
});

describe('buildBundleRows ordering', () => {
  it('puts bundles ready to bill above everyone else', () => {
    const rows = buildBundleRows(
      [
        { ...patient(MJPJAY_LONG, 2), patientId: 'a', patientName: 'Mid bundle' },
        { ...patient(MJPJAY_LONG, 6), patientId: 'b', patientName: 'Ready to bill' },
      ],
      new Map([
        ['a', FRESH_LAB],
        ['b', FRESH_LAB],
      ]),
      TODAY,
    );
    expect(rows[0].patientName).toBe('Ready to bill');
  });
});
