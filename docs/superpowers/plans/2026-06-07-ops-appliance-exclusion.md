# VCF Ops Appliance + Sizing Exclusion (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `fleet.vcfOpsEnabled === false`, exclude the 6 VCF Ops/Automation appliances from sizing, placement, inventory, fleet-invariant validation, and the exported workbook — non-destructively (the stored `infraStack` keeps them; re-enabling restores them).

**Architecture:** A pure `effectiveStack(stack, vcfOpsEnabled)` filter (identity when Ops on) applied at every consumer, with `vcfOpsEnabled` threaded down the sizing chain (`sizeFleet → sizeInstance → sizeDomain → sizeCluster`) and into placement. Export reuses the Phase-2 capability-gate (tag the 2 Ops cells + add `exportGated` to the `ops` registry entry). `stackTotals` is unchanged. Default fleets (`vcfOpsEnabled` true) are byte-for-byte unaffected.

**Tech Stack:** Plain ES module `engine.js` (no build), React in `vcf-design-studio-v9.jsx`, Vitest, Playwright, `npm run build-html`.

**Spec:** `docs/superpowers/specs/2026-06-07-ops-appliance-exclusion-design.md`.

**Conventions (read first):**
- Immutability; no Claude/AI attribution in commits.
- After ANY `engine.js` or JSX change: `npm run build-html` then `npm run verify-html` (the shipped HTML embeds engine.js — Phase 2 learned this the hard way; don't skip it).
- `npm run verify-cell-map` clean (no new cells). Single test: `npx vitest run <path>`. Full: `npm test`.
- Coverage gate (vitest.config order lines/funcs/branches/stmts): 95/95/75/90.
- **Default unchanged is the key invariant:** `effectiveStack(stack, true)` and `effectiveStack(stack, undefined)` MUST return the input unchanged, so snapshot/round-trip/cell-map stay green. Every threaded param defaults to `true`.
- Ops appliance ids: `vcfOps, vcfOpsCollector, vcfOpsLogs, vcfOpsNet, vcfOpsNetCollector, vcfAuto`. NOT `fleetMgr`/`identityBroker`/`vcfOpsProxy`.

---

## File Structure

| File | Change |
|------|--------|
| `engine.js` | `VCF_OPS_APPLIANCE_IDS` + `effectiveStack`; thread `vcfOpsEnabled` through sizing + placement; relax INV-010; `exportGated` on `ops` + tag 2 Ops cells |
| `vcf-design-studio-v9.jsx` | Read-only consumers (shared-appliances, print) + editable appliance-stack panel use `effectiveStack`; merge-back onChange |
| `tests/unit/ops-exclusion.test.js` | Create — effectiveStack, sizing, placement, validation |
| `tests/unit/capability-export-gating.test.js` | Extend — ops export-gating + completeness |
| `tests/unit/capability-registry.test.js` | Update — `exportGated` set 8→9 |
| `vcf-design-studio-v9.html` | Regenerated |

---

## Task 1: `effectiveStack` helper + constant

**Files:** Modify `engine.js`; Test `tests/unit/ops-exclusion.test.js`.

No consumer uses it yet → no behavior change.

- [ ] **Step 1: Write failing test**

Create `tests/unit/ops-exclusion.test.js`:

```js
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { effectiveStack, VCF_OPS_APPLIANCE_IDS, newFleet, sizeFleet } = VcfEngine;

describe("effectiveStack", () => {
  const stack = [
    { id: "vcenter", size: "Medium", instances: 1, key: "k1" },
    { id: "vcfOps", size: "Medium", instances: 3, key: "k2" },
    { id: "vcfAuto", size: "Small", instances: 1, key: "k3" },
    { id: "fleetMgr", size: "Small", instances: 1, key: "k4" },
  ];
  it("is identity when Ops on (true/undefined)", () => {
    expect(effectiveStack(stack, true)).toBe(stack);
    expect(effectiveStack(stack, undefined)).toBe(stack);
  });
  it("removes the 6 Ops/Automation ids when off; keeps core (fleetMgr) + others", () => {
    const out = effectiveStack(stack, false);
    expect(out.map((e) => e.id)).toEqual(["vcenter", "fleetMgr"]);
  });
  it("the id set is exactly the 6 Ops/Automation appliances", () => {
    expect([...VCF_OPS_APPLIANCE_IDS].sort()).toEqual(
      ["vcfAuto", "vcfOps", "vcfOpsCollector", "vcfOpsLogs", "vcfOpsNet", "vcfOpsNetCollector"].sort()
    );
  });
  it("tolerates null/empty", () => {
    expect(effectiveStack(null, false)).toEqual([]);
    expect(effectiveStack([], false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must FAIL** (`effectiveStack` undefined): `npx vitest run tests/unit/ops-exclusion.test.js`

- [ ] **Step 3: Implement** in `engine.js` near `APPLIANCE_DB` (~line 461, after the catalog object closes):

```js
// VCF Ops / Automation appliances — excluded from sizing/placement/inventory/
// export when fleet.vcfOpsEnabled === false (Phase 3). The catalog has no marker,
// so this is the canonical id set.
const VCF_OPS_APPLIANCE_IDS = ["vcfOps", "vcfOpsCollector", "vcfOpsLogs", "vcfOpsNet", "vcfOpsNetCollector", "vcfAuto"];
const VCF_OPS_APPLIANCE_ID_SET = new Set(VCF_OPS_APPLIANCE_IDS);

// Pure: the stack with Ops/Automation entries removed when Ops is off. Identity
// (returns the SAME array reference) when vcfOpsEnabled !== false, so default
// fleets are byte-for-byte unaffected.
function effectiveStack(stack, vcfOpsEnabled) {
  if (vcfOpsEnabled !== false) return stack || [];
  return (stack || []).filter((e) => e && !VCF_OPS_APPLIANCE_ID_SET.has(e.id));
}
```

- [ ] **Step 4: Export** `effectiveStack` and `VCF_OPS_APPLIANCE_IDS` on the `VcfEngine` export object. Add both to `EXPECTED_SYMBOLS` in `tests/unit/engine-smoke.test.js` (sorted).

- [ ] **Step 5: Run — must PASS.** Then `npm run test:unit` (no regressions — nothing consumes it yet).

- [ ] **Step 6: Commit**

```
git add engine.js tests/unit/ops-exclusion.test.js tests/unit/engine-smoke.test.js
git commit -m "feat(ops-exclusion): add effectiveStack helper + Ops appliance id set"
```

---

## Task 2: Sizing exclusion (thread `vcfOpsEnabled`)

**Files:** Modify `engine.js`; Test `tests/unit/ops-exclusion.test.js`.

- [ ] **Step 1: Append failing test**

```js
describe("sizing excludes Ops when off", () => {
  // Build a fleet whose mgmt cluster has the default Ops-heavy stack.
  function bigOpsFleet() {
    const fleet = newFleet();
    // ensure workload so hosts are non-trivial; default mgmt stack already has Ops
    return fleet;
  }
  it("Ops off reduces (or equals) host count and never increases it", () => {
    const fleet = bigOpsFleet();
    fleet.vcfOpsEnabled = true;
    const onHosts = sizeFleet(fleet).instanceResults[0].domainResults[0].clusterResults[0].finalHosts;
    fleet.vcfOpsEnabled = false;
    const offHosts = sizeFleet(fleet).instanceResults[0].domainResults[0].clusterResults[0].finalHosts;
    expect(offHosts).toBeLessThanOrEqual(onHosts);
  });
  it("Ops off drops the Ops appliances from sharedTotals demand", () => {
    const fleet = bigOpsFleet();
    fleet.vcfOpsEnabled = true;
    const on = sizeFleet(fleet).instanceResults[0].sharedTotals;
    fleet.vcfOpsEnabled = false;
    const off = sizeFleet(fleet).instanceResults[0].sharedTotals;
    expect(off.vcpu).toBeLessThan(on.vcpu);
    expect(off.ram).toBeLessThan(on.ram);
  });
  it("Ops on (default) is unchanged vs not setting the flag", () => {
    const a = sizeFleet(newFleet());
    const f2 = newFleet(); f2.vcfOpsEnabled = true;
    const b = sizeFleet(f2);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
```
Before finalizing: confirm the exact shape of `sizeFleet`'s return (instanceResults / domainResults / clusterResults / finalHosts / sharedTotals) by reading `sizeFleet`/`sizeInstance`/`sizeCluster` return objects, and adjust the accessors so the assertions read real fields. If the default mgmt fleet's host count is dominated by storage/policy floors (so Ops removal doesn't change finalHosts), keep the `toBeLessThanOrEqual` host assertion AND rely on the `sharedTotals` demand-drop assertion as the strict check. Keep the "Ops on unchanged" identity test.

- [ ] **Step 2: Run — must FAIL** (sizing ignores the flag today).

- [ ] **Step 3: Thread `vcfOpsEnabled` (default true) through the chain**

In `engine.js` (signatures: `sizeFleet(fleet)` ~12985, `sizeInstance(instance, vcfVersion)` ~12788, `sizeDomain(domain, extraByClusterId, _unused, vcfVersion)` ~12765, `sizeCluster(cluster, extraStack, vcfVersion)` ~12537):
1. `sizeCluster(cluster, extraStack = [], vcfVersion = DEFAULT_VCF_VERSION_LEGACY, vcfOpsEnabled = true)`: change the infra line to
   `const infra = stackTotals([...effectiveStack(cluster.infraStack, vcfOpsEnabled), ...(extraStack || [])], vcfVersion);`
   (read the current line — it spreads `cluster.infraStack` and `extraStack` into `stackTotals`; wrap ONLY the cluster.infraStack with effectiveStack; do NOT filter extraStack).
2. `sizeDomain(..., vcfVersion = ..., vcfOpsEnabled = true)`: pass `vcfOpsEnabled` to every `sizeCluster(...)` call inside.
3. `sizeInstance(instance, vcfVersion = ..., vcfOpsEnabled = true)`: pass `vcfOpsEnabled` to `sizeDomain(...)` calls; and where it builds `sharedStack` from infraStack entries (~12843-12851), wrap each cluster's infraStack with `effectiveStack(clu.infraStack, vcfOpsEnabled)` before collecting.
4. `sizeFleet(fleet)`: pass `fleet.vcfOpsEnabled` to each `sizeInstance(inst, vcfVersion, fleet.vcfOpsEnabled)` call.

Read each function body to apply the thread at the exact call sites; defaults keep all existing direct callers (tests) at Ops-on.

- [ ] **Step 4: Run — must PASS.** Then `npm run test:snapshot` (default fleets unchanged → green; if a snapshot changed, the identity guarantee is broken — investigate, do NOT -u blindly). `npm run test:unit` green.

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/ops-exclusion.test.js
git commit -m "feat(ops-exclusion): exclude Ops appliances from sizing when off"
```

---

## Task 3: Placement exclusion

**Files:** Modify `engine.js`; Test `tests/unit/ops-exclusion.test.js`.

- [ ] **Step 1: Append failing test**

```js
describe("placement excludes Ops when off", () => {
  const { ensurePlacement } = VcfEngine; // confirm exported; else test buildDefaultPlacement
  it("Ops-off placement has no keys for Ops appliance entries", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    inst.siteIds = ["s1", "s2"]; // placement only computes for multi-site
    // ensure a stretched/multi-site shape so placement runs
    fleet.vcfOpsEnabled = false;
    const placement = ensurePlacement(inst, false);
    const cluster = inst.domains[0].clusters[0];
    const opsKeys = (cluster.infraStack || []).filter((e) => VCF_OPS_APPLIANCE_IDS.includes(e.id)).map((e) => e.key);
    for (const k of opsKeys) expect(placement[k]).toBeUndefined();
  });
});
```
Confirm `ensurePlacement`/`buildDefaultPlacement` exports and the multi-site precondition (placement returns `{}` when <2 sites — set up 2 sites). If `ensurePlacement` isn't exported, test `buildDefaultPlacement(inst, false)` directly. Adjust the fleet so placement actually computes (read buildDefaultPlacement's guards).

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Implement** in `engine.js`:
- `buildDefaultPlacement(instance, vcfOpsEnabled = true)` (~11161): where it iterates `clu.infraStack` (~11169), iterate `effectiveStack(clu.infraStack, vcfOpsEnabled)` instead.
- `ensurePlacement(instance, vcfOpsEnabled = true)` (~11196): pass `vcfOpsEnabled` to `buildDefaultPlacement(instance, vcfOpsEnabled)`.
- Update `ensurePlacement`'s caller(s): grep `ensurePlacement(` — thread `fleet.vcfOpsEnabled` from the fleet context at each call site (default true keeps existing behavior).

- [ ] **Step 4: Run — must PASS.** `npm run test:unit` + `npm run test:snapshot` green (default unchanged).

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/ops-exclusion.test.js
git commit -m "feat(ops-exclusion): exclude Ops appliances from per-site placement when off"
```

---

## Task 4: Validation relaxation (VCF-INV-010)

**Files:** Modify `engine.js`; Test `tests/unit/ops-exclusion.test.js`.

- [ ] **Step 1: Append failing test**

```js
describe("validation allows Ops absent when off", () => {
  const { validateFleetInvariants, migrateFleet } = VcfEngine;
  function removeOps(fleet) {
    for (const inst of fleet.instances) for (const dom of inst.domains) for (const clu of dom.clusters)
      clu.infraStack = (clu.infraStack || []).filter((e) => !VCF_OPS_APPLIANCE_IDS.includes(e.id));
    return fleet;
  }
  it("Ops off + Ops appliances absent → no 'missing per-fleet appliance' error for Ops ids", () => {
    const fleet = removeOps(newFleet());
    fleet.vcfOpsEnabled = false;
    const issues = validateFleetInvariants(fleet);
    const opsMissing = issues.filter((i) =>
      /per-fleet|exactly once|missing/i.test(i.message || "") &&
      /vcfOps|vcfAuto|VCF Operations|VCF Automation/i.test(i.message || ""));
    expect(opsMissing).toEqual([]);
  });
  it("Ops ON + Ops appliances missing → INV-010 still fires (regression guard)", () => {
    const fleet = removeOps(newFleet());
    fleet.vcfOpsEnabled = true;
    const issues = validateFleetInvariants(fleet);
    expect(issues.some((i) => /vcfOps|VCF Operations/i.test(i.message || ""))).toBe(true);
  });
});
```
Read `validateFleetInvariants` + the INV-010 block (~10355) + the `hasCollector`/`hasNetCollector` checks (~10387) to confirm the exact issue-message shape and tune the regexes so the assertions match real output. (If issues are objects with `code`/`severity`, filter on those instead.)

- [ ] **Step 2: Run — must FAIL** (Ops-off fleet currently flags missing Ops per-fleet appliances).

- [ ] **Step 3: Implement** in `validateFleetInvariants` (~10327): in the INV-010 per-fleet-appliance loop, when `fleet.vcfOpsEnabled === false`, SKIP the missing-check for appliance ids in `VCF_OPS_APPLIANCE_ID_SET` (their absence is valid). Likewise guard the `hasCollector`/`hasNetCollector` Ops-collector checks (~10387) so they don't fire "missing Ops collector" when Ops is off. Do NOT relax non-Ops per-fleet rules (e.g. `fleetMgr`). Add a brief comment referencing Phase 3.

- [ ] **Step 4: Run — must PASS.** `npm run test:invariants` + `npm run test:unit` green.

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/ops-exclusion.test.js
git commit -m "feat(ops-exclusion): relax INV-010 for Ops appliances when Ops is off"
```

---

## Task 5: Export gating (extend Phase 2 to ops)

**Files:** Modify `engine.js`; Test `tests/unit/capability-export-gating.test.js`, `tests/unit/capability-registry.test.js`.

- [ ] **Step 1: Update the registry-set test + add ops export-gating tests**

In `tests/unit/capability-registry.test.js`, the `exportGated` set assertion: change the expected array to include `"ops"` (now 9 keys: adsso, backup, edge, federation, installer, **ops**, overlay, portgroups, vpc).

In `tests/unit/capability-export-gating.test.js`, append:

```js
describe("export-gating — ops (Phase 3)", () => {
  const has = (fleet, val) => rows(fleet).some((x) => x.value === val);
  it("VCF Ops appliance-size cell blanks when Ops off; present when on", () => {
    const fleet = newFleet();
    const mgmtClu = fleet.instances[0].domains[0].clusters[0];
    const opsEntry = (mgmtClu.infraStack || []).find((e) => e.id === "vcfOps");
    expect(opsEntry).toBeTruthy();           // default mgmt stack has vcfOps
    opsEntry.size = "Large";                  // a value the cell stamps
    fleet.vcfOpsEnabled = false;
    expect(has(fleet, "Large")).toBe(false);  // gated off (NOTE: pick a size value unique to this cell; if "Large" collides, assert the specific cell row by label instead)
    fleet.vcfOpsEnabled = true;
    expect(has(fleet, "Large")).toBe(true);
  });
  it("vcfOpsDeployToVdpg cell blanks when Ops off (9.1)", () => {
    const fleet = newFleet(); // default 9.1
    fleet.vcfOpsDeployToVdpg = true;
    fleet.vcfOpsEnabled = false;
    const dep = rows(fleet).find((x) => /dedicated|vDPG|VCF OPs/i.test(x.label));
    // when gated, the value is blank
    if (dep) expect(dep.value).toBe("");
    fleet.vcfOpsEnabled = true;
    const dep2 = rows(fleet).find((x) => /dedicated|vDPG|VCF OPs/i.test(x.label));
    if (dep2) expect(dep2.value).toBe("Selected");
  });
});
```
"Large" may collide with other appliance-size cells — if so, assert by the specific row: `rows(fleet).find(x => x.label === "VCF Operations Appliance Size").value`. Read the cell's exact label (~engine line 6418) and use it.

Also add an `ops` case to the existing straggler-completeness describe (stamp the Ops cells, Ops off, assert no leak of an Ops-only sentinel — the vcfOps size + vcfOpsDeployToVdpg).

- [ ] **Step 2: Run — must FAIL.**

- [ ] **Step 3: Implement** in `engine.js`:
1. Add `exportGated: true` to the `ops` entry in `CAPABILITY_REGISTRY` (the inline entry, ~where `ops` is defined).
2. Tag the two Ops cell-map entries with `capability: "ops"`:
   - "VCF Operations Appliance Size" (~line 6418).
   - The `vcfOpsDeployToVdpg` deploy-location entry (~line 6447).
   Add `capability: "ops",` as a field on each entry object.

- [ ] **Step 4: Run — must PASS.** `npm run verify-cell-map` clean (no new cells). `npm run test:migration` green (round-trip: sentinel flips vcfOpsEnabled → true, so Ops cells emit). `npm run test:unit` green.

- [ ] **Step 5: Commit**

```
git add engine.js tests/unit/capability-export-gating.test.js tests/unit/capability-registry.test.js
git commit -m "feat(ops-exclusion): export-gate the VCF Ops cells (ops now exportGated)"
```

---

## Task 6: UI — appliance-stack + inventory reflect exclusion

**Files:** Modify `vcf-design-studio-v9.jsx`; regenerate HTML; Test (component, JSDOM).

`effectiveStack` is on `VcfEngine` (exported Task 1) — confirm it's in the JSX engine destructure; add it if missing.

- [ ] **Step 1: Read the three render sites**
- Editable appliance-stack panel: `vcf-design-studio-v9.jsx` ~1214-1220 (`SizeRecommender` + the stack editor, `stack={cluster.infraStack}`, `onChange={(infraStack) => update({ infraStack })}`). Note `fleet` and `cluster` are in ClusterCard scope.
- Shared-appliances view: ~173-224 (builds rows from `ir.sharedStack`).
- Print appliance table: ~7235 (`PrintApplianceStackTable stack={cluster.infraStack || []}`).

- [ ] **Step 2: Editable appliance-stack panel — hide Ops rows when off, NON-destructively**
Pass the displayed (filtered) stack to the editor, and merge the hidden Ops entries back on change so they are preserved in the model:

```jsx
{(() => {
  const opsOn = fleet?.vcfOpsEnabled !== false;
  const shown = effectiveStack(cluster.infraStack, fleet?.vcfOpsEnabled);
  const hiddenOps = opsOn ? [] : (cluster.infraStack || []).filter((e) => !shown.includes(e));
  const onStackChange = (edited) => update({ infraStack: opsOn ? edited : [...edited, ...hiddenOps] });
  return (
    <>
      <SizeRecommender stack={shown} onChange={onStackChange} />
      <ApplianceStackEditorElement stack={shown} onChange={onStackChange} ...otherProps />
      {!opsOn && (
        <div className="text-[10px] text-slate-400 font-mono mt-1">
          VCF Ops/Automation appliances hidden &amp; excluded (Ops capability off).
        </div>
      )}
    </>
  );
})()}
```
Use the ACTUAL editor element name + props found in Step 1 (the snippet names are placeholders for the real `SizeRecommender` + stack editor JSX). Keep behavior identical when `opsOn` (shown === cluster.infraStack, hiddenOps empty, onChange writes edited as-is).

- [ ] **Step 3: Read-only consumers**
- Shared-appliances (~185): the rows come from `ir.sharedStack`. `sharedStack` is built in `sizeInstance` — confirm whether Task 2 already filtered it (it filters the `sharedStack`/`sharedTotals` via effectiveStack). If `ir.sharedStack` is already Ops-filtered by the engine when off, NO JSX change is needed here; assert that. If the JSX builds its own list from raw infraStack, wrap with `effectiveStack(stack, fleet?.vcfOpsEnabled)`.
- Print table (~7235): `stack={effectiveStack(cluster.infraStack, fleet?.vcfOpsEnabled)}`.

- [ ] **Step 4: Component test** (`tests/unit/components/`, JSDOM, mirror existing component-test harness): render the full app (or ClusterCard) for a fleet with `vcfOpsEnabled=false` and assert the "VCF Operations" appliance row is NOT shown in the appliance-stack panel; toggle on → it shows. If full-app render is heavy, assert via a focused render. If not feasible, document and rely on the engine tests + a manual smoke note.

- [ ] **Step 5: Regenerate + verify**
`npm run build-html && npm run verify-html`. `npx vitest run tests/unit/components`.

- [ ] **Step 6: Commit**

```
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html tests/unit/components/<new>.test.jsx
git commit -m "feat(ops-exclusion): appliance-stack + inventory UI reflect Ops exclusion"
```

---

## Task 7: Full suite + coverage + E2E

- [ ] **Step 1:** `npm test` → all green (verify-html in sync, verify-cell-map clean, unit/migration/snapshot/invariants). Snapshots MUST be unchanged (default Ops-on identity).
- [ ] **Step 2:** `npm run coverage` → engine.js meets 95/95/75/90. Add cases (e.g. effectiveStack off-branch, INV-010 skip branch) if a metric dips.
- [ ] **Step 3:** `npx playwright test` → green (existing 28; the workbook-export specs still pass — default Ops-on). Optionally add an E2E: turn Ops off via the tray chip, confirm a host-count change or the Ops appliance row disappears.
- [ ] **Step 4:** Commit any coverage test additions.

---

## Self-Review notes
- **Spec coverage:** §2 helper → T1; §3 sizing → T2; §4 placement → T3; §5 validation → T4; §6 export → T5; §7 UI → T6; §8 testing → all + T7.
- **Default-unchanged invariant** is enforced by `effectiveStack` identity-when-on + every threaded param defaulting `true`; verified by the snapshot suite staying green and the "Ops on unchanged" identity test.
- **Naming consistency:** `effectiveStack`, `VCF_OPS_APPLIANCE_IDS`, `vcfOpsEnabled`, `exportGated`, `capability:"ops"` used identically across tasks.
- **Non-destructive:** stored `infraStack` is never mutated by the engine; the editable UI merges hidden Ops entries back on change.
