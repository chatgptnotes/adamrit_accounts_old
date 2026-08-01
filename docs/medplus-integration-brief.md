# Build Brief: Adamrit Pharmacy Integration

**This document is written for the engineer or coding agent building the MedPlus
side of this integration.** Follow it in order. Every endpoint, field name and
status code here matches the live API exactly — do not guess field names, and do
not invent parameters that are not listed.

---

## 0. Your objective

Mirror Adamrit's Hope Hospital pharmacy stock into the MedPlus database, keep
that mirror current throughout the day, and place orders against it.

Three moving parts:

1. **A one-time load** — pull the full stock list and store it.
2. **A poll loop** — every 60 seconds, fetch only what changed and apply it.
3. **Ordering** — reserve stock, then track the order until Adamrit's staff
   dispatch or reject it.

There is also an optional nightly full refresh (§7) that repairs any drift.

**Read §8 (Rules) and §9 (Do not do these) before writing code.** Most of the
ways this integration goes wrong are silent — the code appears to work while the
stock figures quietly diverge from reality.

---

## 1. Configuration

You will be given two secrets. Put both in server-side environment variables:

```
ADAMRIT_BASE_URL=https://www.adamrit.com/api/partner
ADAMRIT_API_KEY=adk_...        # sent on every request you make
ADAMRIT_SYNC_SECRET=ads_...    # only for §7; verifies their nightly push
```

Authentication is a bearer token on every request:

```
Authorization: Bearer <ADAMRIT_API_KEY>
```

`X-API-Key: <key>` is accepted as an alternative if bearer tokens are awkward in
your HTTP client.

**This is a server-to-server API.** The key is a bearer credential with no user
behind it. It must never reach browser JavaScript, a mobile app bundle, or any
client-side code. There are no CORS headers, so a browser cannot call these
endpoints regardless.

The key is scoped to one hospital. There is no parameter to request a different
one.

---

## 2. Local schema

Create these tables. The SQL is portable across MySQL 8 and PostgreSQL; adjust
types if your database differs.

```sql
-- The stock mirror. One row per BATCH, not per medicine: the same medicine
-- exists in several batches with different expiry dates and prices, and orders
-- are fulfilled from specific batches.
CREATE TABLE adamrit_stock (
  batch_id            VARCHAR(64)  NOT NULL,   -- their UUID. Primary key. Stable.
  medicine_id         VARCHAR(64)  NOT NULL,   -- what you quote when ordering
  medicine_name       VARCHAR(255),
  generic_name        VARCHAR(255),
  batch_number        VARCHAR(100),
  expiry_date         DATE,
  available_quantity  INT          NOT NULL DEFAULT 0,  -- in PIECES, see §8.4
  reserved_quantity   INT          NOT NULL DEFAULT 0,  -- held for someone else
  pieces_per_pack     INT          NULL,
  selling_price       DECIMAL(10,2),
  mrp                 DECIMAL(10,2),
  gst                 DECIMAL(5,2),
  source_updated_at   TIMESTAMP    NULL,       -- THEIR updated_at, not yours
  synced_at           TIMESTAMP    NULL,       -- when you last wrote this row
  PRIMARY KEY (batch_id)
);

CREATE INDEX idx_adamrit_stock_medicine ON adamrit_stock (medicine_id);
CREATE INDEX idx_adamrit_stock_expiry   ON adamrit_stock (expiry_date);

-- Single-row table holding your position in their change feed.
-- The watermark is the whole reason polling stays cheap: lose it and you have
-- to re-download everything.
CREATE TABLE adamrit_sync_state (
  id                 INT          NOT NULL DEFAULT 1,
  watermark          VARCHAR(64)  NULL,   -- ISO timestamp from their response
  last_poll_at       TIMESTAMP    NULL,
  last_poll_ok       BOOLEAN      NULL,
  last_full_sync_at  TIMESTAMP    NULL,
  consecutive_errors INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CHECK (id = 1)
);

INSERT INTO adamrit_sync_state (id) VALUES (1);

-- Your item codes against their medicine_id. Built once in Task 1.
CREATE TABLE adamrit_medicine_map (
  medicine_id     VARCHAR(64)  NOT NULL,   -- theirs
  medicine_name   VARCHAR(255),
  generic_name    VARCHAR(255),
  local_item_code VARCHAR(64)  NULL,       -- yours; NULL until mapped
  mapped_at       TIMESTAMP    NULL,
  PRIMARY KEY (medicine_id)
);

-- Orders you placed.
CREATE TABLE adamrit_orders (
  partner_ref   VARCHAR(120) NOT NULL,   -- YOUR order number. Primary key. See §8.2
  order_id      VARCHAR(64)  NULL,       -- theirs, returned on success
  order_number  VARCHAR(64)  NULL,       -- theirs, human-readable e.g. PORD-260801-0007
  status        VARCHAR(20)  NOT NULL,   -- PENDING | DISPATCHED | CANCELLED | REJECTED
  total_amount  DECIMAL(15,2),
  requested_at  TIMESTAMP    NULL,
  confirmed_at  TIMESTAMP    NULL,
  closed_reason TEXT         NULL,
  PRIMARY KEY (partner_ref)
);

-- What each order was actually filled from. Note there is NO batch_id here:
-- their order response identifies batches by batch_number and expiry_date only.
CREATE TABLE adamrit_order_items (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,  -- BIGSERIAL on PostgreSQL
  partner_ref   VARCHAR(120) NOT NULL,
  medicine_id   VARCHAR(64),
  medicine_name VARCHAR(255),
  batch_number  VARCHAR(100),
  expiry_date   DATE,
  quantity      INT,
  unit_price    DECIMAL(10,2),
  line_amount   DECIMAL(15,2)
);
```

---

## 3. Task 1 — Map the medicine catalogue

Run once at setup, then monthly.

```
page = 1
loop:
  GET {BASE}/medicines?page={page}&limit=500
  upsert each item into adamrit_medicine_map keyed on medicine_id
  if response.has_more is false: stop
  page = page + 1
```

Response item shape:

```json
{ "medicine_id": "b2a9…", "medicine_name": "Amoxicillin 500mg",
  "generic_name": "Amoxicillin", "type": "Tablet",
  "mrp": 11.0, "selling_price": 8.5 }
```

Then populate `local_item_code` by whatever matching process you use — automatic
on name, or a human reviewing a list. **Every order you place quotes their
`medicine_id`**, so an unmapped medicine is one you cannot order.

---

## 4. Task 2 — Initial full load

```
snapshot_id = null
snapshot_at = null
page = 1

loop:
  url = {BASE}/stock-snapshot?page={page}&limit=500
  if snapshot_id: url += "&snapshot_id={snapshot_id}&snapshot_at={snapshot_at}"
  response = GET url

  snapshot_id = response.snapshot_id      # capture from the FIRST page
  snapshot_at = response.snapshot_at      # and pass it back on every later page

  for each item in response.items:
      upsert into adamrit_stock keyed on batch_id

  if response.is_last is true: stop
  page = page + 1

# The snapshot timestamp becomes your polling start point. No gap.
UPDATE adamrit_sync_state
   SET watermark = snapshot_at, last_full_sync_at = NOW()
 WHERE id = 1;
```

Passing `snapshot_id` and `snapshot_at` back on later pages is what keeps all
pages part of one coherent snapshot. Omitting them starts a new snapshot on every
page.

The snapshot contains **only orderable stock**. There are no zero-quantity rows
in it — that is expected. It is a replacement, not a delta.

---

## 5. Task 3 — The poll loop (the important one)

Run every **60 seconds**.

```
watermark = SELECT watermark FROM adamrit_sync_state WHERE id = 1

if watermark is null:
    run Task 2 instead    # nothing to poll from yet

page = 1
newest = watermark

loop:
  response = GET {BASE}/stock?since={watermark}&page={page}&limit=200

  for each item in response.items:
      if item.available_quantity == 0:
          DELETE FROM adamrit_stock WHERE batch_id = item.batch_id
      else:
          upsert into adamrit_stock (batch_id, …, source_updated_at = item.updated_at)

      if item.updated_at > newest:
          newest = item.updated_at

  if response.has_more is false: break
  page = page + 1                     # SAME watermark, next page

# Only AFTER every page has been applied:
UPDATE adamrit_sync_state
   SET watermark = newest, last_poll_at = NOW(), last_poll_ok = true,
       consecutive_errors = 0
 WHERE id = 1;
```

### Why each step is written that way

**`available_quantity == 0` means delete.** Every row carries a `status` field:

| `status` | Meaning | `available_quantity` |
|---|---|---|
| `available` | Orderable | the real figure |
| `out_of_stock` | Sold down to zero | `0` |
| `expired` | Past expiry date | `0` |
| `withdrawn` | Recalled / written off at their end | `0` |

The change feed deliberately reports batches that have gone to zero instead of
dropping them from the response. If you skip these rows, that batch stays in your
table at its last non-zero quantity **forever** — your system will show stock
that does not exist, and you will place orders that get rejected. Checking
`available_quantity == 0` is sufficient; you do not need to branch on `status`,
though it is useful to log.

**Never advance the watermark before paging is finished.** If `has_more` is true
and you save the watermark from page 1, pages 2+ are skipped permanently — those
changes are never offered again. Page to the end first, then save.

**On any error, do not advance the watermark.** Increment
`consecutive_errors`, leave the watermark alone, and let the next run retry the
same window. Re-reading a change is harmless because every write is an upsert
keyed on `batch_id`. Skipping one is not recoverable.

**An empty `items` array is the normal, healthy answer.** It means nothing has
changed since your last poll. It is not an error and not a reason to fall back to
a full sync.

---

## 6. Task 4 — Ordering

### Placing an order

```http
POST {BASE}/orders
Authorization: Bearer <key>
Content-Type: application/json

{
  "partner_ref": "MP-2026-0912",
  "items": [
    { "medicine_id": "b2a9…", "quantity": 30 },
    { "medicine_id": "c7d1…", "quantity": 100 }
  ],
  "notes": "optional free text"
}
```

Maximum 200 line items. Quantities are whole numbers of pieces.

**Generate `partner_ref` yourself and write it to `adamrit_orders` BEFORE
sending the request.** It is your idempotency key. If the request times out and
you do not know whether it landed, resend the identical request with the same
`partner_ref`: you get the original order back with `"duplicate": true` and HTTP
`200` instead of `201`, and no stock is reserved twice. Without it, a retry
places a second real order.

### Responses

**`201 Created`** — order placed, stock is now held for you:

```json
{
  "ok": true,
  "order_id": "9a3f…",
  "order_number": "PORD-260801-0007",
  "partner_ref": "MP-2026-0912",
  "status": "PENDING",
  "total_amount": 1105.00,
  "requested_at": "2026-08-01T09:20:11.882Z",
  "items": [
    { "medicine_id": "b2a9…", "medicine_name": "Amoxicillin 500mg",
      "batch_number": "AMX2402", "expiry_date": "2027-03-31",
      "quantity": 30, "unit_price": 8.5, "mrp": 11.0, "line_amount": 255.00 }
  ]
}
```

One requested medicine may come back as **several item rows** with different
batch numbers — Adamrit allocates from the earliest-expiring batches first, so a
single line can span batches. Those are the batches you will physically receive.
Note these item objects carry `quantity` and `line_amount` and **no `batch_id`**;
they are a different shape from stock rows.

**`200 OK` with `"duplicate": true`** — this `partner_ref` was already used. This
is the safe retry outcome. Treat it as success; do not re-send.

**`409 Conflict`** — at least one line cannot be filled:

```json
{ "ok": false, "error": "insufficient_stock",
  "shortfalls": [
    { "medicine_id": "c7d1…", "medicine_name": "Pantoprazole 40mg",
      "requested": 100, "available": 60, "short_by": 40 } ] }
```

**Orders are all-or-nothing.** On a 409, *nothing* was reserved — not even the
lines that would have succeeded. Reduce the quantities using `shortfalls` and
submit as a **new** `partner_ref`. Do not retry the same one unchanged.

### What happens after you order

The moment your order succeeds, the quantity leaves Adamrit's available stock and
is held for you — their own pharmacy counter can no longer sell it. Their staff
then either dispatch it or reject it.

Because your order holds real stock that nobody else can sell, **do not place
speculative orders.** Cancel promptly if your plans change.

Poll for the outcome:

```
GET {BASE}/orders?order_id=9a3f…
```

once a minute until `status` is no longer `PENDING`:

- `DISPATCHED` — sent to you and booked as sold
- `REJECTED` — Adamrit's staff declined it; stock returned to their shelf
- `CANCELLED` — you withdrew it

To withdraw while still `PENDING`:

```http
POST {BASE}/order-cancel
{ "order_id": "9a3f…", "reason": "Clinic postponed" }
```

Once `DISPATCHED`, cancelling returns `409 not_pending` — the medicine has
physically left, and that is a phone call, not an API request.

---

## 7. Task 5 — Nightly full refresh (optional but recommended)

A full snapshot once a night bounds your drift to one day, whatever goes wrong
during it: a crashed poller, an hour of downtime, a watermark advanced by mistake.

### Option A — pull it yourself

Schedule Task 2 (§4) once a night. Replace the contents of `adamrit_stock` with
what you receive, then set `watermark = snapshot_at`. Nothing to coordinate with
Adamrit. **This is the simpler option and needs nothing from them.**

### Option B — receive their push

Give Adamrit an HTTPS endpoint. At about 02:00 IST they POST the full list to it
in pages of up to 1,000 items:

```json
{ "snapshot_id": "3f0a…", "snapshot_at": "2026-08-02T20:30:00.000Z",
  "hospital": "Hope Multi-Specialty Hospital",
  "page": 1, "total_pages": 4, "total_items": 3480,
  "is_last": false, "unit": "pieces", "items": [ … ] }
```

Headers: `X-Adamrit-Signature: sha256=<hex>` and `X-Adamrit-Snapshot-Id`.

**Verify the signature before parsing or trusting the body.** It is an
HMAC-SHA256 of the **raw request body bytes**, computed with your
`ADAMRIT_SYNC_SECRET`. Compute it over the raw body *before* JSON parsing — a
parse-and-re-serialise round trip changes the bytes and the signature will never
match. Compare in constant time.

```js
const expected = crypto.createHmac('sha256', SYNC_SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(
  Buffer.from(req.headers['x-adamrit-signature']),
  Buffer.from(`sha256=${expected}`),
);
if (!ok) return res.status(401).end();
```

**Buffer pages keyed by `snapshot_id`. Only when `is_last: true` arrives do you
replace your stock table.** If a page fails, Adamrit stops sending and marks the
run failed — so an incomplete snapshot never arrives with `is_last`, and you keep
yesterday's data rather than a table with three-quarters of the medicines
missing. Applying pages as they arrive defeats this protection entirely.

Respond `2xx` as soon as the page is stored. They retry a page up to three times
on `5xx`, `408`, `429` and network errors. Any other `4xx` is treated as a
rejection and the run stops.

Afterwards set `watermark = snapshot_at` and resume normal polling.

---

## 8. Rules you must not break

1. **Zero means delete.** A row with `available_quantity: 0` must be removed from
   your table. Ignoring these rows makes your stock permanently wrong, and does
   so silently. (§5)
2. **Always send `partner_ref`, and persist it before the request.** It is the
   only thing preventing a network timeout from placing two real orders. (§6)
3. **Page to the end before saving the watermark.** Saving early skips changes
   that are never offered again. (§5)
4. **Quantities are pieces, never packs.** Individual tablets, capsules or vials.
   10 boxes of 15 tablets is `150`. `pieces_per_pack` is provided where known but
   is sometimes `null` — pieces are always authoritative. Getting this wrong by a
   factor of 10 or 15 is the single most expensive mistake available here.
5. **The API key stays server-side.** Never in browser code, mobile bundles, or a
   repository.
6. **`batch_id` is your primary key for stock**, not `medicine_id`. One medicine
   has many batches with different expiries and prices.
7. **Never advance the watermark after a failed poll.** Re-reading is harmless;
   skipping is not.

---

## 9. Do not do these

Each of these is a mistake that looks like working code:

- **Do not fetch the full stock list on every poll.** Always send `since`. The
  full list is for the initial load and the nightly refresh only. Polling the
  whole table every minute will hit the rate limit and puts needless load on
  Adamrit's database.
- **Do not poll faster than once a minute.** The limit is 60 requests per minute
  across *all* endpoints, and your ordering calls share that budget. Faster
  polling gains you nothing — stock does not change that fast.
- **Do not skip rows where `available_quantity` is 0.** See rule 1. This is the
  most common way this integration silently breaks.
- **Do not retry a `409 insufficient_stock` with the same request.** It will fail
  identically. Read `shortfalls`, reduce, and use a **new** `partner_ref`.
- **Do not retry `400`, `401` or `403`.** These are your bug or your credentials;
  retrying wastes your rate-limit budget.
- **Do not treat an empty `items` array as a failure.** It is the normal answer
  when nothing has changed.
- **Do not apply nightly push pages as they arrive.** Buffer until `is_last`. (§7)
- **Do not parse the body before verifying the HMAC signature.** (§7)
- **Do not store `medicine_id` as your only stock key.** You will collapse
  multiple batches into one row and lose expiry tracking.

---

## 10. Acceptance tests

Run all of these against the live API before declaring the integration complete.

| # | Test | Expected result |
|---|---|---|
| 1 | `GET /stock?limit=5` with a valid key | `200`, rows with `status: "available"` and non-zero quantities |
| 2 | `GET /stock` with no `Authorization` header | `401 api_key_required` |
| 3 | Run Task 1 to completion | `adamrit_medicine_map` populated; `has_more` reached `false` |
| 4 | Run Task 2 to completion | `is_last: true` reached; `adamrit_stock` row count equals the final `total_items`; watermark set |
| 5 | Poll immediately after Task 2 | `items` empty, `has_more` false — no spurious changes |
| 6 | Ask Adamrit to sell one batch to zero, then poll | That `batch_id` arrives with `available_quantity: 0` and `status: "out_of_stock"`, **and your code deletes the row** |
| 7 | Place a small order | `201`, `status: "PENDING"`, items reference real batch numbers |
| 8 | Immediately resend the exact same request | `200` with `"duplicate": true`; **exactly one row** in `adamrit_orders`; the stock was not held twice |
| 9 | Order a quantity far larger than available | `409 insufficient_stock` with `shortfalls`; poll afterwards and confirm no stock changed |
| 10 | Cancel the pending order from test 7, then poll | Order becomes `CANCELLED`; the batches' quantities return to their previous values |
| 11 | Kill the poller for 10 minutes, restart it | It resumes from the stored watermark and catches up; no full re-download |
| 12 | Corrupt the signature on a test nightly push (if using §7 Option B) | Request rejected with `401`; nothing written |

Test 6 and test 8 are the two that matter most. Test 6 is the failure mode that
makes your stock silently wrong; test 8 is the one that silently double-orders.

---

## 11. Reference

**Base URL:** `https://www.adamrit.com/api/partner`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/medicines` | Catalogue. `search`, `page`, `limit` (max 500) |
| `GET` | `/stock` | Catalogue without `since`; change feed with it. Also `medicine`, `search`, `page`, `limit` (max 500) |
| `GET` | `/stock-snapshot` | Full snapshot. `page`, `limit` (max 1000), `snapshot_id`, `snapshot_at` |
| `POST` | `/orders` | Place an order |
| `GET` | `/orders` | List your orders. Optional `status` |
| `GET` | `/orders?order_id=` | One order with its allocated batches |
| `POST` | `/order-cancel` | Withdraw a `PENDING` order |

### Stock row

```json
{ "batch_id": "6f1c…", "medicine_id": "b2a9…",
  "medicine_name": "Amoxicillin 500mg", "generic_name": "Amoxicillin",
  "batch_number": "AMX2402", "expiry_date": "2027-03-31",
  "status": "available", "available_quantity": 480, "reserved_quantity": 30,
  "pieces_per_pack": 10, "selling_price": 8.5, "mrp": 11.0, "gst": 12.0,
  "updated_at": "2026-08-01T09:14:22.104Z" }
```

`/stock` responses also carry `page`, `limit`, `has_more`, `watermark`,
`hospital` and `unit`.

### Errors

Every failure has the same envelope:

```json
{ "ok": false, "error": "insufficient_stock", "requestId": "…" }
```

Every response carries an `X-Request-Id` header, echoed as `requestId`. **Log it
on every failure** and quote it to Adamrit when reporting a problem — they can
find the exact request.

| Status | `error` | Retry? |
|---|---|---|
| 400 | `invalid_request` | No — fix the body. `details` names the bad fields |
| 400 | `invalid_since` | No — your `since` was not a valid timestamp. Carries `hint`, not `details` |
| 400 | `no_items` / `bad_quantity` / `order_rejected` | No — the order body was rejected: empty items, or a quantity of zero or less |
| 400 | `bad_status` / `cancel_rejected` | No — cancel request rejected |
| 401 | `api_key_required` / `invalid_api_key` | No — check credentials |
| 403 | `scope_not_granted` | No — your key lacks that permission |
| 404 | `order_not_found` | No — not your order, or wrong id |
| 405 | `method_not_allowed` | No — wrong HTTP verb for that path |
| 409 | `insufficient_stock` | No — reduce and use a new `partner_ref` |
| 409 | `not_pending` | No — already dispatched or closed |
| 429 | `rate_limited` | Yes — wait for `Retry-After` (60s) |
| 500 | `supabase_not_configured` | Yes, once — then report it |
| 502 | `*_failed` | Yes — exponential backoff, then report it |

Treat any unrecognised `error` string as non-retryable and log it with its
`requestId`. Do not branch on the exact string beyond the retry decision — new
values may be added.

Rate limit: **60 requests per minute**, shared across every endpoint.

---

## 12. Suggested build order

1. Schema (§2), config, and a thin HTTP client that sets the auth header, logs
   `requestId` on failure, and honours `Retry-After` on `429`.
2. Task 1 (§3) — catalogue. Smallest endpoint, proves the credentials work.
3. Task 2 (§4) — initial load. Proves pagination.
4. Task 3 (§5) — poll loop. **Get the zero-means-delete branch right first.**
5. Task 4 (§6) — ordering, with `partner_ref` persisted before the call.
6. Acceptance tests (§10), all twelve.
7. Task 5 (§7) — nightly refresh. Start with Option A (pull); it needs nothing
   from Adamrit.

The full contract reference is `partner-api.md`. Where this brief and that
document disagree, that document is authoritative — report the discrepancy.
