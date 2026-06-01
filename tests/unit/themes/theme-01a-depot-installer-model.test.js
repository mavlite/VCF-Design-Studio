// Theme 1a — fleet.installerConfig model expansion
//
// MODEL + UI work. Adds fleet-level installerConfig describing how the VCF
// Installer reaches the Broadcom depot (or an offline mirror). Companion
// theme 1b wires the workbook export (Deploy Mgmt L9–L20) AND reconciles
// the field shape against the actual workbook rows.
//
// Scope shipped:
//   - newFleet() carries a default installerConfig
//   - migrateFleet whitelist-merges installerConfig against the factory
//     shape — unknown keys (e.g. the dead theme-1a-original "depotUrl" /
//     "depotUser") are dropped on import; missing keys backfill defaults.
//   - proxy password registered in PASSWORD_POLICY
//   - createFleetInstallerConfig exported via VcfEngine for the JSX panel
//
// Deferred to theme 1b:
//   - WORKBOOK_CELL_MAP entries for L9–L20
//   - emit / import / vault routing
//   - schema-shape correction (online/offline, offline depot host/port,
//     downloadToken, proxyProtocol, proxyAuthenticated)

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
      depotType: "online",
      offlineDepotHostname: "",
      offlineDepotPort: 443,
      downloadToken: "",
      activationCode: "",
      proxyEnabled: false,
      proxyProtocol: "https",
      proxyHost: "",
      proxyPort: 443,
      proxyAuthenticated: false,
      proxyUser: "",
      proxyPassword: "",
    });
  });

  it("returns a fresh object each call (no shared references)", () => {
    const a = createFleetInstallerConfig();
    const b = createFleetInstallerConfig();
    expect(a).not.toBe(b);
    a.offlineDepotHostname = "tampered";
    expect(b.offlineDepotHostname).toBe("");
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
    // offlineDepotHostname + downloadToken; migration must backfill every
    // other field so downstream code never reads `undefined`. version:
    // "vcf-sizer-v9" simulates a saved fleet — without it migrateFleet
    // routes through migrateV3ToV5 which strips top-level fields.
    const legacy = newFleet();
    legacy.version = "vcf-sizer-v9";
    legacy.installerConfig = {
      offlineDepotHostname: "depot.internal",
      downloadToken: "ABC123",
    };
    const migrated = migrateFleet(legacy);
    expect(migrated.installerConfig.offlineDepotHostname).toBe("depot.internal");
    expect(migrated.installerConfig.downloadToken).toBe("ABC123");
    // Untouched fields backfilled to the factory defaults.
    expect(migrated.installerConfig.depotType).toBe("online");
    expect(migrated.installerConfig.offlineDepotPort).toBe(443);
    expect(migrated.installerConfig.activationCode).toBe("");
    expect(migrated.installerConfig.proxyEnabled).toBe(false);
    expect(migrated.installerConfig.proxyProtocol).toBe("https");
    expect(migrated.installerConfig.proxyAuthenticated).toBe(false);
  });

  it("explicit user-set values survive round-trip through migrateFleet", () => {
    const fleet = newFleet();
    fleet.version = "vcf-sizer-v9";
    fleet.installerConfig = {
      depotType: "offline",
      offlineDepotHostname: "mirror.internal",
      offlineDepotPort: 8443,
      downloadToken: "ZZZ-token",
      activationCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE",
      proxyEnabled: true,
      proxyProtocol: "http",
      proxyHost: "proxy.dmz",
      proxyPort: 3128,
      proxyAuthenticated: true,
      proxyUser: "svc-vcf",
      proxyPassword: "(redacted)",
    };
    const migrated = migrateFleet(fleet);
    expect(migrated.installerConfig).toEqual(fleet.installerConfig);
  });

  it("strips dead legacy keys (depotUrl / depotUser / etc.) on whitelist-merge", () => {
    // Simulates a fleet saved against the original theme-1a schema (now
    // dead). migrateFleet must drop unknown fields so they don't leak
    // through to UI / export code that no longer expects them.
    const legacy = newFleet();
    legacy.version = "vcf-sizer-v9";
    legacy.installerConfig = {
      depotType: "offline",
      depotUrl: "old.example.com",
      depotProtocol: "http",
      authenticated: true,
      depotUser: "dead-field",
      depotPassword: "dead-password",
      offlineDepotHostname: "kept.example.com",
    };
    const migrated = migrateFleet(legacy);
    // Known fields survive...
    expect(migrated.installerConfig.depotType).toBe("offline");
    expect(migrated.installerConfig.offlineDepotHostname).toBe("kept.example.com");
    // ...dead fields gone.
    expect(migrated.installerConfig).not.toHaveProperty("depotUrl");
    expect(migrated.installerConfig).not.toHaveProperty("depotProtocol");
    expect(migrated.installerConfig).not.toHaveProperty("authenticated");
    expect(migrated.installerConfig).not.toHaveProperty("depotUser");
    expect(migrated.installerConfig).not.toHaveProperty("depotPassword");
    // Key set matches the factory exactly.
    expect(Object.keys(migrated.installerConfig).sort()).toEqual(
      Object.keys(createFleetInstallerConfig()).sort()
    );
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

describe("Theme 1a — PASSWORD_POLICY registers proxy (depot kind dropped)", () => {
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

  it("depot password kind is intentionally NOT registered", () => {
    // downloadToken + activationCode are user-supplied Broadcom credentials,
    // not generatable passwords — they ride the cell-map as plain strings.
    expect(PASSWORD_POLICY.depot).toBeUndefined();
  });

  it("generatePassword('proxy') produces a string of the policy length", () => {
    const pw = generatePassword("proxy");
    expect(typeof pw).toBe("string");
    expect(pw.length).toBe(PASSWORD_POLICY.proxy.len);
  });

  it("proxy password contains all required character classes", () => {
    const pw = generatePassword("proxy");
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
