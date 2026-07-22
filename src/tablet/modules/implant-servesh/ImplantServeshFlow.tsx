import { useNavigate } from "react-router-dom";
import { CalendarClock, Loader2, Receipt, ScanLine, UserRound } from "lucide-react";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { useDailySchedule, todayDate } from "@/tablet/modules/ot-schedule/OtScheduleFlow";

const CHILD_MODULES = [
  {
    id: "implant-bill",
    label: "Implant Bill",
    description: "Open the existing implant vendor invoice flow.",
    icon: Receipt,
    tint: "from-rose-400 to-red-600",
  },
  {
    id: "implant-sticker",
    label: "Implant Sticker",
    description: "Open the existing implant pouch cover sheet flow.",
    icon: ScanLine,
    tint: "from-cyan-400 to-blue-600",
  },
] as const;

/**
 * Today's OT surgeries, read straight from the ot_schedule rows Gaurav saves —
 * so Sarvesh sees the same scheduled surgery/package without re-selecting it.
 */
function TodaysSurgeries() {
  const schedule = useDailySchedule(todayDate());
  const rows = schedule.data || [];

  return (
    <TabletCard className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold text-foreground">Today's OT surgeries (from Gaurav)</h3>
      </div>

      {schedule.isLoading ? (
        <div className="py-6 text-center text-muted-foreground">
          <Loader2 className="mr-2 inline-block h-5 w-5 animate-spin" />
          Loading scheduled surgeries...
        </div>
      ) : schedule.isError ? (
        <p className="py-6 text-center text-destructive">Could not load today's OT schedule.</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No surgeries scheduled for today yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-border bg-secondary/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{row.patientName}</span>
                    {row.patientsId ? (
                      <span className="text-xs font-normal text-muted-foreground">({row.patientsId})</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-primary">{row.surgeryName}</p>
                  {row.surgeonName ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">Surgeon: {row.surgeonName}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  {row.scheduledTime ? (
                    <p className="text-sm font-medium text-foreground">{row.scheduledTime}</p>
                  ) : null}
                  <p className="text-xs capitalize text-muted-foreground">{row.status}</p>
                  {row.otRoom ? <p className="text-xs text-muted-foreground">{row.otRoom}</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </TabletCard>
  );
}

export default function ImplantServeshFlow() {
  const navigate = useNavigate();

  return (
    <FlowScaffold
      heading="Implant Sarvesh"
      subheading="Today's scheduled surgeries, plus the implant tools."
    >
      <div className="grid gap-4">
        <TodaysSurgeries />

        <div className="grid gap-3">
          {CHILD_MODULES.map((module) => {
            const Icon = module.icon;

            return (
              <button
                key={module.id}
                type="button"
                onClick={() => navigate(`/${module.id}`, { viewTransition: true })}
                className="w-full text-left"
              >
                <TabletCard className="flex items-center gap-4 transition hover:border-primary/60 hover:bg-primary/5">
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${module.tint} shadow-lg`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold text-foreground">{module.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
                  </div>
                </TabletCard>
              </button>
            );
          })}
        </div>
      </div>
    </FlowScaffold>
  );
}
