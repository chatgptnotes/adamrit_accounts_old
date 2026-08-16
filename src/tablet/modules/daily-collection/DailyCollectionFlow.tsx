import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { DailyCollectionView } from "@/components/DailyCollectionView";

// DATA SOURCE: the same src/lib/dailyCollection.ts the desktop report uses.
// Deliberately shared — the tablet and the desktop giving different answers for
// "what came in today" would leave the hospital with two figures and no way to
// choose, which is the rule Avani's cash report already runs on.

/**
 * The day's money in, on the tablet: advances, final payments and pharmacy
 * sales, split by payment mode. Credit is shown beside the total and never
 * inside it — a pharmacy sale on credit is a sale, not a collection.
 */
export default function DailyCollectionFlow() {
  return (
    <FlowScaffold
      heading="Daily Collection"
      subheading="Everything the hospital took in on one day, by mode"
    >
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          <DailyCollectionView compact />
        </div>
      </div>
    </FlowScaffold>
  );
}
