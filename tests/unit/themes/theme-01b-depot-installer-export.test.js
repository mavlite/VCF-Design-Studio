// Theme 1b — depot/installer cell-map export
//
// EXPORT-side work. Wires fleet.installerConfig into WORKBOOK_CELL_MAP so
// the studio stamps Deploy Management Domain L9–L20 on emit and reads it
// back on import. Also corrected the theme-1a schema to match the actual
// workbook rows (Online/Offline depot type, offline-only depot host/port,
// downloadToken, proxyProtocol, proxyAuthenticated).
//
// 9.1 inserts Activation Code at L13, shifting the proxy block down by
// one row vs 9.0. cellByVersion captures the shift.
//
// Proxy password is the only vaulted secret (PASSWORD_POLICY["proxy"]).
// Download Token + Activation Code are user-supplied Broadcom credentials
// and ride the cell-map as plain strings.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  migrateFleet,
  createFleetInstallerConfig,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  importWorkbookCellMap,
  parseWorkbookCellMap,
  generateWorkbookVault,
  WORKBOOK_CELL_MAP,
  PASSWORD_POLICY,
} = VcfEngine;

function defaultFleet(vcfVersion = "9.1") {
  const fleet = newFleet();
  fleet.vcfVersion = vcfVersion;
  fleet.version = "vcf-sizer-v9";
  return fleet;
}

function withInstaller(fleet, patch) {
  fleet.installerConfig = { ...createFleetInstallerConfig(), ...patch };
  return fleet;
}

function findRow(rows, sheet, cell) {
  return rows.find((r) => r.sheet === sheet && r.cell === cell);
}

describe("Theme 1b — WORKBOOK_CELL_MAP entries for installerConfig", () => {
  const SHEET = "Deploy Management Domain";

  it("has entries covering every installerConfig field except passwords (which go through vault)", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === SHEET && e.scope === "per-fleet"
    );
    const labels = entries.map((e) => e.label).sort();
    expect(labels).toEqual([
      "Activation Code",
      "Depot Type",
      "Download Token",
      "Enable Proxy Server",
      "Offline Depot Hostname",
      "Offline Depot Port",
      "Proxy Authenticated",
      "Proxy Host",
      "Proxy Password",
      "Proxy Port",
      "Proxy Protocol",
      "Proxy Username",
    ].sort());
  });

  it("Proxy Password entry is flagged with passwordKind so it routes through the vault", () => {
    const pw = WORKBOOK_CELL_MAP.find((e) => e.label === "Proxy Password" && e.scope === "per-fleet");
    expect(pw).toBeTruthy();
    expect(pw.passwordKind).toBe("proxy");
  });

  it("Activation Code is 9.1-only", () => {
    const ac = WORKBOOK_CELL_MAP.find((e) => e.label === "Activation Code" && e.scope === "per-fleet");
    expect(ac.workbookVersions).toEqual(["9.1"]);
  });

  it("9.0 vs 9.1 proxy-block cells shift by one row (cellByVersion captures the shift)", () => {
    const enable = WORKBOOK_CELL_MAP.find((e) => e.label === "Enable Proxy Server" && e.scope === "per-fleet");
    expect(enable.cell).toBe("L13");
    expect(enable.cellByVersion["9.1"]).toBe("L14");

    const pw = WORKBOOK_CELL_MAP.find((e) => e.label === "Proxy Password" && e.scope === "per-fleet");
    expect(pw.cell).toBe("L19");
    expect(pw.cellByVersion["9.1"]).toBe("L20");
  });
});

describe("Theme 1b — emit semantics (9.1)", () => {
  it("stamps default Online + Unselected enums and empty strings for a fresh fleet", () => {
    const fleet = defaultFleet("9.1");
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, "Deploy Management Domain", "L9").value).toBe("Online");
    expect(findRow(rows, "Deploy Management Domain", "L10").value).toBe(""); // offline hostname
    expect(findRow(rows, "Deploy Management Domain", "L11").value).toBe("443");
    expect(findRow(rows, "Deploy Management Domain", "L12").value).toBe(""); // download token
    expect(findRow(rows, "Deploy Management Domain", "L13").value).toBe(""); // activation code (9.1)
    expect(findRow(rows, "Deploy Management Domain", "L14").value).toBe("Unselected"); // enable proxy
    expect(findRow(rows, "Deploy Management Domain", "L15").value).toBe("HTTPS"); // proxy protocol
    expect(findRow(rows, "Deploy Management Domain", "L18").value).toBe("Unselected"); // proxy auth
  });

  it("stamps user-set values through to the workbook cells", () => {
    const fleet = withInstaller(defaultFleet("9.1"), {
      depotType: "offline",
      offlineDepotHostname: "mirror.internal",
      offlineDepotPort: 8443,
      downloadToken: "TKN-001",
      activationCode: "ACT-CODE",
      proxyEnabled: true,
      proxyProtocol: "http",
      proxyHost: "proxy.dmz",
      proxyPort: 3128,
      proxyAuthenticated: true,
      proxyUser: "svc",
    });
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, "Deploy Management Domain", "L9").value).toBe("Offline");
    expect(findRow(rows, "Deploy Management Domain", "L10").value).toBe("mirror.internal");
    expect(findRow(rows, "Deploy Management Domain", "L11").value).toBe("8443");
    expect(findRow(rows, "Deploy Management Domain", "L12").value).toBe("TKN-001");
    expect(findRow(rows, "Deploy Management Domain", "L13").value).toBe("ACT-CODE");
    expect(findRow(rows, "Deploy Management Domain", "L14").value).toBe("Selected");
    expect(findRow(rows, "Deploy Management Domain", "L15").value).toBe("HTTP");
    expect(findRow(rows, "Deploy Management Domain", "L16").value).toBe("proxy.dmz");
    expect(findRow(rows, "Deploy Management Domain", "L17").value).toBe("3128");
    expect(findRow(rows, "Deploy Management Domain", "L18").value).toBe("Selected");
    expect(findRow(rows, "Deploy Management Domain", "L19").value).toBe("svc");
  });

  it("Proxy Password is NOT emitted via emitWorkbookCellMap (vault-only)", () => {
    const fleet = withInstaller(defaultFleet("9.1"), {
      proxyEnabled: true,
      proxyAuthenticated: true,
      proxyPassword: "should-not-leak",
    });
    const rows = emitWorkbookCellMap(fleet, null);
    // Slot L20 (9.1 proxy password) must not appear in the regular cell-map output.
    expect(findRow(rows, "Deploy Management Domain", "L20")).toBeUndefined();
    const anyProxyPwRow = rows.find((r) => r.label === "Proxy Password");
    expect(anyProxyPwRow).toBeUndefined();
  });
});

describe("Theme 1b — emit semantics (9.0)", () => {
  it("does NOT emit Activation Code on 9.0 (workbook row L13 is Enable Proxy in 9.0)", () => {
    const fleet = withInstaller(defaultFleet("9.0"), {
      activationCode: "set-but-ignored",
      proxyEnabled: true,
    });
    const rows = emitWorkbookCellMap(fleet, null);
    // L13 on 9.0 is Enable Proxy (Selected because we set proxyEnabled).
    expect(findRow(rows, "Deploy Management Domain", "L13").value).toBe("Selected");
    // Activation Code entry simply doesn't fire on 9.0.
    const acRow = rows.find((r) => r.label === "Activation Code");
    expect(acRow).toBeUndefined();
  });

  it("proxy block sits at L13-L19 on 9.0 (shifted up by one row vs 9.1)", () => {
    const fleet = withInstaller(defaultFleet("9.0"), {
      proxyEnabled: true,
      proxyAuthenticated: true,
      proxyHost: "p.example.com",
      proxyUser: "u",
    });
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, "Deploy Management Domain", "L13").value).toBe("Selected"); // enable
    expect(findRow(rows, "Deploy Management Domain", "L14").value).toBe("HTTPS");    // protocol
    expect(findRow(rows, "Deploy Management Domain", "L15").value).toBe("p.example.com"); // host
    expect(findRow(rows, "Deploy Management Domain", "L17").value).toBe("Selected"); // auth
    expect(findRow(rows, "Deploy Management Domain", "L18").value).toBe("u");        // user
    // Proxy password (vaulted) would be L19 — not in regular emit.
  });
});

describe("Theme 1b — CSV round-trip via importWorkbookCellMap", () => {
  it("reconstructs installerConfig from a stamped 9.1 CSV", () => {
    const original = withInstaller(defaultFleet("9.1"), {
      depotType: "offline",
      offlineDepotHostname: "depot.acme.com",
      offlineDepotPort: 9443,
      downloadToken: "DL-XYZ",
      activationCode: "ACT-9.1",
      proxyEnabled: true,
      proxyProtocol: "http",
      proxyHost: "proxy.acme.com",
      proxyPort: 8080,
      proxyAuthenticated: true,
      proxyUser: "ops",
      // proxyPassword intentionally absent — vaulted
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const result = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const rebuilt = result.fleet;
    expect(rebuilt.installerConfig.depotType).toBe("offline");
    expect(rebuilt.installerConfig.offlineDepotHostname).toBe("depot.acme.com");
    expect(rebuilt.installerConfig.offlineDepotPort).toBe(9443);
    expect(rebuilt.installerConfig.downloadToken).toBe("DL-XYZ");
    expect(rebuilt.installerConfig.activationCode).toBe("ACT-9.1");
    expect(rebuilt.installerConfig.proxyEnabled).toBe(true);
    expect(rebuilt.installerConfig.proxyProtocol).toBe("http");
    expect(rebuilt.installerConfig.proxyHost).toBe("proxy.acme.com");
    expect(rebuilt.installerConfig.proxyPort).toBe(8080);
    expect(rebuilt.installerConfig.proxyAuthenticated).toBe(true);
    expect(rebuilt.installerConfig.proxyUser).toBe("ops");
  });

  it("9.0 round-trip preserves the proxy-shift mapping", () => {
    const original = withInstaller(defaultFleet("9.0"), {
      proxyEnabled: true,
      proxyHost: "p90.example.com",
      proxyAuthenticated: true,
      proxyUser: "u90",
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const result = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    const rebuilt = result.fleet;
    expect(rebuilt.installerConfig.proxyEnabled).toBe(true);
    expect(rebuilt.installerConfig.proxyHost).toBe("p90.example.com");
    expect(rebuilt.installerConfig.proxyAuthenticated).toBe(true);
    expect(rebuilt.installerConfig.proxyUser).toBe("u90");
    expect(rebuilt.installerConfig.activationCode).toBe(""); // never set on 9.0
  });

  it("post-import fleet is migrateFleet-idempotent", () => {
    const original = withInstaller(defaultFleet("9.1"), {
      depotType: "offline",
      offlineDepotHostname: "round.trip",
      downloadToken: "T",
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    // Stamp version so migrateFleet treats `after` as a v9-format fleet and
    // doesn't route through migrateV3ToV5 (which strips top-level fields).
    // Real callers (e.g. the JSON import path) do this too.
    const after = { ...imported.fleet, version: "vcf-sizer-v9" };
    const migrated = migrateFleet(after);
    expect(migrated.installerConfig).toEqual(after.installerConfig);
  });
});

describe("Theme 1b — vault routing for proxyPassword", () => {
  it("generateWorkbookVault emits exactly one credential for proxy password", () => {
    const fleet = defaultFleet("9.1");
    const { vault, passwords } = generateWorkbookVault(fleet, { workbookVersion: "9.1" });
    const proxyCreds = (vault.credentials || []).filter((c) => c.credentialType === "proxy");
    expect(proxyCreds.length).toBe(1);
    const c = proxyCreds[0];
    expect(c.sheet).toBe("Deploy Management Domain");
    expect(c.cell).toBe("L20"); // 9.1 proxy password
    expect(typeof c.password).toBe("string");
    expect(c.password.length).toBe(PASSWORD_POLICY.proxy.len);
    expect(passwords.get("Deploy Management Domain!L20")).toBe(c.password);
  });

  it("9.0 vault places proxy password at L19", () => {
    const fleet = defaultFleet("9.0");
    const { vault } = generateWorkbookVault(fleet, { workbookVersion: "9.0" });
    const proxyCreds = (vault.credentials || []).filter((c) => c.credentialType === "proxy");
    expect(proxyCreds.length).toBe(1);
    expect(proxyCreds[0].cell).toBe("L19");
  });
});
