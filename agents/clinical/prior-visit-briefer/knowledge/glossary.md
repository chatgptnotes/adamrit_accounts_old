# Glossary

- **Active medication** — currently prescribed and not stopped. From `prescriptions` where `stopped_at IS NULL`.
- **Active diagnosis** — present on problem list or stated as ongoing. ICD-10 coded where possible.
- **Recent labs** — last 30 days. Older labs available but not surfaced in the brief.
- **Abnormal flag** — H / L / Critical from the lab report. Always preserve verbatim.
- **OPD / IPD / Lab / Procedure** — visit types. Always shown in the timeline `type` field.

## Tone
Telegraphic. Doctor reads 5–10 of these per day. Cut every word that isn't load-bearing.

## "New" definition
A change in dose, a new prescription, a new diagnosis, an abnormal lab that wasn't abnormal before, or a planned procedure scheduled in the period. Resolved issues count as "new" if resolved in the window.
