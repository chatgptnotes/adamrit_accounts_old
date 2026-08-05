---
name: Expense Bill pages are locked
description: The Expense Bill screens (src/pages/ExpenseBills.tsx, the tablet expense-bills module, and src/lib/referral-invoice-service.ts) are frozen. Do NOT change their payment logic, RPC arguments, invoice generation, filters or move-to-allocation behaviour unless the user explicitly asks to change expense bills.
source_project: adamrit
tags: [project-lock, frozen-page, accounting, expense-bill, payments, do-not-touch]
---

# Expense Bill pages are locked

## The Rule

These files are frozen. Do not edit, refactor or "improve" them unless the
user explicitly authorises a change to the expense bill flow:

- `src/pages/ExpenseBills.tsx` — the desktop register, filters, Pay dialog,
  move-to-Daily-Allocation, and the OPD/IPD referral sections
- `src/tablet/modules/expense-bills/ExpenseBillsFlow.tsx`
- `src/tablet/modules/expense-bills/useExpenseBills.ts` — the record + pay
  mutations, including the `record_expense_bill_payment` arguments
- `src/tablet/modules/expense-bills/BillPaymentSheet.tsx`
- `src/tablet/modules/expense-bills/ImplantReferralApproval.tsx`
- `src/tablet/modules/expense-bills/useImplantReferral.ts`
- `src/lib/referral-invoice-service.ts` — generates the M.L. Enterprises
  invoice and calls the dual-entity posting RPC

A `prebuild` guard (`scripts/check-expensebill-locked.cjs`) SHA256-checks all
seven and fails `npm run build` on any change.

## Why

These screens move real money out of the hospital: they record supplier
invoices, post the accounting entries, raise the M.L. Enterprises referral
invoices in two companies' books, and settle bills against cash or bank. A
mistake pays a vendor twice or mis-posts a journal, and nobody sees it until
the books are reconciled — a live example already exists in these books
(₹5,000 paid twice to one vendor because a manual voucher carried no bill
reference).

## If a change IS authorised

1. Confirm with the owner.
2. Re-check the money paths specifically:
   - the Pay dialog cannot overpay a bill, and a part payment reopens with the
     correct remaining balance (not the previous entry);
   - desktop and tablet payment paths still agree;
   - `record_expense_bill_payment` is called with the arguments the **deployed**
     database function expects (its signature has changed twice — remarks, then
     signed-voucher path/url);
   - a moved bill still reaches the Daily Payment Allocation with its hospital
     and supplier ledger intact.
3. Deploy: `EXPENSEBILL_UNLOCK=1 npm run build`, then
   `node scripts/check-expensebill-locked.cjs --update-baseline`, and commit
   `scripts/expensebill-baseline.json` with the change.

## Related

- `.claude/skills/finalbill-locked/SKILL.md` — `src/pages/FinalBill.tsx`
- `.claude/skills/registration-locked/SKILL.md` — the registration forms
- `docs/operations-notes.md` — how the accounting flows fit together
