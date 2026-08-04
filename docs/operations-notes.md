# Operations notes — accounting, allocation and panel workflows

Working knowledge that is not obvious from the code: decisions the owner has
made, traps that have already cost time, and the invariants the books rely on.
Read this before changing anything in accounting, the Daily Payment
Allocation, or the government-portal flows.

Last substantially updated: 4 August 2026.

---

## 1. The books

### The 25-July-2026 cutover is the beginning of time
Accounting went live on 2026-07-25 with opening balances taken from Tally.
Ledger data from before that date is **not** the book of record — do not
"reconcile" against it.

### Opening balances were restated from Tally on 4-Aug-2026
Three Tally ledger-master exports (UTF-16 JSON, `tallymessage` array) are the
authority. **Tally's export convention is `positive = CREDIT`**, so the true
Dr-positive value is `-openingbalance`. Getting this backwards is what left
Ayushman's and Hope Pharmacy's openings inside-out for weeks (assets sitting
as credits).

| Company | Status |
|---|---|
| DRM Hope | matched Tally already; only the TDS AY/FY split was restored |
| Ayushman Nagpur | 468 ledgers replaced (sign-flip fixed), 2 created |
| Hope Pharmacy | 20 replaced, 1 created |
| Hope Hospitals (legacy partnership) | **not restated** — no export supplied; keeps its ~₹54.3L imbalance by decision |

Pre-change values are preserved in `opening_balance_backup_20260804`.
Each restated company's active openings now sum to exactly zero.

When the legacy Hope export arrives: restate it the same way, then remove the
`company_key <> 'hope_partnership'` exclusion from `run_books_health_checks()`
so its openings are watched like the others.

### Suspense accounts are no longer "the import gap"
The old story — each suspense equals its company's missing-ledger gap — is
superseded for the three restated companies. Ayushman's ₹44.63L
"Suspenses A/c" is a **real ledger inside Tally**, not an artefact of import.

### Books health checks
`run_books_health_checks()` runs daily (first person to open the app triggers
it via `notify_books_health()`) and files findings in the notification bell
under "Books Check", deduped to once a day per finding. It checks:

- each company's openings still net to zero (legacy Hope exempt)
- no authorised voucher is unbalanced
- no **one-off** allocation record is still active 14+ days after its send
- no duplicate active ledgers
- discharge status and `is_discharged` agree

**A check that cries wolf is worse than no check.** The first version flagged
13 legitimate recurring masters (Electricity, TDS, Surgeon Fees…) which are
paid through the allocation sheet, never through a schedule row. If you add a
check, tune it against live data until a healthy system returns zero rows,
then confirm it still catches a planted problem.

---

## 2. Daily Payment Allocation

### One owner, one pool
The page defaults to **All Hospitals (merged)** — Hope and Ayushman together,
each row tagged with its hospital; payment records the row's own hospital.
Per-hospital actions (saving the day, adding an obligation, RMO sync, staff
import, the Daily Allocation sheet and Monthly Obligation tabs) require a
specific hospital and say so.

### Obligations must be able to end
`payment_obligations.active_until` is the last day an obligation is scheduled;
`expire_due_obligations()` deactivates it afterwards and skips future pending
rows. It runs before every schedule generation.

**Why this exists:** 27 one-off records from a 27-July allocation send stayed
active and regenerated **₹5.85 lakh per day** of phantom rows for weeks. Any
fixed-run payment (e.g. two months' rent) must carry an end date.

### Two kinds of obligation, do not confuse them
- **Master template** — recurring, paid via the Daily Allocation sheet each
  day. Its generated schedule rows are not displayed.
- **One-off execution record** — created per "send", marked in `notes`
  (`DAILY_ALLOCATION_EXECUTION:<date>`). Should be short-lived; one still
  active weeks later is a bug.

Today's Allocation displays only rows whose `notes` start with
`DAILY_ALLOCATION_SENT:`.

### GANDHI LAB and Gandhi Research Institute are NOT the same party
Research Institute is **rent** for Dr. Pramod Kanti's premises; Gandhi Lab is
**per-case lab charges** billed case to case. Two ledgers, deliberately.
Never merge them.

---

## 3. Ledgers

### Duplicates are blocked at creation
A unique index on (company, normalized active account name) refuses a second
active ledger with the same name. Merged stubs keep their names (they are
inactive); the same name in a different company is still allowed.

### Merging is `merge_ledger(loser, survivor)`
It moves transactions, every known reference, and the opening balance, then
leaves the loser inactive and renamed `… (merged DD Mon YY)`. Nothing is
deleted. **When adding a table that references `chart_of_accounts(id)`, add it
to this function** or a future merge will orphan those rows.

Survivor policy used for the bulk merges: app-generated patient ledger (`PT…`)
first — triggers recreate it otherwise — then most transactions, then a Tally
opening balance, then the older row.

### Spelling variants need a human
Exact duplicates can be merged mechanically. Variants ("Dr Murali" / "Dr
Murali sir") must be confirmed by the owner: some near-identical names are
genuinely different people (Swapnil **Kale** vs Swapnil **Kamble** are two
people and stay separate; so do "Medicine Pur 12%" and "18%", which are GST
rates).

### Renaming a ledger can collide with the Tally mirror
A trigger upserts `tally_ledgers` by (company, name) while a unique index
constrains (company, accounting_account_id). If a mirror row's name has
drifted from its ledger, a rename raises a duplicate-key error — delete the
stale mirror first; the trigger rebuilds it.

---

## 4. Government-portal (PMJAY / MJPJAY) reconciliation

### The portal carries two different identifiers
| Portal field | Meaning | Where it belongs |
|---|---|---|
| **Program ID** (`MQXFW6U00`) | the beneficiary, stable across admissions | `patients.pmjay_program_id` |
| **Registration ID** (`2026070110058001`) | one admission/case | `visits.yojana_registration_id` |

They are not interchangeable. The registration ID is now **required at
admission** for Yojana panels (desktop `VisitRegistrationForm` and the tablet
register flow); use `isYojanaPanel()` from `src/lib/yojanaPanel.ts` rather
than re-copying the regex.

### Names drift; keys do not
Portal spellings differ from ours ("Vrandavan Shukl" for "Vrindavan Shukla"),
which once kept a deceased, discharged patient in the "Extension Needed"
alerts indefinitely. `isDischargedPatient()` falls back to a **deliberately
strict** near-identical name match (8+ characters, same first letter, length
gap ≤ 2, Levenshtein ≤ 1, or ≤ 2 for names of 12+ characters; every fuzzy
match is logged).

**Do not loosen these thresholds.** A false match *hides* a patient who still
needs action — the dangerous direction. Fix the missing key instead.

### Discharge state has three columns
`status`, `is_discharged` and `discharge_date` can drift (133 IPD visits had
done so). The portal alert filter reads **`is_discharged`**; the health check
now watches for drift.

---

## 5. Surgery fees

`surgery_fee_master` drives the OT bill auto-fill. Every row was seeded at
panel 5,000 / private 8,000 — a placeholder indistinguishable from a
decision, and payable by mistake. Placeholders are now **NULL**, shown as
"Not set", and the column defaults are dropped so the seed cannot return.
A NULL fee produces a ₹0 bill that Specialist Payouts flags as needing an
amount, so a human prices it.

Priority when two sources disagree: the owner's **PMJAY common-surgery list**
beats the older "Surgery List with Software Rates" PDF.

Fees flow: OT marked done → doctor bill pre-filled from this master → the OT
desk may negotiate the amount **down, never up** (raising is management's call
on the Approvals screen) → Specialist Payouts → Daily Allocation.

---

## 6. Working practice for database changes

Migrations reach production by being pasted into the Supabase SQL Editor by
the owner — there is no direct connection. Every script must therefore be:

1. **transactional** (`BEGIN … COMMIT`) so a failure leaves nothing partial;
2. **idempotent** — genuinely safe to run twice;
3. **self-verifying** — the final statement shows whether it worked, in
   business terms (nets to zero, expected counts, affected rows);
4. **dry-run against the live schema first** — check for generated columns,
   unique constraints and triggers on the tables being touched;
5. **headed in plain English** — what it fixes, what it changes, what it
   deliberately leaves alone.

Three scripts failed on 4-Aug for causes a pre-flight would have caught: a
generated column (`daily_payment_schedule.total_due`), a trigger collision,
and a stray-text paste. One script at a time; verify independently
afterwards rather than trusting the editor's output alone.
