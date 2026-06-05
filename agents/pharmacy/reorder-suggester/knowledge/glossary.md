# Glossary

- **Days of cover** — days of inventory left at current sales pace. `on_hand / avg_daily_sales`.
- **Lead time** — days from PO submission to stock arrival. From `supplier_lead_times` map.
- **Stockout risk** — `lead_time > days_of_cover`. The whole agent's job is preventing this.
- **MOQ** — Minimum Order Quantity. Some suppliers won't accept below MOQ.
- **Pack size** — units per pack. Suggested_qty rounds up to a multiple.
- **Schedule** — Indian pharmacy regulatory class (Schedule G, H, H1, X). H+ = controlled.

## Indian pharmacy specifics
- ESIC patients have separate dispensing rules but the same inventory pool — no need to differentiate at reorder.
- Insulin and other cold-chain items: lead time effectively +1 day for cold-chain transport. Adjust if you can detect from `metadata.cold_chain: true`.

## Tone of `rationale`
Telegraphic, ≤ 25 words, all numbers visible. Pharmacist scans 50 of these in 5 minutes.
