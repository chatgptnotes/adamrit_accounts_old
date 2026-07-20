---
name: adamrit-payment-collection-gaurav
description: Use when implementing, debugging, or reviewing the Adamrit HMIS tablet Payment Collection (Vasooli) - Gaurav module for pending/received bills, patient payment dashboard, payment collection, receipts, and invoice links.
---

# Adamrit Payment Collection Gaurav

## Core Files

- `src/tablet/modules/payment-collection-gaurav/PaymentCollectionGauravFlow.tsx`: tablet dashboard and detail screen.
- `src/tablet/config/modules.ts`: tablet tile metadata.
- `src/tablet/screens/TabletModuleHost.tsx`: tablet route registry.

## Expected Behavior

- Tile label: `Payment Collection (Vasooli) - Gaurav`.
- Available in tablet/mobile view as its own tile.
- Fetch data from existing billing/payment tables, not manual duplicate entry:
  - `visits`, `patients`
  - `bills`
  - `bill_preparation`
  - `advance_payment`
  - `final_payments`
- Dashboard columns must include patient name, UHID, registration ID, mobile, doctor, Yojana/insurance, total bill, Yojana approved amount, patient payable, patient paid, pending, last payment date/amount, status, and action.
- Cash patients show total bill, paid, and pending.
- Yojana/insurance patients show Yojana approved amount separately and calculate patient payable as `total bill - approved amount`.
- Payment status colors:
  - Green: paid
  - Yellow: partial paid
  - Red: pending
  - Blue: fully covered by Yojana
- Detail screen must show billing summary and complete payment history with dates, receipt numbers, modes, and amounts.
- New collections should write to `advance_payment`, matching the existing tablet Billing and Advance Statement collection pattern.
- Receipt printing should be available from the detail payment history.
- Invoice actions should open existing bill/invoice routes rather than duplicating Final Bill generation.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test tablet route `/payment-collection-gaurav`.
