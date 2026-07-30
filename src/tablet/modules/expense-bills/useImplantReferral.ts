import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useExpenseBillCompanyId } from "./useExpenseBills";

/** The chart-of-accounts code every referral and implant commission debits. */
export const REFERRAL_EXPENSE_CODE = "5130";

/** One unbilled relationship-manager cut, with everything needed to judge it. */
export interface ImplantReferralRow {
  id: string;
  entryDate: string;
  patientName: string;
  uhid: string | null;
  billNumber: string | null;
  consultant: string | null;
  rmName: string | null;
  /** Null when no active manager of that name carries a ledger. */
  ledgerId: string | null;
  ledgerName: string | null;
  amount: number;
  hospitalType: string | null;
}

const normalise = (value: string | null | undefined) =>
  (value || "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Cuts waiting to be billed to a relationship manager.
 *
 * daily_revenue_entries holds the RM's cut per visit but has no foreign key to
 * the manager — it matches by name, the same way the Daily Revenue Report does
 * — so the manager, their ledger, the patient and the bill are stitched
 * together here rather than by the database.
 */
export function useImplantReferralRows() {
  const { hospitalConfig } = useAuth();
  const hospital = hospitalConfig?.name || null;

  return useQuery({
    queryKey: ["implant-referral-pending", hospital],
    staleTime: 30_000,
    queryFn: async (): Promise<ImplantReferralRow[]> => {
      let query = (supabase as any)
        .from("daily_revenue_entries")
        .select("id, entry_date, visit_id, patient_name, department, rm_name, cut, hospital_type")
        .gt("cut", 0)
        .eq("is_hidden", false)
        .is("approval_id", null)
        .order("entry_date", { ascending: false })
        .limit(1000);
      if (hospital) query = query.eq("hospital_type", hospital);

      const { data: entries, error } = await query;
      if (error) throw error;
      const rows = (entries || []) as any[];
      if (rows.length === 0) return [];

      // DIRECT is the report's marker for "no relationship manager". There is
      // nobody to pay, so it never belongs on an approval list.
      const payable = rows.filter((row) => normalise(row.rm_name) !== "direct" && row.rm_name);

      const visitIds = Array.from(
        new Set(payable.map((row) => row.visit_id).filter(Boolean)),
      ) as string[];

      const visitsRes = visitIds.length
        ? await (supabase as any)
            .from("visits")
            .select("id, visit_id, appointment_with, patients(patients_id, name)")
            .in("id", visitIds)
        : { data: [] };

      const visitById = new Map<string, any>(
        ((visitsRes.data || []) as any[]).map((v) => [v.id, v]),
      );
      // bills.visit_id holds the visit's printed code (IH26F27023), not the
      // visits row id, so the bill has to be looked up by that code.
      const visitCodes = Array.from(
        new Set(
          ((visitsRes.data || []) as any[]).map((v) => v.visit_id).filter(Boolean),
        ),
      ) as string[];

      const [billsRes, managersRes] = await Promise.all([
        visitCodes.length
          ? (supabase as any)
              .from("bills")
              .select("visit_id, bill_no, formatted_bill_no")
              .in("visit_id", visitCodes)
          : Promise.resolve({ data: [] }),
        (supabase as any)
          .from("relationship_managers")
          .select("name, ledger_account_id, is_hidden")
          .eq("is_hidden", false),
      ]);

      const billByVisitCode = new Map<string, any>(
        ((billsRes.data || []) as any[]).map((b) => [b.visit_id, b]),
      );
      const ledgerIds = Array.from(
        new Set(
          ((managersRes.data || []) as any[])
            .map((m) => m.ledger_account_id)
            .filter(Boolean),
        ),
      ) as string[];

      const { data: ledgers } = ledgerIds.length
        ? await (supabase as any)
            .from("chart_of_accounts")
            .select("id, account_name")
            .in("id", ledgerIds)
        : { data: [] };
      const ledgerById = new Map<string, any>(
        ((ledgers || []) as any[]).map((l) => [l.id, l]),
      );
      const managerByName = new Map<string, any>(
        ((managersRes.data || []) as any[]).map((m) => [normalise(m.name), m]),
      );

      return payable.map((row): ImplantReferralRow => {
        const visit = row.visit_id ? visitById.get(row.visit_id) : null;
        const patient = Array.isArray(visit?.patients) ? visit.patients[0] : visit?.patients;
        const bill = visit?.visit_id ? billByVisitCode.get(visit.visit_id) : null;
        const manager = managerByName.get(normalise(row.rm_name));
        const ledger = manager?.ledger_account_id
          ? ledgerById.get(manager.ledger_account_id)
          : null;

        return {
          id: row.id,
          entryDate: row.entry_date,
          patientName: row.patient_name || patient?.name || "Unknown",
          uhid: patient?.patients_id ?? null,
          // The bill register is thin, so the visit number stands in when a
          // bill has not been raised. Both identify the episode being paid on.
          billNumber: bill?.formatted_bill_no || bill?.bill_no || visit?.visit_id || null,
          consultant: row.department || visit?.appointment_with || null,
          rmName: row.rm_name,
          ledgerId: manager?.ledger_account_id ?? null,
          ledgerName: ledger?.account_name ?? null,
          amount: Number(row.cut) || 0,
          hospitalType: row.hospital_type ?? null,
        };
      });
    },
  });
}

/** The debit side of every entry this dashboard raises. */
export function useReferralExpenseLedger() {
  return useQuery({
    queryKey: ["referral-expense-ledger"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_code, account_name")
        .eq("account_code", REFERRAL_EXPENSE_CODE)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; account_code: string; account_name: string } | null;
    },
  });
}

/**
 * Raises one pending expense invoice per relationship manager and stamps it on
 * every cut it covers.
 *
 * Nothing posts here. The invoice waits in the approval queue exactly as a
 * vendor bill does, and the JV is written when it is approved there — which is
 * why a manager with no ledger is refused rather than sent to a generic
 * creditor: an unnamed party defeats the point of approving it.
 */
export function useApproveImplantReferral() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: companyId } = useExpenseBillCompanyId();
  const { data: expenseLedger } = useReferralExpenseLedger();

  return useMutation({
    mutationFn: async (rows: ImplantReferralRow[]) => {
      if (!rows.length) throw new Error("Nothing selected to approve");
      if (!companyId) throw new Error("This hospital has no accounting company");
      if (!expenseLedger?.id) {
        throw new Error(
          `Ledger ${REFERRAL_EXPENSE_CODE} Referral & Implant Commission does not exist yet`,
        );
      }

      const unmapped = rows.filter((row) => !row.ledgerId);
      if (unmapped.length) {
        throw new Error(
          `${unmapped.length} row(s) belong to a manager with no ledger. Map them on the Relationship Manager master first.`,
        );
      }

      // One invoice per manager: that is what the manager is owed, and it is
      // what they would present a bill for.
      const byLedger = new Map<string, ImplantReferralRow[]>();
      for (const row of rows) {
        const list = byLedger.get(row.ledgerId!) || [];
        list.push(row);
        byLedger.set(row.ledgerId!, list);
      }

      let invoices = 0;
      let total = 0;

      for (const [ledgerId, ledgerRows] of byLedger) {
        const amount = ledgerRows.reduce((sum, row) => sum + row.amount, 0);
        if (amount <= 0) continue;

        const dates = ledgerRows.map((row) => row.entryDate).sort();
        const narration =
          `Referral and implant commission, ${ledgerRows.length} patient(s), ` +
          (dates[0] === dates[dates.length - 1]
            ? dates[0]
            : `${dates[0]} to ${dates[dates.length - 1]}`);

        const { data: approval, error } = await (supabase as any)
          .from("approval_queue")
          .insert({
            company_id: companyId,
            category: "REFERRAL",
            party_name: ledgerRows[0].rmName,
            amount,
            expense_account_id: expenseLedger.id,
            party_account_id: ledgerId,
            narration,
            status: "PENDING",
            created_by: user?.username || "implant-referral-dashboard",
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);

        // Stamping the invoice on each cut is what keeps it off this list.
        const { error: stampError } = await (supabase as any)
          .from("daily_revenue_entries")
          .update({ approval_id: approval.id, updated_at: new Date().toISOString() })
          .in("id", ledgerRows.map((row) => row.id));
        if (stampError) throw new Error(stampError.message);

        invoices += 1;
        total += amount;
      }

      return { invoices, total };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["implant-referral-pending"] });
      queryClient.invalidateQueries({ queryKey: ["approval-queue"] });
    },
  });
}
