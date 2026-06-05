// =============================================================================
// Embedding wrapper — Vertex AI text-embedding-004 (768 dims) with a Gemini
// fallback for the consumer API path. The agent_chunks table is sized 768.
// =============================================================================

const VERTEX_REGION = Deno.env.get('VERTEX_REGION') ?? 'asia-south1';
const VERTEX_PROJECT = Deno.env.get('VERTEX_PROJECT_ID') ?? '';
const VERTEX_ACCESS_TOKEN = Deno.env.get('VERTEX_ACCESS_TOKEN') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

const VERTEX_EMBED_URL = (model: string) =>
    `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_REGION}/publishers/google/models/${model}:predict`;

const GEMINI_EMBED_URL = (model: string, key: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`;

export type EmbedProvider = 'vertex-ai' | 'gemini';

export async function embed(text: string, provider: EmbedProvider = 'vertex-ai'): Promise<number[]> {
    if (provider === 'vertex-ai' && VERTEX_ACCESS_TOKEN && VERTEX_PROJECT) {
        return embedVertex(text);
    }
    if (GEMINI_API_KEY) {
        return embedGemini(text);
    }
    throw new Error('No embedding provider configured (set VERTEX_ACCESS_TOKEN or GEMINI_API_KEY).');
}

async function embedVertex(text: string): Promise<number[]> {
    const res = await fetch(VERTEX_EMBED_URL('text-embedding-004'), {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${VERTEX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instances: [{ content: text }] }),
    });
    if (!res.ok) throw new Error(`Vertex embed ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.predictions?.[0]?.embeddings?.values ?? [];
}

async function embedGemini(text: string): Promise<number[]> {
    const res = await fetch(GEMINI_EMBED_URL('embedding-001', GEMINI_API_KEY), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
    });
    if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.embedding?.values ?? [];
}
