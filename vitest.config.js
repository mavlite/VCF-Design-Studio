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
      // Thresholds are set slightly under observed coverage so the gate
      // doesn't flake on refactor-induced ~1% swings. Under vitest 4.x's
      // v8-coverage instrumentation, current numbers sit at ~94/81/99/97
      // (stmts/branches/funcs/lines) — note that 4.x measures statements
      // differently than 2.x did (which read ~98), so the statements
      // threshold is lower than the others. The intent (block real
      // regressions while tolerating instrumentation jitter) is the same.
      thresholds: {
        lines:      95,
        functions:  95,
        branches:   75,
        statements: 90,
      },
    },
  },
});
