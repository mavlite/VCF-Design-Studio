// Theme 1a — fleet.installerConfig model expansion
//
// MODEL + UI work. Adds fleet-level installerConfig describing how the VCF
// Installer reaches the Broadcom depot (or an offline mirror) and what
// activation material is needed at deploy time. Companion theme 1b wires
// the workbook export (Deploy Mgmt L9–L20) once this lands.
//
// Scope shipped:
//   - newFleet() carries a default installerConfig
//   - migrateFleet idempotently populates installerConfig on legacy fleets,
//     merging partial blobs with the factory shape so new fields backfill
//   - depot + proxy passwords registered in PASSWORD_POLICY
//   - createFleetInstallerConfig exported via VcfEngine for the JSX panel
//
// Deferred to theme 1b:
//   - WORKBOOK_CELL_MAP entries for L9–L20
//   - emit / import / vault routing for depot / proxy passwords

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  migrateFleet,
  createFleetInstallerConfig,
  PASSWORD_POLICY,
  generatePassword,
  validatePlacementConstraints,
  sizeFleet,
} = VcfEngine;

describe("Theme 1a — createFleetInstallerConfig defaults", () => {
  it("exports the factory and returns the documented shape", () => {
    expect(typeof createFleetInstallerConfig).toBe("function");
    const cfg = createFleetInstallerConfig();
    expect(cfg).toEqual({
      depotType: "broadcom",
      depotUrl: "",
      depotProtocol: "https",
      authenticated: true,
      depotUser: "",
      depotPassword: "",
      proxyEnabled: false,
      proxyHost: "",
      proxyPort: 8080,
      proxyUser: "",
      proxyPassword: "",
      activationCode: "",
    });
  });

  it("returns a fresh object each call (no shared references)", () => {
    const a = createFleetInstallerConfig();
    const b = createFleetInstallerConfig();
    expect(a).not.toBe(b);
    a.depotUrl = "tampered";
    expect(b.depotUrl).toBe("");
  });
});

describe("Theme 1a — newFleet() seeds installerConfig", () => {
  it("populates fleet.installerConfig with factory defaults", () => {
    const fleet = newFleet();
    expect(fleet.installerConfig).toBeTruthy();
    expect(fleet.installerConfig).toEqual(createFleetInstallerConfig());
  });

  it("does not interfere with the rest of the fleet shape", () => {
    const fleet = newFleet();
    expect(fleet.sites?.length).toBeGreaterThan(0);
    expect(fleet.instances?.length).toBeGreaterThan(0);
    expect(fleet.networkConfig).toBeTruthy();
    expect(fleet.namingConfig).toBeTruthy();
    expect(fleet.reportMetadata).toBeTruthy();
  });
});

describe("Theme 1a — migrateFleet backfills installerConfig", () => {
  it("legacy fleet without installerConfig gets factory defaults", () => {
    const legacy = newFleet();
    delete legacy.installerConfig;
    const migrated = migrateFleet(legacy);
    expect(migrated.installerConfig).toEqual(createFleetInstallerConfig());
  });

  it("partial installerConfig blob is merged with the factory shape", () => {
    // Simulates a future-vs-past schema mismatch: the on-disk blob only has
    // depotUrl + depotUser; migration must backfill every other field so
    // downstream code never reads `undefined` from a field it expects.
    // version: "vcf-sizer-v9" simulates a saved fleet — without it
    // migrateFleet routes through migrateV3ToV5 which strips top-level fields.
    const legacy = newFleet();
    legacy.version = "vcf-sizer-v9";
    legacy.installerConfig = {
      depotUrl: "depot.broadcom.com",
      depotUser: "ops@acme.com",
    };
    const migrated = migrateFleet(legacy);
    expect(migrated.installerConfig.depotUrl).toBe("depot.broadcom.com");
    expect(migrated.installerConfig.depotUser).toBe("ops@acme.com");
    // Untouched fields backfilled to the factory defaults.
    expect(migrated.installerConfig.depotType).toBe("broadcom");
    expect(migrated.installerConfig.depotProtocol).toBe("https");
    expect(migrated.installerConfig.authenticated).toBe(true);
    expect(migrated.installerConfig.proxyEnabled).toBe(false);
    expect(migrated.installerConfig.proxyPort).toBe(8080);
    expect(migrated.installerConfig.activationCode).toBe("");
  });

  it("explicit user-set values survive round-trip through migrateFleet", () => {
    const fleet = newFleet();
    fleet.version = "vcf-sizer-v9";
    fleet.installerConfig = {
      depotType: "offline",
      depotUrl: "mirror.internal/depot",
      depotProtocol: "http",
      authenticated: false,
      depotUser: "",
      depotPassword: "",
      proxyEnabled: true,
      proxyHost: "proxy.dmz",
      proxyPort: 3128,
      proxyUser: "svc-vcf",
      proxyPassword: "(redacted)",
      activationCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE",
    };
    const migrated = migrateFleet(fleet);
    expect(migrated.installerConfig).toEqual(fleet.installerConfig);
  });

  it("is idempotent — migrate(migrate(x)) === migrate(x) for installerConfig", () => {
    const a = migrateFleet(newFleet());
    const b = migrateFleet(a);
    expect(b.installerConfig).toEqual(a.installerConfig);
  });

  it("migrating null / undefined fleet still produces installerConfig", () => {
    const fromNull = migrateFleet(null);
    expect(fromNull.installerConfig).toBeTruthy();
    expect(fromNull.installerConfig).toEqual(createFleetInstallerConfig());
  });
});

describe("Theme 1a — PASSWORD_POLICY registers depot + proxy", () => {
  it("depot policy is defined and matches the policy contract", () => {
    expect(PASSWORD_POLICY.depot).toBeTruthy();
    const p = PASSWORD_POLICY.depot;
    expect(p.len).toBeGreaterThanOrEqual(16);
    const classSum =
      (p.classes.upper || 0) +
      (p.classes.lower || 0) +
      (p.classes.digit || 0) +
      (p.classes.special || 0);
    expect(classSum).toBe(p.len);
  });

  it("proxy policy is defined and matches the policy contract", () => {
    expect(PASSWORD_POLICY.proxy).toBeTruthy();
    const p = PASSWORD_POLICY.proxy;
    expect(p.len).toBeGreaterThanOrEqual(16);
    const classSum =
      (p.classes.upper || 0) +
      (p.classes.lower || 0) +
      (p.classes.digit || 0) +
      (p.classes.special || 0);
    expect(classSum).toBe(p.len);
  });

  it("generatePassword('depot') produces a string of the policy length", () => {
    const pw = generatePassword("depot");
    expect(typeof pw).toBe("string");
    expect(pw.length).toBe(PASSWORD_POLICY.depot.len);
  });

  it("generatePassword('proxy') produces a string of the policy length", () => {
    const pw = generatePassword("proxy");
    expect(typeof pw).toBe("string");
    expect(pw.length).toBe(PASSWORD_POLICY.proxy.len);
  });

  it("depot password contains all required character classes", () => {
    const pw = generatePassword("depot");
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
    // _SPECIAL_SAFE = "!#$%^&*_?"
    expect(/[!#$%^&*_?]/.test(pw)).toBe(true);
  });
});

describe("Theme 1a — no regression on validation / sizing", () => {
  it("validatePlacementConstraints still returns an array for a default fleet", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    expect(Array.isArray(issues)).toBe(true);
  });

  it("sizeFleet still computes totals on a default fleet (installerConfig is metadata, not sized)", () => {
    const fleet = newFleet();
    const result = sizeFleet(fleet);
    expect(result).toBeTruthy();
    expect(typeof result.totalHosts).toBe("number");
    expect(typeof result.totalCores).toBe("number");
    expect(Array.isArray(result.instanceResults)).toBe(true);
  });
});
