// Generic "scan any document for a task" extractor. Reuses the bill scanner's
// document-agnostic OCR (readBillText) to turn a PDF/image into text, then asks
// the LLM to infer — from the TASK NAME — what information is relevant and pull
// it out as structured fields. No per-task schema: the AI decides the fields.
//
// VPS Claude is text-only, so OCR-then-text is the only backend-agnostic path
// (works without a Gemini key). Mirrors parseReminderFromPrompt's dual-backend
// dispatch + strict-JSON parsing.
import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { readBillText } from '@/lib/extractUtilityBill';

export interface ScanField {
  label: string;
  value: string;
}
export interface ScanResult {
  title: string;
  summary: string;
  fields: ScanField[];
  rawText: string;
}

// A scanned document attached to a task (stored in task_optimizer_logs.task_attachments).
export interface ScanAttachment {
  title: string;
  summary: string;
  fields: ScanField[];
  fileUrl: string | null;
  createdAt: string;
}

interface RawScan {
  title?: string;
  summary?: string;
  fields?: Array<{ label?: unknown; value?: unknown }>;
}

function buildPrompt(task: string, designation: string, text: string): string {
  // Cap OCR text so the prompt stays reasonable.
  const doc = text.length > 6000 ? `${text.slice(0, 6000)}\n…(truncated)` : text;
  return `You extract structured information from a scanned document.

This document was scanned for the task "${task}" (staff role: ${designation || 'staff'}). Infer from the task what information matters, and pull out the fields a person doing this task would care about.

Document text (from OCR — may have minor errors):
"""
${doc}
"""

Return ONLY valid JSON (no markdown, no code fences) of exactly this shape:
{
  "title": "a short title for this document (e.g. 'Lab report — CBC', 'Electricity bill', 'Referral letter')",
  "summary": "one or two plain sentences summarising the document for this task",
  "fields": [ { "label": "field name", "value": "extracted value" } ]
}

Rules:
- 3 to 8 fields, the ones most relevant to the task. Use the document's own values; do not invent.
- If a value isn't present, omit that field (don't guess).
- Keep labels and values short.
- Output a single valid JSON object.`;
}

async function runLlm(prompt: string): Promise<string> {
  if (LLM_BACKEND === 'vps') return callVpsClaude(prompt);
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  const response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
    }),
  });
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function scanAndExtractForTask(input: {
  file: Blob;
  fileName: string;
  task: string;
  designation: string;
}): Promise<ScanResult> {
  const rawText = await readBillText(input.file, input.fileName);
  if (!rawText || rawText.replace(/\s/g, '').length < 8) {
    throw new Error("Couldn't read any text from that document. Try a clearer photo or a PDF.");
  }

  const text = await runLlm(buildPrompt(input.task, input.designation, rawText));
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: RawScan;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('The AI could not extract the document. Please try again.');
    parsed = JSON.parse(m[0]);
  }

  const fields: ScanField[] = Array.isArray(parsed.fields)
    ? parsed.fields
        .map((f) => ({
          label: (f?.label ?? '').toString().trim().slice(0, 60),
          value: (f?.value ?? '').toString().trim().slice(0, 200),
        }))
        .filter((f) => f.label && f.value)
        .slice(0, 10)
    : [];

  return {
    title: (parsed.title ?? '').toString().trim().slice(0, 100) || 'Scanned document',
    summary: (parsed.summary ?? '').toString().trim().slice(0, 400),
    fields,
    rawText,
  };
}
