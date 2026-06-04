// =============================================================================
// Agent pack loader — Deno port of the loader contract in
// business-brain-blueprint/agents/loader-spec.md.
//
// Each agent pack ships as 8 markdown files. At Edge Function startup we read
// them, concatenate the system prompt + knowledge files, and expose a typed
// invoke() helper that the agent's index.ts uses.
// =============================================================================

import { llmGenerate, type LLMProvider, type LLMRequest } from './llm.ts';

export interface AgentManifest {
    name: string;
    display_name: string;
    department: string;
    version: string;
    description: string;
    llm: { provider: LLMProvider; model: string; temperature?: number; max_tokens?: number };
    confidence_threshold: number;
    max_cycles: number;
    knowledge: string[];
    examples: string[];
    tools: string[];
    human_review_required: boolean;
}

export interface LoadedPack {
    manifest: AgentManifest;
    systemMessage: string;
    examplesText: string;
}

// In Supabase Edge Functions, packs are bundled at deploy time as raw strings
// because the Deno runtime can't read arbitrary fs paths from the agents/
// folder at runtime. The agent function imports its pack via a generated
// `pack.ts` (one per agent) that exports manifest + the file contents.
//
// This loader takes those literal strings and assembles the system message.

export interface PackInput {
    manifest: AgentManifest;
    systemPrompt: string;
    knowledgeFiles: { path: string; content: string }[];
    exampleFiles: { path: string; content: string }[];
}

export function loadPack(input: PackInput): LoadedPack {
    const { manifest, systemPrompt, knowledgeFiles, exampleFiles } = input;

    const knowledgeBlock = knowledgeFiles
        .map(f => `### ${f.path}\n${f.content}`)
        .join('\n\n');

    const systemMessage = [
        systemPrompt.trim(),
        '\n---\n## Bootstrap knowledge\n',
        knowledgeBlock,
        '\n---\n',
        'Grounded retrieval will be appended to user messages at query time.',
    ].join('\n');

    const examplesText = exampleFiles.map(f => f.content).join('\n\n---\n\n');

    return { manifest, systemMessage, examplesText };
}

export interface InvokeArgs {
    pack: LoadedPack;
    userMessage: string;
    retrievalBlock: string;       // the formatted top-k chunks
    history?: { role: 'user' | 'assistant'; content: string }[];
}

export async function invokePack(args: InvokeArgs) {
    const { pack, userMessage, retrievalBlock, history = [] } = args;
    const userWithContext = [
        '## Retrieved context',
        retrievalBlock || '_(no context retrieved)_',
        '',
        '## Few-shot examples',
        pack.examplesText,
        '',
        '## Question',
        userMessage,
    ].join('\n');

    const req: LLMRequest = {
        provider: pack.manifest.llm.provider,
        model:    pack.manifest.llm.model,
        system:   pack.systemMessage,
        messages: [...history, { role: 'user', content: userWithContext }],
        temperature: pack.manifest.llm.temperature,
        maxTokens:   pack.manifest.llm.max_tokens,
    };
    return llmGenerate(req);
}
