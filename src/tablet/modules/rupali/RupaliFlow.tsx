import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Pencil, User } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { Textarea } from "@/components/ui/textarea";
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
  patient_category: string | null;
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
  // Which hospital's patients are searched — and whose books get the JV.
  const [searchHospital, setSearchHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [amount, setAmount] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);
  // Paying a doctor less than the standard — for a patient who cannot afford
  // the full charge — has to say why, and who allowed it.
  const [reductionReason, setReductionReason] = useState("");
  const [reductionApprovedBy, setReductionApprovedBy] = useState("");

  // Active master rules for the chosen category — the source of the
  // auto-fetched amount. The flow works without them (manual amount).
  const { data: rules = [] } = useQuery({
    queryKey: ["rupali-rules", category],
    enabled: !!category,
    queryFn: async (): Promise<ChargeRule[]> => {
      const { data, error } = await (supabase as any)
        .from("rupali_charge_rules")
        .select("id, category, doctor_id, doctor_name, purpose_reason, patient_category, amount")
        .eq("category", category)
        .eq("is_active", true)
        .order("doctor_name")
        .order("purpose_reason");
      if (error) return []; // master not migrated yet — flow still works manually
      return (data || []) as ChargeRule[];
    },
  });

  // One doctor master for BOTH hospitals (Ruby's rule: the master is shared,
  // only the patient differs). Merge the two consultant tables and dedupe by
  // name; which company the entry posts into still follows the login.
  const { data: doctors = [], isLoading: rulesLoading } = useQuery({
    queryKey: ["rupali-doctors"],
    queryFn: async (): Promise<{ id: string | null; name: string }[]> => {
      const [hope, ayushman] = await Promise.all([
        supabase.from("hope_consultants").select("id, name"),
        supabase.from("ayushman_consultants").select("id, name"),
      ]);
      const seen = new Map<string, { id: string | null; name: string }>();
      for (const row of [...(hope.data || []), ...(ayushman.data || [])]) {
        const name = String(row.name || "").trim();
        if (!name) continue;
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!seen.has(key)) seen.set(key, { id: row.id, name });
      }
      return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  // The standard for the category itself — applies to any doctor, including
  // ones added after the standard was set. A locked standard is the only
  // amount the category admits (a DB trigger refuses anything else).
  const { data: categoryStandard = null } = useQuery({
    queryKey: ["rupali-category-standard", category],
    enabled: !!category,
    queryFn: async (): Promise<{ amount: number; is_locked: boolean } | null> => {
      const { data, error } = await (supabase as any)
        .from("rupali_category_defaults")
        .select("amount, is_locked")
        .eq("category", category)
        .maybeSingle();
      if (error) return null; // standard not migrated yet — flow still works
      return data ? { amount: Number(data.amount), is_locked: !!data.is_locked } : null;
    },
  });
  const lockedAmount = categoryStandard?.is_locked ? categoryStandard.amount : null;

  const purposes = useMemo(
    () =>
      doctor
        ? rules.filter(
            (r) => r.doctor_name.trim().toLowerCase() === doctor.name.trim().toLowerCase(),
          )
        : [],
    [rules, doctor],
  );

  // Direct charging: a doctor with exactly one configured charge gets it
  // applied straight away. Several charges (procedures / patient categories)
  // show as one-tap cards; none configured opens manual entry.
  useEffect(() => {
    if (step !== 4) return;
    // A locked category standard wins over everything: same amount for every
    // doctor, no manual entry.
    if (lockedAmount !== null) {
      // Once Reduce is tapped the user is deliberately paying less than the
      // locked standard, so stop pinning the amount back to it — otherwise
      // the concession is undone on the next render.
      if (editingAmount) return;
      setAmount((prev) => (prev === String(lockedAmount) ? prev : String(lockedAmount)));
      return;
    }
    // Never clobber an amount the user has already started typing (slow rule
    // load opened manual entry first).
    if (!rule && purposes.length === 1 && !editingAmount && !amount) {
      setRule(purposes[0]);
      setAmount(String(purposes[0].amount));
    }
    if (purposes.length === 0 && !editingAmount && !amount) {
      // Fall back to an unlocked category standard before asking for a number.
      if (categoryStandard) setAmount(String(categoryStandard.amount));
      else setEditingAmount(true);
    }
  }, [step, rule, purposes, editingAmount, amount, lockedAmount, categoryStandard]);

  const purpose = rule?.purpose_reason || category || "";

  // What this visit is "supposed to" pay. The database enforces against the
  // category standard; the doctor's own rule can sit above it, so the higher
  // of the two is used here — the screen then never lets through a reduction
  // the server would go on to refuse.
  const benchmark = useMemo(() => {
    const candidates = [rule?.amount, categoryStandard?.amount]
      .map((n) => (n == null ? null : Number(n)))
      .filter((n): n is number => n != null && Number.isFinite(n));
    return candidates.length ? Math.max(...candidates) : null;
  }, [rule, categoryStandard]);

  const enteredAmount = parseFloat(amount || "");
  const isReduced =
    benchmark !== null && Number.isFinite(enteredAmount) && enteredAmount < benchmark;
  const justificationMissing =
    isReduced && (!reductionReason.trim() || !reductionApprovedBy.trim());

  const submit = useMutation({
    mutationFn: async () => {
      const finalAmount = parseFloat(amount);
      if (!category || !doctor || !patient) throw new Error("Incomplete entry");
      if (!Number.isFinite(finalAmount) || finalAmount < 0) {
        throw new Error("Enter a valid amount");
      }
      if (justificationMissing) {
        throw new Error("A reduced payment needs a reason and who approved it");
      }
      // Posts the register row AND the Journal Voucher (Dr Consultation &
      // Visit Charges / Cr the doctor's ledger) in the hospital's own
      // company, atomically.
      const { data, error } = await (supabase as any).rpc("record_rupali_visit", {
        p_category: category,
        p_doctor_id: doctor.id,
        p_doctor_name: doctor.name,
        p_patient_id: patient.id,
        p_patient_name: patient.name,
        p_purpose: purpose,
        p_amount: finalAmount,
        p_hospital_type: searchHospital,
        p_created_by: user?.email || user?.id || null,
        p_patient_category: rule?.patient_category ?? null,
        // Only meaningful on a reduction; the server ignores them otherwise.
        p_reduction_reason: isReduced ? reductionReason.trim() : null,
        p_reduction_approved_by: isReduced ? reductionApprovedBy.trim() : null,
      });
      if (error) throw new Error(error.message);
      return { finalAmount, voucherNumber: (data as any)?.voucherNumber as string | undefined };
    },
    onSuccess: ({ finalAmount, voucherNumber }) => {
      toast.success(
        `Recorded ₹${finalAmount.toLocaleString("en-IN")} — ${patient?.name}, ${purpose}${voucherNumber ? ` (${voucherNumber})` : ""}.`,
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
      setReductionReason("");
      setReductionApprovedBy("");
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
      setReductionReason("");
      setReductionApprovedBy("");
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
          hospital={searchHospital}
          onHospitalChange={setSearchHospital}
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
            disabled={!amount || submit.isPending || justificationMissing}
            onClick={() => submit.mutate()}
            title={justificationMissing ? "Fill the reason and who approved the reduction" : undefined}
          >
            <Check className="mr-2 h-5 w-5" />
            {submit.isPending
              ? "Saving…"
              : justificationMissing
                ? "Reason & approver needed"
                : `Submit${amount ? ` — ₹${parseFloat(amount || "0").toLocaleString("en-IN")}` : ""}`}
          </TabletButton>
        </div>
      }
    >
      <div className="space-y-4">
        {purposes.length > 1 && (
          <div>
            <TabletLabel>Which charge applies?</TabletLabel>
            <div className="mt-2 grid gap-2">
              {purposes.map((p) => (
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
                  <span className="text-base font-medium">
                    {p.purpose_reason}
                    {p.patient_category && p.patient_category !== "Any" && (
                      <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {p.patient_category}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-lg font-bold">
                    ₹{Number(p.amount).toLocaleString("en-IN")}
                  </span>
                </TabletCard>
              ))}
            </div>
          </div>
        )}
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
                <Pencil className="h-4 w-4" />
                {lockedAmount === null ? "Override" : "Reduce"}
              </button>
            )}
          </div>
          {lockedAmount !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Standard {category} visit charge — ₹{lockedAmount.toLocaleString("en-IN")} for
              every doctor. It can only be reduced, never raised, and a reduction needs a
              reason and an approver.
            </p>
          ) : rule ? (
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

          {/* A concession is a decision, not a typo — the register keeps the
              reason and the name of whoever allowed it, and refuses the entry
              without both. */}
          {isReduced && (
            <div className="mt-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                Paying ₹{enteredAmount.toLocaleString("en-IN")} instead of ₹
                {benchmark!.toLocaleString("en-IN")} — a reduction of ₹
                {(benchmark! - enteredAmount).toLocaleString("en-IN")}. Both fields are
                required.
              </p>
              <div>
                <TabletLabel>Reason for paying less *</TabletLabel>
                <Textarea
                  value={reductionReason}
                  onChange={(e) => setReductionReason(e.target.value)}
                  placeholder="e.g. patient could not afford the full charge — concession agreed"
                  rows={2}
                  className="mt-1 bg-background"
                />
              </div>
              <div>
                <TabletLabel>Approved by *</TabletLabel>
                <TabletInput
                  value={reductionApprovedBy}
                  onChange={(e) => setReductionApprovedBy(e.target.value)}
                  placeholder="Who allowed the reduction"
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </FlowScaffold>
  );
}
