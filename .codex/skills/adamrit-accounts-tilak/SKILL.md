---
name: adamrit-accounts-tilak
description: Use when implementing, debugging, or reviewing the Adamrit HMIS tablet Accounts (Tilak) module for daily receipts, expenses, cash in hand, cash in bank, and Director Dashboard financial matrix sync.
---

# Adamrit Accounts Tilak

## Core Files

- `src/tablet/modules/accounts-tilak/AccountsTilakFlow.tsx`: tablet daily entry form.
- `src/components/DirectorFinancialStatements.tsx`: Director Dashboard matrix rows that display Tilak entries.
- `src/tablet/config/modules.ts`: tablet tile metadata.
- `src/tablet/screens/TabletModuleHost.tsx`: tablet route registry.

## Expected Behavior

- Tile label: `Accounts (Tilak)`.
- Available only in mobile/tablet view as a tablet module tile.
- Form fields: date, receipts, expenses, cash in hand, cash in bank.
- Date defaults to today and can be changed to previous dates.
- All money fields are mandatory and numeric-only.
- Use a touch-friendly form with large inputs, date picker, numeric keypad, and prominent Save button.
- Each selected date should behave as one daily entry. If existing data is present for the date, prefill it and update existing rows instead of creating duplicates.
- Persist into `director_matrix_daily_entries` using the existing unique key `statement_key,row_label,year,month,day`.
- Save these row mappings:
  - `income` / `Daily receipts (Tilak)` = receipts
  - `income` / `Daily expenses (Tilak)` = expenses
  - `income` / `Net profit / loss (Tilak)` = receipts minus expenses
  - `expense` / `Daily expenses (Tilak)` = expenses
  - `receivables` / `Daily receipts (Tilak)` = receipts
  - `payables` / `Daily expenses (Tilak)` = expenses
  - `cash_position` / `Cash in Hand (Tilak)` = cash in hand
  - `cash_position` / `Cash in Bank (Tilak)` = cash in bank
- Director Dashboard should show these rows in Income Statement, Expense Report, Receivables, Payables, and Cash Position.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test tablet route `/accounts-tilak`.
