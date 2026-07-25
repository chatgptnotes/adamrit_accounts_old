# Backfilling the bill accrual — options and the reconciliation problem

**Status:** decision needed before any historical bill is approved in bulk.
**Audience:** whoever signs off the hospital's books, plus whoever runs the migration.

## Background

As of 25 July 2026 the ledger accrues a patient bill when it is approved
(`supabase/migrations/20260726130000_post_bill_vouchers.sql`, extended by
`20260726150000`). Both posting paths are proven in production and balance to
the rupee.

Everything before that date was recorded on a **cash basis**: nothing was
posted when a bill was raised, only when money arrived. That leaves ~373 real
bills worth ₹1.63 crore with no receivable in the books.

The question is whether to bring that history in, and if so how.

## A pre-existing problem this surfaced

Under the old logic the two receipt paths were:

```
Advance received      Dr Bank            Cr 2110 Patient Advance   (a liability)
Final payment         Dr Bank            Cr 4160 Hospital Services Income
```

Nothing ever converted the advance from a liability into income, because that
conversion is exactly what a bill accrual does — and there wasn't one. So for
every patient who paid an advance:

- **Income is understated** by the advance amount.
- **`2110 Patient Advance` is overstated** by the same amount, and has been
  accumulating since the system went live.

This is independent of the backfill decision and is worth quantifying either
way:

```sql
SELECT round(sum(e.credit_amount) - sum(e.debit_amount), 2) AS advance_liability
  FROM voucher_entries e
  JOIN chart_of_accounts a ON a.id = e.account_id
  JOIN vouchers v          ON v.id = e.voucher_id
 WHERE a.account_code = '2110'
   AND v.status = 'AUTHORISED';
```

Whatever that number is, it is sitting on the balance sheet as money the
hospital supposedly owes patients, and a corresponding amount is missing from
income.

## The reconciliation problem

Historical patients have **already paid** under the old logic, and those
payments credited income — not their ledger. So accruing their bill now creates
a receivable that nothing settles, and recognises the income a second time.

Worked example. Patient with a ₹1,00,000 bill: ₹30,000 advance, ₹70,000 paid at
discharge, all before the cutover.

**What the books hold today**

| Account | Dr | Cr |
|---|---|---|
| Bank | 1,00,000 | |
| 2110 Patient Advance | | 30,000 |
| 4160 Income | | 70,000 |

Income recognised: ₹70,000 — ₹30,000 short, as described above.

**If the bill is naively backfilled**

| Account | Dr | Cr |
|---|---|---|
| Patient ledger (SV) | 1,00,000 | |
| Income (SV) | | 1,00,000 |
| 2110 (JV) | 30,000 | |
| Patient ledger (JV) | | 30,000 |

Now: income = ₹1,70,000 (overstated by ₹70,000), and the patient shows
**₹70,000 outstanding that they have already paid**. Both wrong.

**The correcting entry**

```
Dr  4160 Hospital Services Income     70,000     -- the amount already received
      Cr  Patient ledger                 70,000
```

Result: income ₹1,00,000 ✓, patient ₹0 ✓, bank ₹1,00,000 ✓, advance liability
cleared ✓. One entry fixes both errors, because they are the same error seen
from two sides.

The debit must go to **whichever income account the original receipt actually
credited** — usually `4160`, but older vouchers fell back to `4000 INCOME`. It
should be derived from the existing receipt vouchers' entries, not assumed.

## The options

### Option A — Forward only

Accrue nothing historical. Bills approved from the cutover date onward post
normally; everything before stays as it is.

- **For:** zero risk, no migration, no reconciliation, prior periods untouched.
- **Against:** the ₹1.63 crore of historical billing never appears. Unpaid old
  debts stay invisible, which is the single thing this project set out to fix.
  The advance-liability distortion above remains uncorrected.

### Option B — Opening balances for open items only (recommended)

Do not replay history as dated sales vouchers. Instead, on the cutover date,
post one journal per patient for **what they still owe**, and leave settled
bills alone entirely.

```
Dr  Patient ledger        outstanding amount
      Cr  <contra account>    outstanding amount
```

- **For:** this is the standard way to migrate cash-basis books onto accrual.
  Prior-period P&L is not restated. The balance sheet gains a true receivables
  figure. Volume is small — only unpaid bills. No reconciliation entries needed
  for settled bills, because they are simply never accrued.
- **Against:** historical bills carry no per-bill voucher trail, only a per-patient
  opening balance. Partially paid bills still need care — accrue only the unpaid
  remainder, not the whole bill.
- **Open question for the accountant:** the contra account. Crediting income
  puts prior-period revenue into the current period. Crediting
  `3200 Retained Earnings` treats it as the prior-period adjustment it really
  is, keeping current-period income clean. **This has tax implications and is
  not my call to make.**

### Option C — Full historical accrual with reconciliation

Approve every historical bill so each posts its real dated vouchers, then post
the correcting entry above for every payment already received.

- **For:** complete, auditable, per-bill trail. The ledger tells the whole story.
- **Against:** restates the P&L of periods that may already be closed and filed,
  which is usually unacceptable once returns are submitted. Largest volume —
  roughly 373 sales vouchers plus advance journals plus reconciliation journals.
  Every reconciliation must derive its debit account from the original voucher.

**Only viable if the books for those periods have not been closed.** That is a
question of fact I cannot answer from the database.

## Recommendation

**Option B**, with the contra account confirmed by your accountant before
anything is posted.

It delivers what the project was for — knowing who owes the hospital money —
without rewriting history that may already be filed. Option C is strictly more
work for a benefit (per-bill historical vouchers) that is rarely worth
restating closed periods. Option A is only right if the historical receivables
are known to be uncollectable or already written off elsewhere.

Separately, and regardless of which option is chosen, the `2110` distortion
should be corrected once, deliberately, with an entry your accountant approves.

## What Option B needs, technically

1. **A cutover date**, agreed and recorded.
2. **A query** listing each patient's outstanding position at that date:
   bill total, less advances, less final payments — from `bills`,
   `advance_payment` and `final_payments`. This needs review before it is
   trusted, because it is only as good as the bill totals underneath it.
3. **One journal voucher per patient**, `Dr PT<uid> / Cr <contra>`, dated at
   cutover, tagged so it can be identified and reversed as a batch if the
   figures turn out wrong.
4. **A guard** so the forward-looking trigger does not later accrue a bill that
   was already included in an opening balance — otherwise the same debt is
   counted twice. Simplest form: only accrue bills dated after the cutover.

Point 4 is the one most likely to be missed and would be expensive to unpick
afterwards.

## Still unproven in the current implementation

Not blockers for this decision, but they should be exercised before the system
is relied on:

- **V3, the payer split**, has never fired — no corporate is mapped to a ledger
  (`corporate.ledger_account_id` is NULL for all but exact name matches). Until
  those are filled in, scheme and corporate receivables sit on individual
  patients rather than on the payer.
- **The discount leg** has never posted. The fallback path never books one at
  all, since only `financial_summary` carries a discount figure.
- **The receipt change** — final payments now crediting the patient ledger
  instead of income — has not been exercised since it went live.
