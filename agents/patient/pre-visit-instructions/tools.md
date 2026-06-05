# Tools

Pre-assembled by the Edge Function — agent does not call tools at runtime.

## Data sources
- `appointments` table — for the appointment row
- `patients` table — for first_name, age (computed from DOB), language preference
- `appointment_type_templates` — for prep_steps + items_to_bring + duration

The Edge Function de-identifies the assembled payload before passing to the LLM (only first_name and age survive).
