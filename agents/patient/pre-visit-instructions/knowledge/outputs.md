# Outputs

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

## SMS rules
- ≤ 320 chars
- One CTA only ("Reply HELP" OR call number — not both)
- Include date + time + location + the single most important prep step
- No medical advice; preparation only

## Email rules
- 100–200 words
- Sections: greeting → before → bring → duration → contact
- Always add the AI disclaimer footer
- Same language as SMS

## Forbidden
- Diagnosis or condition names in SMS/email body (the patient might forward it)
- Cost / billing information (separate touchpoint)
- Marketing-style phrases ("we're excited to see you")
