// =============================================================================
// Audit logger — writes one row to agent_audit_log per agent invocation.
// Hashes the payloads (sha256) so the log can be retained without PHI.
// Non-blocking: failures log to console but do not break the agent response.
// =============================================================================

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuditEntry {
    invokedBy: string | null;            // auth.users.id (nullable for cron)
    agentSlug: string;
    packVersion: string;
    rawInput: unknown;                   // hashed before write
    rawOutput: unknown | null;           // hashed before write
    retrievedChunks: number[];
    llmProvider: string;
    llmModel: string;
    llmRegion: string;
    deidentifiedCount: number;
    confidence: number | null;
    handedToHuman: boolean;
    errorMessage?: string | null;
}

async function sha256(text: string): Promise<string> {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function audit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
    try {
        const inputHash = await sha256(JSON.stringify(entry.rawInput ?? null));
        const outputHash = entry.rawOutput == null ? null : await sha256(JSON.stringify(entry.rawOutput));
        const { error } = await supabase.from('agent_audit_log').insert({
            invoked_by:         entry.invokedBy,
            agent_slug:         entry.agentSlug,
            pack_version:       entry.packVersion,
            input_hash:         inputHash,
            output_hash:        outputHash,
            retrieved_chunks:   entry.retrievedChunks,
            llm_provider:       entry.llmProvider,
            llm_model:          entry.llmModel,
            llm_region:         entry.llmRegion,
            deidentified_count: entry.deidentifiedCount,
            confidence:         entry.confidence,
            handed_to_human:    entry.handedToHuman,
            error_message:      entry.errorMessage ?? null,
        });
        if (error) console.error('[audit] insert failed:', error.message);
    } catch (e) {
        console.error('[audit] unexpected:', (e as Error).message);
    }
}
