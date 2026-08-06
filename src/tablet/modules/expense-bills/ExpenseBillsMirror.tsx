import { Suspense, lazy } from "react";

// The tile IS the desktop Expense Bill tab.
//
// The tablet module used to render its own card list — same data, different
// shape — so the two drifted: the register's recent-invoices-first table, its
// filters, the OPD/IPD referral sections and the Move to Daily Allocation
// action existed on one side only. Rendering the real page here means there
// is one Expense Bill screen, and a change to it shows up in both places.
//
// The page is wide, so it scrolls horizontally inside the tile rather than
// being reflowed — reflowing is what made the two diverge in the first place.
const ExpenseBills = lazy(() => import("@/pages/ExpenseBills"));

export default function ExpenseBillsMirror() {
  return (
    <div className="h-full overflow-auto bg-background">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
            Loading expense bills…
          </div>
        }
      >
        <ExpenseBills />
      </Suspense>
    </div>
  );
}
