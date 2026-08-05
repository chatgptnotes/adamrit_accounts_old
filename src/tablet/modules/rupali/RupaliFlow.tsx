import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Pencil, User } from "lucide-react";
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

// DATA SOURCE: rupali_charge_rules (the Rupali Master) -> rupali_visit_logs

const CATEGORIES = ["OPD", "IPD", "Procedure"] as const;
type Category = (typeof CATEGORIES)[number];

interface ChargeRule {
  id: string;
  category: Category;
  doctor_id: string | null;
  doctor_name: string;
  purpose_reason: string;
  amount: number;
}

/**
 * Rupali operational register: category -> doctor -> patient -> amount, four
 * taps and done. The amount comes from the Rupali Master for the chosen
 * category + doctor + purpose; it can be overridden before submitting.
 * Every submission is an append-only row in rupali_visit_logs.
 */
export default function RupaliFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<Category | null>(null);
  const [doctor, setDoctor] = useState<{ id: string | null; name: string } | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [rule, setRule] = useState<ChargeRule | null>(null);
  const [amount, setAmount] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);

  // Active master rules for the chosen category. Doctors and purposes both
  // come from here, so the flow always mirrors the Rupali Master exactly.
  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ["rupali-rules", category],
    enabled: !!category,
    queryFn: async (): Promise<ChargeRule[]> => {
      const { data, error } = await (supabase as any)
        .from("rupali_charge_rules")
        .select("id, category, doctor_id, doctor_name, purpose_reason, amount")
        .eq("category", category)
        .eq("is_active", true)
        .order("doctor_name")
        .order("purpose_reason");
      if (error) throw error;
      return (data || []) as ChargeRule[];
    },
  });

  const doctors = useMemo(() => {
    const seen = new Map<string, { id: string | null; name: string }>();
    for (const r of rules) {
      const key = r.doctor_name.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, { id: r.doctor_id, name: r.doctor_name });
    }
    return Array.from(seen.values());
  }, [rules]);

  const purposes = useMemo(
    () =>
      doctor
        ? rules.filter(
            (r) => r.doctor_name.trim().toLowerCase() === doctor.name.trim().toLowerCase(),
          )
        : [],
    [rules, doctor],
  );

  const submit = useMutation({
    mutationFn: async () => {
      const finalAmount = parseFloat(amount);
      if (!category || !doctor || !patient || !rule) throw new Error("Incomplete entry");
      if (!Number.isFinite(finalAmount) || finalAmount < 0) {
        throw new Error("Enter a valid amount");
      }
      const { error } = await (supabase as any).from("rupali_visit_logs").insert({
        category,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        patient_id: patient.id,
        patient_name: patient.name,
        purpose_reason: rule.purpose_reason,
        amount: finalAmount,
        created_by: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return finalAmount;
    },
    onSuccess: (finalAmount) => {
      toast.success(
        `Recorded ₹${finalAmount.toLocaleString("en-IN")} — ${patient?.name}, ${rule?.purpose_reason}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["rupali-logs"] });
      // Straight back to step 1 for the next entry.
      setStep(1);
      setCategory(null);
      setDoctor(null);
      setPatient(null);
      setRule(null);
      setAmount("");
      setEditingAmount(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the entry"),
  });

  const back = () => {
    if (step === 2) {
      setDoctor(null);
      setStep(1);
    } else if (step === 3) {
      setPatient(null);
      setStep(2);
    } else if (step === 4) {
      setRule(null);
      setAmount("");
      setEditingAmount(false);
      setStep(3);
    }
  };

  const backButton =
    step > 1 ? (
      <TabletButton variant="outline" onClick={back} disabled={submit.isPending}>
        <ChevronLeft className="mr-1 h-5 w-5" /> Back
      </TabletButton>
    ) : null;

  // ---- Step 1: category ----
  if (step === 1) {
    return (
      <FlowScaffold
        step={1}
        totalSteps={4}
        heading="Rupali Register"
        subheading="What kind of visit is this?"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <TabletButton
              key={c}
              variant={category === c ? "default" : "outline"}
              className="min-h-[72px] text-xl"
              onClick={() => {
                setCategory(c);
                setStep(2);
              }}
            >
              {c}
            </TabletButton>
          ))}
        </div>
      </FlowScaffold>
    );
  }

  // ---- Step 2: doctor ----
  if (step === 2) {
    return (
      <FlowScaffold
        step={2}
        totalSteps={4}
        heading={`${category} — select doctor`}
        subheading="Doctors with charges configured in the Rupali Master"
        actions={backButton}
      >
        {rulesLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading doctors…</p>
        ) : doctors.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No {category} charges are configured yet. Add them in the Rupali Master first.
          </p>
        ) : (
          <div className="grid gap-2">
            {doctors.map((d) => (
              <TabletCard
                key={d.name}
                className="flex cursor-pointer items-center gap-3 p-4 active:scale-[0.99]"
                onClick={() => {
                  setDoctor(d);
                  setStep(3);
                }}
              >
                <User className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-semibold">{d.name}</span>
              </TabletCard>
            ))}
          </div>
        )}
      </FlowScaffold>
    );
  }

  // ---- Step 3: patient ----
  if (step === 3) {
    return (
      <FlowScaffold
        step={3}
        totalSteps={4}
        heading={`${category} · ${doctor?.name}`}
        actions={backButton}
      >
        <TabletPatientPicker
          heading="Find the patient"
          hint="Search by name, patient ID or mobile number"
          onSelect={(p) => {
            setPatient(p);
            setStep(4);
          }}
        />
      </FlowScaffold>
    );
  }

  // ---- Step 4: purpose + amount + submit ----
  return (
    <FlowScaffold
      step={4}
      totalSteps={4}
      heading={patient?.name || "Amount"}
      subheading={`${category} · ${doctor?.name}`}
      actions={
        <div className="flex w-full gap-3">
          {backButton}
          <TabletButton
            className="flex-1"
            disabled={!rule || submit.isPending}
            onClick={() => submit.mutate()}
          >
            <Check className="mr-2 h-5 w-5" />
            {submit.isPending
              ? "Saving…"
              : `Submit${amount ? ` — ₹${parseFloat(amount || "0").toLocaleString("en-IN")}` : ""}`}
          </TabletButton>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <TabletLabel>Purpose / Reason</TabletLabel>
          <div className="mt-2 grid gap-2">
            {purposes.length === 0 ? (
              <p className="text-muted-foreground">
                No purposes configured for {doctor?.name} under {category}.
              </p>
            ) : (
              purposes.map((p) => (
                <TabletCard
                  key={p.id}
                  className={cn(
                    "flex cursor-pointer items-center justify-between p-4 active:scale-[0.99]",
                    rule?.id === p.id && "border-primary ring-2 ring-primary/30",
                  )}
                  onClick={() => {
                    setRule(p);
                    setAmount(String(p.amount));
                    setEditingAmount(false);
                  }}
                >
                  <span className="text-base font-medium">{p.purpose_reason}</span>
                  <span className="font-mono text-lg font-bold">
                    ₹{Number(p.amount).toLocaleString("en-IN")}
                  </span>
                </TabletCard>
              ))
            )}
          </div>
        </div>

        {rule && (
          <div>
            <TabletLabel>Amount</TabletLabel>
            <div className="mt-2 flex items-center gap-3">
              {editingAmount ? (
                <TabletInput
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="max-w-[200px] text-right font-mono text-xl"
                  autoFocus
                />
              ) : (
                <span className="font-mono text-3xl font-bold">
                  ₹{parseFloat(amount || "0").toLocaleString("en-IN")}
                </span>
              )}
              {!editingAmount && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-sm font-medium text-primary"
                  onClick={() => setEditingAmount(true)}
                >
                  <Pencil className="h-4 w-4" /> Override
                </button>
              )}
            </div>
            {editingAmount && parseFloat(amount || "0") !== rule.amount && (
              <p className="mt-1 text-sm text-amber-600">
                Standard charge is ₹{Number(rule.amount).toLocaleString("en-IN")} — this entry
                will record the overridden amount.
              </p>
            )}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}
