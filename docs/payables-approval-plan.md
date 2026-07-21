# Payables Approval → Auto JV → Payment Voucher (inside the Tally page)

## Context

You use Tally but hand-build every routine voucher — vendor bills, doctor surgery fees, staff
salaries. Goal: automate it inside Adamrit's existing Tally-style page. A JV posts automatically
the moment management approves a bill; a payment voucher is generated later when the party
collects money.

Flow (identical for **VENDOR / DOCTOR / SALARY**, only the ledgers differ):
1. Bill added to an approval queue (party, reference, amount, expense ledger, party ledger, invoice photo).
2. Management opens the **Approvals** tab, previews the invoice, sees the Dr/Cr split, clicks **Approve & Post JV**.
   - **JV**: **Dr** Expense/Professional-Fee/Salary · **Cr** Party ledger (e.g. Vidarbha).
3. When the party collects, a **Payment Voucher** knocks off the bill.
   - **Payment**: **Dr** Party · **Cr** Cash/Bank.

### Decisions locked with the user
- **JVs post into the live books** — reuse `createAccountingVoucher()`; JV lands in
  `vouchers`/`voucher_entries`, shows in Trial Balance / P&L / voucher register. No parallel table.
- **Lives inside the Tally page as a new "Approvals" tab** — no separate route or sidebar entry.
- **Manual add form now**; auto-feed from `payment_obligations`/`visit_surgeries` later.
- **No Tally sync now.**

## What already exists (reuse, don't rebuild)
- `src/lib/accounting-voucher-service.ts` → **`createAccountingVoucher(input)`** — validates
  Dr==Cr and amount>0, requires distinct valid ledgers scoped to the company, auto-numbers,
  inserts voucher + entries (status `AUTHORISED`), rolls back entries on failure. Posts both the
  JV (`category:'JOURNAL'`) and the payment voucher (`category:'PAYMENT'`); both types are seeded.
- `chart_of_accounts` (company-scoped ledgers), `voucher_entries`.
- `src/hooks/useCompanies.ts`; `resolveAccountingCompanyId` pattern in `TallyCreateVoucher.tsx`.
- `src/components/ui/searchable-select.tsx` — ledger pickers; `cashBankOptions` filter
  (`TallyCreateVoucher.tsx:338-343`) for the Cash/Bank picker.
- `src/lib/uploadBillAttachment.ts` — uploads to the `uploads` bucket, returns public URL.
- `useAccountingRights()` (`src/components/accounting/tally/rights`) — gates Approve/Pay buttons.
- **Do not touch** `/bill-approvals` (`BillApprovals.tsx`) — that's patient-bill discount approval,
  a different domain.

## Changes

### 1. Migration — `supabase/migrations/<ts>_create_approval_queue.sql`
Table `approval_queue`:
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null` (FK `companies`) — **captured at add-time; JV always posts here**
- `category text not null check in ('VENDOR','DOCTOR','SALARY')`
- `party_name text not null`, `reference_no text`, `amount numeric(12,2) not null check (amount > 0)`
- `expense_account_id uuid not null` (FK `chart_of_accounts`) — JV debit
- `party_account_id uuid not null` (FK `chart_of_accounts`) — JV credit
  - `check (expense_account_id <> party_account_id)`
- `invoice_url text`
- `status text not null check in ('PENDING','APPROVED','REJECTED') default 'PENDING'`
- `narration text`, `rejection_reason text`
- `jv_voucher_id uuid` (FK `vouchers`) — set on approval
- `is_paid boolean not null default false`, `payment_voucher_id uuid` (FK `vouchers`)
- `created_at/approved_at/paid_at timestamptz`, `created_by/approved_by text`
- Index `(status, company_id)`. Enable RLS with a policy mirroring the recent `20260721*` referee
  migrations (auth-required); real approval authority is enforced in the UI via `useAccountingRights`.

### 2. Service — `src/lib/approval-queue-service.ts` (new)
Wraps `createAccountingVoucher`, with **claim-then-post** ordering to prevent double posting:
- `createApproval(input)` — insert PENDING. Validates amount>0 and the two ledgers differ.
- `approveAndPostJV(id)`:
  1. **Atomic claim**: `update approval_queue set status='APPROVED', approved_at, approved_by
     where id=? and status='PENDING'` → returning row. **0 rows ⇒ already approved by someone else,
     abort (no JV posted).**
  2. Post JV via `createAccountingVoucher({ companyId: row.company_id, category:'JOURNAL', ...,
     entries:[Dr expense, Cr party] })`.
  3. On success: set `jv_voucher_id`. **On failure: revert `status='PENDING'`** (best-effort) and surface the error.
- `rejectApproval(id, reason)` — `where id=? and status='PENDING'` only (can't reject a posted JV).
- `postPaymentVoucher(id, { cashBankAccountId, date })`:
  1. **Atomic claim**: `update ... set is_paid=true, paid_at where id=? and status='APPROVED'
     and is_paid=false and jv_voucher_id is not null` → returning row. **0 rows ⇒ abort.**
  2. Post PAYMENT via `createAccountingVoucher({ ..., referenceNumber: row.reference_no (knock-off),
     entries:[Dr party, Cr cashBank] })`.
  3. On success set `payment_voucher_id`; on failure revert `is_paid=false`.

### 3. UI — new **"Approvals" tab** in `TallyPage.tsx`
New component `src/components/tally/TallyApprovals.tsx`, receiving the same `serverUrl` /
`companyName` / `companyId` props as the other tabs and resolving the accounting company id like
`TallyCreateVoucher`. Sub-sections by status:
- **Pending** — table of `status='PENDING'`: row checkboxes (multi-select), columns category · party ·
  ref · amount · inline **Dr {expense} / Cr {party}** · invoice thumbnail.
  - Invoice preview Dialog (`invoice_url`).
  - **Approve & Post JV** (single or bulk over checked rows) — per-row result; failed rows stay Pending
    with an error toast, only successes move. Button gated by `useAccountingRights`.
  - **Reject** with reason. **Edit/Delete only allowed while PENDING** (approved rows locked).
  - **+ Add bill** modal: category, party_name, reference_no, amount, expense + party ledger
    (`SearchableSelect` over `chart_of_accounts` for the resolved company), invoice upload
    (`uploadBillAttachment`, `approvals/` path). Category sets default-ledger hints; user can change.
    Client validation: amount>0, two ledgers differ, company resolved. Soft warn on likely duplicate
    (same party+reference+amount already queued).
- **To Pay** — `status='APPROVED' AND is_paid=false AND jv_voucher_id NOT NULL`: **Pay** → modal picks
  Cash/Bank ledger (credit, `cashBankOptions` filter) + date; posts payment voucher, knocks off. Gated.
- **History** — paid / rejected, read-only.

Use `@tanstack/react-query` + `sonner`, matching existing Tally components. Refetch after each action.

### 4. Wiring — `src/components/tally/TallyPage.tsx`
Add `{ id: 'approvals', label: 'Approvals', icon: … }` to `tabs` (`:34-44`) and render
`<TallyApprovals … />` in the tab body (`:459-467`) with the same company props. No route / sidebar /
tileAccess changes.

## Edge cases & loopholes handled
- **Double-approve / double-click / two users ⇒ duplicate JV** → atomic claim (conditional UPDATE,
  check rows-affected) before posting; `jv_voucher_id` acts as idempotency marker.
- **Double payment** → same claim guard on `is_paid`/`payment_voucher_id`.
- **Partial JV post (unbalanced / bad ledger)** → `createAccountingVoucher` throws (Dr==Cr, distinct
  valid company-scoped ledgers, amount>0); we revert the claim so the row returns to PENDING, not a
  half-done state.
- **Pay before JV attached** → "To Pay" and the pay claim both require `jv_voucher_id IS NOT NULL`.
- **Wrong company** → `company_id` captured at add-time and reused for posting; DB rejects ledgers
  from another company. Adding/approving is blocked if the accounting company can't be resolved.
- **Same ledger both sides / zero-or-negative amount** → DB CHECK + client validation.
- **Editing/deleting after approval** → allowed only while PENDING; approved rows locked so books and
  queue can't diverge.
- **Reject/pay in wrong state** → status-guarded (reject=PENDING only, pay=APPROVED & unpaid only).
- **Bulk partial failure** → per-row handling; only successful rows transition.
- **Voucher-number race** (`createAccountingVoucher` read-modify-write on `current_number`) → maps
  unique-violation to a friendly "number already exists" error; user retries. Existing behavior, accepted.
- **Duplicate bill entry** → soft warning on matching party+reference+amount (not a hard block).
- **Invoice upload failure** → invoice is optional; save proceeds with a warning (matches existing helper).

## Known limitations (flagged, not built now)
- **Invoice privacy**: the `uploads` bucket is public (`getPublicUrl`) — anyone with the URL can view
  the invoice. Matches the app's current pattern; tightening to signed URLs is a later hardening step.
- **Cancelling/altering the posted JV afterwards** (via the voucher register) does not auto-revert the
  approval row — no reversing entry. Out of scope this pass.
- **Partial / multi-bill payments** not supported — Pay settles the full bill amount.

## Verification (end-to-end)
1. Apply migration; confirm `approval_queue` + CHECKs + RLS.
2. `npm run dev`, open the Tally page (`/accounting` or `/tally`), click **Approvals**, confirm company.
3. Add a VENDOR bill (party "Vidarbha", amount, expense + creditor ledgers, invoice photo) → shows in
   Pending; invoice preview + Dr/Cr split render.
4. **Approve & Post JV** → moves to **To Pay**; voucher register / Trial Balance shows a balanced
   JOURNAL voucher (Dr expense, Cr Vidarbha) for that company. Click Approve again / double-click →
   no second JV.
5. **Pay** with Cash/Bank → PAYMENT voucher (Dr Vidarbha, Cr Cash/Bank), row marked paid, reference
   links the bill. Pay again → no second voucher.
6. Repeat for DOCTOR and SALARY.
7. Reject a bill → History with reason, no voucher. Try to reject/pay an already-approved row → blocked.
8. Add a bill with equal debit/credit ledger or amount 0 → rejected by validation.

## Files
- `supabase/migrations/<ts>_create_approval_queue.sql` (new)
- `src/lib/approval-queue-service.ts` (new)
- `src/components/tally/TallyApprovals.tsx` (new)
- `src/components/tally/TallyPage.tsx` (add tab + render)
