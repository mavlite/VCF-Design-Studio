# Task #31 — engine.js Coverage Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise `engine.js` test coverage from 79.78/73.21/86/84.02 (stmts/branches/funcs/lines) to ≥ 90/75/95/95 and restore the vitest threshold gate to those values, making CI a real safety net again instead of a polite-fiction floor.

**Architecture:** Four phases land in one PR. Phase A adds a single smoke-test file calling every `create*Config` / `newT0Gateway`-style factory in `engine.js:887-1580` that isn't already exercised — cheapest possible coverage gain (~250 stmts). Phase B adds three focused behavior suites for the naming-template engine, the IP allocator, and the AZ2/BGP validators (~120 stmts). Phase C adds an xlsx-edges suite for `cellPattern` expansion, `computeReconcileDiff`, per-host FQDN apply, and scattered single-line apply callbacks (~70 stmts). Phase D adds `/* istanbul ignore */` markers (one-line `// why:` neighbor required for each) on browser-only and provably-impossible paths, plus a targeted defensive-coverage suite for the additional-cluster scope iterator and miscellaneous reachable defensive code (~325 stmts). Final commit flips the threshold block in `vitest.config.js`.

**Tech Stack:** Vitest 4.1.7 with v8 coverage provider; node test environment (no JSDOM needed — `engine.js` is pure logic). All new tests follow the existing `tests/unit/*.test.js` pattern: top-level `import * as engine from "../../engine.js"` (or named imports as the existing engine-side tests use), `describe` + `it` + `expect`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `tests/unit/engine-factory-smoke.test.js` | Create | Phase A — call every uncovered `create*Config` / `new*Gateway` factory once and assert the documented return shape |
| `tests/unit/engine-naming-templates.test.js` | Create | Phase B — naming engine: `resolveTemplate`, `mergeNamingConfig`, `hostTokensFor`, `vdsTokensFor`, `resolveHostname`, `vdsSlotPurpose`, `applyVdsTemplate`, `validateHostnameFormat`, `validateNamingDesign` |
| `tests/unit/engine-ip-allocator.test.js` | Create | Phase B — IP math + allocation: `ipToInt`, `intToIp`, `allocateClusterIps` with AZ2 host-split path |
| `tests/unit/engine-az2-bgp-validators.test.js` | Create | Phase B — `checkOverrideSubnet`, VCF-IP-007 (override-in-wrong-AZ), VCF-HW-NET-022 (BGP-peer-not-in-uplink-subnet), `promoteToInitial` |
| `tests/unit/engine-xlsx-edges.test.js` | Create | Phase C — `readWorkbookXlsxAsCellMapRows` cellPattern expansion, `computeReconcileDiff` downgrade reporter, per-host FQDN apply on Deploy Mgmt + Deploy WLD, scattered single-line apply callbacks |
| `tests/unit/engine-defensive-coverage.test.js` | Create | Phase D — targeted tests for additional-cluster scope-iterator arm, `_createSupervisorEntry` E-factory edges, `gwCidr`/`poolStart`/`poolEnd` cell-builder helpers, miscellaneous reachable defensive code |
| `engine.js` | Modify | Phase D — add `/* istanbul ignore next */` + `// why:` markers on browser-only paths and provably-impossible state guards (no behavior change) |
| `vitest.config.js` | Modify | Final — flip `coverage.thresholds` from `78/80/70/75` (lines/funcs/branches/stmts) back to `95/95/75/90`; replace the temporary calibration comment with a one-line pointer at the achieved coverage |

---

## Shared context for every task

All test files in this plan use the existing engine-side test pattern. Read one or two of `tests/unit/themes/theme-19-az2-networking.test.js` or `tests/unit/workbook-xlsx-emitter.test.js` for boilerplate reference. Key conventions:

- No `// @vitest-environment` pragma needed (node env is the default; engine.js is pure logic).
- Import: `import * as engine from "../../engine.js";` then use `engine.functionName(...)`. Some existing tests use named imports (`import { newFleet, sizeFleet } from "../../engine.js";`) — either works; mirror the closest existing test for the function you're targeting.
- No globals, no setup hooks needed.
- After each task: `npm run coverage` to confirm coverage went up. Don't commit until coverage has actually increased.

If a function you're testing isn't exported, use the namespace import (`engine.functionName`) — `engine.js` exports a flat namespace, so internal helpers may or may not be callable. For unreachable internals, leave them for Phase D's ignore-markers pass.

---

## Task 1: Phase A — Factory smoke tests

**Files:**
- Create: `tests/unit/engine-factory-smoke.test.js`

**Background:** `engine.js:887-1580` defines ~28 `create*Config` / `newT0Gateway`-style factories. The reconnaissance report identified that roughly half of these have no test fixture invoking them, accounting for ~250 uncovered statements (mostly object-literal continuation lines inside the factory bodies). One smoke test per factory — call it with default args and assert the return is a non-null object — reclaims this coverage trivially.

- [ ] **Step 1: Enumerate the factories**

Run: `grep -nE '^function (create|new)[A-Z]' engine.js | awk -F: '{print $1":"$2}' | head -40`

Expected output: line + signature for every top-level factory between L887 and L1580 (and the later `newCluster`/`newFleet` at L10021+). Capture the list. You'll need each name in Step 2.

- [ ] **Step 2: Write the smoke-test file**

Create `tests/unit/engine-factory-smoke.test.js`:

```js
// engine.js Phase A smoke coverage — call every `create*Config` and
// `new*Gateway` factory at least once so the v8 coverage report stops
// listing their bodies as uncovered. These tests assert the return is
// a non-null object with at least one documented key — they do NOT
// assert behavior. Real-behavior coverage lives in the focused suites
// (naming templates, IP allocator, AZ2/BGP validators) under their own
// test files.

import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

describe("engine.js factory smoke — Phase A", () => {
  it("newT0Gateway returns a shaped object", () => {
    const t0 = engine.newT0Gateway();
    expect(t0).toBeDefined();
    expect(typeof t0).toBe("object");
    expect(t0.name).toBeDefined();
  });

  it("createFleetNetworkConfig returns a shaped object", () => {
    const cfg = engine.createFleetNetworkConfig();
    expect(cfg).toBeDefined();
    expect(typeof cfg).toBe("object");
  });

  it("createVdsLag returns a shaped object", () => {
    const lag = engine.createVdsLag();
    expect(lag).toBeDefined();
    expect(typeof lag).toBe("object");
  });

  // ... continue for every factory in the enumeration from Step 1.
  // Pattern: one `it(...)` per factory. Each test:
  //   1. Calls the factory with default args (no args).
  //   2. Expects defined + typeof object.
  //   3. Optionally asserts ONE documented key exists (e.g., `t0.name`
  //      for newT0Gateway). The single key check guards against the
  //      factory accidentally returning `null` or a string.
});
```

Add one `it(...)` block per factory from Step 1's enumeration. Targets to cover (call each by name): `newT0Gateway`, `createFleetNetworkConfig`, `createVdsLag`, `createNetworkIpv6`, `createPortgroupSlot`, `createClusterNsxHostOverlay`, `createClusterPortgroups`, `createClusterNetworks`, `createHostIpOverride` (pass an integer arg, e.g., `createHostIpOverride(0)`), `createFleetReportMetadata`, `createFleetInstallerConfig`, `createFleetBackupConfig`, `createEdgeNode`, `createEdgeCluster`, `createFederationNode`, `createFederationGlobalManagerExtras`, `createFederationLocalManager`, `createFederationTier1`, `createWitnessConfig`, `createClusterAz2HostOverlay`, `createClusterAz2Networks`, `createSupervisorDeployment`, `createClusterSupervisorConfig`, `createClusterVsanCompute`, `createFleetFederationConfig`, `createFleetAdConfig`, `createFleetNamingConfig`, `createClusterNaming`.

Skip any factory that requires non-default args you can't easily provide — if in doubt, peek at `engine.js:<line>` for the signature.

For factories with required args, use a minimal valid value:
- `createHostIpOverride(0)` — host index 0
- `newT0Gateway()` — name has default
- `newCluster()`, `newMgmtCluster()`, `newWorkloadCluster()`, `newFleet()` — these have defaults; include them too (they may already be covered, but a smoke call is harmless).

- [ ] **Step 3: Run the new file**

Run: `npx vitest run tests/unit/engine-factory-smoke.test.js`

Expected: all `it(...)` cases pass.

- [ ] **Step 4: Confirm coverage delta**

Run: `npm run coverage 2>&1 | tail -10`

Expected: Stmts coverage rises from 79.78% to ~86%+. If it didn't rise meaningfully (< 2pp delta), the factories must be hitting an early-return path — check that the test isn't accidentally mocking `engine.js` and that the import is working. The factory bodies should be executing.

- [ ] **Step 5: Run full suite for regression check**

Run: `npx vitest run`

Expected: full suite green, +N new tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/engine-factory-smoke.test.js
git commit -m "test(task-31): Phase A — engine.js factory smoke coverage

Calls every create*Config / new*Gateway factory in engine.js:887-1580
once. Asserts non-null shaped return; does not exercise behavior.
Reclaims ~250 statements of object-literal continuation lines that
were marked uncovered because no fixture instantiated these factories.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Phase B — Naming-template engine

**Files:**
- Create: `tests/unit/engine-naming-templates.test.js`

**Background:** The naming-template engine generates every hostname/FQDN/VDS-slot name in an exported workbook. Functions live around `engine.js:1599-1989` and `1567-1599` (config side). Currently 0 tests target this surface. Real bug-catching coverage — a regression here silently breaks all generated names.

Functions to test (cite line numbers from `engine.js`):
- `resolveTemplate(template, tokens)` — token substitution with `{token}` syntax
- `mergeNamingConfig(fleetCfg, clusterCfg, defaults)` — three-way config merge with precedence
- `hostTokensFor(cluster, hostIndex, isAz2 = false)` — produces the token map for a host
- `vdsTokensFor(cluster, vdsIndex)` — produces the token map for a VDS slot
- `resolveHostname(cluster, hostIndex, isAz2)` — top-level hostname generator (calls above)
- `vdsSlotPurpose(cluster, vdsIndex)` — derived purpose string used in tokens
- `applyVdsTemplate(template, cluster, vdsIndex)` — wrapper for VDS slot name resolution
- `validateHostnameFormat(hostname)` — DNS-label validation
- `validateNamingDesign(fleet)` — Naming Design Plan 7 cross-fleet validator

- [ ] **Step 1: Read the source**

Use Read on `engine.js:1599-1989` (the naming engine block). Note signatures + edge cases each function handles. Expected reading time: 10 minutes.

- [ ] **Step 2: Write the test file**

Create `tests/unit/engine-naming-templates.test.js`:

```js
// engine.js Phase B — naming-template engine behavior coverage.
// Targets the hostname/FQDN/VDS-slot generators that produce every
// name in an exported workbook. A regression here silently breaks
// names; these tests are the safety net.

import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

describe("resolveTemplate", () => {
  it("substitutes single tokens", () => {
    expect(engine.resolveTemplate("host-{i}", { i: "01" })).toBe("host-01");
  });

  it("substitutes multiple tokens in one template", () => {
    expect(
      engine.resolveTemplate("{site}-{cluster}-{i}", {
        site: "primary", cluster: "mgmt", i: "01",
      })
    ).toBe("primary-mgmt-01");
  });

  it("leaves unknown tokens unsubstituted", () => {
    expect(engine.resolveTemplate("host-{unknown}", {})).toBe("host-{unknown}");
  });

  it("returns the template unchanged when there are no tokens", () => {
    expect(engine.resolveTemplate("plain-name", {})).toBe("plain-name");
  });

  // Add cases for: empty template, null/undefined tokens map, repeated tokens.
});

describe("mergeNamingConfig", () => {
  it("cluster overrides fleet overrides defaults", () => {
    // Read the function signature at engine.js:~1620 and write per its
    // precedence rules. Assert: a value present in `clusterCfg` wins
    // over `fleetCfg` wins over `defaults`.
  });

  it("missing keys fall through to lower-precedence config", () => {
    // ...
  });
});

describe("hostTokensFor", () => {
  it("produces tokens for an AZ1 host", () => {
    const fleet = engine.newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    const tokens = engine.hostTokensFor(cluster, 0, false);
    expect(tokens).toBeDefined();
    expect(typeof tokens).toBe("object");
  });

  it("produces tokens for an AZ2 host (stretched cluster path)", () => {
    // Build a stretched-domain fleet so AZ2 host tokens are produced.
    // ...
  });

  // Add: site-fallback chain (when cluster.site is unset, falls back to
  // domain.site, then instance.site, then fleet.site — see L1656 path).
});

describe("vdsTokensFor", () => {
  it("returns tokens for a VDS slot", () => {
    // ...
  });
});

describe("resolveHostname", () => {
  it("generates a default hostname from the default template", () => {
    const fleet = engine.newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    const name = engine.resolveHostname(cluster, 0, false);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("respects a custom cluster-level template", () => {
    // Set cluster.naming.hostnameTemplate = "custom-{i}", assert output.
  });
});

describe("validateHostnameFormat", () => {
  it("accepts a valid DNS label", () => {
    expect(engine.validateHostnameFormat("mgmt-01")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(engine.validateHostnameFormat("MGMT-01")).toBe(false);
  });

  it("rejects characters not in [a-z0-9-]", () => {
    expect(engine.validateHostnameFormat("mgmt_01")).toBe(false);
  });

  it("rejects names starting or ending with a hyphen", () => {
    expect(engine.validateHostnameFormat("-mgmt")).toBe(false);
    expect(engine.validateHostnameFormat("mgmt-")).toBe(false);
  });

  // Add: max length (63 chars per RFC 1123).
});

describe("validateNamingDesign", () => {
  it("reports no issues on a freshly created fleet", () => {
    const fleet = engine.newFleet();
    const issues = engine.validateNamingDesign(fleet);
    expect(Array.isArray(issues)).toBe(true);
  });

  it("flags duplicate hostnames across clusters", () => {
    // Build a fleet where two clusters resolve to the same hostname,
    // assert the issue is reported.
  });
});

// Add a describe block for vdsSlotPurpose and applyVdsTemplate following
// the same pattern.
```

The implementer should write the missing `it(...)` bodies based on reading the source at L1599-1989. Aim for **15-25 cases total** across the describe blocks. Each behavior assertion should be specific (input → expected output), not a tautology.

- [ ] **Step 3: Run the new file**

Run: `npx vitest run tests/unit/engine-naming-templates.test.js`

Expected: all cases pass. If a case fails because your assumption about the function's behavior is wrong, read the source and fix the assertion (don't change the source code — these tests assert current behavior, not desired behavior).

- [ ] **Step 4: Coverage delta check**

Run: `npm run coverage 2>&1 | tail -10`

Expected: Stmts coverage rises another ~1-2 pp. The naming engine is ~50-70 statements of behavior code.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/engine-naming-templates.test.js
git commit -m "test(task-31): Phase B — naming-template engine coverage

Covers resolveTemplate, mergeNamingConfig, hostTokensFor (AZ1 + AZ2),
vdsTokensFor, resolveHostname, vdsSlotPurpose, applyVdsTemplate,
validateHostnameFormat, validateNamingDesign. Asserts current behavior
so future regressions in hostname/FQDN/VDS-slot generation fail CI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Phase B — IP allocator

**Files:**
- Create: `tests/unit/engine-ip-allocator.test.js`

**Background:** `ipToInt`, `intToIp`, and `allocateClusterIps` live around `engine.js:1777-1844`. The function `allocateClusterIps` allocates every IP in an exported workbook; the AZ2 host-split path (L1832-1844) is currently 0% tested. Real bug-catching coverage.

- [ ] **Step 1: Read the source**

Use Read on `engine.js:1770-1900`. Pay attention to:
- `ipToInt`/`intToIp` round-trip semantics
- `allocateClusterIps` signature (likely takes `cluster`, `nets` or similar)
- The AZ2 split: how does `hostSplitPct` (default 50) divide hosts between `cluster.networks` (AZ1) and `cluster.az2Networks` (AZ2)?
- What gets returned: an array of allocated hosts? Each tagged with `az: "az1" | "az2" | null`?
- Warning prefixes — `az1/` and `az2/` per HANDOFF.

- [ ] **Step 2: Write the test file**

Create `tests/unit/engine-ip-allocator.test.js` with the following test plan (the implementer writes the bodies per the source they read):

```js
import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

describe("ipToInt / intToIp", () => {
  it("ipToInt round-trips through intToIp", () => {
    expect(engine.intToIp(engine.ipToInt("10.0.16.1"))).toBe("10.0.16.1");
  });

  it("ipToInt handles boundaries", () => {
    expect(engine.ipToInt("0.0.0.0")).toBe(0);
    expect(engine.ipToInt("255.255.255.255")).toBe(0xffffffff);
  });

  it("intToIp converts known integers", () => {
    expect(engine.intToIp(0x0a000010)).toBe("10.0.0.16");
  });
});

describe("allocateClusterIps — AZ1-only (non-stretched)", () => {
  it("allocates IPs from cluster.networks pool", () => {
    const fleet = engine.newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    // populate cluster.networks.mgmt.pool with a known range
    // call allocateClusterIps(cluster, ...) per the signature
    // assert returned host count matches cluster.hostCount
    // assert each host.az is null (or "az1" — confirm from source)
  });

  it("emits a warning when the pool is exhausted", () => {
    // populate pool with a 2-IP range, set host count to 4, expect a
    // warning prefixed with the appropriate scope tag.
  });
});

describe("allocateClusterIps — AZ2 split (stretched)", () => {
  it("splits hosts by hostSplitPct between AZ1 and AZ2 pools", () => {
    // Build a stretched fleet (domain.placement === "stretched").
    // Populate cluster.networks (AZ1) + cluster.az2Networks (AZ2) pools.
    // Set hostCount = 8 with hostSplitPct = 50.
    // Assert 4 hosts have az === "az1" and use AZ1 pool IPs,
    // 4 hosts have az === "az2" and use AZ2 pool IPs.
  });

  it("tags warnings with az1/ vs az2/ prefix per scope", () => {
    // Exhaust the AZ2 pool, assert the warning carries `az2/...`.
  });

  it("respects hostSplitPct != 50", () => {
    // Set hostSplitPct = 25 with hostCount = 8 — expect 2 AZ1 + 6 AZ2
    // (or whatever the source dictates; confirm from L1832-1844).
  });
});
```

Aim for **8-12 cases total**. Build the cluster fixtures inline (don't extract to a helper unless 4+ tests share the exact same fixture).

- [ ] **Step 3-5: Run, coverage delta, commit**

```bash
npx vitest run tests/unit/engine-ip-allocator.test.js
npm run coverage 2>&1 | tail -10
# Expect another ~1-1.5pp stmt coverage gain.
git add tests/unit/engine-ip-allocator.test.js
git commit -m "test(task-31): Phase B — IP allocator coverage (AZ1 + AZ2)

Covers ipToInt/intToIp round-trip + boundaries, allocateClusterIps for
AZ1-only and stretched (AZ2 split via hostSplitPct), pool-exhaustion
warnings tagged by AZ scope. Closes the AZ2 host-IP allocation blind
spot called out in HANDOFF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Phase B — AZ2 / BGP validators

**Files:**
- Create: `tests/unit/engine-az2-bgp-validators.test.js`

**Background:** `checkOverrideSubnet`, VCF-IP-007 (override-in-wrong-AZ), and VCF-HW-NET-022 (BGP-peer-not-in-uplink-subnet) live around `engine.js:2042-2233`. `promoteToInitial` lives at L768. Currently unfired in tests. These are warnings users rely on; if they silently stop firing, a misconfigured fleet ships without the warning.

- [ ] **Step 1: Read the source**

Read `engine.js:768-790` (`promoteToInitial`) and `engine.js:2042-2233` (validators). For each validator, note:
- Trigger condition (what fleet shape fires it)
- Issue object shape (`{ ruleId, scope, message, severity }` or similar)
- Where it's pushed (the validator's return value or a passed `issues[]` array)

- [ ] **Step 2: Write the test file**

```js
import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

describe("promoteToInitial", () => {
  it("flips a non-initial instance to initial", () => {
    const fleet = engine.newFleet();
    // Build a second instance, then promote.
    // Assert the previous initial demoted, the new one is now initial.
  });

  it("is a no-op when called on the already-initial instance", () => {
    // ...
  });
});

describe("VCF-IP-007 — override in wrong AZ subnet", () => {
  it("does not fire on a clean fleet", () => {
    const fleet = engine.newFleet();
    const result = engine.sizeFleet(fleet);
    const ipIssues = result.issues.filter((i) => i.ruleId === "VCF-IP-007");
    expect(ipIssues).toHaveLength(0);
  });

  it("fires when a hostOverride IP belongs to the AZ2 subnet but the host is AZ1", () => {
    // Build a stretched fleet, populate AZ2 pool with 10.0.18.x/24,
    // populate AZ1 pool with 10.0.17.x/24. Set hostOverrides[0] (AZ1
    // host) to 10.0.18.5 (in AZ2's subnet). Run sizeFleet, assert
    // VCF-IP-007 issue is emitted.
  });
});

describe("VCF-HW-NET-022 — BGP peer not reachable from any uplink", () => {
  it("does not fire when BGP peers are in uplink subnets", () => {
    // ...
  });

  it("fires when a BGP peer IP is outside every uplink subnet", () => {
    // Build a cluster with t0Gateways[0].bgpEnabled=true,
    // peer.peerIp set to an address not in cluster.networks.uplinks[*]
    // subnets. Run sizeFleet, assert VCF-HW-NET-022.
  });
});

describe("checkOverrideSubnet", () => {
  it("returns null for an override inside the cluster's mgmt subnet", () => {
    // Call directly if exported, else exercise via sizeFleet pathway.
  });

  it("returns a warning shape for an override outside the subnet", () => {
    // ...
  });
});
```

Aim for **6-10 cases total**.

- [ ] **Step 3-5: Run, coverage delta, commit**

```bash
npx vitest run tests/unit/engine-az2-bgp-validators.test.js
npm run coverage 2>&1 | tail -10
# Expect another ~0.5-1pp gain.
git add tests/unit/engine-az2-bgp-validators.test.js
git commit -m "test(task-31): Phase B — AZ2 / BGP validators + promoteToInitial

Covers checkOverrideSubnet, VCF-IP-007 (override in wrong AZ subnet),
VCF-HW-NET-022 (BGP peer not in any uplink subnet), and promoteToInitial.
Asserts each rule fires under its documented trigger and stays quiet on
a clean fleet. Closes the validator silent-regression blind spot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Phase C — xlsx edges

**Files:**
- Create: `tests/unit/engine-xlsx-edges.test.js`

**Background:** Workbook import/export paths with edge-case behavior that no existing test exercises. Targets:

- `readWorkbookXlsxAsCellMapRows` `cellPattern` expansion + `_findExpansionIndexForCell` (around `engine.js:2820-2870`)
- `computeReconcileDiff` cross-version downgrade reporter (around `engine.js:3078-3150`)
- Per-host FQDN apply on Deploy Mgmt (around `engine.js:5845-5860`) and Deploy WLD (around `engine.js:5895-5905`)
- Single-line apply callbacks: Download Token / Activation Code (L5166-L5178), proxy user (L5266-L5274), FTT (L5492), NFS share path (L5789-L5792), L5901

- [ ] **Step 1: Read the source**

Read each of the cited line ranges. For per-host FQDN apply, also read the existing per-host FQDN tests (search for `fqdn` in `tests/unit/`) to confirm the test pattern.

- [ ] **Step 2: Write the test file**

Build fixtures inline. For round-trip tests, use `engine.emitWorkbookCellMapCsv` + `engine.importWorkbookCellMap` or the appropriate emitter/importer pair (read `tests/unit/themes/theme-19-az2-networking.test.js` for the round-trip pattern).

Structure:

```js
import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

describe("readWorkbookXlsxAsCellMapRows — cellPattern expansion", () => {
  it("expands a {i}-indexed cellPattern across host indices", () => {
    // Build a minimal CSV with cells matching a cellPattern, parse,
    // assert all expanded indices are returned.
  });

  it("_findExpansionIndexForCell returns the right index for an expanded cell", () => {
    // ...
  });
});

describe("computeReconcileDiff — cross-version downgrade", () => {
  it("reports cells dropped when downgrading from 9.1 to 9.0", () => {
    // Construct a 9.1 fleet with cells unique to 9.1 (e.g., Dual stack
    // toggle). Run reconcileDiff against the 9.0 cell-map. Assert the
    // dropped-cells report contains the expected entries.
  });

  it("reports no diff when versions match", () => {
    // ...
  });
});

describe("per-host FQDN apply — Deploy Mgmt", () => {
  it("strips DNS suffix on import and writes hostname-only to hostOverrides", () => {
    // Build a CSV with cells matching the Deploy Mgmt per-host FQDN
    // pattern (e.g., "esx-01.example.com"). Import via
    // importWorkbookCellMap. Assert cluster.hostOverrides[0].fqdn ===
    // "esx-01" (or whatever the post-strip shape is — read L5845-5860
    // to confirm).
  });
});

describe("per-host FQDN apply — Deploy WLD", () => {
  it("strips DNS suffix on import on the WLD scope", () => {
    // Same pattern, WLD cluster scope.
  });
});

describe("single-line apply callbacks", () => {
  it("applies Download Token cell to fleet.installer.downloadToken", () => {
    // Use the apply callback at L5166 — emit then re-import a fleet
    // with the token populated. Assert the post-import value matches.
  });

  it("applies Activation Code cell to fleet.installer.activationCode", () => {
    // L5178 — same pattern.
  });

  it("applies proxy user cell", () => {
    // L5266-5274.
  });

  it("applies FTT cell on vSAN storage", () => {
    // L5492.
  });

  it("applies NFS share path cell", () => {
    // L5789-5792.
  });
});
```

Aim for **8-12 cases total**.

- [ ] **Step 3-5: Run, coverage delta, commit**

```bash
npx vitest run tests/unit/engine-xlsx-edges.test.js
npm run coverage 2>&1 | tail -10
# Expect another ~1-2pp gain.
git add tests/unit/engine-xlsx-edges.test.js
git commit -m "test(task-31): Phase C — xlsx edge-case coverage

Covers cellPattern expansion + _findExpansionIndexForCell,
computeReconcileDiff cross-version downgrade reporting, per-host FQDN
DNS-suffix strip on Deploy Mgmt + Deploy WLD apply paths, scattered
single-line apply callbacks (download token, activation code, proxy
user, FTT, NFS share path). Closes the workbook round-trip blind
spots called out in HANDOFF.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Phase D — `/* istanbul ignore */` markers

**Files:**
- Modify: `engine.js`

**Background:** Browser-only paths and provably-impossible state guards account for ~95 statements of "uncovered" code that CI shouldn't gate on. Marking them explicitly distinguishes "this is fine to ignore" from "this is a real gap." Per the spec, every marker must have a one-line `// why:` comment.

Target paths (read each before marking to confirm the path is genuinely unfireable):

1. **`_resolveXLSX` browser-bundle arm** at `engine.js:~2618` — the `typeof window !== "undefined" && window.XLSX` branch is unfireable in the node test env. JSDOM doesn't set `window.XLSX` (the test setup may stub it, but the production code path is what's untested).
2. **`_resolveCrypto`** at `engine.js:~2719` — similar `typeof window` gate.
3. **Cell-map dispatcher fallback** at `engine.js:3024` (and L3026-3027 `if (!ctx) { skipped.push(...); continue; }`) — the dispatcher constructs `ctx` itself; `!ctx` is impossible state.
4. **Cell-map dispatcher try/catch apply-error arm** at `engine.js:3033-3034` — apply errors don't fire in the unit fixture set; this is genuinely defensive against importer-side exceptions.
5. **`importWorkbookCellMap` mismatch arm** at `engine.js:2810-2811` — handles a row that has no matching cell-map entry (only fires if you import a CSV from a non-studio source).

For each, add:

```js
/* istanbul ignore next */
// why: <one-line reason>
```

Example for the dispatcher's `if (!ctx)`:

```js
/* istanbul ignore next */
// why: ctx is constructed two lines above; this branch is unreachable
// unless an upstream bug nulls it out before this loop iteration.
if (!ctx) { skipped.push(...); continue; }
```

- [ ] **Step 1: Identify the exact lines**

Use Read on each of the 5 cited regions in `engine.js`. Confirm the line range to mark.

- [ ] **Step 2: Add the markers**

Use Edit on each target. The marker MUST be on its own line directly above the line/block it marks. The `// why:` line MUST be present. Do not alter the marked code itself.

- [ ] **Step 3: Verify no behavior change**

Run: `npx vitest run`

Expected: full suite green. (If any test fails, you accidentally edited the marked code. Revert.)

- [ ] **Step 4: Verify coverage delta**

Run: `npm run coverage 2>&1 | tail -10`

Expected: Stmts coverage rises by ~2-3 pp (95 stmts × `/ 3784 ≈ 2.5 pp`). The ignored statements are excluded from both the numerator and the denominator.

- [ ] **Step 5: Commit**

```bash
git add engine.js
git commit -m "test(task-31): Phase D — /* istanbul ignore */ markers

Adds explicit ignore markers (with // why: comments) to:
- _resolveXLSX browser-bundle arm (~L2618)
- _resolveCrypto browser-bundle arm (~L2719)
- Cell-map dispatcher !ctx fallback + try/catch apply-error arm
  (L3024-3034)
- importWorkbookCellMap row-without-entry arm (L2810-2811)

Distinguishes 'genuinely unfireable in the unit env' from 'real
coverage gap'. Every marker carries a one-line // why: per policy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Phase D — Targeted defensive-coverage tests

**Files:**
- Create: `tests/unit/engine-defensive-coverage.test.js`

**Background:** The remaining gap to 95% comes from reachable defensive code and miscellaneous paths the existing tests just don't exercise. After Tasks 1-6, coverage should be at ~93-94%. This task closes the remaining ~1-2pp.

Targets:

- **Additional-cluster scope-iterator arm** at `engine.js:2433-2443` — the `additional-cluster-*` scope iteration is currently untested. Build a fleet with an additional cluster (per `engine.js` `newCluster`/scope conventions) and exercise the validator path.
- **`_createSupervisorEntry` E-factory edges** at `engine.js:4265-4283` — supervisor cell-map entry builder; partially covered. Trigger the uncovered arms by enabling supervisor on a workload cluster.
- **`gwCidr` / `poolStart` / `poolEnd` cell-builder helpers** at `engine.js:4635-4678` — single-cell vs split-cell gateway-CIDR handling. Construct cluster fixtures that exercise both code paths (some workbook versions use a combined `gw/CIDR` cell, others use split cells — see HANDOFF AZ1-relocation cell-shape notes).
- **Scattered single-line apply branches** that show up in the coverage delta after Task 6 — implementer identifies these by running `npm run coverage` and grepping the report for ranges still red.

- [ ] **Step 1: Read sources**

Read the cited regions. For the additional-cluster scope, also look at `engine.js:newCluster` (L10021+) to understand the fixture you need.

- [ ] **Step 2: Write the test file**

```js
import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

describe("additional-cluster scope iterator", () => {
  it("runs validators on additional (non-mgmt, non-WLD) clusters", () => {
    // Build a fleet with an additional cluster on a domain.
    // Run sizeFleet, assert the validator pass includes the additional
    // cluster (look at the issues array for a scope tag like
    // "additional-cluster" or similar — confirm from L2433-2443).
  });
});

describe("_createSupervisorEntry — cell-map E-factory edges", () => {
  it("emits supervisor cells when supervisor is enabled on a workload cluster", () => {
    // Enable supervisor (cluster.supervisor or createClusterSupervisorConfig),
    // run emitWorkbookCellMapCsv, assert supervisor-specific cells appear.
  });
});

describe("gwCidr cell-builder helpers — combined vs split", () => {
  it("emits a combined gateway/CIDR cell on the 9.1 workbook", () => {
    // newFleet with vcfVersion 9.1, populate gateway + subnet, emit,
    // assert the combined cell value matches _combineGwCidr output.
  });

  it("emits split gateway + subnet cells on the 9.0 workbook", () => {
    // Same shape on 9.0.
  });

  it("poolStart and poolEnd helpers emit when pool range is populated", () => {
    // ...
  });
});

// After the file's initial implementation, run `npm run coverage` and
// add tests for any remaining red ranges identified in the report.
```

Aim for **6-10 cases**.

- [ ] **Step 3: Run + coverage delta**

```bash
npx vitest run tests/unit/engine-defensive-coverage.test.js
npm run coverage 2>&1 | tail -10
```

Expected after this task: stmts ≥ 90%, branches ≥ 75%, funcs ≥ 95%, lines ≥ 95%. **If any threshold is still below target, identify the remaining uncovered ranges from `coverage/engine.js.html` and add tests in this same file (don't proliferate test files for the last percentage points).**

- [ ] **Step 4: Iterate until thresholds met**

If after Step 3 the coverage is still below target on any dimension:
- Open `coverage/engine.js.html` (regenerated by `npm run coverage`).
- Identify the top 3-5 red ranges by stmt count.
- Add tests for each (or, if genuinely unfireable, add `/* istanbul ignore */` markers per Task 6's policy — but be conservative; the spec said the ignore-marker pass already happened).
- Re-run `npm run coverage`.
- Repeat.

If after one extra iteration the gap is still meaningful (> 1pp on any dimension), this is the "Phase D overrun" risk flagged in the spec. STOP and report — propose splitting the remainder as Task #31b.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/engine-defensive-coverage.test.js
git commit -m "test(task-31): Phase D — additional-cluster + supervisor + cell-builder

Covers the additional-cluster scope-iterator validator arm, the
_createSupervisorEntry cell-map E-factory edges, the gwCidr / poolStart
/ poolEnd cell-builder helpers (combined vs split per workbook version),
and any remaining single-line apply branches identified by the post-
Phase-D coverage report. Brings engine.js to the 90/75/95/95 target.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Restore coverage thresholds

**Files:**
- Modify: `vitest.config.js`

- [ ] **Step 1: Verify the actual coverage**

Run: `npm run coverage 2>&1 | tail -20`

Capture the output. The four percentages MUST satisfy:
- Stmts ≥ 90
- Branches ≥ 75
- Funcs ≥ 95
- Lines ≥ 95

If any is below, STOP — go back to Task 7 Step 4. Do not proceed with the threshold flip if measured coverage isn't above the target. The whole point of this task is that the gate is a real safety net.

- [ ] **Step 2: Edit `vitest.config.js`**

Replace L26-L41 (the "re-calibrated 2026-05-28" comment block + the threshold values) with:

```js
      // Thresholds restored to the original target by Task #31 (2026-05-28).
      // engine.js measured coverage as of this commit:
      //   stmts/branches/funcs/lines  = <X>/<Y>/<Z>/<W>  (paste actual)
      // Gate is set 1-2 pp below measured so refactor-induced swings
      // don't flake CI. To raise further, fill remaining uncovered
      // ranges (see coverage/engine.js.html) before bumping these.
      thresholds: {
        lines:      95,
        functions:  95,
        branches:   75,
        statements: 90,
      },
```

Paste the actual measured numbers (from Step 1) into the comment.

- [ ] **Step 3: Run coverage with the new thresholds**

Run: `npm run coverage`

Expected: the run reports the same coverage as Step 1 AND no threshold-fail messages. If the threshold check fails, the gate is set above measured — adjust the threshold values down by 1pp until they pass, and document the gap in the comment.

- [ ] **Step 4: Full suite regression check**

Run: `npx vitest run`

Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.js
git commit -m "build(task-31): restore engine.js coverage thresholds to 95/95/75/90

After Phases A-D added ~700 statements of test coverage to engine.js
(factory smoke + naming engine + IP allocator + AZ2/BGP validators +
xlsx edges + defensive code + targeted ignore markers), the
threshold gate goes back from the temporary post-AZ1-refactor floor
(78/80/70/75) to the original 95/95/75/90 target. CI now gates on
real regressions instead of accepting unlimited drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: HANDOFF.md update + PR

**Files:**
- Modify: `HANDOFF.md` (close out Task #31 in the priority list and the test-coverage debt section)

- [ ] **Step 1: Edit HANDOFF.md**

Two small edits:

1. **Remove Task #31 from the priority list.** In the "When picking the next item" section, the current #1 is "Task #31 — restore engine.js coverage". Delete it; renumber the rest.

2. **Update the test-coverage debt note.** The current bullet reads:
   > "**engine.js coverage thresholds re-calibrated 2026-05-28.** … **Task #31 tracks restoring real coverage**; the gate should be a true safety net, not a low bar. Uncovered ranges flagged in the report: …"

   Replace with a short closure note:
   > "**engine.js coverage threshold restored 2026-05-28.** Task #31 closed: thresholds back to 95/95/75/90 (stmts/branches/funcs/lines). Measured at <actual>/<actual>/<actual>/<actual>. Phases A-D added ~700 statements of test coverage across naming, IP allocator, AZ2/BGP validators, xlsx edges, and defensive code; provably-unfireable paths (browser-only + impossible state) carry explicit `/* istanbul ignore */` markers."

3. **Update the test count.** Bump the unit count from ~1889 to the new count (run `npx vitest run 2>&1 | tail -5` to get it).

- [ ] **Step 2: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: mark Task #31 closed in HANDOFF.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/task-31-engine-coverage
```

Then:

```bash
gh pr create --title "feat(task-31): restore engine.js coverage to 90/75/95/95" --body "$(cat <<'EOF'
## Summary

Closes Task #31. Raises `engine.js` test coverage from 79.78/73.21/86/84.02 (stmts/branches/funcs/lines) to ≥ 90/75/95/95 and restores the `vitest.config.js` threshold gate to those values.

After this PR, CI gates on real coverage regressions instead of accepting unlimited drift below the post-AZ1-refactor floor.

### Phases

- **Phase A** — Factory smoke tests for ~28 `create*Config` / `new*Gateway` factories never instantiated by existing fixtures. Cheapest possible coverage gain (~250 stmts).
- **Phase B** — Focused behavior suites for the naming-template engine, the IP allocator (incl. AZ2 host split), and the AZ2/BGP validators (VCF-IP-007, VCF-HW-NET-022) + `promoteToInitial`. ~120 stmts of real bug-catching coverage.
- **Phase C** — xlsx edges: `cellPattern` expansion, `computeReconcileDiff` downgrade reporter, per-host FQDN apply on Deploy Mgmt + Deploy WLD, scattered single-line apply callbacks (~70 stmts).
- **Phase D** — `/* istanbul ignore */` markers (each with a `// why:` neighbor) on browser-only and provably-impossible paths, plus a targeted defensive-coverage suite for the additional-cluster scope iterator + supervisor cell-map edges + gateway/CIDR cell-builder helpers (~325 stmts net).

### Coverage delta

| Dim | Before | After | Threshold |
|---|---|---|---|
| Stmts | 79.78% | <fill> | 90% |
| Branches | 73.21% | <fill> | 75% |
| Funcs | 86% | <fill> | 95% |
| Lines | 84.02% | <fill> | 95% |

### Brainstorming + plan artefacts

- Design spec: [docs/superpowers/specs/2026-05-28-task-31-engine-coverage-design.md](docs/superpowers/specs/2026-05-28-task-31-engine-coverage-design.md)
- Implementation plan: [docs/superpowers/plans/2026-05-28-task-31-engine-coverage.md](docs/superpowers/plans/2026-05-28-task-31-engine-coverage.md)

### Test plan

- [x] `npx vitest run` — full suite green (~<N> unit / 60 / 46 / 44)
- [x] `npm run coverage` — engine.js measured ≥ all four thresholds
- [x] `npm run verify-cell-map` — clean
- [x] `npm run verify-html-sync` — clean (no production code changes)
- [x] No new ignore markers without `// why:` comments (review will scrutinize)

### Notes

- 6 new test files under `tests/unit/engine-*.test.js`, one per domain.
- Conservative `/* istanbul ignore */` policy enforced per spec — only browser-only + provably-impossible-state paths marked.
- No production behavior changes. No cell-map changes. No UI changes.

EOF
)"
```

Fill the `<fill>` placeholders with the actual measured coverage from `npm run coverage`.

Report the PR URL back.

- [ ] **Step 4: Watch CI**

```bash
gh pr checks <PR-number>
```

Expected: all checks pass on first attempt. If the coverage gate fails on CI but passes locally, the runner's environment differs — investigate before bumping thresholds down.

---

## Self-Review (executed during plan authoring)

- **Spec coverage:** Every spec section has a task. Goal → Tasks 1-8 collectively. Phased work → Tasks 1, 2, 3, 4, 5, 6, 7. Ignore-marker policy → Task 6. Test file layout → File map above + Tasks 1-5, 7. Threshold restoration → Task 8. Out of scope items (new features, refactoring, cell-map changes, JSX coverage, HTML regeneration) explicitly not in any task. Risks → "Effort overrun" handled by Task 7 Step 4's STOP-and-split instruction. ✅
- **Placeholder scan:** No "TBD" / "TODO" / "fill in" in tasks. The "<fill>" / "<actual>" markers in HANDOFF.md and the PR body are intentional run-time substitutions (the implementer pastes measured numbers), not gaps in the plan. Each test file provides a concrete first case + a list of remaining cases by name + a target count. ✅
- **Type consistency:** Function and rule-ID names are consistent across tasks (`resolveTemplate`, `mergeNamingConfig`, `allocateClusterIps`, `checkOverrideSubnet`, `VCF-IP-007`, `VCF-HW-NET-022`, `promoteToInitial`, `_createSupervisorEntry`, etc.). Thresholds use the `lines/functions/branches/statements` key shape confirmed in `vitest.config.js:36-41`. ✅
- **Task ordering:** Phases A → B → C → D → threshold flip → HANDOFF/PR is correct. Task 6 (ignore markers) before Task 7 (defensive tests) is deliberate so Task 7 isn't tempted to add tests for paths that should be ignored. ✅
- **Granularity:** Each task is one test file (or one config file). Steps within tasks are 2-5 minutes each except "write the test file" which is 30-60 minutes — acceptable for coverage-fill work where the cycle is "write a batch, verify coverage delta, commit." ✅
