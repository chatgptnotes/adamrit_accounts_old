// Tally Auto-Push Service
// Fire-and-forget push of bills/payments/pharmacy sales to Tally
// Skips silently if Tally is not configured

import { supabase } from "@/integrations/supabase/client";

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

// Push a bill to Tally as Sales Voucher
export async function pushBillToTally(bill: {
  billNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  items: { description: string; amount: number; ledgerName?: string }[];
}) {
  const config = await isTallyActive();
  if (!config.active) return;

  const mapping = await getLedgerMapping(config.companyId);
  const tallyItems = bill.items.map((item) => ({
    ledgerName: item.ledgerName || mapping.defaultIncomeLedger || "Hospital Income",
    amount: item.amount,
  }));

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-sales-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          billNumber: bill.billNumber,
          patientName: bill.patientName,
          date: bill.date,
          totalAmount: bill.totalAmount,
          items: tallyItems,
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_bill", !!result.success, result.errors, bill.billNumber, config.companyId);
    if (result.success) {
      await mirrorVoucherToLocal({
        voucherType: "Sales",
        voucherNumber: bill.billNumber,
        date: bill.date,
        partyLedger: bill.patientName,
        amount: bill.totalAmount,
        narration: `IPD Bill #${bill.billNumber} - ${bill.patientName}`,
        ledgerEntries: [
          { ledger: bill.patientName, amount: bill.totalAmount, is_debit: true },
          ...tallyItems.map((item) => ({ ledger: item.ledgerName, amount: item.amount, is_debit: false })),
        ],
        adamritBillId: bill.billNumber,
        companyId: config.companyId,
      });
    } else {
      await enqueueForRetry("bill", "create-sales-voucher", {
        billNumber: bill.billNumber, patientName: bill.patientName,
        date: bill.date, totalAmount: bill.totalAmount, items: tallyItems,
      }, result.errors?.join("; ") || result.message || "Push failed", bill.billNumber, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally auto-push bill failed:", err);
    await logPush("auto_push_bill", false, String(err), bill.billNumber, config.companyId);
    await enqueueForRetry("bill", "create-sales-voucher", {
      billNumber: bill.billNumber, patientName: bill.patientName,
      date: bill.date, totalAmount: bill.totalAmount, items: tallyItems,
    }, err.message || String(err), bill.billNumber, config.companyId);
  }
}

// Push a payment/advance receipt to Tally
export async function pushPaymentToTally(payment: {
  receiptNumber: string;
  patientName: string;
  date: string;
  amount: number;
  paymentMode: string;
}) {
  const config = await isTallyActive();
  if (!config.active) return;

  const mapping = await getLedgerMapping(config.companyId);
  const bankLedger =
    mapping.paymentModes?.[payment.paymentMode] ||
    (payment.paymentMode === "Cash" || payment.paymentMode === "CASH" ? "Cash" : "Bank Account");

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-receipt-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          receiptNumber: payment.receiptNumber,
          patientName: payment.patientName,
          date: payment.date,
          amount: payment.amount,
          paymentMode: payment.paymentMode,
          bankLedger,
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_payment", !!result.success, result.errors, payment.receiptNumber, config.companyId);
    if (result.success) {
      await mirrorVoucherToLocal({
        voucherType: "Receipt",
        voucherNumber: payment.receiptNumber,
        date: payment.date,
        partyLedger: payment.patientName,
        amount: payment.amount,
        narration: `Receipt #${payment.receiptNumber} from ${payment.patientName} via ${payment.paymentMode}`,
        ledgerEntries: [
          { ledger: bankLedger, amount: payment.amount, is_debit: true },
          { ledger: payment.patientName, amount: payment.amount, is_debit: false },
        ],
        adamritPaymentId: payment.receiptNumber,
        companyId: config.companyId,
      });
    } else {
      await enqueueForRetry("payment", "create-receipt-voucher", {
        receiptNumber: payment.receiptNumber, patientName: payment.patientName,
        date: payment.date, amount: payment.amount, paymentMode: payment.paymentMode, bankLedger,
      }, result.errors?.join("; ") || result.message || "Push failed", payment.receiptNumber, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally payment push failed:", err);
    await logPush("auto_push_payment", false, String(err), payment.receiptNumber, config.companyId);
    await enqueueForRetry("payment", "create-receipt-voucher", {
      receiptNumber: payment.receiptNumber, patientName: payment.patientName,
      date: payment.date, amount: payment.amount, paymentMode: payment.paymentMode, bankLedger,
    }, err.message || String(err), payment.receiptNumber, config.companyId);
  }
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
  const config = await isTallyActive();
  if (!config.active) return;

  // Get ESIC-specific ledger mapping
  let esicReceivablesLedger = "ESIC Receivables";
  let esicIncomeLedger = "ESIC Income - IPD";

  try {
    let esicQuery = supabase
      .from("tally_ledger_mapping")
      .select("*")
      .eq("is_active", true)
      .in("adamrit_entity_type", ["insurance", "esic_income"]);
    if (config.companyId) esicQuery = esicQuery.eq("company_id", config.companyId);
    const { data: mappings } = await esicQuery;

    if (mappings) {
      const esicMapping = mappings.find(
        (m) => m.adamrit_entity_type === "insurance" && m.adamrit_entity_name === "ESIC"
      );
      if (esicMapping) esicReceivablesLedger = esicMapping.tally_ledger_name;

      const serviceKey = `ESIC ${bill.serviceType || "IPD"}`;
      const incomeMapping = mappings.find(
        (m) => m.adamrit_entity_type === "esic_income" && m.adamrit_entity_name === serviceKey
      );
      if (incomeMapping) esicIncomeLedger = incomeMapping.tally_ledger_name;
    }
  } catch {
    // Use defaults
  }

  const narration = `ESIC Bill #${bill.billNumber}${bill.esicNumber ? ` | ESIC# ${bill.esicNumber}` : ""} - ${bill.patientName}`;

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          voucherType: "Sales",
          date: bill.date,
          narration,
          partyLedger: esicReceivablesLedger,
          ledgerEntries: [
            { ledgerName: esicReceivablesLedger, amount: bill.totalAmount, isDeemedPositive: true },
            ...bill.items.map((item) => ({
              ledgerName: esicIncomeLedger,
              amount: item.amount,
              isDeemedPositive: false,
            })),
          ],
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_esic_bill", !!result.success, result.errors, bill.billNumber, config.companyId);
    if (!result.success) {
      await enqueueForRetry("esic_bill", "create-voucher", {
        voucherType: "Sales", date: bill.date, narration,
        partyLedger: esicReceivablesLedger,
        ledgerEntries: [
          { ledgerName: esicReceivablesLedger, amount: bill.totalAmount, isDeemedPositive: true },
          ...bill.items.map((item) => ({ ledgerName: esicIncomeLedger, amount: item.amount, isDeemedPositive: false })),
        ],
      }, result.errors?.join("; ") || result.message || "Push failed", bill.billNumber, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally ESIC push failed:", err);
    await logPush("auto_push_esic_bill", false, String(err), bill.billNumber, config.companyId);
    await enqueueForRetry("esic_bill", "create-voucher", {
      voucherType: "Sales", date: bill.date, narration,
      partyLedger: esicReceivablesLedger,
      ledgerEntries: [
        { ledgerName: esicReceivablesLedger, amount: bill.totalAmount, isDeemedPositive: true },
        ...bill.items.map((item) => ({ ledgerName: esicIncomeLedger, amount: item.amount, isDeemedPositive: false })),
      ],
    }, err.message || String(err), bill.billNumber, config.companyId);
  }
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
  const config = await isTallyActive();
  if (!config.active) return;

  // Resolve insurance receivables ledger
  let insuranceLedger = `${bill.insuranceCompany} Insurance Receivables`;
  const incomeLedger = "Hospital Income";

  try {
    let insQuery = supabase
      .from("tally_ledger_mapping")
      .select("*")
      .eq("adamrit_entity_type", "insurance")
      .eq("adamrit_entity_name", bill.insuranceCompany)
      .eq("is_active", true);
    if (config.companyId) insQuery = insQuery.eq("company_id", config.companyId);
    const { data: mappings } = await insQuery.limit(1).single();

    if (mappings) insuranceLedger = mappings.tally_ledger_name;
  } catch {
    // Use default
  }

  const mapping = await getLedgerMapping(config.companyId);
  const narration = `Insurance Bill #${bill.billNumber} | ${bill.insuranceCompany}${bill.policyNumber ? ` | Policy# ${bill.policyNumber}` : ""} - ${bill.patientName}`;

  // Double-entry: Insurance company owes claimAmount, patient owes patientShare
  const ledgerEntries: { ledgerName: string; amount: number; isDeemedPositive: boolean }[] = [];

  // Debit: Insurance receivables for claim amount
  if (bill.claimAmount > 0) {
    ledgerEntries.push({ ledgerName: insuranceLedger, amount: bill.claimAmount, isDeemedPositive: true });
  }
  // Debit: Patient for their share (if any)
  if (bill.patientShare > 0) {
    ledgerEntries.push({ ledgerName: bill.patientName, amount: bill.patientShare, isDeemedPositive: true });
  }
  // Credit: Income ledgers
  for (const item of bill.items) {
    ledgerEntries.push({
      ledgerName: item.description || mapping.defaultIncomeLedger || incomeLedger,
      amount: item.amount,
      isDeemedPositive: false,
    });
  }

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          voucherType: "Sales",
          date: bill.date,
          narration,
          partyLedger: insuranceLedger,
          ledgerEntries,
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_insurance_bill", !!result.success, result.errors, bill.billNumber, config.companyId);
    if (!result.success) {
      await enqueueForRetry("insurance_bill", "create-voucher", {
        voucherType: "Sales", date: bill.date, narration, partyLedger: insuranceLedger, ledgerEntries,
      }, result.errors?.join("; ") || result.message || "Push failed", bill.billNumber, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally insurance push failed:", err);
    await logPush("auto_push_insurance_bill", false, String(err), bill.billNumber, config.companyId);
    await enqueueForRetry("insurance_bill", "create-voucher", {
      voucherType: "Sales", date: bill.date, narration, partyLedger: insuranceLedger, ledgerEntries,
    }, err.message || String(err), bill.billNumber, config.companyId);
  }
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
  const config = await isTallyActive();
  if (!config.active) return;

  let insuranceLedger = `${payment.insuranceCompany} Insurance Receivables`;

  try {
    let payInsQuery = supabase
      .from("tally_ledger_mapping")
      .select("*")
      .eq("adamrit_entity_type", "insurance")
      .eq("adamrit_entity_name", payment.insuranceCompany)
      .eq("is_active", true);
    if (config.companyId) payInsQuery = payInsQuery.eq("company_id", config.companyId);
    const { data: mappings } = await payInsQuery.limit(1).single();

    if (mappings) insuranceLedger = mappings.tally_ledger_name;
  } catch {
    // Use default
  }

  const bankLedger = payment.bankAccount || "HDFC Bank";
  const narration = `Insurance Settlement #${payment.receiptNumber} from ${payment.insuranceCompany}${payment.utrNumber ? ` | UTR: ${payment.utrNumber}` : ""}`;

  const ledgerEntries: { ledgerName: string; amount: number; isDeemedPositive: boolean }[] = [
    // Debit: Bank (money received)
    { ledgerName: bankLedger, amount: payment.amount, isDeemedPositive: true },
    // Credit: Insurance receivables (debt reduced)
    { ledgerName: insuranceLedger, amount: payment.amount, isDeemedPositive: false },
  ];

  // If there's a TDS deduction
  if (payment.tdsAmount && payment.tdsAmount > 0) {
    ledgerEntries.push({ ledgerName: "TDS Receivable", amount: payment.tdsAmount, isDeemedPositive: true });
    // Increase credit to insurance receivables for the TDS portion
    ledgerEntries[1].amount += payment.tdsAmount;
  }

  // If there's a disallowance
  if (payment.disallowanceAmount && payment.disallowanceAmount > 0) {
    ledgerEntries.push({ ledgerName: "Insurance Disallowance", amount: payment.disallowanceAmount, isDeemedPositive: true });
    ledgerEntries[1].amount += payment.disallowanceAmount;
  }

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          voucherType: "Receipt",
          date: payment.date,
          narration,
          partyLedger: insuranceLedger,
          ledgerEntries,
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_insurance_payment", !!result.success, result.errors, payment.receiptNumber, config.companyId);
    if (!result.success) {
      await enqueueForRetry("insurance_payment", "create-voucher", {
        voucherType: "Receipt", date: payment.date, narration, partyLedger: insuranceLedger, ledgerEntries,
      }, result.errors?.join("; ") || result.message || "Push failed", payment.receiptNumber, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally insurance payment push failed:", err);
    await logPush("auto_push_insurance_payment", false, String(err), payment.receiptNumber, config.companyId);
    await enqueueForRetry("insurance_payment", "create-voucher", {
      voucherType: "Receipt", date: payment.date, narration, partyLedger: insuranceLedger, ledgerEntries,
    }, err.message || String(err), payment.receiptNumber, config.companyId);
  }
}

// Push pharmacy sale (direct sale or prescription sale) to Tally as Sales Voucher
export async function pushPharmacySaleToTally(sale: {
  invoiceNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  items: { medicineName: string; quantity: number; amount: number }[];
}) {
  const config = await isTallyActive();
  if (!config.active) return;

  const mapping = await getLedgerMapping(config.companyId);

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-sales-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          billNumber: sale.invoiceNumber,
          patientName: sale.patientName,
          date: sale.date,
          totalAmount: sale.totalAmount,
          items: sale.items.map((item) => ({
            ledgerName: mapping.pharmacySalesLedger || "Pharmacy Sales",
            amount: item.amount,
          })),
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_pharmacy", !!result.success, result.errors, sale.invoiceNumber, config.companyId);
    if (result.success) {
      await mirrorVoucherToLocal({
        voucherType: "Sales",
        voucherNumber: sale.invoiceNumber,
        date: sale.date,
        partyLedger: sale.patientName,
        amount: sale.totalAmount,
        narration: `Pharmacy Sale #${sale.invoiceNumber} - ${sale.patientName}`,
        ledgerEntries: [
          { ledger: sale.patientName, amount: sale.totalAmount, is_debit: true },
          ...sale.items.map((item) => ({
            ledger: mapping.pharmacySalesLedger || "Pharmacy Sales",
            amount: item.amount,
            is_debit: false,
          })),
        ],
        adamritBillId: sale.invoiceNumber,
        companyId: config.companyId,
      });
    } else {
      await enqueueForRetry("pharmacy", "create-sales-voucher", {
        billNumber: sale.invoiceNumber, patientName: sale.patientName,
        date: sale.date, totalAmount: sale.totalAmount,
        items: sale.items.map((item) => ({
          ledgerName: mapping.pharmacySalesLedger || "Pharmacy Sales", amount: item.amount,
        })),
      }, result.errors?.join("; ") || result.message || "Push failed", sale.invoiceNumber, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally pharmacy push failed:", err);
    await logPush("auto_push_pharmacy", false, String(err), sale.invoiceNumber, config.companyId);
    await enqueueForRetry("pharmacy", "create-sales-voucher", {
      billNumber: sale.invoiceNumber, patientName: sale.patientName,
      date: sale.date, totalAmount: sale.totalAmount,
      items: sale.items.map((item) => ({
        ledgerName: mapping.pharmacySalesLedger || "Pharmacy Sales", amount: item.amount,
      })),
    }, err.message || String(err), sale.invoiceNumber, config.companyId);
  }
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
  const config = await isTallyActive();
  if (!config.active) return;

  const mapping = await getLedgerMapping(config.companyId);
  const creditLedger = voucher.accountLedger || mapping.paymentModes?.["Cash"] || "Cash";
  const debitLines = voucher.lines?.length
    ? voucher.lines
    : [{ ledgerName: voucher.personName || "Suspense", amount: voucher.amount }];
  const partyLedger = debitLines[0].ledgerName;
  const narration =
    voucher.narration ||
    `Payment #${voucher.voucherNo} to ${partyLedger}${voucher.purpose ? ` — ${voucher.purpose}` : ""}`;
  const ledgerEntries = [
    ...debitLines.map((l) => ({ ledgerName: l.ledgerName, amount: l.amount, isDeemedPositive: true })),
    { ledgerName: creditLedger, amount: voucher.amount, isDeemedPositive: false },
  ];

  try {
    const response = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "push",
        action: "create-voucher",
        serverUrl: config.serverUrl,
        companyName: config.companyName,
        data: {
          voucherType: "Payment",
          date: voucher.date,
          narration,
          partyLedger,
          ledgerEntries,
        },
      }),
    });
    const result = await response.json();
    await logPush("auto_push_payment_voucher", !!result.success, result.errors, voucher.voucherNo, config.companyId);
    if (result.success) {
      await mirrorVoucherToLocal({
        voucherType: "Payment",
        voucherNumber: voucher.voucherNo,
        date: voucher.date,
        partyLedger,
        amount: voucher.amount,
        narration,
        ledgerEntries: [
          ...debitLines.map((l) => ({ ledger: l.ledgerName, amount: l.amount, is_debit: true })),
          { ledger: creditLedger, amount: voucher.amount, is_debit: false },
        ],
        adamritPaymentId: voucher.voucherNo,
        companyId: config.companyId,
      });
    } else {
      await enqueueForRetry("payment_voucher", "create-voucher", {
        voucherType: "Payment", date: voucher.date, narration,
        partyLedger,
        ledgerEntries,
      }, result.errors?.join("; ") || result.message || "Push failed", voucher.voucherNo, config.companyId);
    }
    return result;
  } catch (err: any) {
    console.error("Tally payment voucher push failed:", err);
    await logPush("auto_push_payment_voucher", false, String(err), voucher.voucherNo, config.companyId);
    await enqueueForRetry("payment_voucher", "create-voucher", {
      voucherType: "Payment", date: voucher.date, narration,
      partyLedger,
      ledgerEntries,
    }, err.message || String(err), voucher.voucherNo, config.companyId);
  }
}
