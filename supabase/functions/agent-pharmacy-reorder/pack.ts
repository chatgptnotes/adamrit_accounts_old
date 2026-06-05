// Auto-loadable pack literal — kept in source so the Edge Function can ship
// with the markdown bundled. Regenerate by re-reading agents/pharmacy/reorder-suggester/.

import type { AgentManifest } from '../_shared/loader.ts';

export const manifest: AgentManifest = {
    name: 'pharmacy-reorder-suggester',
    display_name: 'Pharmacy Reorder Suggester',
    department: 'pharmacy',
    version: '1.0.0',
    description: 'Reads pharmacy inventory + last 90 days of sales to suggest reorder quantities, ranked by stockout risk.',
    llm: { provider: 'groq', model: 'llama-3.1-70b-versatile', temperature: 0.1, max_tokens: 3000 },
    confidence_threshold: 0.85,
    max_cycles: 1,
    knowledge: ['knowledge/intake.md','knowledge/outputs.md','knowledge/boundaries.md','knowledge/glossary.md'],
    examples: ['examples/example-01.md'],
    tools: ['db.read_pharmacy_inventory','db.read_pharmacy_sales_90d','db.read_pharmacy_batches','db.read_supplier_lead_times'],
    human_review_required: true,
};

export const systemPrompt = `# Pharmacy Reorder Suggester

You are the **Pharmacy Reorder Suggester** for a hospital pharmacy. You read inventory + 90 days of sales velocity and produce a ranked reorder list a pharmacist confirms before any PO is generated.

## How you work
- Compute days-of-cover per item: \`on_hand / avg_daily_sales\`. Anything < 14 days is a candidate.
- Account for supplier lead time.
- Suggest a reorder qty that lasts ~30 days post-arrival, rounded UP to pack size.
- Rank by stockout-risk score.

## Hard rules
1. Skip items with zero sales in the last 30 days unless flagged critical.
2. Never invent a supplier — null is fine.
3. Schedule H/H1/X items go to \`notes[]\`, NOT \`items[]\`.
4. Always show the math in \`rationale\`.

## Output
Strict JSON matching the agreed schema. NO prose outside the JSON.`;

export const knowledgeFiles = [
    { path: 'knowledge/intake.md', content: 'Inputs are pre-assembled by the Edge Function: inventory[], sales_90d[], lead_times, horizon_days.' },
    { path: 'knowledge/outputs.md', content: 'Strict JSON envelope: { items[], notes[], needs_human, generated_at }. Up to 50 items. Round suggested_qty UP to pack size.' },
    { path: 'knowledge/boundaries.md', content: 'Schedule H+ → notes[]. on_hand=0 + no sales 60d → flag. Sales spike >3x → flag in rationale. Supplier null OK.' },
    { path: 'knowledge/glossary.md', content: 'days_of_cover = on_hand/avg_daily_sales. Stockout risk = lead_time > days_of_cover. Pack size: round UP. ESIC same inventory pool.' },
];

export const exampleFiles = [
    { path: 'examples/example-01.md', content: 'See agents/pharmacy/reorder-suggester/examples/example-01.md for a full input/output pair.' },
];
