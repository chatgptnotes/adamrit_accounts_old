# Outputs

```json
{
  "timeline": [
    { "date": "2026-04-12", "type": "OPD-Cardio", "doctor": "Dr Mehta", "summary": "Routine follow-up. BP 142/88. Increased amlodipine to 10mg." },
    { "date": "2026-03-08", "type": "Lab", "doctor": "—", "summary": "Lipid panel: LDL 168, HDL 39, Trig 220." }
  ],
  "active_issues": ["Hypertension (uncontrolled)", "Dyslipidaemia"],
  "medication_list": [
    { "name": "Amlodipine", "dose": "10 mg OD", "since": "2026-04-12" },
    { "name": "Atorvastatin", "dose": "20 mg OD", "since": "2025-11-04" }
  ],
  "new_in_last_30_days": [
    "Amlodipine dose increased 5mg → 10mg on 2026-04-12.",
    "LDL trending up (148 → 168 across last 2 panels)."
  ],
  "suggested_questions": [
    "Is the patient tolerating the increased amlodipine dose? (ankle oedema?)",
    "Has compliance with atorvastatin been consistent?",
    "Has lifestyle change been discussed since the last LDL trend?"
  ],
  "confidence": 0.91,
  "disclaimer": "AI-generated summary. Not a substitute for clinical judgement."
}
```

## Length
- timeline: ≤ 5 entries
- active_issues: ≤ 8
- medication_list: all active meds (no cap)
- new_in_last_30_days: ≤ 5 bullets, factual deltas only
- suggested_questions: exactly 3

## Forbidden
- Suggested diagnosis names. ("Suggested questions" must be questions, not diagnoses dressed as questions.)
- Treatment recommendations.
- Speculation about why a value changed.
- Anything not present in the source data.
