# Department Agent Library — Adamrit Hospital

Three agent packs for the v1 pilot. Each pack is the source of truth for that agent's persona; the Edge Function bundles a copy via its `pack.ts` for runtime.

```
agents/
├── pharmacy/reorder-suggester/         (Groq, no PHI)
├── patient/pre-visit-instructions/     (Vertex AI, light PHI)
└── clinical/prior-visit-briefer/       (Vertex AI, internal-only PHI)
```

Each pack contains the same 8 files: `agent.yaml`, `system-prompt.md`, `tools.md`, `knowledge/{intake,outputs,boundaries,glossary}.md`, `examples/example-01.md`.

## To customise for a different hospital
Edit the markdown — typical changes:
- `system-prompt.md` — voice & tone match the hospital's brand
- `knowledge/boundaries.md` — local escalation chain
- `knowledge/glossary.md` — local jargon, schedule classes, languages
- `examples/example-01.md` — add 2–3 real (de-identified) examples

Then bump `agent.yaml::version` and re-deploy the matching Edge Function.

## To add a new agent
1. Copy a similar existing pack as scaffolding.
2. Create a new `supabase/functions/agent-<slug>/` with `pack.ts` + `index.ts`.
3. Add a typed wrapper in `src/lib/brain.ts`.
4. Add a feature flag `VITE_BRAIN_<SLUG>` and gate the UI on it.
5. Add a row to `docs/business-brain/README.md` describing what it does.

## Loader contract
The `pack.ts` files implement the contract documented in
`business-brain-blueprint/agents/loader-spec.md` (the upstream blueprint), ported to Deno via `supabase/functions/_shared/loader.ts`.
