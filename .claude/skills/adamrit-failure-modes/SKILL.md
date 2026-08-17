---
name: Adamrit failure modes (14–17 Aug 2026 sessions)
description: Every trap, silent failure and self-inflicted outage recorded during the 14–17 August 2026 working sessions on Adamrit. Read BEFORE touching RLS/permissions, cash and handover paths, Final Bill charges, user access and email allowlists, Postgres functions, React Query hooks, tests and CI, the public landing page and its built bundle, the PWA/service worker, or anything that must survive a Vercel deploy. Each entry is a real incident, not a hypothetical.
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

---

# Harvested 17 Aug 2026 — testing, the public bundle, and the cash boundary

Everything below happened in the 17 August session. Same rule: read the
relevant entry before starting, not after the symptom.

## 8. Tests that lie

**8.1 Test files can imply coverage that does not exist.** Three files under
`src/` imported `@jest/globals` and `@testing-library/react` while neither was
in package.json — 961 lines of test that could never run, sitting where a
reader concludes corporate-claim money logic is covered. Worse than no tests.
Now they run under Vitest (`npm run test`, wired into CI as `test:ci`).

**8.2 When a revived test fails, suspect the TEST first.** All 9 genuine
failures in `corporateClaimTracking.test.ts` were the test being wrong — it
guessed the API instead of reading it. The real scheme prefixes are `PJ`/`MJ`
(normalized), not the scheme display names; `corporateClaimFileFingerprint`
takes a parsed-file object, not a string. `schemeForProgramId('PMJAY…')` is
deliberately UNRESOLVED — "never guess" is the module's contract.

**8.3 A suite that cannot run must be red, not green.** `test:loud-failures`
used to print SKIP and `exit 0` when `VITE_SUPABASE_ANON_KEY` was absent —
permanently green in CI while asserting nothing, guarding all 278 write paths.
It now exits 1 unless `ALLOW_SKIP_LOUD_FAILURES=1` is set on purpose. The
failed-write reporter's own harness had the swallow-the-failure bug.

**8.4 `tsconfig.app.json` EXCLUDES `src/**/*.test.*`.** The typecheck ratchet
never sees test files. A type error in a test will not move the baseline.

**8.5 The ratchet was already failing on main — 271 errors against 251 —
before this session touched anything** (verified on a pristine checkout with
the original lockfile). Do not bump the baseline to make your commit green;
that absorbs 20 strangers' errors silently. Still unfixed, deliberately.

**8.6 `cmd | grep …; echo $?` measures grep.** Two verifications in one
session read the wrong exit code this way. Use `${PIPESTATUS[0]}` or run the
command bare.

## 9. The public bundle leaks by chunking, not by import

**9.1 Vite hoists shared modules into the entry chunk.** Nobody imported the
staff-named tile registry into the landing page — `src/config/tileAccess.ts`
was pulled into `dist/assets/index-*.js` because two OTHER screens shared it.
Every anonymous visitor downloaded "Register Patient Diksha" et al. AGAIN
(same leak as 16 Aug, new route). A source-level guard cannot see this:
`check-public-labels.cjs` was green while the names shipped.

**9.2 Guard the artifact, not the source.** `scripts/check-bundle-names.cjs`
(postbuild) greps the BUILT entry chunk for the staff-name list. Three staff
emails still ship in hardcoded access allowlists — known, needs the
server-side move, not a rename.

**9.3 An exemption list is a disabled check.** `OFF_REGISTRY` in
check-public-labels means "skip the dead-link check" — thirteen desktop tiles
added there would have been thirteen unchecked links. Exemptions must earn
themselves: off-registry hrefs are now verified against `path=` in
AppRoutes.tsx, and external tiles must be absolute https (a bare domain
resolves against adamrit.com; the deliberate-break test proved both fail).

**9.4 "The deploy didn't work" is usually the service worker.** The PWA
precaches index.html and answers every navigation from cache — a returning
browser ALWAYS paints the old app first, then self-reloads within ~a minute.
`ReloadPrompt`'s "new version" toast is dead code (`registerType:
"autoUpdate"` never fires onNeedRefresh), and App.tsx throttles the
controllerchange reload to one per 5 minutes — a tab can stay stale until a
manual refresh. Check this BEFORE blaming Vercel.

## 10. The cash boundary — how the opening guard was relaxed without removing it

**10.1 A handover claims EVERY live opening at its counter** —
`claim_handover_sources` is a set-based UPDATE with no ORDER BY or LIMIT, and
`cash_opening_for` SUMS live rows. Two live openings on one counter is
mechanically CH-260815-0016 (₹9,789 variance on a ₹1,720 drawer). The plpgsql
guard is also backed by partial unique index
`cash_opening_one_live_per_counter` — relaxing the function alone yields raw
constraint errors, and relaxing both dissolves the person-to-cash boundary and
re-opens the re-declare-a-short-drawer-bigger fraud.

**10.2 The unblock is a boundary, not a bypass.**
`declare_opening_cash_unattended()` closes the absent cashier's session FIRST
(a real handover from them to the arriving cashier, counted at what was
actually found — variance lands on the absent person), THEN declares the fresh
opening through the untouched `declare_opening_cash`. One live opening per
counter holds at every instant. A cashier's own pending balance still refuses —
that path is the fraud door.

**10.3 New name, never new parameters.** Growing a parameter list under
CREATE OR REPLACE mints a second overload (that is how the payout claim was
lost on 16 Aug). New behaviour gets a NEW function name that CALLS the live
functions; the migration's verify block asserts both live identity signatures
(`pg_get_function_identity_arguments`) and aborts on drift — honouring
"rebuild from the live database" without live access.

**10.4 Migrations must self-test because they get dashboard-pasted.** The
owner applies SQL by pasting into the Supabase SQL editor (rule now in
CLAUDE.md), so `apply_migration`'s name registry never hears about it, and a
later script run re-executes the SQL. Use CREATE FUNCTION (not OR REPLACE) so
a re-run fails loudly with "already exists", and put a rehearsal DO block in
the file — it ran against live and caught nothing wrong precisely because the
signature asserts ran first.

**10.5 Client ships before the migration lands — degrade honestly.** The
unattended path maps PGRST202 to "the database update has not been applied yet
(migration 20260817100000)"; multi-referee announce falls back to the old RPC
with the FIRST referee and says so in a toast; the referrals list selects
`referee_list` separately and retries without it. Never block the hospital on
an unapplied migration, never hide that it is unapplied.

## 11. Multi-referee: the seam that keeps money untouched

**11.1 `referee_initials` stays ONE string (the first pick).** The frozen
registration prefill collapses it into `patients.relationship_manager`, and
DailyRevenueReportSection's rm_name fallback NAME-MATCHES that text against
the RM master — a joined "AB, CD" matches nobody. The N-referee list
(`incoming_referrals.referee_list` jsonb) stops at the announcement layer.
Payouts are decided at registration + Daily Revenue Report; extra announced
names create no payable party. A cut SPLIT between referees is an owner
decision, deliberately not taken.

**11.2 Reuse a guard by CALLING it.** `announce_incoming_referral_with_list`
calls the existing announce function (dedupe races and all) and stamps the
list on the returned row in the same transaction — no duplicated guard logic,
no redefinition of a live function.

## 12. Session mechanics

**12.1 The push guard rejects the WHOLE compound command.** A chained
`git add && git commit && git push` died at the guard with nothing executed —
the commit silently did not happen. Commit and push in separate Bash calls.

**12.2 An empty node_modules proves nothing.** "jest is not installed" from
`ls node_modules` was worthless before `npm ci` — package.json is the
authority on what the project depends on.

**12.3 Landing tiles live in TWO places that must agree.**
`LandingModules.tsx` (self-contained on purpose) and `check-public-labels.cjs`
(its OFF_REGISTRY set). Adding a tile without the exemption fails the build;
adding the exemption without checking the route would be a dead link — which
the href check now catches.

## 13. Open items handed to the owner (as of 17 Aug)

- **Printed money columns show "—" for a missing amount, not "₹0"** — a null
  cell never reaches `column.format`, so the formatter's `|| '0'` fallback is
  dead code. Recorded as-is in printTests; changing it moves every print
  report. Owner asked, not yet answered.
- **Typecheck ratchet red on main** (271 vs 251) — 20 unattributed errors
  awaiting a proper fix, NOT a baseline bump.
- **Three staff emails still in the shipped entry chunk** (access allowlists).
- **Supabase "Outstanding invoices" banner** on the production dashboard —
  service suspension would stop the whole hospital.
- **Human verification pending:** one real cashier through the unattended
  opening on a quiet counter; one real two-referee announcement.
