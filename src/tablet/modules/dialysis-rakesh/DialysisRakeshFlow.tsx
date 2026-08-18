import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Droplets, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import {
  loadDialysisPatients,
  registeredInLast24h,
  SCHEME_LABEL,
  type DialysisPatientSessions,
} from "@/lib/dialysis/scheme";

// DATA SOURCE: visits (patient_type = 'Dialysis') + dialysis_session_billing
//   Dialysis is Hope-only, as every dialysis screen here is.

const HOSPITAL = "hope";

const SCHEME_STYLE: Record<string, string> = {
  PMJAY: "bg-indigo-100 text-indigo-800",
  MJPJAY: "bg-amber-100 text-amber-800",
  OTHER: "bg-slate-100 text-slate-700",
};

/**
 * Rakesh's tile: who came for dialysis, and which of their sessions have not
 * been claimed yet.
 *
 * Every date the patient came carries a red or green mark — red is a session
 * the hospital has not billed the Yojana for, green is one already sent. The
 * count of red ones against the scheme's block (PMJAY 3, MJPJAY 6) is what
 * says whether the patient is ready for Shashank to raise the claim.
 */
export default function DialysisRakeshFlow() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["dialysis-rakesh", HOSPITAL],
    queryFn: () => loadDialysisPatients(HOSPITAL),
    staleTime: 30_000,
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = showAll ? patients : patients.filter(registeredInLast24h);
    if (!term) return base;
    return base.filter((p) =>
      [p.patientName, p.patientsId, p.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [patients, search, showAll]);

  const readyCount = visible.filter((p) => p.readyToBill).length;

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading="Dialysis - Rakesh"
      subheading={
        showAll
          ? "Every dialysis patient — unbilled sessions per patient"
          : "Registered in the last 24 hours — unbilled sessions per patient"
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient name, ID or phone…"
            className="pl-10"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <TabletButton
            size="sm"
            variant={showAll ? "outline" : "default"}
            onClick={() => setShowAll(false)}
          >
            Last 24 hrs
          </TabletButton>
          <TabletButton
            size="sm"
            variant={showAll ? "default" : "outline"}
            onClick={() => setShowAll(true)}
          >
            All patients
          </TabletButton>
        </div>

        {readyCount > 0 && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {readyCount} patient{readyCount === 1 ? " has" : "s have"} completed a full block —
            ready for Shashank to bill.
          </p>
        )}

        {isLoading ? (
          <p className="py-10 text-center text-muted-foreground">Loading dialysis patients…</p>
        ) : visible.length === 0 ? (
          <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
            {showAll
              ? "No dialysis patients found."
              : "Nobody registered for dialysis in the last 24 hours."}
          </TabletCard>
        ) : (
          visible.map((patient) => (
            <PatientCard
              key={patient.patientId}
              patient={patient}
              open={expanded === patient.patientId}
              onToggle={() =>
                setExpanded((current) =>
                  current === patient.patientId ? null : patient.patientId,
                )
              }
            />
          ))
        )}
      </div>
    </FlowScaffold>
  );
}

function PatientCard({
  patient,
  open,
  onToggle,
}: {
  patient: DialysisPatientSessions;
  open: boolean;
  onToggle: () => void;
}) {
  const unbilled = patient.unbilledCount;
  // Split into whole bundles and the remainder. A PMJAY patient with five
  // unbilled sessions is not "5 pending" -- three of them are a complete
  // bundle that can be claimed today, and two carry into the next one. Showing
  // the raw five reads as though the whole lot is stuck (owner, 18-Aug:
  // Kamlesh Madankar, PMJAY, 5 shown where 3 should clear and 2 remain).
  const block = patient.block;
  const hasBundle = patient.scheme !== "OTHER";
  const readyBundles = hasBundle ? Math.floor(unbilled / block) : 0;
  const claimNow = readyBundles * block;
  const carryForward = hasBundle ? unbilled % block : unbilled;
  return (
    <TabletCard variant="flat" className="space-y-2">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 text-left">
        <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{patient.patientName}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {patient.patientsId && <span>{patient.patientsId}</span>}
            <span
              className={cn(
                "rounded px-2 py-0.5 font-medium",
                SCHEME_STYLE[patient.scheme] ?? SCHEME_STYLE.OTHER,
              )}
            >
              {SCHEME_LABEL[patient.scheme]}
              {patient.scheme !== "OTHER" ? ` · bill every ${patient.block}` : ""}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span
            className={cn(
              "block text-2xl font-bold tabular-nums",
              patient.readyToBill ? "text-emerald-700" : unbilled > 0 ? "text-red-600" : "text-muted-foreground",
            )}
          >
            {patient.readyToBill ? claimNow : unbilled}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {patient.readyToBill ? "to claim now" : `unbilled${hasBundle ? ` / ${block}` : ""}`}
          </span>
          {patient.readyToBill && carryForward > 0 && (
            <span className="block text-[11px] text-muted-foreground">
              +{carryForward} carry forward
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {patient.readyToBill && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          Ready for billing — {readyBundles} bundle{readyBundles === 1 ? "" : "s"} of {block}
          {" "}({claimNow} session{claimNow === 1 ? "" : "s"}) can be claimed now
          {carryForward > 0
            ? `, and ${carryForward} session${carryForward === 1 ? "" : "s"} carry into the next bundle`
            : ""}. It is in Shashank's pending list.
        </p>
      )}

      {open && (
        <div className="space-y-1 border-t pt-2">
          {patient.sessions.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No sessions recorded.</p>
          ) : (
            patient.sessions.map((session) => (
              <div
                key={session.visitId}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
              >
                <span className="flex items-center gap-2">
                  {session.billed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 fill-red-500 text-red-500" />
                  )}
                  {shortDate(session.visitDate)}
                  {session.visitCode && (
                    <span className="text-xs text-muted-foreground">{session.visitCode}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium uppercase",
                    session.billed
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700",
                  )}
                >
                  {session.billed ? "Billed" : "Not billed"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </TabletCard>
  );
}
