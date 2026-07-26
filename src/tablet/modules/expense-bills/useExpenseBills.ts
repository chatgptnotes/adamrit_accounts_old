import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** A ledger the user can pick as the party or the expense head. */
export interface LedgerOption {
  id: string;
  code: string;
  name: string;
}

export interface OutstandingBill {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  party: string;
  expenseHead: string;
  billed: number;
  paid: number;
  outstanding: number;
  documentUrl: string | null;
}

const BUCKET = "uploads";

/**
 * The company this tablet is posting for. Same mapping the database uses in
 * resolve_patient_company: Ayushman is its own company, everything else is
 * DRM Hope.
 */
function useCompanyId() {
  const { hospitalConfig } = useAuth();
  const key = hospitalConfig?.name === "ayushman" ? "ayushman_nagpur" : "drm_pvt_ltd";
  return useQuery({
    queryKey: ["tablet-company-id", key],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("companies" as any)
        .select("id")
        .eq("company_key", key)
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.id ?? null;
    },
    staleTime: Infinity,
  });
}

/**
 * Ledgers the bill can be charged against. Creditors for the party, expenses
 * for the head. Searching the chart rather than free text keeps the credit on
 * a real account and stops the chart drifting with spelling variants.
 *
 * The chart holds one row per company for most parties, so a name like Aarav
 * Enterprises appears once for every company that trades with them. Listing all
 * of them is confusing and, worse, lets someone charge a bill to another
 * company's ledger - which is what put voucher legs in two companies and left
 * three of them out of balance on 2026-07-26.
 *
 * So the copies are collapsed to one entry per name, keeping this company's own
 * row, then a shared one, then whatever exists. Nothing is hidden: a party this
 * company has never traded with still appears, on the only row there is.
 */
function useLedgers(kind: "party" | "expense", search: string) {
  const { data: companyId } = useCompanyId();

  return useQuery({
    queryKey: ["expense-bill-ledgers", kind, search, companyId],
    queryFn: async (): Promise<LedgerOption[]> => {
      let q = supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, company_id")
        .eq("is_active", true)
        .order("account_name")
        // fetched wide because collapsing duplicates thins the list
        .limit(200);

      q =
        kind === "party"
          ? q.ilike("account_group", "sundry creditors")
          : q.in("account_type", ["INDIRECT_EXPENSES", "DIRECT_EXPENSES"]);

      if (search.trim()) q = q.ilike("account_name", `%${search.trim()}%`);

      const { data, error } = await q;
      if (error) throw error;

      const rank = (r: any) =>
        companyId && r.company_id === companyId ? 0 : r.company_id === null ? 1 : 2;

      const best = new Map<string, any>();
      for (const r of (data ?? []) as any[]) {
        const key = (r.account_name ?? "").trim().toLowerCase();
        const held = best.get(key);
        if (!held || rank(r) < rank(held)) best.set(key, r);
      }

      return [...best.values()]
        .sort((a, b) => (a.account_name ?? "").localeCompare(b.account_name ?? ""))
        .slice(0, 30)
        .map((r) => ({ id: r.id, code: r.account_code, name: r.account_name }));
    },
    enabled: search.trim().length === 0 || search.trim().length >= 2,
  });
}

export const usePartyLedgers = (search: string) => useLedgers("party", search);
export const useExpenseLedgers = (search: string) => useLedgers("expense", search);

/** Cash and bank accounts a payment can be made from. */
export function useCashBankLedgers() {
  return useQuery({
    queryKey: ["expense-bill-cash-bank"],
    queryFn: async (): Promise<LedgerOption[]> => {
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_group")
        .eq("is_active", true)
        .in("account_group", ["BANK", "CASH", "Bank Accounts", "Cash-in-Hand"])
        .order("account_name");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        code: r.account_code,
        name: r.account_name,
      }));
    },
  });
}

/** Recently recorded bills and what is still owed on each. */
export function useOutstandingBills(limit = 25) {
  return useQuery({
    queryKey: ["expense-bills-outstanding", limit],
    queryFn: async (): Promise<OutstandingBill[]> => {
      const { data, error } = await supabase
        .from("v_expense_bills_outstanding" as any)
        .select("*")
        .order("bill_date", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        billNumber: r.bill_number,
        billDate: r.bill_date,
        dueDate: r.due_date,
        party: r.party,
        expenseHead: r.expense_head,
        billed: Number(r.billed) || 0,
        paid: Number(r.paid) || 0,
        outstanding: Number(r.outstanding) || 0,
        documentUrl: r.document_url,
      }));
    },
  });
}

export interface NewExpenseBill {
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  partyLedgerId: string;
  expenseLedgerId: string;
  amount: number;
  narration: string;
  file: File | null;
}

/**
 * Records the bill. The journal entry is posted by a database trigger, so
 * nothing here writes to the ledger - the invoice is the only thing the user
 * submits.
 */
export function useRecordExpenseBill() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (bill: NewExpenseBill) => {
      let documentPath: string | null = null;
      let documentUrl: string | null = null;

      // Upload first. A bill saved without its evidence is harder to chase
      // than one that failed outright and can simply be retried.
      if (bill.file) {
        const ext = bill.file.name.split(".").pop() || "bin";
        documentPath = `expense-bills/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(documentPath, bill.file);
        if (upErr) throw new Error(`Could not upload the invoice: ${upErr.message}`);
        documentUrl =
          supabase.storage.from(BUCKET).getPublicUrl(documentPath).data?.publicUrl ?? null;
      }

      const { data: userData } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("expense_bills" as any)
        .insert({
          bill_number: bill.billNumber.trim(),
          bill_date: bill.billDate,
          due_date: bill.dueDate,
          party_ledger_id: bill.partyLedgerId,
          expense_ledger_id: bill.expenseLedgerId,
          amount: bill.amount,
          narration: bill.narration.trim() || null,
          document_path: documentPath,
          document_url: documentUrl,
          created_by: userData?.user?.email ?? "tablet",
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-bills-outstanding"] });
    },
  });
}

export interface BillPayment {
  billId: string;
  amount: number;
  bankAccountId: string;
  paymentDate: string;
}

/**
 * Settles a bill. The voucher is written by a database function so the header,
 * both legs and the amount validation happen in one transaction - a half
 * written payment is not possible, and the outstanding is recalculated from
 * the ledger rather than trusted from the screen.
 */
export function useRecordBillPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (p: BillPayment): Promise<string> => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc("record_expense_bill_payment" as any, {
        p_bill_id: p.billId,
        p_amount: p.amount,
        p_bank_account_id: p.bankAccountId,
        p_payment_date: p.paymentDate,
        p_created_by: userData?.user?.email ?? "tablet",
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-bills-outstanding"] });
    },
  });
}
