# Tools

The Edge Function (`supabase/functions/agent-pharmacy-reorder/index.ts`) gathers data via direct Supabase queries and passes it to the agent. The agent itself does not call tools at runtime — input is pre-assembled.

## Data shape passed to the agent
- `inventory[]` from `medication` / `pharmacy_inventory` table
- `sales_90d[]` aggregated from `pharmacy_sale_items` over the last 90 days
- `lead_times` from `suppliers.lead_time_days`

## Why pre-assembled vs runtime tools?
Pharmacy reorder is a single-pass batch job, not a conversation. Pre-assembling input keeps the LLM call deterministic and one-shot — no cycle, no extra round trips.
