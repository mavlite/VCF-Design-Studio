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
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// During a coverage run the migrator smoke test is excluded — see below.
// Detected via the npm script name (`npm run coverage`) or an explicit
// `--coverage` flag on a direct `vitest` invocation. It still runs in every
// non-coverage run (`npm run test:unit`, `npm test`, watch, CI's test:unit).
const COVERAGE_RUN =
  process.env.npm_lifecycle_event === "coverage" ||
  process.argv.includes("--coverage");

// tests/unit/migrate-workbook-az1.test.js loads the OLD engine source (via
// `git show pre-az1-relocation:engine.js`) into the same process to prove the
// OLD→NEW migration round-trips. That near-duplicate of engine.js corrupts the
// v8 coverage *merge* for engine.js: the OLD source's mismatched line/function
// ranges zero out functions that other test files genuinely cover, deflating
// measured engine.js coverage by ~13 pp (stmts 80.5 vs the true 93.2). v8
// coverage cannot merge two copies of the same file-under-test loaded in one
// run, and no load-path tweak avoids it — so the migrator test is excluded
// from coverage collection only. Its correctness is still gated by test:unit.
const COVERAGE_EXCLUDES = COVERAGE_RUN
  ? ["tests/unit/migrate-workbook-az1.test.js"]
  : [];

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.js", "tests/**/*.test.jsx"],
    exclude: [...configDefaults.exclude, ...COVERAGE_EXCLUDES],
    setupFiles: ["tests/setup/jsdom-setup.js"],
    coverage: {
      provider: "v8",
      include: ["engine.js"],
      reporter: ["text", "html", "json-summary"],
      // Task #31b (2026-05-29): thresholds restored to the original target
      // once the migrator-test coverage-merge corruption (see COVERAGE_EXCLUDES
      // above) was diagnosed and excluded. True measured coverage with the
      // migrator excluded: stmts/branches/funcs/lines = 93.2 / 83.2 / 99.4 / 97.5.
      thresholds: {
        lines:      95,
        functions:  95,
        branches:   75,
        statements: 90,
      },
    },
  },
});
