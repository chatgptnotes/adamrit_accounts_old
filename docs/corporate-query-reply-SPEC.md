# Build Spec — Corporate / Panel Query Reply Module

**Repo:** Adamrit HMS (`adamrit`)
**Stack:** Vite + React 18 + TypeScript + react-router-dom v6 + shadcn/ui + TanStack Query + Supabase. Deployed on Vercel with serverless functions in `/api/*.ts`.
**Note:** `CLAUDE.md` claims Next.js + Python. That is stale — ignore it. `AGENTS.md` is the real project instruction file.

## 1. Goal

A module where a billing executive:

1. selects a patient / visit,
2. sees all of that patient's relevant context assembled automatically,
3. pastes the query text received from the corporate / scheme,
4. gets an AI-drafted formal reply letter that cites hospital records, the corporate's rate/tariff data, and uploaded scheme reference documents and rules,
5. edits the draft — either by typing, or by telling the AI what to change,
6. prints it on hospital letterhead as a PDF with a blank signature and stamp area,
7. and tracks the query in a register until it is closed.

Anything required for the reply that is **not** obtainable from the software must appear as a highlighted placeholder inside the letter, never as a guess.

**Primary scheme to get right first: ESIC.** The engine must be generic (driven by the patient's existing corporate field) but the ESIC profile, ESIC identifiers, ESIC annexure list and ESIC query categories must be complete and correct on day one.

## 2. Confirmed product decisions

| Decision | Choice |
|---|---|
| Query input | **Paste / type the query text.** No OCR, no file upload of the incoming letter. |
| Draft engine | **AI drafts, staff edits.** |
| Output | **Printable letter on hospital letterhead (PDF).** |
| Scope | **Register with status tracking**, and the generated document must be **editable manually AND by instructing the AI**. |
| Rule references | Three sources, all supported: (a) existing **rate / tariff tables in the DB**, (b) **uploaded reference documents per scheme**, (c) **manually added free-text rules** with a citation label. |
| Signature / stamp | **Printed blank signature and stamp area.** No digital signature or seal images. |
| Missing information | **Highlighted placeholders inside the letter.** |
| Entry point | **New sidebar page with patient search.** |
| Schemes | Generic engine, **ESIC tuned first**. |

### Explicitly out of scope for v1

- OCR / upload of the incoming query letter.
- Merged PDF bundle with annexure documents physically attached.
- Digital stamp / signature images.
- Threaded parent-child re-queries (a `re_queried` status is enough).
- pgvector RAG over reference documents. The `agent_documents` / `agent_chunks` / `match_agent_chunks` "Business Brain" infrastructure exists in `supabase/migrations/20260509120000_business_brain_foundation.sql` but **appears unapplied to the live database** (`agent_runs`, `consent_for_ai`, `patient_diagnoses` all have zero hits in `src/integrations/supabase/types.ts`). Do not depend on it. Reference document text is stored as plain extracted text and selected explicitly by the user.
- Any edit to `src/pages/FinalBill.tsx`. That file is **feature-frozen** by the `finalbill-locked` skill and a `prebuild` SHA256 check (`scripts/check-finalbill-locked.cjs`). Read it for patterns; never modify it.

### Open decision to raise with the user before building

The only existing payer-query tracker in the app is `bill_preparation.nmi` / `nmi_date` / `nmi_answered`, plus `reason_for_deduction` / `deduction_amount` / `tds_amount`. **v1 reads these as read-only context and does not write back.** Ask the user whether marking a query as *Sent* should also set `bill_preparation.nmi_answered = 'Yes'` and stamp the date. Do not implement the write-back without an explicit yes.

## 3. What already exists — reuse, do not rewrite

### 3.1 The closest precedent

`src/pages/NoDeductionLetter.tsx` (1758 lines, route `/no-deduction-letter/:visitId`) is roughly 80% of this module for a single hardcoded letter type. Study and reuse:

- `extractLetterTemplate()` / `replaceLetterTemplate()` — the `[[LETTER_TEMPLATE]] … [[/LETTER_TEMPLATE]]` convention that separates author instructions from the printed body.
- `mergeTemplate(template, data)` — `{{patient.name}}` / `{{admission.date}}` dot-path merge.
- `handleSaveDocument()` (line ~781) — the canonical way to persist a generated letter: upsert into `patient_documents` keyed on `(visit_id, document_name)`, `is_uploaded: false`, body inside a `metadata` JSONB `{ title, prompt_id, content, generated_at }`.
- Its print / jsPDF export path.

`src/components/ESICLetterGenerator.tsx` is the modal variant of the same letter.

> **Do NOT copy the mock-refinement fallback at `NoDeductionLetter.tsx:~880-900`.** It silently fabricates a letter when the AI call fails. That violates the project's `Zero Mock, Zero Fallback` rule. On AI failure this module must surface the real error and leave the draft untouched.

### 3.2 Patient context sources

The best existing aggregator to model on is the inline `loadAndGenerate()` in `src/pages/QuickDischargeSummary.tsx:44-130` — it already assembles visit + diagnoses + surgeries + admission notes + discharge summary + lab results + radiology into one object for an LLM, and handles the visit-id duality gracefully.

Reuse these hooks / helpers rather than writing new queries:

| Source | What it gives |
|---|---|
| `src/hooks/useVisitsData.ts` → `useVisitData(visitId)` | One query: `visits` + `patients` + `visit_diagnoses→diagnoses` + `visit_surgeries→cghs_surgery` + `visit_complications→complications` + `visit_esic_surgeons` + `visit_hope_surgeons` + `referees` |
| `src/hooks/useFinancialSummary.ts` → `useFinancialSummary(billId, visitId)` | All 15 money categories across 14 tables. **Do not re-derive money.** |
| `src/hooks/useFinalBillData.ts` → `useFinalBillData(visitId)` | `bills` + `bill_sections` + `bill_line_items` (with `cghs_nabh_code`, `cghs_nabh_rate`) |
| `src/hooks/useVisitMedicalSummary.ts` | Cheap prompt-ready flat strings for labs / radiology / medications / surgeries / sanction status |
| `src/hooks/useShiftingAccommodation.ts` | Ward / room / accommodation timeline |
| `src/tablet/hooks/usePatientDocs.ts` → `usePatientDocs(patientId, category)` | Attachments by category; `PATIENT_DOC_CATEGORIES` |
| `src/lib/registrationDocuments.ts` → `getCorporateRegistrationDocuments(corporate)` | Per-scheme required document list, incl. the 10 ESIC documents, plus `CORPORATE_NAME_ALIASES` |
| `src/tablet/lib/panelColors.ts` → `panelFor(corporate)` | Canonical scheme key from free-text corporate (`esic`, `cghs`, `echs`, `pmjay`, `mjpjay`, `mpkay`, `railway`, `insurance`, `private`, `other`, `unknown`) |
| `src/utils/fetchAllRows.ts` | `fetchAllRows()` / `fetchAllByIn()` — paginate past Supabase's 1000-row cap |
| `src/utils/withTimeout.ts` | Wrap slow queries (FinalBill uses 15s) |

### 3.3 The visit-id trap — read this twice

`visits` has **two** identifiers and child tables are inconsistent about which they store:

- `visits.id` — UUID
- `visits.visit_id` — human TEXT, e.g. `IH25D26002`

`useVisitMedicalSummary.ts` resolves TEXT→UUID (`if (visitId.startsWith('IH'))`); `useVisitMedicalData.ts` uses the TEXT directly; `QuickDischargeSummary.tsx` queries `lab_results` by `visits.id` then **falls back** to the TEXT.

**Requirement:** the context builder must resolve both identifiers once, up front, and query child tables with whichever key that table actually uses — falling back to the other and merging. Never assume.

### 3.4 Tenant scoping

Tenant is `hospital_name` with values `'hope'` / `'ayushman'`, taken from `useAuth().hospitalConfig.name` (`src/contexts/AuthContext.tsx`). It exists on `patients`, `bills`, `lab`, `prescriptions`, `pharmacy_sales`, `file_uploads` (as `hospital_id`), and others — but **not on `visits`**, so visit scoping goes through `patients`. Scope with an explicit `.eq('hospital_name', hospitalConfig.name)`; prefer that over `src/utils/hospitalDataFilter.ts`, whose `patientRelatedTables` branch builds a raw SQL-string subquery and is largely unused.

### 3.5 AI is already wired — no new API key needed

- **Gemini (default):** `src/lib/gemini.ts` → `geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL), init)` posts to `/api/ai-proxy`. `GEMINI_MODEL = 'gemini-2.5-flash'`. The key lives server-side only as `GEMINI_API_KEY`.
- **Claude (opt-in):** `src/lib/vpsClaude.ts` → `callVpsClaude(prompt, 'sonnet')` via `/api/skill-factory-claude`. Switched by `LLM_BACKEND`, exported from the same file, driven by `VITE_LLM_BACKEND=vps|gemini`.
- **Follow the existing branch shape** used at every other call site:

```ts
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL } from '@/lib/gemini';

async function runLlm(prompt: string): Promise<string> {
  if (LLM_BACKEND === 'vps') return callVpsClaude(prompt, 'sonnet');
  const res = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL), {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('AI returned an empty response.');
  return text;
}
```

**Constraints imposed by `api/ai-proxy.ts`:** origin allowlist (`adamrit.com`, `www.adamrit.com`, `localhost:5173/4173`), in-memory rate limit 30/min and 300/hr per IP, 8 MB body, `maxOutputTokens` hard-capped at **4096**, `thinkingConfig.thinkingBudget` forced to 0, auto-degrades flash → flash-lite on 404/429/5xx. A full reply letter fits in 4096 output tokens; if a draft is ever truncated, split into subject+body and annexures as two calls rather than raising the cap.

**On de-identification:** `supabase/functions/_shared/deidentify.ts` exists for DPDP compliance on other AI features. It is **deliberately not used here** — the payer already holds the patient's identity and the reply letter must name the patient, quote the claim ID and cite dates. Document this exception in a code comment. The controls that do apply are the server-side key and the origin allowlist in `api/ai-proxy.ts`.

### 3.6 Empanelment data model — know the limits

There is **no proper empanelment entity**. The payer is free text:

- `patients.corporate` — authoritative, set at registration from the `corporate` master's `name`.
- `visits.corporate` — per-visit override. **Billing reads visit first, then patient** (see `src/pages/FinalBill.tsx:1005-1011`). Match that precedence.
- `visits.insurance_type` — loose secondary fallback.

Three unlinked corporate masters exist: `corporate` (the registration dropdown; the only one FK'd, by `corporate_bulk_payments`), `corporate_master` + `corporate_areas` (marketing CRM, **no migration files in the repo**), and `corporate_companies` (contract terms, apparently unused). Use **`corporate`** for the dropdown, via `src/hooks/useCorporateData.ts`.

Scheme identifiers to surface per patient:

| Field | Where |
|---|---|
| ESIC IP number | `patients.insurance_person_no` |
| ESIC UH ID | `visits.esic_uh_id` |
| Claim ID | `visits.claim_id`, also `bills.claim_id` |
| UHID / display ID | `patients.patients_id` |
| Ayushman ID | `patients.ayushman_id` |
| PM-JAY / MJPJAY registration ID | `visits.yojana_registration_id` |
| Card no. / CGHS code | `visits.card_no`, `visits.cghs_code` |

Rate / tariff masters (there is **no per-corporate rate list**; rates are per rate-type columns and the corporate→rate_type decision lives in ad-hoc ternaries):

- `cghs_surgery` — `code`, `name`, `cost`, `private`, `NABH_NABL_Rate`, `Non_NABH_NABL_Rate`, `bhopal_nabh_rate`, `bhopal_non_nabh_rate`
- `mandatory_services`, `clinical_services` — `private_rate`, `tpa_rate`, `nabh_rate`, `non_nabh_rate`, `nabh_bhopal`, `non_nabh_bhopal` (+ `*_ipd` variants)
- `nabh_rates` — `code`, `item_name`, `rate`
- `pmjay_mjpjay_packages` — has a real `scheme` column; children `pmjay_mjpjay_package_surgeons` / `_anaesthetists` / `_implants`
- `yojana_mh_procedures` — Maharashtra tariff, `tier3_rate`, and notably **`mandatory_docs_preauth` / `mandatory_docs_claim`** (the only DB-side per-procedure document requirements)
- `visit_*` junctions carry `rate_type` (`'tpa' | 'private' | 'nabh' | 'non_nabh' | 'nabh_nabl'`) and `rate_used`

## 4. Database — new migration

Create **one** migration: `supabase/migrations/20260726100000_corporate_query_replies.sql`

Convention: `YYYYMMDDHHMMSS_snake_case.sql`, hand-authored timestamp on an hourly slot. Timestamp collisions exist in the repo, so verify the slot is unused first. Open the file with a `--` comment block describing Before / After / RLS implications, matching `supabase/migrations/20260725120000_notifications_for_all_users.sql`.

### 4.1 `corporate_queries` — the register

```
id                     uuid pk default gen_random_uuid()
query_no               text unique not null          -- CQ/2026/0001, generated
patient_uuid           uuid references patients(id)
patient_display_id     text                          -- patients.patients_id snapshot
patient_name           text
visit_id               text not null                 -- visits.visit_id (TEXT) — matches patient_documents
visit_uuid             uuid                          -- visits.id, resolved at creation
corporate              text                          -- visits.corporate ?? patients.corporate snapshot
scheme_key             text                          -- resolved: esic|cghs|echs|pmjay|mjpjay|mpkay|railway|insurance|private|other
claim_id               text
scheme_ids             jsonb default '{}'            -- {ip_no, uh_id, ayushman_id, yojana_registration_id, card_no}
received_date          date
due_date               date
sender_name            text
sender_designation     text
sender_office          text
their_reference_no     text
query_text             text not null
query_category         text                          -- auto-classified, user-overridable
status                 text not null default 'draft'
                       check (status in ('draft','ai_drafted','under_review','approved','sent','closed','re_queried'))
context_snapshot       jsonb                         -- the exact pack sent to the LLM, for audit
reply_subject          text
reply_body             text                          -- current editable body
signatory_name         text
signatory_designation  text
signatory_regn_no      text
annexures              jsonb default '[]'            -- [{label, source, available, patient_document_id}]
open_placeholders      jsonb default '[]'            -- [{token, label, why}]
citations              jsonb default '[]'            -- [{claim, source}]
ai_model               text
ai_prompt              text
ai_generated_at        timestamptz
sent_date              date
sent_via               text
sent_remarks           text
hospital_name          text not null
created_by             text
created_at             timestamptz default now()
updated_at             timestamptz default now()
```

Indexes on `(hospital_name, status)`, `(visit_id)`, `(corporate)`, `(received_date desc)`, `(due_date)`.

### 4.2 `corporate_query_revisions` — version history

Every AI draft, every AI revision, and every manual save creates a row. This is what makes "edit manually and with AI" safe and reversible.

```
id             uuid pk
query_id       uuid not null references corporate_queries(id) on delete cascade
revision_no    integer not null
reply_body     text not null
reply_subject  text
change_source  text not null check (change_source in ('ai_draft','ai_revision','manual_edit'))
ai_instruction text                                  -- what the user told the AI to change
created_by     text
created_at     timestamptz default now()
unique (query_id, revision_no)
```

### 4.3 `scheme_reference_docs` — the uploaded reference library

```
id              uuid pk
scheme_key      text not null                        -- esic, cghs, ...
corporate       text                                 -- nullable; set for a corporate-specific override
title           text not null
doc_type        text not null check (doc_type in ('rate_list','guideline','circular','mou','tariff','form','other'))
reference_label text not null                        -- the exact citation string to print, e.g.
                                                     -- "ESIC Circular No. X-11/14/1/2023 dated 12.03.2024"
effective_from  date
effective_to    date
file_path       text                                 -- storage path
file_name       text
file_type       text
file_size       bigint
extracted_text  text                                 -- what actually goes into the prompt
is_active       boolean default true
hospital_name   text not null
created_by      text
created_at      timestamptz default now()
updated_at      timestamptz default now()
```

### 4.4 `scheme_reference_rules` — manually added rules

This is the "add any rule" capability the user asked for: a short, citable rule that a staff member types in once and the AI must then quote verbatim when it relies on it.

```
id             uuid pk
scheme_key     text not null
corporate      text                                  -- nullable
rule_title     text not null                         -- "Implant billed at actual invoice"
rule_text      text not null                         -- the rule, in the payer's own words
citation       text not null                         -- "ESIC Circular dated 12.03.2024, Para 4(b)"
effective_from date
effective_to   date
tags           text[]
is_active      boolean default true
hospital_name  text not null
created_by     text
created_at     timestamptz default now()
updated_at     timestamptz default now()
```

### 4.5 Storage

**Do not create a new bucket in SQL.** `INSERT INTO storage.buckets (...)` silently fails on hosted Supabase. Instead reuse the existing **`uploads`** bucket (see `src/tablet/hooks/usePatientDocs.ts`, `const BUCKET = "uploads"`) with the path prefix:

```
scheme-reference/<scheme_key>/<uuid>-<original-filename>
```

### 4.6 RLS

Mirror `supabase/migrations/20250919000001_create_corporate_table.sql`: enable RLS, add permissive select/insert/update/delete policies. **Grant to `anon` as well as `authenticated`** — the app logs in against the `User` table with the anon key, not Supabase Auth, so policies written only for `authenticated` return zero rows. The reason is documented in the header of `src/integrations/supabase/data-client.ts`. Read that file before writing the policies.

### 4.7 Applying it

`supabase db push` is blocked on this project by historical unapplied migrations. Follow the established workflow: write the file, `pbcopy < <file>` it to the clipboard, and have the user paste it into the Supabase SQL editor. After the DDL runs, reload the PostgREST schema cache (`NOTIFY pgrst, 'reload schema';`) or the app will fail with *"Could not find the 'X' column of 'Y' in the schema cache"*.

## 5. New shared library code

Small, single-purpose modules under `src/lib/`, matching the convention of `src/lib/governmentPortalReportDb.ts` and `src/lib/implantBillDb.ts`.

### 5.1 `src/lib/schemeResolver.ts`

```ts
export type SchemeKey = 'esic' | 'cghs' | 'echs' | 'pmjay' | 'mjpjay' | 'mpkay'
                      | 'railway' | 'wcl' | 'insurance' | 'private' | 'other';

/** Resolve the scheme for a visit, honouring the billing precedence:
 *  visits.corporate first, then patients.corporate, then visits.insurance_type. */
export function resolveScheme(
  visitCorporate?: string | null,
  patientCorporate?: string | null,
  insuranceType?: string | null,
): { schemeKey: SchemeKey; corporate: string };
```

Implement by delegating to `panelFor()` from `src/tablet/lib/panelColors.ts` and `CORPORATE_NAME_ALIASES` in `src/lib/registrationDocuments.ts`.

> **Do not refactor the six existing fuzzy matchers** (`isMaharashtraYojana` in `FinalBill.tsx:538`, `useSearchableCghsSurgery.ts:7`, `AdvanceFlow.tsx:111`; `isYojnaCorporate` in `useBillSubmissions.ts:42`, `PharmacyMonthlyPurchaseSalesReport.tsx:22`; `panelFor` itself). They have divergent rules and unifying them is a separate, riskier change. Note the duplication in a code comment and move on.

### 5.2 `src/lib/patientContextPack.ts`

```ts
export interface PatientContextPack {
  identity:      { /* name, age, gender, uhid, address, phone */ };
  scheme:        { corporate, schemeKey, claimId, ipNo, uhId, ayushmanId, yojanaRegId, cardNo };
  admission:     { admissionDate, dischargeDate, surgeryDate, lengthOfStayDays, ward, room,
                   visitType, patientType, treatmentType, reasonForVisit, dischargeMode };
  diagnoses:     Array<{ name, isPrimary, notes }>;
  complications: Array<{ name, description }>;
  procedures:    Array<{ name, cghsCode, rate, rateType, packageDays, isPrimary, sanctionStatus }>;
  packageAndApprovals: { cghsCode, packageName, packageAmount, packageDays, packageStatus,
                         packageApprovedBy, packageApprovedAt, surgicalApproval, additionalApprovals,
                         extensionTaken, extensionOfStay, extensionDaysCount, intimationDone,
                         condonationDelayIntimation, condonationDelayClaim, condonationDelaySubmission,
                         delayWaiverIntimation, sstTreatment };
  doctors:       { treatingConsultant, otherConsultants, referringDoctor, esicSurgeons, hopeSurgeons,
                   anaesthetists };
  investigations:{ labs: Array<{name, resultValue, unit, referenceRange, isAbnormal, date}>,
                   radiology: Array<{name, findings, impression, date}> };
  medications:   Array<{ name, dosage, frequency, duration, route, startDate, endDate }>;
  vitalsSummary: string;
  narrative:     { admissionNotes, hospitalCourse, otNotes, operationNotes,
                   dischargeSummaryText, conditionOnDischarge, dischargeAdvice };
  accommodation: Array<{ ward, roomType, from, to, rate, rateType }>;
  billing:       { billNo, billDate, totalAmount, lineItems: Array<{description, cghsNabhCode,
                   cghsNabhRate, qty, amount}>, financialSummaryByCategory, advancePaid,
                   finalPayments, discounts };
  billWorkflow:  { deductionAmount, reasonForDeduction, tdsAmount, expectedAmount, receivedAmount,
                   receivedDate, dateOfSubmission, intimationDate, reasonForDelay,
                   nmi, nmiDate, nmiAnswered };   // READ ONLY from bill_preparation
  documents:     Array<{ documentName, isUploaded, uploadedAt, fileName, source }>;
  tariffContext: Array<{ code, name, rateType, rate, source }>;  // matched rows from cghs_surgery /
                                                                  // nabh_rates / pmjay_mjpjay_packages /
                                                                  // yojana_mh_procedures
  sourcesRead:   string[];   // table names actually queried, for the "As per hospital records" line
  missing:       string[];   // sections that returned nothing
}

export async function buildPatientContextPack(visitId: string): Promise<PatientContextPack>;
```

Rules:

- Resolve `visits.visit_id` (TEXT) ↔ `visits.id` (UUID) **once**, then query child tables with both keys and merge (§3.3).
- Degrade **per source**. One failing table must never blank the whole pack — push the section name into `missing[]` and continue. This is exactly how `QuickDischargeSummary.tsx:44-130` behaves; copy that shape.
- Populate `sourcesRead[]` with the tables that actually returned rows.
- Reuse the hooks in §3.2 wherever possible instead of writing fresh queries.
- Follow the existing convention of caching the assembled blob on the visit row if it is expensive — `visits.fetched_data_text` is already used this way by `src/pages/DischargeSummaryEdit.tsx:387-423`. Optional; only if load time warrants it.

### 5.3 `src/lib/corporateQueryPrompt.ts`

Exports `SCHEME_PROFILES`, `QUERY_CATEGORIES`, `buildDraftPrompt()` and `buildRevisePrompt()`. Full prompt text in §8.

### 5.4 `src/lib/corporateQueryDb.ts`

CRUD for the four tables plus `nextQueryNo(hospitalName)` and `saveRevision()`. Every write to `reply_body` must also insert a `corporate_query_revisions` row.

### 5.5 `src/components/letterhead/hospitalLetterheadHtml.ts`

There is currently **no shared letterhead component** — every document re-implements it. Extract one:

```ts
export function letterheadHtml(hospitalConfig: HospitalConfig): string;
export function letterheadCss(): string;
```

Base it on `src/pages/IpdDischargeSummary.tsx:2440` (the hope/ayushman name switch), the CSS at lines 2499-2519 (`.letterhead`, `.lh-center`, `.lh-name`, `.lh-sub`, `.lh-addr`, `.lh-logo`), and the markup at line 2683. Optionally use the real image `/hope-letterhead.png` (568×710) the way `src/pages/corporate-bill/BillDocumentsSection.tsx:736` does, with the text letterhead as fallback.

> `HOSPITAL_CONFIGS[].logo` in `src/types/hospital.ts` points at `/logos/hope-logo.png` and `/logos/ayushman-logo.png`, **neither of which exists in `public/`**. That field is broken — do not rely on it. The real assets are `/hope_logo.png`, `/NABH-LOGO.png`, `/hope-letterhead.png`, `/left_logo.jpeg`, `/right_logo.jpeg`.

Use the new helper in this module only. Do not retrofit the ~55 existing print sites.

### 5.6 `src/lib/corporateQueryLetter.ts`

Builds the final print HTML and opens the print window. Use **Pattern A**, the dominant and most reliable pattern in this codebase, and copy the self-triggering print script from `src/pages/IpdDischargeSummary.tsx:2960` **verbatim** — it fixes a `document.write()`/`onload` race that otherwise makes `window.print()` silently no-op:

```js
(function () {
  var printed = false;
  function doPrint() { if (printed) return; printed = true;
    try { window.focus(); } catch (e) {} window.print(); }
  if (document.readyState === 'complete') { setTimeout(doPrint, 250); }
  else { window.addEventListener('load', function () { setTimeout(doPrint, 250); });
         setTimeout(doPrint, 1500); }
})();
```

And the caller, including the popup-blocked path (`IpdDischargeSummary.tsx:2302`):

```tsx
const printWindow = window.open('', '_blank');
if (!printWindow) { toast.error('Popup blocked. Allow popups for this site and try again.'); return; }
printWindow.document.open();
printWindow.document.write(printHTML);
printWindow.document.close();
```

Page setup: `@page { size: A4; margin: 20mm 15mm }`.

## 6. Pages, components, routing

### 6.1 Files to create

```
src/pages/CorporateQueryReply.tsx          -- the register
src/pages/CorporateQueryWorkbench.tsx      -- draft / edit / print one query
src/pages/SchemeReferenceLibrary.tsx       -- reference docs + rules master
src/components/corporate-query/NewQueryDialog.tsx
src/components/corporate-query/QueryRegisterTable.tsx
src/components/corporate-query/PatientContextPanel.tsx
src/components/corporate-query/ReferenceSelector.tsx
src/components/corporate-query/ReplyEditor.tsx
src/components/corporate-query/AnnexureTable.tsx
src/components/corporate-query/AiReviseBar.tsx
src/lib/schemeResolver.ts
src/lib/patientContextPack.ts
src/lib/corporateQueryPrompt.ts
src/lib/corporateQueryDb.ts
src/lib/corporateQueryLetter.ts
src/components/letterhead/hospitalLetterheadHtml.ts
src/types/corporateQuery.ts
supabase/migrations/20260726100000_corporate_query_replies.sql
```

### 6.2 Routes — `src/components/AppRoutes.tsx`

Add `lazy()` imports at the top with the others, and routes **above** the catch-all `"*"` route (there is an explicit comment at line 417 saying so):

```
/corporate-query-reply                 → CorporateQueryReply
/corporate-query-reply/:queryId        → CorporateQueryWorkbench
/scheme-reference-library              → SchemeReferenceLibrary
```

The letter prints via a `window.open` HTML string, so no separate print route is needed.

### 6.3 Sidebar — two files

1. `src/components/sidebar/menuItems.ts` — append to the `menuItems: MenuItemDef[]` array (`{ title, url, icon, section?: 'main' | 'masters' }`, lucide icon imported at line 1):
   - `{ title: 'Corporate Query Reply', url: '/corporate-query-reply', icon: MessageSquareReply }`
   - `{ title: 'Scheme Reference Library', url: '/scheme-reference-library', icon: Library, section: 'masters' }`
2. `src/components/sidebar/sidebarGroups.ts` — add to `GROUP_BY_TITLE`, or the item silently falls into the trailing `'More'` group:
   - `'Corporate Query Reply': 'Billing & Accounts'` (next to the existing `'Corporate'` and `'Corporate Receipts'` entries at lines 65-66)

### 6.4 The register page

Table of `corporate_queries` scoped to `hospital_name`, newest first. Columns: Query No., Received, Due (red when overdue and not closed), Patient (name + UHID), Visit ID, Corporate (colour-coded — reuse the `badge` classes from `panelFor()`), Category, Status badge, Handled by, Actions.

Filters: corporate (from `useCorporateData`), status, date range (`src/components/ui/date-range-picker.tsx`), free-text search over patient name / UHID / query no. / their reference no.

Primary action: **New Query** → `NewQueryDialog`.

### 6.5 `NewQueryDialog`

Follow the dialog convention at `src/components/ESICLetterGenerator.tsx:262` — parent owns `isOpen` + `onClose`; `<DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">`.

Fields:
1. **Patient / visit search** — reuse `src/hooks/usePatientLookup.ts` or `src/components/corporate-bulk-payment/InlinePatientSearch.tsx`. On select, show resolved corporate, scheme badge, claim ID, admission/discharge dates as confirmation.
2. **Query text** — large `Textarea`, required.
3. Received date, due date, their reference no., sender name / designation / office.
4. Category — `Select` from `QUERY_CATEGORIES`, with an *Auto-detect* option (default).

On submit: resolve the scheme, generate `query_no`, insert with `status: 'draft'`, navigate to `/corporate-query-reply/:queryId`.

### 6.6 The workbench — three panes

**Left — `PatientContextPanel`.** A shadcn `Accordion` over the `PatientContextPack` sections. Each section has a checkbox controlling whether it is sent to the AI (all on by default except Medications and Investigations, which are large — turn those on when the query is clinical). Sections in `missing[]` render greyed with "no data in software". A summary line shows the sources read.

**Right — `ReferenceSelector`.** Three tabs:
- *Rate / Tariff* — the auto-matched `tariffContext` rows, each with a checkbox.
- *Documents* — `scheme_reference_docs` for this scheme (and this corporate), each with a checkbox and its `reference_label`.
- *Rules* — `scheme_reference_rules`, each with a checkbox, `rule_title`, `citation`, and the full `rule_text` on hover. An **Add rule** inline form here too, so a staff member can capture a rule the moment they learn it.

**Centre — `ReplyEditor`.**
- **Generate draft** button → `buildDraftPrompt()` → LLM → parse JSON → fill `reply_subject`, `reply_body`, `annexures`, `open_placeholders`, `citations`; write revision 1 with `change_source: 'ai_draft'`; set status `ai_drafted`; store `context_snapshot` and `ai_prompt`.
- **Manual editing** — a plain `Textarea` (or CKEditor via the available `@ckeditor/ckeditor5-react` if rich text is wanted; plain textarea is sufficient and matches `NoDeductionLetter.tsx`). Every save writes a `manual_edit` revision.
- **`AiReviseBar`** — a one-line instruction input plus **Ask AI to revise**. Examples shown as clickable chips: *"Make it shorter and more formal"*, *"Add the CGHS tariff reference for the implant"*, *"Answer point 3 in more detail"*, *"Remove the paragraph about the extension"*. Sends `buildRevisePrompt(currentBody, instruction, context, references)`; result written as an `ai_revision` revision with `ai_instruction` recorded.
- **Placeholder highlighting** — scan the body with `/\[\[([A-Z0-9_]+)\]\]/g`, render each match in a yellow highlight, and show a count badge: *"3 items to be filled by hand"*. Clicking the badge lists them.
- **Revision history** — dropdown of `corporate_query_revisions`, with restore.
- **`AnnexureTable`** — editable list of enclosures. Each row is auto-marked *Available in system* or *To be arranged* by cross-checking `getCorporateRegistrationDocuments(corporate)` and the pack's `documents[]` against `patient_documents.is_uploaded`.
- **Signatory block** — name / designation / registration no. Default the name to `ipd_discharge_summary.treating_consultant` when present, else blank. Free text; no masters table needed.

**Footer actions:** Save · Print / PDF · Mark Approved · Mark Sent (captures sent date + via) · Close query · Save to patient documents.

**Print** must show a confirm dialog when `open_placeholders.length > 0`: *"This letter still has N item(s) to be filled by hand. Print anyway?"* Do **not** hard-block printing — hand-filling is a legitimate workflow.

### 6.7 Printed letter layout

```
[hospital letterhead — letterheadHtml()]

Ref: <query_no>                                          Date: <dd/mm/yyyy>
Your Ref: <their_reference_no> dated <received_date>

To,
  <sender / scheme addressee from SCHEME_PROFILES>

Through:
  <scheme "through" line, when the profile has one>

Subject: <reply_subject>

Sir / Madam,

<reply_body — plain text, blank-line paragraphs, numbered point-wise replies>

Enclosures / Annexures:
  1. <label>                                    <Available | To be arranged>
  2. ...

Yours faithfully,


  ____________________________              [        stamp        ]
  <signatory_name>
  <signatory_designation>
  <signatory_regn_no>
  <hospital full name>
```

- **Signature and stamp:** a blank ruled signature line and an empty bordered box labelled *Hospital Seal*, roughly 45mm × 25mm. No images.
- **Placeholders in print:** render `[[TOKEN]]` as a dotted-underline blank span sized to the token length, with the humanised label in small print beneath, so the letter can be completed by hand. (See the `Hand-Fillable PDF Blanks via Dotted-Underline CSS Spans` pattern.)
- **No em dashes or en dashes** anywhere in generated output — they render inconsistently in headless-Chrome / jsPDF output in this codebase. Enforce this in the prompt *and* strip them in a post-processing pass.
- Multi-page: repeat a short header (`Ref` + patient name + page number) on pages 2+; footer `Page N of M`.

### 6.8 `SchemeReferenceLibrary` page

Two tabs.

*Reference Documents* — table of `scheme_reference_docs` filtered by scheme. Upload dialog: scheme, optional corporate, title, doc type, **reference label** (required — this is what gets cited in letters), effective dates, file. On upload, put the file in `uploads/scheme-reference/...` and populate `extracted_text`:
- `.txt` / `.md` — read directly.
- PDF / image — reuse the existing AI OCR path (`src/lib/documentOcr.ts`, which already routes through `/api/ai-proxy`) to extract text, and let the user correct it in a textarea before saving.
- Or paste the text manually (`source_kind: 'text'`, no file).

*Rules* — table of `scheme_reference_rules` with inline add / edit / deactivate. Deactivate rather than delete, per the project's soft-delete preference.

Seed nothing automatically. Leave the library empty; the AI simply gets fewer references and says so.

## 7. Status lifecycle

```
draft ──generate──▶ ai_drafted ──edit/save──▶ under_review ──approve──▶ approved
                                                                            │
                                                                        mark sent
                                                                            ▼
                                                                          sent
                                                                        ┌───┴────┐
                                                                    closed   re_queried
```

`re_queried` reopens editing. Every transition stamps `updated_at`; `sent` requires `sent_date`.

## 8. The module's AI prompt

Two prompts. Both request **strict JSON** (`responseMimeType: 'application/json'` on Gemini; on the Claude path, instruct "respond with JSON only, no prose, no code fences" and strip fences defensively).

### 8.1 Draft prompt

```
You are the Medical Records and Billing Officer of {{HOSPITAL_FULL_NAME}}, {{HOSPITAL_CITY}}.
You are drafting the hospital's formal written reply to a query raised by {{CORPORATE_NAME}}
({{SCHEME_LABEL}}) during scrutiny of a patient's claim.

Your reply will be printed on hospital letterhead, signed by a hospital officer, and submitted
to the payer as an official document. It may be relied upon in an audit. Accuracy matters more
than completeness or polish.

════════ ABSOLUTE RULES ════════

1.  Use ONLY facts that appear in the PATIENT RECORD, RATE AND TARIFF DATA, REFERENCE DOCUMENTS
    and RULES blocks below. These are the hospital's own records.
2.  NEVER invent, infer, estimate or "reasonably assume" any date, amount, quantity, code,
    invoice number, batch number, doctor name, designation, registration number, or document
    reference. Not even a plausible one.
3.  If a fact is needed to answer the query and is NOT present in the blocks below, then:
      a. write a placeholder in the letter body in the exact form [[UPPER_SNAKE_CASE_LABEL]], and
      b. add a matching entry to "open_items" explaining what is needed and where the hospital
         staff must obtain it (for example: OT store, treating surgeon, ESIC portal, employer).
    A placeholder is always correct. A guess is always wrong.
4.  Answer EVERY distinct point raised in the query, separately and in the order asked, as a
    numbered list. Do not merge two questions into one answer. Do not skip a point because it is
    inconvenient; if you cannot answer it from the records, say so plainly and add an open_item.
5.  Every factual assertion in the letter must be traceable. For each, add an entry to
    "citations" naming the record it came from (for example: "Discharge summary dated 12/03/2026",
    "Final bill line item, CGHS code 1234", "Operation notes dated 09/03/2026").
6.  When you rely on a rate, a tariff entry, a reference document or a rule, quote the relevant
    text VERBATIM in the letter and immediately follow it with its citation label exactly as given.
    Never paraphrase a rule. Never cite a rule that is not in the RULES or REFERENCE DOCUMENTS block.
7.  Never concede a deduction, never accept a disallowance, and never apologise for a clinical
    decision, unless the query text or a supplied rule explicitly establishes it. Your role is to
    justify the hospital's claim on the record, respectfully and factually.
8.  Do not describe treatment as medically necessary unless the records show a clinical basis for
    it. State the clinical basis; do not assert the conclusion on its own.

════════ FORM AND STYLE ════════

- Formal Indian government and corporate correspondence register. Respectful, precise, impersonal.
- Plain text only. NO markdown, no asterisks, no bullet characters, no headings with #.
  Separate paragraphs with a single blank line. Number points as "1.", "2.".
- English only.
- NEVER use an em dash or an en dash. Use a comma, a colon, or the word "to" for ranges.
- Dates as dd/mm/yyyy. Amounts as "Rs. 1,23,456/-" and, for any total being claimed, also in words.
- Medical terms precise; expand an abbreviation on first use.
- Do not use the words "template", "AI", "artificial intelligence", "as an AI", "I am unable".
- Do not write the To, Through, Subject, Ref, Date, Enclosures or signature blocks. The system
  renders those. Produce ONLY the subject line and the body text of the letter.
- Length: as long as the query requires, no longer. A three-point query needs three answers.

════════ THE QUERY RECEIVED ════════

Received on: {{RECEIVED_DATE}}
Their reference: {{THEIR_REFERENCE_NO}}
From: {{SENDER_NAME}}, {{SENDER_DESIGNATION}}, {{SENDER_OFFICE}}
Category (may be blank, detect it yourself): {{QUERY_CATEGORY}}

--- verbatim query text ---
{{QUERY_TEXT}}
--- end query text ---

════════ PATIENT RECORD (hospital's own records) ════════
{{PATIENT_CONTEXT_JSON}}

Sections that returned NO data in the software, so treat as unavailable: {{MISSING_SECTIONS}}

════════ RATE AND TARIFF DATA ════════
{{TARIFF_JSON}}

════════ REFERENCE DOCUMENTS ════════
{{REFERENCE_DOCS}}
(Each is given as: reference_label, then its text. Cite by reference_label, exactly as written.)

════════ RULES ════════
{{REFERENCE_RULES}}
(Each is given as: rule_title, citation, rule_text. Quote rule_text verbatim; cite by citation.)

════════ SCHEME-SPECIFIC GUIDANCE ════════
{{SCHEME_GUIDANCE}}

════════ OUTPUT ════════

Respond with JSON only. No prose before or after. No code fences.

{
  "detected_category": "one of: deduction_of_charges | extension_of_stay | unlisted_procedure |
     implant_cost | delay_condonation | rate_or_code_mismatch | document_deficiency_nmi |
     duplicate_or_overlap | dama_or_death_clarification | clinical_justification |
     package_inclusion | other",
  "subject": "one line, states the patient, the claim reference and what the letter answers",
  "letter_body": "the full body text, plain text, blank-line separated paragraphs, numbered replies",
  "annexures": [
    { "label": "document name as it should be listed",
      "source": "where it comes from, e.g. patient_documents, final bill, OT records",
      "available": true }
  ],
  "open_items": [
    { "token": "[[IMPLANT_INVOICE_NO]]",
      "label": "Implant invoice number",
      "why": "no implant invoice is recorded against this visit in the software",
      "obtain_from": "OT store / implant vendor invoice file" }
  ],
  "citations": [
    { "claim": "the assertion made in the letter",
      "source": "the record it came from" }
  ],
  "unanswerable_points": [
    "any point in the query that cannot be answered at all from the supplied records"
  ],
  "reviewer_notes": "short note to the hospital staff: what to verify before signing"
}
```

### 8.2 Revise prompt

```
You are revising a formal reply letter that {{HOSPITAL_FULL_NAME}} will send to {{CORPORATE_NAME}}.

Apply the requested change and nothing else. Preserve every fact, date, amount, code and citation
that is already in the letter unless the instruction explicitly asks you to change it. Do not
introduce any new fact that is not in the PATIENT RECORD, RATE AND TARIFF DATA, REFERENCE
DOCUMENTS or RULES blocks. If the instruction asks for something the records cannot support, leave
a [[PLACEHOLDER]] and add it to open_items rather than inventing it.

All the FORM AND STYLE rules from the drafting brief still apply: plain text, no markdown, no em
dashes or en dashes, dd/mm/yyyy dates, "Rs. 1,23,456/-", no To/Subject/signature blocks.

════════ STAFF INSTRUCTION ════════
{{USER_INSTRUCTION}}

════════ CURRENT LETTER ════════
Subject: {{CURRENT_SUBJECT}}

{{CURRENT_BODY}}

════════ PATIENT RECORD ════════
{{PATIENT_CONTEXT_JSON}}

════════ RATE AND TARIFF DATA ════════
{{TARIFF_JSON}}

════════ REFERENCE DOCUMENTS ════════
{{REFERENCE_DOCS}}

════════ RULES ════════
{{REFERENCE_RULES}}

════════ OUTPUT ════════
Respond with JSON only. No prose, no code fences.

{
  "subject": "...",
  "letter_body": "...",
  "open_items": [ { "token": "...", "label": "...", "why": "...", "obtain_from": "..." } ],
  "citations": [ { "claim": "...", "source": "..." } ],
  "change_summary": "one or two sentences on what you changed"
}
```

### 8.3 `SCHEME_PROFILES` — ESIC filled in, others generic

```ts
export interface SchemeProfile {
  label: string;
  addressee: string[];        // printed To block
  through?: string[];         // printed Through block
  alwaysQuoteIds: string[];   // pack paths that must appear in the letter
  guidance: string;           // injected as {{SCHEME_GUIDANCE}}
  standardAnnexures: string[];
}
```

**ESIC** (defaults; every field editable per query):

- `addressee`:
  ```
  State Medical Officer
  Regional Office Maharashtra
  Employees State Insurance Corporation
  Ground Floor, Panchdeep Bhavan
  Near Strand Cinema Bus Stop, S.B.S Marg
  Colaba, Mumbai 400005
  ```
  (taken from the existing verified ESIC template in `NoDeductionLetter.tsx:DEFAULT_TEMPLATES`)
- `through`: `The Superintendent, ESIS Hospital, Somwarpeth, Nagpur`
- `alwaysQuoteIds`: ESIC Claim ID (`visits.claim_id`), IP No. (`patients.insurance_person_no`), UH ID (`visits.esic_uh_id`), Hospital UHID (`patients.patients_id`)
- `guidance`:
  ```
  This is an ESIC claim. The reply is read by ESIC medical auditors.
  - Always quote the ESIC Claim ID, IP number, UH ID and hospital UHID in the opening paragraph.
  - Refer to procedures by their CGHS code AND name together, with the approved package amount
    and approved package days.
  - Where the stay exceeded the approved package days, state the exact number of extra days, the
    clinical reason for each, and whether an extension of stay was applied for and approved
    (extensionTaken, extensionOfStay, extensionDaysCount in the record).
  - Where a procedure was outside the approved package, state plainly that it was not part of
    CGHS code <code> and give the clinical event that made it necessary, with its date.
  - Where intimation or bill submission was delayed, state the actual dates and whether
    condonation or a delay waiver was applied for (condonationDelayIntimation,
    condonationDelayClaim, condonationDelaySubmission, delayWaiverIntimation).
  - For unlisted procedures, state whether prior approval was obtained and by whom
    (surgicalApproval, additionalApprovals, packageApprovedBy, packageApprovedAt).
  - For implants, cite the actual invoice. If no implant invoice is recorded in the software,
    use a placeholder. Never state an implant cost that is not in the records.
  - Name the operating ESIC empanelled surgeon where the record has one.
  ```
- `standardAnnexures`: the 10 ESIC entries from `CORPORATE_REGISTRATION_DOCUMENTS.ESIC` in `src/lib/registrationDocuments.ts` — referral letter with IP signature, e-Pehchan card, Aadhaar/ID proof, HITLABH or entitlement form, P-VI satisfaction certificate, approved extension of stay, approval for listed/unlisted procedures, condonation/delay waiver, P2 form with photo and signature, patient photographs.

**CGHS / ECHS / Railway (CR, SECR) / WCL / MPKAY / MP Police / PM-JAY / MJPJAY / TPA & Insurance:** generic profile — empty addressee (staff types it), `standardAnnexures` from `getCorporateRegistrationDocuments(corporate)`, and short guidance naming that scheme's identifier fields and its rate source (`pmjay_mjpjay_packages.scheme` for PM-JAY/MJPJAY; `yojana_mh_procedures.tier3_rate` plus `mandatory_docs_claim` for Maharashtra yojana; `cghs_surgery` NABH / non-NABH / Bhopal columns for CGHS and ECHS).

### 8.4 `QUERY_CATEGORIES`

`deduction_of_charges`, `extension_of_stay`, `unlisted_procedure`, `implant_cost`, `delay_condonation`, `rate_or_code_mismatch`, `document_deficiency_nmi`, `duplicate_or_overlap`, `dama_or_death_clarification`, `clinical_justification`, `package_inclusion`, `other`.

### 8.5 Post-processing every AI response

1. Strip ``` fences if present, then `JSON.parse`. On failure, show the raw text in an error panel — never silently substitute a template.
2. Replace every `—` and `–` with `, ` or `to` as appropriate.
3. Strip markdown artefacts (`**`, leading `#`, leading `- `).
4. Re-scan `letter_body` for `[[TOKEN]]` matches and reconcile against `open_items`; a token in the body with no `open_items` entry gets one auto-created with a humanised label, and vice versa.
5. Persist `reply_subject`, `reply_body`, `annexures`, `open_placeholders`, `citations`, `ai_model`, `ai_prompt`, `ai_generated_at`, plus a `corporate_query_revisions` row.

## 9. Conventions to follow

- **Queries:** `useQuery` from `@tanstack/react-query` with raw `supabase.from(...)` inside `queryFn`. No ORM or repository layer. Canonical example: `src/components/discharge/GatePassPrint.tsx:36`. Global defaults are deliberately conservative (`retry: 0`, `refetchOnWindowFocus: false`, `staleTime: 5min`) with the rationale commented at `src/App.tsx:167` — do not override them.
- **Client:** `import { supabase } from '@/integrations/supabase/client'`.
- **Toasts:** `import { toast } from 'sonner'` — matches the letter/PDF precedent in `NoDeductionLetter.tsx` and `ESICLetterGenerator.tsx`.
- **Forms:** plain `useState` + `<Input>` / `<Textarea>` / `<Select>` + a manual `handleSubmit`. `react-hook-form` and `zod` are dependencies but **zero files import `zodResolver` or `@/components/ui/form`**. Do not introduce them for this module.
- **Icons:** `lucide-react`. **Dates:** `date-fns`, `format(d, 'dd/MM/yyyy')`.
- **No mock data, no silent fallbacks.** On failure show the real error. This is a standing project rule and the existing mock fallback in `NoDeductionLetter.tsx` is a known violation, not a pattern.
- **Soft delete** via an `is_active` flag rather than `DELETE`, for reference docs and rules.
- **Surgical changes only.** The only pre-existing files to touch are `AppRoutes.tsx`, `menuItems.ts`, `sidebarGroups.ts`. Everything else is new. Do not refactor adjacent code, do not unify the duplicated scheme matchers, do not touch `FinalBill.tsx`.

## 10. Verification

**Static**
1. `npm run typecheck` — ratcheted against `typecheck-baseline.txt` by `scripts/typecheck-ratchet.cjs`; the count must not increase.
2. `npm run build` — must pass, including the `prebuild` `check:finalbill` SHA256 guard (proof `FinalBill.tsx` was not touched).

**Migration**
3. `pbcopy < supabase/migrations/20260726100000_corporate_query_replies.sql`, paste into the Supabase SQL editor, run.
4. `NOTIFY pgrst, 'reload schema';`
5. Confirm all four tables are readable from the app with the anon key (RLS check): a plain `select` from each returns without error and without zero-row surprises.

**End-to-end, with a real ESIC visit**
6. Sidebar shows *Corporate Query Reply* under Billing & Accounts, and *Scheme Reference Library* under masters.
7. In the Reference Library, add one rule (title, rule text, citation) and upload one reference document; confirm `extracted_text` is populated.
8. New Query → search a discharged ESIC patient → verify the resolved corporate, scheme badge, claim ID and admission/discharge dates match the patient's record in the app.
9. Paste a real ESIC deduction query with three distinct points. Generate the draft.
10. Verify: three numbered answers in the query's order; every date, amount and CGHS code in the letter matches the database (spot-check against the Final Bill page); the selected rule is quoted verbatim with its citation; no em dashes; no markdown.
11. Verify at least one `[[PLACEHOLDER]]` appears for something genuinely absent (e.g. implant invoice number) with a matching entry in the open-items list. **Confirm the AI did not invent it.** This is the single most important check in the whole module.
12. Edit a sentence by hand, save, confirm a `manual_edit` revision row exists.
13. Ask the AI *"make it shorter and more formal"*; confirm the facts, dates, amounts and citations survive unchanged, and an `ai_revision` row records the instruction.
14. Restore the previous revision from history; confirm the body reverts.
15. Print. Confirm: hospital letterhead, correct Ref / Your Ref / Date, ESIC To and Through blocks, numbered body, annexure table with Available / To be arranged, blank signature line, empty stamp box, placeholders rendered as dotted hand-fillable blanks, A4 with sane margins, page numbers on a multi-page letter.
16. Mark Approved → Mark Sent with a date → confirm the register shows the status and the due-date warning clears.
17. Save to patient documents → confirm a `patient_documents` row exists for `(visit_id, document_name)` with the body in `metadata`.
18. Switch hospital (hope ↔ ayushman) and confirm the register only shows the current tenant's queries and the letterhead changes.

**Negative tests**
19. Temporarily break the AI call (bad model name). Confirm a real error is surfaced and the existing draft is untouched — no mock letter, no blank body.
20. Create a query for a patient with almost no data recorded. Confirm the module produces a letter dense with placeholders and open items rather than a confident, fabricated one.

## 11. Suggested build order

1. Migration + `src/types/corporateQuery.ts` + `src/lib/corporateQueryDb.ts` — verify reads/writes from a scratch page first.
2. `schemeResolver.ts`, then `patientContextPack.ts` — log the pack for three real visits across three different schemes and eyeball every field against the app before writing any prompt.
3. `SchemeReferenceLibrary` page (the AI needs something to cite).
4. `corporateQueryPrompt.ts` + the LLM call. Iterate on prompt quality against real queries before building the polished UI.
5. Register page + `NewQueryDialog`.
6. Workbench: context panel, reference selector, editor, AI revise, revisions, annexures.
7. `hospitalLetterheadHtml.ts` + `corporateQueryLetter.ts` + print.
8. Status lifecycle, save-to-patient-documents, routing and sidebar.
