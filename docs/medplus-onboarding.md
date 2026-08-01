# MedPlus ↔ Adamrit Pharmacy — Getting Connected

This is the short version, specific to your setup. The full reference is
`partner-api.md`, which you should read before writing any code.

---

## What you have been given

| | |
|---|---|
| **Base URL** | `https://www.adamrit.com/api/partner` |
| **`api_key`** | starts `adk_…` — sent on every request you make to us |
| **`sync_secret`** | starts `ads_…` — used to verify the nightly file we send you |
| **Stock you can see** | Hope Multi-Specialty Hospital |
| **Permissions** | read stock, place orders |
| **Rate limit** | 60 requests per minute |

Both secrets go in **server-side environment variables**. This is a
server-to-server API: the key is a bearer credential with no user behind it, so
putting it in browser JavaScript or a mobile app publishes it. There are no CORS
headers, so a browser cannot call these endpoints anyway.

The `api_key` is stored at our end only as a hash. We cannot read it back to you
— if it is lost, we revoke it and issue a new one.

---

## Step 1 — Map our medicines to yours, once

```bash
curl -H "Authorization: Bearer $ADAMRIT_KEY" \
  "https://www.adamrit.com/api/partner/medicines?limit=500"
```

Store our `medicine_id` against your own item codes. Every order you place refers
to medicines by our `medicine_id`, so this mapping is the foundation of the
integration. Page with `?page=2`, `?page=3`… while `has_more` is `true`.

## Step 2 — Load the full stock list

```bash
curl -H "Authorization: Bearer $ADAMRIT_KEY" \
  "https://www.adamrit.com/api/partner/stock-snapshot?page=1&limit=500"
```

Page until `is_last` is `true`, passing `snapshot_id` and `snapshot_at` back on
each later page so all pages belong to one snapshot:

```
…/stock-snapshot?page=2&limit=500&snapshot_id=<id>&snapshot_at=<timestamp>
```

**Keep `snapshot_at`.** It is where your polling starts in step 3.

## Step 3 — Poll for changes, once a minute

```bash
curl -H "Authorization: Bearer $ADAMRIT_KEY" \
  "https://www.adamrit.com/api/partner/stock?since=2026-08-01T09:14:22.104Z"
```

Start with `since=<snapshot_at>` from step 2. Each response carries a
`watermark`; send that back as `since` next time. When nothing has changed you
get an empty list — that is normal and costs almost nothing.

If `has_more` is `true`, page through **before** advancing your stored watermark.
Advancing early permanently skips whatever you did not read.

## Step 4 — Place orders

```bash
curl -X POST -H "Authorization: Bearer $ADAMRIT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "partner_ref": "MP-2026-0912",
        "items": [ { "medicine_id": "<uuid>", "quantity": 30 } ]
      }' \
  https://www.adamrit.com/api/partner/orders
```

The moment this succeeds, the quantity is **held for you** — it leaves the
hospital's available stock and their own counter can no longer sell it. Hospital
staff then dispatch or reject the order. Poll
`GET /orders?order_id=<id>` until the status leaves `PENDING`.

Because ordering holds real stock, do not place speculative orders. Cancel with
`POST /order-cancel` if your plans change while it is still `PENDING`.

---

## The two rules that will break your integration if you miss them

### 1. Zero means delete

Every stock row has a `status` and an `available_quantity`. When a batch sells
out, expires, or is withdrawn, we send it to you with `available_quantity: 0` —
we do **not** silently stop mentioning it.

```json
{ "batch_id": "6f1c…", "status": "out_of_stock", "available_quantity": 0 }
```

So one rule handles every row from every endpoint: **upsert on `batch_id`, and if
`available_quantity` is `0`, delete the row.** If you ignore zero rows, your
system will keep showing stock that no longer exists.

### 2. Always send `partner_ref`

`partner_ref` is your own order number. If a request times out and you do not
know whether it landed, **retry with the same `partner_ref`** — you get the
original order back with `"duplicate": true`, and nothing is held twice. Without
it, a retry creates a second order and holds the stock again.

---

## Orders are all-or-nothing

If any line cannot be filled in full you get `409` and **nothing at all is
held** — not even the lines that would have succeeded. The response tells you
exactly how short each line was:

```json
{ "error": "insufficient_stock",
  "shortfalls": [ { "medicine_name": "Pantoprazole 40mg",
                    "requested": 100, "available": 60, "short_by": 40 } ] }
```

Reduce the quantity and send it again.

---

## Quantities are in pieces

Individual tablets, capsules or vials — not packs or strips. 10 boxes of 15
tablets is `available_quantity: 150`. Where we know how a batch was packed,
`pieces_per_pack` is included so you can convert. It is sometimes `null`; pieces
are always authoritative.

---

## Optional: let us push the nightly refresh to you

Once a night we can POST you the complete stock list, which you apply as a hard
refresh — buffer the pages, and when `is_last: true` arrives, replace your whole
stock table. It is a safety net: if your poller is down for an hour, or a poll
fails, this puts you back in step within a day.

To switch it on, give us an HTTPS endpoint. We will sign every request with your
`sync_secret` in the `X-Adamrit-Signature` header — verify it before trusting the
payload. See *The nightly hard refresh* in `partner-api.md` for the exact
contract.

**You do not need this to go live.** Until you have an endpoint, just call
`GET /stock-snapshot` yourself on whatever schedule suits you.

---

## When something goes wrong

Every error looks the same:

```json
{ "ok": false, "error": "insufficient_stock", "requestId": "…" }
```

Quote the `requestId` when you report a problem — we can find the exact request.

Retry `429` and `502` with backoff. Never retry `400`, `401`, `403` or `409`
unchanged; they will fail identically. Full table in `partner-api.md`.
