// Theme 7b — AD bind + Certificate Authority + CSR subject workbook export.
//
// Source model: fleet.adConfig (shipped by theme 7a). Workbook layout
// shifts +1 row between 9.0 and 9.1 across the entire block. Cells
// verified against test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json
// 2026-05-25.
//
// Conservative scope: only cells with LITERAL placeholder samples
// (not formula derivations) are exported. The repeated FQDN/User/Password
// blocks at D37-D49 (9.0) carry formula samples and represent workbook-
// derived views; those are skipped. The OpenSSL alternative path at
// D67-D84 (9.0) is also skipped pending an unambiguous model mapping.
//
// Target cells (Configure Management Domain, instance scope):
//   AD Bind FQDN                    D33 / D34
//   AD Bind User                    D34 / D35
//   AD Bind Password (vault)        D35 / D36   passwordKind: "ad-bind"
//   CA Template Name                D45 / D46
//   AD Service Account Username     D50 / D51
//   CA Type                         D52 / D53
//   CA Admin Password               D55 / D56
//   CA Algorithm                    D58 / D59
//   CSR Organization                D59 / D60
//   CSR Organizational Unit         D60 / D61
//   CSR Country                     D61 / D62
//   CSR State                       D62 / D63
//   CSR Locality                    D63 / D64
//   CSR Email                       D64 / D65
//   CA Key Size                     D65 / D66

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  createFleetAdConfig,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  generateWorkbookVault,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

const SHEET = "Configure Management Domain";

const NEW_LABELS = [
  "AD Bind FQDN",
  "AD Bind User",
  "AD Bind Password",
  "CA Template Name",
  "AD Service Account Username",
  "CA Type",
  "CA Admin Password",
  "CA Algorithm",
  "CSR Organization",
  "CSR Organizational Unit",
  "CSR Country",
  "CSR State",
  "CSR Locality",
  "CSR Email",
  "CA Key Size",
];

const EXPECTED_CELLS = {
  "AD Bind FQDN":                 { v90: "D33", v91: "D34" },
  "AD Bind User":                 { v90: "D34", v91: "D35" },
  "AD Bind Password":             { v90: "D35", v91: "D36" },
  "CA Template Name":             { v90: "D45", v91: "D46" },
  "AD Service Account Username":  { v90: "D50", v91: "D51" },
  "CA Type":                      { v90: "D52", v91: "D53" },
  "CA Admin Password":            { v90: "D55", v91: "D56" },
  "CA Algorithm":                 { v90: "D58", v91: "D59" },
  "CSR Organization":             { v90: "D59", v91: "D60" },
  "CSR Organizational Unit":      { v90: "D60", v91: "D61" },
  "CSR Country":                  { v90: "D61", v91: "D62" },
  "CSR State":                    { v90: "D62", v91: "D63" },
  "CSR Locality":                 { v90: "D63", v91: "D64" },
  "CSR Email":                    { v90: "D64", v91: "D65" },
  "CA Key Size":                  { v90: "D65", v91: "D66" },
};

function findEntry(label) {
  return WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "instance");
}

function fleetWithAd() {
  const f = newFleet();
  f.adConfig = {
    adFqdn: "dc01.rainpole.io",
    adUser: "Administrator",
    adPassword: "vault-overrides-this",
    serviceAccountUser: "svc-vcf-ca",
    ca: {
      type: "openssl",
      fqdn: "ca.rainpole.io",
      url: "https://ca.rainpole.io/certsrv",
      user: "ca-admin",
      password: "ca-pw-1",
      templateName: "CustomTemplate",
      algorithm: "ECDSA",
      keySize: 3072,
      csrSubject: {
        org: "Rainpole",
        ou: "Engineering",
        country: "GB",
        state: "London",
        locality: "City of London",
        email: "ops@rainpole.io",
      },
    },
  };
  return f;
}

describe("Theme 7b — WORKBOOK_CELL_MAP entries", () => {
  it("all 15 new AD/CA entries present on instance scope", () => {
    for (const label of NEW_LABELS) {
      const e = findEntry(label);
      expect(e, `missing cell-map entry: ${label}`).toBeTruthy();
      expect(e.sheet).toBe(SHEET);
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    }
  });

  it("each entry targets the documented (9.0, 9.1) cell pair", () => {
    for (const [label, { v90, v91 }] of Object.entries(EXPECTED_CELLS)) {
      const e = findEntry(label);
      expect(e.cell, `${label} 9.0 cell`).toBe(v90);
      expect(e.cellByVersion["9.1"], `${label} 9.1 cell`).toBe(v91);
    }
  });

  it("AD Bind Password is vault-flow (passwordKind ad-bind, emitOnly)", () => {
    const pw = findEntry("AD Bind Password");
    expect(pw.passwordKind).toBe("ad-bind");
    expect(pw.emitOnly).toBe(true);
    expect(typeof pw.apply).toBe("undefined");
  });

  it("non-password entries each carry resolve + apply", () => {
    const dataEntries = NEW_LABELS.filter((l) => l !== "AD Bind Password");
    for (const label of dataEntries) {
      const e = findEntry(label);
      expect(typeof e.resolve, `${label} resolve`).toBe("function");
      expect(typeof e.apply, `${label} apply`).toBe("function");
      expect(e.emitOnly).toBeFalsy();
      expect(e.passwordKind).toBeFalsy();
    }
  });

  it("CA Type / CA Algorithm / CA Key Size carry dataValidation enums", () => {
    expect(findEntry("CA Type").dataValidation).toEqual(["Microsoft", "OpenSSL"]);
    expect(findEntry("CA Algorithm").dataValidation).toEqual(["RSA", "ECDSA"]);
    expect(findEntry("CA Key Size").dataValidation).toEqual(["2048", "3072", "4096"]);
  });
});

describe("Theme 7b — emit semantics", () => {
  it("emits factory defaults to the right cells on a 9.1 fleet", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("D34").value).toBe("");          // adFqdn empty default
    expect(find("D35").value).toBe("");          // adUser
    expect(find("D46").value).toBe("VMware");    // CA template default
    expect(find("D51").value).toBe("");          // service account
    expect(find("D53").value).toBe("Microsoft"); // CA type capitalized
    expect(find("D59").value).toBe("RSA");       // algorithm
    expect(find("D66").value).toBe("4096");      // key size as string
  });

  it("emits user-populated values into 9.0 cells (with case normalization)", () => {
    const f = fleetWithAd();
    f.vcfVersion = "9.0";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("D33").value).toBe("dc01.rainpole.io");
    expect(find("D34").value).toBe("Administrator");
    expect(find("D45").value).toBe("CustomTemplate");
    expect(find("D50").value).toBe("svc-vcf-ca");
    expect(find("D52").value).toBe("OpenSSL");        // ca.type "openssl" → "OpenSSL"
    expect(find("D55").value).toBe("ca-pw-1");
    expect(find("D58").value).toBe("ECDSA");
    expect(find("D59").value).toBe("Rainpole");
    expect(find("D60").value).toBe("Engineering");
    expect(find("D61").value).toBe("GB");
    expect(find("D62").value).toBe("London");
    expect(find("D63").value).toBe("City of London");
    expect(find("D64").value).toBe("ops@rainpole.io");
    expect(find("D65").value).toBe("3072");
  });

  it("DOES NOT emit the AD Bind Password cell on the normal cell-map (vault flow)", () => {
    const f = fleetWithAd();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const pwRow = rows.find((r) => r.sheet === SHEET && r.cell === "D36" && r.label === "AD Bind Password");
    expect(pwRow).toBeUndefined();
    const rows90 = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const pwRow90 = rows90.find((r) => r.sheet === SHEET && r.cell === "D35" && r.label === "AD Bind Password");
    expect(pwRow90).toBeUndefined();
  });
});

describe("Theme 7b — import round-trip", () => {
  it("CSV round-trip reconstructs every non-password adConfig field", () => {
    const original = fleetWithAd();
    original.vcfVersion = "9.1";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    expect(rebuilt.adConfig.adFqdn).toBe("dc01.rainpole.io");
    expect(rebuilt.adConfig.adUser).toBe("Administrator");
    expect(rebuilt.adConfig.serviceAccountUser).toBe("svc-vcf-ca");
    expect(rebuilt.adConfig.ca.type).toBe("openssl");                  // normalized lowercase
    expect(rebuilt.adConfig.ca.password).toBe("ca-pw-1");
    expect(rebuilt.adConfig.ca.templateName).toBe("CustomTemplate");
    expect(rebuilt.adConfig.ca.algorithm).toBe("ECDSA");
    expect(rebuilt.adConfig.ca.keySize).toBe(3072);
    expect(rebuilt.adConfig.ca.csrSubject.org).toBe("Rainpole");
    expect(rebuilt.adConfig.ca.csrSubject.ou).toBe("Engineering");
    expect(rebuilt.adConfig.ca.csrSubject.country).toBe("GB");
    expect(rebuilt.adConfig.ca.csrSubject.state).toBe("London");
    expect(rebuilt.adConfig.ca.csrSubject.locality).toBe("City of London");
    expect(rebuilt.adConfig.ca.csrSubject.email).toBe("ops@rainpole.io");
    // AD password never rides the cell-map.
    expect(rebuilt.adConfig.adPassword).toBe("");
  });

  it("CA Type apply normalizes case and rejects garbage", () => {
    const ms = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D53", label: "CA Type", value: "microsoft" }],
      { workbookVersion: "9.1" }
    );
    const os = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D53", label: "CA Type", value: "OpenSSL" }],
      { workbookVersion: "9.1" }
    );
    const garbage = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D53", label: "CA Type", value: "Verisign" }],
      { workbookVersion: "9.1" }
    );
    expect(ms.fleet.adConfig.ca.type).toBe("microsoft");
    expect(os.fleet.adConfig.ca.type).toBe("openssl");
    expect(garbage.fleet.adConfig.ca.type).toBe("microsoft");          // falls back to default
  });

  it("CA Algorithm apply normalizes to RSA/ECDSA", () => {
    const rsa = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D59", label: "CA Algorithm", value: "rsa" }],
      { workbookVersion: "9.1" }
    );
    const ecdsa = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D59", label: "CA Algorithm", value: "ecdsa" }],
      { workbookVersion: "9.1" }
    );
    const garbage = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D59", label: "CA Algorithm", value: "DSA" }],
      { workbookVersion: "9.1" }
    );
    expect(rsa.fleet.adConfig.ca.algorithm).toBe("RSA");
    expect(ecdsa.fleet.adConfig.ca.algorithm).toBe("ECDSA");
    expect(garbage.fleet.adConfig.ca.algorithm).toBe("RSA");
  });

  it("CA Key Size apply restricts to {2048, 3072, 4096}", () => {
    const ok = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D66", label: "CA Key Size", value: "2048" }],
      { workbookVersion: "9.1" }
    );
    const bad = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D66", label: "CA Key Size", value: "9999" }],
      { workbookVersion: "9.1" }
    );
    expect(ok.fleet.adConfig.ca.keySize).toBe(2048);
    expect(bad.fleet.adConfig.ca.keySize).toBe(4096);
  });

  it("CSR Country apply truncates >2-letter input and uppercases", () => {
    const r = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D62", label: "CSR Country", value: "usa" }],
      { workbookVersion: "9.1" }
    );
    expect(r.fleet.adConfig.ca.csrSubject.country).toBe("US");
  });
});

describe("Theme 7b — vault inclusion", () => {
  it("generateWorkbookVault includes the AD Bind Password on a 9.1 fleet", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const { vault } = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const cred = vault.credentials.find((c) => c.credentialType === "ad-bind");
    expect(cred, "vault must include the ad-bind credential").toBeTruthy();
    expect(cred.sheet).toBe(SHEET);
    expect(cred.cell).toBe("D36");
    expect(cred.password).toHaveLength(20);
  });

  it("ad-bind credential is unique per generation (CSPRNG)", () => {
    const f = newFleet();
    const a = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const b = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const pwA = a.vault.credentials.find((c) => c.credentialType === "ad-bind").password;
    const pwB = b.vault.credentials.find((c) => c.credentialType === "ad-bind").password;
    expect(pwA).not.toBe(pwB);
  });

  it("encryption-passphrase + sftp-backup credentials still present (no regression)", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const { vault } = generateWorkbookVault(f, { workbookVersion: "9.1" });
    expect(vault.credentials.find((c) => c.credentialType === "encryption-passphrase")).toBeTruthy();
    expect(vault.credentials.find((c) => c.credentialType === "sftp-backup")).toBeTruthy();
  });
});
