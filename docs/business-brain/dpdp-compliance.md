# DPDP Act 2023 Compliance — what we did and why

This document records the decisions, controls, and audit-trail design for the Business Brain integration in Adamrit. It is intended as the artefact a hospital DPO can hand to a regulator if asked.

## 1. Lawful basis & consent

- **Consent gate:** every patient record carries `consent_for_ai` (default `false`). Agents that touch patient data refuse to run when `false`.
- **Minors:** patients < 18 require `parental_consent_for_ai = true` in addition to the patient's own consent.
- **Granular flag:** consent is per-purpose. Patient pre-visit instructions and clinical brief require it; pharmacy reorder does not (no PHI involved).

## 2. Data minimisation before LLM call

`supabase/functions/_shared/deidentify.ts` strips, before any LLM payload leaves the Edge Function:

| Field | Replacement |
|---|---|
| Patient name (full + family-member names from notes) | `[NAME]` |
| MRN, ABHA id | `[MRN]` / `[ABHA]` |
| Aadhaar (12-digit), PAN | `[AADHAAR]` / `[PAN]` |
| Indian phone (10-digit, +91 variants) | `[PHONE]` |
| Email | `[EMAIL]` |
| Postal address | (handled by NER upgrade in Phase C; v1 strips email/phone signal of address proxies) |
| ISO + DD/MM/YYYY dates | `[DATE]` (age in years preserved separately) |
| Photo URLs | `[PHOTO]` |

The replacement count is recorded in `agent_audit_log.deidentified_count` so the DPO can quantify how much PHI was substituted per invocation.

## 3. Data residency

- **Storage:** Supabase Postgres + Storage hosted in `ap-south-1` (Mumbai) — confirmed in `supabase/config.toml`.
- **LLM inference for clinical/patient agents:** Vertex AI `asia-south1` (Mumbai) — region pinned in `supabase/functions/_shared/llm.ts`.
- **LLM inference for pharmacy reorder:** Groq (US). Permitted only because the agent receives no PHI (pure inventory aggregates).

## 4. Audit trail

`agent_audit_log` is append-only, retained 7 years. Per row:
- Who invoked (auth.users.id)
- Agent slug + pack version
- SHA-256 of input + SHA-256 of output (hashes only — no raw payloads)
- IDs of `agent_chunks` retrieved
- LLM provider + model + region
- Count of de-identification replacements
- Confidence + handed-to-human flag
- Error message if the call failed

DPO read access is gated by `app_metadata.compliance_officer = true` in the user's JWT (Supabase Auth). Other users — including hospital admins — cannot read this table.

## 5. Human-in-loop

- **Pharmacy reorder:** pharmacist confirms each line item before any PO is generated. PO generation is the existing `pharmacy-billing-service.ts` flow, unchanged.
- **Patient pre-visit:** front-desk reviews + edits + approves SMS + email before send. Auto-approval gated behind a quality bar (error rate < 1% over 200 sends).
- **Clinical brief:** read-only artefact. The clinician's "I have read" action is logged to `agent_runs.handed_to_human`. No auto-action ever.

## 6. Patient rights

- **Right to access:** patient can request their `agent_audit_log` rows via the existing patient-portal data-export flow.
- **Right to erasure:** deleting a patient cascades to their related `agent_runs` and `agent_memory` via FK. `agent_audit_log` rows are not deleted (lawful retention for audit) but the `invoked_by` field is anonymised on patient-account closure.
- **Right to opt out:** flipping `consent_for_ai` to `false` immediately stops all agent runs for that patient.

## 7. Vendor & sub-processor list

| Sub-processor | Purpose | Region | DPA status |
|---|---|---|---|
| Supabase | DB + Storage + Edge Functions | ap-south-1 | DPA in place; review annually |
| Google (Vertex AI) | LLM inference for clinical / patient agents | asia-south1 | DPDP-aligned DPA available |
| Groq | LLM inference for pharmacy (no PHI) | US | Acceptable for non-PHI; no DPA required for current scope |

## 8. Incident response

If a breach is suspected:
1. Disable the offending agent via its feature flag (immediate effect on next user load).
2. Export the relevant slice of `agent_audit_log` (input/output hashes are recoverable to the original payload via `agent_runs` + corpus snapshots if retention allows).
3. Report to the DPO within 24h; report to the Data Protection Board within 72h if confirmed.

## 9. Open items (Phase C)

- Replace regex de-identification with Microsoft Presidio (Indian-tuned NER) for higher recall on names and addresses.
- Add a periodic eval harness that re-runs golden inputs against the current LLM models and alerts the DPO on regression.
- Retain corpus snapshots immutably (current setup deletes/recreates on re-index) so historical audit-log entries can be re-played end-to-end.
