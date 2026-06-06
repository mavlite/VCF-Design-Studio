# Capability Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scope-aware Capability Tray so the studio opens on the bare-minimum VCF deployment and users reveal optional capabilities (VPC, DR, NSX underlay, Supervisor, Edge, …) by toggling chips per model scope.

**Architecture:** A declarative `CAPABILITY_REGISTRY` in `engine.js` is the single source of truth for what capabilities exist and how each one's enable-state maps to a natural model field (an existing flag, the `placement` enum, or a new `enabled` boolean on a previously-flagless object). Pure reads (`isCapabilityEnabled`, `capabilityHasData`) and an immutable writer (`toggleCapability`) sit on top. A `<CapabilityTray>` React component renders chips per scope and toggles state through the studio's existing immutable `update`/`setFleet` flow; optional panels render only when their capability is enabled.

**Tech Stack:** Plain ES module `engine.js` (no build), React 18 + Tailwind (CDN) in `vcf-design-studio-v9.jsx`, Vitest + Testing Library (JSDOM) for tests, `scripts/build-html.mjs` to regenerate the shipped HTML.

**Spec:** `docs/superpowers/specs/2026-06-02-capability-tray-design.md`. This plan implements **Phase 1 (visibility-only)**: toggling a capability hides/shows its panel(s) and records opt-in state. **Export-gating (§6.4 of the spec) is deferred to Phase 2** (see the final section) because it must live in per-entry `resolve` callbacks, not block-builders.

**Conventions in this repo (read before starting):**
- Immutability is mandatory — never mutate model objects; always spread into new ones.
- After ANY change to `engine.js` or `vcf-design-studio-v9.jsx`, regenerate the HTML: `npm run build-html`, then `npm run verify-html` must pass (the shipped `vcf-design-studio-v9.html` is built from the JS/JSX).
- No Claude/AI attribution in commit messages.
- Engine coverage gate: 95% stmts / 95% branch / 75% funcs / 90% lines (branch is the soft spot — add branch-exercising tests).
- Run a single test file with: `npx vitest run <path>`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `engine.js` | model factories, registry, migration | Modify: add `enabled` flags to 9 factories + 2 scalar flags; add `CAPABILITY_REGISTRY` + helpers; add `backfillCapabilityFlags` + wire into `migrateFleet` |
| `vcf-design-studio-v9.jsx` | UI | Modify: add `<CapabilityTray>`; gate cluster panels; mount trays in the 4 scope cards |
| `tests/unit/capability-registry.test.js` | registry unit tests | Create |
| `tests/unit/capability-migration.test.js` | migration backfill tests | Create |
| `tests/unit/components/capability-tray.test.jsx` | tray component tests | Create |
| `vcf-design-studio-v9.html` | shipped artifact | Regenerated via `npm run build-html` |

---

## Task 1: Add capability `enabled` flags to the model factories

**Files:**
- Modify: `engine.js` (factories at lines 1154, 1182, 1587, 1234, 982, 1545, 10736, 1020, 10791, 10965, 11012)
- Test: `tests/unit/capability-registry.test.js`

The nine "flagless" capability objects each get a new `enabled: false` field, plus two scalar flags (`fleet.vcfOpsEnabled` default `true`, `instance.drEnabled` default `false`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/capability-registry.test.js`:

```js
import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

const {
  createFleetAdConfig, createFleetBackupConfig, createFleetInstallerConfig,
  createEdgeCluster, createClusterNsxHostOverlay, createClusterVpcConfig,
  baseStorageDataServices, createClusterPortgroups, baseClusterAdvanced,
  newFleet, newInstance,
} = engine;

describe("capability enabled flags — factory defaults", () => {
  it("flagless capability objects default enabled:false", () => {
    expect(createFleetAdConfig().enabled).toBe(false);
    expect(createFleetBackupConfig().enabled).toBe(false);
    expect(createFleetInstallerConfig().enabled).toBe(false);
    expect(createEdgeCluster().enabled).toBe(false);
    expect(createClusterNsxHostOverlay().enabled).toBe(false);
    expect(createClusterVpcConfig().enabled).toBe(false);
    expect(baseStorageDataServices().enabled).toBe(false);
    expect(createClusterPortgroups().enabled).toBe(false);
    expect(baseClusterAdvanced().enabled).toBe(false);
  });

  it("ops defaults on (appliances ship today); dr defaults off", () => {
    expect(newFleet().vcfOpsEnabled).toBe(true);
    expect(newInstance("i", ["s1"]).drEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/capability-registry.test.js`
Expected: FAIL — `expected undefined to be false` (fields don't exist yet). Also verify the listed factories are exported; if any is not in the `module.exports`/`export` block, add it alongside the others (search the file's export list near the bottom).

- [ ] **Step 3: Add `enabled: false` to each flagless factory**

In `engine.js`, add the field as the FIRST property of each return object:

`createFleetInstallerConfig` (line 1155): add `enabled: false,` as first field after `{`.
`createFleetBackupConfig` (line 1183): add `enabled: false,` as first field.
`createFleetAdConfig` (line 1588): add `enabled: false,` as first field (before the `adFqdn` comment block).
`createEdgeCluster` (line 1235): add `enabled: false,` as first field (before `name: ""`).
`createClusterNsxHostOverlay` (line 983): add `enabled: false,` as first field.
`createClusterVpcConfig` (line 1546): add `enabled: false,` as first field (before `networkConnectivity`).
`baseStorageDataServices` (line 10737): add `enabled: false,` as first field (before `ftt: 1`).
`createClusterPortgroups` (line 1021): add `enabled: false,` as first field (before `mgmt:`). NOTE: this object is also iterated as a slot map elsewhere; the registry's `hasData` (Task 3) skips the `enabled` key, and any existing slot iteration that does `for (key in portgroups)` must skip a non-object value — verify by grep `for .*portgroups` and `Object.keys(.*portgroups`; if a loop assumes every value is a slot object, guard it with `if (key === "enabled") continue;`.
`baseClusterAdvanced` (line 10792): add `enabled: false,` as first field (before `evcSetting`).

Example (installer):

```js
function createFleetInstallerConfig() {
  return {
    enabled: false,
    depotType: "online",
    // …rest unchanged
```

- [ ] **Step 4: Add the two scalar flags**

In `newInstance` (line 10965 return object), add after `drPairedInstanceId: null,` (line 10993):

```js
    drPairedInstanceId: null,
    // Capability Tray — opt-in DR/Warm-Standby reveal. Default off; reveals
    // the drPosture + drPairedInstanceId controls. migrateFleet backfills to
    // true when drPosture !== "active" or a pairing is set.
    drEnabled: false,
    domains: [mgmt],
```

In `newFleet` (line 11012 return object), add after the `federationConfig:` line (line 11097), before `sites:`:

```js
    federationConfig: createFleetFederationConfig(),
    // Capability Tray — VCF Ops/Automation panel visibility. Defaults true
    // because the Ops/Automation appliances ship in the stack today; Phase 1
    // gates only the panel, not the appliances (see the capability-tray spec §7).
    vcfOpsEnabled: true,
    sites: [primary],
```

- [ ] **Step 5: Run the test and make sure it passes**

Run: `npx vitest run tests/unit/capability-registry.test.js`
Expected: PASS (both tests).

- [ ] **Step 6: Guard the portgroups slot iteration if needed, then run the snapshot suite**

Run: `npm run test:snapshot`
Expected: PASS. If a snapshot changed because `enabled` now appears in serialized model output, that is expected — update the snapshot with `npx vitest run tests/snapshot -u` and eyeball the diff to confirm it ONLY adds `enabled` keys.

- [ ] **Step 7: Commit**

```bash
git add engine.js tests/unit/capability-registry.test.js
git commit -m "feat(capability-tray): add enabled flags to capability factories"
```

---

## Task 2: `CAPABILITY_REGISTRY` + pure read helpers

**Files:**
- Modify: `engine.js` (add a new section after the validators; export the new symbols)
- Test: `tests/unit/capability-registry.test.js`

The registry declares each capability and how to read its enable-state and detect data. Reads are pure; writes come in Task 4.

- [ ] **Step 1: Write the failing test (append to the registry test file)**

```js
describe("CAPABILITY_REGISTRY + reads", () => {
  const { CAPABILITY_REGISTRY, capabilitiesForScope, isCapabilityEnabled,
          capabilityHasData, newFleet } = engine;

  it("declares the expected keys per scope", () => {
    const keys = CAPABILITY_REGISTRY.map((c) => c.key).sort();
    expect(keys).toEqual([
      "adsso","advanced","backup","dataservices","dr","edge","federation",
      "installer","ops","overlay","portgroups","stretched","supervisor","tiering","vpc",
    ].sort());
    expect(capabilitiesForScope("cluster").map((c) => c.key).sort()).toEqual([
      "advanced","dataservices","edge","overlay","portgroups","supervisor","tiering","vpc",
    ].sort());
  });

  it("isCapabilityEnabled reads the underlying field", () => {
    const fleet = newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(isCapabilityEnabled("edge", { cluster })).toBe(false);
    cluster.edgeCluster.enabled = true;
    expect(isCapabilityEnabled("edge", { cluster })).toBe(true);
    // existing-flag capability
    expect(isCapabilityEnabled("supervisor", { cluster })).toBe(false);
    cluster.supervisorConfig.enabled = true;
    expect(isCapabilityEnabled("supervisor", { cluster })).toBe(true);
    // enum capability
    const domain = fleet.instances[0].domains[0];
    domain.placement = "local";
    expect(isCapabilityEnabled("stretched", { domain })).toBe(false);
    domain.placement = "stretched";
    expect(isCapabilityEnabled("stretched", { domain })).toBe(true);
    // ops default-on
    expect(isCapabilityEnabled("ops", { fleet })).toBe(true);
  });

  it("capabilityHasData detects deviation from factory defaults", () => {
    const fleet = newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(capabilityHasData("edge", { cluster })).toBe(false);
    cluster.edgeCluster.nodes[0].fqdn = "en01.lab.local";
    expect(capabilityHasData("edge", { cluster })).toBe(true);

    expect(capabilityHasData("advanced", { cluster })).toBe(false);
    cluster.advanced.evcSetting = "Intel Cascade Lake";
    expect(capabilityHasData("advanced", { cluster })).toBe(true);

    expect(capabilityHasData("dataservices", { cluster })).toBe(false);
    cluster.storage.dataServices.dit.enabled = false; // dit toggle must NOT count as data
    expect(capabilityHasData("dataservices", { cluster })).toBe(false);
    cluster.storage.dataServices.datastoreName = "ds-01";
    expect(capabilityHasData("dataservices", { cluster })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/capability-registry.test.js`
Expected: FAIL — `CAPABILITY_REGISTRY` is undefined.

- [ ] **Step 3: Implement the registry**

In `engine.js`, AFTER the validator section (search for the end of `validateFleetInvariants` / `validateT0Gateways`; place this before the module export block), add:

```js
// ─────────────────────────────────────────────────────────────────────────
// Capability Tray (progressive disclosure). The registry is the single source
// of truth for what optional capabilities exist and how each one's enable-state
// maps to a natural model field. Reads are pure; writes go through
// toggleCapability (returns a new object, never mutates). See
// docs/superpowers/specs/2026-06-02-capability-tray-design.md.
//
// ctx is { fleet?, instance?, domain?, cluster? } — only the scope object the
// capability lives on is required.

// Helper: a capability backed by a boolean `enabled` field on an object reached
// from ctx via `obj(ctx)`. `has` is the data-presence predicate.
function _flagCap(key, scope, group, label, obj, has) {
  return {
    key, scope, group, label,
    isEnabled: (ctx) => { const o = obj(ctx); return !!(o && o.enabled); },
    apply: (scopeObj, on, ctx) => _setEnabledImmutable(obj, scopeObj, on, ctx),
    hasData: (ctx) => { const o = obj(ctx); return !!o && has(o, ctx); },
  };
}

// Build a new copy of the scope object with the capability's `enabled` set.
// `obj(ctx)` must return a sub-object of the scope object (or the scope object
// itself). We rebuild only along that path, leaving siblings shared.
function _setEnabledImmutable(obj, scopeObj, on, ctxForRead) {
  // For the flag capabilities the target object is reachable by a known path
  // from the scope object; each entry supplies its own path via `obj`. We
  // re-resolve against a shallow clone so the write is immutable.
  return obj.__set ? obj.__set(scopeObj, on) : scopeObj;
}

// Path-based accessor pair: getter reads from ctx; __set returns a new scope obj.
function _path(getFromCtx, setOnScope) {
  const fn = (ctx) => getFromCtx(ctx);
  fn.__set = setOnScope;
  return fn;
}

const _nonEmpty = (v) => v != null && v !== "";
const _anyNonEmpty = (o, keys) => keys.some((k) => _nonEmpty(o[k]));

const CAPABILITY_REGISTRY = [
  // ── Fleet ────────────────────────────────────────────────────────────
  _flagCap("adsso", "fleet", "Identity", "Identity / AD + SSO",
    _path((c) => c.fleet && c.fleet.adConfig,
          (f, on) => ({ ...f, adConfig: { ...f.adConfig, enabled: on } })),
    (o, ctx) => _anyNonEmpty(o, ["adFqdn","adUser","serviceAccountUser"]) ||
                (ctx.fleet && ctx.fleet.ssoMode && ctx.fleet.ssoMode !== "embedded")),
  _flagCap("backup", "fleet", "Services", "Backup (SFTP)",
    _path((c) => c.fleet && c.fleet.backupConfig,
          (f, on) => ({ ...f, backupConfig: { ...f.backupConfig, enabled: on } })),
    (o) => _anyNonEmpty(o, ["host","user","directory","sshFingerprint"])),
  _flagCap("installer", "fleet", "Services", "Installer / Depot",
    _path((c) => c.fleet && c.fleet.installerConfig,
          (f, on) => ({ ...f, installerConfig: { ...f.installerConfig, enabled: on } })),
    (o) => o.depotType === "offline" || _anyNonEmpty(o, ["offlineDepotHostname","downloadToken","activationCode","proxyHost"]) || o.proxyEnabled === true),
  {
    key: "federation", scope: "fleet", group: "Networking", label: "NSX Federation",
    isEnabled: (ctx) => !!(ctx.fleet && ctx.fleet.federationEnabled),
    apply: (fleet, on) => ({ ...fleet, federationEnabled: on }),
    hasData: (ctx) => !!(ctx.fleet && ctx.fleet.federationEnabled),
  },
  {
    key: "ops", scope: "fleet", group: "Services", label: "VCF Ops / Automation",
    isEnabled: (ctx) => ctx.fleet ? ctx.fleet.vcfOpsEnabled !== false : false,
    apply: (fleet, on) => ({ ...fleet, vcfOpsEnabled: on }),
    hasData: () => true, // phase 1: always migrates on; never the disable-warn path
  },
  // ── Instance ─────────────────────────────────────────────────────────
  {
    key: "dr", scope: "instance", group: "Resilience", label: "DR / Warm-Standby",
    isEnabled: (ctx) => !!(ctx.instance && ctx.instance.drEnabled),
    apply: (inst, on) => ({ ...inst, drEnabled: on }),
    hasData: (ctx) => !!ctx.instance &&
      (ctx.instance.drPosture !== "active" || ctx.instance.drPairedInstanceId != null),
  },
  // ── Domain (enum-encoded) ────────────────────────────────────────────
  {
    key: "stretched", scope: "domain", group: "Topology", label: "Stretched / AZ2",
    isEnabled: (ctx) => !!(ctx.domain && ctx.domain.placement === "stretched"),
    apply: (domain, on, ctx) => on
      ? { ...domain, placement: "stretched",
          stretchSiteIds: (domain.stretchSiteIds && domain.stretchSiteIds.length === 2)
            ? domain.stretchSiteIds
            : ((ctx && ctx.instance && ctx.instance.siteIds) || []).slice(0, 2),
          localSiteId: null }
      : { ...domain, placement: "local",
          localSiteId: domain.localSiteId ||
            ((ctx && ctx.instance && ctx.instance.siteIds && ctx.instance.siteIds[0]) || null),
          stretchSiteIds: null },
    hasData: (ctx) => !!(ctx.domain && ctx.domain.placement === "stretched"),
  },
  // ── Cluster ──────────────────────────────────────────────────────────
  _flagCap("edge", "cluster", "Networking", "NSX Edge + T0/BGP",
    _path((c) => c.cluster && c.cluster.edgeCluster,
          (cl, on) => ({ ...cl, edgeCluster: { ...cl.edgeCluster, enabled: on } })),
    (o) => _nonEmpty(o.name) ||
           (o.nodes || []).some((n) => _anyNonEmpty(n, ["fqdn","mgmtIpCidr","hostGroup"]) ||
                                        (n.tepIps || []).some(_nonEmpty))),
  _flagCap("overlay", "cluster", "Networking", "NSX Host Overlay",
    _path((c) => c.cluster && c.cluster.networks && c.cluster.networks.nsxHostOverlay,
          (cl, on) => ({ ...cl, networks: { ...cl.networks,
            nsxHostOverlay: { ...cl.networks.nsxHostOverlay, enabled: on } } })),
    (o) => _anyNonEmpty(o, ["vlan","transportZoneName","vlanTransportZoneName","poolName","cidr"])),
  {
    key: "supervisor", scope: "cluster", group: "Platform", label: "vSphere Supervisor (VKS)",
    isEnabled: (ctx) => !!(ctx.cluster && ctx.cluster.supervisorConfig && ctx.cluster.supervisorConfig.enabled),
    apply: (cl, on) => ({ ...cl, supervisorConfig: { ...cl.supervisorConfig, enabled: on } }),
    hasData: (ctx) => !!(ctx.cluster && ctx.cluster.supervisorConfig && ctx.cluster.supervisorConfig.enabled),
  },
  _flagCap("vpc", "cluster", "Networking", "VPC / Transit Gateway",
    _path((c) => c.cluster && c.cluster.vpcConfig,
          (cl, on) => ({ ...cl, vpcConfig: { ...cl.vpcConfig, enabled: on } })),
    (o) => (o.networkConnectivity && o.networkConnectivity !== "Centralized Connectivity") ||
           _nonEmpty(o.externalPool && o.externalPool.poolName) ||
           _nonEmpty(o.tgwPool && o.tgwPool.poolName)),
  {
    key: "tiering", scope: "cluster", group: "Storage", label: "NVMe Tiering",
    isEnabled: (ctx) => !!(ctx.cluster && ctx.cluster.tiering && ctx.cluster.tiering.enabled),
    apply: (cl, on) => ({ ...cl, tiering: { ...cl.tiering, enabled: on } }),
    hasData: (ctx) => !!(ctx.cluster && ctx.cluster.tiering && ctx.cluster.tiering.enabled),
  },
  _flagCap("dataservices", "cluster", "Storage", "vSAN Data Services",
    _path((c) => c.cluster && c.cluster.storage && c.cluster.storage.dataServices,
          (cl, on) => ({ ...cl, storage: { ...cl.storage,
            dataServices: { ...cl.storage.dataServices, enabled: on } } })),
    (o) => o.dedupCompressionEnabled === true || _nonEmpty(o.datastoreName) ||
           _nonEmpty(o.nfs && o.nfs.sharePath) || _nonEmpty(o.nfs && o.nfs.serverIp)),
  _flagCap("portgroups", "cluster", "Networking", "Custom Port-groups",
    _path((c) => c.cluster && c.cluster.networks && c.cluster.networks.portgroups,
          (cl, on) => ({ ...cl, networks: { ...cl.networks,
            portgroups: { ...cl.networks.portgroups, enabled: on } } })),
    (o) => Object.keys(o).some((k) => k !== "enabled" && o[k] &&
            typeof o[k] === "object" && _anyNonEmpty(o[k], ["name","vlan"]))),
  _flagCap("advanced", "cluster", "Advanced", "Advanced (EVC / naming)",
    _path((c) => c.cluster && c.cluster.advanced,
          (cl, on) => ({ ...cl, advanced: { ...cl.advanced, enabled: on } })),
    (o) => _nonEmpty(o.evcSetting) || _nonEmpty(o.nodeNamePrefix) ||
           (o.internalClusterCidr && o.internalClusterCidr !== "198.18.0.0/15")),
];

const _CAP_BY_KEY = CAPABILITY_REGISTRY.reduce((m, c) => { m[c.key] = c; return m; }, {});

function capabilitiesForScope(scope) {
  return CAPABILITY_REGISTRY.filter((c) => c.scope === scope);
}
function isCapabilityEnabled(key, ctx) {
  const c = _CAP_BY_KEY[key];
  return c ? c.isEnabled(ctx || {}) : false;
}
function capabilityHasData(key, ctx) {
  const c = _CAP_BY_KEY[key];
  return c ? c.hasData(ctx || {}) : false;
}
```

- [ ] **Step 4: Export the new symbols**

Find the export block at the bottom of `engine.js` (search for where `validateFleetInvariants` or `newFleet` is exported — it is either a `module.exports = { … }` or a trailing `export { … }`). Add: `CAPABILITY_REGISTRY, capabilitiesForScope, isCapabilityEnabled, capabilityHasData, toggleCapability` (the last is added in Task 4 — add the name now and it will resolve once Task 4 lands; if the test in this task errors on the missing `toggleCapability` export, omit it here and add it in Task 4). Also ensure the factories referenced by tests are exported (from Task 1).

- [ ] **Step 5: Run the test and make sure it passes**

Run: `npx vitest run tests/unit/capability-registry.test.js`
Expected: PASS (all `describe` blocks).

- [ ] **Step 6: Commit**

```bash
git add engine.js tests/unit/capability-registry.test.js
git commit -m "feat(capability-tray): add CAPABILITY_REGISTRY and pure read helpers"
```

---

## Task 3: `toggleCapability` — immutable writer

**Files:**
- Modify: `engine.js`
- Test: `tests/unit/capability-registry.test.js`

`toggleCapability(key, scopeObj, on, ctx)` returns a NEW scope object (the fleet/instance/domain/cluster the capability lives on) with the flag flipped — never mutating the input. The caller wires it into the studio's existing immutable `update`.

- [ ] **Step 1: Write the failing test (append)**

```js
describe("toggleCapability — immutable writes", () => {
  const { toggleCapability, isCapabilityEnabled, newFleet } = engine;

  it("returns a new cluster with the flag flipped, input unchanged", () => {
    const cluster = newFleet().instances[0].domains[0].clusters[0];
    const next = toggleCapability("edge", cluster, true, { cluster });
    expect(next).not.toBe(cluster);
    expect(cluster.edgeCluster.enabled).toBe(false);     // input untouched
    expect(next.edgeCluster.enabled).toBe(true);
    expect(isCapabilityEnabled("edge", { cluster: next })).toBe(true);
  });

  it("preserves sibling data on disable (non-destructive)", () => {
    const cluster = newFleet().instances[0].domains[0].clusters[0];
    cluster.edgeCluster.enabled = true;
    cluster.edgeCluster.name = "edge-01";
    const off = toggleCapability("edge", cluster, false, { cluster });
    expect(off.edgeCluster.enabled).toBe(false);
    expect(off.edgeCluster.name).toBe("edge-01");        // data kept
  });

  it("stretched toggle flips placement and seeds stretchSiteIds", () => {
    const fleet = newFleet();
    const instance = fleet.instances[0];
    instance.siteIds = ["s1", "s2"];
    const domain = instance.domains[0];
    domain.placement = "local";
    const on = toggleCapability("stretched", domain, true, { instance, domain });
    expect(on.placement).toBe("stretched");
    expect(on.stretchSiteIds).toEqual(["s1", "s2"]);
    const off = toggleCapability("stretched", on, false, { instance, domain: on });
    expect(off.placement).toBe("local");
    expect(off.stretchSiteIds).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/capability-registry.test.js`
Expected: FAIL — `toggleCapability is not a function`.

- [ ] **Step 3: Implement `toggleCapability`**

Add in `engine.js` immediately after `capabilityHasData`:

```js
// Immutable writer: returns a NEW scope object with the capability toggled.
// scopeObj is the object the capability's apply() expects (fleet for fleet
// caps, instance for instance caps, domain for domain caps, cluster for
// cluster caps). Never mutates scopeObj.
function toggleCapability(key, scopeObj, on, ctx) {
  const c = _CAP_BY_KEY[key];
  if (!c) return scopeObj;
  return c.apply(scopeObj, !!on, ctx || {});
}
```

Confirm `_flagCap`'s `apply` delegates correctly: it calls `_setEnabledImmutable(obj, scopeObj, on, ctx)` which returns `obj.__set(scopeObj, on)`. Since every `_path(...)` getter carries a `__set`, this returns the new scope object. (The `ctxForRead` arg is unused for flag caps and can be ignored.)

- [ ] **Step 4: Run the test and make sure it passes**

Run: `npx vitest run tests/unit/capability-registry.test.js`
Expected: PASS.

- [ ] **Step 5: Add `toggleCapability` to the export block** (if not already added in Task 2 Step 4).

- [ ] **Step 6: Commit**

```bash
git add engine.js tests/unit/capability-registry.test.js
git commit -m "feat(capability-tray): add toggleCapability immutable writer"
```

---

## Task 4: Migration backfill (`backfillCapabilityFlags`)

**Files:**
- Modify: `engine.js` (new function + wire into `migrateFleet` before `return migratedFleet;` at line 12189)
- Test: `tests/unit/capability-migration.test.js`

Imported/legacy fleets that pre-date the flags get them backfilled: a new `enabled` flag is set to `true` when the object already holds data (so configured panels stay visible); `vcfOpsEnabled` defaults `true`; `drEnabled` derives from DR posture.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/capability-migration.test.js`:

```js
import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";
const { migrateFleet, newFleet } = engine;

describe("capability flag backfill in migrateFleet", () => {
  it("pristine import: optional caps off, ops on", () => {
    const f = newFleet();
    // simulate a legacy import lacking the new flags
    const cluster = f.instances[0].domains[0].clusters[0];
    delete cluster.edgeCluster.enabled;
    delete cluster.vpcConfig.enabled;
    delete f.vcfOpsEnabled;
    delete f.instances[0].drEnabled;
    const m = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    const mc = m.instances[0].domains[0].clusters[0];
    expect(mc.edgeCluster.enabled).toBe(false);
    expect(mc.vpcConfig.enabled).toBe(false);
    expect(m.vcfOpsEnabled).toBe(true);
    expect(m.instances[0].drEnabled).toBe(false);
  });

  it("backfills enabled:true when the object already has data", () => {
    const f = newFleet();
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.edgeCluster.name = "edge-01";
    delete cluster.edgeCluster.enabled;
    const m = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    expect(m.instances[0].domains[0].clusters[0].edgeCluster.enabled).toBe(true);
  });

  it("derives drEnabled from warm-standby posture", () => {
    const f = newFleet();
    f.instances[0].drPosture = "warm-standby";
    delete f.instances[0].drEnabled;
    const m = migrateFleet({ version: "vcf-sizer-v9", fleet: f });
    expect(m.instances[0].drEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/capability-migration.test.js`
Expected: FAIL — e.g. `expected true to be false` or `undefined` (no backfill yet; `delete`d flags stay undefined).

- [ ] **Step 3: Implement `backfillCapabilityFlags`**

Add in `engine.js` after `toggleCapability`:

```js
// migrateFleet helper: ensure every capability flag exists on an imported
// fleet. New `enabled` flags default to the object's data-presence (so a
// configured-but-unflagged import keeps its panels). Scalar flags get their
// canonical defaults. Mutates the passed fleet in place — migrateFleet owns a
// fresh object by the time this runs.
function backfillCapabilityFlags(fleet) {
  if (!fleet || typeof fleet !== "object") return fleet;
  if (typeof fleet.vcfOpsEnabled !== "boolean") fleet.vcfOpsEnabled = true;
  if (typeof fleet.federationEnabled !== "boolean") fleet.federationEnabled = false;
  const ensure = (obj, ctx, key) => {
    if (!obj || typeof obj !== "object") return;
    if (typeof obj.enabled !== "boolean") obj.enabled = capabilityHasData(key, ctx);
  };
  ensure(fleet.adConfig, { fleet }, "adsso");
  ensure(fleet.backupConfig, { fleet }, "backup");
  ensure(fleet.installerConfig, { fleet }, "installer");
  for (const instance of fleet.instances || []) {
    if (typeof instance.drEnabled !== "boolean") {
      instance.drEnabled = capabilityHasData("dr", { instance });
    }
    for (const domain of instance.domains || []) {
      for (const cluster of domain.clusters || []) {
        ensure(cluster.edgeCluster, { cluster }, "edge");
        ensure(cluster.vpcConfig, { cluster }, "vpc");
        ensure(cluster.advanced, { cluster }, "advanced");
        if (cluster.networks) {
          ensure(cluster.networks.nsxHostOverlay, { cluster }, "overlay");
          ensure(cluster.networks.portgroups, { cluster }, "portgroups");
        }
        if (cluster.storage) ensure(cluster.storage.dataServices, { cluster }, "dataservices");
      }
    }
  }
  return fleet;
}
```

- [ ] **Step 4: Wire it into `migrateFleet`**

In `engine.js`, find `return migratedFleet;` (line ~12189). Insert immediately before it:

```js
    backfillCapabilityFlags(migratedFleet);
    return migratedFleet;
```

- [ ] **Step 5: Run the test and make sure it passes**

Run: `npx vitest run tests/unit/capability-migration.test.js`
Expected: PASS.

- [ ] **Step 6: Run the migration + snapshot suites**

Run: `npm run test:migration && npm run test:snapshot`
Expected: PASS. If snapshots changed (new `enabled` keys), update with `npx vitest run tests/snapshot -u` and confirm the diff only adds `enabled`/`drEnabled`/`vcfOpsEnabled`.

- [ ] **Step 7: Commit**

```bash
git add engine.js tests/unit/capability-migration.test.js tests/snapshot
git commit -m "feat(capability-tray): backfill capability flags on migrate"
```

---

## Task 5: `<CapabilityTray>` component

**Files:**
- Modify: `vcf-design-studio-v9.jsx` (add the component near the other small presentational components — search for `function Section(` and add `CapabilityTray` just above it)
- Test: `tests/unit/components/capability-tray.test.jsx`

A presentational chip row for one scope. It does NOT own state — it calls `onToggle(key, on)` and reads enable-state from the engine helpers. The disable-with-data confirm lives here.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/capability-tray.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CapabilityTray } from "../../../vcf-design-studio-v9.jsx";
import * as engine from "../../../engine.js";

const clusterCtx = () => {
  const cluster = engine.newFleet().instances[0].domains[0].clusters[0];
  return { cluster };
};

describe("CapabilityTray", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("renders a chip per cluster capability with core chips", () => {
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={["Host & Sizing","Storage (vSAN)"]} onToggle={() => {}} />);
    expect(screen.getByText("NSX Edge + T0/BGP")).toBeInTheDocument();
    expect(screen.getByText("vSphere Supervisor (VKS)")).toBeInTheDocument();
    expect(screen.getByText("Host & Sizing")).toBeInTheDocument();
  });

  it("toggles an off capability on without confirm", () => {
    const onToggle = vi.fn();
    render(<CapabilityTray scope="cluster" ctx={clusterCtx()} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("NSX Edge + T0/BGP"));
    expect(onToggle).toHaveBeenCalledWith("edge", true);
  });

  it("confirms before disabling a capability that has data", () => {
    const ctx = clusterCtx();
    ctx.cluster.edgeCluster.enabled = true;
    ctx.cluster.edgeCluster.name = "edge-01"; // has data
    const onToggle = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CapabilityTray scope="cluster" ctx={ctx} coreLabels={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("NSX Edge + T0/BGP"));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled(); // user cancelled
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/components/capability-tray.test.jsx`
Expected: FAIL — `CapabilityTray` is not exported / undefined.

- [ ] **Step 3: Implement the component**

In `vcf-design-studio-v9.jsx`, add above `function Section(`:

```jsx
// Capability Tray (progressive disclosure). One chip row for a single scope.
// Grey = always-on core (informational). Teal = enabled. Outline = available.
// Stateless: reads enable-state from the engine, emits onToggle(key, on).
function CapabilityTray({ scope, ctx, coreLabels = [], onToggle }) {
  const caps = capabilitiesForScope(scope);
  if (caps.length === 0 && coreLabels.length === 0) return null;
  const handle = (cap) => {
    const on = isCapabilityEnabled(cap.key, ctx);
    if (on && capabilityHasData(cap.key, ctx)) {
      const msg = `${cap.label} has configuration. Hiding the panel keeps the data. Continue?`;
      if (!window.confirm(msg)) return;
    }
    onToggle(cap.key, !on);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      {coreLabels.map((lbl) => (
        <span key={lbl} className="font-mono text-[10.5px] px-2 py-0.5 rounded bg-slate-200 text-slate-600 border border-slate-200">
          {lbl}
        </span>
      ))}
      {caps.map((cap) => {
        const on = isCapabilityEnabled(cap.key, ctx);
        return (
          <button
            key={cap.key}
            type="button"
            aria-pressed={on}
            onClick={() => handle(cap)}
            className={
              "font-mono text-[10.5px] px-2 py-0.5 rounded border transition-colors " +
              (on
                ? "bg-teal-600 text-white border-teal-600"
                : "bg-white text-slate-500 border-slate-300 hover:border-indigo-400")
            }
          >
            {on ? "✓ " : ""}{cap.label}
          </button>
        );
      })}
    </div>
  );
}
```

The helpers `capabilitiesForScope`, `isCapabilityEnabled`, `capabilityHasData` come from `engine.js`. Confirm they are in scope in the JSX: search the top of `vcf-design-studio-v9.jsx` for how engine symbols are imported (e.g. a destructure from a global `Engine`/`window` or an `import`). Add the four names (`capabilitiesForScope`, `isCapabilityEnabled`, `capabilityHasData`, `toggleCapability`) to that same import/destructure so they resolve at runtime AND in the build.

Also ensure `CapabilityTray` is exported for the test — the JSX exposes components for tests somewhere (search for an existing `export` of a component, or a `module.exports`/`export {` block near the bottom). Add `CapabilityTray` (and you'll add the scope cards already exist) to it. If the file uses no exports and tests import via a build shim, follow the pattern used by `tests/unit/components/m1.3-t0-uplinks-panel.test.jsx` (read that file first to copy its import mechanism).

- [ ] **Step 4: Run the test and make sure it passes**

Run: `npx vitest run tests/unit/components/capability-tray.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Regenerate HTML + verify**

Run: `npm run build-html && npm run verify-html`
Expected: both succeed (HTML back in sync).

- [ ] **Step 6: Commit**

```bash
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html tests/unit/components/capability-tray.test.jsx
git commit -m "feat(capability-tray): add CapabilityTray component"
```

---

## Task 6: Mount the tray in the Cluster card + gate cluster panels

**Files:**
- Modify: `vcf-design-studio-v9.jsx` (ClusterCard panel block at lines 2139-2145; locate the ClusterCard's `update` function and `cluster`/`isMgmtCluster` props)
- Test: extend `tests/unit/components/capability-tray.test.jsx` if the ClusterCard is independently renderable; otherwise this task is verified via build + manual smoke (documented below).

Gate the five always-rendered optional cluster panels behind the registry and add the cluster tray above them. Toggling goes through the existing `update` (immutable).

- [ ] **Step 1: Read the ClusterCard context**

Read `vcf-design-studio-v9.jsx` lines 2000-2150 to confirm: the `update` prop signature (it is `update(nextCluster)` or `update(fn)`), the `cluster` variable, `isMgmtCluster`, and whether a `ctx` (with instance/domain) is available. The cluster capability reads only need `{ cluster }`.

- [ ] **Step 2: Add the tray + gate the panels**

Replace the block at lines 2139-2145:

```jsx
          <EdgeClusterPanel cluster={cluster} update={update} />
          <AZ2HostOverlayPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          <PortgroupsPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          <NsxHostOverlayPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          <SupervisorConfigPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          <VpcConfigPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          <ClusterNamingOverridesPanel cluster={cluster} update={update} fleet={fleet} />
```

with:

```jsx
          <CapabilityTray
            scope="cluster"
            ctx={{ cluster }}
            coreLabels={["Host & Sizing", "Storage (vSAN)", "Networking", "Appliance Stack"]}
            onToggle={(key, on) => update(toggleCapability(key, cluster, on, { cluster }))}
          />
          {isCapabilityEnabled("edge", { cluster }) && (
            <EdgeClusterPanel cluster={cluster} update={update} />
          )}
          <AZ2HostOverlayPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          {isCapabilityEnabled("portgroups", { cluster }) && (
            <PortgroupsPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          )}
          {isCapabilityEnabled("overlay", { cluster }) && (
            <NsxHostOverlayPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          )}
          {isCapabilityEnabled("supervisor", { cluster }) && (
            <SupervisorConfigPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          )}
          {isCapabilityEnabled("vpc", { cluster }) && (
            <VpcConfigPanel cluster={cluster} update={update} isMgmtCluster={isMgmtCluster} />
          )}
          <ClusterNamingOverridesPanel cluster={cluster} update={update} fleet={fleet} />
```

Notes:
- If `update` is `update(fn)` (takes an updater) rather than `update(nextCluster)`, adapt the `onToggle` to `update((prev) => toggleCapability(key, prev, on, { cluster: prev }))`. Confirm from Step 1 which signature ClusterCard uses and match it.
- `AZ2HostOverlayPanel` stays ungated here — it is already gated by `domain.placement === "stretched"` inside the panel and belongs to the Domain `stretched` capability (Task 7), not a cluster chip.
- `tiering`, `dataservices`, and `advanced` panels: locate their JSX (grep for the tiering panel — search `tiering` in the JSX, the data-services panel, and the advanced/EVC panel). Gate each the same way with `isCapabilityEnabled("tiering"|"dataservices"|"advanced", { cluster }) && (...)`. If any currently renders inside a `<Section>` already conditioned on something else, wrap the existing element, preserving that inner condition.

- [ ] **Step 3: Verify build + existing cluster component tests still pass**

Run: `npm run build-html && npm run verify-html && npx vitest run tests/unit/components`
Expected: build in sync; component tests PASS. Pre-existing panel tests that rendered the gated panels directly still pass (they render the panel components, not the ClusterCard).

- [ ] **Step 4: Smoke-test the gating with a focused test (append to capability-tray.test.jsx)**

If ClusterCard is exported/renderable, add a test that renders it with a pristine cluster and asserts `screen.queryByText(/NSX Edge Cluster/)` (the EdgeClusterPanel's heading — confirm the exact heading string by reading EdgeClusterPanel) is absent, then re-render with `cluster.edgeCluster.enabled = true` and assert it is present. If ClusterCard is NOT independently renderable (needs heavy parent context), SKIP this step and note in the commit that gating is build-verified + covered by Task 5's tray tests; do not fake a test.

- [ ] **Step 5: Commit**

```bash
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html tests/unit/components/capability-tray.test.jsx
git commit -m "feat(capability-tray): gate cluster panels behind the tray"
```

---

## Task 7: Mount trays in Fleet / Instance / Domain scopes

**Files:**
- Modify: `vcf-design-studio-v9.jsx`
- Test: build + verify; targeted component test only where a scope card is independently renderable.

Add the tray to the remaining three scopes and gate their optional panels.

- [ ] **Step 1: Locate each scope's card + optional panels**

Read these anchors and the surrounding render functions:
- **Fleet:** the Fleet Summary / fleet-services area. The Federation toggle is at `vcf-design-studio-v9.jsx:9001-9002` (`fleet.federationEnabled`). The AD/Backup/Installer/Ops panels render in the fleet summary section — grep for the components that render `adConfig`, `backupConfig`, `installerConfig` (search `backupConfig`, `adConfig`, `installerConfig` in the JSX) to find their panels and the fleet `setFleet`/`update` in scope.
- **Instance:** the instance card/header. DR controls are at `vcf-design-studio-v9.jsx:4429-4443` (grep `drPosture` / `drPairedInstanceId`).
- **Domain:** the domain card. The stretched toggle/checkbox is at `vcf-design-studio-v9.jsx:3865` (`checked={domain.placement === "stretched"}`) and `:1602`.

- [ ] **Step 2: Fleet tray + gating**

In the fleet-services render area, add above the fleet capability panels:

```jsx
          <CapabilityTray
            scope="fleet"
            ctx={{ fleet }}
            coreLabels={["DNS / NTP", "Naming", "Report Metadata"]}
            onToggle={(key, on) => setFleet(toggleCapability(key, fleet, on, { fleet }))}
          />
```

(Use whatever the in-scope fleet setter is — `setFleet` or `update`. Match the existing call style in that render function.) Then gate each fleet capability panel:
- Wrap the AD/SSO panel: `{isCapabilityEnabled("adsso", { fleet }) && (<…AD panel…/>)}`
- Wrap Backup: `{isCapabilityEnabled("backup", { fleet }) && (…)}`
- Wrap Installer/Depot: `{isCapabilityEnabled("installer", { fleet }) && (…)}`
- Wrap VCF Ops/Automation panel: `{isCapabilityEnabled("ops", { fleet }) && (…)}`
- Federation: the existing UI at 9001 toggles `federationEnabled` directly. Leave that control as-is OR replace it with the tray chip; to avoid two controls for one flag, wrap the federation detail panel with `{isCapabilityEnabled("federation", { fleet }) && (…)}` and remove the now-redundant standalone checkbox at 9001-9002 (the chip is the new control). Confirm no other logic depends on that checkbox before removing; if unsure, keep both (they read/write the same flag and stay consistent).

- [ ] **Step 3: Instance tray + gating**

In the instance card render, add:

```jsx
          <CapabilityTray
            scope="instance"
            ctx={{ instance }}
            coreLabels={[]}
            onToggle={(key, on) => updateInstance(toggleCapability(key, instance, on, { instance }))}
          />
```

(Match the in-scope instance setter name.) Gate the DR controls block (4429-4443) with `{isCapabilityEnabled("dr", { instance }) && (…DR controls…)}`.

- [ ] **Step 4: Domain tray + gating**

In the domain card render, add:

```jsx
          <CapabilityTray
            scope="domain"
            ctx={{ instance, domain }}
            coreLabels={[]}
            onToggle={(key, on) => updateDomain(toggleCapability(key, domain, on, { instance, domain }))}
          />
```

The `stretched` chip replaces the placement checkbox at 3865 as the canonical control — but the existing checkbox also drives `stretchSiteIds` reconciliation logic nearby. SAFEST: keep the existing stretched checkbox/logic intact AND add the chip (both read/write `placement` + seed `stretchSiteIds` consistently via `toggleCapability`). Verify the chip's `apply` (Task 3) matches the checkbox's existing seeding behavior; if the checkbox does extra reconciliation (e.g. `hostSplitPct`), prefer leaving the checkbox as the control and DROP `stretched` from the domain tray to avoid divergence — note this decision in the commit. (The tray still renders for future domain capabilities.)

- [ ] **Step 5: Build + full verify**

Run: `npm run build-html && npm run verify-html && npx vitest run tests/unit`
Expected: in sync; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add vcf-design-studio-v9.jsx vcf-design-studio-v9.html
git commit -m "feat(capability-tray): mount trays in fleet/instance/domain scopes"
```

---

## Task 8: Full suite, coverage, and snapshot reconciliation

**Files:** none new — verification only.

- [ ] **Step 1: Run the full test command**

Run: `npm test`
Expected: PASS. This runs verify-html, verify-cell-map, unit, migration, snapshot, invariants. `verify-cell-map` MUST stay green (we added no cells).

- [ ] **Step 2: Coverage check**

Run: `npm run coverage`
Expected: engine.js ≥ 95/95/75/90. If branch coverage dipped below 95 because of the registry's `&&`/`||` chains, add focused tests to `tests/unit/capability-registry.test.js` exercising the false branches of each `hasData` predicate (e.g. an object with a non-default value in each field). Re-run until green.

- [ ] **Step 3: Manual smoke (document result in commit body)**

Open `vcf-design-studio-v9.html` in a browser. Confirm:
- A fresh design shows NO edge/vpc/overlay/supervisor panels on the mgmt cluster; the cluster tray shows them as outline chips.
- Clicking "NSX Edge + T0/BGP" reveals the Edge panel and turns the chip teal.
- Entering an edge name, then clicking the chip off, prompts the confirm; cancelling keeps the panel; confirming hides it but the name persists when re-enabled.

- [ ] **Step 4: Commit (if coverage tests were added)**

```bash
git add tests/unit/capability-registry.test.js
git commit -m "test(capability-tray): branch coverage for hasData predicates"
```

---

## Phase 2 (deferred — NOT in this plan): export-gating

The spec's §6.4 ("off → not in the exported workbook") requires gating in each
cell-map entry's `resolve` callback (return the empty value when
`isCapabilityEnabled(key, { …, cluster }) === false`), because the block-builders
(`_edgeAllocationEntries`, `_vpcPoolBlockEntries`, `_portgroupSlotEntries`,
`_nsxHostOverlayBlockEntries`, advanced/EVC entries) DEFINE entries once rather
than running per-cluster. This touches many resolvers and must preserve the M2.1
round-trip (the `dataservices`/`ops` exceptions stay visibility-only). It is a
separate spec + plan. Phase 1 above is visibility-only: a disabled capability
hides its panel; its data still exports exactly as today.

---

## Self-Review notes
- **Spec coverage:** §3 taxonomy → Task 5/6/7 chips; §4 registry → Task 2; §4(c) flags → Task 1; §5 hasData/migration → Task 3/4; §6.2 component → Task 5; §6.3 gating → Task 6/7; §8 non-destructive confirm → Task 5; §9 migration → Task 4; §10 testing → every task. §6.4 export-gating → explicitly deferred to Phase 2 (documented above + flagged to the user).
- **Naming consistency:** `isCapabilityEnabled`, `capabilityHasData`, `capabilitiesForScope`, `toggleCapability`, `CAPABILITY_REGISTRY`, `backfillCapabilityFlags`, `CapabilityTray` — used identically across tasks.
- **Immutability:** all writes go through `toggleCapability` returning new objects; UI composes them with existing `update`/`setFleet`.
