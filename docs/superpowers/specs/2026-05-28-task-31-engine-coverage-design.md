# Task #31: engine.js Coverage Restore — Design

**Date:** 2026-05-28
**Branch:** `feat/task-31-engine-coverage`
**Context:** When the AZ1 cell relocation refactor landed (PRs leading up to `5a641e0`), the coverage thresholds in [vitest.config.js](../../../vitest.config.js) were temporarily lowered from `95/95/75/90` → `78/80/70/75` (stmts/branches/funcs/lines) so CI wouldn't gate on the transient regression. The HANDOFF flags this as a temporary floor: *"the gate should be a true safety net, not a low bar."* Task #31 restores it.

## Why this matters

Right now ~20% of `engine.js` (765 statements) has no test exercising it. Concretely uncovered today:

- **Naming-template engine** (`resolveTemplate`, `mergeNamingConfig`, `resolveHostname`, `vdsTokensFor`, `validateNamingDesign`) — generates every hostname/FQDN the studio emits. Currently a silent regression vector.
- **IP allocator** (`allocateClusterIps`, AZ2 host-IP path) — assigns every IP address in an exported workbook. Currently a silent regression vector for stretched clusters.
- **VCF-IP-007 and VCF-HW-NET-022 validators** (override-in-wrong-AZ, BGP-peer-not-in-uplink-subnet) — silent if they accidentally stop firing.
- **Per-host FQDN round-trip apply** on Deploy Mgmt / Deploy WLD — strips DNS suffixes on workbook import. Currently no test asserts this still works.
- **Browser-only paths** (`emitWorkbookXlsx` xlsx-library bundle arm, `_resolveXLSX`, `_resolveCrypto`) — unfireable in JSDOM. Currently just lurking in the gap, mixed in with code that genuinely needs tests.
- **~250 statements in `create*Config` factories** that no test fixture invokes. Not dead code (the UI calls them on theme-enable), but no test trigger.

Because the threshold gate is set to a "polite-fiction floor" today, CI happily accepts further drops below 78%. The safety net has holes CI can't see.

## Goal

Restore the [vitest.config.js](../../../vitest.config.js) coverage thresholds to `90/75/95/95` (stmts/branches/funcs/lines) and lift actual measured coverage on `engine.js` to ≥ that threshold across all four dimensions. Current state on main: `79.78 / 73.21 / 86 / 84.02`.

After this PR:
1. Six concrete categories of bug (broken hostname generation, broken AZ2 IP allocation, missing validator warnings, broken FQDN round-trip, broken additional-cluster scope, broken workbook downgrade reporting) become CI-detectable instead of CI-invisible.
2. The threshold gate stops being a polite-fiction floor and becomes a real safety net — future coverage drops fail the gate and force a justification or a test.
3. Unfireable paths are explicitly marked with `/* istanbul ignore */` + a `// why:` comment, distinguishing them from "real code with no test."

## Phased work (single PR)

The coverage gap has four natural phases. All land in one PR so the threshold flip happens with every gain in place. Phase boundaries also map to natural commit boundaries.

| Phase | Targets | Approx stmts | Coverage after |
|---|---|---|---|
| **A. Factory smoke tests** | `create*Config` factories never called by tests: T0, fleet-network, federation, supervisor, AZ2, naming, host-overlay, portgroup-slot, NSX host overlay, installer config. One smoke test per factory group asserts the factory returns the documented shape. | ~250 | ~86.4% stmts |
| **B. Real-behavior suites** | `resolveTemplate` / `mergeNamingConfig` / `resolveHostname` (naming templates), `ipToInt` / `intToIp` / `allocateClusterIps` (IP allocator), `checkOverrideSubnet` + VCF-IP-007 + VCF-HW-NET-022 (AZ2/BGP validators), `promoteToInitial`. | ~120 | ~89.6% stmts |
| **C. xlsx edge cases** | `readWorkbookXlsxAsCellMapRows` `cellPattern` expansion + `_findExpansionIndexForCell`, `computeReconcileDiff` cross-version downgrade, per-host FQDN apply on Deploy Mgmt (~L5845) and Deploy WLD (~L5895), single-line apply callbacks (Download Token, Activation Code, proxy user, FTT, NFS path). | ~70 | ~91.4% stmts |
| **D. Ignore markers + targeted tests for remainder** | `/* istanbul ignore next */` on browser-only paths and provably-impossible defensive guards (per the ignore policy below) + targeted tests for the additional-cluster scope-iterator arm (L2433-L2443), `_createSupervisorEntry`/`expandCell` E-factory edges, generic `gwCidr`/`poolStart`/`poolEnd` cell-builder helpers, scattered single-line apply branches. | ~325 | **≥ 95% stmts** |

Each phase ends with a green run of `npm run coverage` and a phase-boundary commit so reviewers can see the coverage delta between phases.

## Ignore-marker policy

Three rules for whether a `/* istanbul ignore */` is acceptable in this PR:

1. **Browser-only code** — paths gated on `typeof window !== "undefined"` (or equivalent) that JSDOM can't realistically exercise (xlsx browser-bundle arm, `URL.createObjectURL` flows, native `<a>.click()` download triggers). Marker warranted.
2. **Provably impossible state** — e.g., the cell-map dispatcher's `if (!ctx) continue` arm after the dispatcher's own `ctx` construction guarantees `ctx` is set. Marker warranted, with a one-line `// why:` neighbor naming the upstream guarantee.
3. **Everything else** — write the test. Defensive code that protects against bad user input or upstream bugs is exactly what we WANT covered.

Every `ignore` comment added in this PR must have a one-line `// why:` neighbor stating the reason. Code review will scrutinize every marker.

## Test file layout

Six new files under [tests/unit/](../../../tests/unit/), one per phase-scope. Decomposition is by domain (not by phase) so failures localize cleanly when CI flags a regression:

- `tests/unit/engine-factory-smoke.test.js` — Phase A
- `tests/unit/engine-naming-templates.test.js` — Phase B (naming engine)
- `tests/unit/engine-ip-allocator.test.js` — Phase B (IP allocation + AZ2 host-split)
- `tests/unit/engine-az2-bgp-validators.test.js` — Phase B (VCF-IP-007, VCF-HW-NET-022)
- `tests/unit/engine-xlsx-edges.test.js` — Phase C
- `tests/unit/engine-defensive-coverage.test.js` — Phase D (targeted tests for Phase D's reachable defensive code)

## Threshold restoration

Final commit in the PR: edit [vitest.config.js](../../../vitest.config.js) `coverage.thresholds` block:

```js
// before (vitest.config.js L36-L41)
thresholds: {
  lines:      78,
  functions:  80,
  branches:   70,
  statements: 75,
}
// after
thresholds: {
  lines:      95,
  functions:  95,
  branches:   75,
  statements: 90,
}
```

Also remove the outdated "re-calibrated 2026-05-28" comment block (L26-L35) since the calibration is no longer "temporary." Replace with a one-line note pointing at the threshold values and the source-of-truth measurement in this PR's description.

## Verification

Each phase boundary + the final commit must pass:
- `npx vitest run` — full suite green
- `npm run coverage` — coverage ≥ the documented headroom for that phase
- After the final commit: `npm run coverage` measured coverage must be ≥ each restored threshold

The PR description should embed a before/after coverage table extracted from `npm run coverage` output.

## Out of scope

- New engine features.
- Refactoring `engine.js` to make it easier to test (separate PR if needed).
- Touching the cell-map structure (1225 entries) — covered by existing `verify-cell-map`.
- React component coverage — `vcf-design-studio-v9.jsx` is intentionally not in the coverage gate.
- `vcf-design-studio-v9.html` regeneration — no production code changes, no rebuild needed.

## Risks

- **Effort overrun.** Phases C and D may exceed their half-day budget if xlsx fixtures or defensive-code paths turn out heavier than the scan suggested. Mitigation: per-phase coverage check before committing; if Phase D combined with C exceeds one full day, surface and propose splitting Phase D into a follow-up (Task #31b) while still landing the threshold restore at whatever was achieved.
- **False ignore markers.** A wrong `/* istanbul ignore */` hides real bugs. Mitigation: ignore policy above + a final code-review pass focused specifically on every marker added.
- **Snapshot churn.** Adding factory smoke tests touches no production code, so snapshots should be unchanged. Verify with `npx vitest run tests/snapshot` after each phase.
- **Test brittleness.** Per-host FQDN round-trip tests in Phase C depend on Deploy sheet cell positions that just moved during the AZ1 refactor. Use the post-refactor cell-map as the source of truth; do not hard-code raw addresses.

## References

- Current coverage: 79.78 / 73.21 / 86 / 84.02 (stmts/branches/funcs/lines), measured on main at commit `5a641e0`
- HANDOFF note: [HANDOFF.md](../../../HANDOFF.md) "engine.js coverage thresholds re-calibrated" section
- vitest config: [vitest.config.js](../../../vitest.config.js)
- HTML coverage report (regenerable): `coverage/engine.js.html`
