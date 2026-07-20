# Adamrit Project Instructions

- After completing and verifying code changes, push the commit to `main` and deploy production by default.
- Before pushing, run the relevant checks for the change. For frontend changes, use `npm run typecheck` and `npm run build` unless the user says otherwise.
- Keep commits focused on the requested change and do not stage unrelated untracked files.
- When deployment completes, report the commit hash and production URL.
- Advance Statement Yojana package matching must support patient-name-only fallback. Matching priority is saved visit values, then Yojana/Thumb Registration ID, then normalized patient name + preauth/intimation date, then normalized patient name alone using the newest stored Government Portal row.
- Tablet module `Payment Collection (Vasooli) - Gaurav` must use existing billing/payment data (`bills`, `bill_preparation`, `advance_payment`, `final_payments`) and write new collections to `advance_payment`.
- Tablet module `Payment Collection (Vasooli) - Gaurav` should show only admitted Yojana patients in the patient-wise collection flow; extra package amount, correction notes, and payment receipts must be append-only audit rows, and proof screenshots use `file_uploads.category = payment_proof`.
- Tablet module `Accounts (Tilak)` must save daily receipts, expenses, cash in hand, and cash in bank into `director_matrix_daily_entries`, updating existing date rows by unique key instead of creating duplicate date entries.
- OT Schedule - Gaurav must show schedule status from `ot_schedule.status`, with completed rows also inferred from `visits.surgery_date`; Sarvesh OT Photos marking done or uploading OT photos must complete the OT schedule and update `visits.surgery_date`.
- OT Schedule - Gaurav must auto-fill Surgeon Name, Anaesthetist Name, and Anesthesia Type from PMJAY/MJPJAY Master using selected package code/name; save surgeon/anesthetist to `ot_schedule`, and save anesthesia type in `special_requirements` until a dedicated column exists.
- Sarvesh OT Photos must reuse Implant Bill and Implant Sticker from `file_uploads` categories `implant_invoice` and `implant_sticker`; if missing, show upload/capture options in the OT Photos screen.
