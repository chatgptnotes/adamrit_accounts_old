import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL } from '@/lib/gemini';

// AI draft of a radiology report, on the same ai-proxy rail as the discharge
// summary generator and the accounting automations — no new keys.
//
// The output is a DRAFT. Nothing reaches the patient's file until a
// radiologist has read it, edited what is wrong, and approved it.

export interface RadiologyDraft {
  study: string | null;
  findings: string;
  impression: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string | null;
}

export interface RadiologyStudyContext {
  studyName?: string | null;
  patientAge?: string | number | null;
  patientGender?: string | null;
  clinicalNotes?: string | null;
}

/**
 * Read one radiology image into a structured draft.
 *
 * The prompt is deliberately conservative: an imaging model that guesses is
 * worse than one that says it cannot tell, because the radiologist is reading
 * the draft alongside the image and a confident wrong sentence is the one
 * most likely to survive the edit.
 */
export async function draftRadiologyReport(
  base64: string,
  mimeType: string,
  context: RadiologyStudyContext = {},
): Promise<RadiologyDraft | null> {
  const details = [
    context.studyName ? `Study ordered: ${context.studyName}.` : null,
    context.patientAge ? `Patient age: ${context.patientAge}.` : null,
    context.patientGender ? `Sex: ${context.patientGender}.` : null,
    context.clinicalNotes ? `Clinical notes: ${context.clinicalNotes}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  try {
    const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  'You are assisting a radiologist by drafting a report from this radiology ' +
                  `image for review. ${details} Return ONLY JSON: ` +
                  '{"study": string|null (the modality and body part you can actually see, ' +
                  'e.g. "Chest X-ray PA view"), ' +
                  '"findings": string (systematic observations, one per line, plain clinical ' +
                  'English; describe only what is visible), ' +
                  '"impression": string (a short numbered conclusion), ' +
                  '"confidence": "high"|"medium"|"low", ' +
                  '"limitations": string|null (what the image quality or view does not allow ' +
                  'you to assess)}. ' +
                  'Never invent a measurement, a comparison with a prior study, or a clinical ' +
                  'history you were not given. If the image is not a radiology image, or is ' +
                  'unreadable, say so in findings and set confidence to "low".',
              },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as RadiologyDraft;
    if (!parsed?.findings) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The report as it is printed and filed: one plain-text document. */
export function formatRadiologyReport(input: {
  studyName: string | null;
  findings: string;
  impression: string;
  reportedBy?: string | null;
  aiAssisted: boolean;
}): string {
  const lines: string[] = [];
  lines.push('RADIOLOGY REPORT');
  lines.push('');
  if (input.studyName) {
    lines.push(`Study: ${input.studyName}`);
    lines.push('');
  }
  lines.push('FINDINGS');
  lines.push(input.findings.trim());
  lines.push('');
  lines.push('IMPRESSION');
  lines.push(input.impression.trim());
  if (input.aiAssisted) {
    lines.push('');
    lines.push(
      'This report was drafted with AI assistance and reviewed, edited where ' +
        'necessary, and approved by the reporting radiologist.',
    );
  }
  return lines.join('\n');
}
