// =============================================================================
// agent-pharmacy-reorder — produces a ranked reorder list from inventory + sales.
//
// Inputs: optional { hospital_id, horizon_days }. Pulls data from Supabase.
// Output: { items[], notes[], needs_human, generated_at } per outputs.md.
//
// PHI: none. Pure aggregate inventory data. Uses Groq for fast batch inference.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient, getInvokerId } from '../_shared/service-client.ts';
import { invokePack, loadPack } from '../_shared/loader.ts';
import { audit } from '../_shared/audit.ts';
import { manifest, systemPrompt, knowledgeFiles, exampleFiles } from './pack.ts';

interface RequestBody { hospital_id?: string; horizon_days?: number }

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startedAt = Date.now();
    const supabase = getServiceClient();
    const invokerId = getInvokerId(req);
    const pack = loadPack({ manifest, systemPrompt, knowledgeFiles, exampleFiles });

    try {
        const body: RequestBody = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
        const horizonDays = body.horizon_days ?? 30;

        // 1. Pull inventory.
        const { data: inventory, error: invErr } = await supabase
            .from('medication')
            .select('id, name, on_hand, pack_size, supplier, schedule, discontinued')
            .eq('discontinued', false)
            .limit(2000);
        if (invErr) throw new Error(`inventory: ${invErr.message}`);

        // 2. Aggregate last 90 days of sales per medicine.
        const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
        const { data: salesRows, error: salesErr } = await supabase
            .from('pharmacy_sale_items')
            .select('medicine_id, quantity, created_at')
            .gte('created_at', since)
            .limit(50_000);
        if (salesErr) throw new Error(`sales: ${salesErr.message}`);

        const salesByMed = new Map<string, { total: number; days: Set<string> }>();
        for (const row of salesRows ?? []) {
            const key = (row.medicine_id as string) ?? '';
            if (!key) continue;
            const day = (row.created_at as string).slice(0, 10);
            const cur = salesByMed.get(key) ?? { total: 0, days: new Set<string>() };
            cur.total += Number(row.quantity ?? 0);
            cur.days.add(day);
            salesByMed.set(key, cur);
        }

        // 3. Supplier lead times.
        const { data: suppliers } = await supabase
            .from('suppliers')
            .select('name, lead_time_days');
        const leadTimes = Object.fromEntries((suppliers ?? []).map(s => [s.name as string, s.lead_time_days as number]));

        // 4. Build the agent input.
        const sales_90d = Array.from(salesByMed.entries()).map(([id, v]) => ({ medicine_id: id, total_qty: v.total, distinct_days: v.days.size }));

        const userMessage = JSON.stringify({
            inventory: (inventory ?? []).map(i => ({
                medicine_id: i.id, medicine_name: i.name, on_hand: i.on_hand,
                pack_size: i.pack_size ?? 1, supplier: i.supplier, schedule: i.schedule, discontinued: i.discontinued,
            })),
            sales_90d,
            lead_times: leadTimes,
            horizon_days: horizonDays,
        });

        // 5. Invoke. No retrieval needed — inputs are deterministic.
        const llmResp = await invokePack({ pack, userMessage, retrievalBlock: '' });

        // 6. Parse JSON envelope (model returns JSON-only per system prompt).
        let parsed: unknown;
        try {
            parsed = JSON.parse(llmResp.text);
        } catch {
            const match = llmResp.text.match(/\{[\s\S]*\}/);
            parsed = match ? JSON.parse(match[0]) : { items: [], notes: ['LLM did not return valid JSON'], needs_human: true };
        }

        const result = parsed as { items: unknown[]; notes: string[]; needs_human: boolean };
        result.generated_at = new Date().toISOString();

        // 7. Audit + run log.
        await audit(supabase, {
            invokedBy: invokerId,
            agentSlug: manifest.name,
            packVersion: manifest.version,
            rawInput: { horizon_days: horizonDays, inv_count: inventory?.length ?? 0, sales_count: sales_90d.length },
            rawOutput: result,
            retrievedChunks: [],
            llmProvider: 'groq',
            llmModel: manifest.llm.model,
            llmRegion: 'us-cloud',
            deidentifiedCount: 0,
            confidence: 0.9,
            handedToHuman: result.needs_human ?? true,
        });

        await supabase.from('agent_runs').insert({
            session_id: crypto.randomUUID(),
            agent_slug: manifest.name,
            invoked_by: invokerId,
            question: 'cron|on-demand reorder scan',
            answer: JSON.stringify({ count: result.items.length, needs_human: result.needs_human }),
            confidence: 0.9,
            cycles: 1,
            handed_to_human: result.needs_human ?? true,
            duration_ms: Date.now() - startedAt,
        });

        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
        const msg = (e as Error).message;
        console.error('[agent-pharmacy-reorder]', msg);
        await audit(supabase, {
            invokedBy: invokerId, agentSlug: manifest.name, packVersion: manifest.version,
            rawInput: 'error path', rawOutput: null, retrievedChunks: [],
            llmProvider: 'groq', llmModel: manifest.llm.model, llmRegion: 'us-cloud',
            deidentifiedCount: 0, confidence: null, handedToHuman: false,
            errorMessage: msg,
        });
        return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
