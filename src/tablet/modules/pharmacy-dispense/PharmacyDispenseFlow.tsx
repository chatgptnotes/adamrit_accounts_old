import { useState } from "react";
import { NoChargeBadge } from "@/components/NoChargeBadge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Repeat, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useAdmittedVisits, type TabletVisit } from "@/tablet/hooks/useVisitLists";
import {
  useMedicineSearch,
  fetchMedicineStock,
  type MedicineResult,
} from "@/tablet/hooks/useMedicineSearch";
import { TabletVisitList } from "@/tablet/components/TabletVisitList";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// Pharmacy tables are not in the generated types — untyped client.
const db = supabase as any;

/** An approved, not-yet-dispensed treatment-sheet medicine awaiting pharmacy. */
interface QueueItem {
  id: string; // visit_medications.id
  name: string; // what the doctor prescribed
  dose: string;
  route: string;
  frequency: string;
  medicationId: string | null; // medicine_master id, or null for a custom name
  stock: number; // live stock of the prescribed medicine (0 for custom)
}

/** First non-erroring rows for a list of (table, column, value) attempts. */
async function tryRows(
  attempts: { table: string; col: string; val: string }[],
): Promise<any[]> {
  for (const a of attempts) {
    if (!a.val) continue;
    const res = await db.from(a.table).select("*").eq(a.col, a.val);
    if (!res.error && Array.isArray(res.data) && res.data.length) return res.data;
  }
  return [];
}

/** Green In stock / amber Low / red Out of stock badge. */
function StockBadge({ stock }: { stock: number }) {
  const out = stock <= 0;
  const low = !out && stock <= 10;
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        out
          ? "bg-rose-100 text-rose-700"
          : low
            ? "bg-amber-100 text-amber-800"
            : "bg-emerald-100 text-emerald-700",
      )}
    >
      {out ? "Out of stock" : low ? `Low: ${stock}` : `In stock: ${stock}`}
    </span>
  );
}

/** Module — Pharmacy / Dispense: confirm or substitute each approved medicine. */
export default function PharmacyDispenseFlow() {
  const visits = useAdmittedVisits();
  const [visit, setVisit] = useState<TabletVisit | null>(null);

  if (!visit) {
    return (
      <TabletVisitList
        visits={visits.data || []}
        loading={visits.isLoading}
        error={visits.isError}
        onSelect={setVisit}
        emptyText="No admitted patients."
        metaKind="admitted"
      />
    );
  }
  return <PharmacyDispense visit={visit} onBack={() => setVisit(null)} />;
}

function PharmacyDispense({
  visit,
  onBack,
}: {
  visit: TabletVisit;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();

  // The item currently being substituted (its inline "Change" panel is open).
  const [changeFor, setChangeFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { medicines, isLoading: searching, searchTerm, setSearchTerm } =
    useMedicineSearch();

  const queueKey = ["tablet-pharmacy-queue", visit.id, visit.visitId];
  const queue = useQuery({
    queryKey: queueKey,
    queryFn: async (): Promise<QueueItem[]> => {
      const vm = await tryRows([
        { table: "visit_medications", col: "visit_id", val: visit.id },
        { table: "visit_medications", col: "visit_id", val: visit.visitId },
      ]);
      // Approved by the doctor, not yet dispensed by pharmacy.
      const pending = vm.filter(
        (r: any) => r.is_approved && r.status !== "dispensed",
      );

      const ids = [
        ...new Set(pending.map((r: any) => r.medication_id).filter(Boolean)),
      ];
      let names: Record<string, any> = {};
      for (const tbl of ["medicine_master", "medication", "medications"]) {
        if (!ids.length) break;
        const res = await db.from(tbl).select("*").in("id", ids);
        if (!res.error && res.data?.length) {
          names = Object.fromEntries(res.data.map((m: any) => [m.id, m]));
          break;
        }
      }
      const stock = await fetchMedicineStock(ids as string[]);

      return pending.map((r: any) => {
        const med = names[r.medication_id] || {};
        return {
          id: String(r.id),
          name:
            med.medicine_name ||
            med.name ||
            med.generic_name ||
            r.custom_medication_name ||
            r.medication_type ||
            "Medication",
          dose: r.dosage || "",
          route: r.route || "",
          frequency: r.frequency || "",
          medicationId: r.medication_id || null,
          stock: stock[r.medication_id] || 0,
        };
      });
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: queueKey });
    // The medication round only lists dispensed rows — refresh it too.
    qc.invalidateQueries({
      queryKey: ["tablet-mar-prescribed", visit.id, visit.visitId],
    });
    qc.invalidateQueries({
      queryKey: ["tablet-treatment-sheet", visit.id, visit.visitId],
    });
  };

  const closeChange = () => {
    setChangeFor(null);
    setReason("");
    setSearchTerm("");
  };

  const dispense = useMutation({
    mutationFn: async (patch: Record<string, any> & { rowId: string }) => {
      const { rowId, ...fields } = patch;
      const { error } = await db
        .from("visit_medications")
        .update({
          ...fields,
          status: "dispensed",
          dispensed_at: new Date().toISOString(),
          dispensed_by: user?.username || null,
        })
        .eq("id", rowId);
      if (error) throw error;
    },
    onSuccess: () => {
      closeChange();
      refresh();
    },
  });

  const dispenseAsPrescribed = (item: QueueItem) =>
    dispense.mutate({
      rowId: item.id,
      dispensed_medication_id: item.medicationId,
      dispensed_medication_name: item.name,
      is_substituted: false,
      substitute_reason: null,
    });

  const dispenseSubstitute = (item: QueueItem, picked: MedicineResult) =>
    dispense.mutate({
      rowId: item.id,
      dispensed_medication_id: picked.id,
      dispensed_medication_name: picked.name,
      is_substituted: true,
      substitute_reason: reason.trim() || null,
    });

  const items = queue.data || [];

  return (
    <FlowScaffold
      heading="Pharmacy"
      subheading={`${visit.patientName} · ${visit.patientsId || visit.visitId}`}
      actions={
        <TabletButton variant="outline" className="flex-1" onClick={onBack}>
          Change patient
        </TabletButton>
      }
    >
      {/* Set on the Vasooli (Gaurav) tile — the cost was already collected as
          a package, or this patient must not be billed at all. */}
      <NoChargeBadge patientId={visit.patientUuid} detailed className="mb-3" />

      {queue.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-6 text-center text-muted-foreground">
          Nothing to dispense. Approved medicines from the Treatment Sheet appear
          here.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Confirm each medicine, or change it to one that's in stock. Dispensed
            medicines move to the Medication Round.
          </p>
          {items.map((item) => {
            const open = changeFor === item.id;
            return (
              <div
                key={item.id}
                className={cn(
                  "overflow-hidden rounded-xl border bg-background",
                  open && "ring-2 ring-primary",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {[item.dose, item.route, item.frequency]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                    <div className="mt-2">
                      {item.medicationId ? (
                        <StockBadge stock={item.stock} />
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          Doctor-typed — pick a stock medicine
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {item.medicationId ? (
                      <button
                        type="button"
                        disabled={dispense.isPending}
                        onClick={() => dispenseAsPrescribed(item)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" /> Dispense
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setChangeFor(open ? null : item.id);
                        setReason("");
                        setSearchTerm("");
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold",
                        open && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      <Repeat className="h-4 w-4" /> Change
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="space-y-3 border-t p-4">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                      <TabletInput
                        className="pl-12"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search in-stock medicines…"
                      />
                    </div>
                    <div>
                      <TabletLabel>Reason (optional)</TabletLabel>
                      <TabletInput
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="e.g. Prescribed brand out of stock"
                      />
                    </div>
                    {searchTerm.trim().length === 0 ? (
                      <p className="py-2 text-center text-sm text-muted-foreground">
                        Type to find an available medicine.
                      </p>
                    ) : searching ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : medicines.length === 0 ? (
                      <p className="py-2 text-center text-sm text-muted-foreground">
                        No medicines found.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {medicines.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            disabled={dispense.isPending}
                            onClick={() => dispenseSubstitute(item, m)}
                            className="flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-50"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold">{m.name}</p>
                              <p className="truncate text-sm text-muted-foreground">
                                {[m.generic, m.type].filter(Boolean).join(" · ") ||
                                  "—"}
                              </p>
                            </div>
                            <StockBadge stock={m.totalStock} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          {dispense.isError ? (
            <p className="text-destructive">
              {(dispense.error as Error)?.message || "Could not dispense."}
            </p>
          ) : null}
        </div>
      )}
    </FlowScaffold>
  );
}
