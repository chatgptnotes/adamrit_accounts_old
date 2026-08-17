import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without this, a component mounted by one test is still in the document for
// the next one, and getByText starts finding two of everything.
afterEach(() => {
  cleanup();
});
