# Tools

Pre-assembled by the Edge Function. The agent itself does not call tools.

## Data sources
- `visits` — last 5 by patient_id, ordered desc by date
- `prescriptions` — `stopped_at IS NULL`, by patient_id
- `lab_results` — last 30 days by patient_id (joined to lab_test_config for ref_range)
- `patient_diagnoses` — `resolved_at IS NULL`, by patient_id
- `patients.consent_for_ai`, `patients.parental_consent_for_ai`

## De-identification
The Edge Function de-identifies free-text fields (assessment, plan, chief_complaint) using `_shared/deidentify.ts` before passing to the LLM. Family-member names captured in notes are stripped via the `extraNames` parameter.
