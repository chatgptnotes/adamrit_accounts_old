import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** A ledger the user can pick as the party or the expense head. */
export interface LedgerOption {
  id: string;
  code: string;
  name: string;
  type?: string;
  group?: string | null;
}

export interface LedgerOptionsPage {
  options: LedgerOption[];
  hasMore: boolean;
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
export function useExpenseBillCompanyId() {
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

const LEDGER_PAGE_SIZE = 50;

/** Every active ledger belonging to this company or explicitly shared. */
function useLedgers(search: string, page: number) {
  const { data: companyId } = useExpenseBillCompanyId();

  return useQuery({
    queryKey: ["expense-bill-ledgers", search, page, companyId],
    queryFn: async (): Promise<LedgerOptionsPage> => {
      if (!companyId) return { options: [], hasMore: false };
      const from = page * LEDGER_PAGE_SIZE;
      let q = supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type, account_group, company_id")
        .eq("is_active", true)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("account_name")
        .order("id")
        // Fetch one extra row to determine whether another page exists.
        .range(from, from + LEDGER_PAGE_SIZE);

      if (search.trim()) q = q.ilike("account_name", `%${search.trim()}%`);

      const { data, error } = await q;
      if (error) throw error;

      const rows = data ?? [];
      return {
        hasMore: rows.length > LEDGER_PAGE_SIZE,
        options: rows.slice(0, LEDGER_PAGE_SIZE).map((r) => ({
          id: r.id,
          code: r.account_code,
          name: r.account_name,
          type: r.account_type,
          group: r.account_group,
        })),
      };
    },
    enabled: Boolean(companyId) && (search.trim().length === 0 || search.trim().length >= 2),
    staleTime: 5 * 60 * 1000,
  });
}

export const usePartyLedgers = (search: string, page: number) => useLedgers(search, page);
export const useExpenseLedgers = (search: string, page: number) => useLedgers(search, page);

/** Resolve one of the fixed invoice categories to its exact company expense ledger. */
export function useExpenseLedgerByName(name: string | null) {
  const { data: companyId } = useExpenseBillCompanyId();

  return useQuery({
    queryKey: ["expense-bill-ledger-by-name", companyId, name],
    queryFn: async (): Promise<LedgerOption | null> => {
      if (!companyId || !name) return null;

      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_type, account_group, company_id")
        .eq("is_active", true)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .in("account_type", ["INDIRECT_EXPENSES", "DIRECT_EXPENSES"])
        .ilike("account_name", name)
        .limit(20);
      if (error) throw error;

      const normalizedName = name.trim().toLowerCase();
      const matches = (data ?? []).filter(
        (row) => String(row.account_name || "").trim().toLowerCase() === normalizedName,
      );
      const match =
        matches.find((row) => row.company_id === companyId) ??
        matches.find((row) => row.company_id == null);

      return match
        ? {
            id: match.id,
            code: match.account_code,
            name: match.account_name,
            type: match.account_type,
            group: match.account_group,
          }
        : null;
    },
    enabled: Boolean(companyId && name),
  });
}

/** Cash and bank accounts a payment can be made from. */
export function useCashBankLedgers() {
  const { data: companyId } = useExpenseBillCompanyId();
  return useQuery({
    queryKey: ["expense-bill-cash-bank", companyId],
    queryFn: async (): Promise<LedgerOption[]> => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, account_code, account_name, account_group, company_id")
        .eq("is_active", true)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .in("account_group", ["BANK", "CASH", "Bank Accounts", "Cash-in-Hand"])
        .order("account_name");
      if (error) throw error;
      const best = new Map<string, any>();
      for (const row of (data ?? []) as any[]) {
        const key = String(row.account_name || "").trim().toLowerCase();
        const held = best.get(key);
        if (!held || (row.company_id === companyId && held.company_id !== companyId)) best.set(key, row);
      }
      return [...best.values()].map((r: any) => ({
        id: r.id,
        code: r.account_code,
        name: r.account_name,
      }));
    },
    enabled: Boolean(companyId),
  });
}

/** Recently recorded bills and what is still owed on each. */
export function useOutstandingBills(limit = 25) {
  const { data: companyId } = useExpenseBillCompanyId();
  return useQuery({
    queryKey: ["expense-bills-outstanding", companyId, limit],
    queryFn: async (): Promise<OutstandingBill[]> => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("v_expense_bills_outstanding" as any)
        .select("*")
        .eq("company_id", companyId)
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
    enabled: Boolean(companyId),
  });
}

export interface NewExpenseBill {
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  partyLedgerId: string;
  expenseLedgerId: string;
  companyId: string;
  amount: number;
  narration: string;
  file: File;
}

/**
 * Records the bill. The journal entry is posted by a database trigger, so
 * nothing here writes to the ledger - the invoice is the only thing the user
 * submits.
 */
export function useRecordExpenseBill() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (bill: NewExpenseBill) => {
      if (!bill.companyId) throw new Error("The accounting company could not be resolved.");
      if (!bill.file) throw new Error("Attach the approved invoice before recording it.");

      // Upload first. A bill saved without its evidence is harder to chase
      // than one that failed outright and can simply be retried.
      const ext = bill.file.name.split(".").pop() || "bin";
      const documentPath = `expense-bills/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(documentPath, bill.file);
      if (upErr) throw new Error(`Could not upload the invoice: ${upErr.message}`);
      const documentUrl =
        supabase.storage.from(BUCKET).getPublicUrl(documentPath).data?.publicUrl ?? null;
      if (!documentUrl) {
        await supabase.storage.from(BUCKET).remove([documentPath]);
        throw new Error("Could not create a URL for the uploaded invoice.");
      }

      const { data, error } = await supabase
        .from("expense_bills" as any)
        .insert({
          bill_number: bill.billNumber.trim(),
          bill_date: bill.billDate,
          due_date: bill.dueDate,
          party_ledger_id: bill.partyLedgerId,
          expense_ledger_id: bill.expenseLedgerId,
          company_id: bill.companyId,
          amount: bill.amount,
          narration: bill.narration.trim() || null,
          document_path: documentPath,
          document_url: documentUrl,
          created_by: user?.email ?? "tablet",
        })
        .select("id")
        .single();

      if (error) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([documentPath]);
        if (cleanupError) console.error("Could not remove rejected invoice upload:", cleanupError);
        throw error;
      }
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
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (p: BillPayment): Promise<string> => {
      const { data, error } = await (supabase as any).rpc("record_expense_bill_payment", {
        p_bill_id: p.billId,
        p_amount: p.amount,
        p_bank_account_id: p.bankAccountId,
        p_payment_date: p.paymentDate,
        p_created_by: user?.email ?? "tablet",
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expense-bills-outstanding"] });
    },
  });
}
