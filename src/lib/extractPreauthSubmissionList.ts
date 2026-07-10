import { geminiGenerateContentUrl, geminiFetch } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { downscaleImageForVision } from '@/lib/downscaleImage';

// One patient card read from the NHA provider portal's "Preauthorization to
// be Submitted" screenshot. Kept all-strings — a human reviews the extracted
// list before relying on it, same as the medication chart scanner.
export interface ExtractedPreauthCase {
  patientName: string;
  ageLabel: string;
  gender: string;
  programId: string;
  registrationId: string;
  registrationDate: string;
}

const EXTRACT_PROMPT = `You are reading a screenshot of the "Preauthorization to be Submitted" patient list from the National Health Authority (PM-JAY/MJPJAY) provider Transaction Management System portal.

Each patient appears as a card containing: the patient's name (heading), then age and gender, then a Program ID, then a Registration ID and Registration Date.

Extract EVERY patient card visible in the screenshot, even if partially cut off.

Return ONLY valid JSON (no markdown, no code fences, no commentary) in this exact shape:
{
  "cases": [
    {
      "patientName": "as written on the card",
      "ageLabel": "exactly as shown, e.g. 46y 6m 8d or 53 Yrs",
      "gender": "Male or Female",
      "programId": "e.g. MJMUL0BQZ",
      "registrationId": "e.g. 2026070910036590",
      "registrationDate": "DD/MM/YYYY as shown"
    }
  ]
}

Rules:
- If a field is unclear or missing, use an empty string (never guess).
- Read every card, do not skip any or stop early.
- Output must be a single valid JSON object.`;

/**
 * Send a screenshot of the NHA portal's "Preauthorization to be Submitted"
 * list to an AI vision model and return the extracted patient cases. Throws
 * on any failure (missing key, network, unparseable response, or no cases
 * found) — callers surface a toast.
 */
export async function extractPreauthSubmissionList(image: Blob): Promise<ExtractedPreauthCase[]> {
  const { base64, mimeType } = await downscaleImageForVision(image);

  let text: string;
  if (LLM_BACKEND === 'vps') {
    text = (await callVpsClaude(EXTRACT_PROMPT, 'opus', [{ base64, mimeType }])) || '';
  } else {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key is not configured.');

    const response = await geminiFetch(geminiGenerateContentUrl(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: EXTRACT_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
    });

    const data = await response.json();
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: { cases?: ExtractedPreauthCase[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall back to the first {...} block if the model wrapped the JSON.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in AI response');
    parsed = JSON.parse(match[0]);
  }

  const cases = (parsed.cases || []).filter(
    c => (c.patientName || c.registrationId)?.trim(),
  );
  if (cases.length === 0) {
    throw new Error('Could not read any patient cases from the screenshot. Try a clearer image.');
  }

  return cases;
}
