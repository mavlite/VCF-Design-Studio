// vitest.config.js — shared config for unit, migration, snapshot suites.
// Coverage thresholds are enforced when running `npm run coverage`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
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
