# Billing Email Automation — Feature Documentation

**Module:** Task Optimizer → Billing → Corporate Emails  
**Branch:** `biling-automation`  
**Built:** June 5, 2026  

---

## What This Does

Connects `info@hopehospital.com` Gmail inbox directly into the Adamrit HMS. Staff can:

1. Fetch all incoming corporate/TPA/billing emails with one click
2. View full email body inside the app
3. Review and edit a pre-drafted reply
4. Re-phrase the reply using Gemini AI (4 styles)
5. Approve & Send, or Reject

No server required. All Gmail access happens directly from the browser using OAuth2.

---

## How to Use

### Starting the email check
1. Go to **Task Optimizer → Billing → Corporate Emails**
2. Click **Start Checking Mail**
3. Up to 50 emails are fetched from `info@hopehospital.com`
4. Emails appear in the list — same email is never fetched twice

### Viewing an email
- Click any email card to expand it
- **📧 Full Email** tab — shows sender, subject, complete email body
- **✏️ Draft Reply** tab — shows the pre-written reply, fully editable

### Filtering emails
- **Category chips:** All Categories | TPA | CORPORATE | BILLING | URGENT | GENERAL
- **Status tabs:** Pending | Approved | Rejected | All

### Approving a reply
1. Open email → go to **Draft Reply** tab
2. Edit the reply text if needed
3. Click **Approve & Send** — opens Gmail compose pre-filled with the reply
4. Send from Gmail

### Re-phrasing with AI
1. In Draft Reply tab, click **Re-phrase ▾**
2. Choose a style:
   - 📝 **Standard** — balanced professional tone
   - 🎩 **Formal** — official language, no contractions
   - ⚡ **Brief** — 2–3 sentences only
   - 😊 **Friendly** — warm and approachable
3. Gemini AI rewrites the draft instantly
4. Edit further if needed, then Approve & Send

### Regenerating a draft
- Type optional feedback in the small input (e.g. "add reference number", "mention 24-hour SLA")
- Click **Regenerate** — rebuilds the template with your note prepended

---

## Technical Architecture

```
Browser
  │
  ├── OAuth2 token exchange (silent, no popup)
  │   └── VITE_GMAIL_REFRESH_TOKEN → Google → access_token (55-min cache)
  │
  ├── Gmail API (read-only fetch)
  │   ├── GET /gmail/v1/users/me/messages?maxResults=50
  │   └── GET /gmail/v1/users/me/messages/{id}?format=full
  │
  ├── Keyword classifier → draft reply template
  │
  ├── Gmail API (draft creation)
  │   └── POST /gmail/v1/users/me/drafts  (threaded reply in Drafts folder)
  │
  └── Supabase (admin client, bypasses RLS)
      └── email_inbox table — stores email + draft for app display
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/components/task-optimizer/BillingPanel.tsx` | Main UI — email list, filters, card expand, approve/reject/rephrase |
| `src/components/task-optimizer/useGmailChecker.ts` | Gmail fetch, dedup, draft creation, Gemini re-phrase |
| `src/integrations/supabase/adminClient.ts` | Supabase service-role client (bypasses RLS) |
| `scripts/email-automation/setup-oauth.js` | One-time OAuth2 setup — generates GMAIL_REFRESH_TOKEN |
| `supabase/migrations/20260602200001_create_email_inbox.sql` | DB table schema |
| `supabase/migrations/20260605000001_grant_email_inbox_permissions.sql` | GRANT for anon/authenticated roles |

---

## Environment Variables

```env
# Gmail OAuth (get refresh token by running: node scripts/email-automation/setup-oauth.js)
VITE_GMAIL_CLIENT_ID=557214218983-...apps.googleusercontent.com
VITE_GMAIL_CLIENT_SECRET=GOCSPX-...
VITE_GMAIL_REFRESH_TOKEN=1//0g...
VITE_GMAIL_USER_EMAIL=info@hopehospital.com

# Supabase (for admin writes that bypass RLS)
VITE_SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Gemini (for Re-phrase AI — already used in discharge summary)
# Gemini is called through the server-side /api/ai-proxy route.
GEMINI_API_KEY=managed-server-side
```

---

## Database Table: `email_inbox`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `from_email` | TEXT | Sender email address |
| `from_name` | TEXT | Sender display name |
| `subject` | TEXT | Email subject |
| `body_preview` | TEXT | Full email body (no size limit) |
| `category` | TEXT | `billing`, `corporate`, `tpa`, `urgent`, `general`, `appointment` |
| `urgency` | TEXT | `high`, `medium`, `low` |
| `draft_reply` | TEXT | AI/template-generated reply — editable |
| `status` | TEXT | `pending`, `approved`, `rejected`, `sent` |
| `approved_by` | TEXT | Stores `gmailid:MSG_ID` for dedup; becomes `staff` on approval |
| `approved_at` | TIMESTAMPTZ | When approved |
| `check_date` | DATE | Date the email was fetched |
| `created_at` | TIMESTAMPTZ | Row creation timestamp |

---

## Email Classification Logic

Emails are classified by keyword matching (free, no AI):

| Keywords in subject/body | Category |
|--------------------------|----------|
| tpa, insurance, claim, cashless, mediclaim, echs, cghs, esic | `tpa` |
| corporate, company, empanelled, tie-up | `corporate` |
| bill, invoice, payment, dues, outstanding, discharge | `billing` |
| urgent, emergency, asap, critical | `urgent` |
| everything else | `general` |

---

## Deduplication

Each Gmail message has a permanent unique ID (`msg.id`). This is stored as `gmailid:MSG_ID` in the `approved_by` column on first fetch.

On every subsequent "Start Checking Mail":
- If `gmailid:MSG_ID` found → **skip** (already stored)
- If `body_preview` is shorter than current body → **update** (previously truncated)
- If not found → **insert** as new

This means clicking the button 10 times will never create duplicate entries.

---

## Draft Reply Templates

Templates are pre-built per category. Used as the initial draft on fetch:

| Category | Template summary |
|----------|-----------------|
| `tpa` | TPA/insurance query acknowledged, docs processed within 1 business day |
| `corporate` | Corporate billing query noted, team will follow up in 1 business day |
| `billing` | Billing query received, account under review, reply within 24 hours |
| `urgent` | Escalated to billing manager, immediate attention |
| `general` | Message received, response within 1 business day |

All templates signed: *Hope Hospital Billing Team · info@hopehospital.com*

---

## Known Limitations

- **Gmail account in browser** — the `info@hopehospital.com` link opens Gmail. If it opens the wrong account, check which `/u/N/` index info@hopehospital.com is at in Chrome and update `HOSPITAL_GMAIL` in `BillingPanel.tsx`.
- **50 email limit** — fetches latest 50 messages per check. Older emails require manual date filtering.
- **Body truncation for old emails** — emails fetched before the full-body fix (June 5) have truncated body. Re-clicking "Start Checking Mail" updates them.
- **Approve & Send opens mailto** — the app opens Gmail compose pre-filled. Staff must click Send manually. Nothing is sent automatically.

---

## Re-running OAuth Setup (if token expires)

Run from the project directory:

```bash
node scripts/email-automation/setup-oauth.js
```

A browser tab opens automatically → log in as `info@hopehospital.com` → click Allow → token is saved to `.env` automatically.

**Note:** If you see `Error 403: org_internal` — go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → OAuth consent screen → change User Type to **External** → add test users.
