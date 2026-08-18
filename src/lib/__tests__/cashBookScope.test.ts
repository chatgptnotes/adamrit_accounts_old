import { describe, expect, it } from 'vitest';
import { cashBookScope, hospitalFilterFor, NO_HOSPITAL_SENTINEL } from '../cashBookScope';

describe('cashBookScope — a company is not a hospital', () => {
  it('maps Ayushman to the ayushman hospital, without pharmacy', () => {
    const s = cashBookScope('ayushman_nagpur', 'hope');
    expect(s.hospitalName).toBe('ayushman');
    expect(s.includeHospital).toBe(true);
    expect(s.includePharmacy).toBe(false);
  });

  it('maps DRM Hope to the hope hospital, without pharmacy', () => {
    // The old code used the key itself, so this filtered on "drm_pvt_ltd" and
    // came back completely empty.
    const s = cashBookScope('drm_pvt_ltd', 'hope');
    expect(s.hospitalName).toBe('hope');
    expect(s.includePharmacy).toBe(false);
  });

  it('gives Hope Pharmacy the pharmacy sources and none of the hospital ones', () => {
    const s = cashBookScope('hope_pharmacy', 'hope');
    expect(s.includePharmacy).toBe(true);
    expect(s.includeHospital).toBe(false);
  });

  it('gives M.L. Enterprises no cash sources at all', () => {
    const s = cashBookScope('ml_enterprises', 'hope');
    expect(s.includeHospital).toBe(false);
    expect(s.includePharmacy).toBe(false);
  });

  it('falls back to the signed-in hospital when nothing is selected', () => {
    const s = cashBookScope('', 'ayushman');
    expect(s.hospitalName).toBe('ayushman');
    expect(s.includeHospital).toBe(true);
    expect(s.includePharmacy).toBe(true);
  });

  it('shows nothing for a company it does not know, rather than everything', () => {
    const s = cashBookScope('some_new_company', 'hope');
    expect(s.includeHospital).toBe(false);
    expect(s.includePharmacy).toBe(false);
  });

  it('is case and whitespace tolerant', () => {
    expect(cashBookScope('  HOPE_PHARMACY ', 'hope').includePharmacy).toBe(true);
  });
});

describe('hospitalFilterFor', () => {
  it('returns the real hospital name for a hospital company', () => {
    expect(hospitalFilterFor(cashBookScope('drm_pvt_ltd', 'hope'), 'hope')).toBe('hope');
  });

  it('returns a name that matches nothing when the company owns no hospital rows', () => {
    // Pharmacy rows carry hospital_name "hope"; without this the pharmacy
    // company would pull in Hope's whole hospital cash book as well.
    expect(hospitalFilterFor(cashBookScope('hope_pharmacy', 'hope'), 'hope')).toBe(NO_HOSPITAL_SENTINEL);
    expect(hospitalFilterFor(cashBookScope('ml_enterprises', 'hope'), 'hope')).toBe(NO_HOSPITAL_SENTINEL);
  });

  it('falls back to the signed-in hospital when none is selected', () => {
    expect(hospitalFilterFor(cashBookScope('', 'ayushman'), 'ayushman')).toBe('ayushman');
  });
});

describe('companies with no cash counter', () => {
  it('gives Hope Multispeciality no counter sources — its books come from bank statements', () => {
    const s = cashBookScope('hope_multispeciality', 'hope');
    expect(s.includeHospital).toBe(false);
    expect(s.includePharmacy).toBe(false);
  });

  it('is listed explicitly, so its empty cash book is a stated fact not a fallback', () => {
    // Distinguishable from an unknown company only by being in the table at
    // all; both show nothing, but this one is intended to.
    expect(cashBookScope('hope_multispeciality', 'hope')).toEqual(
      cashBookScope('ml_enterprises', 'hope'),
    );
  });
});
