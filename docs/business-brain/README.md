# Business Brain — Adamrit Integration

AI agents that read existing Adamrit Supabase data and act inside the existing UI. Three agents in this v1 pilot:

| Slug | Department | What it does | LLM |
|---|---|---|---|
| `pharmacy-reorder-suggester` | Pharmacy | Suggests reorder qty + supplier from inventory + 90-day sales | Groq (no PHI) |
| `patient-pre-visit-instructions` | Patient-facing | Drafts SMS + email pre-visit instructions | Vertex AI (asia-south1) |
| `clinical-prior-visit-briefer` | Clinical | 1-page summary for the consulting doctor | Vertex AI (asia-south1) |

## Architecture

```
[ Adamrit React app ] -- supabase.functions.invoke('agent-…') -->  [ Edge Function ]
                                                                          |
                                            de-identify → retrieve → LLM → audit-log
                                                                          |
                                                              [ JSON response ]
```

All Edge Functions share `supabase/functions/_shared/`:
- `deidentify.ts` — strip Indian PHI before any LLM call
- `embed.ts` — Vertex / Gemini embedding wrapper (768-dim)
- `retrieve.ts` — calls `match_agent_chunks` RPC
- `llm.ts` — single interface across Vertex / Gemini / Groq
- `audit.ts` — writes `agent_audit_log` row per invocation (hashes only)
- `loader.ts` — Deno port of the agent-pack loader contract
- `service-client.ts` — service-role Supabase client

## Deploy

### 1. Run the migration
```bash
supabase db push
# applies supabase/migrations/20260509120000_business_brain_foundation.sql
# - enables pgvector
# - creates agent_documents, agent_chunks, agent_memory, agent_runs, agent_audit_log
# - creates agent-corpus storage bucket with RLS
# - creates match_agent_chunks RPC
```

### 2. Set Edge Function secrets
```bash
supabase secrets set \
    VERTEX_PROJECT_ID=<gcp-project> \
    VERTEX_REGION=asia-south1 \
    VERTEX_ACCESS_TOKEN=<short-lived; rotate via service account> \
    GEMINI_API_KEY=<consumer-gemini-fallback> \
    GROQ_API_KEY=<groq-cloud-key> \
    HOSPITAL_CONTACT="+91-22-XXXXXXXX"
```

### 3. Deploy the functions
```bash
supabase functions deploy agent-ingest
supabase functions deploy agent-pharmacy-reorder
supabase functions deploy agent-patient-previsit
supabase functions deploy agent-clinical-priorvisit
```

### 4. Wire the corpus webhook
Supabase Dashboard → Database → Webhooks → New webhook:
- Table: `storage.objects`
- Events: `INSERT`
- Filter: `bucket_id = 'agent-corpus'`
- Target: `POST https://<your-project>.functions.supabase.co/agent-ingest`

### 5. Set front-end feature flags
In Vercel project settings (or local `.env.local`):
```
VITE_BRAIN_ENABLED=true
VITE_BRAIN_PHARMACY=true
VITE_BRAIN_PATIENT_PREVISIT=false   # flip on after 30 days of pharmacy
VITE_BRAIN_CLINICAL_BRIEF=false     # flip on after pre-visit hits 9/10 trust
```

## Rollout

1. **Foundation merged behind flags.** Migration is additive — safe.
2. **Pharmacy reorder first.** No PHI. Pilot with one ward for 2 weeks. Compare suggestions to manual reorder decisions weekly. Flip on hospital-wide once accuracy ≥ 90%.
3. **Patient pre-visit second.** Front-desk approves every send for first 30 days. Auto-approval allowed only if error rate < 1% across 200 sends.
4. **Clinical brief third — shadow mode for 30 days first.** Generate the brief, log it, but don't show the doctor. Sample 50 briefs/week with a clinical reviewer. Only flip on after explicit chief-medical-officer sign-off.

## Operating

- **Daily:** check `agent_runs` table for `confidence < 0.8` rows and review the corresponding outputs.
- **Weekly:** export `agent_audit_log` for the prior week to the DPO mailbox.
- **Monthly:** review which agents are paying for themselves vs being ignored. Retire what isn't.

## What's NOT in v1

- Admin / billing agents (deferred).
- The runtime cyclic-RAG loop (these three agents are single-pass; cyclic is added when retrieval-heavy agents like the SOP runner come online).
- Eval harness / RAGAS golden sets (Phase C — before the second batch of agents).
- On-prem deployment (revisit if regulator or IT requires it).
