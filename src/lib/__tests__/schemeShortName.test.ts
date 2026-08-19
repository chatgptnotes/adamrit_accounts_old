import { describe, it, expect } from 'vitest';
import { schemeShortName, knownSchemeShortName } from '../schemeShortName';

// The twelve as the corporate master spells them today, misspellings and all.
const AS_STORED: Array<[string, string]> = [
  ['Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)', 'MJPJAY'],
  ['Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)', 'PM-JAY'],
  ['Rashtriya Bal Swasthya Karyakram (RBSK)', 'RBSK'],
  ['Central Government Health Scheme (CGHS)', 'CGHS'],
  ['Ex Serviceman Contributory Health Scheme (ECHS)', 'ECHS'],
  ['Maharashtra Police Kutumb Arogya Yojana (MPKAY)', 'MPKAY'],
  ['MIKSSKAY - Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana', 'MIKSSKAY'],
  ['Maharashtra Dharmadaya Karmachari Kutumbe Seashya Yojana (MDKKSY)', 'MDKKSY'],
  ['Coal India Limited (CIL)', 'CIL'],
  ['Central Railways (C.Rly)', 'CR'],
  ['South Eastern Central Railway (SECR)', 'SECR'],
  ['Western Coalfield Limited (WCL)', 'WCL'],
];

describe('schemeShortName — the names as stored today', () => {
  it.each(AS_STORED)('%s -> %s', (full, short) => {
    expect(schemeShortName(full)).toBe(short);
  });
});

describe('schemeShortName — survives the spelling being corrected', () => {
  // This is the whole point: these are the names AFTER 20260819230000 fixes
  // "jan" and "Yojna". The ten copied maps would each have missed them, and in
  // FinalBill that meant a corrupted bill number prefix.
  it('MJPJAY with Jan capitalised', () => {
    expect(schemeShortName('Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)')).toBe('MJPJAY');
  });

  it('PM-JAY with Yojana spelled properly', () => {
    expect(schemeShortName('Ayushman Bharat - Pradhan Mantri Jan Arogya Yojana (PM-JAY)'))
      .toBe('PM-JAY');
  });

  it('the short forms that were merged away still resolve, for old records', () => {
    expect(schemeShortName('MJPJAY')).toBe('MJPJAY');
    expect(schemeShortName('PMJAY')).toBe('PM-JAY');
    expect(schemeShortName('AB-PMJAY')).toBe('PM-JAY');
  });

  it('Jyotiba, the other transliteration', () => {
    expect(schemeShortName('Mahatma Jyotiba Phule Jan Arogya Yojana')).toBe('MJPJAY');
  });
});

describe('schemeShortName — the two Maharashtra kutumb schemes stay apart', () => {
  it('the prison scheme is not read as the police one', () => {
    expect(schemeShortName('MIKSSKAY - Maharashtra Karagruh Va Sudhar Sevabal Kutumb Arogya Yojana'))
      .toBe('MIKSSKAY');
  });
  it('and the police one is not read as the prison one', () => {
    expect(schemeShortName('Maharashtra Police Kutumb Arogya Yojana (MPKAY)')).toBe('MPKAY');
  });
});

describe('schemeShortName — unchanged behaviour for everything else', () => {
  it('no panel is PRIVATE, which is what a bill number needs', () => {
    expect(schemeShortName('')).toBe('PRIVATE');
    expect(schemeShortName(null)).toBe('PRIVATE');
    expect(schemeShortName(undefined)).toBe('PRIVATE');
    expect(schemeShortName('private')).toBe('PRIVATE');
    expect(schemeShortName('Private')).toBe('PRIVATE');
  });

  it('an unknown panel is upper cased and hyphenated, exactly as before', () => {
    expect(schemeShortName('MaxBupa Health Insurance Co. Ltd.'))
      .toBe('MAXBUPA-HEALTH-INSURANCE-CO.-LTD.');
    expect(schemeShortName('MECL (Mineral Exploration Corporation Ltd)'))
      .toBe('MECL-(MINERAL-EXPLORATION-CORPORATION-LTD)');
  });
});

describe('knownSchemeShortName — null lets each caller keep its own fallback', () => {
  it('names a known scheme', () => {
    expect(knownSchemeShortName('Mahatma Jyotirao Phule jan Arogya Yojana (MJPJAY)')).toBe('MJPJAY');
  });

  it('is null for a panel outside the twelve, so the caller decides', () => {
    expect(knownSchemeShortName('MaxBupa Health Insurance Co. Ltd.')).toBeNull();
    expect(knownSchemeShortName('')).toBeNull();
    expect(knownSchemeShortName(null)).toBeNull();
  });
});
