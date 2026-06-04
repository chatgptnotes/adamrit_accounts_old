// =============================================================================
// LLM wrapper — single interface across providers. Choice of provider is
// per-agent (set in agent.yaml) so clinical agents can pin to Vertex AI
// (DPDP-compliant DPA) while pharmacy can use Groq (no PHI involved).
// =============================================================================

const VERTEX_REGION = Deno.env.get('VERTEX_REGION') ?? 'asia-south1';
const VERTEX_PROJECT = Deno.env.get('VERTEX_PROJECT_ID') ?? '';
const VERTEX_ACCESS_TOKEN = Deno.env.get('VERTEX_ACCESS_TOKEN') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';

export type LLMProvider = 'vertex-ai' | 'gemini' | 'groq';

export interface LLMRequest {
    provider: LLMProvider;
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    temperature?: number;
    maxTokens?: number;
}

export interface LLMResponse {
    text: string;
    usage?: { input?: number; output?: number };
    raw?: unknown;
}

export async function llmGenerate(req: LLMRequest): Promise<LLMResponse> {
    switch (req.provider) {
        case 'vertex-ai': return generateVertex(req);
        case 'gemini':    return generateGemini(req);
        case 'groq':      return generateGroq(req);
        default: throw new Error(`Unknown LLM provider: ${req.provider}`);
    }
}

// -----------------------------------------------------------------------------
// Vertex AI Gemini — DPDP-compliant DPA available in asia-south1.
// Use for any agent that touches PHI.
// -----------------------------------------------------------------------------
async function generateVertex(req: LLMRequest): Promise<LLMResponse> {
    if (!VERTEX_ACCESS_TOKEN || !VERTEX_PROJECT) {
        throw new Error('Vertex AI not configured (VERTEX_ACCESS_TOKEN + VERTEX_PROJECT_ID required).');
    }
    const url = `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/${VERTEX_REGION}/publishers/google/models/${req.model}:generateContent`;
    const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxTokens ?? 2000 },
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${VERTEX_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Vertex generateContent ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const usage = json.usageMetadata ? { input: json.usageMetadata.promptTokenCount, output: json.usageMetadata.candidatesTokenCount } : undefined;
    return { text, usage, raw: json };
}

// -----------------------------------------------------------------------------
// Consumer Gemini — used only for non-PHI content (this matches the existing
// adamrit src/lib/gemini.ts conventions). Clinical agents must NOT use this.
// -----------------------------------------------------------------------------
async function generateGemini(req: LLMRequest): Promise<LLMResponse> {
    if (!GEMINI_API_KEY) throw new Error('Gemini not configured (GEMINI_API_KEY required).');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxTokens ?? 2000 },
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Gemini generateContent ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { text, raw: json };
}

// -----------------------------------------------------------------------------
// Groq — fast inference for non-PHI agents (pharmacy reorder).
// -----------------------------------------------------------------------------
async function generateGroq(req: LLMRequest): Promise<LLMResponse> {
    if (!GROQ_API_KEY) throw new Error('Groq not configured (GROQ_API_KEY required).');
    const messages = [
        { role: 'system' as const, content: req.system },
        ...req.messages,
    ];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: req.model,
            messages,
            temperature: req.temperature ?? 0.2,
            max_tokens: req.maxTokens ?? 2000,
        }),
    });
    if (!res.ok) throw new Error(`Groq chat ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '';
    const usage = json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : undefined;
    return { text, usage, raw: json };
}
