# Intake

## Trigger
- `POST /functions/v1/agent-clinical-priorvisit` `{ patient_id, appointment_id }`
- Triggered when the doctor opens an upcoming consultation in the schedule.

## Inputs assembled by the Edge Function
- Last 5 visits: { date, type, doctor, chief_complaint, assessment, plan } (notes free-text included after de-identification).
- Active medications: { name, dose, frequency, started_at }.
- Recent labs (last 30 days): { test_name, value, unit, ref_range, abnormal_flag, date }.
- Active diagnoses: { icd10, description, since }.

## What's de-identified before LLM call
- Patient name, MRN, phone, email, address, full DOB → kept: age, sex.
- Names of family members in notes.
- Any photo URLs.

## Required to produce a brief
- At least 1 prior visit OR 1 active medication OR 1 active diagnosis. If patient has no history at all, return a minimal envelope with `timeline: []`, `suggested_questions: ["Is this the patient's first visit?"]`.
