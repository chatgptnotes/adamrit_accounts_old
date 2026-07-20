/**
 * Shared Vasooli (extra package / extra charge) logic.
 *
 * The Vasooli tile (Gaurav) and the Private Room Extra Charges tile (Reena)
 * read the same underlying records, so the encoding and the status rules live
 * here rather than being duplicated per flow. A patient must never show
 * "Partially Paid" on one tile and "Fully Paid" on the other.
 *
 * Storage note: there is no extra-package column. The amount is written as an
 * `advance_payment` row with status EXTRA_PACKAGE_STATUS, carrying the value in
 * `reference_number` and mirrored into `remarks` as `extra_package_amount=N`.
 */

export const EXTRA_PACKAGE_STATUS = "VASOOLI_EXTRA_PACKAGE";
export const CORRECTION_COMMENT_STATUS = "VASOOLI_CORRECTION_COMMENT";

export type PaymentStatus = "unassessed" | "pending" | "partial" | "paid";

export const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Reads the extra amount out of an extra-package row's reference/remarks. */
export function parseExtraPackage(row: { reference_number?: unknown; remarks?: unknown }) {
  const fromReference = toNumber(row?.reference_number);
  if (fromReference > 0) return fromReference;
  const match = String(row?.remarks || "").match(/extra_package_amount=([0-9.]+)/i);
  return match ? toNumber(match[1]) : 0;
}

export function getPaymentStatus(
  extraPackageAmount: number,
  totalReceivedAmount: number,
): PaymentStatus {
  // No extra package amount recorded yet is NOT "paid" — it means nobody has
  // assessed this patient. Reporting it as paid hides exactly the patients who
  // still need work at the bottom of the list.
  if (extraPackageAmount <= 0) return "unassessed";
  if (totalReceivedAmount <= 0) return "pending";
  if (totalReceivedAmount < extraPackageAmount) return "partial";
  return "paid";
}

export const statusMeta = (status: PaymentStatus) => {
  switch (status) {
    case "unassessed":
      return {
        label: "Amount Not Set",
        className: "border-slate-300 bg-slate-100 text-slate-700",
      };
    case "paid":
      return {
        label: "Fully Paid",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "partial":
      return {
        label: "Partially Paid",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    default:
      return {
        label: "Pending",
        className: "border-red-200 bg-red-50 text-red-700",
      };
  }
};

/** Sort weight — unassessed first: it blocks collection and was previously hidden. */
export const STATUS_ORDER: Record<PaymentStatus, number> = {
  unassessed: 0,
  pending: 1,
  partial: 2,
  paid: 3,
};
