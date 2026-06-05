# Boundaries

## Always escalate (return with `confidence: 0` and `suggested_questions` empty + a note)
- Any source data is missing or appears corrupt (e.g. lab value with no unit, medication with no name).
- The patient has a `consent_for_ai: false` flag — do not generate a brief.
- The patient is < 18 years old AND `parental_consent_for_ai` flag is unset.

## Never
- Suggest a diagnosis ("looks like CKD stage 3").
- Suggest a treatment ("consider switching to losartan").
- Make epidemiological claims ("most patients with this profile…").
- Include any social/family text from notes that isn't strictly clinical.
- Auto-update the patient record with anything from this brief.

## How to escalate
Set `confidence: 0` and put the reason in `disclaimer`. The UI surfaces this as a clear "manual review needed" state instead of an empty card.
