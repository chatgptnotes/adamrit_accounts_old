import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { DailyRevenueReportSection } from "@/components/DailyRevenueReportSection";

// DATA SOURCE: the Director Dashboard's revenue report, mounted on discharge
// date over a range instead of a single registration day. Same cost/cut
// engine, same M.L. Enterprises invoice on Approve — with Pay on the row so
// the settlement finishes here.

/**
 * Azhar's payout list: every patient discharged in the last 48 hours, what
 * they cost, the cut owed, and the buttons to approve and pay it. Direct
 * patients are excluded by the report's own "Only with RM" filter, which is
 * on by default. Widen the From/To dates for any other period.
 */
export default function DischargedRmCutsFlow() {
  return (
    <FlowScaffold
      heading="Discharged RM Cuts"
      subheading="Patients discharged in the last 48 hours — calculate, approve and pay"
    >
      {/* The report is a desktop-width table; let it scroll rather than squash. */}
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <DailyRevenueReportSection
            defaultPatientType="IPD"
            dateBasis="discharge"
            rangeDays={2}
            enablePay
            title="IPD Daily Revenue Report — Discharged Patients & RM Cuts"
          />
        </div>
      </div>
    </FlowScaffold>
  );
}
