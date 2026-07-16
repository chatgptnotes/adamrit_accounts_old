import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { BillDocumentsSection } from "@/pages/corporate-bill/BillDocumentsSection";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { usePackageOptions } from "@/tablet/modules/preauth/usePreauthCases";
import { usePreauthCases } from "@/tablet/modules/preauth/usePreauthCases";
import type { PreauthCase } from "@/tablet/modules/preauth/types";
import { syncPortalDataForRegistrationId } from "@/lib/governmentPortalReportDb";
import { toast } from "sonner";

type VisitRow = {
  id: string;
  visit_id: string;
  yojana_registration_id: string | null;
  package_name: string | null;
  package_amount: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  corporate: string | null;
  patients?: {
    id: string;
    name: string | null;
    patients_id: string | null;
    age: number | null;
    gender: string | null;
  } | null;
};

type ImplantRow = {
  id: string;
  implant_id: string | null;
  implant_name: string | null;
  amount: string | number | null;
  rate: string | number | null;
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB");
};

function isApprovedPortalRow(row: { status?: string | null; preauth_approved_amount?: number | string | null }) {
  return row.status === "approved" || Number(row.preauth_approved_amount) > 0;
}

function defaultImplantRate(implant: { nabh_nabl_rate?: number | null; non_nabh_nabl_rate?: number | null; private_rate?: number | null }, corporate: string | null | undefined) {
  const preferYojana = (corporate || "").toLowerCase().includes("yojana") || (corporate || "").toLowerCase().includes("pmjay");
  const ordered = preferYojana
    ? [implant.nabh_nabl_rate, implant.private_rate, implant.non_nabh_nabl_rate]
    : [implant.private_rate, implant.nabh_nabl_rate, implant.non_nabh_nabl_rate];
  return ordered.find((rate) => rate !== null && rate !== undefined) ?? 0;
}

export default function AdvancedStatementFlow() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const [selectedCase, setSelectedCase] = useState<PreauthCase | null>(null);
  const [registrationIdInput, setRegistrationIdInput] = useState("");
  const [packageNameInput, setPackageNameInput] = useState("");
  const [packageAmountInput, setPackageAmountInput] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [implantSearch, setImplantSearch] = useState("");
  const [selectedImplant, setSelectedImplant] = useState<ImplantRow | null>(null);
  const [implantNameInput, setImplantNameInput] = useState("");
  const [implantCostInput, setImplantCostInput] = useState("");

  const casesQuery = usePreauthCases(debouncedSearch);
  const packageOptions = usePackageOptions();

  const registrationIds = useMemo(
    () =>
      Array.from(
        new Set(
          (casesQuery.data || [])
            .map((item) => item.yojanaRegistrationId || item.registrationId)
            .filter((value): value is string => Boolean(value && value.trim())),
        ),
      ),
    [casesQuery.data],
  );

  const approvalsQuery = useQuery({
    queryKey: ["tablet-advanced-statement-approvals", registrationIds.join("|")],
    enabled: registrationIds.length > 0,
    staleTime: 1000 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("government_portal_report_rows")
        .select("registration_id,status,preauth_approved_amount,created_at")
        .in("registration_id", registrationIds);
      if (error) throw error;

      const latestByRegistration = new Map<string, { status: string | null; preauth_approved_amount: string | number | null; created_at: string | null }>();
      for (const row of data || []) {
        const key = normalize(String(row.registration_id || ""));
        if (!key) continue;
        const existing = latestByRegistration.get(key);
        if (!existing) {
          latestByRegistration.set(key, row);
          continue;
        }
        const left = existing.created_at ? new Date(existing.created_at).getTime() : 0;
        const right = row.created_at ? new Date(row.created_at).getTime() : 0;
        if (right >= left) latestByRegistration.set(key, row);
      }

      return new Set(
        Array.from(latestByRegistration.entries())
          .filter(([, row]) => isApprovedPortalRow(row))
          .map(([key]) => key),
      );
    },
  });

  const approvedCases = useMemo(
    () =>
      (casesQuery.data || []).filter((item) => {
        const key = normalize(item.yojanaRegistrationId || item.registrationId || "");
        return !!key && approvalsQuery.data?.has(key);
      }),
    [approvalsQuery.data, casesQuery.data],
  );

  const visitQuery = useQuery({
    queryKey: ["tablet-advanced-statement-visit", selectedCase?.visitUuid],
    enabled: !!selectedCase?.visitUuid,
    staleTime: 1000 * 30,
    queryFn: async (): Promise<VisitRow | null> => {
      if (!selectedCase) return null;
      const { data, error } = await supabase
        .from("visits")
        .select(
          "id, visit_id, yojana_registration_id, package_name, package_amount, admission_date, discharge_date, corporate, patients!inner(id, name, patients_id, age, gender)",
        )
        .eq("id", selectedCase.visitUuid)
        .maybeSingle();
      if (error) throw error;
      return data as VisitRow | null;
    },
  });

  const implantQuery = useQuery({
    queryKey: ["tablet-advanced-statement-active-implant", visitQuery.data?.id],
    enabled: !!visitQuery.data?.id,
    staleTime: 1000 * 20,
    queryFn: async (): Promise<ImplantRow | null> => {
      if (!visitQuery.data) return null;
      const { data, error } = await supabase
        .from("visit_implants")
        .select("id, implant_id, implant_name, amount, rate")
        .eq("visit_id", visitQuery.data.id)
        .eq("status", "Active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ImplantRow | null;
    },
  });

  const implantSearchQuery = useQuery({
    queryKey: ["tablet-advanced-statement-implant-search", implantSearch],
    enabled: implantSearch.trim().length >= 2,
    staleTime: 1000 * 20,
    queryFn: async () => {
      const term = implantSearch.trim().replace(/[,%()]/g, "");
      const { data, error } = await supabase
        .from("implants")
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate")
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(15);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        name: string;
        nabh_nabl_rate: number | null;
        non_nabh_nabl_rate: number | null;
        private_rate: number | null;
      }>;
    },
  });

  const packageMatches = useMemo(() => {
    const term = normalize(packageSearch);
    const options = packageOptions.data || [];
    if (!term) return options.slice(0, 12);
    return options.filter((option) => normalize(option.label).includes(term)).slice(0, 12);
  }, [packageOptions.data, packageSearch]);

  useEffect(() => {
    if (!visitQuery.data) return;
    setRegistrationIdInput(visitQuery.data.yojana_registration_id || selectedCase?.yojanaRegistrationId || selectedCase?.registrationId || "");
    setPackageNameInput(visitQuery.data.package_name || selectedCase?.packageName || "");
    setPackageAmountInput(visitQuery.data.package_amount || selectedCase?.packageAmount || "");
    setPackageSearch(visitQuery.data.package_name || selectedCase?.packageName || "");
  }, [selectedCase?.visitUuid, selectedCase?.packageAmount, selectedCase?.packageName, selectedCase?.registrationId, selectedCase?.yojanaRegistrationId, visitQuery.data]);

  useEffect(() => {
    if (!implantQuery.data) return;
    setSelectedImplant(implantQuery.data);
    setImplantNameInput(implantQuery.data.implant_name || "");
    setImplantCostInput(String(implantQuery.data.amount ?? implantQuery.data.rate ?? ""));
  }, [implantQuery.data]);

  const saveRegistrationId = async () => {
    if (!visitQuery.data) return;
    const value = registrationIdInput.trim().toUpperCase();
    const { error } = await supabase
      .from("visits")
      .update({ yojana_registration_id: value || null })
      .eq("id", visitQuery.data.id);
    if (error) {
      toast.error("Failed to save registration ID");
      return;
    }
    if (value) {
      try {
        await syncPortalDataForRegistrationId(value);
      } catch {
        // Portal sync is best-effort here.
      }
    }
    toast.success("Registration ID saved");
    await qc.invalidateQueries({ queryKey: ["tablet-advanced-statement-visit", selectedCase?.visitUuid] });
    await qc.invalidateQueries({ queryKey: ["tablet-advanced-statement-approvals"] });
  };

  const savePackage = async () => {
    if (!visitQuery.data) return;
    const { error } = await supabase
      .from("visits")
      .update({
        package_name: packageNameInput.trim() || null,
        package_amount: packageAmountInput.trim() || null,
      })
      .eq("id", visitQuery.data.id);
    if (error) {
      toast.error("Failed to save package");
      return;
    }
    toast.success("Package saved");
    await qc.invalidateQueries({ queryKey: ["tablet-advanced-statement-visit", selectedCase?.visitUuid] });
  };

  const saveImplant = async () => {
    if (!visitQuery.data) return;
    const cost = implantCostInput.trim();
    if (!implantNameInput.trim()) {
      toast.error("Enter an implant name");
      return;
    }
    if (!cost) {
      toast.error("Enter an implant cost");
      return;
    }
    const payload = {
      visit_id: visitQuery.data.id,
      implant_id: selectedImplant?.id || null,
      implant_name: implantNameInput.trim(),
      quantity: 1,
      rate: Number(cost) || 0,
      amount: Number(cost) || 0,
      status: "Active",
    };
    const { error: existingError, data: existing } = await supabase
      .from("visit_implants")
      .select("id")
      .eq("visit_id", visitQuery.data.id)
      .eq("status", "Active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) {
      toast.error("Failed to load implant row");
      return;
    }
    const action = existing
      ? supabase.from("visit_implants").update(payload).eq("id", existing.id)
      : supabase.from("visit_implants").insert(payload);
    const { error } = await action;
    if (error) {
      toast.error("Failed to save implant");
      return;
    }
    toast.success("Implant saved");
    await qc.invalidateQueries({ queryKey: ["tablet-advanced-statement-active-implant", visitQuery.data.id] });
  };

  const clearSelection = () => {
    setSelectedCase(null);
    setRegistrationIdInput("");
    setPackageNameInput("");
    setPackageAmountInput("");
    setPackageSearch("");
    setImplantSearch("");
    setSelectedImplant(null);
    setImplantNameInput("");
    setImplantCostInput("");
  };

  if (!selectedCase) {
    return (
      <FlowScaffold
        heading="Advanced Statement"
        subheading="Approved pre-auth patients only"
        actions={
          <TabletButton variant="outline" className="flex-1" onClick={() => setSearchInput("")}>
            Clear
          </TabletButton>
        }
      >
        <div className="space-y-4">
          <TabletCard className="space-y-3">
            <div>
              <TabletLabel>Search approved cases</TabletLabel>
              <div className="mt-2 flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <TabletInput
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Patient name, registration ID, visit ID"
                    className="pl-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSearchInput((value) => value.trim());
                    }}
                  />
                </div>
                <TabletButton onClick={() => setSearchInput((value) => value.trim())} className="shrink-0">
                  Search
                </TabletButton>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Only patients with approved pre-auth will appear.
              </p>
            </div>
          </TabletCard>

          {casesQuery.isLoading || approvalsQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : approvedCases.length === 0 ? (
            <TabletCard className="py-8 text-center text-sm text-muted-foreground">
              No approved pre-auth patients found.
            </TabletCard>
          ) : (
            <div className="space-y-3">
              {approvedCases.map((item) => (
                <TabletCard
                  key={item.visitUuid}
                  interactive
                  onClick={() => setSelectedCase(item)}
                  className="space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{item.patientName}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.patientId || "No patient ID"} · {item.visitId || "No visit ID"}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Approved
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Reg: {item.yojanaRegistrationId || item.registrationId || "—"} · Package: {item.packageName || "—"}
                  </p>
                </TabletCard>
              ))}
            </div>
          )}
        </div>
      </FlowScaffold>
    );
  }

  const patientName = visitQuery.data?.patients?.name || selectedCase.patientName;
  const patientId = visitQuery.data?.patients?.patients_id || selectedCase.patientId;
  const regNo = visitQuery.data?.yojana_registration_id || selectedCase.yojanaRegistrationId || selectedCase.registrationId || "";
  const visitId = visitQuery.data?.visit_id || selectedCase.visitId;

  return (
    <FlowScaffold
      heading="Advanced Statement"
      subheading={`${patientName} · approved case`}
      actions={
        <>
          <TabletButton variant="outline" className="flex-1" onClick={clearSelection}>
            Change case
          </TabletButton>
          <TabletButton
            className="flex-1"
            onClick={() => {
              if (visitId) window.open(`/discharge-summary-print/${visitId}`, "_blank", "noopener,noreferrer");
            }}
            disabled={!visitId}
          >
            Discharge Summary
          </TabletButton>
        </>
      }
    >
      {visitQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !visitQuery.data ? (
        <TabletCard className="py-8 text-center text-sm text-muted-foreground">
          Selected case could not be loaded.
        </TabletCard>
      ) : (
        <div className="space-y-4">
          <TabletCard className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Patient details</p>
                <h3 className="mt-1 text-lg font-semibold">{patientName}</h3>
                <p className="text-sm text-muted-foreground">
                  {patientId || "No patient ID"} · Visit {visitId || "No visit ID"}
                </p>
              </div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                Pre-auth approved
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <div>Age: {visitQuery.data.patients?.age ?? "—"}</div>
              <div>Sex: {visitQuery.data.patients?.gender || "—"}</div>
              <div>Admission: {formatDate(visitQuery.data.admission_date)}</div>
              <div>Discharge: {formatDate(visitQuery.data.discharge_date)}</div>
              <div className="sm:col-span-2">Corporate: {visitQuery.data.corporate || "—"}</div>
            </div>
          </TabletCard>

          <TabletCard className="space-y-3">
            <TabletLabel htmlFor="tablet-reg-id">Registration ID</TabletLabel>
            <div className="flex gap-2">
              <TabletInput
                id="tablet-reg-id"
                value={registrationIdInput}
                onChange={(e) => setRegistrationIdInput(e.target.value)}
                placeholder="Enter registration ID"
                className="flex-1"
              />
              <TabletButton onClick={() => void saveRegistrationId()}>Save</TabletButton>
            </div>
          </TabletCard>

          <TabletCard className="space-y-3">
            <TabletLabel>Package</TabletLabel>
            <div className="space-y-2">
              <TabletInput
                value={packageNameInput}
                onChange={(e) => setPackageNameInput(e.target.value)}
                placeholder="Package name"
              />
              <div className="flex gap-2">
                <TabletInput
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                  placeholder="Search package master"
                  className="flex-1"
                />
              </div>
              {packageMatches.length > 0 ? (
                <div className="space-y-1">
                  {packageMatches.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary/60 hover:bg-primary/5"
                      onClick={() => {
                        setPackageNameInput(option.label);
                        setPackageSearch(option.label);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : packageSearch.trim().length >= 2 ? (
                <p className="text-sm text-muted-foreground">No matching packages.</p>
              ) : null}
              <TabletInput
                value={packageAmountInput}
                onChange={(e) => setPackageAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="Package amount"
              />
              <TabletButton onClick={() => void savePackage()}>Save Package</TabletButton>
            </div>
          </TabletCard>

          <TabletCard className="space-y-3">
            <TabletLabel>Implant</TabletLabel>
            <div className="space-y-2">
              <TabletInput
                value={implantNameInput}
                onChange={(e) => setImplantNameInput(e.target.value)}
                placeholder="Implant name"
              />
              <TabletInput
                value={implantSearch}
                onChange={(e) => setImplantSearch(e.target.value)}
                placeholder="Search implant master"
              />
              {implantSearch.trim().length >= 2 ? (
                implantSearchQuery.isLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (implantSearchQuery.data || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No matching implants.</p>
                ) : (
                  <div className="space-y-1">
                    {implantSearchQuery.data!.map((implant) => (
                      <button
                        key={implant.id}
                        type="button"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary/60 hover:bg-primary/5"
                        onClick={() => {
                          setSelectedImplant(implant);
                          setImplantNameInput(implant.name);
                          setImplantCostInput(String(defaultImplantRate(implant, visitQuery.data.corporate)));
                          setImplantSearch(implant.name);
                        }}
                      >
                        {implant.name}
                      </button>
                    ))}
                  </div>
                )
              ) : null}
              <TabletInput
                value={implantCostInput}
                onChange={(e) => setImplantCostInput(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="Implant cost"
              />
              <TabletButton onClick={() => void saveImplant()}>Save Implant</TabletButton>
            </div>
          </TabletCard>

          <TabletCard className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Documents & images</p>
                <h3 className="mt-1 text-base font-semibold">Yojana bill attachments</h3>
              </div>
            </div>
            <BillDocumentsSection
              patientId={visitQuery.data.patients?.id}
              patientName={patientName}
              patientRegistrationNo={regNo || patientId || ""}
              visitId={visitId || ""}
            />
          </TabletCard>
        </div>
      )}
    </FlowScaffold>
  );
}
