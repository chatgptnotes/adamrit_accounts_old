import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { DeathFileChecklist, DEATH_FILE_ITEMS } from "@/components/patient/DeathFileChecklist";

// DATA SOURCE: visits where discharge_mode = 'death' + file_uploads in the
// three death categories.
//
// Pallavi's tile. When a patient dies during treatment three things have to
// reach the file — the death certificate, the death summary and a photograph
// of the body handover — and they are easy to lose in the hour it happens.
// Every death is listed here with how many of the three are on record, so a
// missing one is visible rather than discovered months later.

interface DeathVisit {
  visitUuid: string;
  visitId: string;
  patientUuid: string;
  patientName: string;
  patientsId: string | null;
  dischargeDate: string | null;
  ward: string | null;
  held: number;
}

export default function DeathFilePallaviFlow() {
  const [search, setSearch] = useState("");
  const [openVisit, setOpenVisit] = useState<string | null>(null);

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["pallavi-death-file"],
    staleTime: 30_000,
    queryFn: async (): Promise<DeathVisit[]> => {
      const { data: rows, error } = await (supabase as any)
        .from("visits")
        .select(
          "id, visit_id, discharge_date, ward_allotted, patient_id, " +
            "patients!inner(id, name, patients_id, hospital_name)",
        )
        .eq("discharge_mode", "death")
        .order("discharge_date", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;

      const patientIds = [...new Set((rows ?? []).map((r: any) =>
        (Array.isArray(r.patients) ? r.patients[0] : r.patients)?.id).filter(Boolean))];
      const { data: docs } = patientIds.length
        ? await (supabase as any)
            .from("file_uploads")
            .select("patient_id, category")
            .in("patient_id", patientIds)
            .in("category", DEATH_FILE_ITEMS.map((i) => i.category))
        : { data: [] as any[] };

      const heldBy = new Map<string, Set<string>>();
      for (const d of docs || []) {
        if (!heldBy.has(d.patient_id)) heldBy.set(d.patient_id, new Set());
        heldBy.get(d.patient_id)!.add(d.category);
      }

      return (rows ?? []).map((r: any) => {
        const patient = Array.isArray(r.patients) ? r.patients[0] : r.patients;
        return {
          visitUuid: r.id,
          visitId: r.visit_id,
          patientUuid: patient?.id ?? r.patient_id,
          patientName: patient?.name ?? "Unknown patient",
          patientsId: patient?.patients_id ?? null,
          dischargeDate: r.discharge_date ?? null,
          ward: r.ward_allotted ?? null,
          held: heldBy.get(patient?.id)?.size ?? 0,
        };
      });
    },
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return visits;
    return visits.filter((v) =>
      [v.patientName, v.patientsId, v.visitId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [visits, search]);

  const incomplete = visible.filter((v) => v.held < DEATH_FILE_ITEMS.length).length;

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading="Death File - Pallavi"
      subheading="Death certificate, death summary and body handover photo, against every death"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient name, ID or visit…"
            className="pl-10"
          />
        </div>

        {visible.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {incomplete} of {visible.length} still incomplete.
          </p>
        )}

        {isLoading ? (
          <p className="py-10 text-center text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
            No deaths recorded.
          </TabletCard>
        ) : (
          visible.map((visit) => {
            const complete = visit.held >= DEATH_FILE_ITEMS.length;
            const open = openVisit === visit.visitUuid;
            return (
              <TabletCard key={visit.visitUuid} variant="flat" className="space-y-2">
                <button
                  type="button"
                  className="flex w-full items-start gap-3 text-left"
                  onClick={() => setOpenVisit(open ? null : visit.visitUuid)}
                >
                  {complete ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{visit.patientName}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[
                        visit.patientsId,
                        visit.visitId,
                        visit.dischargeDate ? shortDate(visit.dischargeDate) : null,
                        visit.ward,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={
                      complete
                        ? "shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium uppercase text-emerald-700"
                        : "shrink-0 rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium uppercase text-red-700"
                    }
                  >
                    {visit.held}/{DEATH_FILE_ITEMS.length}
                  </span>
                </button>

                {open && (
                  <DeathFileChecklist
                    patientId={visit.patientUuid}
                    patientName={visit.patientName}
                    visitId={visit.visitId}
                    knownDeath
                  />
                )}
              </TabletCard>
            );
          })
        )}
      </div>
    </FlowScaffold>
  );
}
