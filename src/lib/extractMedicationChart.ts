import { geminiGenerateContentUrl, geminiFetch } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { downscaleImageForVision } from '@/lib/downscaleImage';

// One medicine read from a handwritten medication chart. Kept all-strings
// because handwriting OCR is best-effort and every field is reviewed/edited
// by a human before it reaches the pharmacy.
export interface ExtractedMedicine {
  name: string;
  generic_name: string;
  brand_name: string;
  strength: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface ExtractedChart {
  doctor: string;
  medicines: ExtractedMedicine[];
}

const EXTRACT_PROMPT = `You are an expert hospital pharmacist reading a handwritten IPD medication chart / treatment sheet photo.

Extract EVERY medicine written on the chart, even if partially legible. Include tablets, capsules, injections, IV fluids, syrups, and nebulisations.

Return ONLY valid JSON (no markdown, no code fences, no commentary) in this exact shape:
{
  "doctor": "doctor name if visible, otherwise empty string",
  "medicines": [
    {
      "name": "as written on the chart",
      "generic_name": "molecule in UPPERCASE, e.g. PARACETAMOL or AMOXICILLIN+CLAVULANATE",
      "brand_name": "brand if identifiable, e.g. Dolo 650, otherwise empty string",
      "strength": "e.g. 500mg, 100ml",
      "route": "one of: Oral, IV, IM, SC, Topical, Inhalation",
      "frequency": "OD, BD, TDS, QID, HS, SOS, STAT, etc.",
      "duration": "e.g. 5 days, or empty string",
      "instructions": "e.g. after food, or empty string"
    }
  ]
}

Rules:
- Frequency codes: OD=once daily, BD=twice daily, TDS=thrice daily, QID=4 times, SOS=as needed, HS=bedtime, STAT=immediately.
- If a field is unclear, use an empty string (never guess wildly).
- For combination drugs list all molecules joined with + in generic_name.
- Output must be a single valid JSON object.`;

/**
 * Send a photo of a handwritten medication chart to Gemini Vision and return the
 * extracted doctor + medicines. Throws on any failure (missing key, network,
 * unparseable response, or no medicines found) — callers surface a toast.
 */
export async function extractMedicationChart(image: Blob): Promise<ExtractedChart> {
  const { base64, mimeType } = await downscaleImageForVision(image);

  let text: string;
  if (LLM_BACKEND === 'vps') {
    // Vision on VPS Claude Opus (subscription auth). No fallback: errors throw.
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

  let parsed: { doctor?: string; medicines?: ExtractedMedicine[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall back to the first {...} block if the model wrapped the JSON.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in AI response');
    parsed = JSON.parse(match[0]);
  }

  const medicines = (parsed.medicines || []).filter(
    m => (m.name || m.generic_name || m.brand_name)?.trim(),
  );
  if (medicines.length === 0) {
    throw new Error('Could not read any medicines from the photo. Try a clearer image.');
  }

  return { doctor: parsed.doctor || '', medicines };
}

// Routes offered by the medication forms. Scanned routes are normalised to one
// of these so a dropdown/chip shows the value instead of falling back to blank.
export const CHART_ROUTE_OPTIONS = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation'];

export function normaliseChartRoute(route: string): string {
  const match = CHART_ROUTE_OPTIONS.find(
    r => r.toLowerCase() === (route || '').trim().toLowerCase(),
  );
  return match || 'Oral';
}
