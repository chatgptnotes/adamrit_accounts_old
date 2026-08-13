import { Suspense, lazy } from "react";

// The desktop IPD Discharge Summary page, served inside the tablet shell.
//
// The summary is already generated on the full site; the tablet edition just
// had no way to reach it. Its own router matched /ipd-discharge-summary/<code>
// against :moduleId, found no module of that name and bounced back to the
// tablet home, so the tile could only ever show a read-only dump. Routing the
// real page here means one editor in both editions — same fields, same AI
// auto-fill, same Save, same PDF — and IpdDischargeSummary.tsx is not touched.
//
// tablet-desktop-canvas resets the shell's dark shadcn tokens back to light:
// the page mixes token-driven Cards with hardcoded light utilities, so without
// it the form renders white-on-white.
const IpdDischargeSummary = lazy(() => import("@/pages/IpdDischargeSummary"));

export function TabletDischargeSummary() {
  return (
    <div className="tablet-desktop-canvas h-full overflow-y-auto bg-background">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
            Loading the discharge summary…
          </div>
        }
      >
        <IpdDischargeSummary />
      </Suspense>
    </div>
  );
}
