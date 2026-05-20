import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  cryptoKey,
  sizeInstance,
  migrateFleet,
} = VcfEngine;

// ─────────────────────────────────────────────────────────────────────────────
// Plan 1 — per-appliance placementClusterId on stack entries
//
// Each wldStack entry can carry its own placementClusterId. NSX Edge can
// pin to a workload-domain cluster while vCenter / NSX Manager remain on
// the mgmt cluster. The engine resolves entry placement in this order:
//   1. entry.placementClusterId
//   2. domain.componentsClusterId
//   3. mgmt domain's first cluster
// Each step falls through if its id doesn't resolve to a real cluster.
// ─────────────────────────────────────────────────────────────────────────────

function buildInstanceWithMgmtAndOneWld() {
  const fleet = newFleet();
  const inst = fleet.instances[0];
  const mgmt = inst.domains.find((d) => d.type === "mgmt");
  const wld = newWorkloadDomain("WLD");
  wld.componentsClusterId = mgmt.clusters[0].id;
  inst.domains.push(wld);
  return { fleet, inst, mgmt, wld };
}

function entry(id, opts = {}) {
  return {
    id,
    size: opts.size ?? "Medium",
    instances: opts.instances ?? 1,
    key: cryptoKey(),
    role: opts.role ?? "wld",
    placementClusterId: opts.placementClusterId ?? null,
    ownerDomainId: opts.ownerDomainId ?? "owner",
  };
}

// Sum host count across both domains for a given target cluster id.
function hostsForCluster(result, clusterId) {
  for (const dr of result.domainResults) {
    for (let i = 0; i < dr.clusterResults.length; i++) {
      const cr = dr.clusterResults[i];
      // Cluster ids aren't on cluster results directly, so we walk the
      // owning domain's cluster list to find the matching one.
    }
  }
  return null;
}

// Helper: extract per-cluster finalHosts keyed by cluster.id by walking the
// instance + domain result in parallel.
function hostMapByClusterId(instance, instanceResult) {
  const map = {};
  for (let dIdx = 0; dIdx < instance.domains.length; dIdx++) {
    const dom = instance.domains[dIdx];
    const dr = instanceResult.domainResults[dIdx];
    for (let cIdx = 0; cIdx < dom.clusters.length; cIdx++) {
      map[dom.clusters[cIdx].id] = dr.clusterResults[cIdx].finalHosts;
    }
  }
  return map;
}

describe("VCF-APP-003/005 / Plan 1 — per-entry placementClusterId resolution", () => {
  it("entry with placementClusterId === null follows domain default", () => {
    const { inst, mgmt, wld } = buildInstanceWithMgmtAndOneWld();
    // Baseline: empty wldStack, capture mgmt cluster host count.
    const baselineHosts = hostMapByClusterId(inst, sizeInstance(inst));
    // Add a vCenter entry with placementClusterId=null.
    wld.wldStack = [entry("vcenter", { size: "XLarge", instances: 3 })];
    const withEntry = hostMapByClusterId(inst, sizeInstance(inst));
    // Mgmt cluster host count should rise (vCenter demand injected here);
    // WLD cluster host count should be unchanged.
    expect(withEntry[mgmt.clusters[0].id]).toBeGreaterThanOrEqual(baselineHosts[mgmt.clusters[0].id]);
    expect(withEntry[wld.clusters[0].id]).toBe(baselineHosts[wld.clusters[0].id]);
  });

  it("entry with placementClusterId pointing at a WLD cluster injects there, not on mgmt", () => {
    const { inst, mgmt, wld } = buildInstanceWithMgmtAndOneWld();
    const baseline = hostMapByClusterId(inst, sizeInstance(inst));
    // NSX Edge pinned to WLD cluster (Edge's data plane lives with workloads).
    wld.wldStack = [entry("nsxEdge", { size: "XLarge", instances: 8, placementClusterId: wld.clusters[0].id })];
    const withEntry = hostMapByClusterId(inst, sizeInstance(inst));
    // WLD cluster host count should rise; mgmt cluster should be unchanged.
    expect(withEntry[wld.clusters[0].id]).toBeGreaterThan(baseline[wld.clusters[0].id]);
    expect(withEntry[mgmt.clusters[0].id]).toBe(baseline[mgmt.clusters[0].id]);
  });

  it("mixed placement: vCenter on mgmt cluster, NSX Edge on WLD cluster", () => {
    const { inst, mgmt, wld } = buildInstanceWithMgmtAndOneWld();
    const baseline = hostMapByClusterId(inst, sizeInstance(inst));
    wld.wldStack = [
      entry("vcenter", { size: "XLarge", instances: 3 }),
      entry("nsxEdge", { size: "XLarge", instances: 8, placementClusterId: wld.clusters[0].id }),
    ];
    const withEntries = hostMapByClusterId(inst, sizeInstance(inst));
    // BOTH clusters should rise — vCenter on mgmt, Edge on WLD.
    expect(withEntries[mgmt.clusters[0].id]).toBeGreaterThan(baseline[mgmt.clusters[0].id]);
    expect(withEntries[wld.clusters[0].id]).toBeGreaterThan(baseline[wld.clusters[0].id]);
  });

  it("entry with stale placementClusterId falls back to domain default (mgmt)", () => {
    const { inst, mgmt, wld } = buildInstanceWithMgmtAndOneWld();
    const baseline = hostMapByClusterId(inst, sizeInstance(inst));
    // Stale id → resolution falls through to dom.componentsClusterId (mgmt).
    wld.wldStack = [entry("vcenter", { size: "XLarge", instances: 3, placementClusterId: "clu-DOES-NOT-EXIST" })];
    const withEntry = hostMapByClusterId(inst, sizeInstance(inst));
    expect(withEntry[mgmt.clusters[0].id]).toBeGreaterThanOrEqual(baseline[mgmt.clusters[0].id]);
    expect(withEntry[wld.clusters[0].id]).toBe(baseline[wld.clusters[0].id]);
  });

  it("entry with stale placementClusterId AND missing domain default falls back to mgmt first cluster", () => {
    const { inst, mgmt, wld } = buildInstanceWithMgmtAndOneWld();
    wld.componentsClusterId = "clu-MISSING";
    wld.wldStack = [entry("vcenter", { placementClusterId: "clu-ALSO-MISSING" })];
    // Should not throw and should produce a sensible result.
    const result = sizeInstance(inst);
    expect(result.totalHosts).toBeGreaterThan(0);
  });

  it("each entry contributes to sharedTotals exactly once regardless of routing", () => {
    const { inst, wld } = buildInstanceWithMgmtAndOneWld();
    const wldClu = wld.clusters[0];
    wld.wldStack = [
      entry("vcenter", { instances: 1, size: "Medium" }),
      entry("nsxEdge", { instances: 2, size: "Large", placementClusterId: wldClu.id }),
    ];
    const result = sizeInstance(inst);
    // Count distinct entries in sharedStack from the wldStack we added (by key).
    const myKeys = wld.wldStack.map((e) => e.key);
    const sharedFromWld = result.sharedStack.filter((e) => myKeys.includes(e.key));
    expect(sharedFromWld).toHaveLength(2);
  });
});

describe("Plan 1 — placementClusterId is preserved on round-trip", () => {
  it("migrateFleet preserves placementClusterId on existing entries", () => {
    const { fleet, wld } = buildInstanceWithMgmtAndOneWld();
    const wldClu = wld.clusters[0];
    wld.wldStack = [entry("nsxEdge", { placementClusterId: wldClu.id })];
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    expect(wldOut.wldStack[0].placementClusterId).toBe(wldClu.id);
  });

  it("legacy entries without placementClusterId stay null after migration", () => {
    const { fleet, wld } = buildInstanceWithMgmtAndOneWld();
    wld.wldStack = [{ id: "vcenter", size: "Medium", instances: 1, key: "k1", role: "wld" }];
    const migrated = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const wldOut = migrated.instances[0].domains.find((d) => d.id === wld.id);
    const stored = wldOut.wldStack[0].placementClusterId;
    // null OR undefined both behave identically in resolution.
    expect(stored == null).toBe(true);
  });

  it("migration is idempotent when placementClusterId is set", () => {
    const { fleet, wld } = buildInstanceWithMgmtAndOneWld();
    wld.wldStack = [entry("nsxEdge", { placementClusterId: wld.clusters[0].id })];
    const once = migrateFleet({ version: "vcf-sizer-v9", fleet });
    const twice = migrateFleet({ version: "vcf-sizer-v9", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
