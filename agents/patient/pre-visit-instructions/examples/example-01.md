## Input
```json
{
  "appointment": {
    "id": "appt-7711",
    "type": "MRI brain",
    "datetime_local": "2026-05-12T10:30+05:30",
    "location": "Hope Hospital, OPD-2",
    "doctor": "Dr Mehta"
  },
  "template": {
    "preparation_steps": ["Fast for 4 hours", "Continue regular medications", "Wear loose clothing without metal"],
    "items_to_bring": ["Previous MRI / CT reports", "Government ID", "List of metal implants"],
    "duration_minutes": 45,
    "arrive_early_minutes": 15
  },
  "patient": {
    "first_name": "Priya",
    "age": 41,
    "language": "en"
  },
  "hospital_contact": "+91-22-XXXXXXXX"
}
```

## Ideal Output

```json
{
  "sms": "Namaste Priya, your MRI brain on 12 May 10:30am at Hope Hospital, OPD-2. Fasting 4h before. Bring previous reports + ID. Reply HELP for any query.",
  "email_subject": "Your MRI on 12 May at Hope Hospital",
  "email_body": "Dear Priya,\n\nThis is a reminder for your MRI brain on Tue, 12 May, 10:30 AM at Hope Hospital, OPD-2.\n\nWhat to do before:\n- Fast for 4 hours (no food or drink)\n- Continue regular medications unless your doctor said otherwise\n- Wear loose clothing without metal\n\nWhat to bring:\n- Previous MRI / CT reports\n- Government ID\n- A list of any metal implants (pacemaker, etc.)\n\nWe expect this to take about 45 minutes. Please arrive 15 minutes early for paperwork.\n\nIf anything is unclear, reply to this email or call us on +91-22-XXXXXXXX.\n\nTeam Hope Hospital\n\n— AI-generated draft. Reviewed by hospital staff.",
  "language": "en",
  "confidence": 0.92,
  "needs_human": true,
  "disclaimer": "AI-generated draft. Reviewed by hospital staff before sending."
}
```

## Why this is correct
- All prep steps come from the template, none invented.
- "Continue regular medications unless your doctor said otherwise" — defers to clinician, no medical advice given.
- SMS is 158 chars (one segment), single CTA.
- No MRN, no diagnosis, no patient ID in either body.
- Disclaimer footer present in email; absent in SMS only because of character budget.
- `needs_human: true` because Phase 0 trust is < 9/10; front-desk approves before send.
