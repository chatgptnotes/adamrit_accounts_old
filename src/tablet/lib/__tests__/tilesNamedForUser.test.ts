import { describe, expect, it } from 'vitest';
import { candidateNames, tileIsNamedFor, tilesNamedForUser } from '../tilesNamedForUser';

// Real labels from src/tablet/config/modules.ts.
const TILES = [
  { id: 'accounts-tilak', label: 'Accounts (Tilak)' },
  { id: 'payment-collection-gaurav', label: 'Payment Collection (Vasooli) - Gaurav' },
  { id: 'ot-schedule', label: 'OT Schedule - Gaurav' },
  { id: 'rmo-duty', label: 'RMO Duty - Gaurav' },
  { id: 'quick-pay-avni', label: 'Quick Pay - Avni' },
  { id: 'extra-charges-reena', label: 'Extra Charges (Private Room) - Reena' },
  { id: 'dialysis-rakesh', label: 'Dialysis - Rakesh' },
  { id: 'dialysis-billing', label: 'Dialysis Billing - Shashank' },
  { id: 'cash-handover', label: 'Cash Handover' },
  { id: 'patient-feedback', label: 'Patient Feedback' },
];

describe('candidateNames', () => {
  it('takes the name out of a plain login id', () => {
    expect(candidateNames({ username: 'gaurav', email: 'gaurav@gmail.com' })).toContain('gaurav');
  });

  it('strips digits, so a numbered address still yields the name', () => {
    expect(candidateNames({ email: 'avni123@gmail.com' })).toContain('avni');
  });

  it('splits on dots and underscores', () => {
    expect(candidateNames({ email: 'ram.tilak@hope.com' })).toEqual(
      expect.arrayContaining(['tilak']),
    );
  });

  it('ignores anything shorter than four letters, which would match too much', () => {
    expect(candidateNames({ email: 'ot@hope.com' })).toEqual([]);
    expect(candidateNames({ username: 'cmd', email: 'cmd@hopehospital.com' })).toEqual([]);
  });

  it('returns nothing for no user, rather than throwing', () => {
    expect(candidateNames(null)).toEqual([]);
    expect(candidateNames(undefined)).toEqual([]);
  });
});

describe('tileIsNamedFor', () => {
  it('matches a name in brackets', () => {
    expect(tileIsNamedFor('Accounts (Tilak)', ['tilak'])).toBe(true);
  });

  it('matches a name after a dash', () => {
    expect(tileIsNamedFor('OT Schedule - Gaurav', ['gaurav'])).toBe(true);
  });

  it('does not match a fragment inside a longer word', () => {
    // "reen" must not find "Reena", and "ash" must not find "Shashank".
    expect(tileIsNamedFor('Extra Charges (Private Room) - Reena', ['reen'])).toBe(false);
    expect(tileIsNamedFor('Dialysis Billing - Shashank', ['ashan'])).toBe(false);
  });

  it('does not match an unrelated tile', () => {
    expect(tileIsNamedFor('Cash Handover', ['gaurav'])).toBe(false);
  });

  it('matches nothing when the person has no usable name', () => {
    expect(tileIsNamedFor('OT Schedule - Gaurav', [])).toBe(false);
  });
});

describe('tilesNamedForUser', () => {
  it("finds all three of Gaurav's tiles", () => {
    const mine = tilesNamedForUser(TILES, { username: 'gaurav', email: 'gaurav@gmail.com' });
    expect(mine).toEqual(new Set(['payment-collection-gaurav', 'ot-schedule', 'rmo-duty']));
  });

  it("finds Avani's tile from the address she actually logs in with", () => {
    const mine = tilesNamedForUser(TILES, { username: 'avni', email: 'avni@gmail.com' });
    expect(mine.has('quick-pay-avni')).toBe(true);
  });

  it('gives a user with no named tile an empty set, leaving the grid as it was', () => {
    const mine = tilesNamedForUser(TILES, { username: 'someone', email: 'someone@hope.com' });
    expect(mine.size).toBe(0);
  });

  it('does not sweep the grid for a short or generic login', () => {
    expect(tilesNamedForUser(TILES, { username: 'cmd', email: 'cmd@hopehospital.com' }).size).toBe(0);
  });

  it('never claims a tile that names somebody else', () => {
    const mine = tilesNamedForUser(TILES, { username: 'tilak', email: 'tilak@hope.com' });
    expect(mine.has('accounts-tilak')).toBe(true);
    expect(mine.has('ot-schedule')).toBe(false);
  });
});
