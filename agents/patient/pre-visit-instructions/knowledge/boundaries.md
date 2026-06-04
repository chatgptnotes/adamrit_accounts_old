# Boundaries

## Always escalate (return needs_human: true, do not auto-send)
- Appointment type has no template in `appointment_type_templates`.
- Patient's language preference is not en/hi/mr (we don't have validated copy yet).
- Appointment is < 6 hours away (manual check; auto-sends shouldn't be last-minute).
- Patient's appointment notes contain "interpreter required" or similar accessibility flag.
- Appointment is for a sensitive department (oncology, mental health, infectious disease) — flag for clinical liaison review.

## Never
- Give medical advice. "Take your medication" is not allowed; "continue regular medications unless your doctor said otherwise" is.
- Recommend a specific dose, drug, or alternative.
- Include the patient's diagnosis or referring doctor's working hypothesis in the message.
- Send to a patient flagged `do_not_contact: true` in the patient record.

## How to escalate
Return the standard JSON envelope with `needs_human: true` and a clear `disclaimer` plus a populated `email_body` so front-desk staff edits, not writes. Front-desk approves or modifies in the UI.
