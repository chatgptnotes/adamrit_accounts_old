# Corporate Query Reply Module — Brief

Build a Corporate Query Reply module in Adamrit HMS (Vite + React + TypeScript + Supabase).

Staff pick a patient and visit, then paste the query received from a corporate or scheme (ESIC first). The module assembles that patient's full context from the database: admission, diagnoses, procedures with CGHS codes, package and approvals, extension and condonation, labs, radiology, medications, discharge narrative, bills, deductions and documents. An LLM then drafts a formal reply letter citing hospital records, the corporate's rate and tariff rows, uploaded scheme reference documents, and manually added rules with their citations. Anything absent from the software becomes a highlighted `[[PLACEHOLDER]]` plus an open-item entry, never a guess. Staff edit the draft by hand or by instructing the AI, and every version is saved. Print on hospital letterhead as an A4 PDF with an annexure table, a blank signature line and a stamp box. All queries live in a register with status tracking from draft through sent to closed.

Four new tables, three new pages, one new sidebar entry. Reuse `NoDeductionLetter.tsx`, `useVisitData`, `useFinancialSummary` and the existing `/api/ai-proxy` (no new API key). Do not modify `FinalBill.tsx`.

Full spec: [`corporate-query-reply-SPEC.md`](./corporate-query-reply-SPEC.md)
