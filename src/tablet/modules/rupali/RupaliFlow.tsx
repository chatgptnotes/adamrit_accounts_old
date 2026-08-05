import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Pencil, User } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: rupali_charge_rules (the Rupali Master) -> rupali_visit_logs

const CATEGORIES = ["OPD", "IPD", "Procedure", "Day Care"] as const;
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
 * taps and done. The charge comes straight from the master for the chosen
 * category + doctor; it can be overridden before submitting.
 * Every submission is an append-only row in rupali_visit_logs.
 */
export default function RupaliFlow() {
  const { user, hospitalType } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<Category | null>(null);
  const [doctor, setDoctor] = useState<{ id: string | null; name: string } | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [rule, setRule] = useState<ChargeRule | null>(null);
  const [doctorSearch, setDoctorSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);

  // Active master rules for the chosen category — the source of the
  // auto-fetched amount. The flow works without them (manual amount).
  const { data: rules = [] } = useQuery({
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
      if (error) return []; // master not migrated yet — flow still works manually
      return (data || []) as ChargeRule[];
    },
  });

  // Every active doctor from this hospital's consultant master, so the flow
  // never depends on the Rupali Master being filled in first.
  const { data: doctors = [], isLoading: rulesLoading } = useQuery({
    queryKey: ["rupali-doctors", hospitalType],
    queryFn: async (): Promise<{ id: string | null; name: string }[]> => {
      const table =
        hospitalType === "ayushman" ? "ayushman_consultants" : "hope_consultants";
      const { data, error } = await supabase
        .from(table)
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const purposes = useMemo(
    () =>
      doctor
        ? rules.filter(
            (r) => r.doctor_name.trim().toLowerCase() === doctor.name.trim().toLowerCase(),
          )
        : [],
    [rules, doctor],
  );

  // Direct charging: reaching the amount step applies the doctor's configured
  // charge for this category straight away. No purpose picking — the register
  // records the rule's purpose when one matched, else the category itself.
  useEffect(() => {
    if (step === 4 && !rule && purposes.length > 0) {
      setRule(purposes[0]);
      setAmount(String(purposes[0].amount));
      setEditingAmount(false);
    }
    if (step === 4 && purposes.length === 0 && !editingAmount && !amount) {
      setEditingAmount(true);
    }
  }, [step, rule, purposes, editingAmount, amount]);

  const purpose = rule?.purpose_reason || category || "";

  const submit = useMutation({
    mutationFn: async () => {
      const finalAmount = parseFloat(amount);
      if (!category || !doctor || !patient) throw new Error("Incomplete entry");
      if (!purpose) throw new Error("Pick or type the purpose of the visit");
      if (!Number.isFinite(finalAmount) || finalAmount < 0) {
        throw new Error("Enter a valid amount");
      }
      const { error } = await (supabase as any).from("rupali_visit_logs").insert({
        category,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        patient_id: patient.id,
        patient_name: patient.name,
        purpose_reason: purpose,
        amount: finalAmount,
        created_by: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return finalAmount;
    },
    onSuccess: (finalAmount) => {
      toast.success(
        `Recorded ₹${finalAmount.toLocaleString("en-IN")} — ${patient?.name}, ${purpose}.`,
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        actions={backButton}
      >
        {rulesLoading ? (
          <p className="py-8 text-center text-muted-foreground">Loading doctors…</p>
        ) : doctors.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No doctors found in the consultant master.
          </p>
        ) : (
          <div className="space-y-3">
            <TabletInput
              value={doctorSearch}
              onChange={(e) => setDoctorSearch(e.target.value)}
              placeholder="Search doctor by name…"
              autoFocus
            />
            <div className="grid gap-2">
              {doctors
                .filter((d) =>
                  d.name.toLowerCase().includes(doctorSearch.trim().toLowerCase()),
                )
                .map((d) => (
                  <TabletCard
                    key={d.name}
                    className="flex cursor-pointer items-center gap-3 p-4 active:scale-[0.99]"
                    onClick={() => {
                      setDoctor(d);
                      setDoctorSearch("");
                      setStep(3);
                    }}
                  >
                    <User className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="text-lg font-semibold">{d.name}</span>
                  </TabletCard>
                ))}
            </div>
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
            disabled={!amount || submit.isPending}
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
          {rule ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {rule.purpose_reason} — standard charge for {doctor?.name} ({category}).
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No standard charge configured for {doctor?.name} under {category} — enter the
              amount.
            </p>
          )}
          {rule && editingAmount && parseFloat(amount || "0") !== rule.amount && (
            <p className="mt-1 text-sm text-amber-600">
              Standard charge is ₹{Number(rule.amount).toLocaleString("en-IN")} — this entry
              will record the overridden amount.
            </p>
          )}
        </div>
      </div>
    </FlowScaffold>
  );
}
