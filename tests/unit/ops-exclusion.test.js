import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { effectiveStack, VCF_OPS_APPLIANCE_IDS, newFleet, sizeFleet, buildDefaultPlacement, ensurePlacement } = VcfEngine;

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
    const placement = buildDefaultPlacement(inst, true);
    expect(placement[opsKey]).toBeDefined();
  });
});
