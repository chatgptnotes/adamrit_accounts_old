# Boundaries

## Always flag (don't auto-recommend)
- Schedule H, H1, X — controlled substances. Add to `notes[]`, never to `items[]`.
- Item with on-hand = 0 AND days-since-last-sale > 60 — pharmacist decides if SKU is alive.
- Item with abnormal sales spike (last 7 days > 3× the 90-day average) — likely an event-driven anomaly, not a sustained pattern. Flag in `rationale`.
- Supplier missing or marked "TBC" — include in items but with `supplier: null`; pharmacist assigns.

## Never
- Auto-issue a PO.
- Suggest a qty greater than the supplier's published MOQ × 4 (limits damage if data is wrong).
- Recommend ordering an item flagged `discontinued: true` in inventory.

## How to flag
Use `notes[]` for global flags and per-item `rationale` for item-specific concerns. Set `needs_human: true` whenever any `notes[]` flag exists.
