import { Suspense, lazy } from "react";
import ProtectedFinalBillRoute from "@/components/invoice/ProtectedFinalBillRoute";

// The desktop Final Bill page, served inside the tablet shell.
//
// The tablet edition runs its own two-route router, so navigating to
// /final-bill/<code> from a tile used to match :moduleId, find no module of
// that name, and bounce silently back to the tablet home — which read as
// "the button does nothing". Routing it here gives the tile the SAME bill the
// IPD "₹" icon opens: same page, same queries, same Save Discharge, and the
// frozen FinalBill.tsx is not touched.
const FinalBill = lazy(() => import("@/pages/FinalBill"));

export function TabletFinalBill() {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <ProtectedFinalBillRoute>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
              Loading the final bill…
            </div>
          }
        >
          <FinalBill />
        </Suspense>
      </ProtectedFinalBillRoute>
    </div>
  );
}
