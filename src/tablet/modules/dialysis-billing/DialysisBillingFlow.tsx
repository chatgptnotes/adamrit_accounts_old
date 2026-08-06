import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import {
  billOneBlock,
  loadDialysisPatients,
  SCHEME_LABEL,
  type DialysisPatientSessions,
} from "@/lib/dialysis/scheme";

// DATA SOURCE: visits (patient_type = 'Dialysis') + dialysis_session_billing
//   Marking billed writes the same rows Rakesh's tile reads, so a claim sent
//   here turns his red buttons green.

const HOSPITAL = "hope";

/**
 * Shashank's tile: raise the Yojana claims.
 *
 * The pending list is the queue — a patient appears once they have as many
 * unbilled sessions as their scheme's block (PMJAY 3, MJPJAY 6) and drops out
 * the moment the claim is marked sent. Billing claims the OLDEST unbilled
 * block, because those are the sessions that have been waiting.
 */
export default function DialysisBillingFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["dialysis-billing", HOSPITAL],
    queryFn: () => loadDialysisPatients(HOSPITAL),
    staleTime: 30_000,
  });

  const bill = useMutation({
    mutationFn: async (patient: DialysisPatientSessions) =>
      billOneBlock(HOSPITAL, patient, user?.email || user?.id || null),
    onSuccess: (count, patient) => {
      toast.success(
        `${count} session${count === 1 ? "" : "s"} marked billed for ${patient.patientName}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["dialysis-billing"] });
      queryClient.invalidateQueries({ queryKey: ["dialysis-rakesh"] });
      queryClient.invalidateQueries({ queryKey: ["dialysis-session-billing"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not mark the sessions billed"),
  });

  const { pending, all } = useMemo(() => {
    const term = search.trim().toLowerCase();
    const match = (p: DialysisPatientSessions) =>
      !term ||
      [p.patientName, p.patientsId, p.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    return {
      pending: patients.filter((p) => p.readyToBill && match(p)),
      all: patients.filter(match),
    };
  }, [patients, search]);

  const list = tab === "pending" ? pending : all;

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading="Dialysis Billing - Shashank"
      subheading="Patients whose unbilled sessions have reached their scheme's block"
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
            variant={tab === "pending" ? "default" : "outline"}
            onClick={() => setTab("pending")}
          >
            Pending billing ({pending.length})
          </TabletButton>
          <TabletButton
            size="sm"
            variant={tab === "all" ? "default" : "outline"}
            onClick={() => setTab("all")}
          >
            All patients ({all.length})
          </TabletButton>
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-muted-foreground">Loading dialysis patients…</p>
        ) : list.length === 0 ? (
          <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
            {tab === "pending"
              ? "Nothing pending — no patient has completed an unbilled block."
              : "No dialysis patients found."}
          </TabletCard>
        ) : (
          list.map((patient) => {
            const unbilledDates = patient.sessions
              .filter((s) => !s.billed)
              .sort((a, b) => a.visitDate.localeCompare(b.visitDate));
            const claiming = unbilledDates.slice(0, patient.block);
            return (
              <TabletCard key={patient.patientId} variant="flat" className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">{patient.patientName}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[patient.patientsId, SCHEME_LABEL[patient.scheme]].filter(Boolean).join(" · ")}
                      {patient.scheme !== "OTHER" ? ` · bill every ${patient.block}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        patient.readyToBill ? "text-emerald-700" : "text-red-600",
                      )}
                    >
                      {patient.unbilledCount}
                    </div>
                    <p className="text-[11px] text-muted-foreground">unbilled</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                  {patient.sessions.slice(0, 12).map((session) => (
                    <span
                      key={session.visitId}
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                        session.billed
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800",
                      )}
                    >
                      {session.billed ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Circle className="h-3 w-3 fill-current" />
                      )}
                      {shortDate(session.visitDate)}
                    </span>
                  ))}
                  {patient.sessions.length > 12 && (
                    <span className="self-center text-xs text-muted-foreground">
                      +{patient.sessions.length - 12} more
                    </span>
                  )}
                </div>

                {patient.readyToBill ? (
                  <TabletButton
                    className="w-full"
                    disabled={bill.isPending}
                    onClick={() => bill.mutate(patient)}
                  >
                    {bill.isPending ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Receipt className="mr-2 h-5 w-5" />
                    )}
                    Mark {patient.block} session{patient.block === 1 ? "" : "s"} billed —{" "}
                    {claiming.length > 0
                      ? `${shortDate(claiming[0].visitDate)} to ${shortDate(
                          claiming[claiming.length - 1].visitDate,
                        )}`
                      : ""}
                  </TabletButton>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {patient.unbilledCount} of {patient.block} sessions towards the next claim.
                  </p>
                )}
              </TabletCard>
            );
          })
        )}
      </div>
    </FlowScaffold>
  );
}
