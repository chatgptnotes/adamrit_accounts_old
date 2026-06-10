// Tally Reverse Sync: Pull receipts from Tally → match to Adamrit bills → update payment status
import { supabase } from "@/integrations/supabase/client";

interface ReverseSyncResult {
  matched: number;
  updated: number;
  newLedgers: number;
  unmatched: string[];
}

interface TallyReceipt {
  voucherNumber: string;
  date: string;
  partyName: string;
  amount: number;
  narration: string;
}

// Fuzzy match: normalize and compare names
function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  // Token overlap
  const tokensA = na.split(" ");
  const tokensB = nb.split(" ");
  const common = tokensA.filter((t) => tokensB.includes(t));
  const maxLen = Math.max(tokensA.length, tokensB.length);
  return maxLen > 0 ? common.length / maxLen : 0;
}

export async function matchReceiptToBill(receipt: TallyReceipt) {
  // Search visits by patient name similarity + amount range (±10%)
  const { data: visits } = await supabase
    .from("visits")
    .select("id, patient_name, total_amount, payment_status, visit_date")
    .or("payment_status.eq.unpaid,payment_status.eq.partial,payment_status.is.null")
    .gte("total_amount", receipt.amount * 0.9)
    .lte("total_amount", receipt.amount * 1.1)
    .order("visit_date", { ascending: false })
    .limit(50);

  if (!visits || visits.length === 0) return null;

  // Find best name match
  let bestMatch: (typeof visits)[0] | null = null;
  let bestScore = 0;

  for (const visit of visits) {
    const score = nameSimilarity(receipt.partyName, visit.patient_name || "");
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = visit;
    }
  }

  return bestMatch;
}

export async function reverseSync(
  serverUrl: string,
  companyName: string,
  companyId: string
): Promise<ReverseSyncResult> {
  const result: ReverseSyncResult = {
    matched: 0,
    updated: 0,
    newLedgers: 0,
    unmatched: [],
  };

  // 1. Pull receipt vouchers from Tally for last 30 days
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);

  const fromStr = fromDate.toISOString().split("T")[0].replace(/-/g, "");
  const toStr = toDate.toISOString().split("T")[0].replace(/-/g, "");

  const dayBookXml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Day Book</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
    <SVFROMDATE>${fromStr}</SVFROMDATE>
    <SVTODATE>${toStr}</SVTODATE>
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;

  let receipts: TallyReceipt[] = [];

  try {
    const proxyResponse = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "proxy",
        serverUrl,
        xmlBody: dayBookXml,
      }),
    });
    const proxyResult = await proxyResponse.json();

    if (proxyResult.error) {
      throw new Error(proxyResult.error);
    }

    const xml = proxyResult.response || "";

    // Parse receipt vouchers
    const voucherMatches =
      xml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/gi) || [];

    for (const vXml of voucherMatches) {
      const vchType = getVal(vXml, "VOUCHERTYPENAME") || getAttr(vXml, "VCHTYPE");
      if (vchType !== "Receipt") continue;

      const rawDate = getVal(vXml, "DATE");
      const date = rawDate
        ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
        : toDate.toISOString().split("T")[0];

      // Get the amount from ledger entries
      const entryMatches =
        vXml.match(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/gi) || [];
      let totalAmount = 0;
      for (const entry of entryMatches) {
        const amt = parseFloat(getVal(entry, "AMOUNT") || "0");
        if (amt < 0) totalAmount += Math.abs(amt); // Debit entries
      }

      receipts.push({
        voucherNumber: getVal(vXml, "VOUCHERNUMBER") || "",
        date,
        partyName: getVal(vXml, "PARTYLEDGERNAME") || "",
        amount: totalAmount,
        narration: getVal(vXml, "NARRATION") || "",
      });
    }
  } catch (err) {
    console.error("Reverse sync: Failed to fetch receipts from Tally:", err);
    await logReverseSync("reverse_sync_receipts", false, String(err), undefined, companyId);
    return result;
  }

  // 2. Match each receipt to Adamrit bills
  for (const receipt of receipts) {
    if (!receipt.partyName || receipt.amount <= 0) continue;

    const match = await matchReceiptToBill(receipt);

    if (match) {
      result.matched++;

      // Update payment status if not already paid
      if (match.payment_status !== "paid") {
        const { error } = await supabase
          .from("visits")
          .update({
            payment_status: "paid",
            updated_at: new Date().toISOString(),
          })
          .eq("id", match.id);

        if (!error) {
          result.updated++;
        }
      }
    } else {
      result.unmatched.push(
        `${receipt.partyName} - ₹${receipt.amount} (${receipt.date})`
      );
    }
  }

  // 3. Pull latest ledger balances and sync new ledgers
  try {
    const ledgerXml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Ledgers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`;

    const ledgerResponse = await fetch("/api/tally-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "proxy",
        serverUrl,
        xmlBody: ledgerXml,
      }),
    });
    const ledgerResult = await ledgerResponse.json();
    const ledgerXmlStr = ledgerResult.response || "";

    const ledgerElements =
      ledgerXmlStr.match(/<LEDGER[^>]*>[\s\S]*?<\/LEDGER>/gi) || [];

    // Get existing ledger names
    const { data: existingLedgers } = await supabase
      .from("tally_ledgers")
      .select("name")
      .eq("company_id", companyId);
    const existingNames = new Set(
      (existingLedgers || []).map((l: any) => l.name)
    );

    for (const el of ledgerElements) {
      const name = getVal(el, "NAME") || getAttr(el, "NAME");
      if (!name) continue;

      const closingBalance = parseFloat(
        getVal(el, "CLOSINGBALANCE") || "0"
      );
      const parentGroup = getVal(el, "PARENT") || "";

      if (existingNames.has(name)) {
        // Update balance
        await supabase
          .from("tally_ledgers")
          .update({
            closing_balance: closingBalance,
            last_synced_at: new Date().toISOString(),
          })
          .eq("company_id", companyId)
          .eq("name", name);
      } else {
        // Insert new ledger
        await supabase.from("tally_ledgers").upsert({
          company_id: companyId,
          name,
          tally_guid: getVal(el, "GUID") || getAttr(el, "GUID") || null,
          parent_group: parentGroup,
          opening_balance: parseFloat(
            getVal(el, "OPENINGBALANCE") || "0"
          ),
          closing_balance: closingBalance,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'company_id,name', ignoreDuplicates: false });
        result.newLedgers++;
      }
    }
  } catch (err) {
    console.error("Reverse sync: Failed to sync ledgers:", err);
  }

  // 4. Log results
  await logReverseSync("reverse_sync", true, null, result, companyId);

  return result;
}

// XML helpers (same pattern as api/tally-proxy.ts)
function getVal(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function getAttr(xml: string, attr: string): string {
  const m = xml.match(new RegExp(`${attr}="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

async function logReverseSync(
  syncType: string,
  success: boolean,
  errorStr?: string | null,
  result?: ReverseSyncResult,
  companyId?: string
) {
  try {
    await supabase.from("tally_sync_log").insert({
      sync_type: syncType,
      direction: "inward",
      status: success ? "completed" : "failed",
      records_synced: result ? result.matched + result.newLedgers : 0,
      records_failed: result ? result.unmatched.length : 0,
      error_details: errorStr
        ? { error: errorStr }
        : result
          ? {
              matched: result.matched,
              updated: result.updated,
              newLedgers: result.newLedgers,
              unmatchedCount: result.unmatched.length,
            }
          : null,
      completed_at: new Date().toISOString(),
      company_id: companyId || null,
    });
  } catch {
    // Logging failure should not propagate
  }
}
