import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';

// Drafts the justification the hospital files against an ESIC scrutinizer's
// query on a claim.
//
// This is a justification, not a covering note. The hospital's position is that
// the papers went in with the original claim; the scrutinizer is asking for
// them again, so the reply says both — they were submitted, and they are being
// submitted once more. That is the structure below: submit that it was already
// filed, then re-file it, then ask for the claim to be passed.
//
// The draft is still a starting point. No model can know what is in the
// patient's file, so it may not invent clinical facts, dates or approvals, and
// anything only the treating team can supply comes back as a [square-bracket
// placeholder]. A reply that reads as finished when it is not would be worse
// than an empty box.
//
// Only the remark text is sent. The patient's name, UHID and card number are
// not needed to draft a reply and stay out of the request.
const DRAFT_PROMPT = `You are a billing executive at an ESIC-empanelled hospital in Nagpur, India. An ESIC scrutinizer has raised a query (an "L2 remark") on a claim the hospital has already submitted. Write the hospital's written JUSTIFICATION against that query.

This is a formal justification filed on the claim, not a short message. The hospital's position is that the required documents and proof were furnished along with the original claim submission, and that they are now being furnished again in compliance with the observation.

Structure it in this order:
1. Open by submitting, with reference to the observation, that the documents in question were enclosed with the original claim submission.
2. State that notwithstanding the same, in compliance with the remark, the documents are being re-submitted herewith for kind perusal — naming each item the remark asks for.
3. Close by requesting that the claim be considered and processed further.

The remark is written in hospital shorthand. Read it with this glossary:
- DOD = date of discharge. DOA = date of admission. DS = discharge summary. IPD = in-patient department record. OPD = out-patient department. UHID = the patient's hospital ID. L2 = the scrutiny stage.
- Do NOT expand any other abbreviation you are not certain of — repeat it exactly as the remark wrote it. Guessing at an expansion invents a document that does not exist.

Rules:
- Formal claim-correspondence English, in the first person plural ("we", "the hospital"). 3 to 5 sentences, in a single paragraph.
- Do not mention a claim number, and never write a placeholder for one — the justification is filed against the claim itself, which already carries its number.
- No salutation, no sign-off, no subject line, no numbered list in the output — it must read as continuous prose.
- Name every item the remark asks for. If the remark lists numbered documents, cover each one.
- NEVER invent clinical facts, dates, diagnoses, document numbers or names. You do not have the patient's file.
- Never claim that an approval, extension or sanction was granted by any authority, and never claim a document has since been obtained or corrected. Prior submission of the papers is the hospital's position; anything further is not.
- Where a fact is required that only the treating team can supply, write a [placeholder in square brackets] describing what to fill in — for example "[state the clinical reason for the extended stay]".
- Output the justification text only. No markdown, no preamble, no quotes.

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
