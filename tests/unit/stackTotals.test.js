import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { stackTotals, applianceEntryDisk, APPLIANCE_DB } = VcfEngine;

// Resolve the disk allocation for a stack entry using the same logic the
// engine does. Wraps applianceEntryDisk so test arithmetic stays compact.
function entryDisk(e) {
  const def = APPLIANCE_DB[e.id];
  if (!def) return 0;
  const sz = def.sizes[e.size];
  return applianceEntryDisk(e, def, sz);
}

describe("stackTotals — aggregation", () => {
  it("returns zeros for empty stack", () => {
    expect(stackTotals([])).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("returns zeros for null/undefined stack", () => {
    expect(stackTotals(undefined)).toEqual({ vcpu: 0, ram: 0, disk: 0 });
    expect(stackTotals(null)).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("sums vcpu/ram/disk across appliances", () => {
    const vc = APPLIANCE_DB.vcenter.sizes.Medium;
    const entry = { id: "vcenter", size: "Medium", instances: 1 };
    const total = stackTotals([entry]);
    expect(total.vcpu).toBe(vc.vcpu);
    expect(total.ram).toBe(vc.ram);
    expect(total.disk).toBe(entryDisk(entry));
  });

  it("multiplies by instances count", () => {
    const nsx = APPLIANCE_DB.nsxMgr.sizes.Medium;
    const total = stackTotals([{ id: "nsxMgr", size: "Medium", instances: 3 }]);
    expect(total.vcpu).toBe(nsx.vcpu * 3);
    expect(total.ram).toBe(nsx.ram * 3);
    expect(total.disk).toBe(nsx.disk * 3);
  });

  it("honors vcenter storage profile (default/large/xlarge)", () => {
    const sz = APPLIANCE_DB.vcenter.sizes.Medium;
    expect(stackTotals([{ id: "vcenter", size: "Medium", instances: 1 }]).disk)
      .toBe(sz.storage.default);
    expect(stackTotals([{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "default" }]).disk)
      .toBe(sz.storage.default);
    expect(stackTotals([{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "large" }]).disk)
      .toBe(sz.storage.large);
    expect(stackTotals([{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "xlarge" }]).disk)
      .toBe(sz.storage.xlarge);
    // Unknown profile falls back to the appliance's defaultStorageProfile.
    expect(stackTotals([{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "bogus" }]).disk)
      .toBe(sz.storage.default);
  });

  it("skips entries with unknown id", () => {
    const total = stackTotals([
      { id: "doesNotExist", size: "Medium", instances: 1 },
      { id: "vcenter", size: "Medium", instances: 1 },
    ]);
    const vc = APPLIANCE_DB.vcenter.sizes.Medium;
    expect(total.vcpu).toBe(vc.vcpu);
  });

  it("skips entries with unknown size", () => {
    const total = stackTotals([
      { id: "vcenter", size: "DoesNotExist", instances: 1 },
    ]);
    expect(total).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("skips entries with zero instances", () => {
    const total = stackTotals([
      { id: "vcenter", size: "Medium", instances: 0 },
    ]);
    expect(total).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("aggregates a multi-appliance stack", () => {
    const stack = [
      { id: "vcenter", size: "Medium", instances: 1 },
      { id: "nsxMgr",  size: "Medium", instances: 3 },
      { id: "sddcMgr", size: "Default", instances: 1 },
    ];
    const total = stackTotals(stack);
    let expectVcpu = 0, expectRam = 0, expectDisk = 0;
    for (const e of stack) {
      const sz = APPLIANCE_DB[e.id]?.sizes?.[e.size];
      if (!sz) continue;
      expectVcpu += sz.vcpu * e.instances;
      expectRam  += sz.ram  * e.instances;
      expectDisk += entryDisk(e) * e.instances;
    }
    expect(total.vcpu).toBe(expectVcpu);
    expect(total.ram).toBe(expectRam);
    expect(total.disk).toBe(expectDisk);
  });
});

describe("stackTotals — vcfVersion threading (Plan 12, PR 2)", () => {
  it("9.0: vCenter Medium default disk = 908 GB", () => {
    const stack = [{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "default" }];
    expect(stackTotals(stack, "9.0").disk).toBe(908);
  });

  it("9.1: vCenter Medium default disk = 858 GB", () => {
    const stack = [{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "default" }];
    expect(stackTotals(stack, "9.1").disk).toBe(858);
  });

  it("legacy call without vcfVersion defaults to 9.0 baseline", () => {
    const stack = [{ id: "vcenter", size: "Medium", instances: 1, storageProfile: "default" }];
    expect(stackTotals(stack).disk).toBe(908);
  });

  it("multi-size cross-version discrimination — all four vCenter default sums diverge", () => {
    // Single test catching a resolver that returns the wrong version's map:
    // 9.0 = 579 + 908 + 1358 + 2283 = 5128
    // 9.1 = 604 + 858 + 1158 + 1783 = 4403
    const stack = [
      { id: "vcenter", size: "Tiny",   instances: 1, storageProfile: "default" },
      { id: "vcenter", size: "Medium", instances: 1, storageProfile: "default" },
      { id: "vcenter", size: "Large",  instances: 1, storageProfile: "default" },
      { id: "vcenter", size: "XLarge", instances: 1, storageProfile: "default" },
    ];
    expect(stackTotals(stack, "9.0").disk).toBe(579 + 908 + 1358 + 2283);
    expect(stackTotals(stack, "9.1").disk).toBe(604 + 858 + 1158 + 1783);
  });

  it("VCFMS appliances counted at full demand on 9.1, dropped on 9.0", () => {
    const stack = [
      { id: "vcfmsControl", size: "Medium", instances: 3 },
      { id: "vcfmsWorker",  size: "Medium", instances: 3 },
    ];
    // 9.1: Control Medium = 4/10/100 × 3 + Worker Medium = 24/48/100 × 3.
    // disk = 100*3 + 100*3 = 600
    expect(stackTotals(stack, "9.1").disk).toBe(600);
    expect(stackTotals(stack, "9.1").vcpu).toBe(4 * 3 + 24 * 3);
    // 9.0: VCFMS appliances exist in APPLIANCE_DB but availableInVersions=["9.1"]
    // means stackTotals should treat them as unavailable. Since stackTotals
    // historically just skips unknown ids, the spec is: on 9.0 it returns 0
    // for VCFMS entries. (Defense-in-depth — UI strips them before this.)
    expect(stackTotals(stack, "9.0").disk).toBe(0);
  });
});
