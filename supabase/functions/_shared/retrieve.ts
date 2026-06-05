// =============================================================================
// Retrieval node — calls the match_agent_chunks RPC and returns top-k chunks
// scoped by department / agent_pack. Cyclic RAG re-call handled by the agent
// runtime, not here.
// =============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { embed, type EmbedProvider } from './embed.ts';

export interface RetrievedChunk {
    id: number;
    document_id: number;
    content: string;
    department: string;
    agent_pack: string | null;
    similarity: number;
}

export interface RetrieveOptions {
    department?: string;
    agentPack?: string;
    topK?: number;
    embedProvider?: EmbedProvider;
}

export async function retrieve(
    supabase: SupabaseClient,
    query: string,
    opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
    const queryEmbedding = await embed(query, opts.embedProvider ?? 'vertex-ai');
    const { data, error } = await supabase.rpc('match_agent_chunks', {
        query_embedding: queryEmbedding,
        match_count:     opts.topK ?? 5,
        filter_dept:     opts.department ?? null,
        filter_pack:     opts.agentPack ?? null,
    });
    if (error) throw new Error(`retrieve: ${error.message}`);
    return (data ?? []) as RetrievedChunk[];
}
