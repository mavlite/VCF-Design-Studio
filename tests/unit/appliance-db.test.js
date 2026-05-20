import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { APPLIANCE_DB, DEPLOYMENT_PROFILES } = VcfEngine;

describe("APPLIANCE_DB — schema", () => {
  it("has at least 20 appliances", () => {
    expect(Object.keys(APPLIANCE_DB).length).toBeGreaterThanOrEqual(20);
  });

  it.each(Object.entries(APPLIANCE_DB))("appliance %s has placement, label, and at least one size", (id, def) => {
    expect(def.placement, `${id} missing placement`).toBeTypeOf("string");
    expect(def.label, `${id} missing label`).toBeTypeOf("string");
    expect(def.sizes, `${id} missing sizes`).toBeTypeOf("object");
    expect(Object.keys(def.sizes).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(APPLIANCE_DB))("every size in %s has numeric vcpu/ram and resolvable disk", (id, def) => {
    for (const [sizeName, size] of Object.entries(def.sizes)) {
      expect(size.vcpu, `${id}/${sizeName} vcpu`).toBeTypeOf("number");
      expect(size.ram,  `${id}/${sizeName} ram`).toBeTypeOf("number");
      expect(size.vcpu).toBeGreaterThan(0);
      expect(size.ram).toBeGreaterThan(0);
      // Disk is either flat (`size.disk`) or nested under a storage profile
      // (`size.storage[profile]`). vCenter is the only appliance using the
      // nested form today (VCF 9.0 P&P Workbook).
      if (typeof size.disk === "number") {
        expect(size.disk, `${id}/${sizeName} disk`).toBeGreaterThan(0);
      } else {
        expect(size.storage, `${id}/${sizeName} missing disk and storage map`).toBeTypeOf("object");
        const defaultProf = def.defaultStorageProfile || "default";
        expect(size.storage[defaultProf], `${id}/${sizeName} storage[${defaultProf}]`).toBeTypeOf("number");
        expect(size.storage[defaultProf]).toBeGreaterThan(0);
      }
    }
  });

  it("vcenter exposes Default/Large/X-Large storage profiles per VCF 9.0 P&P Workbook", () => {
    const v = APPLIANCE_DB.vcenter;
    expect(v.storageProfiles).toEqual(["default", "large", "xlarge"]);
    expect(v.defaultStorageProfile).toBe("default");
    // Spot-check the Medium row against the workbook.
    expect(v.sizes.Medium.storage).toEqual({ default: 908, large: 2208, xlarge: 4468 });
  });

  it("has known load-bearing appliances (vcenter, nsxMgr, sddcMgr)", () => {
    expect(APPLIANCE_DB.vcenter).toBeDefined();
    expect(APPLIANCE_DB.nsxMgr).toBeDefined();
    expect(APPLIANCE_DB.sddcMgr).toBeDefined();
    expect(APPLIANCE_DB.vsanWitness).toBeDefined();
  });

  it("vsanWitness has Tiny/Medium/Large with the documented limits", () => {
    expect(APPLIANCE_DB.vsanWitness.sizes.Tiny.vcpu).toBe(2);
    expect(APPLIANCE_DB.vsanWitness.sizes.Medium.vcpu).toBe(2);
    expect(APPLIANCE_DB.vsanWitness.sizes.Large.vcpu).toBe(2);
  });
});

describe("APPLIANCE_DB — VCF 9.1 sizesByVersion (vCenter)", () => {
  // Locks the 9.1 vCenter storage values against the Phase 1 cross-check
  // (VCF-9.1-DELTA.md). Catches typos / accidental edits.
  it("vcenter.sizesByVersion['9.1'].Medium.storage matches Phase 1 values", () => {
    const v91 = APPLIANCE_DB.vcenter.sizesByVersion?.["9.1"];
    expect(v91, "vcenter.sizesByVersion['9.1'] must exist").toBeDefined();
    expect(v91.Medium.storage).toEqual({ default: 858, large: 1658, xlarge: 3038 });
  });

  it("vcenter.sizesByVersion['9.1'].XLarge.storage matches Phase 1 values", () => {
    const v91 = APPLIANCE_DB.vcenter.sizesByVersion["9.1"];
    expect(v91.XLarge.storage).toEqual({ default: 1783, large: 1833, xlarge: 3213 });
  });

  it("vcenter.sizesByVersion['9.1'].Tiny.storage matches Phase 1 values", () => {
    const v91 = APPLIANCE_DB.vcenter.sizesByVersion["9.1"];
    expect(v91.Tiny.storage).toEqual({ default: 604, large: 1494, xlarge: 2874 });
  });

  it("vcenter.sizesByVersion['9.1'] preserves vCPU/RAM (only storage changed in 9.1)", () => {
    const v90 = APPLIANCE_DB.vcenter.sizes;
    const v91 = APPLIANCE_DB.vcenter.sizesByVersion["9.1"];
    for (const sizeName of Object.keys(v90)) {
      expect(v91[sizeName].vcpu).toBe(v90[sizeName].vcpu);
      expect(v91[sizeName].ram).toBe(v90[sizeName].ram);
    }
  });

  it("sizesByVersion override has the same size keys as the baseline (no removals in 9.1)", () => {
    const baselineKeys = Object.keys(APPLIANCE_DB.vcenter.sizes).sort();
    const overrideKeys = Object.keys(APPLIANCE_DB.vcenter.sizesByVersion["9.1"]).sort();
    expect(overrideKeys).toEqual(baselineKeys);
  });
});

describe("APPLIANCE_DB — VCFMS (new in 9.1)", () => {
  it("vcfmsControl is gated to 9.1 only", () => {
    expect(APPLIANCE_DB.vcfmsControl).toBeDefined();
    expect(APPLIANCE_DB.vcfmsControl.availableInVersions).toEqual(["9.1"]);
  });

  it("vcfmsWorker is gated to 9.1 only", () => {
    expect(APPLIANCE_DB.vcfmsWorker).toBeDefined();
    expect(APPLIANCE_DB.vcfmsWorker.availableInVersions).toEqual(["9.1"]);
  });

  it("VCFMS appliances use scope:'per-fleet' (matches fleetMgr pattern)", () => {
    expect(APPLIANCE_DB.vcfmsControl.scope).toBe("per-fleet");
    expect(APPLIANCE_DB.vcfmsWorker.scope).toBe("per-fleet");
  });

  it("VCFMS appliances use placementConstraint:'mgmt-only-greenfield'", () => {
    expect(APPLIANCE_DB.vcfmsControl.placementConstraint).toBe("mgmt-only-greenfield");
    expect(APPLIANCE_DB.vcfmsWorker.placementConstraint).toBe("mgmt-only-greenfield");
  });

  it("vcfmsControl Medium = 4 vCPU / 10 GB / 100 GB (per VCF 9.1 workbook)", () => {
    const sz = APPLIANCE_DB.vcfmsControl.sizes.Medium;
    expect(sz.vcpu).toBe(4);
    expect(sz.ram).toBe(10);
    expect(sz.disk).toBe(100);
  });

  it("vcfmsWorker Medium = 24 vCPU / 48 GB / 100 GB (per VCF 9.1 workbook)", () => {
    const sz = APPLIANCE_DB.vcfmsWorker.sizes.Medium;
    expect(sz.vcpu).toBe(24);
    expect(sz.ram).toBe(48);
    expect(sz.disk).toBe(100);
  });

  it("vcfmsWorker Large = 24 vCPU / 48 GB / 100 GB with 4-worker default", () => {
    const sz = APPLIANCE_DB.vcfmsWorker.sizes.Large;
    expect(sz.vcpu).toBe(24);
    expect(sz.ram).toBe(48);
    expect(sz.defaultInstances).toBe(4);
  });
});

describe("APPLIANCE_DB — SSP tripwire (frozen 9.0 baseline)", () => {
  // The Phase 1 cross-check confirmed SSP unchanged in 9.1. This test locks
  // the 9.0 values in place; if 9.1 (or any future version) actually changes
  // SSP values, this fires and forces an explicit version-keying decision.
  it("SSP Medium = 112 / 414 / 4096", () => {
    const sz = APPLIANCE_DB.ssp.sizes.Medium;
    expect(sz.vcpu).toBe(112);
    expect(sz.ram).toBe(414);
    expect(sz.disk).toBe(4096);
  });

  it("SSP Large = 160 / 606 / 5120", () => {
    const sz = APPLIANCE_DB.ssp.sizes.Large;
    expect(sz.vcpu).toBe(160);
    expect(sz.ram).toBe(606);
    expect(sz.disk).toBe(5120);
  });

  it("SSP XLarge = 192 / 734 / 6656", () => {
    const sz = APPLIANCE_DB.ssp.sizes.XLarge;
    expect(sz.vcpu).toBe(192);
    expect(sz.ram).toBe(734);
    expect(sz.disk).toBe(6656);
  });
});

describe("DEPLOYMENT_PROFILES — stackByVersion[\"9.1\"] schema", () => {
  // Catches a typo in any version-keyed stack entry that would otherwise
  // pass the existing `profile.stack` validator (which doesn't see overrides).
  it.each(Object.entries(DEPLOYMENT_PROFILES))(
    "%s stackByVersion['9.1'] entries (if present) reference valid APPLIANCE_DB ids and sizes",
    (name, profile) => {
      const override = profile.stackByVersion?.["9.1"];
      if (!override) return; // some profiles may not have a 9.1 override
      for (const entry of override) {
        expect(APPLIANCE_DB[entry.id],
          `${name}.stackByVersion['9.1'] references unknown appliance ${entry.id}`).toBeDefined();
        expect(APPLIANCE_DB[entry.id].sizes[entry.size],
          `${name}.stackByVersion['9.1'] references unknown size ${entry.id}/${entry.size}`).toBeDefined();
      }
    }
  );

  it("ha.stackByVersion['9.1'] includes VCFMS control + worker entries", () => {
    const override = DEPLOYMENT_PROFILES.ha.stackByVersion?.["9.1"];
    expect(override).toBeDefined();
    const ids = override.map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("simple.stackByVersion['9.1'] includes VCFMS (mandatory per 9.1 Broadcom guidance)", () => {
    const override = DEPLOYMENT_PROFILES.simple.stackByVersion?.["9.1"];
    expect(override).toBeDefined();
    const ids = override.map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });
});

describe("DEPLOYMENT_PROFILES — schema", () => {
  it("has the five known profiles", () => {
    expect(Object.keys(DEPLOYMENT_PROFILES).sort()).toEqual([
      "ha", "haFederation", "haFederationSiteProtection", "haSiteProtection", "simple",
    ].sort());
  });

  it.each(Object.entries(DEPLOYMENT_PROFILES))("%s has a non-empty stack", (name, profile) => {
    expect(Array.isArray(profile.stack), `${name} stack should be array`).toBe(true);
    expect(profile.stack.length).toBeGreaterThan(0);
    for (const entry of profile.stack) {
      expect(APPLIANCE_DB[entry.id], `${name} references unknown appliance ${entry.id}`).toBeDefined();
      expect(APPLIANCE_DB[entry.id].sizes[entry.size],
        `${name} references unknown size ${entry.id}/${entry.size}`).toBeDefined();
    }
  });
});
