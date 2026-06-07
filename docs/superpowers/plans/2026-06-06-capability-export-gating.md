# Capability Export-Gating (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a capability is OFF, omit its cells from the exported workbook (stamp blank) — even if the model still holds data — for the gated set: edge, vpc, overlay, portgroups, adsso, backup, installer, federation.

**Architecture:** A single gate in the cell-map evaluator (`emitWorkbookCellMap`) blanks any entry tagged with a `capability` whose flag is off for the current `ctx`. Entries are tagged via a `tagCapability(cap, entries)` helper applied at each builder's return (clean) or by extracting inline entry runs into named, tagged arrays (validated by `verify-cell-map`, which guarantees the cell set is unchanged). The UI confirm-message wording is keyed off a new `exportGated` registry field.

**Tech Stack:** Plain ES module `engine.js` (no build), React + Tailwind in `vcf-design-studio-v9.jsx`, Vitest, Playwright E2E, `npm run build-html`.

**Spec:** `docs/superpowers/specs/2026-06-06-capability-export-gating-design.md`.

**Conventions (read first):**
- Immutability everywhere; no Claude/AI attribution in commits.
- After `engine.js`/JSX changes that affect the shipped app: `npm run build-html` then `npm run verify-html`.
- `npm run verify-cell-map` MUST stay green (no cells added/removed — only `capability` tags + the gate). This is the safety net for the inline-extraction tasks: if extraction changed any cell, verify-cell-map (and the round-trip) fail.
- Single test file: `npx vitest run <path>`. Full suite: `npm test`.
- Coverage gate (vitest.config.js order lines/funcs/branches/stmts): 95/95/75/90.
- **Staging:** tasks are ordered low-risk → high-risk. **Edge (Task 7) is isolated and last** so it can be cut without affecting the rest.

**Gated set (decided via verify-first investigation):** edge, vpc, overlay, portgroups, adsso, backup, installer, federation.
**Explicitly NOT gated** (keep current export): dataservices, ops (visibility-only); supervisor (default `controlPlaneSize="Small"`), advanced (default `internalClusterCidr="198.18.0.0/15"`); tiering (no cells); stretched (AZ2 resolves already gate on `placement`); T0 gateways / BGP peers (`cluster.t0Gateways`, separate model — no capability).

---

## File Structure

| File | Change |
|------|--------|
| `engine.js` | Add `tagCapability` helper + the gate in `emitWorkbookCellMap`; add `exportGated` to 8 registry entries; tag builder returns + extract/tag inline runs |
| `vcf-design-studio-v9.jsx` | Confirm-message wording branched on `exportGated` |
| `tests/unit/capability-export-gating.test.js` | Create — per-capability off→blank / on→present + non-gated guards |
| `tests/unit/capability-registry.test.js` | Extend — `exportGated` set assertion |
| `tests/unit/round-trip-matrix.test.js` | Update the allowlist comment (§5 of spec) |
| `tests/e2e/workbook-export.spec.ts` | Extend — edge off→blank cell, on→populated cell (optional, Task 7) |
| `vcf-design-studio-v9.html` | Regenerated |

---

## Task 1: Mechanism — gate + helper + `exportGated` registry field

**Files:** Modify `engine.js`; Test `tests/unit/capability-export-gating.test.js`, `tests/unit/capability-registry.test.js`.

No cell entries are tagged in this task, so export output is unchanged (gate is a no-op until Task 2+).

- [ ] **Step 1: Write failing tests**

Create `tests/unit/capability-export-gating.test.js`:

```js
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { newFleet, sizeFleet, emitWorkbookCellMap, CAPABILITY_REGISTRY } = VcfEngine;

// Emit all cell rows for a fleet (version-resolved). emitWorkbookCellMap returns
// [{ workbookVersion, sheet, cell, label, value }]. If the exported name differs,
// use the lowest-level emitter that returns rows (NOT the CSV string).
function rows(fleet) {
  return emitWorkbookCellMap(fleet, sizeFleet(fleet));
}

describe("export-gating mechanism", () => {
  it("emitWorkbookCellMap + CAPABILITY_REGISTRY are exported", () => {
    expect(typeof emitWorkbookCellMap).toBe("function");
    expect(Array.isArray(CAPABILITY_REGISTRY)).toBe(true);
  });

  it("untagged entries are unaffected (a known always-on cell still stamps)", () => {
    const fleet = newFleet();
    fleet.networkConfig = fleet.networkConfig || {};
    fleet.networkConfig.dns = { primaryDomain: "lab.example.com" };
    const r = rows(fleet);
    expect(r.some((x) => x.value === "lab.example.com")).toBe(true);
  });
});
```

Extend `tests/unit/capability-registry.test.js` (append a describe):

```js
describe("exportGated registry flag", () => {
  const { CAPABILITY_REGISTRY } = engine;
  it("marks exactly the gated set", () => {
    const gated = CAPABILITY_REGISTRY.filter((c) => c.exportGated).map((c) => c.key).sort();
    expect(gated).toEqual(
      ["adsso", "backup", "edge", "federation", "installer", "overlay", "portgroups", "vpc"].sort()
    );
  });
});
```

- [ ] **Step 2: Run — must FAIL**

`npx vitest run tests/unit/capability-export-gating.test.js tests/unit/capability-registry.test.js`
Expected: FAIL (`emitWorkbookCellMap` may be undefined if not exported; `exportGated` not set yet).

- [ ] **Step 3: Add the `tagCapability` helper**

In `engine.js`, immediately ABOVE `const WORKBOOK_CELL_MAP = [` (line ~5297), add:

```js
// Export-gating (Phase 2): tag a group of cell-map entries with the capability
// that owns them. The evaluator (emitWorkbookCellMap) blanks a tagged entry when
// that capability is disabled for the current ctx. Pure: returns new entry objects.
function tagCapability(capability, entries) {
  return entries.map((e) => (e ? { ...e, capability } : e));
}
```

- [ ] **Step 4: Add the gate in `emitWorkbookCellMap`**

In `engine.js` ~line 2576-2581, replace:

```js
        let value;
        try {
          value = entry.resolve(fleet, ctx, i);
        } catch (err) {
          value = "";
        }
```

with:

```js
        let value;
        try {
          // Export-gating: a capability-tagged entry stamps blank when its
          // capability is disabled for this ctx (off → omitted from the workbook).
          if (entry.capability && !isCapabilityEnabled(entry.capability, ctx)) {
            value = "";
          } else {
            value = entry.resolve(fleet, ctx, i);
          }
        } catch (err) {
          value = "";
        }
```

`isCapabilityEnabled` is already defined in engine.js. (It's defined later in the file but hoisted as a function declaration — verify it's a `function isCapabilityEnabled(...)` declaration, not a `const`. If it's a `const` arrow defined AFTER emitWorkbookCellMap, the call still works at runtime because emit is called long after module load; confirm no ReferenceError by running the test.)

- [ ] **Step 5: Add `exportGated: true` to the 8 registry entries**

In `engine.js` `CAPABILITY_REGISTRY` (~line 12993+), add `exportGated: true` to the entries for: `adsso`, `backup`, `installer`, `federation`, `edge`, `overlay`, `vpc`, `portgroups`. For `_flagCap`-built entries, add it as an extra property: either extend `_flagCap` to accept/forward it, or set it on the returned object. Simplest: after each relevant `_flagCap(...)` call returns, the entry is an object literal in the array — for the `_flagCap` ones, change the call to `{ ..._flagCap("edge", ...), exportGated: true }`. For inline entries (federation), add `exportGated: true` directly. Do NOT add it to dataservices, ops, supervisor, tiering, dr, stretched, advanced.

- [ ] **Step 6: Run — must PASS**

`npx vitest run tests/unit/capability-export-gating.test.js tests/unit/capability-registry.test.js` → PASS.
Then `npm run verify-cell-map` → clean (gate is a no-op; nothing tagged yet).

- [ ] **Step 7: Commit**

```
git add engine.js tests/unit/capability-export-gating.test.js tests/unit/capability-registry.test.js
git commit -m "feat(export-gating): gate mechanism + exportGated registry flag"
```

---

## Task 2: Tag the clean cluster builders (vpc, overlay, portgroups)

**Files:** Modify `engine.js`; Test `tests/unit/capability-export-gating.test.js`.

Each of these capabilities' cells come from a single builder (+ a tiny inline remainder for vpc/overlay).

- [ ] **Step 1: Write failing tests (append)**

```js
describe("export-gating — clean cluster builders", () => {
  const wld = (fleet) => {
    // first workload cluster (kitchen builders not needed — add a workload domain)
    return fleet.instances[0].domains[0].clusters[0];
  };
  const cellsFor = (fleet, labelRe) =>
    rows(fleet).filter((x) => labelRe.test(x.label) && x.value !== "");

  it("vpc: data present but disabled → no vpc cells; enabled → present", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.vpcConfig.externalPool.poolName = "ext-pool-1";
    c.vpcConfig.enabled = false;
    expect(cellsFor(fleet, /VPC|External IP Block|Transit Gateway IP Block/i).length).toBe(0);
    c.vpcConfig.enabled = true;
    expect(rows(fleet).some((x) => x.value === "ext-pool-1")).toBe(true);
  });

  it("overlay: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.networks.nsxHostOverlay.transportZoneName = "tz-overlay-1";
    c.networks.nsxHostOverlay.enabled = false;
    expect(rows(fleet).some((x) => x.value === "tz-overlay-1")).toBe(false);
    c.networks.nsxHostOverlay.enabled = true;
    expect(rows(fleet).some((x) => x.value === "tz-overlay-1")).toBe(true);
  });

  it("portgroups: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.networks.portgroups.mgmt.name = "pg-mgmt-custom";
    c.networks.portgroups.enabled = false;
    expect(rows(fleet).some((x) => x.value === "pg-mgmt-custom")).toBe(false);
    c.networks.portgroups.enabled = true;
    expect(rows(fleet).some((x) => x.value === "pg-mgmt-custom")).toBe(true);
  });
});
```

NOTE: a fresh `newFleet()` has only a mgmt cluster. If a capability's cells are workload-scope only, add a workload domain/cluster in the test (use `VcfEngine.newWorkloadCluster` / push a workload domain) OR assert against the mgmt cluster for mgmt-scoped cells. Before finalizing each assertion, run it and adjust the cluster/scope so the "enabled → present" case actually produces the cell (read the builder's scope). Keep the off→blank and on→present pair for each.

- [ ] **Step 2: Run — must FAIL** (data still exports when disabled).

- [ ] **Step 3: Tag the builders**

In `engine.js`:
- `_vpcPoolBlockEntries` (~line 4389): change its `return [...]` to `return tagCapability("vpc", [...])` (wrap the whole returned array).
- `_nsxHostOverlayBlockEntries` (~line 4239): wrap its return with `tagCapability("overlay", ...)`.
- `_portgroupSlotEntries` (~line 4131): wrap its return with `tagCapability("portgroups", ...)`.

Then the small inline remainders (read the spec §3 / enumeration):
- vpc echo cells (~lines 8971-8975, the D171/D172 9.1 echo entries reading vpcConfig pools): add `capability: "vpc"` to each.
- overlay mgmt inline cells (~lines 8657-8671, mgmt L269-L273 reading nsxHostOverlay): add `capability: "overlay"` to each.

- [ ] **Step 4: Run — must PASS.** Then `npm run verify-cell-map` (clean — same cells, now tagged) and `npm run test:migration` (round-trip green — sentinel flips enabled true).

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/capability-export-gating.test.js
git commit -m "feat(export-gating): gate vpc, overlay, portgroups cells"
```

---

## Task 3: Tag the inline fleet runs (installer, backup, adsso)

**Files:** Modify `engine.js`; Test `tests/unit/capability-export-gating.test.js`.

These are contiguous inline entry runs in the `WORKBOOK_CELL_MAP` literal. Extract each run into a named const array above the literal, tag it, and spread it back. `verify-cell-map` guarantees the extraction is behavior-preserving.

- [ ] **Step 1: Write failing tests (append)**

```js
describe("export-gating — fleet inline runs", () => {
  it("installer: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    fleet.installerConfig.offlineDepotHostname = "depot.lab.local";
    fleet.installerConfig.depotType = "offline";
    fleet.installerConfig.enabled = false;
    expect(rows(fleet).some((x) => x.value === "depot.lab.local")).toBe(false);
    fleet.installerConfig.enabled = true;
    expect(rows(fleet).some((x) => x.value === "depot.lab.local")).toBe(true);
  });

  it("backup: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    fleet.backupConfig.host = "sftp.lab.local";
    fleet.backupConfig.enabled = false;
    expect(rows(fleet).some((x) => x.value === "sftp.lab.local")).toBe(false);
    fleet.backupConfig.enabled = true;
    expect(rows(fleet).some((x) => x.value === "sftp.lab.local")).toBe(true);
  });

  it("adsso: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    fleet.adConfig.adFqdn = "ad.lab.local";
    fleet.adConfig.enabled = false;
    expect(rows(fleet).some((x) => x.value === "ad.lab.local")).toBe(false);
    fleet.adConfig.enabled = true;
    expect(rows(fleet).some((x) => x.value === "ad.lab.local")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Extract + tag each inline run**

For EACH of installer (~lines 5388-5532), backup (~lines 7324-7414), adsso (~lines 7439-7597):
1. Identify the contiguous run of inline `{...}` entry objects whose `resolve` reads `fleet.installerConfig` / `fleet.backupConfig` / `fleet.adConfig` (read the resolves to confirm the exact start/end — these are theme blocks; confirm no unrelated entry is interleaved). Password-only entries (`passwordKind`/`emitOnly`, e.g. ad/backup passwords) are SKIPPED by the evaluator anyway, but include them in the run for completeness — tagging them is harmless.
2. Cut the run and define a named const ABOVE `const WORKBOOK_CELL_MAP = [` , e.g.:
   ```js
   const _installerCellEntries = tagCapability("installer", [
     /* …the cut entry objects… */
   ]);
   ```
3. At the original location in the literal, replace the run with `...._installerCellEntries` (spread).
4. Repeat for `_backupCellEntries` ("backup") and `_adssoCellEntries` ("adsso").

SAFETY: after each extraction, run `npm run verify-cell-map` — it MUST stay clean (identical sheet/cell/label set). If it changes, the extraction altered/dropped/duplicated an entry — fix before proceeding. Do them one at a time.

- [ ] **Step 4: Run — tests PASS; `npm run verify-cell-map` clean; `npm run test:migration` green.**

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/capability-export-gating.test.js
git commit -m "feat(export-gating): gate installer, backup, adsso fleet cells"
```

---

## Task 4: Tag federation (GM-node builder + inline GM/LM/Tier-1)

**Files:** Modify `engine.js`; Test `tests/unit/capability-export-gating.test.js`.

Federation gates on `fleet.federationEnabled`. Cells come from `_nsxGmNodeIdentEntries` (builder, spread at ~7849-7851) + inline GM/LM/Tier-1 + GM deploy-size (~7852-8126).

- [ ] **Step 1: Write failing test (append)**

```js
describe("export-gating — federation", () => {
  it("disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    // federation needs >=2 instances + GM data to produce cells
    fleet.instances.push(VcfEngine.newInstance("vcf-instance-02", fleet.sites.map((s) => s.id)));
    fleet.federationConfig = fleet.federationConfig || {};
    // populate a GM node identity the cell-map reads (adjust path to the real model)
    const gm = (fleet.federationConfig.globalManager = fleet.federationConfig.globalManager || {});
    gm.nodes = gm.nodes || [{}, {}, {}];
    gm.nodes[0].fqdn = "gm01.lab.local";
    fleet.federationEnabled = false;
    expect(rows(fleet).some((x) => x.value === "gm01.lab.local")).toBe(false);
    fleet.federationEnabled = true;
    expect(rows(fleet).some((x) => x.value === "gm01.lab.local")).toBe(true);
  });
});
```

Before finalizing: read how federation GM node identity is modeled + which accessor (`_getFederationGm`/`_getFederationNode`) the cells use, and set the test's data on the SAME path so "enabled → present" really emits. Adjust the populate lines accordingly. Keep the off→blank / on→present pair.

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Tag federation sources**

- `_nsxGmNodeIdentEntries` builder: wrap its return with `tagCapability("federation", ...)`.
- Inline GM cluster-level + LM + Tier-1 + GM deploy-size entries (~7852-8126): extract the contiguous run into `const _federationInlineEntries = tagCapability("federation", [ ... ]);` above the literal and spread `..._federationInlineEntries` back (same extraction procedure + verify-cell-map safety as Task 3). If the run is interrupted by the `..._nsxGmNodeIdentEntries` spreads, keep those spreads in place and extract only the inline `{...}` objects around them (you may use two named arrays if cleaner).

- [ ] **Step 4: Run — test PASS; `npm run verify-cell-map` clean; `npm run test:migration` green.**

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/capability-export-gating.test.js
git commit -m "feat(export-gating): gate NSX Federation cells"
```

---

## Task 5: Confirm-message wording keyed on `exportGated`

**Files:** Modify `vcf-design-studio-v9.jsx`; Test `tests/unit/components/capability-tray.test.jsx`; regenerate HTML.

- [ ] **Step 1: Write failing test (append to capability-tray.test.jsx)**

```js
  it("export-gated capability confirm mentions exclusion from output", () => {
    const ctx = clusterCtx();
    ctx.cluster.edgeCluster.enabled = true;
    ctx.cluster.edgeCluster.name = "edge-01"; // has data
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /NSX Edge \+ T0\/BGP/ }));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/excludes it from the design output/i);
  });
```

(Edge is exportGated. Confirm `edge` has `exportGated: true` from Task 1.)

- [ ] **Step 2: Run — must FAIL** (current message says only "keeps the data").

- [ ] **Step 3: Branch the confirm message in `CapabilityTray`**

In `vcf-design-studio-v9.jsx`, the `handle` function in `CapabilityTray`. Replace the single message with a branch on the capability's `exportGated` (look it up from the registry entry — `capabilitiesForScope(scope)` entries carry `exportGated`; the `cap` object in `handle` already is that entry):

```js
  const handle = (cap) => {
    const on = isCapabilityEnabled(cap.key, ctx);
    if (on && capabilityHasData(cap.key, ctx)) {
      const msg = cap.exportGated
        ? `${cap.label} has configuration. Hiding it keeps the data but excludes it from the design output. Continue?`
        : `${cap.label} has configuration. Hiding the panel keeps the data and it still exports. Continue?`;
      if (!window.confirm(msg)) return;
    }
    onToggle(cap.key, !on);
  };
```

- [ ] **Step 4: Run — test PASS.** Then `npm run build-html && npm run verify-html`; `npx vitest run tests/unit/components`.

- [ ] **Step 5: Commit**

```
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html tests/unit/components/capability-tray.test.jsx
git commit -m "feat(export-gating): confirm message notes export exclusion for gated capabilities"
```

---

## Task 6: Non-gated guards + round-trip comment

**Files:** Modify `tests/unit/capability-export-gating.test.js`, `tests/unit/round-trip-matrix.test.js`.

- [ ] **Step 1: Add non-gated guard tests (append to capability-export-gating.test.js)**

```js
describe("export-gating — NON-gated capabilities still export", () => {
  const wld = (f) => f.instances[0].domains[0].clusters[0];

  it("dataservices still exports when disabled (visibility-only)", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.storage.dataServices.datastoreName = "ds-keepme";
    c.storage.dataServices.enabled = false;
    expect(rows(fleet).some((x) => x.value === "ds-keepme")).toBe(true);
  });

  it("supervisor still exports its default size when disabled", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.supervisorConfig.enabled = false;
    // controlPlaneSize defaults "Small" and must still stamp (not gated)
    expect(rows(fleet).some((x) => x.value === "Small")).toBe(true);
  });

  it("T0/BGP cells are independent of the edge capability", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.networks.uplinks = [{ vlan: 100, gateway: "10.0.0.1" }, { vlan: 101, gateway: "10.0.1.1" }];
    c.edgeCluster.enabled = false; // edge off must NOT blank T0 uplink cells
    expect(rows(fleet).some((x) => x.value === "10.0.0.1")).toBe(true);
  });
});
```

Adjust the cluster/scope so each "still exports" assertion actually emits (read the relevant entry's scope; use a workload cluster if needed). The intent is the guard, not the exact cell.

- [ ] **Step 2: Run — must PASS** (these capabilities are not gated, so data exports regardless).

- [ ] **Step 3: Update the round-trip allowlist comment**

In `tests/unit/round-trip-matrix.test.js` (~line 836-854), update the comment block: the old claim "the workbook always expects the full field set regardless of whether the panel is enabled" is no longer true for the gated set. Reword to:

```js
  // ── Capability Tray enabled flags ────────────────────────────────────────
  // Each capability sub-object carries an `enabled` boolean (no workbook cell).
  // Phase-2 export-gating omits a GATED capability's cells when enabled=false
  // (edge, vpc, overlay, portgroups, adsso, backup, installer, federation).
  // The round-trip stays green because stampSentinels flips booleans, so the
  // kitchen-sink exports with every capability ENABLED. The enabled flags
  // themselves remain non-workbook (allowlisted below).
```

(Keep the actual allowlist `test:`/`why:` entries unchanged.)

- [ ] **Step 4: Run** `npm run test:migration` and `npx vitest run tests/unit/round-trip-matrix.test.js` → green.

- [ ] **Step 5: Commit**

```
git add tests/unit/capability-export-gating.test.js tests/unit/round-trip-matrix.test.js
git commit -m "test(export-gating): non-gated guards + round-trip comment update"
```

---

## Task 7: Edge (isolated — multi-builder + mixed-builder split)

**Files:** Modify `engine.js`; Test `tests/unit/capability-export-gating.test.js`; optionally `tests/e2e/workbook-export.spec.ts`.

Edge cells span `_edgeClusterEntries` + `_edgeAllocationEntries` (both pure edge) and `_gatewayInterfaceEntries` (MIXED: 4 T0-uplink entries + 4 edge-node-IP entries). Tag only the edge-node-IP entries from the mixed builder.

- [ ] **Step 1: Write failing tests (append)**

```js
describe("export-gating — edge (multi-source)", () => {
  const wld = (f) => f.instances[0].domains[0].clusters[0];

  it("edge cluster config: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.edgeCluster.nodes[0].fqdn = "en01.lab.local";
    c.edgeCluster.enabled = false;
    expect(rows(fleet).some((x) => x.value === "en01.lab.local")).toBe(false);
    c.edgeCluster.enabled = true;
    expect(rows(fleet).some((x) => x.value === "en01.lab.local")).toBe(true);
  });

  it("edge-node gateway-interface IP gates with edge; T0 uplink VLAN/gateway does NOT", () => {
    const fleet = newFleet();
    const c = wld(fleet);
    c.edgeCluster.nodes[0].gatewayInterfaceIps = ["10.9.9.9", ""];
    c.networks.uplinks = [{ vlan: 222, gateway: "10.8.8.8" }, { vlan: 223, gateway: "10.8.9.8" }];
    c.edgeCluster.enabled = false;
    const r = rows(fleet);
    expect(r.some((x) => x.value === "10.9.9.9")).toBe(false); // edge-node IP gated off
    expect(r.some((x) => x.value === "10.8.8.8")).toBe(true);  // T0 uplink gateway NOT gated
    c.edgeCluster.enabled = true;
    expect(rows(fleet).some((x) => x.value === "10.9.9.9")).toBe(true);
  });
});
```

Adjust cluster/scope so the "enabled → present" cases emit (edge allocation/cluster entries exist at mgmt-cluster + workload-cluster scope — read the spread sites; a workload cluster may be needed). Keep the pairs.

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Tag the two pure edge builders**

In `engine.js`:
- `_edgeAllocationEntries` (~line 5213): wrap its `return [...].filter(Boolean)` with `tagCapability("edge", ...)`.
- `_edgeClusterEntries` (the edge-cluster + per-node identity builder — find it; the enumeration places it near the edge allocation spreads): wrap its return with `tagCapability("edge", ...)`.

- [ ] **Step 4: Split-tag `_gatewayInterfaceEntries`**

In `_gatewayInterfaceEntries` (~line 5044-5069), the returned array's first 4 `E(...)` entries are T0 uplink VLAN/Gateway (resolve reads `uplink(ctx, i)` = `networks.uplinks`) — leave UNTAGGED. The last 4 entries are "Edge Node N Uplink M Gateway Interface IP" (resolve reads `edgeNodeIp(...)` = `edgeCluster.nodes`) — tag these with `capability: "edge"`. Concretely, wrap each of the four `E(cells.enXUpYIp...)` entries:

```js
    { ...E(cells.en1Up1Ip.v90, cells.en1Up1Ip.v91, "Edge Node 1 Uplink 1 Gateway Interface IP", "Gateway Interface IP",
        (_f, ctx) => edgeNodeIp(ctx, 0, 0), (_f, ctx, v) => ensureEdgeNodeIp(ctx, 0, 0, v)), capability: "edge" },
    // …same for en1Up2Ip, en2Up1Ip, en2Up2Ip…
```

Leave the four uplink `E(cells.vlan1/vlan2/gateway1/gateway2 …)` entries unchanged (no capability).

- [ ] **Step 5: Run — tests PASS; `npm run verify-cell-map` clean; `npm run test:migration` green.**

- [ ] **Step 6: (Optional) extend E2E** — in `tests/e2e/workbook-export.spec.ts`, add: enable edge, set a node FQDN, export `.xlsx`, parse with the `xlsx` dep, assert the FQDN cell is populated; then disable edge (accept the confirm), export, assert that cell is blank. Skip if cell-address lookup is heavy — the unit test above already proves the gate. Document the choice.

- [ ] **Step 7: Commit**

```
git add engine.js tests/unit/capability-export-gating.test.js tests/e2e/workbook-export.spec.ts
git commit -m "feat(export-gating): gate NSX Edge cells (edge-node IPs split from T0 uplinks)"
```

---

## Task 8: Full suite, coverage, HTML

- [ ] **Step 1:** `npm test` → all green (verify-html, verify-cell-map unchanged combo count, unit, migration, snapshot, invariants).
- [ ] **Step 2:** `npm run coverage` → engine.js meets 95/95/75/90. If the gate's branch (`entry.capability && !isCapabilityEnabled`) or any tagged-builder branch is uncovered, the per-capability off/on tests should already cover both sides; add a case if a metric dips.
- [ ] **Step 3:** `npx playwright test` → 28+ green (existing + any added).
- [ ] **Step 4:** Commit any coverage test additions:

```
git add tests/unit/capability-export-gating.test.js
git commit -m "test(export-gating): branch coverage for the gate"
```

---

## Self-Review notes
- **Spec coverage:** §2 mechanism → Task 1; §3 gated set → Tasks 2/3/4/7 (+ exclusions guarded in Task 6); §4 tagging → Tasks 2/3/4/7; §5 M2.1 → Task 6 (comment) + the green migration runs; §6 confirm message → Task 5, import-unchanged (no task needed); §7 testing → every task + Task 8.
- **Naming consistency:** `tagCapability`, `capability` (entry field), `exportGated` (registry field), `isCapabilityEnabled` — used identically across tasks.
- **Staging:** edge isolated as Task 7; if cut, Tasks 1-6 still deliver export-gating for the other 7 capabilities + the confirm wording.
- **Safety net:** every tagging/extraction task re-runs `verify-cell-map` (identical cell set) + `test:migration` (round-trip) before commit.
