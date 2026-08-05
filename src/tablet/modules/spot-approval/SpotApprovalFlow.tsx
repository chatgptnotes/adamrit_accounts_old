import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { Check, ChevronLeft, Landmark, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: chart_of_accounts (referee ledger) + advance_payment (deposit
// receipts) -> spot_payment_approvals

const DEFAULT_SPOT = 5000;
const MAX_SPOT = 8000;

interface RefereeLedger {
  id: string;
  account_name: string;
  account_code: string | null;
}

/**
 * Spot: the on-the-spot counter commission paid to certain regular referees
 * when their patient is admitted. Azhar / Arpit / Suraj approve each one
 * here: referee's ledger, patient, the deposit already paid (pulled from the
 * paid receipts) or an instruction to collect one, and the maximum spot —
 * 5,000 by default, raisable to 8,000 and never beyond.
 */
export default function SpotApprovalFlow() {
  const { user, hospitalType } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [ledger, setLedger] = useState<RefereeLedger | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [depositToCollect, setDepositToCollect] = useState("");
  const [maxSpot, setMaxSpot] = useState(String(DEFAULT_SPOT));
  const [debouncedSearch] = useDebounce(ledgerSearch, 250);

  // Referee ledgers: type-to-search over the chart, same rule as everywhere
  // else in accounting — what is picked must already exist as a ledger.
  const { data: ledgerOptions = [], isFetching: ledgersLoading } = useQuery({
    queryKey: ["spot-referee-ledgers", debouncedSearch],
    enabled: debouncedSearch.trim().length >= 2,
    queryFn: async (): Promise<RefereeLedger[]> => {
      const term = debouncedSearch.trim().replace(/[,()]/g, " ");
      const { data, error } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name, account_code")
        .eq("is_active", true)
        .or(`account_name.ilike.%${term}%,account_code.ilike.%${term}%`)
        .order("account_name")
        .limit(15);
      if (error) throw error;
      return (data || []) as RefereeLedger[];
    },
  });

  // The deposit the patient has already paid: their receipts on the latest
  // visit (advance_payment is where collections actually live).
  const { data: deposit, isLoading: depositLoading } = useQuery({
    queryKey: ["spot-deposit", patient?.id],
    enabled: !!patient?.id,
    queryFn: async (): Promise<{ amount: number; visitId: string | null }> => {
      const { data, error } = await (supabase as any)
        .from("advance_payment")
        .select("visit_id, advance_amount, returned_amount, status, created_at")
        .eq("patient_id", patient!.id)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data || []) as {
        visit_id: string;
        advance_amount: number;
        returned_amount: number | null;
      }[];
      if (rows.length === 0) return { amount: 0, visitId: null };
      const visitId = rows[0].visit_id;
      const amount = rows
        .filter((r) => r.visit_id === visitId)
        .reduce((s, r) => s + (Number(r.advance_amount) || 0) - (Number(r.returned_amount) || 0), 0);
      return { amount, visitId };
    },
  });

  // The 8,000 ceiling holds while typing, not just on save.
  useEffect(() => {
    const n = parseFloat(maxSpot);
    if (Number.isFinite(n) && n > MAX_SPOT) setMaxSpot(String(MAX_SPOT));
  }, [maxSpot]);

  const approve = useMutation({
    mutationFn: async () => {
      const spot = parseFloat(maxSpot);
      const collect = depositToCollect.trim() === "" ? null : parseFloat(depositToCollect);
      if (!ledger || !patient) throw new Error("Incomplete approval");
      if (!Number.isFinite(spot) || spot <= 0 || spot > MAX_SPOT) {
        throw new Error(`Maximum spot must be between 1 and ${MAX_SPOT.toLocaleString("en-IN")}`);
      }
      if (collect !== null && (!Number.isFinite(collect) || collect < 0)) {
        throw new Error("Enter a valid deposit amount to collect");
      }
      // One call records the approval AND posts the M.L. Enterprises implant
      // invoice on the hospital plus the sale + referee-commission journals
      // in ML's books — the same machinery as the revenue-report cuts.
      const { data, error } = await (supabase as any).rpc("record_spot_approval", {
        p_referee_ledger_id: ledger.id,
        p_patient_id: patient.id,
        p_patient_name: patient.name,
        p_visit_id: deposit?.visitId ?? null,
        p_deposit_paid: deposit?.amount ?? 0,
        p_deposit_to_collect: collect,
        p_max_spot: spot,
        p_hospital_type: hospitalType,
        p_approved_by: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return { spot, invoice: (data as any)?.invoiceNumber as string | undefined };
    },
    onSuccess: ({ spot, invoice }) => {
      toast.success(
        `Spot approved — ${ledger?.account_name} for ${patient?.name}, up to ₹${spot.toLocaleString("en-IN")}${invoice ? ` (invoice ${invoice})` : ""}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["spot-approvals"] });
      setStep(1);
      setLedger(null);
      setLedgerSearch("");
      setPatient(null);
      setDepositToCollect("");
      setMaxSpot(String(DEFAULT_SPOT));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the approval"),
  });

  const back = () => {
    if (step === 2) {
      setPatient(null);
      setStep(1);
    } else if (step === 3) {
      setDepositToCollect("");
      setMaxSpot(String(DEFAULT_SPOT));
      setStep(2);
    }
  };

  const backButton =
    step > 1 ? (
      <TabletButton variant="outline" onClick={back} disabled={approve.isPending}>
        <ChevronLeft className="mr-1 h-5 w-5" /> Back
      </TabletButton>
    ) : null;

  // ---- Step 1: the referee's ledger ----
  if (step === 1) {
    return (
      <FlowScaffold
        step={1}
        totalSteps={3}
        heading="Spot Approval"
        subheading="Whose referee ledger is this spot for?"
      >
        <div className="space-y-3">
          <TabletInput
            value={ledgerSearch}
            onChange={(e) => setLedgerSearch(e.target.value)}
            placeholder="RM / referee ledger — type to search"
            autoFocus
          />
          {ledgersLoading ? (
            <p className="py-4 text-center text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Searching…
            </p>
          ) : (
            <div className="grid gap-2">
              {ledgerOptions.map((option) => (
                <TabletCard
                  key={option.id}
                  className="flex cursor-pointer items-center gap-3 p-4 active:scale-[0.99]"
                  onClick={() => {
                    setLedger(option);
                    setStep(2);
                  }}
                >
                  <Landmark className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-lg font-semibold">
                    {option.account_name}
                  </span>
                  {option.account_code && (
                    <span className="text-xs text-muted-foreground">{option.account_code}</span>
                  )}
                </TabletCard>
              ))}
              {debouncedSearch.trim().length >= 2 && ledgerOptions.length === 0 && (
                <p className="py-4 text-center text-muted-foreground">
                  No ledger matches "{debouncedSearch}".
                </p>
              )}
            </div>
          )}
        </div>
      </FlowScaffold>
    );
  }

  // ---- Step 2: the patient ----
  if (step === 2) {
    return (
      <FlowScaffold step={2} totalSteps={3} heading={ledger?.account_name} actions={backButton}>
        <TabletPatientPicker
          heading="Whose admission is this?"
          hint="Search by name, patient ID or mobile number"
          onSelect={(p) => {
            setPatient(p);
            setStep(3);
          }}
        />
      </FlowScaffold>
    );
  }

  // ---- Step 3: deposit + maximum spot ----
  const spotValue = parseFloat(maxSpot) || 0;
  return (
    <FlowScaffold
      step={3}
      totalSteps={3}
      heading={patient?.name || ""}
      subheading={`Spot for ${ledger?.account_name}`}
      actions={
        <div className="flex w-full gap-3">
          {backButton}
          <TabletButton
            className="flex-1"
            disabled={approve.isPending}
            onClick={() => approve.mutate()}
          >
            <Check className="mr-2 h-5 w-5" />
            {approve.isPending
              ? "Saving…"
              : `Approve — up to ₹${spotValue.toLocaleString("en-IN")}`}
          </TabletButton>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <TabletLabel>Deposit paid by patient</TabletLabel>
          {depositLoading ? (
            <p className="mt-1 text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Checking receipts…
            </p>
          ) : (
            <>
              <p className="mt-1 font-mono text-3xl font-bold">
                ₹{(deposit?.amount ?? 0).toLocaleString("en-IN")}
              </p>
              <p className="text-sm text-muted-foreground">
                {deposit?.visitId
                  ? `From paid receipts on visit ${deposit.visitId}.`
                  : "No receipts found for this patient yet."}
              </p>
            </>
          )}
        </div>

        <div>
          <TabletLabel>Ask for this amount as a deposit (optional)</TabletLabel>
          <TabletInput
            type="number"
            inputMode="decimal"
            value={depositToCollect}
            onChange={(e) => setDepositToCollect(e.target.value)}
            placeholder="Instruction to staff — leave blank if not needed"
            className="mt-1 max-w-[280px]"
          />
        </div>

        <div>
          <TabletLabel>Maximum spot</TabletLabel>
          <TabletInput
            type="number"
            inputMode="decimal"
            value={maxSpot}
            onChange={(e) => setMaxSpot(e.target.value)}
            min={0}
            max={MAX_SPOT}
            className={cn(
              "mt-1 max-w-[200px] font-mono text-xl",
              spotValue > DEFAULT_SPOT && "border-amber-500",
            )}
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Default ₹{DEFAULT_SPOT.toLocaleString("en-IN")} — can be raised to at most ₹
            {MAX_SPOT.toLocaleString("en-IN")}.
          </p>
        </div>
      </div>
    </FlowScaffold>
  );
}
