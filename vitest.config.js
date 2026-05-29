// vitest.config.js — shared config for unit, migration, snapshot suites.
// Coverage thresholds are enforced when running `npm run coverage`.
//
// Component tests (M2.2 — JSDOM + React Testing Library): tests under
// tests/unit/components/*.test.jsx run in the jsdom environment via the
// `// @vitest-environment jsdom` pragma at the top of each file, with
// React JSX support enabled via @vitejs/plugin-react. All other tests
// stay on the default node environment so the existing 1858+ engine-
// side tests don't pay the jsdom startup cost.
//
// `setupFiles` runs in EVERY test (node and jsdom alike). The setup
// file's @testing-library/jest-dom + cleanup imports are no-ops outside
// the jsdom env, so the overhead is just the import resolution.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.js", "tests/**/*.test.jsx"],
    setupFiles: ["tests/setup/jsdom-setup.js"],
    coverage: {
      provider: "v8",
      include: ["engine.js"],
      reporter: ["text", "html", "json-summary"],
      // Thresholds restored to a realistic floor by Task #31 (2026-05-28).
      // Measured coverage on this commit:
      //   stmts/branches/funcs/lines = 80.5 / 73.9 / 84.9 / 84.9
      // Gate is set 1 pp below measured so refactor-induced swings
      // don't flake CI. Task #31b tracks pushing toward 90/75/95/95;
      // until then this floor is the safety net.
      thresholds: {
        lines:      83,
        functions:  83,
        branches:   72,
        statements: 79,
      },
    },
  },
});
