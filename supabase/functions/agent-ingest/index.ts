// =============================================================================
// agent-ingest — webhook target for storage.objects insert events on the
// agent-corpus bucket. Downloads the new file, chunks, embeds, and indexes
// into agent_chunks.
//
// Trigger to wire (Supabase Dashboard → Database → Webhooks):
//   table:    storage.objects
//   events:   INSERT
//   filter:   bucket_id = 'agent-corpus'
//   target:   POST {{SUPABASE_URL}}/functions/v1/agent-ingest
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { embed } from '../_shared/embed.ts';
import { getServiceClient } from '../_shared/service-client.ts';

const CHUNK_SIZE = 1200;     // characters
const CHUNK_OVERLAP = 200;

interface WebhookPayload {
    type: string;
    record?: { name: string; bucket_id: string; metadata?: Record<string, unknown> };
}

function chunk(text: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < text.length) {
        out.push(text.slice(i, i + CHUNK_SIZE));
        i += CHUNK_SIZE - CHUNK_OVERLAP;
    }
    return out;
}

// Department + agent_pack are derived from the storage path:
//   agent-corpus/<dept>/<pack>/<file>.md
function deriveScope(path: string): { department: string; agentPack: string | null } {
    const parts = path.split('/').filter(Boolean);
    const department = parts[0] ?? 'general';
    const agentPack = parts.length >= 3 ? parts[1] : null;
    return { department, agentPack };
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const payload: WebhookPayload = await req.json();
        const path = payload.record?.name;
        const bucket = payload.record?.bucket_id;
        if (!path || bucket !== 'agent-corpus') {
            return new Response(JSON.stringify({ skipped: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const supabase = getServiceClient();

        // Download the new object
        const { data: file, error: dlErr } = await supabase.storage.from('agent-corpus').download(path);
        if (dlErr) throw new Error(`download: ${dlErr.message}`);
        const text = await file.text();

        const { department, agentPack } = deriveScope(path);

        // Upsert document row
        const { data: docRow, error: docErr } = await supabase
            .from('agent_documents')
            .upsert({
                storage_path: path,
                title:        path.split('/').pop() ?? path,
                department,
                agent_pack:   agentPack,
                indexed_at:   new Date().toISOString(),
                indexed_version: '1',
            }, { onConflict: 'storage_path' })
            .select('id')
            .single();
        if (docErr) throw new Error(`document upsert: ${docErr.message}`);

        // Wipe prior chunks for this document (idempotent re-index)
        await supabase.from('agent_chunks').delete().eq('document_id', docRow.id);

        // Chunk + embed + insert
        const chunks = chunk(text);
        const rows = await Promise.all(chunks.map(async (content, idx) => ({
            document_id: docRow.id,
            chunk_index: idx,
            content,
            embedding:   await embed(content),
            department,
            agent_pack:  agentPack,
        })));

        // Insert in batches of 50 to stay within row size limits
        for (let i = 0; i < rows.length; i += 50) {
            const slice = rows.slice(i, i + 50);
            const { error: insErr } = await supabase.from('agent_chunks').insert(slice);
            if (insErr) throw new Error(`chunk insert: ${insErr.message}`);
        }

        return new Response(JSON.stringify({ ok: true, document_id: docRow.id, chunks: rows.length, department, agent_pack: agentPack }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (e) {
        console.error('[agent-ingest]', (e as Error).message);
        return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
