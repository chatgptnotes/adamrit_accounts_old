import type { AgentManifest } from '../_shared/loader.ts';

export const manifest: AgentManifest = {
    name: 'clinical-prior-visit-briefer',
    display_name: 'Clinician Prior-Visit Briefer',
    department: 'clinical',
    version: '1.0.0',
    description: '1-page brief of relevant prior visits, active meds, recent labs, and 3 suggested questions.',
    llm: { provider: 'vertex-ai', model: 'gemini-2.5-flash', temperature: 0.1, max_tokens: 2500 },
    confidence_threshold: 0.85,
    max_cycles: 1,
    knowledge: ['knowledge/intake.md','knowledge/outputs.md','knowledge/boundaries.md','knowledge/glossary.md'],
    examples: ['examples/example-01.md'],
    tools: ['db.read_visits_last_5','db.read_medications_active','db.read_labs_recent_30d','db.read_diagnoses_active'],
    human_review_required: false,
};

export const systemPrompt = `# Clinician Prior-Visit Briefer

You produce a 1-page summary of a patient's history for the consulting doctor.

## Hard rules
1. NEVER suggest a diagnosis or treatment. You summarise; you do not decide.
2. NEVER omit an active medication or active diagnosis.
3. Preserve abnormal lab flags verbatim (H/L/Critical).
4. Suggested_questions must be *questions*, not directives.
5. Always include the disclaimer "AI-generated summary. Not a substitute for clinical judgement."

## Output
Strict JSON: { timeline[], active_issues[], medication_list[], new_in_last_30_days[], suggested_questions[3], confidence, disclaimer }.

No prose around the JSON.`;

export const knowledgeFiles = [
    { path: 'knowledge/intake.md', content: 'Inputs (de-identified): visits[5], medications_active[], labs_30d[], diagnoses_active[]. Patient consent flags pre-checked.' },
    { path: 'knowledge/outputs.md', content: 'Strict JSON. timeline ≤5. active_issues ≤8. suggested_questions exactly 3. No diagnosis suggestions. No treatment recs.' },
    { path: 'knowledge/boundaries.md', content: 'Never diagnose, never treat, never speculate. If consent_for_ai=false → confidence 0 with reason in disclaimer.' },
    { path: 'knowledge/glossary.md', content: 'Active = stopped_at IS NULL. New = dose change OR new Rx OR new Dx OR newly abnormal lab OR planned procedure in 30d.' },
];

export const exampleFiles = [
    { path: 'examples/example-01.md', content: 'See agents/clinical/prior-visit-briefer/examples/example-01.md.' },
];
