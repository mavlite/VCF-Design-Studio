import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { effectiveStack, VCF_OPS_APPLIANCE_IDS, newFleet, newInstance, newSite, sizeFleet, buildDefaultPlacement, ensurePlacement, validateFleetInvariants, stackForInstance } = VcfEngine;

// Accessors into the real sizeFleet result shape:
// sizeFleet → { instanceResults[0] → { domainResults[0] → { clusterResults[0].finalHosts },
//                                       sharedTotals: { vcpu, ram, disk } } }
const path = (r) => r.instanceResults[0].domainResults[0].clusterResults[0].finalHosts;
const shared = (r) => r.instanceResults[0].sharedTotals;

describe("effectiveStack", () => {
  const stack = [
    { id: "vcenter", size: "Medium", instances: 1, key: "k1" },
    { id: "vcfOps", size: "Medium", instances: 3, key: "k2" },
    { id: "vcfAuto", size: "Small", instances: 1, key: "k3" },
    { id: "fleetMgr", size: "Small", instances: 1, key: "k4" },
  ];
  it("is identity (same reference) when Ops on (true/undefined)", () => {
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

describe("sizing excludes Ops when off", () => {
  it("Ops off reduces (or equals) host count and never increases it", () => {
    const fleet = newFleet();
    fleet.vcfOpsEnabled = true;
    const onHosts = path(sizeFleet(fleet));
    fleet.vcfOpsEnabled = false;
    const offHosts = path(sizeFleet(fleet));
    expect(offHosts).toBeLessThanOrEqual(onHosts);
  });
  it("Ops off drops Ops appliances from the shared appliance demand", () => {
    const fleet = newFleet();
    fleet.vcfOpsEnabled = true;
    const on = shared(sizeFleet(fleet));
    fleet.vcfOpsEnabled = false;
    const off = shared(sizeFleet(fleet));
    expect(off.vcpu).toBeLessThan(on.vcpu);
    expect(off.ram).toBeLessThan(on.ram);
  });
  it("Ops on (default) identical to not setting the flag", () => {
    // Use the SAME fleet to avoid id-generation divergence between newFleet() calls.
    // Delete vcfOpsEnabled so the flag is absent (simulates pre-Phase-3 stored data),
    // then set it explicitly to true — both must produce identical sizing numbers.
    const fleet = newFleet();
    delete fleet.vcfOpsEnabled;
    const noFlag = sizeFleet(fleet);
    fleet.vcfOpsEnabled = true;
    const onFlag = sizeFleet(fleet);
    expect(path(onFlag)).toBe(path(noFlag));
    expect(shared(onFlag).vcpu).toBe(shared(noFlag).vcpu);
    expect(shared(onFlag).ram).toBe(shared(noFlag).ram);
    expect(shared(onFlag).disk).toBe(shared(noFlag).disk);
  });
});

describe("placement excludes Ops when off", () => {
  it("Ops-off placement has no keys for Ops appliance entries", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    inst.siteIds = ["s1", "s2"]; // placement only computes for multi-site
    const mgmtClu = inst.domains[0].clusters[0];
    const opsKeys = (mgmtClu.infraStack || [])
      .filter((e) => VCF_OPS_APPLIANCE_IDS.includes(e.id)).map((e) => e.key);
    expect(opsKeys.length).toBeGreaterThan(0); // default stack has Ops entries
    const placement = buildDefaultPlacement(inst, false);
    for (const k of opsKeys) expect(placement[k]).toBeUndefined();
  });
  it("Ops-on placement includes Ops appliance keys (default behavior)", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    inst.siteIds = ["s1", "s2"];
    const mgmtClu = inst.domains[0].clusters[0];
    const opsKey = (mgmtClu.infraStack || []).find((e) => VCF_OPS_APPLIANCE_IDS.includes(e.id))?.key;
    expect(opsKey).toBeDefined();
    const placement = buildDefaultPlacement(inst, true);
    expect(placement[opsKey]).toBeDefined();
  });
});

describe("validation allows Ops absent when off", () => {
  // Build a two-instance fleet so INV-012 (per non-initial instance collector
  // check) is exercised. The second instance carries the non-initial profile
  // stack (no per-fleet appliances) to avoid spurious INV-010/INV-011 noise
  // from fleetMgr duplication.
  function twoInstanceFleet() {
    const fleet = newFleet();
    const siteId = fleet.sites[0].id;
    const inst2 = newInstance("vcf-instance-02", [siteId]);
    // Replace the auto-generated (initial) stack with the non-initial variant
    // so per-fleet appliances like fleetMgr don't appear twice.
    const nonInitStack = stackForInstance("ha", false, fleet.vcfVersion);
    inst2.domains[0].clusters[0].infraStack = nonInitStack.map((e) => ({ ...e, key: e.id + "-i2" }));
    fleet.instances.push(inst2);
    return fleet;
  }
  // Strip all Ops/Automation appliances from every cluster's infraStack.
  function removeOps(fleet) {
    for (const inst of fleet.instances)
      for (const dom of inst.domains)
        for (const clu of dom.clusters)
          clu.infraStack = (clu.infraStack || []).filter((e) => !VCF_OPS_APPLIANCE_IDS.includes(e.id));
    return fleet;
  }
  // Match issues related to Ops/Automation appliances being absent/required.
  // Uses precise label tokens to avoid false positives from non-Ops per-fleet
  // appliances (e.g. "VCF Operations Fleet Manager" / fleetMgr).
  // Covers INV-012 ("must deploy a VCF Operations Collector"),
  //        INV-050 ("missing required management appliance(s): VCF Operations...")
  function isOpsValidationIssue(i) {
    const s = (i.message || "") + " " + (i.ruleId || "") + " " + (i.code || "") + " " + (i.rule || "");
    return /\bvcfOps\b|\bvcfAuto\b|VCF Operations Collector|VCF Operations for|VCF Automation|\bVCF Operations\b(?! Fleet)/i.test(s) &&
           /must deploy|missing|exactly once|per-fleet|absent|required/i.test(s);
  }

  it("Ops off + Ops appliances absent → no Ops-related validation error", () => {
    const fleet = removeOps(twoInstanceFleet());
    fleet.vcfOpsEnabled = false;
    const issues = validateFleetInvariants(fleet);
    const opsMissing = issues.filter(isOpsValidationIssue);
    expect(opsMissing).toEqual([]);
  });

  it("Ops ON + Ops appliances absent → INV-012/INV-050 still fires for missing Ops (regression guard)", () => {
    const fleet = removeOps(twoInstanceFleet());
    fleet.vcfOpsEnabled = true;
    const issues = validateFleetInvariants(fleet);
    const opsMissing = issues.filter(isOpsValidationIssue);
    expect(opsMissing.length).toBeGreaterThan(0);
  });
});
