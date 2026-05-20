// Integration tests for VCF version support (Plan 12, PR 2).
// Exercises the full sizeFleet pipeline with vcfVersion threading, the
// scope:"per-fleet" invariant on multi-instance fleets, the .map(sizeInstance)
// lambda fix (multi-instance 9.1 sizing), profile re-apply, and version-aware
// storage profile crossings.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newInstance,
  newSite,
  sizeFleet,
  migrate9_0To9_1,
  stackForInstance,
  promoteToInitial,
  APPLIANCE_DB,
} = VcfEngine;

// Build a 3-instance 9.1 fleet. Used to catch the .map(sizeInstance) lambda
// bug — a bare .map silently passes (element, index, array) so vcfVersion
// would default to the legacy value on instances 1+.
function buildThreeInstance91Fleet() {
  const fleet = newFleet();
  fleet.vcfVersion = "9.1";
  // Add two more sites + instances.
  for (let i = 2; i <= 3; i++) {
    const site = newSite(`Site ${i}`, "");
    fleet.sites.push(site);
    const inst = newInstance(`inst-${i}`, [site.id]);
    fleet.instances.push(inst);
  }
  return fleet;
}

describe("sizeFleet — vcfVersion threading", () => {
  it("9.1 fleet produces lower vCenter disk demand than 9.0 fleet (Medium default)", () => {
    const fleet90 = newFleet();
    fleet90.vcfVersion = "9.0";
    // Strip VCFMS so the comparison is purely about vCenter storage delta.
    for (const inst of fleet90.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          clu.infraStack = (clu.infraStack || []).filter(
            (e) => e.id !== "vcfmsControl" && e.id !== "vcfmsWorker"
          );
        }
      }
    }
    const fleet91 = newFleet();
    fleet91.vcfVersion = "9.1";
    for (const inst of fleet91.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          clu.infraStack = (clu.infraStack || []).filter(
            (e) => e.id !== "vcfmsControl" && e.id !== "vcfmsWorker"
          );
        }
      }
    }
    const r90 = sizeFleet(fleet90);
    const r91 = sizeFleet(fleet91);
    // 9.1 vCenter Medium default is 858 GB vs 9.0's 908 GB → fleet disk demand drops.
    // totals.diskGb is the cross-instance aggregate.
    expect(r91.totals.diskGb).toBeLessThan(r90.totals.diskGb);
  });

  it("3-instance 9.1 fleet: every instance reflects 9.1 vCenter sizing (catches .map lambda bug)", () => {
    const fleet = buildThreeInstance91Fleet();
    const result = sizeFleet(fleet);
    // sharedTotals on each instanceResult aggregates appliance demand for
    // that instance. If the .map lambda is missing, instances 1+ would
    // size their stacks with vcfVersion=0/undefined (falls back to legacy
    // 9.0) and use vCenter 908 GB instead of 9.1's 858 GB.
    const expectedVcenterDisk = APPLIANCE_DB.vcenter.sizesByVersion["9.1"].Medium.storage.default;
    const baselineVcenterDisk = APPLIANCE_DB.vcenter.sizes.Medium.storage.default;
    expect(expectedVcenterDisk).toBe(858);
    expect(baselineVcenterDisk).toBe(908);

    // Instance 0 has VCFMS (scope:per-fleet), instances 1/2 do not — so
    // instance 0 demand will be HIGHER (more storage). 1 and 2 should match
    // each other (both lack VCFMS, both use 9.1 vCenter). If the lambda bug
    // were present, instances 1/2 would use 9.0 vCenter and their disk would
    // be HIGHER than expected, but they would still match each other — so
    // this asserts the per-instance count is the 9.1-sized expectation by
    // comparing against a known stack total.
    const r0 = result.instanceResults[0].sharedTotals.disk;
    const r1 = result.instanceResults[1].sharedTotals.disk;
    const r2 = result.instanceResults[2].sharedTotals.disk;
    expect(r1).toBe(r2);
    expect(r0).toBeGreaterThan(r1);

    // The 9.0-vs-9.1 vCenter Medium default delta is 50 GB. Verify the
    // secondary-instance disk reflects 9.1 by comparing to the same instance
    // sized as 9.0. (If the lambda bug is present, r1 would be 50 GB higher.)
    const fleet90 = JSON.parse(JSON.stringify(fleet));
    fleet90.vcfVersion = "9.0";
    // Strip VCFMS from initial instance (it shouldn't be there on a 9.0 fleet
    // — and we want to compare apples to apples on secondary instance vCenter).
    fleet90.instances[0].domains.forEach((d) => {
      d.clusters.forEach((c) => {
        c.infraStack = (c.infraStack || []).filter(
          (e) => e.id !== "vcfmsControl" && e.id !== "vcfmsWorker"
        );
      });
    });
    const result90 = sizeFleet(fleet90);
    const r1_90 = result90.instanceResults[1].sharedTotals.disk;
    // Secondary instance has 1× Medium-default vCenter; the disk delta
    // between 9.0 and 9.1 is exactly 50 GB.
    expect(r1_90 - r1).toBe(50);
  });

  it("3-instance 9.1 fleet: VCFMS demand is on the initial instance only (per-fleet scope)", () => {
    const fleet = buildThreeInstance91Fleet();
    // The initial instance should contain vcfmsControl + vcfmsWorker in its
    // mgmt cluster's stored infraStack. Secondary instances should not.
    const initialInst = fleet.instances[0];
    const initialMgmt = initialInst.domains.find((d) => d.type === "mgmt");
    const initialIds = (initialMgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(initialIds).toContain("vcfmsControl");
    expect(initialIds).toContain("vcfmsWorker");

    for (let i = 1; i < fleet.instances.length; i++) {
      const inst = fleet.instances[i];
      const mgmt = inst.domains.find((d) => d.type === "mgmt");
      if (!mgmt) continue;
      const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
      expect(ids, `Instance ${i} should not have VCFMS in stored infraStack`).not.toContain("vcfmsControl");
      expect(ids, `Instance ${i} should not have VCFMS in stored infraStack`).not.toContain("vcfmsWorker");
    }
  });
});

describe("vCenter storage-profile crossing 9.0 ↔ 9.1", () => {
  it("vCenter XLarge xlarge: 9.0 = 4643 GB, 9.1 = 3213 GB", () => {
    const v = APPLIANCE_DB.vcenter;
    expect(v.sizes.XLarge.storage.xlarge).toBe(4643);
    expect(v.sizesByVersion["9.1"].XLarge.storage.xlarge).toBe(3213);
  });

  it("vCenter Medium xlarge: 9.0 = 4468 GB, 9.1 = 3038 GB (1430 GB delta)", () => {
    const v = APPLIANCE_DB.vcenter;
    expect(v.sizes.Medium.storage.xlarge).toBe(4468);
    expect(v.sizesByVersion["9.1"].Medium.storage.xlarge).toBe(3038);
    expect(v.sizes.Medium.storage.xlarge - v.sizesByVersion["9.1"].Medium.storage.xlarge).toBe(1430);
  });
});

describe("profile re-apply preserves VCFMS on 9.1 fleets", () => {
  it("stackForInstance with vcfVersion='9.1' returns a stack containing VCFMS", () => {
    // stackForInstance is the engine helper invoked by applyProfile in the UI.
    // After PR 2, it must take vcfVersion and route through profileStack.
    const stack = stackForInstance("ha", true, "9.1");
    const ids = stack.map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("stackForInstance with vcfVersion='9.0' returns a stack WITHOUT VCFMS", () => {
    const stack = stackForInstance("ha", true, "9.0");
    const ids = stack.map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
    expect(ids).not.toContain("vcfmsWorker");
  });

  it("stackForInstance filters scope:'per-fleet' from non-initial instances regardless of version", () => {
    const initial91 = stackForInstance("ha", true, "9.1");
    const secondary91 = stackForInstance("ha", false, "9.1");
    expect(initial91.some((e) => e.id === "vcfmsControl")).toBe(true);
    expect(secondary91.some((e) => e.id === "vcfmsControl")).toBe(false);
    expect(secondary91.some((e) => e.id === "fleetMgr")).toBe(false); // existing per-fleet appliance also filtered
  });

  it("stackForInstance defaults to legacy 9.0 when vcfVersion omitted", () => {
    const stack = stackForInstance("ha", true);
    const ids = stack.map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
  });
});

describe("promoteToInitial preserves VCFMS in 9.1 fleets", () => {
  it("promoting an instance on a 9.1 fleet re-stamps its mgmt stack with VCFMS", () => {
    const fleet = buildThreeInstance91Fleet();
    // Promote instance 1 (a secondary). promoteToInitial returns a NEW fleet
    // (immutable contract) — capture the return.
    const secondaryId = fleet.instances[1].id;
    const next = promoteToInitial(fleet, secondaryId);
    // After promotion the formerly-secondary should be at index 0 with VCFMS
    // in its mgmt cluster's re-stamped infraStack.
    expect(next.instances[0].id).toBe(secondaryId);
    const mgmt = next.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });
});

describe("9.1-specific programmatic snapshot — newFleet → sizeFleet invariants", () => {
  it("newFleet → sizeFleet yields a 9.1-sized result with VCFMS demand on the initial instance", () => {
    const fleet = newFleet();
    expect(fleet.vcfVersion).toBe("9.1");
    const result = sizeFleet(fleet);
    expect(result.totalHosts).toBeGreaterThan(0);
    // Initial-instance mgmt cluster should contain VCFMS in its source-fleet
    // infraStack (the source fleet is the input — we look it up via instance).
    const mgmt = fleet.instances[0].domains.find((d) => d.type === "mgmt");
    const ids = (mgmt.clusters[0].infraStack || []).map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("a default 9.1 newFleet's sharedTotals differs from a forced-9.0 equivalent (proves threading is active)", () => {
    const fleet91 = newFleet(); // defaults to 9.1, with VCFMS pre-seeded
    const fleet90 = newFleet();
    fleet90.vcfVersion = "9.0";
    const r91 = sizeFleet(fleet91);
    const r90 = sizeFleet(fleet90);
    // sharedTotals aggregates demand across the instance's stacks. With 9.1
    // adding VCFMS demand AND shrinking vCenter storage, the totals MUST
    // differ between the two versions — proving vcfVersion threads through.
    expect(JSON.stringify(r91.instanceResults[0].sharedTotals))
      .not.toBe(JSON.stringify(r90.instanceResults[0].sharedTotals));
  });
});
