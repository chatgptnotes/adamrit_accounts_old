---
name: adamrit-payment-collection-gaurav
description: Use when implementing, debugging, or reviewing the Adamrit HMIS tablet Payment Collection (Vasooli) - Gaurav module for pending/received bills, patient payment dashboard, payment collection, receipts, and invoice links.
---

# Adamrit Payment Collection Gaurav

## Core Files

- `src/tablet/modules/payment-collection-gaurav/PaymentCollectionGauravFlow.tsx`: tablet dashboard and detail screen.
- `src/tablet/config/modules.ts`: tablet tile metadata.
- `src/tablet/screens/TabletModuleHost.tsx`: tablet route registry.

## Current Expected Behavior

- Tile label: `Payment Collection (Vasooli) - Gaurav`.
- Available in tablet/mobile view as its own tile.
- The list is patient-wise and should show only patients who are both admitted and Yojana/Ayushman/MJPJAY/PMJAY patients.
- Search at the top is intentionally limited to Patient Name and Mobile Number for cashier speed.
- Fetch data from existing billing/payment tables, not manual duplicate entry or a separate pending bill import:
  - `visits`, `patients`
  - `bills`
  - `bill_preparation`
  - `advance_payment`
- Patient detail must show Patient Name, Scheme/Yojana, Total Approved Amount, Extra Package Amount, Total Amount Received from Patient, Balance Amount Pending, UHID, Registration ID, Mobile, Doctor, Package Code, and Package Name.
- The Extra Package Amount is the amount to be paid by the patient in addition to the approved Yojana amount. It is editable and should be saved as a new append-only audit row in `advance_payment`, not by overwriting or deleting prior payment rows.
- Real patient collections are stored as separate `advance_payment` rows with amount, collection date, payment mode, bank name, reference number, received by, remarks, and optional proof screenshot upload.
- Proof screenshots use the existing patient document upload path with `file_uploads.category = payment_proof`.
- Correction notes are append-only zero-amount audit rows in `advance_payment`; payment amount rows are not edited or deleted from this screen.
- Total Amount Received is the sum of real payment rows only. Extra amount audit rows and correction comments do not affect collected totals.
- Balance Pending is `max(extra package amount - total amount received, 0)`.
- Payment status colors:
  - Green: fully paid
  - Yellow: partially paid
  - Red: pending
- Payment Collection History should include collection date, amount, payment mode, bank, reference number, received by, remarks, proof indicator, and print action for real payment rows.
- Receipt printing should be available from real payment rows.
- Invoice actions should open existing bill/invoice routes rather than duplicating Final Bill generation.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test tablet route `/payment-collection-gaurav`.
