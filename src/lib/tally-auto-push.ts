// Tally Auto-Push Service
// Fire-and-forget push of bills/payments/pharmacy sales to Tally
// Skips silently if Tally is not configured

import { supabase } from "@/integrations/supabase/client";

const OUTBOUND_TALLY_DISABLED_MESSAGE = "Outbound push to Tally is disabled. This installation is read-only from Tally.";

function disabledPushResult() {
  return { status: "skipped" as const, success: false, skipped: true, message: OUTBOUND_TALLY_DISABLED_MESSAGE };
}

// Check if Tally integration is configured and active
async function isTallyActive(): Promise<{ active: boolean; serverUrl: string; companyName: string; companyId: string }> {
  try {
    const { data } = await supabase
      .from("tally_config")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!data) return { active: false, serverUrl: "", companyName: "", companyId: "" };
    return { active: true, serverUrl: data.server_url, companyName: data.company_name, companyId: data.id };
  } catch {
    return { active: false, serverUrl: "", companyName: "", companyId: "" };
  }
}

// Get ledger mapping from tally_ledger_mapping table or fall back to defaults
async function getLedgerMapping(companyId?: string) {
  try {
    let query = supabase
      .from("tally_ledger_mapping")
      .select("*")
      .eq("is_active", true);
    if (companyId) query = query.eq("company_id", companyId);
    const { data: mappings } = await query;

    if (mappings && mappings.length > 0) {
      const paymentModes: Record<string, string> = {};
      let defaultIncomeLedger = "Hospital Income";
      let pharmacySalesLedger = "Pharmacy Sales";

      for (const m of mappings) {
        if (m.adamrit_entity_type === "payment_mode") {
          paymentModes[m.adamrit_entity_name] = m.tally_ledger_name;
        } else if (m.adamrit_entity_type === "service_category" && m.adamrit_entity_name === "Hospital Income") {
          defaultIncomeLedger = m.tally_ledger_name;
        } else if (m.adamrit_entity_type === "pharmacy" && m.adamrit_entity_name === "Pharmacy Sales") {
          pharmacySalesLedger = m.tally_ledger_name;
        }
      }

      return { defaultIncomeLedger, pharmacySalesLedger, paymentModes };
    }
  } catch {
    // Table may not exist yet, fall through to defaults
  }

  // Fallback: check tally_config metadata
  try {
    const { data } = await supabase
      .from("tally_config")
      .select("metadata")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (data?.metadata?.ledgerMapping) return data.metadata.ledgerMapping;
  } catch {
    // ignore
  }

  return {
    defaultIncomeLedger: "Hospital Income",
    pharmacySalesLedger: "Pharmacy Sales",
    paymentModes: {
      Cash: "Cash",
      CASH: "Cash",
      Card: "HDFC Bank",
      CARD: "HDFC Bank",
      UPI: "HDFC Bank",
      "Bank Transfer": "HDFC Bank",
      NEFT: "HDFC Bank",
      RTGS: "HDFC Bank",
      ONLINE: "HDFC Bank",
      DD: "HDFC Bank",
      CHEQUE: "HDFC Bank",
      Insurance: "Insurance Receivables",
      CREDIT: "Credit",
      ESIC: "ESIC Receivables",
      CGHS: "CGHS Receivables",
    },
  };
}

// After a successful push to TallyPrime, mirror the entry into tally_vouchers so
// TallyCashBook can display it immediately via Supabase Realtime — without waiting
// for a manual "Refresh from Tally".
async function mirrorVoucherToLocal(v: {
  voucherType: string;
  voucherNumber: string;
  date: string;
  partyLedger: string;
  amount: number;
  narration: string;
  ledgerEntries: { ledger: string; amount: number; is_debit: boolean }[];
  adamritPaymentId?: string;
  adamritBillId?: string;
  companyId?: string;
}) {
  try {
    if (!v.companyId) return;
    // Skip if already exists (re-push or prior real Tally sync)
    const { count } = await supabase
      .from("tally_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("company_id", v.companyId)
      .eq("voucher_number", v.voucherNumber);
    if (count && count > 0) return;

    await supabase.from("tally_vouchers").insert({
      voucher_type: v.voucherType,
      voucher_number: v.voucherNumber,
      date: v.date,
      party_ledger: v.partyLedger,
      amount: v.amount,
      narration: v.narration,
      ledger_entries: v.ledgerEntries,
      sync_direction: "to_tally",
      sync_status: "synced",
      adamrit_payment_id: v.adamritPaymentId || null,
      adamrit_bill_id: v.adamritBillId || null,
      company_id: v.companyId,
      synced_at: new Date().toISOString(),
    });
  } catch {
    // Mirror failure must never affect the main push flow
  }
}

async function logPush(syncType: string, success: boolean, errors?: any, ref?: string, companyId?: string) {
  try {
    await supabase.from("tally_sync_log").insert({
      sync_type: syncType,
      direction: "outward",
      status: success ? "completed" : "failed",
      records_synced: success ? 1 : 0,
      records_failed: success ? 0 : 1,
      error_details: errors ? { errors, ref } : null,
      completed_at: new Date().toISOString(),
      company_id: companyId || null,
    });
  } catch {
    // Logging failure should not propagate
  }
}

// Enqueue failed push for retry
async function enqueueForRetry(
  pushType: string,
  pushAction: string,
  payload: any,
  error: string,
  referenceId?: string,
  companyId?: string
) {
  try {
    await supabase.from("tally_push_queue").insert({
      push_type: pushType,
      push_action: pushAction,
      payload,
      reference_id: referenceId || null,
      status: "pending",
      retry_count: 0,
      max_retries: 5,
      last_error: error,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      company_id: companyId || null,
    });
  } catch {
    // Queue insertion failure should not propagate
  }
}

export async function pushLedgerToTally(ledger: {
  name: string;
  parentGroup: string;
  openingBalance?: number;
  address?: string;
  phone?: string;
  email?: string;
  gstNumber?: string;
  companyId?: string | null;
}): Promise<{ status: "synced" | "queued" | "skipped"; message?: string; companyId?: string }> {
  void ledger;
  return { ...disabledPushResult(), companyId: ledger.companyId || undefined };
}

// Push a bill to Tally as Sales Voucher
export async function pushBillToTally(bill: {
  billNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  items: { description: string; amount: number; ledgerName?: string }[];
}) {
  void bill;
  return disabledPushResult();
}

// Push a payment/advance receipt to Tally
export async function pushPaymentToTally(payment: {
  receiptNumber: string;
  patientName: string;
  date: string;
  amount: number;
  paymentMode: string;
}) {
  void payment;
  return disabledPushResult();
}

// Push ESIC bill to Tally — uses ESIC-specific ledger mapping
export async function pushESICBillToTally(bill: {
  billNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  esicNumber?: string;
  serviceType?: string; // Consultation, IPD, OPD, Surgery, Lab, Pharmacy
  items: { description: string; amount: number }[];
}) {
  void bill;
  return disabledPushResult();
}

// Push Insurance/TPA claim bill to Tally
export async function pushInsuranceBillToTally(bill: {
  billNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  claimAmount: number;
  patientShare: number;
  insuranceCompany: string; // e.g. "Star Health", "ICICI Lombard"
  tpaName?: string;
  policyNumber?: string;
  items: { description: string; amount: number }[];
}) {
  void bill;
  return disabledPushResult();
}

// Push insurance payment received (settlement from TPA/insurance company)
export async function pushInsurancePaymentToTally(payment: {
  receiptNumber: string;
  insuranceCompany: string;
  date: string;
  amount: number;
  tdsAmount?: number;
  disallowanceAmount?: number;
  bankAccount?: string;
  utrNumber?: string;
}) {
  void payment;
  return disabledPushResult();
}

// Push pharmacy sale (direct sale or prescription sale) to Tally as Sales Voucher
export async function pushPharmacySaleToTally(sale: {
  invoiceNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  items: { medicineName: string; quantity: number; amount: number }[];
}) {
  void sale;
  return disabledPushResult();
}

// Push a payment voucher (cash going OUT) to Tally as a Payment Voucher.
// Tally-style entry: `accountLedger` is credited, each `lines` ledger is debited.
// Legacy callers may still pass personName/purpose with no lines.
export async function pushPaymentVoucherToTally(voucher: {
  voucherNo: string;
  date: string;
  amount: number;
  personName?: string;
  purpose?: string;
  accountLedger?: string;
  lines?: { ledgerName: string; amount: number }[];
  narration?: string;
}) {
  void voucher;
  return disabledPushResult();
}
