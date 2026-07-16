import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Loader2, Search, User, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { cn } from "@/lib/utils";
import { inr, shortDate } from "@/tablet/lib/format";
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
  package_code: string | null;
  package_name: string | null;
  corporate: string | null;
}

interface PackageOption {
  id: string;
  code: string | null;
  name: string;
  label: string;
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
  amount: number;
}

interface AdvancePatientRow {
  patient: Patient;
  visitId: string;
  visitNumber: string;
  admissionDate: string | null;
  dischargeDate: string | null;
  registrationId: string | null;
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
  const { hospitalConfig } = useAuth();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [showAllPatients, setShowAllPatients] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [stage, setStage] = useState<"view" | "collect" | "billing">("view");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("CASH");
  const [remarks, setRemarks] = useState("");
  const [registrationIdInput, setRegistrationIdInput] = useState("");
  const [packageTerm, setPackageTerm] = useState("");
  const [packageCodeInput, setPackageCodeInput] = useState("");
  const [packageNameInput, setPackageNameInput] = useState("");
  const [implantTerm, setImplantTerm] = useState("");
  const [selectedImplant, setSelectedImplant] = useState<ImplantOption | null>(null);
  const [implantRate, setImplantRate] = useState("");

  const patientRows = useQuery({
    queryKey: ["tablet-advance-patient-list", showAllPatients, hospitalConfig?.name, patientSearch.trim()],
    queryFn: async (): Promise<AdvancePatientRow[]> => {
      const searchActive = patientSearch.trim().length > 0;
      let query = supabase
        .from("visits")
        .select(
          "id, visit_id, admission_date, discharge_date, yojana_registration_id, patient_id, patients!inner(id, name, patients_id, phone, age, gender, corporate, hospital_name)",
        )
        .eq("patient_type", "IPD")
        .not("admission_date", "is", null)
        .order("admission_date", { ascending: false });

      // A search should also find discharged patients; the toggle controls the
      // unfiltered default list, while search itself searches all IPD visits.
      if (!showAllPatients && !searchActive) query = query.is("discharge_date", null);
      if (hospitalConfig?.name) query = query.eq("patients.hospital_name", hospitalConfig.name);

      const { data, error } = await query;
      if (error) throw error;

      const seen = new Set<string>();
      return (data || []).reduce<AdvancePatientRow[]>((rows, row: any) => {
        const relatedPatient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
        if (!relatedPatient?.id || seen.has(relatedPatient.id)) return rows;
        seen.add(relatedPatient.id);
        rows.push({
          patient: {
            ...relatedPatient,
            created_at: relatedPatient.created_at || row.admission_date || new Date().toISOString(),
          } as Patient,
          visitId: row.id,
          visitNumber: row.visit_id,
          admissionDate: row.admission_date,
          dischargeDate: row.discharge_date,
          registrationId: row.yojana_registration_id,
        });
        return rows;
      }, []);
    },
    staleTime: 30_000,
  });

  const filteredPatientRows = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patientRows.data || [];
    return (patientRows.data || []).filter(({ patient: item, registrationId, visitNumber }) =>
      [item.name, item.patients_id, item.phone, registrationId, visitNumber]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [patientRows.data, patientSearch]);

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
    queryKey: ["tablet-advance-visit", selectedVisitId, patient?.id],
    enabled: !!patient && !!selectedVisitId,
    queryFn: async (): Promise<VisitRow | null> => {
      const query = supabase
        .from("visits")
        .select("id, visit_id, yojana_registration_id, package_code, package_name, corporate")
        .eq("id", selectedVisitId!);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as VisitRow | null;
    },
  });

  useEffect(() => {
    setRegistrationIdInput(visit.data?.yojana_registration_id || "");
    setPackageCodeInput(visit.data?.package_code || "");
    setPackageNameInput(visit.data?.package_name || "");
  }, [visit.data?.id, visit.data?.yojana_registration_id, visit.data?.package_code, visit.data?.package_name]);

  const addedImplants = useQuery({
    queryKey: ["tablet-visit-implants", visit.data?.id],
    enabled: !!visit.data?.id,
    queryFn: async (): Promise<AddedImplant[]> => {
      const { data, error } = await supabase
        .from("visit_implants")
        .select("id, implant_name, rate, amount")
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
      const term = packageTerm.trim().toLowerCase();
      const [pmjayRes, yojanaRes, cghsRes] = await Promise.all([
        supabase
          .from("pmjay_mjpjay_packages")
          .select("id, treatment_code, treatment_plan")
          .eq("is_active", true)
          .order("treatment_plan"),
        supabase
          .from("yojana_mh_procedures")
          .select("id, procedure_code, package_code, package_name, procedure_name, procedure_label")
          .order("package_name"),
        supabase.from("cghs_surgery").select("id, name").eq("is_active", true).order("name"),
      ]);
      if (pmjayRes.error) throw pmjayRes.error;
      if (yojanaRes.error) throw yojanaRes.error;
      if (cghsRes.error) throw cghsRes.error;

      const options = [
        ...(pmjayRes.data || []).map((row: any) => ({
          id: row.id,
          code: row.treatment_code || null,
          name: row.treatment_plan || row.treatment_code || "",
          label: [row.treatment_code, row.treatment_plan].filter(Boolean).join(" - "),
        })),
        ...(yojanaRes.data || []).map((row: any) => ({
          id: row.id,
          code: row.procedure_code || row.package_code || null,
          name: row.package_name || row.procedure_name || row.procedure_label || row.package_code || "",
          label: [
            row.procedure_code || row.package_code,
            row.package_name || row.procedure_name || row.procedure_label || row.package_code,
          ].filter(Boolean).join(" - "),
        })),
        ...(cghsRes.data || []).map((row: any) => ({ id: row.id, code: null, name: row.name || "", label: row.name || "" })),
      ];

      const unique = new Map<string, PackageOption>();
      options
        .filter((option) => option.label && option.label.toLowerCase().includes(term))
        .forEach((option) => {
          if (!unique.has(option.label)) unique.set(option.label, option);
        });
      return Array.from(unique.values()).slice(0, 15);
    },
  });

  const implantResults = useQuery({
    queryKey: ["tablet-implant-options"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<ImplantOption[]> => {
      const { data, error } = await supabase
        .from("implants")
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate, bhopal_nabh_rate, bhopal_non_nabh_rate")
        .order("name")
      if (error) throw error;
      return (data || []) as ImplantOption[];
    },
  });

  const implantMatches = useMemo(() => {
    const term = implantTerm.trim().toLowerCase();
    if (!term) return [];
    return (implantResults.data || [])
      .filter((implant) => String(implant.name || "").toLowerCase().includes(term))
      .slice(0, 15);
  }, [implantResults.data, implantTerm]);

  const createImplant = useMutation({
    mutationFn: async (): Promise<ImplantOption> => {
      const name = implantTerm.trim();
      if (!name) throw new Error("Enter an implant name first");

      const { data, error } = await supabase
        .from("implants")
        .insert({ name })
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate, bhopal_nabh_rate, bhopal_non_nabh_rate")
        .single();
      if (error) throw error;
      return data as ImplantOption;
    },
    onSuccess: (implant) => {
      qc.setQueryData<ImplantOption[]>(["tablet-implant-options"], (current) => [
        ...(current || []),
        implant,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setSelectedImplant(implant);
      setImplantRate("");
      setImplantTerm(implant.name);
    },
  });

  const saveRegistrationId = useMutation({
    mutationFn: async () => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const value = registrationIdInput.trim().toUpperCase();
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
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      qc.invalidateQueries({ queryKey: ["tablet-advance-patient-list"] });
    },
  });

  const saveRegistrationIfChanged = () => {
    const current = visit.data?.yojana_registration_id || "";
    if (registrationIdInput.trim().toUpperCase() !== current.toUpperCase() && !saveRegistrationId.isPending) {
      saveRegistrationId.mutate();
    }
  };

  const savePackage = useMutation({
    mutationFn: async ({ code, name }: { code: string | null; name: string }) => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const { error } = await supabase
        .from("visits")
        .update({ package_code: code || null, package_name: name } as any)
        .eq("id", visit.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      setPackageTerm("");
      setPackageCodeInput("");
      setPackageNameInput("");
    },
  });

  const createPackage = useMutation({
    mutationFn: async () => {
      if (!visit.data) throw new Error("No visit found for this patient");
      const code = packageCodeInput.trim();
      const name = packageNameInput.trim();
      if (!code || !name) throw new Error("Enter both package code and package name");

      const duplicate = await supabase
        .from("pmjay_mjpjay_packages")
        .select("id")
        .eq("treatment_code", code)
        .eq("treatment_plan", name)
        .maybeSingle();
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data) throw new Error("A package with this code and name already exists");

      const created = await supabase
        .from("pmjay_mjpjay_packages")
        .insert({
          scheme: "PMJAY/MJPJAY",
          treatment_code: code,
          treatment_plan: name,
          is_active: true,
        })
        .select("id, treatment_code, treatment_plan")
        .single();
      if (created.error) throw created.error;

      const visitUpdate = await supabase
        .from("visits")
        .update({ package_code: code, package_name: name } as any)
        .eq("id", visit.data.id);
      if (visitUpdate.error) throw visitUpdate.error;

      return { id: created.data.id, code, name, label: `${code} - ${name}` } satisfies PackageOption;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-advance-visit"] });
      setPackageTerm("");
      setPackageCodeInput("");
      setPackageNameInput("");
    },
  });

  const addImplant = useMutation({
    mutationFn: async () => {
      if (!visit.data || !selectedImplant) throw new Error("Pick an implant first");
      const rate = Number(implantRate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("Enter a valid implant amount");
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
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 border-b border-border">
          <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold sm:text-xl">Advance — select patient</h2>
                <p className="text-sm text-muted-foreground">
                  {showAllPatients ? "All admitted and discharged IPD patients" : "Currently admitted IPD patients"}
                </p>
              </div>
              <TabletButton
                variant={showAllPatients ? "default" : "outline"}
                onClick={() => setShowAllPatients((value) => !value)}
                className="shrink-0"
              >
                {showAllPatients ? "Current Patients" : "All Patients"}
              </TabletButton>
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <TabletInput
                  value={patientSearch}
                  onChange={(event) => setPatientSearch(event.target.value)}
                  placeholder="Search patient, patient ID, or registration number"
                  className="pl-10"
                />
              </div>
              {patientSearch ? (
                <TabletButton variant="outline" onClick={() => setPatientSearch("")}>Clear</TabletButton>
              ) : null}
            </div>
          </div>
        </div>
        <div className="tablet-no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
            {patientRows.isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : patientRows.isError ? (
              <p className="py-12 text-center text-destructive">Could not load patients. Please try again.</p>
            ) : filteredPatientRows.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">No matching patients found.</p>
            ) : (
              <div className="space-y-3 sm:space-y-1.5">
                {filteredPatientRows.map((row) => (
                  <button
                    key={row.visitId}
                    type="button"
                    onClick={() => {
                      setSelectedVisitId(row.visitId);
                      setPatient(row.patient);
                      setStage("billing");
                    }}
                    className="grid w-full gap-3 rounded-2xl border-2 border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/10 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center sm:rounded-xl sm:border sm:px-4 sm:py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15"><User className="h-6 w-6 text-primary" /></div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{row.patient.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.patient.patients_id || "No patient ID"}</p>
                      </div>
                    </div>
                    <div className="text-sm"><span className="text-xs text-muted-foreground sm:hidden">Admission: </span>{row.admissionDate ? shortDate(row.admissionDate) : "—"}</div>
                    <div className="text-sm"><span className="text-xs text-muted-foreground sm:hidden">Registration: </span>{row.registrationId || "Not added"}</div>
                    <ChevronRight className="hidden h-5 w-5 text-muted-foreground sm:block" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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
    return (
      <FlowScaffold
        heading="Registration & implants"
        subheading={`${patient.name} · ${visit.data?.visit_id || ""}`}
        actions={
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => {
              setPatient(null);
              setSelectedVisitId(null);
              setStage("view");
            }}
          >
            Change patient
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
                  onBlur={saveRegistrationIfChanged}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveRegistrationIfChanged();
                    }
                  }}
                  placeholder="e.g. R-200"
                  className="flex-1"
                />
                <TabletButton
                  disabled={saveRegistrationId.isPending || registrationIdInput.trim().toUpperCase() === (visit.data.yojana_registration_id || "").toUpperCase()}
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

            <>
                <TabletCard>
                  <TabletLabel>Package</TabletLabel>
                  {visit.data.package_code || visit.data.package_name ? (
                    <div className="mt-1.5 rounded-lg bg-muted p-3 text-sm">
                      <p><span className="font-medium">Code:</span> {visit.data.package_code || "—"}</p>
                      <p><span className="font-medium">Name:</span> {visit.data.package_name || "—"}</p>
                    </div>
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
                        <p className="text-sm text-muted-foreground">No matching packages found.</p>
                      ) : (
                        packageResults.data!.map((pkg) => (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => {
                              setPackageCodeInput(pkg.code || "");
                              setPackageNameInput(pkg.name);
                              savePackage.mutate({ code: pkg.code, name: pkg.name });
                            }}
                            disabled={savePackage.isPending}
                            className="w-full rounded-lg border border-input px-3 py-2 text-left text-sm hover:bg-muted"
                          >
                            {pkg.label}
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                  <div className="mt-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
                    <p className="text-sm font-medium">Add package to master</p>
                    <div className="mt-2 space-y-2">
                      <TabletInput
                        value={packageCodeInput}
                        onChange={(event) => setPackageCodeInput(event.target.value)}
                        placeholder="Package code"
                      />
                      <TabletInput
                        value={packageNameInput}
                        onChange={(event) => setPackageNameInput(event.target.value)}
                        placeholder="Package name"
                      />
                      <TabletButton
                        className="w-full"
                        onClick={() => createPackage.mutate()}
                        disabled={createPackage.isPending || !packageCodeInput.trim() || !packageNameInput.trim()}
                      >
                        {createPackage.isPending ? "Creating…" : "Save package code & name"}
                      </TabletButton>
                      {createPackage.isError ? (
                        <p className="text-sm text-destructive">
                          {(createPackage.error as Error)?.message || "Could not create package."}
                        </p>
                      ) : createPackage.isSuccess ? (
                        <p className="text-sm text-emerald-700">Package saved to master and patient visit.</p>
                      ) : null}
                    </div>
                  </div>
                </TabletCard>

                <TabletCard>
                  <TabletLabel>Implant</TabletLabel>
                  {(addedImplants.data || []).length > 0 ? (
                    <div className="mt-1.5 space-y-1">
                      {addedImplants.data!.map((item) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span>{item.implant_name}</span>
                          <span className="font-medium">{inr(item.amount ?? item.rate)}</span>
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
                      ) : implantMatches.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
                          <p className="text-sm text-muted-foreground">No matching implant found.</p>
                          <TabletButton
                            className="mt-2 w-full"
                            onClick={() => createImplant.mutate()}
                            disabled={createImplant.isPending}
                          >
                            {createImplant.isPending ? "Creating…" : `Create “${implantTerm.trim()}” in master`}
                          </TabletButton>
                          {createImplant.isError ? (
                            <p className="mt-2 text-sm text-destructive">
                              {(createImplant.error as Error)?.message || "Could not create implant."}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        implantMatches.map((implant) => (
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
                          disabled={addImplant.isPending || !Number.isFinite(Number(implantRate)) || Number(implantRate) <= 0}
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
            onClick={() => {
              setPatient(null);
              setSelectedVisitId(null);
            }}
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
