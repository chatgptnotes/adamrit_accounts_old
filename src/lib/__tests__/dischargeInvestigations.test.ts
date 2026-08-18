import { describe, expect, it } from 'vitest';
import {
  buildInvestigationGroups,
  formatInvestigations,
  formatLine,
  type LabResultRow,
} from '../dischargeInvestigations';

const row = (o: Partial<LabResultRow>): LabResultRow => ({
  test_name: 'Blood Urea',
  main_test_name: 'KFT (Kidney Function Test)',
  result_value: '39.3',
  result_unit: 'mg/dl',
  reference_range: '15 - 45 mg/dl',
  created_at: '2026-02-23T08:00:00.000Z',
  ...o,
});

describe('duplicates — the same reading written many times', () => {
  it('collapses a reading the lab wrote seventeen times on one day to one line', () => {
    // Real shape: one live visit held Globulin 3.52 seventeen times on 23-Feb.
    const rows = Array.from({ length: 17 }, () =>
      row({ test_name: 'Globulin', result_value: '3.52', result_unit: 'g/dl' }),
    );
    const groups = buildInvestigationGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(1);
  });

  it('keeps a DIFFERENT value on the same day — that is a real repeat reading', () => {
    const groups = buildInvestigationGroups([
      row({ result_value: '39.3' }),
      row({ result_value: '44.1' }),
    ]);
    expect(groups[0].lines.map((l) => l.value)).toEqual(['39.3', '44.1']);
  });

  it('keeps the same test on another date, under that date', () => {
    const groups = buildInvestigationGroups([
      row({ created_at: '2026-02-23T08:00:00.000Z', result_value: '39.3' }),
      row({ created_at: '2026-02-26T08:00:00.000Z', result_value: '31.0' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lines[0].value).toBe('39.3');
    expect(groups[1].lines[0].value).toBe('31.0');
  });
});

describe('chronology', () => {
  it('reads oldest first, as the stay progressed', () => {
    const groups = buildInvestigationGroups([
      row({ created_at: '2026-02-26T08:00:00.000Z' }),
      row({ created_at: '2026-02-21T08:00:00.000Z' }),
      row({ created_at: '2026-02-23T08:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.isoDate)).toEqual(['2026-02-21', '2026-02-23', '2026-02-26']);
  });
});

describe('reference range', () => {
  it('is printed, so a reader can tell normal from abnormal', () => {
    expect(formatLine({ testName: 'Blood Urea', value: '39.3', unit: 'mg/dl', referenceRange: '15 - 45 mg/dl' }))
      .toBe('Blood Urea: 39.3 mg/dl (ref 15 - 45 mg/dl)');
  });

  it('is simply omitted when the lab did not record one', () => {
    expect(formatLine({ testName: 'ESR', value: '55', unit: 'mm/hr', referenceRange: '' }))
      .toBe('ESR: 55 mm/hr');
  });
});

describe('nothing is invented', () => {
  it('drops a row with no result rather than printing N/A', () => {
    expect(buildInvestigationGroups([row({ result_value: '' })])).toEqual([]);
    expect(buildInvestigationGroups([row({ result_value: null })])).toEqual([]);
  });

  it('drops a row with no test name', () => {
    expect(buildInvestigationGroups([row({ test_name: '' })])).toEqual([]);
  });

  it('drops a row with no date, which could not be placed in the stay', () => {
    expect(buildInvestigationGroups([row({ created_at: null })])).toEqual([]);
  });

  it('returns an empty string for no results, never a placeholder that reads like one', () => {
    expect(formatInvestigations([])).toBe('');
  });
});

describe('grouping', () => {
  it('groups by the lab panel within a date', () => {
    const groups = buildInvestigationGroups([
      row({ main_test_name: 'KFT (Kidney Function Test)', test_name: 'Blood Urea' }),
      row({ main_test_name: 'KFT (Kidney Function Test)', test_name: 'Creatinine', result_value: '1.03' }),
      row({ main_test_name: 'CBC', test_name: 'Haemoglobin', result_value: '11.2' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.category === 'CBC')!.lines).toHaveLength(1);
    expect(groups.find((g) => g.category.startsWith('KFT'))!.lines).toHaveLength(2);
  });

  it('falls back to the category, then to General Tests', () => {
    expect(buildInvestigationGroups([row({ main_test_name: null, test_category: 'HEMATOLOGY' })])[0].category)
      .toBe('HEMATOLOGY');
    expect(buildInvestigationGroups([row({ main_test_name: null, test_category: null })])[0].category)
      .toBe('General Tests');
  });

  it('formats a date-headed block', () => {
    const text = formatInvestigations([row({})]);
    expect(text).toContain('23/02/2026');
    expect(text).toContain('KFT (Kidney Function Test)');
    expect(text).toContain('Blood Urea: 39.3 mg/dl (ref 15 - 45 mg/dl)');
  });
});
