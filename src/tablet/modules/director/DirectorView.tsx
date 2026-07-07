import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BedDouble,
  ClipboardCheck,
  LogIn,
  LogOut,
  Stethoscope,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useDirectorKpis,
  type KpiPeriod,
} from "@/hooks/useDirectorKpis";
import { inr } from "@/tablet/lib/format";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";
import { AlertStrip } from "./AlertStrip";
import { ArAgingCard } from "./ArAgingCard";
import { CashFundsCard } from "./CashFundsCard";
import { DeadlinesPreview } from "./DeadlinesPreview";
import { KpiTile } from "./KpiTile";
import { OccupancyCard } from "./OccupancyCard";
import { PeriodPills } from "./PeriodPills";
import { GovernmentPortalGeneralMedicalSection } from "@/components/GovernmentPortalGeneralMedicalSection";

const PERIOD_SUBTITLE: Record<KpiPeriod, string> = {
  today: "Today",
  month: "This month",
  year: "This year",
  specific: "Selected month",
};

const fmtCount = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-IN"));
const fmtMoney = (n: number | null) => (n == null ? "—" : inr(n));

/**
 * Tablet-native Director view. Read-only, glance-first: alerts → today's KPIs
 * → money → A/R → beds → upcoming deadlines. Tap any card to drill into the
 * desktop/tablet editor for that data.
 */
export default function DirectorView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const hospital = (user?.hospitalType as string) || "hope";
  const [period, setPeriod] = useState<KpiPeriod>("today");
  const { data: kpis, error } = useDirectorKpis(period, "");

  const subtitle = PERIOD_SUBTITLE[period];

  return (
    <div className="relative isolate h-full">
      <TabletWatermark />
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          <PeriodPills value={period} onChange={setPeriod} />

          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Failed to load some metrics: {error.message}
            </div>
          )}

          <AlertStrip
            pendingApprovals={kpis.pendingApprovals}
            hospital={hospital}
          />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <KpiTile
              label="Collections"
              value={fmtMoney(kpis.collection)}
              subtitle={subtitle}
              icon={Wallet}
              tint="from-emerald-400 to-emerald-600"
              onClick={() => navigate("/daily-payment-allocation")}
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
              onClick={() => navigate("/discharged-patients")}
            />
            <KpiTile
              label="OPD Visits"
              value={fmtCount(kpis.opdVisits)}
              subtitle={subtitle}
              icon={Stethoscope}
              tint="from-purple-400 to-purple-600"
              onClick={() => navigate("/todays-opd")}
            />
            <KpiTile
              label="Currently Admitted"
              value={fmtCount(kpis.activeIpd)}
              subtitle="Live"
              icon={BedDouble}
              tint="from-amber-400 to-amber-600"
              onClick={() => navigate("/todays-ipd")}
            />
            <KpiTile
              label="Pending Approvals"
              value={fmtCount(kpis.pendingApprovals)}
              subtitle="Live"
              icon={ClipboardCheck}
              tint="from-rose-400 to-rose-600"
              onClick={() => navigate("/bill-approvals")}
            />
          </div>

          <GovernmentPortalGeneralMedicalSection surface="tablet" maxRows={6} />

          <div className="grid gap-3 lg:grid-cols-2">
            <CashFundsCard hospital={hospital} />
            <ArAgingCard hospital={hospital} />
            <OccupancyCard />
            <DeadlinesPreview />
          </div>
        </div>
      </div>
    </div>
  );
}
