// Unit checks for the pure tablet->pharmacy bridge logic.
// Run:  npx vite-node e2e/ward-bridge.test.ts
//
// No DOM / supabase needed — these exercise only the pure helpers in
// src/lib/ward-bridge-logic.ts (frequency->quantity math + the pharmacy bell
// filter string), which is where the "order sometimes doesn't show" bugs lived.

import assert from "node:assert/strict";
import { deriveQuantity, buildPendingFilter } from "@/lib/ward-bridge-logic";

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log("  ✓", name);
};

console.log("deriveQuantity");
it("OD for 5 days = 5 units", () => {
  assert.equal(deriveQuantity("OD", "5"), 5);
});
it("BD (twice daily) for 3 days = 6 units", () => {
  assert.equal(deriveQuantity("BD", "3"), 6);
});
it("TDS for 2 days = 6 units", () => {
  assert.equal(deriveQuantity("TDS", "2"), 6);
});
it("unknown frequency falls back to 1/day", () => {
  assert.equal(deriveQuantity("WEEKLY", "4"), 4);
});
it("missing/invalid duration treated as 1 day", () => {
  assert.equal(deriveQuantity("BD", null), 2);
  assert.equal(deriveQuantity("BD", "abc"), 2);
  assert.equal(deriveQuantity("BD", "0"), 2);
});
it("frequency is case/whitespace tolerant and takes the first token", () => {
  assert.equal(deriveQuantity(" bd ", "1"), 2);
  assert.equal(deriveQuantity("QID/PRN", "1"), 4);
});
it("never returns less than 1", () => {
  assert.equal(deriveQuantity("", ""), 1);
});

console.log("buildPendingFilter");
it("includes plain PENDING (camera/manual, any hospital)", () => {
  assert.match(buildPendingFilter("hope"), /(^|,)status\.eq\.PENDING(,|$)/);
});
it("scopes APPROVED ward orders to this hospital", () => {
  assert.ok(
    buildPendingFilter("hope").includes(
      "and(status.eq.APPROVED,source.eq.ward,hospital_name.eq.hope)",
    ),
  );
});
it("still shows APPROVED ward orders with a NULL hospital (the root-cause fix)", () => {
  assert.ok(
    buildPendingFilter("ayushman").includes(
      "and(status.eq.APPROVED,source.eq.ward,hospital_name.is.null)",
    ),
  );
});
it("threads the hospital type through unchanged", () => {
  assert.ok(buildPendingFilter("ayushman").includes("hospital_name.eq.ayushman"));
});

console.log(`\n${passed} checks passed`);
