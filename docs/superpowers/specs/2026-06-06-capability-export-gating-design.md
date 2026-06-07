# Capability Export-Gating (Phase 2) — Design

**Date:** 2026-06-06
**Status:** Spec (scoped + investigated; approved to spec→plan→implement)
**Predecessor:** `docs/superpowers/specs/2026-06-02-capability-tray-design.md` (Phase 1, shipped PR #139). Phase 1 §6.4 deferred export-gating; this is that follow-on.

## 1. Goal

Make "off" mean **off in the exported workbook**, not just hidden in the UI. When a capability is disabled, its workbook cells stamp blank — even if the model still holds data (the disable-with-data case).

### Behavior delta (narrow)
- **Off + empty** (default for new fleets): cells already stamp blank → **no change**.
- **On**: cells stamp normally → **no change**.
- **Off + has data** (only reachable via the disable-with-data confirm): today data still exports; after this change it stamps blank. **This is the only case that changes.**

### Non-goals
- No new workbook cells, no new `WORKBOOK_CELL_MAP` entries, no `verify-cell-map` combos.
- No change to import/apply logic, sizing, or the UI gating from Phase 1 (beyond one confirm-message wording tweak).
- Does NOT gate `dataservices`, `ops`, `supervisor`, `advanced` (see §3).

## 2. Mechanism — single chokepoint + entry tag

`emitWorkbookCellMap` (engine.js ~line 2578) is the one place every `(entry, ctx)` pair is evaluated, and the `ctx` built by `_iterateScope` always carries the scope object a capability needs (`ctx.cluster` / `ctx.fleet` / `ctx.domain` / `ctx.instance`). So:

1. **Tag gated entries** with an optional `capability: "<key>"` field.
2. **One gate** before `resolve`:

```js
let value;
try {
  if (entry.capability && !isCapabilityEnabled(entry.capability, ctx)) {
    value = "";
  } else {
    value = entry.resolve(fleet, ctx, i);
  }
} catch (err) {
  value = "";
}
```

Backward-compatible: entries without `capability` skip the gate. No per-`resolve` wrapping. `isCapabilityEnabled` is already defined and exported in engine.js.

## 3. Gated set (decided via verify-first investigation)

**GATE** (add `capability` tag): `edge`, `vpc`, `overlay`, `portgroups`, `adsso`, `backup`, `installer`, **`federation`**.
- The new-flag set (edge/vpc/overlay/portgroups/adsso/backup/installer) are optional blocks with no meaningful workbook default when off → blank is correct.
- `federation` (verify-first): its ~25–30 entries (Configure Management Domain GM/LM/Tier-1, instance scope) do NOT currently check `fleet.federationEnabled`; their factory defaults are empty/optional (only a `deploySize` "Medium" fallback, which is noise when federation is off). Blanking when off is clean. `isCapabilityEnabled("federation", ctx)` reads `ctx.fleet.federationEnabled`, present at instance scope.

**DO NOT GATE** (with rationale — these keep current export behavior):
- `dataservices` — `dit.enabled` (Deploy WLD D215) defaults on; must keep exporting (Phase-1 decision). Visibility-only.
- `ops` — Ops/Automation appliances ship by default; sizing-exclusion is a separate future effort. Visibility-only.
- `supervisor` — ~60 entries carry meaningful factory defaults (`controlPlaneSize="Small"`, `haEnabled="Selected"`, etc.). Blanking when off would drop them. Left as-is.
- `advanced` — `internalClusterCidr` resolve falls back to `"198.18.0.0/15"` (engine.js ~line 9123) even when off; blanking would lose that default. Left as-is.

**ALREADY CORRECT** (no work):
- `stretched` — every AZ2 resolve (`_az2NetworkConfigEntries`, per-host mgmt-IP/FQDN, vsanCompute) already returns `""` when `domain.placement !== "stretched"`. Tagging would be redundant.
- `tiering` — has **zero** cell-map entries (purely `applyTiering` sizing). Nothing to gate.

## 4. Tagging detail

| Capability | Where to tag | Approx entries |
|------------|--------------|----------------|
| edge | `_edgeAllocationEntries` (engine.js ~5213) | ~14 ×2 scopes |
| vpc | `_vpcPoolBlockEntries` (~4396) | ~5 ×2 pools ×scopes |
| overlay | `_nsxHostOverlayBlockEntries` (~4246) | ~22–24 ×scopes |
| portgroups | `_portgroupSlotEntries` (~4138) | ~5 ×5 slots ×scopes |
| adsso / backup / installer | their fleet-scope entry groups (search `adConfig`/`backupConfig`/`installerConfig` resolves) | ~20 total |
| federation | the federation entry group (Configure Management Domain GM/LM/Tier-1, ~7800–8126) | ~25–30 |

Tag at the **builder/group level** where possible: set `capability` once on each entry object the builder returns (e.g. spread `capability: "edge"` into each pushed entry, or post-process the builder's array with `.map(e => ({ ...e, capability: "edge" }))`). For the inline federation/adsso/backup/installer entries, add the field on each `E({...})` call or wrap the group. Prefer a small shared helper if it reduces churn.

## 5. M2.1 round-trip safety

The round-trip (`tests/unit/round-trip-matrix.test.js`) builds a kitchen-sink fleet and runs `stampSentinels`, whose `sentinelFor` flips booleans (`!current`) — so every `enabled: false` becomes `true` and `federationEnabled` flips true. The stamped fleet therefore exports with **all gated capabilities enabled**, so the gate blanks nothing and the round-trip stays green. The `enabled` flags are already in `NON_WORKBOOK_ALLOWLIST` (excluded from the comparison).

**Required test-side updates:**
1. Update the allowlist comment block (round-trip-matrix.test.js ~line 836–854): it currently says "the workbook always expects the full field set regardless of whether the panel is enabled." That invariant changes — reword to note export now gates the listed capabilities, and the round-trip stays green because the sentinel walk enables them.
2. Add a **dedicated export-gating test** (new file) so the gate is verified explicitly rather than relying incidentally on the sentinel flip (see §7).

## 6. Import + confirm message

- **Import/apply**: unchanged. A disabled capability's cells are blank → apply reads empty → no data; `backfillCapabilityFlags` leaves `enabled: false`. Consistent.
- **Disable-with-data confirm** (`CapabilityTray`): Phase 1 ships one wording ("Hiding the panel keeps the data."). For **export-gated** capabilities, switch to the spec-§8 wording: *"<Capability> has configuration. Hiding it keeps the data but excludes it from the design output. Continue?"* Visibility-only capabilities (dataservices, ops) keep the Phase-1 wording. Implement by marking gated capabilities (e.g. a `exportGated: true` field on the registry entry) and branching the confirm text on it.

## 7. Testing

- **New `tests/unit/capability-export-gating.test.js`** — for each gated capability (edge, vpc, overlay, portgroups, adsso, backup, installer, federation): build a fleet, populate the capability's data, set `enabled = false`, run `emitWorkbookCellMap(fleet, sizeFleet(fleet))`, and assert the capability's cells are blank; then set `enabled = true` and assert they stamp the data. Use a known cell/label per capability (read the entry to pick a stable assertion target).
- **Non-gated guard**: assert a `dataservices` cell (e.g. `dit.enabled`/D215) still exports when `dataServices.enabled = false` (proves the exclusion holds), and a `supervisor` cell still exports `controlPlaneSize="Small"` when `supervisorConfig.enabled = false`.
- **Round-trip**: `npm run test:migration` + the round-trip matrix stay green (no fixture changes needed; comment updated per §5).
- **Registry**: add `exportGated` to the relevant entries; a small assertion that the export-gated set is exactly the 8 keys above.
- **E2E** (optional but cheap): extend `tests/e2e/workbook-export.spec.ts` — enable edge + enter a node FQDN → export `.xlsx`, parse, assert the FQDN cell is populated; then disable edge (confirm) → export → assert that cell is blank. (Uses the in-repo pristine 9.1 workbook.)
- Full `npm test` green; coverage gates held.

## 8. Out of scope / follow-ups
- `ops` appliance/sizing exclusion (separate effort).
- Revisiting `supervisor`/`advanced` gating if we later decide their factory defaults are noise when the capability is off (would require choosing per-field whether the default should survive).
