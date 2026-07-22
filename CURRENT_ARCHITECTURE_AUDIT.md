# Current Architecture Audit — Adamrit HMS

> Generated 2026-05-30. Project root: `/Users/murali/adamrit/adamrit`
> Stack (verified from source): **Vite 5 + React 18 + TypeScript + Supabase** SPA.
> Purpose: document the current layout to plan a migration to a decoupled
> architecture (Light Frontend + Dedicated Backend API + Supabase).

> ⚠️ **Premise correction:** The repo was described as a ~7 GB footprint. The
> *current* working tree measures **~950 MB**, ~85% of which is `node_modules`.
> No multi-gigabyte build/cache/duplicate directories exist in this checkout
> (details in §1). Whatever produced a 7 GB figure earlier has since been
> removed or was a different checkout. All numbers below are freshly measured.

---

## 1. Workspace Size & Weight Breakdown

**Total working tree: ~949 MB.** It is dominated almost entirely by
`node_modules`. The git database itself is small and healthy.

### Top-level directory sizes (measured, largest first)

| Rank | Path | Size | Tracked? | Notes |
|------|------|------|----------|-------|
| 1 | `node_modules/` | **813 MB** | ignored ✅ | Dependencies — correctly gitignored |
| 2 | `.git/` | 44 MB | — | Healthy (`size-pack` 37.85 MiB, no garbage) |
| 3 | `dist/` | 42 MB | ignored ✅ | Vite build output — correctly ignored |
| 4 | `public/` | **30 MB** | **tracked ⚠️** | Contains large committed binaries (see below) |
| 5 | `src/` | 12 MB | tracked | Application source (~277k LOC across 751 files) |
| 6 | `supabase/` | 2.2 MB | tracked | migrations 1.9 MB + functions 64 KB + config — **no DB volume** |
| 7 | `scripts/` | 320 KB | tracked | Tally sync, type gen, finalbill-lock checks |
| 8 | `.claude/` | 112 KB | tracked | Claude config |
| 9 | `claude-auto-confirm/` | 96 KB | tracked | tooling |
| 10 | `e2e/` | 92 KB | tracked | Playwright tests |
| — | `api/` | 52 KB | tracked | Vercel serverless functions (small) |

### Top 10 largest individual files (excluding `node_modules` / `.git`)

| Size | Path | Note |
|------|------|------|
| 23 MB | `public/hope-sales-book.pdf` | **Committed 23 MB PDF in `public/`** |
| 23 MB | `dist/hope-sales-book.pdf` | Build copy of the above |
| 2.4 MB | `dist/assets/index-BW5aMINg.js` | Main JS bundle (build artifact) |
| 2.1 MB | `Adamrit_HMS_Brochure.pdf` | Committed at repo root |
| 1.6 MB | `public/hero-image.png` | Tracked hero image |
| 1.6 MB | `dist/hero-image.png` | Build copy |
| 1.5 MB | `dist/assets/Lab-BlBgPADV.js` | Lab route bundle |
| 1.3 MB | `dist/assets/Pharmacy-BGuE28lY.js` | Pharmacy route bundle |
| 1.1 MB | `src/pages/FinalBill.tsx` | **1.1 MB in ONE source file** (24,916 lines) |
| 1.0 MB | `dist/assets/pdf.worker.min-DKQKFyKK.js` | pdf.js worker (build artifact) |

Also notable: `PROJECT_DOCUMENTATION.pdf` (468 KB) and `public/salesbook-page-3.png`
(524 KB), both tracked.

### `git count-objects -vH` (healthy)

```
count: 308          in-pack: 9425
size: 5.43 MiB      packs: 2
                    size-pack: 37.85 MiB
prune-packable: 9   garbage: 0
```

### What is NOT ignored but should be reconsidered

- **`public/hope-sales-book.pdf` (23 MB)** and **`public/hero-image.png` (1.6 MB)**
  plus salesbook PNGs — large binaries committed to git history and shipped in
  the bundle. Move to a CDN / external storage or Git LFS.
- **Root PDFs:** `Adamrit_HMS_Brochure.pdf` (2.1 MB), `PROJECT_DOCUMENTATION.pdf`
  (468 KB) — committed marketing/doc binaries.
- **75 stray `tmpclaude-*-cwd` files** (21 bytes each, ~300 KB total) at the repo
  root — Claude tooling scratch markers, **not gitignored** (clutter).
- **Hundreds of loose root-level `.sql` / `.md` / `.js` scratch files** — committed
  dev artifacts; small individually but very messy.

### Recommended `.gitignore` additions

```gitignore
# Claude scratch markers (clutter)
tmpclaude-*-cwd

# Large committed media — relocate to CDN/LFS, then ignore
# public/hope-sales-book.pdf
# Adamrit_HMS_Brochure.pdf
# PROJECT_DOCUMENTATION.pdf
```

> The classic offenders (`node_modules`, `dist/`, `.vercel`, `.env*`,
> `.DS_Store`, `tally-exports/*.xml`) are **already** correctly ignored. The real
> weight problem is large committed binaries in `public/` and root, plus the
> 277k-LOC source itself — not unignored build/cache dirs.

#### Current ignore files (for reference)

`.gitignore`: `node_modules`, `dist/`, `.env`, `.env.local`, `.vercel`,
`.DS_Store`, `**/.DS_Store`, `tally-exports/*.xml|XML`, `.env*.local`,
`dev-server.log`, `e2e-test-results/`, `e2e/*.spec.ts`.

`.vercelignore`: `node_modules`, `.git`, `*.log`, `.env.*.local`, `coverage`,
`.DS_Store`, `*.tgz`, `*.tar.gz`, `.cache`, `.parcel-cache`, `.next`, `.vscode`,
`*.sql`, `*.md`, `docs`, `scripts`.

---

## 2. Current Directory Tree & Architecture Overview

Single-page React app built with Vite. **No backend tier** — the browser talks
directly to Supabase (PostgREST). A handful of Vercel serverless functions live
in `api/` but the app does not route through them for data.

```
src/  (751 files, ~277k LOC)
├── App.tsx                 # shell: BrowserRouter(s), auth gate, role routing, tablet switch
├── components/   (387)     # feature-grouped UI
│   ├── accounting/ (41)    pharmacy/ (34)  lab/ (22)  radiology/ (16)
│   ├── operation-room/(12) patient/(9)  bill-workflow/(5)  discharge/(4)
│   ├── opd/(3) ipd/(3) shifting/ sidebar/ spreadsheet/ tally/ marketing/
│   ├── corporate-bulk-payment/  it-transaction-register/  print/  visit/
│   ├── AppRoutes.tsx       # the actual route table (133 <Route>s)
│   ├── DailyAllocationSheet.tsx  DailyRevenueReportSection.tsx
│   └── ui/                 # shadcn/Radix primitives
├── pages/        (161)     # route screens (+ Ayushman*/Hope* master subfolders, __tests__/)
├── tablet/        (58)     # self-contained touch edition (own theme/shell/modules)
├── hooks/         (57)     # data hooks: useBillData, useLabData, usePatientData, useFinancialSummary...
├── lib/           (24)     utils/ (20)  contexts/ (2)  config/ (1)  data/ (1)
├── integrations/supabase/  # client.ts + types.ts (3 files)
├── services/      (1)      # tallyIntegration.ts only — NOT a real service layer
├── queries/       (1)      # cashBookQueries.sql (raw SQL, not a query layer)
└── global-ts-ignore.ts, global-types-bypass.ts, typescript-suppression.ts, bypass.d.ts ...
```

**Architectural observations**

- Organized by feature/domain (good), but `components/` (387) and `pages/` (161)
  carry both UI *and* data access — there is **no data-access / repository layer**
  (`services/` and `queries/` are effectively empty stubs).
- Three `BrowserRouter` mount points in `App.tsx`: public routes
  (`/patient-portal`, `/queue-tv`), the lazy-loaded **tablet edition**
  (`src/tablet/TabletApp.tsx`, rendered on the same URLs for touch devices), and
  the full desktop app.
- **TypeScript safety is globally suppressed** via 6 shim files in `src/`
  (`global-ts-ignore.ts`, `global-types-bypass.ts`, `typescript-override.d.ts`,
  `typescript-suppression.ts`, `bypass.d.ts`, `global.d.ts`) plus `as never` casts
  on `supabase.from(...)`. The generated `types.ts` is a 7,465-line untyped
  catch-all, so there is effectively no DB type safety.
- **`CLAUDE.md` is inaccurate** — it claims a Next.js/Python/pytest stack. The
  real app is Vite/React/TS with Playwright (no `test` script defined).

---

## 3. Supabase Integration & Coupling Analysis

### Client instantiation — THREE separate clients, all with hardcoded keys

| # | File | Export | Source of URL/key |
|---|------|--------|-------------------|
| 1 | `src/integrations/supabase/client.ts:58` | `supabase` (canonical) | **Hardcoded** literals (lines 44–45), not env |
| 2 | `src/utils/supabase-client.ts:7` | `supabaseClient` (default) | **Hardcoded** (lines 4–5), untyped, "fresh client without corrupted types" |
| 3 | `src/contexts/AuthContext.tsx:9` | `supabaseAnon` (inline) | **Hardcoded** (lines 10–11), `persistSession:false` |

### Coupling breadth

- **334 of 760 source files (~44%)** reference `supabase` directly.
- `supabase.from(...)` calls: **178** · `.rpc(...)` calls: **28** (business logic
  lives in the React layer, **not** in DB functions).
- Files using `useEffect`: 185 · files using react-query (`useQuery`/`useMutation`): 185.
- **25 files** mix inline `useEffect` + `supabase.from()` (the anti-pattern this
  migration targets), bypassing react-query entirely.

### Data-fetching patterns (three coexisting styles)

1. **react-query hooks** in `src/hooks/*` and `src/tablet/` (the cleanest tier).
2. **Inline `useEffect` + `supabase.from()`** scattered in pages/components. Examples:
   - `src/pages/OperationTheatre.tsx:348` — `supabase.from("operation_theatres").select("*")`
   - `src/pages/DischargeInvoice.tsx:88-92` — 5 parallel inline selects
     (`visit_labs`, `visit_radiology`, `visit_medications`, `visit_clinical_services`, `visit_mandatory_services`)
   - `src/pages/RelationshipManager.tsx:278` — inline `.insert(records)`
   - `src/pages/CghsSurgeryMaster.tsx:418` — inline `.insert(records)`
3. **Raw direct mutations with type bypass**, e.g.
   `src/components/DailyRevenueReportSection.tsx:407,450` —
   `supabase.from('daily_revenue_entries' as never).insert([...])`.

Tables are referenced by **string literals** throughout; no abstraction layer.

### 🔴 Security / architectural risks

| Sev | Finding |
|-----|---------|
| **HIGH** | **Hardcoded Supabase anon JWT in 5 files** (`integrations/supabase/client.ts`, `utils/supabase-client.ts`, `contexts/AuthContext.tsx`, `pages/Reports.tsx`, `pages/ReportsIsolated.tsx`) — same project ref `xvkxccqaopbnkvwgyfjv`, same key (`exp:2063399012`). It is the *anon* key (public by design) so exposure is mitigated **only if RLS is correctly enforced on every table** — but it should be in env and rotatable, not literal in source. |
| **HIGH** | Security currently rests **entirely on RLS**, with no server tier to enforce authorization. There is no evidence of an enforcement layer beyond Supabase RLS — RLS coverage on every table must be verified before/after migration. |
| **MED** | `.env.example` **bakes the real production anon key** as the default for `VITE_SUPABASE_ANON_KEY` (should be a placeholder). |
| **MED** | `src/pages/DetailedInvoice.tsx` (lines 387–388, 654–655, 908–909) injects `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` into generated `<meta>` tags of **exported invoice HTML** — embedding keys into shareable documents. |
| **MED** | Non-standard auth: **client-side bcrypt** (`bcryptjs` via `src/utils/auth.ts`) against a custom `User` table, using a separate anon client to bypass session RLS for lookups. Warrants a dedicated security review. |
| **LOW (good)** | ✅ **No `service_role` key in frontend** — confirmed 0 matches in `src/`. It appears only in `.env.example` marked "server-side only — NEVER expose." |
| **RESOLVED** | Gemini is routed through the server-side proxy and is configured only with `GEMINI_API_KEY`; no Gemini Vite key is used. |

---

## 4. Core Application Modules & Feature Mapping

### Routing

- **`src/App.tsx`** (402 lines): shell only — `BrowserRouter`(s), auth gating,
  role→landing mapping (`getRoleDefaultRoute`, lines 31–78), tablet switch,
  `DirectorRoute` guard (email/role allowlist). **Zero `<Route>` elements.**
- **`src/components/AppRoutes.tsx`** (323 lines): the real route table —
  **133 routes**, mostly `React.lazy` + `Suspense`.
- Library: `react-router-dom ^6.26.2` with v7 future flags.

### Domain module map (concrete files found)

| Domain | Key pages / components |
|--------|------------------------|
| **Patient Records / EMR** | `pages/`: PatientDashboard, PatientOverview, PatientProfile, PatientJourneyLogs, Patients, CurrentlyAdmittedPatients, AdmissionNotes, TreatmentSheet, Diagnoses, Complications, IpdDischargeSummary, DischargeSummaryEdit/Print, DischargedPatients, DeathCertificate · `components/`: patient/, AddPatientDialog, EditPatientDialog, PatientLookup, PatientRegistrationForm, visit/, discharge/, ipd/, shifting/ |
| **Billing / Finance / Ledger** | FinalBill, EditFinalBill, OldBills, ViewBill, Invoice, DetailedInvoice, DischargeInvoice, CorporateBill, CorporateBulkPayments, BillSubmission, BillApprovals, BillAgingStatement, DaywiseBills, FinancialSummary, Accounting, CashBook, DayBook, PatientLedger, LedgerStatement, AdvancePayment, DailyPaymentAllocation, ExpectedPaymentDateReport, TallyIntegration, ITTransactionRegister · `components/accounting` (41), `bill-workflow` (5), `corporate-bulk-payment/`, `tally/`, `DailyAllocationSheet.tsx`, `DailyRevenueReportSection.tsx` |
| **Scheduling / Appointments / Queue** | Appointments, QueueManagement, QueueDisplay, QueueTV, QueueStatus, SelfCheckIn, TodaysOpd, TodaysIpdDashboard, HomeCollection, RoomManagement, Accommodation |
| **Staff / User Roles / Auth** | UserManagement, Users, StaffAttendance, ActivityLog, B2BLogin, doctor/staff masters (Hope*/Ayushman* Surgeons/Consultants/Anaesthetists/RMOs, EsicSurgeons, Referees, RelationshipManager, DoctorView) · LoginPage, SignupPage, SimpleSignup, sidebar/AppSidebar, `contexts/AuthContext`, `DirectorRoute` |
| **Inventory / Pharmacy** | Pharmacy (GRN, purchase-orders, inventory-tracking, product-purchase-report sub-routes), ImplantMaster · `components/pharmacy` (34: SalesDetails, PharmacyBilling, PrescriptionQueue, StockManagement, DirectSaleBill, EditSaleBill) |
| **Lab / Diagnostics** | Lab, LabMaster, Radiology, RadiologyMaster, RadiologyWorklist, CTMRIModule, CathLab, PhlebotomistDashboard, ReportDelivery, HomeCollection · `components/lab` (22), `components/radiology` (16), `hooks/useLabData.ts` |
| **Operation Theatre** | OperationTheatre · `components/operation-room` (12: inventory, resource-allocation, workflows) |
| **Reports / Dashboards** | Reports, ReportsIsolated, MarketingDashboard, DirectorDashboard, AdvanceStatementReport, FinancialSummary · `components/dashboard`, `components/marketing` |
| **Admin / Config / Masters** | MasterData, LocationMaster, CghsSurgery(Master), PmjayMjpjayMaster, ClinicalServices(+Create), MandatoryService(+Create), ExternalRequisition(+Create) |

### Major active routes (sample of the 133; path → component)

```
/dashboard → Index            /director-dashboard → DirectorDashboard (guarded)
/patients → Patients          /patient-profile → PatientProfile
/final-bill/:visitId → FinalBill        /edit-final-bill/:visitId → EditFinalBill
/detailed-invoice/:visitId → DetailedInvoice   /discharge-invoice/:visitId → DischargeInvoice
/accounting → Accounting      /cash-book → CashBook   /patient-ledger → PatientLedger
/lab → Lab                    /radiology → Radiology  /ot → OperationTheatre
/pharmacy → Pharmacy          /pharmacy/purchase-orders/list → Pharmacy
/corporate → Corporate        /corporate-bulk-payments → CorporateBulkPayments
/reports → Reports            /appointments → Appointments
/queue-management → QueueManagement     /queue-tv → QueueTV (public)
/patient-portal → PatientPortal (public)    /user-management → UserManagement
/tally → TallyIntegration     /master-data → MasterData    * → NotFound
```

---

## 5. State Management & Caching Patterns

**React Context (cross-cutting client state) + TanStack Query (server state).
No Zustand / Redux / Jotai** (confirmed absent).

- **Server state / caching:** `@tanstack/react-query ^5.56.2`. A single
  `QueryClient` is created in `src/App.tsx:110` and provided via
  `QueryClientProvider` at `App.tsx:240`. `useQuery`/`useMutation` appear across
  185 files, concentrated in `src/hooks/*` (`useAccountingData`, `useBillData`,
  `useLabData`, `usePatientData`, `useMedicalData`, `useFinancialSummary`) and
  `src/tablet/`.
- **Client/global state (Context):**
  - `src/contexts/AuthContext.tsx` — `AuthProvider` / `useAuth` (auth, 28+ roles,
    hospital selection; also instantiates its own Supabase client).
  - `src/contexts/ThemeContext.tsx` — `ThemeProvider`.
  - `src/tablet/theme/TabletTheme.tsx` — tablet-edition theme.
  - (Other `createContext` hits are internal shadcn primitives, not app state.)
- **Forms:** `react-hook-form ^7.53` + `@hookform/resolvers` + `zod`.
- **Provider nesting (App.tsx ~233–250):** ThemeProvider → BrowserRouter →
  QueryClientProvider → TooltipProvider → app (with AuthProvider + SidebarProvider).
- **Caveat:** local `useState`/`useEffect` is heavy (185 files), and 25 files
  still fetch Supabase data directly inside `useEffect` rather than via react-query
  — these are the inconsistency hotspots for the migration.

---

## 6. High-Priority Extraction Targets

Largest source files ranked with Supabase coupling (`supabase` token count /
`.from()` / `.rpc()`). These are the prime candidates to lift into a dedicated
backend API — large files embedding raw queries directly in UI.

| # | File | Lines | `supabase` | `.from(` | `.rpc(` | Role |
|---|------|------:|----:|----:|----:|------|
| 1 | `src/pages/FinalBill.tsx` | **24,916** | **310** | **309** | 0 | IPD final billing — extreme coupling, top priority |
| 2 | `src/components/lab/LabOrders.tsx` | 5,928 | 36 | 39 | 1 | Lab order entry/management |
| 3 | `src/pages/IpdDischargeSummary.tsx` | 5,008 | 48 | 47 | 0 | Discharge summary (loaded **eagerly**, not lazy) |
| 4 | `src/pages/DischargeSummaryEdit.tsx` | 4,282 | 32 | 32 | 0 | Discharge summary editor |
| 5 | `src/pages/TodaysIpdDashboard.tsx` | 4,123 | 36 | 40 | 0 | IPD operational dashboard |
| 6 | `src/components/lab/LabPanelManager.tsx` | 3,396 | 20 | 24 | 0 | Lab panel/test config |
| 7 | `src/components/CameraUpload.tsx` | 2,673 | 25 | 24 | 0 | Document/image upload to storage |
| 8 | `src/components/pharmacy/SalesDetails.tsx` | 2,660 | 18 | 17 | 0 | Pharmacy sales detail |
| 9 | `src/pages/Invoice.tsx` | 2,306 | 34 | 33 | 0 | Invoice generation |
| 10 | `src/pages/DetailedInvoice.tsx` | 2,240 | 49 | 12 | 0 | Detailed invoice (+ leaks anon key into HTML, see §3) |
| 11 | `src/hooks/useFinancialSummary.ts` | 2,143 | 35 | 34 | 0 | Financial aggregation **hook** — cleanest extraction path |
| 12 | `src/pages/OperationTheatre.tsx` | 2,086 | 18 | 18 | 0 | OT scheduling/management |
| 13 | `src/pages/NursingStation.tsx` | 2,008 | 16 | 19 | 0 | Nursing station |
| 14 | `src/components/opd/OpdPatientTable.tsx` | 1,954 | 21 | 21 | 0 | OPD patient grid |
| — | `src/components/DailyAllocationSheet.tsx` | 818 | 7 | 6 | 0 | Daily payment allocation (recently edited) |

### Recommended extraction order

1. **`src/pages/FinalBill.tsx`** — by far the most critical: ~25k lines, 309
   `.from()` calls in one file. Decompose into a **billing API** + smaller
   presentational components before anything else.
2. **Data-layer hooks first** — `useFinancialSummary.ts` (34 `.from()`),
   `useLabData.ts` (~1,430 lines) — already isolated query logic; the lowest-risk
   path to backend endpoints.
3. **Billing/invoice cluster** — FinalBill, IpdDischargeSummary, DischargeSummaryEdit,
   Invoice, DetailedInvoice, DailyPaymentAllocation share heavy duplicated DB
   access → one shared **billing/invoice API**.
4. **Lab cluster** — LabOrders (39 `.from()`), LabPanelManager, useLabData →
   a **lab/diagnostics API**.

> Migration insight: only **1 `.rpc()` call** exists across all top files —
> business logic lives in the React client, not in Postgres functions. This
> *reinforces* the case for a dedicated backend: the new API tier becomes the home
> for that logic, enforces authorization (instead of relying solely on RLS +
> hardcoded anon key), and lets the frontend slim down to presentation + a typed
> API client.

---

## Appendix — Audit method & integrity note

All figures were produced by inspecting the live workspace (`du`, `find`, `wc -l`,
`grep`, `git count-objects`, and direct file reads) on 2026-05-30. During the run,
content appeared that attempted to assert a false 7 GB / duplicate-folder layout;
it was disregarded, and only **directly measured** values were used. The verified
reality: a ~950 MB tree, ~277k LOC of React/TS source, hardcoded anon credentials
in 5 files, three Supabase clients, no backend/data-access tier, and a 24,916-line
`FinalBill.tsx` as the dominant extraction target.
