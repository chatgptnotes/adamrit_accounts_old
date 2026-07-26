import { useState } from "react";
import { type KpiPeriod } from "@/hooks/useDirectorKpis";
import type { HospitalType } from "@/types/hospital";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";
import { DeadlinesPreview } from "./DeadlinesPreview";
import { HospitalPanel } from "./HospitalPanel";
import { PanelDocumentsPreview } from "./PanelDocumentsPreview";
import { PeriodPills } from "./PeriodPills";
import { GovernmentPortalGeneralMedicalSection } from "@/components/GovernmentPortalGeneralMedicalSection";

// Both hospitals, always shown together regardless of the logged-in one.
const HOSPITALS: HospitalType[] = ["hope", "ayushman"];

/**
 * Tablet-native Director view. Read-only, glance-first, and cross-hospital:
 * one panel per hospital (Hope + Ayushman) with its alerts, OPD / admissions /
 * discharges / currently-admitted / advance-collections and live bed occupancy.
 * Tap any tile to drill into that hospital's detail page. Upcoming deadlines are
 * org-wide and shown once.
 */
export default function DirectorView() {
  const [period, setPeriod] = useState<KpiPeriod>("today");

  return (
    <div className="relative isolate h-full">
      <TabletWatermark />
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <PeriodPills value={period} onChange={setPeriod} />

          {HOSPITALS.map((hospital) => (
            <HospitalPanel key={hospital} hospital={hospital} period={period} />
          ))}

          <GovernmentPortalGeneralMedicalSection surface="tablet" maxRows={6} />

          <div className="grid gap-3 lg:grid-cols-2">
            <DeadlinesPreview />
            <PanelDocumentsPreview />
          </div>
        </div>
      </div>
    </div>
  );
}
