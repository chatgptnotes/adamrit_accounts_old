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
  'their-contact@example.com'
);
```

The plaintext key is returned **once** and stored only as a hash. It cannot be
recovered — if it is lost, revoke and reissue:

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

## 3. Stock

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

Expired batches, inactive batches, and batches at zero stock are never returned.
`available_quantity` is what you can actually order; `reserved_quantity` is
already spoken for.

### Staying in sync

**Poll with the watermark.** Keep the `watermark` from your last response and
send it back as `since`:

```
GET /stock?since=2026-08-01T09:14:22.104Z
```

You get only batches that changed after that point. When nothing has changed you
get an empty `items` array and your watermark back — a cheap call for both sides.

**Recommended interval: 60 seconds.** That is 1,440 calls a day and comfortably
inside the rate limit. Do a full sweep without `since` once a day to
self-correct.

If `has_more` is `true`, keep paging with `page=2`, `page=3`… before advancing
your stored watermark.

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

## 4. Ordering

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

## 5. Errors

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

## 6. Getting started

1. Ask for a key. Store it as a server-side environment variable.
2. `GET /medicines` once, and map your item codes to our `medicine_id`.
3. `GET /stock` in full, store the rows and the `watermark`.
4. Poll `GET /stock?since=<watermark>` every 60 seconds; update the watermark
   from each response.
5. Order with `POST /orders`, always sending your own `partner_ref`.
6. Poll `GET /orders?order_id=…` until the status leaves `PENDING`.
