---
name: Adamrit failure modes (14–16 Aug 2026 session)
description: Every trap, silent failure and self-inflicted outage recorded during the 14–16 August 2026 working session on Adamrit. Read BEFORE touching RLS/permissions, cash and handover paths, Final Bill charges, user access and email allowlists, Postgres functions, React Query hooks, the public landing page, or anything that must survive a Vercel deploy. Each entry is a real incident, not a hypothetical.
source_project: adamrit
tags: [adamrit, rls, permissions, cash, money-path, final-bill, deploy, vercel, react-query, supabase, postgres, verification]
---

# Adamrit failure modes — harvested 16 Aug 2026

Everything below actually happened on 14–16 August 2026 in production. Several of
these cost the hospital an outage, an hour of exposed patient data, or a
recurring cash deduction. Read the relevant section before starting, not after
the user reports the symptom.

---

## 1. Verification discipline — the most expensive category

**1.1 You cannot reason about a signed-in browser from an anon-key probe.**
Probes made with the raw anon key always arrive as `anon`. They prove nothing
about what a signed-in staff member can do. Concluding "the identity mechanism is
broken" from such a probe led to reopening 39 clinical tables to the public key
for about an hour, reported to the user as a fix. **For anything about signed-in
access, the only valid test is a signed-in session — which means asking the user
to click something.**

**1.2 A blocked SELECT under RLS returns HTTP 200 with an empty list.**
Any "is this table reachable?" check based on status code is meaningless. Count
rows, and compare public key vs service key side by side.

**1.3 A passing SELECT does not prove a passing INSERT.**
"Reads and writes test the same `auth.role() = 'authenticated'` expression, so
the save will work" was stated confidently and was wrong — reads passed with the
token, writes were still refused. This blocked live billing a second time in one
morning and is **still unexplained**. Reproduce a write failure in isolation,
off-hours, before re-locking anything.

**1.4 `npx tsc -p tsconfig.json` checks NOTHING.**
`tsconfig.json` has `"files": []`. It exits 0 on a broken tree. Use
`npm run typecheck` (the ratchet script; ~40 pre-existing errors is the
baseline). The fake check hid a half-applied edit that left dead code after an
early `return` in the pharmacy handover flow.

**1.5 Verifying a deploy requires walking the lazy-chunk graph.**
`FinalBill`, the tablet flows and others are lazy chunks. Grepping
`dist/assets/index-*.js` proves nothing. Walk
`index → TabletApp-*.js → CashHandoverFlow-*.js` on the live site. Guessing a
local hash returns the SPA fallback HTML, which looks like a 200.

**1.6 Verify a change against everything that touches it, not in isolation.**
In one stretch, three of the last four faults the user hit were self-inflicted:
a deploy failure, a query-key crash, and a fix announced as solving a bug the
user never had. Each was verified alone and shipped.

**1.7 When a provider fails opaquely, read its own log first.**
A Supabase auth `500 unexpected_failure` produced two confident wrong diagnoses
(outstanding-invoices banner, expired Google client secret) before Auth Logs
named the cause in one line. Dashboard → Logs → Auth Logs is the *first* stop.

---

## 2. Silent failures — writes that report success

**2.1 A DELETE matching no rows is not an error.**
`supabase.from(...).delete().eq('id', x)` returns no error when RLS refuses it or
the id no longer matches. The old code destructured `count` on the same line and
never checked it, then removed the row from the screen and showed
"deleted successfully". Always request the deleted rows back and confirm at least
one came; on zero, say so and **leave the row on screen** — showing a charge as
removed while it is still on the bill is what costs money.

**2.2 Auto-add on page load resurrects deliberate deletions.**
`FinalBill.tsx` auto-adds charges whenever they are "not already present" —
which is exactly what deleting achieves. Five charges are auto-added:
- **daily loop:** `DOCTOR CHARGES`, `Nursing Chrages` (sic)
- **one-time block:** `EMERGENCY CHARGES`, `MLC Processing`, `Consultation Charges`

Deletions are now remembered in `visit_clinical_service_exclusions`. **The first
fix covered only the one-time block** — the daily loop runs ~80 lines earlier and
never saw the exclusion fetch, so Doctor and Nursing stayed broken and were
reported as fixed. Fetch exclusions above *both* loops.

**2.3 Recomputing a stored value discards what the user saved.**
The invoice did `days = qty || 1; if (start && end) days = ceil(diff)+1` —
multiplying any charge carrying a date range by the days in it. Because those
ranges run to *today*, the bill grew by one every morning (₹23,275 vs the correct
₹10,875). Six blocks had it. **A date range is a note about the period a charge
covers, not a multiplier.** Accommodation is the one legitimate exception.

**2.4 A dedupe that drops the row's identity drops everything hung off it.**
`DayBook.tsx` let the Tally mirror win over the native voucher. Tally rows carry
`nativeId: null`, and the attachment button, generated-invoice button and
`party_mobile` were all gated on `r.nativeId`. Every voucher that also existed in
Tally silently lost its documents. Carry the native id across the swap.

**2.5 Fetched and never rendered.** `signedVoucherUrl` was pulled into the
daybook map and dropped at the screen — a payment row could prove the invoice but
never the payment.

---

## 3. Money paths (see also `docs/money-path-rules.md`)

**3.1 Rebuild Postgres functions from the LIVE database, never from a migration
file.** Rebuilding `submit_cash_handover` from an older migration silently
dropped the payout-claiming block added one day earlier, so cash payouts were
deducted from the drawer on every shift instead of once (a ₹180 voucher kept
reappearing). `CLAUDE.md` warns about exactly this; it still happened.

**3.2 Adding parameters creates a NEW overload, it does not replace.**
Four `submit_cash_handover` overloads (7, 8, 10, 12 args) were live at once,
short calls became ambiguous, and the app was calling the wrong one. Drop stale
overloads explicitly, and check every call site first.

**3.3 Transfers must be recorded, not summed.** Variance is
`counted + locker + bank_deposit − expected`. Locker *movements* (withdrawn from
/ deposited into the locker) stay outside it — the notes are already counted in
the drawer or in the locker figure, so adding them double-counts and throws every
handover out.

**3.4 `variance` on `cash_handovers` is a stored generated column.** Changing the
formula means dropping and re-adding it. The migration must verify no past
handover changed value, and abort rather than half-apply.

**3.5 One deposit, one posting path.** Deposits post through
`post_cash_bank_entry` and have no table of their own — the CONTRA voucher *is*
the record. A parallel deposit field on the handover form would let the same cash
be recorded twice.

**3.6 Coverage before enforcement.** Making `party_mobile` compulsory on
automatic postings was correct in principle and would have blocked essentially
every automatic payment and receipt: 19 of 10,325 ledgers had a number. Measure
coverage before flipping any mandatory rule on a money path.

---

## 4. Identity, roles and access

**4.1 A person holds exactly one role.** Gating a screen by role breaks real
work. The people who actually hold cash drawers are a receptionist, a pharmacist,
a radiology technician, a marketing manager and a superadmin — gating cash
handover to `cashier` would have locked out every one of them and left the tile
to one account that had never signed in.

**4.2 Gate by roster, not by role or by email list.** `can_use_cash_handover()`
(the `cash_handover_verifiers` roster + the cashier role) is the authority. It is
already maintained by the people who assign counters, so a new cashier works with
no code change and no deploy. Voucher tiles now follow it too.

**4.3 Hardcoded email allowlists in source go dead silently.**
`ACCOUNTING_EMAILS`, `OFFICE_TILE_EMAILS` and the voucher lists are hand-edited
arrays. Correcting Diksha's address to her real Gmail instantly revoked her
voucher tiles, desktop accounting rights and the Accounts/Expense Bills tiles —
three separate lists still held the old address, and nothing reported it.
**An audit found 16 of 36 hardcoded addresses match no account.** Four of those
still control access (`finance@hopehospital.com`, `murali@gmail.com`,
`murali@hospital.com`, `superadmin@ayushman.com`) and await the user's decision.

**4.4 Add `google_email` beside the primary address, never replace it.**
`/api/auth-session` returns the row's **primary** email whichever door was used,
and every permission list matches on that. Swapping the primary grants access in
one commit and revokes it in the next.

**4.5 One email cannot serve several people.** Login matches on email;
`lookup_user_by_email` returns one row and the session route takes the newest by
`created_at`. Shared logins are what stranded ₹76,600 under
`superadmin@hospital.com` and ₹11,000 under `hope@gmail.com` — untraceable cash
cannot be handed over at shift end.

**4.6 `admin` is not the role that manages users.** `api/admin-users.ts` refuses
every user-management action unless the actor is in
`{superadmin, super_admin, ca}`. An `admin` account signs in fine and is refused
at the first click.

**4.7 Promoting a user in SQL must also set `hr_pulse_can_view_all`** — the admin
API derives that flag from the role on every create/update, so a SQL-only
promotion is top of the tree everywhere except HR Pulse.

**4.8 `lookup_user_by_email` does not return `is_active`** — it filters on it
internally. Don't select it.

**4.9 Never sign in on the user's behalf**, and note the browser-automation tab
does **not** carry the user's Supabase dashboard session. Two attempts were
wasted proving this.

---

## 5. Build and deploy traps

**5.1 `.vercelignore` excludes `scripts/*` with a per-file allowlist.**
A new prebuild guard not added to that `!` list is stripped from the upload, and
every deploy dies on "Cannot find module" for a file plainly in git. It passes
locally because the file exists locally. This broke production deploys for ~20
minutes. The file even carries a comment warning about it.

**5.2 Frozen-module baselines block unrelated deploys.** Editing anything under
the accounting / finalbill / expensebill / registration freezes requires updating
the matching `scripts/*-baseline.json` **in the same commit**, or every later
deploy fails — including other people's work. Equally: *another session's*
uncommitted edit to a frozen file fails your build. Do not rubber-stamp someone
else's change into the baseline; verify your own work with `vite build` instead.

**5.3 React Query keys are global.** `useBillingExecutives` was given the
existing key `billing-executives` but returns `{ inUse, all }` where FinalBill's
own query expected an array — whichever resolved first filled the cache for both,
and the Final Bill page crashed with `Yd.map is not a function`. Namespace new
hooks (`billing-executive-options`, `telecaller-options`). 49 keys are shared
across files; sharing a key is fine, sharing one with a *different shape* is not.

**5.4 Rendering a neutral label is not the same as not shipping the name.**
Importing the module registry into the public landing page pulled 19 staff-named
labels into the bundle every anonymous visitor downloads. `LandingModules.tsx`
must stay **self-contained** — it looks like duplication and is not.
`scripts/check-public-labels.cjs` (in `prebuild`) fails the build if a listed
module disappears or a staff name reaches a public label.

**5.5 Hardcoded staff rosters leak and go stale.** `TodaysIpdDashboard` held 31
typed names and `PatientOverview` held `['Dolly','Nisha','Diksha']`. Both shipped
to the public bundle, and both were already wrong: **"Neesha" appears on 13
visits and was not in the list**, so the counter was offered "Nisha" instead —
one person quietly becoming two. Build such lists from the data (names in use)
plus active staff, de-duplicated case-insensitively, never dropping a name
already recorded.

**5.6 `CLAUDE.md` itself was wrong and misled another agent.** It declared
Next.js as the primary framework and named `pytest`/`ruff`/`black`/`mypy`, none
of which exist here. Gemini CLI consequently reported `src/pages/Index.tsx` as
the landing page — that is the dashboard behind login. The real landing page is
`src/components/LandingPage.tsx` → `src/components/LandingModules.tsx`. Corrected
16-Aug, and `GEMINI.md` added.

---

## 6. Migration and Postgres mechanics

- `apply_migration` (via `python3 scripts/apply-migration.py <file>`) **supplies
  its own transaction** — no `BEGIN`/`COMMIT` in the script. A name applies once;
  use a `.v2` suffix to re-run.
- **pgcrypto lives in the `extensions` schema** on Supabase:
  `extensions.crypt`, `extensions.gen_random_bytes`, `extensions.gen_salt`.
- **Scope a migration's self-check to the tables it touched.** A global
  "any table with RLS on and no policy" assertion aborts, because dozens of
  service-role-only tables (OTP, brain, partner) are deliberately in that state.
  The abort is the check working — narrow it, don't remove it.
- `pg_cron` is installed and is the right tool for a dated role change; a change
  someone must remember to make by hand does not happen. Guard the job (refuse if
  it would strand the hospital without superadmins) and have it unschedule itself.
- **Structural keys only.** Patient ledgers link exactly:
  `chart_of_accounts.account_code = 'PT' || patients.uhid` — 5,807 of 5,807
  matched, zero misses. `suppliers.ledger_account_id` is a real FK. **Never
  fuzzy-match ledger names to patient names** — ledger-name normalization has
  bitten this project before, and a wrong match puts one patient's phone number
  on another's account.
- Another session may hold uncommitted work in the tree. **Stage explicit paths**
  and never `git add -A`.

---

## 7. Current standing state (as of 16 Aug 2026)

- **The permissions lockdown is PAUSED mid-flight.** ~45 tables carry a temporary
  policy named `app access pending identity`, each with a database comment naming
  exactly what to drop. They are readable with the published anon key, as they
  have been for months. Find them in one query on that policy name.
- The signed-in token **does** work end to end: minted by `/api/auth-session`
  (`role=authenticated`), accepted by Postgres, and attached by the browser —
  proved by Stores & Inventory (an `authenticated`-only table) loading. **But a
  write to `visit_clinical_services` was still refused**, and that is unexplained.
- `cashbook_handwritten_uploads` is the one table properly locked — nothing in
  the codebase references it.
- 237 of 412 tables still carry an "allow everyone" policy satisfied by the key
  published in the site's JavaScript.
- `loudFailures.ts` compares against a separate env copy of the anon key rather
  than the one `client.ts` hardcodes — two sources for one value, which breaks
  silently at the next key rotation. Not yet fixed.

**Rule of engagement for this work:** re-lock one table, have the user exercise
the real screen, and only then continue. Do not test permission changes on live
billing during a working shift.
