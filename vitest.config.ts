import { defineConfig } from "vitest/config";

// Unit tests for the pure core logic run in a jsdom environment so that
// future DOM-touching helpers (UI, HUD) can be tested too.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    // Core logic is tested next to its source (src/core/*.test.ts), the
    // tests/unit folder stays available for cross-module suites.
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    passWithNoTests: true,
  },
});
