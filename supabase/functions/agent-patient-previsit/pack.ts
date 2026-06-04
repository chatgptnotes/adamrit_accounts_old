import type { AgentManifest } from '../_shared/loader.ts';

export const manifest: AgentManifest = {
    name: 'patient-pre-visit-instructions',
    display_name: 'Patient Pre-Visit Instructions',
    department: 'patient-facing',
    version: '1.0.0',
    description: 'Generates personalised pre-visit instructions for an upcoming appointment.',
    llm: { provider: 'vertex-ai', model: 'gemini-2.5-flash', temperature: 0.3, max_tokens: 1500 },
    confidence_threshold: 0.85,
    max_cycles: 1,
    knowledge: ['knowledge/intake.md','knowledge/outputs.md','knowledge/boundaries.md','knowledge/glossary.md'],
    examples: ['examples/example-01.md'],
    tools: ['db.read_appointment','db.read_patient_meta','db.read_appointment_type_template'],
    human_review_required: true,
};

export const systemPrompt = `# Patient Pre-Visit Instructions

You generate friendly, clear pre-visit SMS + email for an upcoming hospital appointment.

## Rules
1. Use ONLY the prep steps from the appointment-type template. Never invent.
2. No medical advice. Logistical preparation only.
3. No MRN, diagnosis, patient ID in body — only first name in salutation.
4. SMS ≤ 320 chars; one CTA. Email 100–200 words; section structure: greeting → before → bring → duration → contact → disclaimer.
5. Output strict JSON only — no prose around it.

Return: { sms, email_subject, email_body, language: "en|hi|mr", confidence, needs_human, disclaimer }.`;

export const knowledgeFiles = [
    { path: 'knowledge/intake.md', content: 'Inputs are pre-assembled and de-identified by the Edge Function: appointment, template, patient {first_name, age, language}, hospital_contact.' },
    { path: 'knowledge/outputs.md', content: 'Strict JSON. SMS one CTA only. Email always has disclaimer footer. No medical advice. No diagnosis.' },
    { path: 'knowledge/boundaries.md', content: 'Escalate (needs_human: true): no template; non-en/hi/mr language; <6h to appointment; sensitive dept (onco/mental/infectious). Never give medical advice or send to do_not_contact.' },
    { path: 'knowledge/glossary.md', content: 'OPD outpatient. IPD inpatient. Fasting hours from template. Languages: en, hi, mr (Devanagari, polite forms).' },
];

export const exampleFiles = [
    { path: 'examples/example-01.md', content: 'See agents/patient/pre-visit-instructions/examples/example-01.md.' },
];
