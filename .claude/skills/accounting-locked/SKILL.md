---
name: Accounting module is locked
description: The accounting module (src/pages/Accounting.tsx, everything under src/components/accounting/, and the posting services accounting-voucher-service, approval-queue-service, rm-cut-payment-service) is frozen. Do NOT change vouchers, ledgers, reports or posting logic — and do NOT add new files to that folder — unless the user explicitly asks to change accounting.
source_project: adamrit
tags: [project-lock, frozen-page, accounting, vouchers, ledgers, do-not-touch]
---

# Accounting module is locked

## The Rule

Frozen — do not edit, refactor, reformat or extend without the owner's
explicit authorisation:

- `src/pages/Accounting.tsx`
- **everything** under `src/components/accounting/` (including `tally/`) —
  Voucher Entry, Day Book, Trial Balance, Balance Sheet, P&L, Ledger view,
  Chart of Accounts, Ledger/Group creation, Bank Reconciliation, Specialist
  Payouts, the Tally screens, and every report beside them
- `src/lib/accounting-voucher-service.ts`
- `src/lib/approval-queue-service.ts`
- `src/lib/rm-cut-payment-service.ts`

The guard (`scripts/check-accounting-locked.cjs`, run from `prebuild`) walks
the **tree**, not a fixed list: changing a file, **adding** one to the
accounting folder, or deleting one all fail `npm run build`. 79 files are
baselined today.

## Why

This is the hospital's book of record. These screens read and write the
ledgers the owner reconciles against Tally, and the posting services write
vouchers directly. A wrong journal or a mis-stated report is invisible until
month end — unlike a broken screen, which someone reports the same day.

The books currently balance exactly: every restated company's openings net to
zero, and `run_books_health_checks()` returns no findings. That state is worth
protecting.

## If a change IS authorised

1. Confirm with the owner.
2. Re-verify after the change, not just that it compiles:
   - each company's opening balances still net to zero;
   - no AUTHORISED voucher has debits ≠ credits;
   - Day Book, Trial Balance and Ledger views report the same figures;
   - `run_books_health_checks()` still returns zero rows.
3. Deploy: `ACCOUNTING_UNLOCK=1 npm run build`, then
   `node scripts/check-accounting-locked.cjs --update-baseline`, and commit
   `scripts/accounting-baseline.json` with the change.

## Related

- `.claude/skills/finalbill-locked/SKILL.md`
- `.claude/skills/registration-locked/SKILL.md`
- `.claude/skills/expensebill-locked/SKILL.md`
- `docs/operations-notes.md` — how the accounting flows fit together, the
  cutover, and the invariants the books rely on
