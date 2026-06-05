# Intake

## Trigger
- Cron weekly Monday 06:00.
- On-demand: `POST /functions/v1/agent-pharmacy-reorder` with `{"horizon_days": 30}` (optional, default 30).

## Required (passed by the Edge Function, not the user)
- `inventory[]` — { medicine_id, medicine_name, on_hand, pack_size, supplier, schedule, last_received_at }
- `sales_90d[]` — { medicine_id, total_qty, distinct_days }
- `lead_times` — { supplier → days } map
- `horizon_days` — defaults to 30

## What "no sales in 30 days" means
The `sales_90d` aggregate covers 90 days but the agent must check whether sales in the most recent 30 days are zero. If both 0/0 → skip (probably a deprecated SKU); pharmacist marks critical-stock manually if needed.

## Out of scope
- Issuing the PO (pharmacist confirms; PO generation is the existing pharmacy-billing-service.ts flow).
- Supplier negotiation.
- Drug substitution recommendations.
