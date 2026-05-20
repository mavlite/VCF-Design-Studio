import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  APPLIANCE_DB,
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  cryptoKey,
  sizeInstance,
  validatePlacementConstraints,
  placementOptionsFor,
  migrateFleet,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plans 4 + 1 + 2 + 5 + 3 — composed end-to-end behavior
//
// This file exercises all five workload-domain-management plans operating
// together on a single fleet, verifying the contracts hold under composed
// scenarios that no single plan's tests cover in isolation.
// ─────────────────────────────────────────────────────────────────────────────

function entry(id, opts = {}) {
  return {
    id,
    size: opts.size ?? APPLIANCE_DB[id].defaultSize,
    instances: opts.instances ?? 1,
    key: cryptoKey(),
    role: opts.role ?? "wld",
    placementClusterId: opts.placementClusterId ?? null,
    ownerDomainId: opts.ownerDomainId ?? "owner",
  };
}

function buildFleetWithMixedPlacement() {
  const fleet = newFleet();
  const inst = fleet.instances[0];
  const mgmt = inst.domains.find((d) => d.type === "mgmt");
  const wld = newWorkloadDomain("Production WLD");
  inst.domains.push(wld);
  return { fleet, inst, mgmt, wld };
}

describe("Integration — VCF-INV-003 fires only for the right combinations", () => {
  it("greenfield WLD with vCenter on mgmt + Edge on WLD → 0 violations (correct design)", () => {
    const { fleet, mgmt, wld } = buildFleetWithMixedPlacement();
    wld.componentsClusterId = mgmt.clusters[0].id;
    wld.wldStack = [
      entry("vcenter"),
      entry("nsxMgr", { instances: 3 }),
      entry("nsxEdge", { instances: 2, placementClusterId: wld.clusters[0].id }),
    ];
    expect(validatePlacementConstraints(fleet)).toEqual([]);
  });

  it("greenfield WLD with vCenter pinned to WLD via per-entry override → 1 violation", () => {
    const { fleet, mgmt, wld } = buildFleetWithMixedPlacement();
    wld.componentsClusterId = mgmt.clusters[0].id;
    wld.wldStack = [
      entry("vcenter", { placementClusterId: wld.clusters[0].id }),
      entry("nsxMgr", { instances: 3 }),
    ];
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("VCF-INV-003");
  });

  it("toggling imported=true clears the violation (Plan 4 brownfield exception)", () => {
    const { fleet, mgmt, wld } = buildFleetWithMixedPlacement();
    wld.componentsClusterId = mgmt.clusters[0].id;
    wld.wldStack = [entry("vcenter", { placementClusterId: wld.clusters[0].id })];
    expect(validatePlacementConstraints(fleet)).toHaveLength(1);
    wld.imported = true;
    expect(validatePlacementConstraints(fleet)).toEqual([]);
  });

  it("aviServiceEngine on a WLD cluster never triggers VCF-INV-003 (wld-only by design)", () => {
    const { fleet, wld } = buildFleetWithMixedPlacement();
    wld.componentsClusterId = wld.clusters[0].id;
    wld.imported = true; // controllers are mgmt-only-greenfield, exempt via brownfield
    wld.wldStack = [
      entry("aviController"),
      entry("aviServiceEngine", { instances: 2, placementClusterId: wld.clusters[0].id }),
    ];
    expect(validatePlacementConstraints(fleet)).toEqual([]);
  });
});

describe("Integration — placementOptionsFor + per-entry resolution + sizing", () => {
  it("per-entry placementClusterId routes appliance demand to the right cluster", () => {
    const { fleet, inst, mgmt, wld } = buildFleetWithMixedPlacement();
    wld.componentsClusterId = mgmt.clusters[0].id;

    // Baseline: empty stacks, capture per-cluster host counts.
    const baselineHosts = sizeInstance(inst).domainResults.map((dr) =>
      dr.clusterResults.map((cr) => cr.finalHosts)
    );

    wld.wldStack = [
      entry("vcenter", { size: "XLarge", instances: 3 }),                            // → mgmt cluster (default)
      entry("nsxEdge", { size: "XLarge", instances: 8, placementClusterId: wld.clusters[0].id }), // → wld cluster (override)
    ];
    const withStack = sizeInstance(inst).domainResults.map((dr) =>
      dr.clusterResults.map((cr) => cr.finalHosts)
    );

    // Mgmt cluster host count rises (vCenter demand injected).
    expect(withStack[0][0]).toBeGreaterThan(baselineHosts[0][0]);
    // WLD cluster host count rises (Edge demand injected).
    expect(withStack[1][0]).toBeGreaterThan(baselineHosts[1][0]);
  });

  it("placementOptionsFor returns mgmt-only for vCenter in greenfield, both in brownfield", () => {
    const mgmtClu = [{ id: "m1", label: "Mgmt" }];
    const wldClu = [{ id: "w1", label: "WLD" }];
    const greenfield = placementOptionsFor("vcenter", { isImportedDomain: false, mgmtClusters: mgmtClu, wldClusters: wldClu });
    const brownfield = placementOptionsFor("vcenter", { isImportedDomain: true, mgmtClusters: mgmtClu, wldClusters: wldClu });
    expect(greenfield.map((o) => o.scope)).toEqual(["mgmt"]);
    expect(brownfield.map((o) => o.scope)).toEqual(["mgmt", "wld"]);
  });
});

describe("Integration — migration auto-detect + Plan 5 validator + Plan 4 fix", () => {
  it("legacy fleet with WLD-cluster placement → migration auto-flags imported → validator clean", () => {
    // Synthesize a legacy fleet shape: workload domain with componentsClusterId
    // pointing at its own cluster (only legal under the old permissive model).
    const fleet = newFleet();
    const wld = newWorkloadDomain("Legacy WLD");
    delete wld.imported;                                  // legacy data has no imported field
    wld.componentsClusterId = wld.clusters[0].id;
    wld.wldStack = [
      { id: "vcenter", size: "Medium", instances: 1, key: "k1", role: "wld", ownerDomainId: wld.id },
    ];
    fleet.instances[0].domains.push(wld);

    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);

    // Plan 4 — auto-detect flagged it as imported.
    expect(wldOut.imported).toBe(true);
    // Plan 6 — transient banner marker is present.
    expect(migrated._migrated?.autoImportedDomains?.[0].id).toBe(wld.id);
    // Plan 5 — validator now sees the imported flag and does NOT fire.
    expect(validatePlacementConstraints(migrated)).toEqual([]);
  });
});

describe("Integration — Plan 3 Avi split + Plan 5 validator + Plan 1 routing", () => {
  it("legacy aviLb on WLD → migrates to aviController + aviServiceEngine, validator clean for SE on wld", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD with Legacy Avi");
    wld.imported = true;                                  // brownfield, so Controller can stay where pre-existing was
    wld.wldStack = [
      { id: "aviLb", size: "Small", instances: 3, key: "k-avi", role: "wld", ownerDomainId: wld.id },
    ];
    fleet.instances[0].domains.push(wld);

    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);

    // Plan 3 — aviLb rewritten to aviController, aviServiceEngine appended.
    expect(wldOut.wldStack.find((e) => e.id === "aviController")).toBeTruthy();
    expect(wldOut.wldStack.find((e) => e.id === "aviServiceEngine")).toBeTruthy();
    // Validator clean (imported domain).
    expect(validatePlacementConstraints(migrated)).toEqual([]);
  });

  it("greenfield aviController on WLD cluster (per-entry override) → validator fires", () => {
    const { fleet, mgmt, wld } = buildFleetWithMixedPlacement();
    wld.componentsClusterId = mgmt.clusters[0].id;
    wld.wldStack = [
      entry("aviController", { placementClusterId: wld.clusters[0].id }),
    ];
    const issues = validatePlacementConstraints(fleet);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("VCF-INV-003");
  });
});

describe("Integration — full lifecycle: import legacy → fix violations → re-export → re-import", () => {
  it("a legacy fleet survives migrate → modify → migrate again with consistent state", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("WLD");
    delete wld.imported;
    wld.componentsClusterId = wld.clusters[0].id;
    wld.wldStack = [
      { id: "vcenter", size: "Medium", instances: 1, key: "kv", role: "wld", ownerDomainId: wld.id },
    ];
    fleet.instances[0].domains.push(wld);

    // 1st migration — auto-detect fires.
    const once = migrateFleet({ version: "vcf-sizer-v9", fleet });
    expect(once._migrated).toBeDefined();

    // User reviews and decides this should be greenfield instead — toggle off
    // imported and move components back to mgmt cluster.
    const onceWld = once.instances[0].domains.find((d) => d.id === wld.id);
    const onceMgmt = once.instances[0].domains.find((d) => d.type === "mgmt");
    onceWld.imported = false;
    onceWld.componentsClusterId = onceMgmt.clusters[0].id;

    // Validator now flags the vCenter entry (still has stale placementClusterId).
    // Per-entry override is null for this entry, so the resolved target is the
    // domain default (now mgmt) → no violation.
    expect(validatePlacementConstraints(once)).toEqual([]);

    // 2nd migration round-trip — no new auto-detect, no transient marker.
    const twice = migrateFleet({ version: "vcf-sizer-v9", fleet: once });
    expect(twice._migrated).toBeUndefined();
    const twiceWld = twice.instances[0].domains.find((d) => d.id === wld.id);
    expect(twiceWld.imported).toBe(false);
    expect(validatePlacementConstraints(twice)).toEqual([]);
  });
});
