# VCF Ops Appliance + Sizing Exclusion (Phase 3) — Design

**Date:** 2026-06-07
**Status:** Spec (scoped + investigated; decisions confirmed: full exclusion + non-destructive derived filter)
**Predecessor:** Capability Tray Phase 1 (PR #139) + export-gating Phase 2 (PR #140). Phase 1 §7 deferred ops appliance/sizing exclusion; this is that follow-on.

## 1. Problem / Goal

Today `fleet.vcfOpsEnabled` (default true) only gates the VCF Ops panel/`vcfOpsDeployToVdpg` control — the VCF Ops/Automation appliances always count toward sizing and always export. Phase 3 makes "Ops off" a real exclusion: when `vcfOpsEnabled === false`, the Ops/Automation appliances are excluded from **sizing (host count), per-site placement, the shared-appliances inventory, fleet-invariant validation, the exported workbook, and the appliance-stack UI** — without mutating the stored stack (re-enabling restores them).

### Ops/Automation appliance set (hardcoded — catalog has no marker)
`vcfOps`, `vcfOpsCollector`, `vcfOpsLogs`, `vcfOpsNet`, `vcfOpsNetCollector`, `vcfAuto`.
NOT in the set (stay always): `fleetMgr` (core), `identityBroker`/`vcfOpsProxy` (independent optional).

### Decisions (confirmed)
- **Full exclusion**: sizing + export both reflect Ops-off.
- **Non-destructive derived filter**: `cluster.infraStack` keeps its Ops entries (round-tripped, user-editable); a pure `effectiveStack(stack, vcfOpsEnabled)` filter is applied at every consumer. Re-enabling restores Ops at their configured sizes.

### Non-goals
- No mutation of stored `infraStack`; no new model field (`vcfOpsEnabled` already exists, backfilled true in Phase 1).
- **Default fleets unchanged** (`vcfOpsEnabled` defaults true → `effectiveStack` is identity), so existing sizing snapshots / round-trip / verify-cell-map stay green.
- `fleetMgr`/`identityBroker`/`vcfOpsProxy` behavior unchanged.

## 2. Core: constant + pure filter

In `engine.js`, near `APPLIANCE_DB` (~line 461):

```js
// VCF Ops / Automation appliances — excluded from sizing/placement/inventory/
// export when fleet.vcfOpsEnabled === false (Phase 3). The catalog has no marker,
// so this is the canonical id set.
const VCF_OPS_APPLIANCE_IDS = ["vcfOps", "vcfOpsCollector", "vcfOpsLogs", "vcfOpsNet", "vcfOpsNetCollector", "vcfAuto"];
const VCF_OPS_APPLIANCE_ID_SET = new Set(VCF_OPS_APPLIANCE_IDS);

// Pure: returns the stack with Ops/Automation entries removed when Ops is off.
// Identity (returns the same array) when vcfOpsEnabled !== false, so default
// fleets are byte-for-byte unaffected.
function effectiveStack(stack, vcfOpsEnabled) {
  if (vcfOpsEnabled !== false) return stack || [];
  return (stack || []).filter((e) => e && !VCF_OPS_APPLIANCE_ID_SET.has(e.id));
}
```

## 3. Sizing exclusion (thread `vcfOpsEnabled`, filter at assembly)

`stackTotals(stack, vcfVersion)` stays UNCHANGED. Instead, filter the stack at the points where sizing assembles it, threading `vcfOpsEnabled` (default `true` so existing direct callers are unaffected):

- `sizeFleet(fleet)` (~12985): reads `fleet.vcfOpsEnabled`, passes to `sizeInstance`.
- `sizeInstance(instance, vcfVersion, vcfOpsEnabled = true)` (~12788): threads to `sizeDomain`; builds its `sharedStack` from `effectiveStack(...)` of each cluster's infraStack.
- `sizeDomain(domain, extraByClusterId, _unused, vcfVersion, vcfOpsEnabled = true)` (~12765): threads to `sizeCluster`.
- `sizeCluster(cluster, extraStack, vcfVersion, vcfOpsEnabled = true)` (~12537): `infra = stackTotals([...effectiveStack(cluster.infraStack, vcfOpsEnabled), ...(extraStack || [])], vcfVersion)`.

Effect: with Ops off, the Ops appliances drop out of the CPU/RAM/storage demand → `finalHosts` may decrease. With Ops on (default), `effectiveStack` returns the same array → identical results.

## 4. Placement exclusion

`buildDefaultPlacement(instance, vcfOpsEnabled = true)` (~11161): before distributing each cluster's `infraStack` across sites, filter via `effectiveStack(clu.infraStack, vcfOpsEnabled)` so Ops appliances aren't assigned sites when off. Update its single caller (~line 11199) to pass the flag (thread from the enclosing fleet context).

## 5. Validation relaxation

`validateFleetInvariants(fleet)` (~10327): **VCF-INV-010** requires each per-fleet appliance to appear exactly once on active instances. When `fleet.vcfOpsEnabled === false`, the per-fleet Ops ids (`vcfOps`, `vcfOpsLogs`, `vcfOpsNet`, `vcfAuto`) are legitimately absent — skip the INV-010 "missing" check for ids in `VCF_OPS_APPLIANCE_ID_SET` when Ops is off (their absence is valid, not an error). Also review the `hasCollector`/`hasNetCollector` checks (~10387-10388) and any VCF-INV-011 (per-fleet appliances only on initial instance) — when Ops is off there are no Ops entries, so those rules are trivially satisfied; ensure none fire a false "missing Ops collector" error. Do NOT relax non-Ops per-fleet rules (`fleetMgr` etc.).

## 6. Export gating (extends Phase 2)

Phase 2 left `ops` NOT export-gated (visibility-only). Phase 3 makes it export-gated:
1. Add `exportGated: true` to the `ops` registry entry (CAPABILITY_REGISTRY).
2. Tag the two Ops cell-map entries with `capability: "ops"`:
   - "VCF Operations Appliance Size" (L56/9.0, L323/9.1; ~engine line 6418, reads `infraStack[id=vcfOps].size`).
   - The L47 deploy-location toggle (`vcfOpsDeployToVdpg`; ~line 6447) — already 9.1-gated; add `capability: "ops"`.
   The Phase-2 gate in `emitWorkbookCellMap` then blanks them when `isCapabilityEnabled("ops", ctx)` is false (reads `fleet.vcfOpsEnabled !== false`).
3. Update the Phase-2 registry-set test (`capability-registry.test.js`): the `exportGated` set is now **9** keys (adds `ops`).
4. Add `ops` to the straggler-completeness guard (`capability-export-gating.test.js`): stamp the Ops cells (set `infraStack` vcfOps size + a `vcfOpsDeployToVdpg` true) with Ops off → assert the Ops cells blank.
5. The Phase-2 UI confirm-wording (keyed on `exportGated`) now applies to `ops` automatically: turning Ops off with data warns "excludes it from the design output" — consistent with full exclusion.

Note: `effectiveStack` does NOT remove Ops from `infraStack`, so the "VCF Operations Appliance Size" resolve still finds the `vcfOps` entry; the export gate (not the stack filter) is what blanks the cell. No new workbook cells; `verify-cell-map` stays clean.

## 7. UI

The displayed appliance stack + the per-site "Shared Appliances" inventory should reflect the exclusion when Ops is off (use `effectiveStack` for display), and the sizing result (host count) updates automatically via `sizeFleet`. Concretely:
- Wherever the UI renders `cluster.infraStack` rows or the shared-appliances list, filter with `effectiveStack(stack, fleet.vcfOpsEnabled)` so Ops rows hide when off (re-appear when on). Locate these in `vcf-design-studio-v9.jsx` (appliance-stack panel + per-site/shared-appliances view) and gate the Ops rows.
- The `ops` tray chip already exists (Phase 1); no new chip. The `vcfOpsDeployToVdpg` control is already gated on `ops` (Phase 1).
Regenerate the HTML (`npm run build-html`) after JSX changes.

## 8. Testing

- **Sizing** (`tests/unit/`): a fleet with Ops appliances → record `sizeFleet` host count with `vcfOpsEnabled=true`; set `false` → assert host count is ≤ (and strictly < for a fleet where Ops drives a floor) and that `sharedTotals`/demand dropped by the Ops appliances' contribution. With Ops back on → identical to the original.
- **Placement**: Ops off → `buildDefaultPlacement` result has no keys for Ops entries.
- **Validation**: a fleet with `vcfOpsEnabled=false` and no Ops appliances passes `validateFleetInvariants` (no false "missing per-fleet appliance"); with Ops on, the existing INV-010 still fires when genuinely missing.
- **Export**: Ops off → "VCF Operations Appliance Size" + L47 cells blank; Ops on → present. Add `ops` to the completeness guard.
- **Registry**: `exportGated` set assertion updated to 9 keys.
- **Default-unchanged**: snapshot suite + round-trip + verify-cell-map stay green (default `vcfOpsEnabled=true`). Explicitly assert `effectiveStack(stack, true) === stack` (identity) and `effectiveStack(stack, undefined) === stack`.
- **Component**: appliance-stack / shared-appliances view hides Ops rows when off (JSDOM).
- Full `npm test` + coverage gates + `npm run build-html`/`verify-html`.

## 9. Migration
None. `vcfOpsEnabled` already exists (Phase-1, backfilled true). `effectiveStack` is a pure runtime filter; the stored stack is untouched.

## 10. Out of scope / follow-ups
- The `group` registry field (still unused; reserved for chip-group headers).
- Revisiting supervisor/advanced export-gating.
