import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Search, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { cn } from "@/lib/utils";
import { inr, shortDate } from "@/tablet/lib/format";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletNumpad } from "@/tablet/components/TabletNumpad";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletConfirm } from "@/tablet/components/TabletConfirm";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { DictationTextarea } from "@/tablet/components/DictationTextarea";
import { syncPortalDataForRegistrationId } from "@/lib/governmentPortalReportDb";

const MODES = ["CASH", "CARD", "UPI", "CHEQUE", "NEFT"];

interface AdvanceRow {
  id: string;
  advance_amount: number;
  returned_amount: number;
  is_refund: boolean;
  payment_date: string;
  payment_mode: string;
  status: string;
}

interface VisitRow {
  id: string;
  visit_id: string;
  yojana_registration_id: string | null;
  package_name: string | null;
  corporate: string | null;
}

interface PackageOption {
  id: string;
  name: string;
}

interface ImplantOption {
  id: string;
  name: string;
  nabh_nabl_rate: number | null;
  non_nabh_nabl_rate: number | null;
  private_rate: number | null;
  bhopal_nabh_rate: number | null;
  bhopal_non_nabh_rate: number | null;
}

interface AddedImplant {
  id: string;
  implant_name: string;
  rate: number;
}

const isMaharashtraYojana = (corporate: string | null | undefined) => {
  const value = (corporate || "").toLowerCase().trim();
  return (
    value.includes("yojana") ||
    value.includes("mjpjy") ||
    value.includes("ayushman") ||
    value.includes("mahatma jyotiba") ||
    value.includes("pmjay") ||
    value.includes("ab-pmjay") ||
    value.includes("ab pmjay") ||
    value.includes("maharashtra yojana")
  );
};

const defaultImplantRate = (implant: ImplantOption, corporate: string | null | undefined) => {
  const preferYojana = isMaharashtraYojana(corporate);
  const ordered = preferYojana
    ? [implant.nabh_nabl_rate, implant.private_rate, implant.non_nabh_nabl_rate, implant.bhopal_nabh_rate, implant.bhopal_non_nabh_rate]
    : [implant.private_rate, implant.nabh_nabl_rate, implant.non_nabh_nabl_rate, implant.bhopal_nabh_rate, implant.bhopal_non_nabh_rate];
  return ordered.find((rate) => rate !== null && rate !== undefined) ?? 0;
};

/** Module 6 — view a patient's advance statement, collect an advance, and
 * (once pre-auth is approved) record the registration ID, package and
 * implant for their visit. */
export default function AdvanceFlow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [stage, setStage] = useState<"view" | "collect" | "billing">("view");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  const [remarks, setRemarks] = useState("");
  const [registrationIdInput, setRegistrationIdInput] = useState("");
  const [packageTerm, setPackageTerm] = useState("");
  const [implantTerm, setImplantTerm] = useState("");
  const [selectedImplant, setSelectedImplant] = useState<ImplantOption | null>(null);
  const [implantRate, setImplantRate] = useState("");

  const advances = useQuery({
    queryKey: ["tablet-advances", patient?.id],
    enabled: !!patient,
    queryFn: async (): Promise<AdvanceRow[]> => {
      const { data, error } = await supabase
        .from("advance_payment")
        .select(
          "id, advance_amount, returned_amount, is_refund, payment_date, payment_mode, status",
        )
        .eq("patient_id", patient!.id)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data || []) as AdvanceRow[];
    },
  });

  const visit = useQuery({
    queryKey: ["tablet-advance-visit", patient?.id],
    enabled: !!patient,
    queryFn: async (): Promise<VisitRow | null> => {
      const { data, error } = await supabase
        .from("visits")
        .select("id, visit_id, yojana_registration_id, package_name, corporate")
        .eq("patient_id", patient!.id)
        .order("admission_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as VisitRow | null;
    },
  });

  useEffect(() => {
    setRegistrationIdInput(visit.data?.yojana_registration_id || "");
  }, [visit.data?.id, visit.data?.yojana_registration_id]);

  const preauth = useQuery({
    queryKey: ["tablet-preauth-status", visit.data?.yojana_registration_id],
    enabled: !!visit.data?.yojana_registration_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("government_portal_report_rows")
        .select("status, preauth_approved_amount")
        .eq("registration_id", visit.data!.yojana_registration_id as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const approved =
        !!data && (data.status === "approved" || Number(data.preauth_approved_amount) > 0);
      return { approved };
    },
  });

  const addedImplants = useQuery({
    queryKey: ["tablet-visit-implants", visit.data?.id],
    enabled: !!visit.data?.id,
    queryFn: async (): Promise<AddedImplant[]> => {
      const { data, error } = await supabase
        .from("visit_implants")
        .select("id, implant_name, rate")
        .eq("visit_id", visit.data!.id)
        .eq("status", "Active");
      if (error) throw error;
      return (data || []) as AddedImplant[];
    },
  });

  const packageResults = useQuery({
    queryKey: ["tablet-package-search", packageTerm],
    enabled: packageTerm.trim().length >= 2,
    queryFn: async (): Promise<PackageOption[]> => {
      const term = packageTerm.trim().replace(/[,%()]/g, "");
      const { data, error } = await supabase
        .from("pmjay_mjpjay_packages")
        .select("id, treatment_code, treatment_plan")
        .eq("is_active", true)
        .or(`treatment_plan.ilike.%${term}%,treatment_code.ilike.%${term}%`)
        .limit(15);
      if (error) throw error;
      return (data || [])
        .map((p) => ({ id: p.id, name: [p.treatment_code, p.treatment_plan].filter(Boolean).join(" - ") }))
        .filter((p) => p.name);
    },
  });

  const implantResults = useQuery({
    queryKey: ["tablet-implant-search", implantTerm],
    enabled: implantTerm.trim().length >= 2,
    queryFn: async (): Promise<ImplantOption[]> => {
      const term = implantTerm.trim().replace(/[,%()]/g, "");
      const { data, error } = await supabase
        .from("implants")
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate, bhopal_nabh_rate, bhopal_non_nabh_rate")
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(15);
      if (error) throw error;
      return (data || []) as ImplantOption[];
    },
  });

  const saveRegistrationId = useMutation({
    mutationFn: async () => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const value = registrationIdInput.trim();
      const { error } = await supabase
        .from("visits")
        .update({ yojana_registration_id: value || null })
        .eq("id", visit.data.id);
      if (error) throw error;
      if (!value) return { portalMatched: false };
      try {
        return { portalMatched: await syncPortalDataForRegistrationId(value) };
      } catch {
        return { portalMatched: false };
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit", patient?.id] });
    },
  });

  const savePackage = useMutation({
    mutationFn: async (name: string) => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const { error } = await supabase.from("visits").update({ package_name: name }).eq("id", visit.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit", patient?.id] });
      setPackageTerm("");
    },
  });

  const addImplant = useMutation({
    mutationFn: async () => {
      if (!visit.data || !selectedImplant) throw new Error("Pick an implant first");
      const rate = Number(implantRate) || 0;
      const { error } = await supabase.from("visit_implants").insert({
        implant_id: selectedImplant.id,
        visit_id: visit.data.id,
        implant_name: selectedImplant.name,
        quantity: 1,
        rate,
        amount: rate,
        rate_type: isMaharashtraYojana(visit.data.corporate) ? "nabh_nabl" : "private",
        status: "Active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-visit-implants", visit.data?.id] });
      setSelectedImplant(null);
      setImplantTerm("");
      setImplantRate("");
    },
  });

  const collect = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!patient || !value || value <= 0) throw new Error("Enter a valid amount");
      const { error } = await supabase.from("advance_payment").insert({
        patient_id: patient.id,
        patient_name: patient.name,
        patients_id: patient.patients_id || null,
        advance_amount: value,
        returned_amount: 0,
        is_refund: false,
        payment_date: new Date().toISOString(),
        payment_mode: mode,
        remarks: remarks.trim() || null,
        status: "ACTIVE",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advances", patient?.id] });
    },
  });

  if (!patient) {
    return (
      <TabletPatientPicker
        heading="Advance — select patient"
        hint="Search for the patient to view advances or collect a new one."
        onSelect={setPatient}
      />
    );
  }

  if (collect.isSuccess) {
    return (
      <TabletConfirm
        status="success"
        title="Advance collected"
        message={`${inr(Number(amount))} recorded for ${patient.name} via ${mode}.`}
        primaryAction={{
          label: "Back to statement",
          onClick: () => {
            setAmount("");
            setRemarks("");
            setStage("view");
            collect.reset();
          },
        }}
        secondaryAction={{ label: "Home", onClick: () => navigate("/") }}
      />
    );
  }

  if (stage === "collect") {
    const value = Number(amount) || 0;
    return (
      <FlowScaffold
        heading="Collect advance"
        subheading={`${patient.name} · ${patient.patients_id || ""}`}
        actions={
          <>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => setStage("view")}
              disabled={collect.isPending}
            >
              Cancel
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={value <= 0 || collect.isPending}
              onClick={() => collect.mutate()}
            >
              {collect.isPending ? "Saving…" : `Collect ${inr(value)}`}
            </TabletButton>
          </>
        }
      >
        <div className="space-y-5">
          <div className="rounded-2xl bg-muted p-5 text-center">
            <p className="text-sm text-muted-foreground">Advance amount</p>
            <p className="text-4xl font-bold">{inr(value)}</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">
              Payment mode
            </p>
            <div className="grid grid-cols-5 gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-12 rounded-xl text-sm font-medium",
                    mode === m ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <TabletNumpad
            value={amount}
            onChange={setAmount}
            allowDecimal
            maxLength={9}
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">
              Remarks
            </p>
            <DictationTextarea
              value={remarks}
              onChange={setRemarks}
              rows={3}
              placeholder="Optional remarks / narration"
            />
          </div>
          {collect.isError ? (
            <p className="text-destructive">
              {(collect.error as Error)?.message || "Could not save advance."}
            </p>
          ) : null}
        </div>
      </FlowScaffold>
    );
  }

  if (stage === "billing") {
    const isApproved = !!preauth.data?.approved;
    return (
      <FlowScaffold
        heading="Pre-auth billing details"
        subheading={`${patient.name} · ${visit.data?.visit_id || ""}`}
        actions={
          <TabletButton variant="outline" className="flex-1" onClick={() => setStage("view")}>
            Back to statement
          </TabletButton>
        }
      >
        {visit.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : !visit.data ? (
          <p className="py-8 text-center text-muted-foreground">
            No visit found for this patient.
          </p>
        ) : (
          <div className="space-y-5">
            <TabletCard>
              <TabletLabel htmlFor="reg-id">Yojana registration ID</TabletLabel>
              <div className="mt-1.5 flex gap-2">
                <TabletInput
                  id="reg-id"
                  value={registrationIdInput}
                  onChange={(e) => setRegistrationIdInput(e.target.value)}
                  placeholder="e.g. R-200"
                  className="flex-1"
                />
                <TabletButton
                  disabled={saveRegistrationId.isPending || registrationIdInput.trim() === (visit.data.yojana_registration_id || "")}
                  onClick={() => saveRegistrationId.mutate()}
                >
                  {saveRegistrationId.isPending ? "Saving…" : "Save"}
                </TabletButton>
              </div>
              {saveRegistrationId.isError ? (
                <p className="mt-2 text-sm text-destructive">
                  {(saveRegistrationId.error as Error)?.message || "Could not save registration ID."}
                </p>
              ) : null}
              {saveRegistrationId.isSuccess ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved{saveRegistrationId.data?.portalMatched ? " — portal data auto-filled" : ""}
                </p>
              ) : null}
            </TabletCard>

            {!visit.data.yojana_registration_id ? (
              <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                Enter and save a registration ID to check pre-auth status.
              </p>
            ) : preauth.isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : !isApproved ? (
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                Pre-auth for this registration ID isn't approved yet. Package and implant entry
                unlock once it's approved on the government portal import.
              </p>
            ) : (
              <>
                <TabletCard>
                  <TabletLabel>Package</TabletLabel>
                  {visit.data.package_name ? (
                    <p className="mt-1.5 text-sm font-medium">{visit.data.package_name}</p>
                  ) : null}
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <TabletInput
                      value={packageTerm}
                      onChange={(e) => setPackageTerm(e.target.value)}
                      placeholder="Search treatment package"
                      className="pl-9"
                    />
                  </div>
                  {packageTerm.trim().length >= 2 ? (
                    <div className="mt-2 space-y-1.5">
                      {packageResults.isLoading ? (
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                      ) : (packageResults.data || []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No matching packages.</p>
                      ) : (
                        packageResults.data!.map((pkg) => (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => savePackage.mutate(pkg.name)}
                            disabled={savePackage.isPending}
                            className="w-full rounded-lg border border-input px-3 py-2 text-left text-sm hover:bg-muted"
                          >
                            {pkg.name}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </TabletCard>

                <TabletCard>
                  <TabletLabel>Implant</TabletLabel>
                  {(addedImplants.data || []).length > 0 ? (
                    <div className="mt-1.5 space-y-1">
                      {addedImplants.data!.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span>{item.implant_name}</span>
                          <span className="font-medium">{inr(item.rate)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!selectedImplant ? (
                    <>
                      <div className="relative mt-2">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <TabletInput
                          value={implantTerm}
                          onChange={(e) => setImplantTerm(e.target.value)}
                          placeholder="Search implant"
                          className="pl-9"
                        />
                      </div>
                      {implantTerm.trim().length >= 2 ? (
                        <div className="mt-2 space-y-1.5">
                          {implantResults.isLoading ? (
                            <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                          ) : (implantResults.data || []).length === 0 ? (
                            <p className="text-sm text-muted-foreground">No matching implants.</p>
                          ) : (
                            implantResults.data!.map((implant) => (
                              <button
                                key={implant.id}
                                type="button"
                                onClick={() => {
                                  setSelectedImplant(implant);
                                  setImplantRate(String(defaultImplantRate(implant, visit.data!.corporate)));
                                }}
                                className="w-full rounded-lg border border-input px-3 py-2 text-left text-sm hover:bg-muted"
                              >
                                {implant.name}
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm font-medium">{selectedImplant.name}</p>
                      <TabletInput
                        value={implantRate}
                        onChange={(e) => setImplantRate(e.target.value.replace(/[^0-9.]/g, ""))}
                        inputMode="decimal"
                        placeholder="Cost"
                      />
                      <div className="flex gap-2">
                        <TabletButton
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setSelectedImplant(null);
                            setImplantTerm("");
                          }}
                        >
                          Cancel
                        </TabletButton>
                        <TabletButton
                          className="flex-1"
                          disabled={addImplant.isPending}
                          onClick={() => addImplant.mutate()}
                        >
                          {addImplant.isPending ? "Adding…" : "Add implant"}
                        </TabletButton>
                      </div>
                      {addImplant.isError ? (
                        <p className="text-sm text-destructive">
                          {(addImplant.error as Error)?.message || "Could not add implant."}
                        </p>
                      ) : null}
                    </div>
                  )}
                </TabletCard>
              </>
            )}
          </div>
        )}
      </FlowScaffold>
    );
  }

  const rows = advances.data || [];
  const totalAdvance = rows
    .filter((r) => !r.is_refund)
    .reduce((s, r) => s + (Number(r.advance_amount) || 0), 0);
  const totalReturned = rows.reduce(
    (s, r) => s + (Number(r.returned_amount) || 0),
    0,
  );

  return (
    <FlowScaffold
      heading={patient.name}
      subheading={`${patient.patients_id || ""} — advance statement`}
      actions={
        <>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => setPatient(null)}
          >
            Change patient
          </TabletButton>
          <TabletButton className="flex-1" onClick={() => setStage("collect")}>
            Collect advance
          </TabletButton>
        </>
      }
    >
      <TabletCard className="mb-4 flex items-center gap-4 bg-amber-50">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
          <Wallet className="h-7 w-7 text-amber-600" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Net advance balance</p>
          <p className="text-3xl font-bold">{inr(totalAdvance - totalReturned)}</p>
        </div>
      </TabletCard>

      <TabletCard
        interactive
        className="mb-4 flex items-center justify-between py-3"
        onClick={() => setStage("billing")}
      >
        <div>
          <p className="font-medium">Billing details</p>
          <p className="text-xs text-muted-foreground">
            Registration ID, package &amp; implant
          </p>
        </div>
        <span className="text-sm text-primary">Open →</span>
      </TabletCard>

      {advances.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No advances recorded for this patient.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <TabletCard key={r.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">
                  {r.is_refund ? "Refund" : "Advance"} · {r.payment_mode}
                </p>
                <p className="text-xs text-muted-foreground">
                  {shortDate(r.payment_date)} · {r.status}
                </p>
              </div>
              <span
                className={cn(
                  "font-semibold",
                  r.is_refund ? "text-rose-700" : "text-emerald-700",
                )}
              >
                {r.is_refund ? "−" : "+"}
                {inr(r.advance_amount)}
              </span>
            </TabletCard>
          ))}
        </div>
      )}
    </FlowScaffold>
  );
}
