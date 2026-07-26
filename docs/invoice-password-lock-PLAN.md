# Invoice password lock — implementation plan

**Status:** in progress
**Scope:** private (self-pay) patients only
**Access password:** `2605`
**Unlock window:** 15 minutes, per user, per bill

---

## 1. What this solves

A private patient's final bill is confidential once the money is in. Today it is not
protected in any meaningful sense:

- The Final Bill page refuses to *print* after payment is received
  (`src/pages/FinalBill.tsx:14601`), but that guard covers **one page out of three**.
- `/view-bill/:billId` replays the identical saved bill, read-only, with its own Print
  button and **no lock at all**. The existing control is bypassed by moving one screen
  sideways.
- Underneath both, every browser request runs as the Postgres `anon` role (custom auth in
  `src/contexts/AuthContext.tsx`, no Supabase session), the anon key is hardcoded in
  `src/integrations/supabase/client.ts:44-45` and ships in the bundle, and the bill tables
  are `USING (true)`. **Anyone can read every invoice in the hospital with a single
  command, without logging in.**

So the work is in two halves: a gate people see, and a lockdown that makes the gate mean
something.

---

## 2. Decisions

| Decision | Value |
|---|---|
| Patients in scope | Private only — `patients.corporate` is null, `''`, or `'private'` |
| Lock trigger | Payment received: `bill_preparation.received_date` or `received_amount` |
| Unlock method | **Password only.** SMS OTP deferred until Twilio is ready |
| Unlock window | 15 minutes, scoped to the user and the bill |
| Enforcement | Postgres — not a UI overlay |
| Brute-force | 5 failures in an hour locks that user/IP out for an hour |

### Out of scope
Pharmacy bills, accounting ledgers, aging reports, Detailed Invoice, Discharge Invoice,
Yojna Bill (scheme/corporate patients — cannot show a private bill), and all patient
clinical documents.

### Deferred: SMS one-time codes
The database already supports them (`request_invoice_otp`, `invoice_otp_challenges`).
They are dormant. Blocked on:
1. Twilio **Account SID** (`AC...`) — `.env` currently has only an API key (`SID=SK...`)
   and `Client_secret`, which cannot authenticate on their own.
2. A sender — `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.
3. **Indian DLT registration** — TRAI requires a registered sender and template for
   transactional SMS. Without it delivery fails regardless of correct code. Takes days;
   worth starting early.
4. Credentials must go in **Vercel project env**, not just local `.env` — `api/` functions
   never read the local file.

---

## 3. The three doors

| # | Route | File | How it is gated |
|---|---|---|---|
| 1 | `/final-bill/:visitId` | `src/pages/FinalBill.tsx` | **FROZEN — never edited.** Gated via the route wrapper and `useFinalBillData.ts` |
| 2 | `/view-bill/:billId` | `src/pages/ViewBill.tsx` | Gate rendered directly ✅ done |
| 3 | `/invoice/:visitId` | `src/pages/Invoice.tsx` | Gate rendered directly |

`FinalBill.tsx` is guarded by a SHA256 prebuild check (`scripts/check-finalbill-locked.cjs`).
It works untouched because the invoice content it renders arrives through
`src/hooks/useFinalBillData.ts`, which is not frozen.

---

## 4. Architecture

### Database (`supabase/migrations/20260726100000_invoice_otp_gate.sql`) ✅ written

| Object | Purpose |
|---|---|
| `invoice_access_config` | Single row. `master_key_hash` + salt, enable flag, TTLs, limits. Password rotatable with one UPDATE, no redeploy |
| `invoice_access_grants` | Live unlock windows. `token_hash` only; `via` = `otp` \| `master_key` |
| `invoice_otp_attempts` | Failed attempts, backing the lockout |
| `invoice_otp_challenges` | Dormant until Twilio lands |
| `invoice_lock_state(bill_id)` | Is this bill private **and** paid? |
| `verify_invoice_otp(...)` | Checks lockout → password → (later) OTP. Mints a grant. **`service_role` only** |
| `get_invoice_content(bill_id, grant_token)` | **The enforcement point.** Open for corporate/unpaid bills; requires a valid grant otherwise. Granted to `anon` |

All four tables have RLS on and **deliberately no policies** — `anon` cannot touch them.
The password is stored as a salted SHA-256 hash; the plaintext exists in no file.

### API
- `api/invoice-otp-verify.ts` — POST `{billId, code, userEmail}` → `{grantToken, expiresAt}`.
  Holds the service-role key, captures the real client IP for the lockout, writes the audit row.

### Frontend
- `src/hooks/useInvoiceAccess.ts` — accepts `{billId}` or `{visitId}`; exposes
  `needsGate`, `grantToken`, `remainingMs`, `unlock()`. Token lives in `sessionStorage`.
- `src/components/invoice/InvoicePasswordGate.tsx` — masked password field, rendered
  **instead of** the bill, never over it.

---

## 5. Progress

| # | Step | Status |
|---|---|---|
| 1 | Migration: tables, RPCs, password seed | ✅ done |
| 2 | `api/invoice-otp-verify.ts` | ✅ done |
| 3 | `useInvoiceAccess` + `InvoicePasswordGate` | ✅ done |
| 4 | Wire `ViewBill.tsx` | ✅ done |
| 5 | Wire `Invoice.tsx` | ⬜ next |
| 6 | Wire `/final-bill` route wrapper + `useFinalBillData.ts` | ⬜ |
| 7 | Audit action types in `ActivityLog.tsx`, `.env.example` | ⬜ |
| 8 | Move the invoice snapshot out of `bills` (see §6) | ⬜ |
| 9 | Migrate `OldBills` / `BillApprovals` / `BillingChatbot` | ⬜ |
| 10 | Enforcement flip: REVOKEs + rollback | ⬜ last, alone |
| 11 | Verify (§7) | ⬜ |

**Nothing is enforced until step 10.** Steps 1-9 are additive and safe to deploy; the gate
is visible and functional but bypassable until the REVOKEs land.

---

## 6. Problem found during implementation

The approved plan assumed a column-level `REVOKE SELECT` on `bills.bill_items_json` and
`bills.bill_patient_data`. **That will not work.**

`FinalBill.tsx:1706` (frozen) does `.insert({...}).select().single()` on `bills`. Postgres
`RETURNING` requires SELECT privilege on every column returned, and `.select()` with no
argument returns all of them. A column-level revoke therefore breaks **bill creation**, in a
file that cannot be edited.

`bill_items_json` is not incidental either — `FinalBill.tsx:6217` treats it as the
"HIGHEST PRIORITY" source when restoring a saved bill. It holds the full itemised invoice,
so leaving it readable would leave the invoice readable.

**Fix:** move the snapshot into a new `bill_content` table (`bill_id` PK, `items_json`,
`patient_data`), granted `INSERT/UPDATE/DELETE` to `anon` but **not** `SELECT` — Postgres
permits writes without reads, so `saveBill` keeps working while the content becomes
unreadable directly.

- `useFinalBillData.ts` (editable) is the only writer of those columns
  (`:222-223`, `:244-245`) → it writes to `bill_content` instead.
- It is also the only reader that matters → it fetches via `get_invoice_content` and merges
  the result back onto the returned object under the same keys.
- `FinalBill.tsx` sees the identical shape and stays untouched.
- The migration backfills `bill_content` from existing rows, then nulls the old columns.
- `bills` keeps full-table SELECT for `anon`, so the frozen insert, dashboards, KPIs and
  aging reports all keep working.

Net effect: the tables to lock down are `bill_sections`, `bill_line_items` and
`bill_content` — three full-table SELECT revokes, no column-level grants anywhere.

---

## 7. Verification

Set `BASE_URL=http://localhost:5173` for any Playwright run — `playwright.config.ts`
defaults to production.

1. **Unlocked** — private patient, no payment received: all three routes render normally.
2. **Lock engages** — set `bill_preparation.received_amount`: all three show the gate.
3. **Password** — `2605` unlocks all three for 15 minutes.
4. **Expiry** — after the window, the routes re-lock without a reload.
5. **Per-user** — a grant in browser A leaves browser B locked.
6. **Lockout** — 5 wrong passwords, then the correct one: must still be **refused**.
7. **Server enforcement (the decisive test)** — with the anon key from
   `src/integrations/supabase/client.ts`, `curl` PostgREST for `bill_sections`,
   `bill_line_items` and `bill_content` on a locked bill. All must be refused. Then call
   `get_invoice_content` with a bogus token → `{ok:false, reason:'locked'}`.
   **If this passes the feature is real; if it fails, everything above is decoration.**
8. **Corporate untouched** — repeat with a PM-JAY/CGHS patient: no gate anywhere.
9. **Password not in the bundle** — `npm run build`, then grep `dist/` for `2605`. Zero hits.
10. **Audit** — `/activity-log` shows unlock rows with the right email and a non-null IP.
11. **Frozen file** — `npm run check:finalbill` passes, `npm run build` succeeds.
12. **No regressions** — Director KPIs, `/bill-aging-statement`, `/old-bills/:visitId`,
    `/bill-approvals` all load after the revokes.

---

## 8. Known gaps

**Password concentration.** While `2605` is enabled, the strength of this feature is how
well that code is kept secret. Accepted trade-off, recorded so it is not mistaken for an
oversight. Rotate via `invoice_access_config.master_key_hash`; disable via
`master_key_enabled`. Both are one UPDATE, no redeploy. A 4-digit code is only 10,000
possibilities, which is why the lockout in §4 is load-bearing rather than decorative.

**Log visibility.** `/activity-log` has no `SuperAdminRoute` wrapper
(`AppRoutes.tsx:383`), unlike `/user-management`. Once unlock records land there, any
logged-in user can see who viewed which bill. Flagged, not changed — outside the stated scope.

**Production may differ from migrations.** The repo carries 448 migrations plus ~200 loose
root-level `.sql` files applied by hand, and `advance_payment`'s committed policy is
incompatible with the app's anon-only client. Confirm the live grants on `bills`,
`bill_sections` and `bill_line_items` before writing step 10.
