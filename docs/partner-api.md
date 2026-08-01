# Adamrit Pharmacy Partner API

For an external system that needs to see our medicine stock and order from it.

**Base URL:** `https://www.adamrit.com/api/partner`

Everything is JSON over HTTPS. This is a **server-to-server** API — the key is a
bearer credential with no user behind it, so it must live on your server. Putting
it in browser or mobile-app code publishes it. There are deliberately no CORS
headers, so a browser cannot call these endpoints directly.

---

## 1. Authentication

Send your key on every request:

```
Authorization: Bearer adk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

(`X-API-Key: <key>` also works if your HTTP client makes bearer tokens awkward.)

The key determines which hospital's stock you see. You cannot request another
hospital's data — there is no parameter for it.

Every response carries an `X-Request-Id` header, echoed in the body as
`requestId`. Quote it when reporting a problem.

### Getting a key

Issued by the Adamrit pharmacy administrator from the Supabase SQL editor:

```sql
SELECT public.partner_create_api_key(
  'Partner name',
  'Hope Multi-Specialty Hospital',   -- or 'Ayushman Hospital'
  'their-contact@example.com',
  ARRAY['stock:read','orders:write'],
  60,                                 -- requests per minute
  'https://partner.example.com/adamrit/stock-sync'   -- where we POST the nightly snapshot
);
```

This returns two secrets, both of which the partner needs:

- **`api_key`** — for their calls to us. Stored only as a hash and shown **once**.
- **`sync_secret`** — how they verify our nightly POST really came from us
  (see *The nightly hard refresh*).

Leave the last argument `NULL` if the partner cannot host an inbound endpoint;
they can still pull `GET /stock-snapshot` on their own schedule. To change it
later:

```sql
UPDATE public.partner_api_clients
   SET sync_url = 'https://…', sync_enabled = TRUE
 WHERE key_prefix = 'adk_1234567';
```

Last night's result per partner:

```sql
SELECT status, pages_sent, items_sent, http_status, error, started_at
  FROM public.partner_sync_runs
 ORDER BY started_at DESC LIMIT 20;
```

The API key cannot be recovered — if it is lost, revoke and reissue:

```sql
UPDATE public.partner_api_clients
   SET is_active = FALSE, revoked_at = now()
 WHERE key_prefix = 'adk_1234567';
```

Scopes are `stock:read` and `orders:write`. A read-only integration should be
issued `ARRAY['stock:read']` as the fourth argument.

---

## 2. Units — read this before you map anything

Quantities are in **pieces** (individual tablets, capsules, vials), not packs or
strips. A batch of 10 boxes of 15 tablets is `available_quantity: 150`.

Where a batch records how it was packed, `pieces_per_pack` is returned so you can
convert. It may be `null` on older batches — treat pieces as authoritative.

---

## 3. Two ways stock reaches you

Stock arrives on two tracks, and you need both.

**During the day — only what changed, and you pull it.**
`GET /stock?since=<watermark>` returns only batches that moved since your last
call: one medicine sold, one delivery received. Nothing is pushed to you during
the day. Poll once a minute.

**Once a night — the whole lot, as a hard refresh.**
At about 2 AM IST we POST you the complete stock list in pages. When the last
page arrives, **replace your entire stock table with it**. Anything not in the
snapshot no longer exists. You can also pull the same thing yourself at any time
from `GET /stock-snapshot`.

Why both: the change feed is accurate and cheap and is what keeps you right
during trading hours, but it is only as good as its worst missed message. If your
process is down for an hour, or a poll fails and you move your watermark anyway,
you drift and nothing tells you. The nightly refresh bounds that drift to one
day, whatever went wrong. Do not rely on it as your main path — a full day of
stale figures means orders you cannot fill.

### The one rule that matters: zero means delete

Every stock row carries a `status` and an `available_quantity`:

| `status` | Meaning |
|---|---|
| `available` | Orderable. `available_quantity` is the real figure. |
| `out_of_stock` | Sold down to zero. `available_quantity` is `0`. |
| `expired` | Past its expiry date. `available_quantity` is `0`. |
| `withdrawn` | Deactivated at our end (recall, damage, write-off). `available_quantity` is `0`. |

So your handling of any row from any endpoint is the same: **upsert on
`batch_id`, and if `available_quantity` is `0`, remove the row from your table.**

The change feed deliberately reports batches that have gone to zero rather than
dropping them, because a batch that simply stopped appearing would leave you
holding the last non-zero figure you saw — forever. The catalogue call
(`GET /stock` with no `since`) never contains zero rows, since it only lists what
can be ordered.

---

## 4. Stock

### `GET /stock`

| Parameter | Meaning |
|---|---|
| `since` | ISO timestamp. Return only batches changed after it. |
| `medicine` | Medicine UUID — one medicine only. |
| `search` | Substring of the medicine name (filters the current page only; use `medicine` for an exact filter). |
| `page` | 1-based, default `1`. |
| `limit` | Default `200`, maximum `500`. |

```bash
curl -H "Authorization: Bearer $ADAMRIT_KEY" \
  "https://www.adamrit.com/api/partner/stock?limit=200"
```

```json
{
  "ok": true,
  "items": [
    {
      "batch_id": "6f1c…",
      "medicine_id": "b2a9…",
      "medicine_name": "Amoxicillin 500mg",
      "generic_name": "Amoxicillin",
      "batch_number": "AMX2402",
      "expiry_date": "2027-03-31",
      "status": "available",
      "available_quantity": 480,
      "reserved_quantity": 30,
      "pieces_per_pack": 10,
      "selling_price": 8.5,
      "mrp": 11.0,
      "gst": 12.0,
      "updated_at": "2026-08-01T09:14:22.104Z"
    }
  ],
  "page": 1,
  "limit": 200,
  "has_more": false,
  "watermark": "2026-08-01T09:14:22.104Z",
  "hospital": "Hope Multi-Specialty Hospital",
  "unit": "pieces"
}
```

Without `since` this is the **catalogue**: only what can be ordered right now.
Expired, inactive and zero-stock batches are not in it, and every row has
`status: "available"`. `available_quantity` is what you can order;
`reserved_quantity` is already spoken for by someone else.

### The change feed — `GET /stock?since=`

Keep the `watermark` from your last response and send it back:

```
GET /stock?since=2026-08-01T09:14:22.104Z
```

You get only batches that changed after that point. When nothing has changed you
get an empty `items` array and your watermark back — a cheap call for both sides.

**With `since`, the response also includes batches that are no longer
orderable**, so you learn when something empties:

```json
{
  "batch_id": "6f1c…",
  "medicine_id": "b2a9…",
  "medicine_name": "Amoxicillin 500mg",
  "batch_number": "AMX2402",
  "status": "out_of_stock",
  "available_quantity": 0,
  "updated_at": "2026-08-01T11:02:47.900Z"
}
```

Delete that batch from your table. See *zero means delete* above.

**Recommended interval: 60 seconds.** That is 1,440 calls a day and comfortably
inside the rate limit.

If `has_more` is `true`, keep paging with `page=2`, `page=3`… **before** advancing
your stored watermark. Advancing it early skips everything you did not read.

---

## 5. The nightly hard refresh

### What we send you

Set up an HTTPS endpoint and give us the URL. At about **02:00 IST** we POST the
complete stock list to it, in pages of up to 1,000 items:

```json
{
  "snapshot_id": "3f0a…",
  "snapshot_at": "2026-08-02T20:30:00.000Z",
  "hospital": "Hope Multi-Specialty Hospital",
  "page": 1,
  "total_pages": 4,
  "total_items": 3480,
  "is_last": false,
  "unit": "pieces",
  "items": [ … ]
}
```

Headers on every page:

| Header | Meaning |
|---|---|
| `X-Adamrit-Signature` | `sha256=<hex>` — HMAC-SHA256 of the **raw request body** using your `sync_secret`. |
| `X-Adamrit-Snapshot-Id` | Same as `snapshot_id` in the body. |

**Verify the signature before trusting the payload.** Compute the HMAC over the
raw body bytes (before any JSON parsing) and compare with a constant-time
comparison. Node example:

```js
const expected = crypto.createHmac('sha256', SYNC_SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(
  Buffer.from(req.headers['x-adamrit-signature']),
  Buffer.from(`sha256=${expected}`),
);
```

**Buffer the pages, keyed by `snapshot_id`. Only when you receive `is_last: true`
should you replace your stock table.** If a page fails we stop sending and mark
the run failed, so an incomplete snapshot never arrives with `is_last` — you keep
yesterday's data rather than a truncated table.

Respond `2xx` as soon as you have stored the page. We retry a page up to three
times on `5xx`, `408`, `429` and network errors, with backoff. A `4xx` other than
those we treat as a rejection and stop.

Afterwards, resume polling from `snapshot_at`:
`GET /stock?since=<snapshot_at>` — no gap between the refresh and the next delta.

### Pulling it yourself — `GET /stock-snapshot`

The same content, on your schedule. Useful after a failed night, or instead of
receiving our push if you cannot host an inbound endpoint.

```bash
curl -H "Authorization: Bearer $ADAMRIT_KEY" \
  "https://www.adamrit.com/api/partner/stock-snapshot?page=1&limit=500"
```

The response has the same envelope (`snapshot_id`, `snapshot_at`, `page`,
`total_pages`, `is_last`, `items`). Page until `is_last` is `true`, passing
`snapshot_id` and `snapshot_at` back on each subsequent page so all pages of one
snapshot agree:

```
GET /stock-snapshot?page=2&limit=500&snapshot_id=3f0a…&snapshot_at=2026-08-02T20:30:00.000Z
```

`limit` defaults to 500, maximum 1,000. Like the push, it contains only
currently-orderable stock — there are no zero rows, because you are replacing
your table wholesale.

### `GET /medicines`

The catalogue, for mapping your item codes to our `medicine_id` once. Parameters:
`search`, `page`, `limit`.

```json
{
  "ok": true,
  "items": [
    { "medicine_id": "b2a9…", "medicine_name": "Amoxicillin 500mg",
      "generic_name": "Amoxicillin", "type": "Tablet", "mrp": 11.0, "selling_price": 8.5 }
  ],
  "page": 1, "limit": 200, "has_more": true
}
```

---

## 6. Ordering

### `POST /orders`

```bash
curl -X POST -H "Authorization: Bearer $ADAMRIT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "partner_ref": "SO-2026-0912",
        "items": [
          { "medicine_id": "b2a9…", "quantity": 30 },
          { "medicine_id": "c7d1…", "quantity": 100 }
        ],
        "notes": "For Tuesday clinic"
      }' \
  https://www.adamrit.com/api/partner/orders
```

`partner_ref` is your own order id. Always send it — see *Retrying safely* below.
Maximum 200 line items per order.

**`201 Created`** — the order is placed and the stock is reserved:

```json
{
  "ok": true,
  "order_id": "9a3f…",
  "order_number": "PORD-260801-0007",
  "partner_ref": "SO-2026-0912",
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

Batches are allocated **first-expiry-first-out**, so one requested medicine can
come back as several lines with different batch numbers and expiry dates. Those
are the batches you will physically receive.

**`409 Conflict`** — at least one line cannot be filled:

```json
{
  "ok": false,
  "error": "insufficient_stock",
  "shortfalls": [
    { "medicine_id": "c7d1…", "medicine_name": "Pantoprazole 40mg",
      "requested": 100, "available": 60, "short_by": 40 }
  ],
  "requestId": "…"
}
```

**Orders are all-or-nothing.** On a 409 nothing at all is reserved — not even the
lines that would have succeeded. Reduce the quantity, or split the order, and try
again.

### What happens to our stock

1. **You order** → the quantity leaves available stock immediately and sits in
   reserve. Our pharmacy counter can no longer sell it. Order status `PENDING`.
2. **Our staff confirm and dispatch** → booked as sold. Status `DISPATCHED`.
3. **Our staff reject**, or **you cancel** → the quantity goes straight back into
   available stock. Status `REJECTED` / `CANCELLED`.

So a successful `POST /orders` is a firm hold, not a request. Do not place
speculative orders — cancel promptly if your plans change.

### Retrying safely

If a request times out and you do not know whether it landed, **retry with the
same `partner_ref`**. You get the original order back with `"duplicate": true`
and `200` instead of `201`, and nothing is reserved twice. Without a
`partner_ref` a retry creates a second order and reserves the stock again.

### `GET /orders`

Your orders, newest first. Optional `?status=PENDING|DISPATCHED|REJECTED|CANCELLED`.

### `GET /orders?order_id=<uuid>`

One order with its allocated batches — poll this to see when an order is
dispatched. Once a minute is plenty.

### `POST /order-cancel`

```json
{ "order_id": "9a3f…", "reason": "Clinic postponed" }
```

Only while the order is still `PENDING`. Once it is `DISPATCHED` the medicine has
left the building, and you get `409 not_pending`.

---

## 7. Errors

Every failure has the same shape:

```json
{ "ok": false, "error": "insufficient_stock", "requestId": "…" }
```

| Status | `error` | What to do |
|---|---|---|
| 400 | `invalid_request` | Fix the body — `details` names the bad fields. |
| 401 | `api_key_required` | Add the `Authorization` header. |
| 401 | `invalid_api_key` | Key is wrong, inactive, or revoked. Contact us. |
| 403 | `scope_not_granted` | Your key lacks that permission. |
| 404 | `order_not_found` | Not your order, or the id is wrong. |
| 409 | `insufficient_stock` | See `shortfalls`, reduce and retry. |
| 409 | `not_pending` | Order already dispatched or closed. |
| 429 | `rate_limited` | Wait for `Retry-After` (60s). |
| 502 | `*_failed` | Our end. Retry once with backoff, then contact us. |

**Rate limit: 60 requests per minute per key** by default, counted across all
endpoints. At the recommended one-poll-a-minute this leaves plenty of headroom
for ordering. Ask us if you need it raised — do not work around it by rotating
keys.

Retry `429` and `502` with exponential backoff. Never retry `400`, `401`, `403`,
or `409` unchanged; they will fail identically.

---

## 8. Getting started

1. Ask for a key. Store `api_key` and `sync_secret` as server-side environment
   variables. Tell us the URL for the nightly push, or say you would rather pull.
2. `GET /medicines` once, and map your item codes to our `medicine_id`.
3. `GET /stock-snapshot`, page until `is_last`, and load the rows. Keep
   `snapshot_at`.
4. Poll `GET /stock?since=<watermark>` every 60 seconds, starting from
   `snapshot_at`. Upsert on `batch_id`; **delete any row whose
   `available_quantity` is `0`**. Update the watermark from each response.
5. Handle our nightly POST: verify `X-Adamrit-Signature`, buffer pages by
   `snapshot_id`, and on `is_last: true` replace your stock table and reset your
   watermark to `snapshot_at`.
6. Order with `POST /orders`, always sending your own `partner_ref`.
7. Poll `GET /orders?order_id=…` until the status leaves `PENDING`.
