import { describe, it, expect } from 'vitest';
import { canCreateAccountingVouchers, canDepositCash, accountingDenied } from '@/lib/accounting-access';
import { canSeeOfficeTiles, canSeeVoucherTiles } from '@/lib/officeTileAccess';

const nisha = { role: 'receptionist', email: 'im.nishasharma@gmail.com' };
const shashank = { role: 'nurse', email: 'shashank@gmail.com' };
const shashankGoogle = { role: 'nurse', email: '007aryan.upgade@gmail.com' };
const rosterCashier = { role: 'radiology', email: 'someone@hope.com' };
const outsider = { role: 'nurse', email: 'nobody@hope.com' };

describe('19-Aug access instructions', () => {
  it('Nisha gets the books', () => {
    expect(canCreateAccountingVouchers(nisha)).toBe(true);
    expect(canSeeOfficeTiles(nisha)).toBe(true);
    expect(canSeeVoucherTiles(nisha)).toBe(true);
    expect(canDepositCash(nisha)).toBe(true);
  });
  it('any roster cashier gets the books', () => {
    expect(canCreateAccountingVouchers(rosterCashier, true)).toBe(true);
    expect(canSeeOfficeTiles(rosterCashier, true)).toBe(true);
    expect(canSeeVoucherTiles(rosterCashier, true)).toBe(true);
    expect(canDepositCash(rosterCashier, true)).toBe(true);
  });
  it('the cashier role alone is enough', () => {
    expect(canCreateAccountingVouchers({ role: 'cashier', email: 'x@y.com' })).toBe(true);
  });
  it('Shashank gets nothing, even on the roster', () => {
    for (const u of [shashank, shashankGoogle]) {
      expect(accountingDenied(u)).toBe(true);
      expect(canCreateAccountingVouchers(u, true)).toBe(false);
      expect(canSeeOfficeTiles(u, true)).toBe(false);
      expect(canSeeVoucherTiles(u, true)).toBe(false);
      expect(canDepositCash(u, true)).toBe(false);
    }
  });
  it('an outsider off the roster still gets nothing', () => {
    expect(canCreateAccountingVouchers(outsider)).toBe(false);
    expect(canSeeOfficeTiles(outsider)).toBe(false);
    expect(canDepositCash(outsider)).toBe(false);
  });
});
