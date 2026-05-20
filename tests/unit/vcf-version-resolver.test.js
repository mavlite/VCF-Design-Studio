// Resolver-layer tests for VCF version support (Plan 12, PR 1).
// Covers the pure version-resolution helpers: applianceSize, applianceAvailableIn,
// availableAppliances, profileStack, and the version constants. Migration and
// sizing-integration tests live in vcf-version-migration.test.js and
// vcf-version-integration.test.js (PR 2).
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  APPLIANCE_DB,
  DEPLOYMENT_PROFILES,
  applianceSize,
  applianceAvailableIn,
  availableAppliances,
  profileStack,
  DEFAULT_VCF_VERSION_LEGACY,
  DEFAULT_VCF_VERSION_NEW,
  SUPPORTED_VCF_VERSIONS,
} = VcfEngine;

describe("version constants", () => {
  it("DEFAULT_VCF_VERSION_LEGACY = '9.0'", () => {
    expect(DEFAULT_VCF_VERSION_LEGACY).toBe("9.0");
  });

  it("DEFAULT_VCF_VERSION_NEW = '9.1'", () => {
    expect(DEFAULT_VCF_VERSION_NEW).toBe("9.1");
  });

  it("SUPPORTED_VCF_VERSIONS contains both 9.0 and 9.1", () => {
    expect(SUPPORTED_VCF_VERSIONS).toEqual(expect.arrayContaining(["9.0", "9.1"]));
  });
});

describe("applianceSize — full-replacement override semantics", () => {
  it("returns 9.0 baseline when no override exists for the requested version", () => {
    // sddcMgr has no sizesByVersion override → resolver falls back to def.sizes
    const def = APPLIANCE_DB.sddcMgr;
    const sz = applianceSize(def, "Default", "9.1");
    expect(sz).toEqual(def.sizes.Default);
  });

  it("returns 9.0 baseline for vcenter Medium when vcfVersion is '9.0'", () => {
    const def = APPLIANCE_DB.vcenter;
    const sz = applianceSize(def, "Medium", "9.0");
    expect(sz).toBeTruthy();
    expect(sz.vcpu).toBe(8);
    expect(sz.ram).toBe(30);
    expect(sz.storage.default).toBe(908);
    expect(sz.storage.large).toBe(2208);
    expect(sz.storage.xlarge).toBe(4468);
  });

  it("returns 9.1 override for vcenter Medium when vcfVersion is '9.1'", () => {
    const def = APPLIANCE_DB.vcenter;
    const sz = applianceSize(def, "Medium", "9.1");
    expect(sz).toBeTruthy();
    expect(sz.vcpu).toBe(8);
    expect(sz.ram).toBe(30);
    expect(sz.storage.default).toBe(858);
    expect(sz.storage.large).toBe(1658);
    expect(sz.storage.xlarge).toBe(3038);
  });

  it("9.0 vs 9.1 vcenter Tiny differ in storage but match in compute", () => {
    const def = APPLIANCE_DB.vcenter;
    const s90 = applianceSize(def, "Tiny", "9.0");
    const s91 = applianceSize(def, "Tiny", "9.1");
    expect(s91.vcpu).toBe(s90.vcpu);
    expect(s91.ram).toBe(s90.ram);
    expect(s91.storage.default).toBe(604);
    expect(s90.storage.default).toBe(579);
    expect(s91.storage.xlarge).toBe(2874);
    expect(s90.storage.xlarge).toBe(4279);
  });

  it("returns null when size name is unknown", () => {
    const def = APPLIANCE_DB.vcenter;
    expect(applianceSize(def, "Nonexistent", "9.0")).toBeNull();
    expect(applianceSize(def, "Nonexistent", "9.1")).toBeNull();
  });

  it("returns null when def is null/undefined", () => {
    expect(applianceSize(null, "Medium", "9.0")).toBeNull();
    expect(applianceSize(undefined, "Medium", "9.1")).toBeNull();
  });
});

describe("applianceAvailableIn — version gating", () => {
  it("returns true when def has no availableInVersions (unrestricted)", () => {
    expect(applianceAvailableIn(APPLIANCE_DB.vcenter, "9.0")).toBe(true);
    expect(applianceAvailableIn(APPLIANCE_DB.vcenter, "9.1")).toBe(true);
  });

  it("returns true when version is in availableInVersions list", () => {
    expect(applianceAvailableIn(APPLIANCE_DB.vcfmsControl, "9.1")).toBe(true);
    expect(applianceAvailableIn(APPLIANCE_DB.vcfmsWorker, "9.1")).toBe(true);
  });

  it("returns false when version is NOT in availableInVersions list", () => {
    expect(applianceAvailableIn(APPLIANCE_DB.vcfmsControl, "9.0")).toBe(false);
    expect(applianceAvailableIn(APPLIANCE_DB.vcfmsWorker, "9.0")).toBe(false);
  });

  it("returns false for unsupported version strings (defensive)", () => {
    expect(applianceAvailableIn(APPLIANCE_DB.vcfmsControl, "9.2")).toBe(false);
    expect(applianceAvailableIn(APPLIANCE_DB.vcfmsControl, undefined)).toBe(false);
  });

  it("returns true for unrestricted appliances even with unknown version", () => {
    // sddcMgr has no availableInVersions; should be allowed regardless
    expect(applianceAvailableIn(APPLIANCE_DB.sddcMgr, "9.2")).toBe(true);
  });
});

describe("availableAppliances — version-filtered APPLIANCE_DB", () => {
  it("9.0 excludes vcfmsControl and vcfmsWorker", () => {
    const map = availableAppliances("9.0");
    expect(map.vcfmsControl).toBeUndefined();
    expect(map.vcfmsWorker).toBeUndefined();
  });

  it("9.0 still includes vcenter, nsxMgr, sddcMgr, fleetMgr", () => {
    const map = availableAppliances("9.0");
    expect(map.vcenter).toBeDefined();
    expect(map.nsxMgr).toBeDefined();
    expect(map.sddcMgr).toBeDefined();
    expect(map.fleetMgr).toBeDefined();
  });

  it("9.1 includes vcfmsControl and vcfmsWorker", () => {
    const map = availableAppliances("9.1");
    expect(map.vcfmsControl).toBeDefined();
    expect(map.vcfmsWorker).toBeDefined();
  });

  it("9.1 still includes all the 9.0 appliances (no removals)", () => {
    const map = availableAppliances("9.1");
    expect(map.vcenter).toBeDefined();
    expect(map.nsxMgr).toBeDefined();
    expect(map.sddcMgr).toBeDefined();
    expect(map.fleetMgr).toBeDefined();
  });

  it("unsupported version excludes 9.1-gated appliances", () => {
    const map = availableAppliances("9.2");
    expect(map.vcfmsControl).toBeUndefined();
    expect(map.vcfmsWorker).toBeUndefined();
    // But unrestricted appliances still present
    expect(map.vcenter).toBeDefined();
  });
});

describe("profileStack — version-aware DEPLOYMENT_PROFILES.stack", () => {
  it("returns baseline stack when no stackByVersion override exists for the version", () => {
    // simple profile is HA-less; its stack is unchanged in 9.1 (no VCFMS in simple).
    const profile = DEPLOYMENT_PROFILES.simple;
    const stack = profileStack(profile, "9.0");
    expect(stack).toEqual(profile.stack);
  });

  it("returns 9.1 override stack for HA profile (includes VCFMS in 9.1)", () => {
    const profile = DEPLOYMENT_PROFILES.ha;
    const stack91 = profileStack(profile, "9.1");
    const ids = stack91.map((e) => e.id);
    expect(ids).toContain("vcfmsControl");
    expect(ids).toContain("vcfmsWorker");
  });

  it("returns 9.0 baseline stack for HA profile (no VCFMS in 9.0)", () => {
    const profile = DEPLOYMENT_PROFILES.ha;
    const stack90 = profileStack(profile, "9.0");
    const ids = stack90.map((e) => e.id);
    expect(ids).not.toContain("vcfmsControl");
    expect(ids).not.toContain("vcfmsWorker");
  });

  it("returns baseline when profile is null/undefined-safe", () => {
    expect(profileStack(null, "9.0")).toEqual([]);
    expect(profileStack(undefined, "9.1")).toEqual([]);
  });
});
