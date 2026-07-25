// Single source of truth for the Director Dashboard metrics.
//
// Each KPI tile shows a count, and tapping it opens a list of the rows behind that
// count. If the tile and the list ever filtered differently the list would contradict
// the number the director just tapped, so both `useDirectorKpis` (the counts) and
// `useDirectorList` (the rows) build their queries from the same `VISIT_METRICS`
// definitions below. Change a filter here and both move together.

export type KpiPeriod = 'today' | 'month' | 'year' | 'specific';

/** The five drillable Director Dashboard tiles. */
export type DirectorMetric =
  | 'opd'
  | 'admissions'
  | 'discharges'
  | 'admitted'
  | 'collections';

export interface DateRange {
  startISO: string;
  endISO: string;
  startDate: string;
  endDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Resolve a KpiPeriod into a half-open [start, end) range. Returns both a timestamp pair
 * (for created_at / admission_date / discharge_date) and a date-only pair (for visit_date).
 * Dates are built in local time — the app is single-region (India).
 */
export function getDateRange(period: KpiPeriod, specificMonth: string): DateRange {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  } else if (period === 'specific' && /^\d{4}-\d{2}$/.test(specificMonth)) {
    const [y, m] = specificMonth.split('-').map(Number);
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  } else {
    // 'month', or 'specific' with no month picked yet → current month
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startDate: toDateStr(start),
    endDate: toDateStr(end),
  };
}

export interface VisitMetricDef {
  /** Applies this metric's filters to a `visits` query builder. */
  apply: (query: any, range: DateRange) => any;
  /** Column the rows are dated and sorted by. */
  dateCol: 'visit_date' | 'admission_date' | 'discharge_date';
  /** Sort direction for the drill list. */
  ascending: boolean;
  label: string;
  /** Ignores the period selector — always "as of now". */
  live?: boolean;
}

/**
 * The four metrics that count rows in `visits`. Hospital scoping is deliberately NOT
 * part of these — the caller adds it, because the tiles scope to one hospital while the
 * drill lists cover both.
 */
export const VISIT_METRICS: Record<
  Exclude<DirectorMetric, 'collections'>,
  VisitMetricDef
> = {
  opd: {
    apply: (q, r) =>
      q.eq('patient_type', 'OPD').gte('visit_date', r.startDate).lt('visit_date', r.endDate),
    dateCol: 'visit_date',
    ascending: false,
    label: 'OPD Visits',
  },
  admissions: {
    apply: (q, r) =>
      q
        .not('admission_date', 'is', null)
        .gte('admission_date', r.startISO)
        .lt('admission_date', r.endISO),
    dateCol: 'admission_date',
    ascending: false,
    label: 'Admissions',
  },
  discharges: {
    apply: (q, r) =>
      q
        .not('discharge_date', 'is', null)
        .gte('discharge_date', r.startISO)
        .lt('discharge_date', r.endISO),
    dateCol: 'discharge_date',
    ascending: false,
    label: 'Discharges',
  },
  admitted: {
    // Live: admitted and not yet discharged, regardless of the selected period.
    // Oldest first, so long-stay and never-discharged records surface at the top.
    apply: (q) => q.not('admission_date', 'is', null).is('discharge_date', null),
    dateCol: 'admission_date',
    ascending: true,
    label: 'Currently Admitted',
    live: true,
  },
};

export const METRIC_LABELS: Record<DirectorMetric, string> = {
  opd: VISIT_METRICS.opd.label,
  admissions: VISIT_METRICS.admissions.label,
  discharges: VISIT_METRICS.discharges.label,
  admitted: VISIT_METRICS.admitted.label,
  collections: 'Advance / Collections',
};

/** The hospital_name values the dashboard reports on. */
export const DIRECTOR_HOSPITALS = ['hope', 'ayushman'] as const;
