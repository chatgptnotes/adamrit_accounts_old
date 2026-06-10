// Browser-side helper that routes a prompt through /api/skill-factory-claude
// to the VPS Claude sidecar. Used by the Skill Factory chatbot's two LLM call
// sites (generateFlowFromPrompt + parseReminderFromPrompt singular).
//
// No fallback: on any non-2xx, throw with the server-returned error text so the
// chatbot surfaces the real upstream failure instead of silently retrying on
// another provider. Per-decision: "i dont want any fallback it should show
// error exact".

export const LLM_BACKEND: 'vps' | 'gemini' =
  (import.meta.env.VITE_LLM_BACKEND as 'vps' | 'gemini' | undefined) === 'vps' ? 'vps' : 'gemini';

export interface VpsClaudeResponse {
  // The Claude CLI's --output-format=json envelope. The CLI returns
  // { result: string, ... } among other fields; callers parse `result` as the
  // model's textual output.
  result?: string;
  [k: string]: unknown;
}

export async function callVpsClaude(prompt: string): Promise<string> {
  const res = await fetch('/api/skill-factory-claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`VPS Claude error ${res.status}: ${body || res.statusText}`);
  }

  const data = (await res.json()) as VpsClaudeResponse;
  const text = typeof data.result === 'string' ? data.result : '';
  if (!text) throw new Error('VPS Claude returned an empty response.');
  return text;
}
