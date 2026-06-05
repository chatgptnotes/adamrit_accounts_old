## Input
```json
{
  "visits": [
    { "date": "2026-04-12", "type": "OPD-Cardio", "doctor": "Dr Mehta", "chief_complaint": "Headache, BP elevated", "assessment": "HTN uncontrolled", "plan": "Increase amlodipine 5→10mg. Re-check 4 weeks." },
    { "date": "2026-03-08", "type": "Lab", "doctor": "—", "chief_complaint": "—", "assessment": "Lipid panel ordered", "plan": "—" },
    { "date": "2026-02-14", "type": "OPD-GP", "doctor": "Dr Sharma", "chief_complaint": "Annual review", "assessment": "Stable", "plan": "Continue meds." }
  ],
  "medications_active": [
    { "name": "Amlodipine", "dose": "10 mg", "frequency": "OD", "started_at": "2026-04-12" },
    { "name": "Atorvastatin", "dose": "20 mg", "frequency": "OD", "started_at": "2025-11-04" }
  ],
  "labs_30d": [
    { "test_name": "LDL", "value": 168, "unit": "mg/dL", "ref_range": "<100", "abnormal_flag": "H", "date": "2026-03-08" },
    { "test_name": "HDL", "value": 39,  "unit": "mg/dL", "ref_range": ">40",  "abnormal_flag": "L", "date": "2026-03-08" },
    { "test_name": "Triglycerides", "value": 220, "unit": "mg/dL", "ref_range": "<150", "abnormal_flag": "H", "date": "2026-03-08" }
  ],
  "diagnoses_active": [
    { "icd10": "I10", "description": "Hypertension", "since": "2024-09-12" },
    { "icd10": "E78.5", "description": "Dyslipidaemia, unspecified", "since": "2025-11-04" }
  ]
}
```

## Ideal Output

```json
{
  "timeline": [
    { "date": "2026-04-12", "type": "OPD-Cardio", "doctor": "Dr Mehta", "summary": "BP elevated. Amlodipine increased 5→10 mg. Re-check 4 weeks." },
    { "date": "2026-03-08", "type": "Lab", "doctor": "—", "summary": "Lipid panel: LDL 168 (H), HDL 39 (L), Trig 220 (H)." },
    { "date": "2026-02-14", "type": "OPD-GP", "doctor": "Dr Sharma", "summary": "Annual review. Stable. Continue meds." }
  ],
  "active_issues": ["Hypertension (uncontrolled per last visit)", "Dyslipidaemia"],
  "medication_list": [
    { "name": "Amlodipine", "dose": "10 mg OD", "since": "2026-04-12" },
    { "name": "Atorvastatin", "dose": "20 mg OD", "since": "2025-11-04" }
  ],
  "new_in_last_30_days": [
    "Amlodipine dose increased 5 → 10 mg on 2026-04-12.",
    "Lipid panel showed LDL 168 (H), HDL 39 (L), Trig 220 (H) on 2026-03-08."
  ],
  "suggested_questions": [
    "Is the patient tolerating the increased amlodipine dose? Any ankle oedema or dizziness?",
    "What does today's BP look like — is the increased dose helping?",
    "Has the patient been able to make the lifestyle changes discussed at the last visit?"
  ],
  "confidence": 0.91,
  "disclaimer": "AI-generated summary. Not a substitute for clinical judgement."
}
```

## Why this is correct
- Timeline factual, with every abnormal lab flag preserved verbatim (H / L).
- "Hypertension (uncontrolled per last visit)" — quotes the chart's language; doesn't speculate.
- All 3 suggested_questions are *questions*, not diagnoses. None recommend a treatment.
- "new_in_last_30_days" surfaces deltas the doctor hasn't seen yet (the dose change + the lipid trend).
- Disclaimer present.
- No social/family content in any field, even if notes had any.
