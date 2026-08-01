import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';

// Drafts the justification the hospital files against an ESIC scrutinizer's
// query on a claim.
//
// WHY THERE ARE THREE APPROACHES AND NOT ONE
// The 45 remarks in the worklist ask three different things, and only one of
// them is answered by re-sending paper:
//   - a document or a signature is missing;
//   - the stay ran past the referral's validity and an extension is wanted;
//   - the care given is challenged — referred for superspeciality treatment,
//     treated by a general surgeon, "kindly justify".
// A single prompt answered all three as if they were the first, which was wrong
// for about a third of the list. The person answering picks the family, because
// they know the claim; the wording is then written for that family.
//
// Every draft is still a starting point. No model can know what is in the
// patient's file, so it may not invent clinical facts, dates or approvals, and
// anything only the treating team can supply comes back as a [square-bracket
// placeholder]. A reply that reads as finished when it is not would be worse
// than an empty box.
//
// Only the remark text is sent. The patient's name, UHID and card number are
// not needed to draft a reply and stay out of the request.

export type JustificationApproach = 'documents' | 'extension' | 'care';

export interface ApproachOption {
  id: JustificationApproach;
  label: string;
  description: string;
}

/** Shown as the three cards in the Remark tab, in this order. */
export const APPROACH_OPTIONS: ApproachOption[] = [
  {
    id: 'documents',
    label: 'Documents were already furnished',
    description:
      'The papers went in with the original claim and are being sent again — referral letter, sign and stamp, attestation, pathology report.',
  },
  {
    id: 'extension',
    label: 'Extension of stay / referral validity',
    description:
      'The stay ran beyond the referral or extension letter. Covers the period asked about and leaves the clinical reason for the doctor.',
  },
  {
    id: 'care',
    label: 'Care actually provided',
    description:
      'The level of care or the treating specialist is questioned — referred for one speciality, treated by another. Needs the treating team to state what was done.',
  },
];

// The part every approach shares. Kept in one place so the guarantees cannot
// drift apart between the three.
const SHARED_RULES = `The remark is written in hospital shorthand. Read it with this glossary:
- DOD = date of discharge. DOA = date of admission. DS = discharge summary. IPD = in-patient department record. OPD = out-patient department. UHID = the patient's hospital ID. L2 = the scrutiny stage. SST = super-speciality treatment. MoU = the memorandum of understanding between the hospital and ESIC.
- Do NOT expand any other abbreviation you are not certain of — repeat it exactly as the remark wrote it. Guessing at an expansion invents a document that does not exist.

Rules:
- Formal claim-correspondence English, in the first person plural ("we", "the hospital"). 3 to 5 sentences, in a single paragraph.
- Do not mention a claim number, and never write a placeholder for one — the justification is filed against the claim itself, which already carries its number.
- No salutation, no sign-off, no subject line, no numbered list in the output — it must read as continuous prose.
- Address every item the remark raises. If the remark lists numbered points, cover each one.
- NEVER invent clinical facts, dates, diagnoses, document numbers or names. You do not have the patient's file.
- Never claim that an approval, extension or sanction was granted by any authority, and never claim a document has since been obtained or corrected.
- Where a fact is required that only the treating team can supply, write a [placeholder in square brackets] describing what to fill in — for example "[state the clinical reason for the extended stay]".
- Close by requesting that the claim be considered and processed further.
- Output the justification text only. No markdown, no preamble, no quotes.`;

// What each approach argues. These differ in the hospital's opening position,
// which is the part a person actually chooses between.
const APPROACH_INSTRUCTIONS: Record<JustificationApproach, string> = {
  documents: `The hospital's position is that the required documents and proof were furnished along with the original claim submission, and are now being furnished again in compliance with the observation.

Structure it in this order:
1. Submit, with reference to the observation, that the documents in question were enclosed with the original claim submission.
2. State that notwithstanding the same, in compliance with the remark, they are being re-submitted herewith for kind perusal — naming each item the remark asks for.
3. Request that the claim be considered and processed further.`,

  extension: `The remark concerns the period of stay: the referral or extension letter covers a shorter period than the patient's actual stay, or an extension approval is being asked for.

Structure it in this order:
1. Acknowledge the period the observation identifies, quoting only dates the remark itself states — you have no others.
2. Submit that the extension of stay for that period is being placed on record herewith, and that the clinical need for the continued stay is [state the clinical reason for the extended stay, and who advised it].
3. Request that the claim be considered and processed further for the full period of stay.

You must NOT state that an extension was sanctioned, approved or granted by any ESIC authority. Whether it exists is precisely what is in question. Commit only to placing it on record.`,

  care: `The remark challenges the care given — the patient was referred for one speciality or level of care and the records suggest another, or the treatment is said not to qualify under the MoU.

Structure it in this order:
1. Note the observation about the referral and the treatment recorded.
2. Submit what was actually done, as placeholders for the treating team to complete — [state the treatment/intervention actually provided], [name and speciality of the doctor who provided it], and where relevant [state why this management was clinically necessary].
3. Request that the claim be considered and processed further in the light of that clarification.

You must NOT assert that super-speciality care was given, that the correct specialist attended, or that the treatment qualifies under the MoU. That is the contested fact and only the treating team can state it. Every such claim must be a [placeholder].`,
};

const buildPrompt = (approach: JustificationApproach) =>
  `You are a billing executive at an ESIC-empanelled hospital in Nagpur, India. An ESIC scrutinizer has raised a query (an "L2 remark") on a claim the hospital has already submitted. Write the hospital's written JUSTIFICATION against that query.

This is a formal justification filed on the claim, not a short message.

${APPROACH_INSTRUCTIONS[approach]}

${SHARED_RULES}

Scrutinizer's remark:
`;

/**
 * Draft a justification for one ESIC scrutiny remark, in the style of the
 * chosen approach. Throws on any failure (proxy error, empty response) —
 * callers surface a toast.
 */
export async function draftRemarkJustification(
  remark: string,
  approach: JustificationApproach = 'documents',
): Promise<string> {
  const trimmed = remark.trim();
  if (!trimmed) throw new Error('There is no remark to reply to');

  const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${buildPrompt(approach)}${trimmed}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    }),
  });

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/^["']|["']$/g, '').trim();
  if (!cleaned) throw new Error('The AI returned an empty reply');
  return cleaned;
}
