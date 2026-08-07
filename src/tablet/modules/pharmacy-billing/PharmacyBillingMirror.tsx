import { Suspense, lazy } from "react";

// The tile IS the desktop pharmacy billing and dispensing screen.
//
// Same reasoning as the Expense Bills tile: one screen, not two that drift.
// Abhishek bills the patient here — search medicines into the cart, Generate
// Invoice (which posts the JV), take the payment against the pharmacy's QR,
// attach the confirmation, and Complete Sale (which posts the receipt).
//
// The page is wide, so it scrolls inside the tile rather than being reflowed.
const PharmacyBilling = lazy(() => import("@/components/pharmacy/PharmacyBilling"));

export default function PharmacyBillingMirror() {
  return (
    <div className="h-full overflow-auto bg-background">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
            Loading pharmacy billing…
          </div>
        }
      >
        <PharmacyBilling />
      </Suspense>
    </div>
  );
}
