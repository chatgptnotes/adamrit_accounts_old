# Outputs

Strict JSON. No prose outside this structure.

```json
{
  "items": [
    {
      "medicine_id": "uuid",
      "medicine_name": "Paracetamol 500mg",
      "on_hand": 240,
      "avg_daily_sales": 38.4,
      "days_of_cover": 6.25,
      "suggested_qty": 1200,
      "supplier": "Cipla",
      "expected_stockout": "2026-05-15",
      "confidence": 0.93,
      "rationale": "Daily sales 38.4; lead time 4 days; 30-day post-arrival cover at pack size 100 = 1200."
    }
  ],
  "notes": [
    "3 items skipped: zero sales in last 30 days.",
    "1 item flagged for manual review: Schedule H (alprazolam)."
  ],
  "needs_human": true,
  "generated_at": "2026-05-09T06:00:00+05:30"
}
```

## Length
- Up to 50 items per response. If more candidates, return top 50 ranked by stockout-risk and add a note.

## Forbidden
- Free-text outside the JSON envelope.
- Suggested qty rounded down (under-orders cause stockouts; round up to nearest pack).
- "Approximate" days-of-cover (always to 1 decimal place).
