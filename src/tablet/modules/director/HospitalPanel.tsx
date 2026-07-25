import { useNavigate } from "react-router-dom";
import { BedDouble, LogIn, LogOut, Stethoscope, Wallet } from "lucide-react";
import { HOSPITAL_CONFIGS, type HospitalType } from "@/types/hospital";
import { useDirectorKpis, type KpiPeriod } from "@/hooks/useDirectorKpis";
import { inr } from "@/tablet/lib/format";
import { AlertStrip } from "./AlertStrip";
import { ArAgingCard } from "./ArAgingCard";
import { CashFundsCard } from "./CashFundsCard";
import { KpiTile } from "./KpiTile";
import { OccupancyCard } from "./OccupancyCard";

const PERIOD_SUBTITLE: Record<KpiPeriod, string> = {
  today: "Today",
  month: "This month",
  year: "This year",
  specific: "Selected month",
};

const fmtCount = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-IN"));
const fmtMoney = (n: number | null) => (n == null ? "—" : inr(n));

interface Props {
  hospital: HospitalType;
  period: KpiPeriod;
  /** Hospital-scoped drill: (hospital, path) => void. */
  drill: (hospital: HospitalType, path: string) => void;
}

/**
 * One hospital's slice of the director dashboard: OPD / admissions / discharges
 * / currently-admitted / collections, plus its live bed occupancy. Every tile
 * drills into the matching detail page scoped to this hospital.
 */
export function HospitalPanel({ hospital, period, drill }: Props) {
  const navigate = useNavigate();
  const config = HOSPITAL_CONFIGS[hospital];
  const { data: kpis, error } = useDirectorKpis(period, "", hospital);
  const subtitle = PERIOD_SUBTITLE[period];

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card/30 p-3 sm:p-4">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-sm font-bold text-white">
          {config.fullName.charAt(0)}
        </span>
        <h2 className="text-lg font-semibold">{config.fullName}</h2>
      </header>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          Failed to load some metrics: {error.message}
        </div>
      )}

      <AlertStrip pendingApprovals={kpis.pendingApprovals} hospital={hospital} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {/* OPD & Admissions lists cover both hospitals, so no hospital switch. */}
        <KpiTile
          label="OPD Visits"
          value={fmtCount(kpis.opdVisits)}
          subtitle={subtitle}
          icon={Stethoscope}
          tint="from-purple-400 to-purple-600"
          onClick={() => navigate("/todays-opd")}
        />
        <KpiTile
          label="Admissions"
          value={fmtCount(kpis.admissions)}
          subtitle={subtitle}
          icon={LogIn}
          tint="from-blue-400 to-blue-600"
          onClick={() => navigate("/todays-ipd")}
        />
        <KpiTile
          label="Discharges"
          value={fmtCount(kpis.discharges)}
          subtitle={subtitle}
          icon={LogOut}
          tint="from-green-400 to-green-600"
          onClick={() => drill(hospital, "/discharge")}
        />
        <KpiTile
          label="Currently Admitted"
          value={fmtCount(kpis.activeIpd)}
          subtitle="Live"
          icon={BedDouble}
          tint="from-amber-400 to-amber-600"
          onClick={() => drill(hospital, "/occupancy")}
        />
        <KpiTile
          label="Advance / Collections"
          value={fmtMoney(kpis.collection)}
          subtitle={subtitle}
          icon={Wallet}
          tint="from-emerald-400 to-emerald-600"
          onClick={() => drill(hospital, "/advance")}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <OccupancyCard hospital={hospital} onOpen={() => drill(hospital, "/occupancy")} />
        <CashFundsCard hospital={hospital} />
        <ArAgingCard hospital={hospital} />
      </div>
    </section>
  );
}
