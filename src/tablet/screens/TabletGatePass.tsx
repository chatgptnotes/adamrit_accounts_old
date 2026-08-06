import { Suspense, lazy } from "react";

// The gate pass print page, served inside the tablet shell.
//
// The Arshiya tile opens /gate-pass/<code> in a new tab after minting the
// pass. On a tablet that tab loads the tablet edition, where the path used to
// match :moduleId, resolve to no module, and redirect to the home screen — so
// the pass was created but never shown. Same page as the Discharge Patient
// workflow prints, so the number, format and barcode are identical.
const GatePassPrint = lazy(() => import("@/pages/GatePassPrint"));

export function TabletGatePass() {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
            Loading the gate pass…
          </div>
        }
      >
        <GatePassPrint />
      </Suspense>
    </div>
  );
}
