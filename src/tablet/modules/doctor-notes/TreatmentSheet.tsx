import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Camera,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useMedicalDataMutations } from "@/hooks/useMedicalDataMutations";
import {
  useMedicineSearch,
  fetchMedicineStock,
  type MedicineResult,
} from "@/tablet/hooks/useMedicineSearch";
import type { TabletVisit } from "@/tablet/hooks/useVisitLists";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { ScanChartModal } from "./ScanChartModal";

interface MedRow {
  id: string;
  name: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  stock: number;
  isCustom: boolean;
  isApproved: boolean;
  addedAt: string | null;
  startDate: string | null; // order started (active if endDate is null)
  endDate: string | null; // order stopped/changed-out — moves it to history
  notes: string | null; // optional reason captured on stop
  dispensedName: string | null; // what the pharmacy actually gave
  isSubstituted: boolean; // pharmacy gave a different medicine
  substituteReason: string | null;
}
interface PlanRow {
  day_number: number;
  date_of_stay: string | null;
  medication: string | null;
  lab_and_radiology: string | null;
  accommodation: string | null;
}

// Untyped client — schema/column names vary across deployments.
const db = supabase as any;

const TH =
  "border-b px-3 py-2.5 text-sm font-semibold text-muted-foreground whitespace-nowrap";
const TD = "border-b px-3 py-3 align-top text-sm";

const FREQUENCIES = ["OD", "BD", "TDS", "QID", "HS", "SOS"];
const ROUTES = ["Oral", "IV", "IM", "S/C", "Topical"];
const DURATIONS = ["3 days", "5 days", "7 days", "10 days"];
const DOSES = ["250 mg", "500 mg", "650 mg", "1 g"];
const PATIENT_STAY_OPTIONS = ["Room", "ICU", "Ward"];
type PatientLocation = string;

function getLocationColor(location: string): string {
  const key = location.toLowerCase();
  if (key.includes("icu")) return "bg-red-600 text-white";
  if (key.includes("ward")) return "bg-blue-600 text-white";
  if (key.includes("room")) return "bg-emerald-600 text-white";
  if (key.includes("ot")) return "bg-orange-500 text-white";
  return "bg-primary text-primary-foreground";
}

// Sentinel id for the doctor-typed custom medicine (not in the catalogue).
const CUSTOM_ID = "__custom__";

const CHIP_BASE =
  "h-11 rounded-full px-4 text-sm font-medium transition-colors";

/** Live pharmacy-stock badge — green In stock / amber Low / red Out of stock. */
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

/** A label + one-tap chips; tapping the selected chip clears it. */
function ChipRow({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div>
      <TabletLabel>{label}</TabletLabel>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onSelect(value === o ? "" : o)}
            className={cn(
              CHIP_BASE,
              value === o
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** First non-erroring result for a list of (table, column, value) attempts. */
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

/** "12 May" style short date; empty string for missing/invalid input. */
function fmtDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString([], { day: "2-digit", month: "short" });
}

/** Day number of admission (Day 1 = admission day), or null if unknown. */
function admissionDay(admission: string | null): number | null {
  if (!admission) return null;
  const a = new Date(admission);
  if (Number.isNaN(a.getTime())) return null;
  const days = Math.floor((Date.now() - a.getTime()) / 86_400_000);
  return Math.max(1, days + 1);
}

/**
 * Treatment Sheet — a living drug chart. Active medicines for today (each can be
 * changed or stopped), an inline "Add medication" search, a history of stopped/
 * changed medicines, and the daily plan. The doctor prescribes by name; pharmacy
 * dispensing is separate and stock is display-only (never changed here).
 */
export function TreatmentSheet({
  visit,
  onBack,
}: {
  visit: TabletVisit;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [showPast, setShowPast] = useState(false);
  const locationKey = `patientLocation_${visit.id}`;
  const [patientLocation, setPatientLocation] = useState<PatientLocation | null>(
    () => localStorage.getItem(locationKey),
  );
  const handleLocationSelect = (loc: string) => {
    const next = loc.trim() || null;
    setPatientLocation(next);
    if (next) localStorage.setItem(locationKey, next);
    else localStorage.removeItem(locationKey);
  };
  const invalidateSheet = () =>
    qc.invalidateQueries({
      queryKey: ["tablet-treatment-sheet", visit.id, visit.visitId],
    });

  const data = useQuery({
    queryKey: ["tablet-treatment-sheet", visit.id, visit.visitId],
    queryFn: async (): Promise<{ medications: MedRow[]; plan: PlanRow[] }> => {
      const medRows = await tryRows([
        { table: "visit_medications", col: "visit_id", val: visit.id },
        { table: "visit_medications", col: "visit_id", val: visit.visitId },
      ]);

      const medIds = [
        ...new Set(medRows.map((m: any) => m.medication_id).filter(Boolean)),
      ];
      let medMap: Record<string, any> = {};
      for (const tbl of ["medicine_master", "medication", "medications"]) {
        if (!medIds.length) break;
        const res = await db.from(tbl).select("*").in("id", medIds);
        if (!res.error && Array.isArray(res.data) && res.data.length) {
          medMap = Object.fromEntries(res.data.map((m: any) => [m.id, m]));
          break;
        }
      }
      const stockMap = await fetchMedicineStock(medIds as string[]);

      const medications: MedRow[] = medRows.map((m: any) => {
        const med = medMap[m.medication_id] || {};
        return {
          id: String(m.id),
          name:
            med.medicine_name ||
            med.name ||
            med.generic_name ||
            m.custom_medication_name ||
            m.medication_type ||
            "Medication",
          dosage: [m.dosage, med.strength].filter(Boolean).join(" "),
          route: m.route || "",
          frequency: m.frequency || "",
          duration: m.duration || "",
          stock: stockMap[m.medication_id] || 0,
          isCustom: !m.medication_id,
          isApproved: !!m.is_approved,
          addedAt: m.created_at || m.prescribed_date || null,
          startDate: m.start_date || m.prescribed_date || null,
          endDate: m.end_date || null,
          notes: m.notes || null,
          dispensedName: m.dispensed_medication_name || null,
          isSubstituted: !!m.is_substituted,
          substituteReason: m.substitute_reason || null,
        };
      });

      const planRows = await tryRows([
        { table: "doctor_plan", col: "visit_id", val: visit.visitId },
        { table: "doctor_plan", col: "visit_id", val: visit.id },
      ]);
      const plan: PlanRow[] = [...planRows].sort(
        (a, b) => (a.day_number || 0) - (b.day_number || 0),
      ) as PlanRow[];

      return { medications, plan };
    },
  });

  const meds = data.data?.medications || [];
  const plan = data.data?.plan || [];
  const activeMeds = meds.filter((m) => !m.endDate);
  const pastMeds = meds.filter((m) => !!m.endDate);
  const dayN = admissionDay(visit.admissionDate);

  return (
    <FlowScaffold
      heading="Treatment Sheet"
      subheading={`${visit.patientName} · ${visit.patientsId || visit.visitId}`}
      actions={
        <>
          <TabletButton variant="outline" className="flex-1" onClick={onBack}>
            Back
          </TabletButton>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => window.print()}
            disabled={data.isLoading}
          >
            <Printer className="h-5 w-5" /> Print
          </TabletButton>
        </>
      }
    >
      {data.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="tablet-print-area space-y-5">
          {/* Title block — printout only; the page header already shows this
              title on screen, so showing it here too would duplicate it. */}
          <div className="hidden border-b pb-3 print:block">
            <h3 className="text-lg font-bold">Treatment Sheet</h3>
            <p className="text-sm text-muted-foreground">
              {visit.patientName} · {visit.patientsId || visit.visitId}
              {dayN ? ` · Day ${dayN}` : ""}
            </p>
          </div>

          {/* Day-of-admission line (screen) */}
          {dayN ? (
            <p className="tablet-no-print text-sm font-medium text-muted-foreground">
              Day {dayN} of admission
              {visit.admissionDate
                ? ` · admitted ${fmtDate(visit.admissionDate)}`
                : ""}
            </p>
          ) : null}

          {/* Patient location selector — sent to pharmacy with every approval */}
          <section className="tablet-no-print">
            <TabletLabel>Patient stay (sent to pharmacy)</TabletLabel>
            <div className="relative">
              <select
                value={patientLocation || ""}
                onChange={(e) => handleLocationSelect(e.target.value)}
                className="h-12 w-full appearance-none rounded-xl border bg-background px-4 pr-11 text-base font-semibold outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select where patient is staying</option>
                {PATIENT_STAY_OPTIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            </div>
            {patientLocation ? (
              <span
                className={cn(
                  "mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                  getLocationColor(patientLocation),
                )}
              >
                {patientLocation}
              </span>
            ) : null}
          </section>

          {/* Active medicines — today's chart, each can be changed or stopped */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="font-semibold">
                Active medicines ({activeMeds.length})
              </h4>
              <BulkApproveBar
                pending={activeMeds.filter((m) => !m.isApproved)}
                patientLocation={patientLocation}
                onDone={invalidateSheet}
              />
            </div>
            {activeMeds.length === 0 ? (
              <p className="rounded-xl border px-3 py-8 text-center text-muted-foreground">
                No active medicines — add one below.
              </p>
            ) : (
              <div className="space-y-2">
                {activeMeds.map((m) => (
                  <ActiveMedCard
                    key={m.id}
                    med={m}
                    visitId={visit.id}
                    patientLocation={patientLocation}
                    onChanged={invalidateSheet}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Add medication — inline on this same page (hidden when printing) */}
          <AddMedicationSection visit={visit} />

          {/* Past medicines — stopped / changed-out orders, with date ranges */}
          {pastMeds.length > 0 ? (
            <section>
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="tablet-no-print flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left font-semibold"
              >
                <span>Past medicines ({pastMeds.length})</span>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 transition-transform",
                    showPast && "rotate-180",
                  )}
                />
              </button>
              {/* Always print history; on screen, only when expanded */}
              <h4 className="mb-2 mt-4 hidden font-semibold print:block">
                Past medicines
              </h4>
              <div className={cn("mt-2 space-y-2", !showPast && "hidden print:block")}>
                {pastMeds.map((m) => (
                  <div key={m.id} className="rounded-xl border bg-muted/30 p-3">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {[m.dosage, m.frequency, m.route]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {m.startDate ? `Started ${fmtDate(m.startDate)}` : ""}
                      {m.endDate ? ` – Stopped ${fmtDate(m.endDate)}` : ""}
                    </p>
                    {m.notes ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Reason: {m.notes}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Daily treatment plan — table */}
          {plan.length > 0 ? (
            <section>
              <h4 className="mb-2 font-semibold">Daily treatment plan</h4>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-muted">
                      <th className={TH}>Day</th>
                      <th className={TH}>Date</th>
                      <th className={TH}>Medication</th>
                      <th className={TH}>Lab / Radiology</th>
                      <th className={TH}>Accommodation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((p, i) => (
                      <tr key={`${p.day_number}-${i}`} className="last:[&>td]:border-0">
                        <td className={`${TD} font-medium`}>
                          Day {p.day_number}
                        </td>
                        <td className={TD}>{p.date_of_stay || "—"}</td>
                        <td className={TD}>{p.medication || "—"}</td>
                        <td className={TD}>{p.lab_and_radiology || "—"}</td>
                        <td className={TD}>{p.accommodation || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </FlowScaffold>
  );
}

/**
 * One-tap "Approve all" for the pending medicines on this sheet. Hidden when
 * nothing is pending. Approves them in a single batch so they land on one
 * pharmacy card and fire one notification (see approveMedications).
 */
function BulkApproveBar({
  pending,
  patientLocation,
  onDone,
}: {
  pending: MedRow[];
  patientLocation: PatientLocation | null;
  onDone: () => void;
}) {
  const { approveMedications, isApprovingMedications } =
    useMedicalDataMutations();
  if (pending.length === 0) return null;
  return (
    <button
      type="button"
      disabled={isApprovingMedications}
      onClick={() =>
        approveMedications(
          { rowIds: pending.map((m) => m.id), patientLocation },
          { onSuccess: onDone },
        )
      }
      className="tablet-no-print inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
    >
      <Check className="h-3.5 w-3.5" /> Approve all ({pending.length})
    </button>
  );
}

/**
 * One active medicine in the chart — shows the order + pharmacy substitution,
 * with one-tap Change (ends the order today, starts a new one) and Stop.
 */
function ActiveMedCard({
  med,
  visitId,
  patientLocation,
  onChanged,
}: {
  med: MedRow;
  visitId: string;
  patientLocation: PatientLocation | null;
  onChanged: () => void;
}) {
  const {
    changeMedication,
    discontinueMedication,
    approveMedication,
    resendMedication,
    deleteMedication,
    isChangingMedication,
    isDiscontinuingMedication,
    isApprovingMedication,
    isResendingMedication,
    isDeletingMedication,
  } = useMedicalDataMutations();
  const [editing, setEditing] = useState(false);
  const [dose, setDose] = useState(med.dosage);
  const [frequency, setFrequency] = useState(med.frequency);
  const [route, setRoute] = useState(med.route);

  const ACTION =
    "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{med.name}</p>
          <p className="text-sm text-muted-foreground">
            {[med.dosage, med.frequency, med.route].filter(Boolean).join(" · ") ||
              "—"}
          </p>
          {med.startDate ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Started {fmtDate(med.startDate)}
            </p>
          ) : null}
          {med.isSubstituted ? (
            <p className="mt-1 inline-block rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-800">
              Pharmacy gave: {med.dispensedName || "—"}
              {med.substituteReason ? ` — ${med.substituteReason}` : " (substituted)"}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StockBadge stock={med.stock} />
          <span
            className={cn(
              "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
              med.isApproved
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-800",
            )}
          >
            {med.isApproved ? "Approved" : "Pending"}
          </span>
        </div>
      </div>

      {editing ? (
        <div className="tablet-no-print mt-3 space-y-3 rounded-lg border bg-muted/30 p-3">
          <div>
            <TabletLabel>New dose</TabletLabel>
            <TabletInput
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              placeholder="e.g. 500 mg"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {DOSES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDose(dose === d ? "" : d)}
                  className={cn(
                    CHIP_BASE,
                    dose === d
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <ChipRow
            label="Frequency"
            options={FREQUENCIES}
            value={frequency}
            onSelect={setFrequency}
          />
          <ChipRow label="Route" options={ROUTES} value={route} onSelect={setRoute} />
          <div className="flex gap-2">
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => setEditing(false)}
              disabled={isChangingMedication}
            >
              Cancel
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={isChangingMedication}
              onClick={() =>
                changeMedication(
                  {
                    rowId: med.id,
                    visitId,
                    name: med.name,
                    dosage: dose.trim() || undefined,
                    frequency: frequency.trim() || undefined,
                    route: route.trim() || undefined,
                    duration: med.duration || undefined,
                  },
                  {
                    onSuccess: () => {
                      setEditing(false);
                      onChanged();
                    },
                  },
                )
              }
            >
              {isChangingMedication ? "Saving…" : "Save change"}
            </TabletButton>
          </div>
        </div>
      ) : (
        <div className="tablet-no-print mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(ACTION, "bg-muted text-foreground")}
          >
            <Pencil className="h-3.5 w-3.5" /> Change
          </button>
          <button
            type="button"
            disabled={isDiscontinuingMedication}
            onClick={() =>
              discontinueMedication({ rowId: med.id }, { onSuccess: onChanged })
            }
            className={cn(ACTION, "bg-amber-100 text-amber-800")}
          >
            <Ban className="h-3.5 w-3.5" /> Stop
          </button>
          {!med.isApproved ? (
            <button
              type="button"
              disabled={isApprovingMedication}
              onClick={() =>
                approveMedication({ rowId: med.id, patientLocation }, { onSuccess: onChanged })
              }
              className={cn(ACTION, "bg-emerald-600 text-white")}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
          ) : (
            <button
              type="button"
              disabled={isResendingMedication}
              onClick={() => resendMedication({ rowId: med.id, patientLocation })}
              className={cn(ACTION, "bg-emerald-50 text-emerald-700")}
            >
              <Send className="h-3.5 w-3.5" /> Resend to pharmacy
            </button>
          )}
          <button
            type="button"
            disabled={isDeletingMedication}
            onClick={() =>
              deleteMedication({ rowId: med.id }, { onSuccess: onChanged })
            }
            className={cn(ACTION, "bg-rose-100 text-rose-700")}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Inline "Add medication" — quick-pick frequent drugs, full pharmacy search,
 * and a one-tap prescribe panel, all on the Treatment Sheet page (no separate
 * screen). Hidden when printing.
 */
function AddMedicationSection({ visit }: { visit: TabletVisit }) {
  const qc = useQueryClient();
  const { medicines, isLoading, searchTerm, setSearchTerm } = useMedicineSearch();
  const { addMedications, isAddingMedications } = useMedicalDataMutations();
  const [showScan, setShowScan] = useState(false);

  // Most-prescribed medicines across the system — one-tap quick picks.
  const quickPicks = useQuery({
    queryKey: ["tablet-frequent-meds"],
    queryFn: async (): Promise<MedicineResult[]> => {
      const { data: rows, error } = await db
        .from("visit_medications")
        .select("medication_id")
        .limit(500);
      if (error || !Array.isArray(rows)) return [];
      const counts: Record<string, number> = {};
      for (const r of rows) {
        if (r.medication_id) {
          counts[r.medication_id] = (counts[r.medication_id] || 0) + 1;
        }
      }
      const topIds = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id]) => id);
      if (!topIds.length) return [];
      const res = await db
        .from("medicine_master")
        .select("id, medicine_name, generic_name, type")
        .in("id", topIds);
      const stock = await fetchMedicineStock(topIds);
      const byId: Record<string, MedicineResult> = {};
      for (const m of res.data || []) {
        byId[m.id] = {
          id: m.id,
          name: m.medicine_name || m.generic_name || "Medicine",
          generic: m.generic_name || "",
          type: m.type || "",
          totalStock: stock[m.id] || 0,
        };
      }
      return topIds.map((id) => byId[id]).filter(Boolean); // keep frequency order
    },
  });

  // `from` disambiguates a drug that is both a quick pick and a search hit.
  const [expanded, setExpanded] = useState<{
    id: string;
    from: "quick" | "search" | "custom";
  } | null>(null);
  const [dosage, setDosage] = useState("");
  const [route, setRoute] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");

  const resetFields = () => {
    setDosage("");
    setRoute("");
    setFrequency("");
    setDuration("");
  };

  const toggleMed = (m: MedicineResult, from: "quick" | "search" | "custom") => {
    if (expanded?.id === m.id && expanded.from === from) {
      setExpanded(null);
      return;
    }
    setExpanded({ id: m.id, from });
    resetFields();
  };

  const addMed = (m: MedicineResult) => {
    addMedications(
      {
        visitId: visit.id,
        medications: [
          {
            medication_type: "prescribed",
            // Store every picked medicine by name. The pharmacy search/quick-picks
            // read from `medicine_master`, but visit_medications.medication_id FKs
            // to a different `medications` table — sending that id 409s (FK
            // violation). The chart mapping above falls back to
            // custom_medication_name, so the name still displays correctly.
            custom_medication_name: m.name,
            dosage: dosage.trim() || undefined,
            route: route.trim() || undefined,
            frequency: frequency.trim() || undefined,
            duration: duration.trim() || undefined,
          },
        ],
      },
      {
        onSuccess: () => {
          setExpanded(null);
          resetFields();
          setSearchTerm("");
          // The chart table above refreshes; the quick-pick list re-ranks.
          qc.invalidateQueries({
            queryKey: ["tablet-treatment-sheet", visit.id, visit.visitId],
          });
          qc.invalidateQueries({ queryKey: ["tablet-frequent-meds"] });
        },
      },
    );
  };

  /** The inline prescribe panel for one medicine — dose + chips + add button. */
  const renderPanel = (m: MedicineResult) => (
    <div className="space-y-3 p-3">
      {m.totalStock <= 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Out of stock in the pharmacy — you can still prescribe it.
        </p>
      ) : null}
      <div>
        <TabletLabel>Dose</TabletLabel>
        <TabletInput
          value={dosage}
          onChange={(e) => setDosage(e.target.value)}
          placeholder="e.g. 500 mg (optional)"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {DOSES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDosage(dosage === d ? "" : d)}
              className={cn(
                CHIP_BASE,
                dosage === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <ChipRow
        label="Frequency"
        options={FREQUENCIES}
        value={frequency}
        onSelect={setFrequency}
      />
      <ChipRow label="Route" options={ROUTES} value={route} onSelect={setRoute} />
      <ChipRow
        label="Duration"
        options={DURATIONS}
        value={duration}
        onSelect={setDuration}
      />
      <TabletButton
        className="w-full"
        disabled={isAddingMedications}
        onClick={() => addMed(m)}
      >
        {isAddingMedications ? "Adding…" : "Add to chart"}
      </TabletButton>
    </div>
  );

  const showResults = searchTerm.trim().length > 0;
  const picks = quickPicks.data || [];
  const quickExpanded =
    expanded?.from === "quick"
      ? picks.find((p) => p.id === expanded.id)
      : undefined;

  return (
    <section className="tablet-no-print space-y-4 rounded-2xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">Add medication</h4>
        <TabletButton variant="outline" onClick={() => setShowScan(true)}>
          <Camera className="h-5 w-5" /> Scan chart
        </TabletButton>
      </div>

      <ScanChartModal
        open={showScan}
        onOpenChange={setShowScan}
        visit={visit}
        onDone={() =>
          qc.invalidateQueries({
            queryKey: ["tablet-treatment-sheet", visit.id, visit.visitId],
          })
        }
      />

      {/* Quick picks — one-tap frequent medicines (hidden while searching) */}
      {!showResults && picks.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Frequently prescribed — tap to add
          </p>
          <div className="flex flex-wrap gap-2">
            {picks.map((m) => {
              const open = expanded?.id === m.id && expanded.from === "quick";
              const dot =
                m.totalStock <= 0
                  ? "bg-rose-500"
                  : m.totalStock <= 10
                    ? "bg-amber-500"
                    : "bg-emerald-500";
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMed(m, "quick")}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors",
                    open
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", dot)} />
                  {m.name}
                </button>
              );
            })}
          </div>
          {quickExpanded ? (
            <div className="rounded-xl border bg-background">
              {renderPanel(quickExpanded)}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Search the full pharmacy catalogue */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <TabletInput
          className="pl-12"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search all pharmacy medicines…"
        />
      </div>

      {!showResults ? null : isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : medicines.length === 0 ? (
        <div className="space-y-3 py-4">
          <p className="text-center text-muted-foreground">
            No medicines found in the pharmacy.
          </p>
          {(() => {
            const customName = searchTerm.trim();
            const customMed: MedicineResult = {
              id: CUSTOM_ID,
              name: customName,
              generic: "",
              type: "",
              totalStock: 0,
            };
            const open = expanded?.from === "custom";
            return (
              <div
                className={cn(
                  "overflow-hidden rounded-xl border bg-background",
                  open && "ring-2 ring-primary",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleMed(customMed, "custom")}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      Add “{customName}” as a new medicine
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      Prescribe by name for this patient — needs your approval
                    </span>
                  </span>
                </button>
                {open ? (
                  <div className="border-t">{renderPanel(customMed)}</div>
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="space-y-2">
          {medicines.map((m) => {
            const open = expanded?.id === m.id && expanded.from === "search";
            return (
              <div
                key={m.id}
                className={cn(
                  "overflow-hidden rounded-xl border bg-background",
                  open && "ring-2 ring-primary",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleMed(m, "search")}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{m.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[m.generic, m.type].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <StockBadge stock={m.totalStock} />
                </button>
                {open ? (
                  <div className="border-t">{renderPanel(m)}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
