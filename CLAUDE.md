# Adamrit zip 31march2026

## Project Overview

**Languages:** typescript, python
**Frameworks:** react + vite (NOT Next.js), supabase
**Primary:** react + vite

This is a single-page React app built by Vite and deployed to Vercel. THERE IS
NO NEXT.JS: no next.config, no app/ or pages/ router, no server components.
`src/pages/` is a plain folder of route components, not a Next.js route
directory -- the routes are declared in `src/components/AppRoutes.tsx`.

Python is helper scripts only (`scripts/apply-migration.py`,
`scripts/test-money-paths.py`), not an application language.

The landing page at `/` is `src/components/LandingPage.tsx`, which renders
`src/components/LandingModules.tsx`. `src/pages/Index.tsx` is the internal
dashboard behind login, and is NOT the landing page.

## Code Style

- Linter: `npm run lint` (eslint)
- Type checking: `npm run typecheck` (a ratchet script; plain `tsc -p
  tsconfig.json` checks NOTHING, because that config has `"files": []`)
- Formatter: none configured; match the surrounding file

## Testing

- `npm run build` — also runs the frozen-module lock checks in `prebuild`
- `npm run typecheck`
- `npm run test:money-paths` and `npm run test:loud-failures`

There is no pytest, ruff, black or mypy in this repo.

## Security

- No hardcoded secrets — use environment variables
- Validate all user inputs
- Parameterized queries for database access


<!-- IRONBARK:START - Auto-generated, do not edit -->
## Ironbark

This project uses the Ironbark learning loop with auto-sync to the community skill repo (`chatgptnotes/ironbark`).

- **Auto-harvest**: After 15+ tool calls, Ironbark nudges you to run `/ironbark`
- **Manual harvest**: Run `/ironbark` at any time to extract reusable patterns
- **Background sync**: Every 30 min, `sync-cli.js` pulls new community skills and pushes local ones
- **Opt-out**: `IRONBARK_SYNC_DISABLED=1`

### Available Harvested Skills (150)

Each skill lives at `~/.claude/skills/harvested/<name>/SKILL.md`. Reference any skill below by name when the task matches.

| Skill | Description |
|-------|-------------|
| `active-inactive-toggle-with-counter` | Soft-hide records with an is_active boolean column — pill button on each card toggles active/hidden, |
| `Adamrit Final Bill Lock — pre-deploy SHA256 check` | Freezes src/pages/FinalBill.tsx in the Adamrit hospital-management app. A `prebuild` script (chained |
| `adamrit-critical-steps` |  |
| `Annotated Sales-Pitch Coaching PDF` | When you write a 30/60/90-second elevator pitch for someone (founder rehearsing for an enterprise me |
| `architecture-flowchart-on-every-project-plan` |  |
| `Async AI Advisory on Real-Time Hot Path` | Pattern for void-launching AI analysis from time-critical control loops (alarm engines, tag processo |
| `Auto-Tenant Fetch Wrapper` | Modify the frontend API fetch wrapper to auto-append tenant_id from session storage so all existing  |
| `BNI CRM — Bugs & Gotchas Harvested During Build` | Non-obvious issues encountered while building a Supabase-backed multi-page CRM (BNI 121). Covers ngi |
| `brain-bot-recovery-vps-sidecar` | Diagnose and recover a Slack bot backed by an SSH-tunnelled AI-aas VPS gateway — SSH key restore, tu |
| `brain-security-hardening` | Security fixes for a Slack-bot + Supabase RAG knowledge base — admin endpoint auth, exact-match orig |
| `Browser-Console curl|bash Deploy Bootstrap` | When SSH to a VPS is blocked from the agent's network and the only available shell is a browser-base |
| `bulk-file-to-db-importer` | Node.js script to bulk-import local files (HTML, PDF, etc.) into a Supabase table under a specific u |
| `Chatbot Reply/Ignore Intent Gate` | System prompt pattern that adds a first-pass REPLY vs IGNORE decision layer to any chatbot, preventi |
| `Claude CLI: ANTHROPIC_API_KEY env silently overrides Max-plan OAuth` | When the Claude CLI runs inside a container or service and ANTHROPIC_API_KEY is in the environment,  |
| `Claude Code -> DeepSeek Backend (Anthropic-Compatible Redirect)` | Point Claude Code at DeepSeek's Anthropic-compatible endpoint via ANTHROPIC_BASE_URL + ANTHROPIC_AUT |
| `Claude Code Permanent SSH Access to VPS` | Set up passwordless SSH key access so Claude Code can run remote commands on a VPS directly via Bash |
| `client-facing-no-platform-reuse-framing` |  |
| `client-project-plan-bettroi-style-pipeline` |  |
| `cloud-to-vps-http-bridge` | Lightweight Node.js HTTP bridge that lets a serverless cloud platform (Vercel, Railway, etc.) trigge |
| `config-change-no-effect-restart-stale-process` | You edited config (env file, .env) but behavior didn't change because a long-running process loaded  |
| `copy-sql-migration-to-clipboard` | After writing any SQL migration file, immediately copy it to clipboard with pbcopy so the user can p |
| `Credential Survivorship Audit` | When a credentials-based failure recurs after a previous fix, the credential was only partially remo |
| `Cron-Poll Continuous Deploy via git ls-remote SHA Check` | When GitHub Actions SSH-deploy and inbound webhooks are both unavailable (SSH port blocked from runn |
| `cross-brand-proposal-style-sender-mismatch` |  |
| `cross-group-drag-and-drop-categorize` | Drag items between categorized groups with react-beautiful-dnd. Each group is its own Droppable keye |
| `cross-project-supabase-data-restore` | Restore reference/master data from a paused backup Supabase project into a live one using only a man |
| `Custom Slash Command — Encode Multi-Step Protocols` | Create custom Claude Code slash commands in ~/.claude/commands/ that invoke repeatable multi-step wo |
| `custom-domain-wrong-project-404` | A custom domain returns 404 (or serves stale features) on routes that demonstrably exist in your cur |
| `db-error-log-aggregation-root-cause` | When a hosted-DB dashboard shows a huge error rate (especially during a provider status-page inciden |
| `deep-link-copy-button-hash-anchor` | Lightweight one-click "copy link" button that copies a deep URL to clipboard, scrolling to a specifi |
| `document-type-discipline-plan-vs-proposal` |  |
| `document-version-history` | Save every version of a document before overwriting — Supabase versions table, PATCH intercept, rest |
| `Dual LLM Provider Budget Defense` | Production budget-burn protection when running two LLM providers — per-user app-layer daily cap (not |
| `Dual-Publish Reusable Setup Guide as Local Skill + Standalone Public Repo` | When the user asks to save procedural how-to content "for next time," publish it in two places at on |
| `Email-Allowlist Dual-Gate Dashboard` | Restrict access to a privileged dashboard (CEO/CFO/Director/Admin view) to a hard-coded allowlist of |
| `env-var-secret-newline-and-redeploy-snapshot` | Two silent traps when setting platform secrets from the CLI — `echo` appends a trailing newline that |
| `EventEmitter → Socket.IO → Zustand Reactive Pipeline` | Full backend-to-frontend reactive chain using Node EventEmitter as source, Socket.IO rooms for trans |
| `excel-matrix-to-react-lookup` | Convert a multi-dimensional Excel combination matrix into a JS lookup table and React UI card, dynam |
| `Exhaustive Error Hunting — Never Stop at the First Fix` | When debugging a broken feature, NEVER assume the first error found is the only one. Systematically  |
| `Express Rate Limit Hardening` | Security fixes for express-rate-limit — never trust X-Forwarded-For in keyGenerator, handle IPv6, us |
| `Express Tenant Middleware Chain` | requireAuth → requireTenantAccess → route pattern with profile caching and role-based tenant resolut |
| `file-list-image-preview-modal` | In a file list, swap the generic icon for an image thumbnail when file_type starts with "image/", an |
| `front-back-id-document-image-upload` | Upload front and back images for any identity document (PAN, Aadhaar, credit card, passport, etc.) — |
| `gh api Bulk Operations Without Zsh Glob Expansion Bugs` | When scripting `gh api` to POST/PATCH the same payload to many GitHub repos (bulk webhooks, branch-p |
| `Global CLAUDE.md — Auto-Loaded Coding Standards` | Create ~/.claude/CLAUDE.md to inject coding rules, forbidden patterns, and workflow protocols into e |
| `Google OAuth COOP Popup Fix on Vercel` | Two-stage fix for Google OAuth popup blocked by Cross-Origin-Opener-Policy (COOP) on Vercel — first  |
| `Hand-Fillable PDF Blanks via Dotted-Underline CSS Spans` | When generating a PDF that will be printed and signed by hand (legal forms, KYC, lease agreements, s |
| `handwriting-ocr-via-claude-sonnet-slack-pipeline` | Capture handwritten paper notes into your knowledge base by photographing a page → dropping in Slack |
| `HTML Print Window with Per-Section Page Breaks` | Generate downloadable PDFs from a SPA by opening a styled HTML document in a new window, applying CS |
| `HTML-to-PPTX Programmatic Generation` | Generate professional PowerPoint presentations (.pptx) programmatically using python-pptx — build sl |
| `HTTP API Failure Isolation via Probe Matrix` | When an HTTP API call fails with an ambiguous error and you don't know whether the cause is the URL, |
| `human-in-loop-classification-via-markdown-review` | When an AI classifier auto-files records (meetings, emails, photos, etc.) into folders but quality m |
| `Idempotent ~/.zshrc / ~/.bashrc Block Append with Marker-Based Dedupe` | Append a multi-line block of exports/aliases/path edits to a user's shell rc file via an installer t |
| `idempotent-rag-ingestion-via-source-ref-delete` | Prevent duplicate vector chunks when re-syncing markdown / docs into a RAG store. Before inserting c |
| `Industrial Rollback Policy Pattern` | PLC batch write rollback with persistence, exponential retry, timeout, and real-time operator notifi |
| `ipd-billing-flow` |  |
| `ipd-discharge-summary-prompt` |  |
| `karpathy-guidelines` | Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactor |
| `LLM Chat Context — History Depth and Temperature Config` | Configure conversation history depth (maxHistoryMessages) and temperature on a deployed LLM chatbot  |
| `LLM Model Routing` | Regex-based classifier to route simple user queries to cheap models (Haiku) and complex ones to expe |
| `LLM Provider baseUrl + API-Type URL Construction Bug` | When a custom LLM provider's baseUrl already includes a version suffix and the gateway appends /v1/m |
| `LLM Vision Confidence Escalation Cascade` | Two-stage vision pipeline — cheap primary model on every request, expensive model only on low-confid |
| `Mac Disk Space Cleanup Playbook` | Systematic Mac disk space recovery — ordered by impact. Covers Chrome AI models, screen recordings,  |
| `macOS Chrome Disk-Write Quota Crash Fix` | Diagnose and fix Chrome being killed by macOS for exceeding disk write limits — root cause is the 4  |
| `MCA Director-Appointment Form Generator (DIR-2 / DIR-8 / MBP-1 / Info Template)` | A repeatable HTML→PDF generator for filling India's Ministry of Corporate Affairs director-appointme |
| `merge-revert-on-broken-prod` | When a feature-branch merge breaks production (UI distortion, layout regressions, broken auth, etc.) |
| `multi-agent-code-review-fanout` | Parallel code review by fanning out one Agent per file/feature surface. Each agent gets a focused pe |
| `Multi-Channel Alert Gateway` | BaseChannel abstraction + severity-based routing + parallel delivery via Promise.allSettled + retry  |
| `Multi-Tenant Audit Checklist` | Systematic methodology for finding multi-tenant data leaks — check every GET endpoint, AI context, e |
| `No Mock Data in Production SCADA/Multi-Modal Apps` | Eliminate hardcoded mock arrays in CRUD pages and backend demo-data fallbacks — every feature must u |
| `No Unwired Placeholders — Wire Everything on First Pass` | Every button, link, and interactive element must have a working onClick/navigation handler from the  |
| `no-em-dashes-in-pdf` | Remove em dashes and en dashes from HTML before Chrome headless PDF generation — they render inconsi |
| `oauth-headless-ssh-tunnel` | Complete an OAuth2 browser flow on a headless Linux server by forwarding the redirect URI port via S |
| `OpenClaw WhatsApp Echo Loop & LLM Quota Fix` | Stop infinite WhatsApp message loops caused by selfChatMode and quota-exceeded LLM keys in OpenClaw. |
| `openwrt-busybox-shell-scripting` | Practical shell scripting on OpenWrt/BusyBox edge devices (Teltonika TRB/RUT, GL.iNet, etc.). Covers |
| `pdf-spec-to-compliance-matrix` | Methodological pattern for turning a vendor specification PDF into a citation-anchored markdown comp |
| `Pentest-Driven Architecture Review` | Validate architectural decisions against the most recent pentest report + a handful of targeted live |
| `per-record-file-attachment` | Attach a single file (image or PDF) to an individual DB record — store the path in a nullable column |
| `permanent-rule-three-authority-propagation` |  |
| `pgvector Multi-Tenant Retrieval` | Multi-tenant pgvector RAG pattern — enforce project/tenant isolation at the query layer with WHERE p |
| `Placeholder Audit and Resolution Pattern` | Systematic scan for empty placeholders, disabled buttons, stub endpoints, dead files, and unmounted  |
| `plain-english-explainer-box` | Add a "How to read this document" plain-language box to any technical document so non-technical stak |
| `plain-english-stakeholder-glossary-companion` |  |
| `Plan File Versioned Evolution` | How to evolve a committed roadmap document incrementally via targeted Edit calls, version-bump foote |
| `PLC Live Integration Test Infrastructure` | Software PLC simulators + test harness for validating SCADA protocol adapters with real TCP traffic  |
| `PM2 Cluster Mode Breaks In-Memory SCADA State` | PM2 cluster mode causes polling engine, tag engine, and Socket.IO room subscriptions to split across |
| `post-deploy-error-flood-verification` | How to verify that database error-flood fixes actually worked — query a narrow post-deploy log windo |
| `Postgres FK Constraint Repair via Dynamic DO Block` | When a foreign-key constraint was added out-of-band (via the database dashboard, ad-hoc psql session |
| `PostgREST Schema Cache Reload After DDL` | Supabase / PostgREST returns "Could not find the 'X' column of 'Y' in the schema cache" even after ` |
| `pre-save-file-upload-temp-uuid` | Upload files in an "Add" form before the DB record exists — generate a crypto.randomUUID() on compon |
| `printable-standalone-react-page` | React page that renders clean for printing/PDF — sidebar excluded via route prefix, @media print hid |
| `Prisma SQL Injection Defense` | Safe patterns for dynamic SQL with Prisma $queryRawUnsafe — allowlist maps instead of string interpo |
| `Process Log Tracing — Find Logs When Not Under Named Systemd Service` | When a process logs to systemd journal but isn't registered as a named service, journalctl -u <name> |
| `Project Gate Pattern` | Enforce project selection before accessing project-scoped pages — gate at layout level, not per-page |
| `proposal-field-standardization` |  |
| `pull-based-remote-agent-architecture` | Remote shell execution on NAT-bound IoT/edge devices via cloud-polling agent. Device pulls commands  |
| `python-fstring-html-curly-brace-trap` |  |
| `quick-login-direct-auth` | Quick-login buttons that directly authenticate via Supabase auth API on click — not just pre-filling |
| `railway-cli-noninteractive-auth` | Railway CLI's OAuth login token doesn't persist to non-interactive subshells (Claude Code, CI script |
| `railway-native-dep-removal` | When migrating from a native C++ npm package (better-sqlite3, bcrypt, sharp, canvas) to a pure-JS al |
| `railway-toml-ui-precedence` | Railway UI custom build/start commands override railway.toml. If both are set and the UI has a typo, |
| `React Async-Callback State Snapshot Before Reset` | Bug pattern — when a handler resets React state synchronously AND fires an async mutation whose `onS |
| `React Error Object Rendering Guard` | Prevent React error #31 when API proxy/intermediary returns {code, message} objects instead of {erro |
| `ReactFlow Node Data Persistence` | Fix silent data loss in ReactFlow editors where elementsToNodes/nodesToElements serialization drops  |
| `referer-based-admin-page-no-password` | Build a low-friction admin UI for internal tools — standalone HTML page served from your domain + se |
| `Responsive shadcn Dialog with Pinned Header/Footer and Scrollable Body` | Make a shadcn (Radix UI) `<DialogContent>` responsive on small viewports — body content scrolls insi |
| `rsync Deploy Protection in a Directory Shared with Human-Managed Files` | Your deploy script rsyncs a repo subtree into a directory that *also* contains files maintained outs |
| `SCADA Real-Time ReactFlow — Complete Debugging Case Study` | 12-issue chain that prevented live PLC tag values from updating ReactFlow HMI elements. Documents ev |
| `SCADA Screen Persistence Pattern` | HMI screens stored in Zustand must persist to database via API — loadScreens on mount, save on creat |
| `SCADA Tag Autocomplete Component` | Inline searchable dropdown for selecting PLC/SCADA tags scoped to the active project — fetches once, |
| `Screenshot-to-Root-Cause Error Diagnosis` | Decode minified React/production errors from browser screenshots — decode error URLs, trace stack tr |
| `Self-Updating Cron Script via Remote Fetch and Atomic Re-Exec` | A long-running cron script installed at `/usr/local/bin/foo.sh` is a frozen snapshot of the day it w |
| `send-to-brain-slack-message-shortcut` | Add a "Send to Brain" message shortcut to a Slack bot so users can right-click any message → ingest  |
| `service-healthy-locally-unreachable-externally-cloud-firewall` | Diagnose a service that works on the host but times out from outside — when the host firewall alread |
| `shared-vps-coexistence` | Operational rules and procedures for safely adding a new product to a busy multi-tenant Linux VPS (H |
| `silent-out-of-scope-no-enumeration` |  |
| `slack-bot-permanent-on-macos-launchd` | Run a Slack bot 24/7 on your Mac without deploying to cloud. Uses @slack/bolt Socket Mode (no inboun |
| `Sliding Window Dedup Guard` | Time-windowed event counting with three dedup layers (memory Map, database query, cooldown period) f |
| `Socket.IO Room Subscription Chain` | Complete the subscribe chain — frontend store must emit subscribe event to server, server must join  |
| `Soft-Delete via hidden Flag for Reversible Dedupe` | Instead of `delete from`, mark duplicate or stale records with `hidden=true` and have every list vie |
| `Split Auth Modal — Sign-In vs Sign-Up Mode` | Single AuthModal component with a `mode` prop that drives distinct UX flows — sign-in rejects new us |
| `ssh-tunnel-to-firewall-blocked-internal-service` | Reach an internal service whose port is blocked by a provider/cloud firewall by forwarding it over a |
| `stateful-cli-as-http-service` | Wrap a stateful or interactive CLI (claude, gh copilot, REPL tools) as an HTTP service. Covers the s |
| `static-file-swap-stable-url` | To replace a document/asset's content without breaking any existing links, share URLs, or database p |
| `Subscription vs Pay-As-You-Go API Key Billing Mismatch (Insufficient-Balance Despite Valid Plan)` | When a SaaS / LLM provider returns "insufficient balance" or 4xx-billing errors despite an active, p |
| `Supabase Owner-Only Storage + RLS for Sensitive Per-User PII` | When a Supabase app needs to store sensitive per-user files (KYC docs, ID cards, medical reports, fi |
| `Supabase Polling Overload — Diagnosis and Fix` | When Supabase shows millions of DB requests from a React app, the cause is almost always cascading R |
| `Supabase SQL → Clipboard Workflow` | When `supabase db push` is blocked by historical unapplied migrations on a linked project, copy each |
| `Supabase Tenant Filtering via Inner Joins` | Use !inner join + dot-notation filtering to scope Supabase queries through related tables for multi- |
| `supabase-multi-tenant-rls-jwt-claims` | Full recipe for multi-tenant SaaS isolation on Supabase using Postgres Row Level Security and JWT cu |
| `supabase-storage-bucket-dashboard-fallback` | `INSERT INTO storage.buckets (...)` in a SQL migration silently fails on hosted Supabase because the |
| `SVG Sanitization with DOMPurify` | Replace regex-based SVG sanitizers with DOMPurify SVG profile — regex is trivially bypassable |
| `svg-icons-html-pdf` |  |
| `template-and-instance-document-pair` |  |
| `three-tier-milestone-hierarchy` |  |
| `Timezone-Aware Hourly Cron Fanout` | Run an hourly cron that uses Intl.DateTimeFormat to check each user's local hour — only deliver to u |
| `Token-Saving Toolkit Install` | One-stop install procedure for the 5 Claude Code tools that cut token / API spend the most — Graphif |
| `Vercel Prebuilt Deploy Workaround` | When Vercel remote builds fail silently (empty error message), build locally with vercel build --pro |
| `vercel-frontend-vps-backend-split` | Topology pattern when the frontend is on Vercel (auto-deploy from GitHub) but the backend (API + DB  |
| `Vite Environment URL Auto-Detection` | Frontend apps deployed to Vercel must auto-detect API/WebSocket URLs for production vs development — |
| `vps-local-claudecode-recovery` | When SSH access to a shared VPS is lost (key wiped, firewall blocked), use the VPS's own locally-ins |
| `weasyprint-rest-api-pdf` | Fetch data from a Supabase REST API with curl (no app running), generate styled A4 PDFs per entity w |
| `WhatsApp Instant Acknowledgment Before Slow Processing` | Send an immediate ack message to the user before kicking off a long-running operation (AI inference, |
| `WhatsApp Personalized Research Before Replying` | Before replying to any BNI member on WhatsApp, research their company, specialty, city, and prior co |
| `WhatsApp Self-Chat Loop — Token Drain Diagnosis` | When LLM balance drains faster than expected on a WhatsApp bot, check for self-chat loop (bot replyi |
| `Worker Read-Only DB Role Pattern` | Background workers (BullMQ, cron, etc.) should read operational data via a dedicated SELECT-only Pos |
| `Z.AI (Zhipu GLM) Provider Config — OpenAI-Compatible Format` | Z.AI (bigmodel.cn / zhipuai.cn) uses OpenAI-compatible /chat/completions API. Setting api type to "a |
| `Z.AI GLM Coding Plan + Claude Code (Anthropic-Compatible Endpoint, Per-Slot Model Mapping)` | Configure Claude Code to use Z.AI's GLM Coding Plan (Lite / Pro / Max subscription) via the Anthropi |
| `Zero Mock, Zero Fallback — Honest Data or Honest Error` | Enforce strict no-mock, no-fallback policy across frontend and backend. API failure shows error, emp |
| `Zero-Hardcode Bottom-Up Integration Protocol` | 5-step mandatory build order for any data-display feature — Backend → Verify → Store → UI → Traceabi |

_Catalog auto-regenerated on every Claude Code session start. Do not edit between the IRONBARK markers, manual edits outside the block are preserved._

<!-- IRONBARK:END -->

## Karpathy Coding Guidelines

> Source: https://github.com/forrestchang/andrej-karpathy-skills
> Derived from Andrej Karpathy's observations on LLM coding pitfalls.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that was not requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes
- Do not improve adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style, even if you would do it differently.
- Only remove imports/variables/functions that YOUR changes made unused.
- Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
- Transform tasks into verifiable goals before starting.
- For multi-step tasks, state a brief plan with a verify step for each.
- Define success criteria concretely — weak criteria require constant clarification.

## SQL goes to the owner's clipboard

The owner applies SQL by pasting it into the Supabase dashboard's SQL editor.
After writing ANY .sql file (migration or one-off fix), hand the full SQL over
ready to paste: on the owner's machine, pipe it to `pbcopy`; in a remote/cloud
session where their clipboard is unreachable, send the file into the chat
instead. Never leave a migration sitting silently in the repo.

## Money paths — read before changing cash, billing or payments

`docs/money-path-rules.md` records seven rules, each written after a real
failure in August 2026: enforce at entry not at commit; never write a child row
in a BEFORE INSERT trigger; rebuild functions from the live database rather than
from a migration file; model the claim AND the release; put anything that can
stop the hospital behind a switch defaulted off; never resolve a ledger by name
alone; never swallow a failed write.

Before and after any such change:

```
npm run check:migrations     # flags the patterns that caused those failures
npm run test:money-paths     # ten checks, each from a real incident
npm run test:loud-failures   # the failed-write reporter itself
```
