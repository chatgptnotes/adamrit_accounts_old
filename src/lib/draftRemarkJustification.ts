import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';

// Drafts the reply to an ESIC scrutinizer's query on a claim.
//
// The draft is a starting point, not an answer. Almost every ESIC query asks
// for a document — a referral letter, a stamped IPD sheet, an extension
// approval — and no model can know whether the hospital actually holds it. So
// the prompt below forbids inventing clinical facts, dates or documents, and
// makes the model leave [square-bracket placeholders] wherever a human has to
// supply something. A reply that reads as finished when it is not would be
// worse than an empty box.
//
// Only the remark text is sent. The patient's name, UHID and card number are
// not needed to draft a reply and stay out of the request.
const DRAFT_PROMPT = `You are a billing executive at an ESIC-empanelled hospital in Nagpur, India, replying to a query raised by an ESIC scrutinizer on a submitted claim.

You will be given the scrutinizer's remark. Write the hospital's reply.

Rules:
- Reply in formal, plain English. 1 to 3 sentences. No salutation, no sign-off, no subject line.
- Address every item the remark asks for. If it lists numbered documents, confirm each one.
- NEVER invent clinical facts, dates, diagnoses, document numbers or names. You do not have the patient's file.
- Where a specific fact is required that only the treating team can supply, write a [placeholder in square brackets] describing what to fill in — for example "[state the clinical reason for the extended stay]".
- Where the query asks for a document, say it is enclosed/attached, since the reply accompanies the resubmission.
- Output the reply text only. No markdown, no preamble, no quotes.

Scrutinizer's remark:
`;

/**
 * Draft a justification for one ESIC scrutiny remark. Throws on any failure
 * (proxy error, empty response) — callers surface a toast.
 */
export async function draftRemarkJustification(remark: string): Promise<string> {
  const trimmed = remark.trim();
  if (!trimmed) throw new Error('There is no remark to reply to');

  const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${DRAFT_PROMPT}${trimmed}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    }),
  });

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/^["']|["']$/g, '').trim();
  if (!cleaned) throw new Error('The AI returned an empty reply');
  return cleaned;
}
