# Business Brain — Production-Safe Deploy Runbook

**Constraint:** Adamrit is in production. This runbook ensures every step is independently reversible and that production behaviour does not change until the feature flag is explicitly flipped on for opted-in users.

---

## Topology

```
                  GitHub                   Supabase                   Vercel
                  ──────                   ────────                   ──────
PR open    →  feat/business-brain  →  branch DB clone  ←──  preview deploy
                                       (auto-created           feat-business-
                                        per PR)                brain-...vercel.app

PR merge   →  main                  →  prod DB           ←──  prod deploy
                                       (manual                 adamrit.com
                                        migration push)
```

The Vercel-Supabase integration auto-injects branch-scoped `VITE_SUPABASE_URL` and anon key into preview deploys — **no manual env-var copy-paste**.

---

## One-time setup (you do this in dashboards)

You must enable Supabase Branching + the Vercel-Supabase integration before any of this works. Bettroi side, ~10 minutes.

### Supabase dashboard
1. Project settings → **Integrations** → connect **GitHub** (authorise to `chatgptnotes/adamrit`).
2. Project settings → **Branching** → enable. Pick "main" as the production branch.
3. Pro plan required (~$25/mo). Per-PR DB branches cost ~$0.01344/hr (≈ $10/mo for one always-on branch).

### Vercel dashboard
4. Adamrit project → **Integrations** → install the **Supabase** integration.
5. Confirm "Auto-link Supabase branch to Vercel preview" is ON.
6. Result: every PR preview deploy automatically uses its own Supabase branch.

### Local dev (optional but recommended)
7. `supabase login` → `supabase link --project-ref xvkxccqaopbnkvwgyfjv`
8. `supabase start` for fully-offline local Supabase if you want to smoke-test before pushing.

---

## Phase 1 — Schema bridge (this PR)

This phase is currently in branch `feat/business-brain`. **Nothing here changes existing user-visible behaviour.**

### What's in this phase
- `supabase/migrations/20260510000000_business_brain_schema_bridge.sql` — additive only.
- Adds 4 patient consent columns (defaulted FALSE).
- Creates `appointment_type_templates` + 8 seed rows.
- Creates 5 `agent_*` runtime tables.
- Creates `agent-corpus` storage bucket.
- Adds `match_agent_chunks` RPC.

### Non-breaking guarantees
- ✅ Existing queries on `patients`, `visits`, `medicines`, `lab_results` etc. return identical rows.
- ✅ New patient columns default to FALSE/'en' — no existing INSERT statement breaks.
- ✅ All new tables / bucket are net-new namespaces.
- ✅ Migration is idempotent — re-running is safe.

### Pre-flight checks (run before opening PR)

```bash
# 1. Confirm migration parses
supabase db reset --debug
# (uses local Postgres in Docker; applies all migrations from scratch)

# 2. Verify pgvector available
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" \
    -c "SELECT extname FROM pg_extension WHERE extname='vector';"
# expect: vector

# 3. Verify the seed templates loaded
psql "$DB_URL" -c "SELECT type, display_name FROM appointment_type_templates;"
# expect: 8 rows

# 4. Verify patient column defaults work
psql "$DB_URL" -c "SELECT consent_for_ai, language_preference FROM patients LIMIT 3;"
# expect: false, en
```

### Promote to staging via Supabase Branching

```bash
git push -u origin feat/business-brain
gh pr create --title "feat: business brain schema bridge (additive only)" \
             --body "See docs/business-brain/DEPLOY_RUNBOOK.md"
```

When the PR opens, Supabase auto-creates a DB branch and runs the new migration on it. Vercel deploys the preview to the matching URL with the branched DB env vars. **Production is unaffected.**

### What to verify on the preview before merging

| Check | How |
|---|---|
| Adamrit loads identically | Open preview URL, walk through patient registration / visit booking / pharmacy billing. No regressions. |
| New columns visible | Supabase preview branch SQL editor: `\d patients` shows the 4 new columns. |
| Templates seeded | `SELECT count(*) FROM appointment_type_templates;` returns 8. |
| Existing patient rows still load | `SELECT id, name FROM patients LIMIT 5;` still works. |
| RLS not broken on prod tables | Sign in as a normal user, try to read patients — works identically. |

### Merging

When the preview checks pass:

```bash
gh pr merge --squash --delete-branch
```

This triggers:
1. Supabase **auto-merges** the migration to production. *(This is the moment of risk.)*
2. Vercel **auto-deploys** main to adamrit.com.

**Risk-mitigation for the auto-merge:** if you want manual gating on prod migrations, set Supabase Branching to "Manual promotion" mode in the dashboard (Settings → Branching → Promotion mode). Then merging the PR does NOT auto-run the migration on prod — you run `supabase db push --linked` manually.

I recommend manual promotion mode for adamrit.

### Rollback (if something is wrong post-merge)

```bash
# Option A — revert the migration via the rollback file
psql "$PROD_DB_URL" -f docs/business-brain/rollback_business_brain_schema_bridge.sql

# Option B — Supabase Point-in-Time Recovery (Pro plan, 7-day window)
# Dashboard → Database → Backups → restore to a timestamp before the merge

# Then revert the GitHub commit:
git revert <merge-commit-sha>
git push origin main
```

**Option A is fully tested** — the rollback drops only what the bridge created. No existing data is affected.

---

## Phase 2 — Edge Functions (next PR, not started)

After Phase 1 is merged and stable for ≥ 24h:

- Add `supabase/functions/_shared/{deidentify,embed,retrieve,llm,llm-with-fallback,audit,loader,service-client}.ts`
- Add `supabase/functions/agent-{ingest,pharmacy-reorder,patient-previsit,clinical-priorvisit}/`
- Set Edge Function secrets via `supabase secrets set ...`
- Deploy via `supabase functions deploy`
- **No frontend wiring yet.** Functions are inert until called.

Production-safe because: Edge Functions are net-new namespace. No existing function is modified.

---

## Phase 3 — Frontend (next-next PR, not started)

After Phase 2:

- Add `src/lib/brain.ts` (typed client)
- Add `src/components/agents/{PharmacyReorderPanel,PreVisitDraftDialog,PriorVisitDrawer}.tsx`
- Add feature flags to `.env.production`:
  ```
  VITE_BRAIN_ENABLED=false
  VITE_BRAIN_PHARMACY=false
  VITE_BRAIN_PATIENT_PREVISIT=false
  VITE_BRAIN_CLINICAL_BRIEF=false
  VITE_BRAIN_PILOT_USERS=        # comma-separated user IDs
  ```
- Components render `null` when their flag is false → zero pixel difference for end users.

Production-safe because: feature flag default OFF means no UI changes for any user.

---

## Phase 4 — Pilot rollout

Per agent, in this order:

1. **Pharmacy** (no PHI involved) → enable for 1 pharmacist for 2 weeks → audit `agent_audit_log` weekly.
2. **Patient pre-visit** (light PHI) → enable for 1 front-desk user for 30 days, every send manually approved.
3. **Clinical brief** (high PHI) → **shadow mode for 30 days first** (agent runs, output is logged, not shown to doctor), then enable for 1 doctor.

Each enable is a single env-var change in Vercel (the `VITE_BRAIN_PILOT_USERS` allowlist). Rollback = remove the user ID, redeploy.

---

## Two independent kill switches

If anything goes wrong in production:

1. **Frontend kill switch:** Vercel dashboard → env vars → set `VITE_BRAIN_ENABLED=false` → redeploy. Takes ~30 seconds. Every Business Brain UI disappears immediately.
2. **Backend kill switch:** `supabase secrets unset NEXAPROC_API_KEY VERTEX_ACCESS_TOKEN` then `supabase functions deploy agent-pharmacy-reorder agent-patient-previsit agent-clinical-priorvisit`. Every agent then 500s. Fail-closed.

Both kill switches are safe to use without coordination — they don't fight each other.

---

## Open dashboard configuration items (your one-time work)

- [ ] Supabase: enable GitHub integration on the adamrit project
- [ ] Supabase: enable Branching with "Manual promotion" mode for prod safety
- [ ] Vercel: install the Supabase integration on the adamrit project
- [ ] Confirm Pro plan is active on Supabase

When those are done, push `feat/business-brain` and the rest is automated.
