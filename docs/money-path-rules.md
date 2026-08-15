# Rules for touching money

Written 15 August 2026, after a week in which four payment vouchers were
silently destroyed, every bill failed to save for eighteen days, payouts were
deducted from every handover for ever, and one afternoon's change made every
payment fail outright.

None of those were careless typing. Each was a reasonable-looking change whose
failure mode was invisible. These are the rules that would have prevented them.

## 1. Enforce at entry, never at commit

A rule that runs at `COMMIT` does not refuse work — it **unwinds** it.

The party-mobile rule was a `DEFERRABLE INITIALLY DEFERRED` constraint trigger.
A payment voucher is written in two transactions: the header, then the lines,
with the ledger posting hanging off a trigger on the lines. The check fired
after the posting had been written inside that second transaction, so Postgres
rolled the second transaction back — lines and posting both — while the header,
already committed, survived. The cashier saw the voucher in the list. The books
never got it.

**Put the check in the same transaction as the human's action, before anything
is written.** A `BEFORE INSERT` trigger on the row the person is creating
refuses cleanly: they see a message and nothing is half-saved.

A deferred check is only safe for a **reference** between two rows written in
the same transaction — for example `bill_content.bill_id`. There is no second
transaction to lose there, and a failure rolls the pair back together.

## 2. A trigger must not write a child row BEFORE its parent exists

`capture_bill_content` was `BEFORE INSERT` on `bills` and inserted into
`bill_content`, whose foreign key points back at `bills`. During `BEFORE
INSERT` the parent row does not exist, so the reference failed and took the
whole insert with it. Every bill from 28 July to 15 August.

It was invisible because `bills.bill_patient_data` defaults to `'{}'::jsonb`,
so the trigger's `IS NOT NULL` guard passed on every insert including the ones
carrying no snapshot at all.

**Write the child in an `AFTER` trigger, or defer the reference check.** And
when guarding on "is there anything here", remember that an empty object, an
empty array and a zero are all *not null*.

## 3. Rebuild a function from the live database, never from a migration

`record_expense_bill_payment` was rebuilt from the migration that last defined
it. The live function had since gained two arguments, so instead of replacing
it the change created a **second overload** — and PostgREST, unable to choose,
failed every payment.

Worse: the guard being added went onto the overload nobody calls. Approval was
switched on and enforced nothing. That only surfaced because the ambiguity
broke payments loudly; a guard on a dead overload is otherwise silent for ever.

**Use `pg_get_functiondef()` against the live database.** A migration file is
what the function looked like the day it was written, not what it is.

Note that `pg_get_functiondef` returns no trailing semicolon.

## 4. Model the lifecycle both ways

Receipts were claimed by a handover and left the pool. Payouts never were —
`claim_handover_sources` simply had no line for them. So the same payouts were
subtracted from every handover, for ever, and Hope's drawer read minus ₹10,050
and grew worse daily.

**If something enters a pool, write the code that takes it out — and the code
that puts it back when the claim is undone.** Test the return path; it is the
one nobody exercises.

## 5. A rule that can stop the hospital goes behind a switch

Two rules this week had to be switched off in a hurry. Both were behind a
one-row boolean, so it took one statement and no deploy.

```sql
UPDATE public.voucher_party_mobile_settings  SET enforced = false WHERE id;
UPDATE public.expense_bill_approval_settings SET enforced = false WHERE id;
```

**Default it off. Turning it on is a decision, not a side effect of installing
it.** And measure the blast radius on live data before switching: "53% of
today's payments would have been refused" is a fact you can act on, "4,718
ledgers lack a number" is not.

## 6. Never resolve a ledger by name alone

`adamrit_ledger_by_name` matches active ledgers by name, then falls back to a
hard-coded account code. When the 2 August merge renamed "Cash (HOPE)", every
payment voucher fell through to code `1110` — a deactivated ledger owned by no
company. 8,441 entries landed on a dead account.

Ayushman has no "Ambulance" ledger, so its vouchers borrowed DRM Hope's, and
₹1.48 lakh straddled two companies: one report shows the debit, the other the
credit, and neither balances.

**Resolve inside the voucher's own company, require the ledger to be active,
and if it does not resolve, land somewhere real and warn — never on a fallback
code that filters neither.**

## 7. Failures must be visible to the person who caused them

Bills failed for eighteen days behind a `console.error` in a `useEffect`.

Every Supabase call now passes through `reportingFetch`
(`src/integrations/supabase/loudFailures.ts`), which shows a "Not saved" toast
for any failed write. **Do not add a write path that swallows its error**, and
do not remove that reporter to quieten a noisy screen — fix the screen.

## Before you ship a change to cash, billing or payments

```
npm run check:migrations          # the patterns above, advisory
npm run test:money-paths          # ten checks, each from a real failure
npm run test:loud-failures        # the reporter itself
```

Run them before and after. They take about two seconds together.
