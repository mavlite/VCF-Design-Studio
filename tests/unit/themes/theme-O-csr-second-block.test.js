import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme O sub-theme 1 — CSR duplicate / delivery-context block.
//
// The 17 entries at Configure Mgmt D67-D84 (9.0) / D68-D85 (9.1) ship
// without direct test coverage in the original PR. This file fills
// the gap with cell-map presence, dual-version, dropdown enum, and
// round-trip assertions per the 3-agent review findings.

const {
  newFleet,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  generateWorkbookVault,
  PASSWORD_POLICY,
} = VcfEngine;

const MGMT_SHEET = "Configure Management Domain";

function findEntry(label) {
  return WORKBOOK_CELL_MAP.find((e) => e.label === label);
}

describe("Theme O sub-theme 1 — CSR duplicate block entries", () => {
  it("ships 17 dual-version entries (CA type + Common Name + CSR subject + algo/keysize + delivery-context echo + MS-CA bind)", () => {
    const labels = [
      ["CA Type (Second Block)", "D67", "D68"],
      ["CSR Common Name", "D68", "D69"],
      ["CSR Country (Second Block)", "D69", "D70"],
      ["CSR Locality (Second Block)", "D70", "D71"],
      ["CSR Organization (Second Block)", "D71", "D72"],
      ["CSR Organizational Unit (Second Block)", "D72", "D73"],
      ["CSR State (Second Block)", "D73", "D74"],
      ["CA Algorithm (Second Block)", "D75", "D76"],
      ["CA Key Size (Second Block)", "D76", "D77"],
      ["CSR Email (Second Block)", "D77", "D78"],
      ["CSR OU (Echo)", "D78", "D79"],
      ["CSR Organization (Echo)", "D79", "D80"],
      ["CSR Locality (Echo)", "D80", "D81"],
      ["CSR State (Echo)", "D81", "D82"],
      ["CSR Country (Echo)", "D82", "D83"],
      ["CA Admin Username (Second Block)", "D83", "D84"],
      ["CA Admin Password (Second Block)", "D84", "D85"],
    ];
    for (const [label, c90, c91] of labels) {
      const e = findEntry(label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe(MGMT_SHEET);
      expect(e.cell).toBe(c90);
      expect(e.cellByVersion["9.1"]).toBe(c91);
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.scope).toBe("instance");
    }
  });

  it("CA Type (Second Block) enum and apply normalize to microsoft", () => {
    const e = findEntry("CA Type (Second Block)");
    expect(e.dataValidation).toEqual(["microsoft", "openssl"]);
    const f = newFleet();
    e.apply(f, {}, "bogus");
    expect(f.adConfig.ca.type).toBe("microsoft");
    e.apply(f, {}, "openssl");
    expect(f.adConfig.ca.type).toBe("openssl");
  });

  it("CA Algorithm (Second Block) enum and apply normalize to RSA", () => {
    const e = findEntry("CA Algorithm (Second Block)");
    expect(e.dataValidation).toEqual(["RSA", "ECDSA"]);
    const f = newFleet();
    e.apply(f, {}, "bogus");
    expect(f.adConfig.ca.algorithm).toBe("RSA");
    e.apply(f, {}, "ECDSA");
    expect(f.adConfig.ca.algorithm).toBe("ECDSA");
  });

  it("CA Key Size (Second Block) enum + bogus values fall back to 4096", () => {
    const e = findEntry("CA Key Size (Second Block)");
    expect(e.dataValidation).toEqual(["2048", "3072", "4096"]);
    const f = newFleet();
    e.apply(f, {}, "1024");           // invalid size
    expect(f.adConfig.ca.keySize).toBe(4096);
    e.apply(f, {}, "2048");
    expect(f.adConfig.ca.keySize).toBe(2048);
  });

  it("CA Admin Password (Second Block) ships as vault entry (passwordKind: ca-bind, emitOnly)", () => {
    const pwd = findEntry("CA Admin Password (Second Block)");
    expect(pwd.passwordKind).toBe("ca-bind");
    expect(pwd.emitOnly).toBe(true);
    expect(pwd.workbookVersions).toEqual(["9.0", "9.1"]);
  });
});

describe("Theme O sub-theme 1 — Common Name round-trip", () => {
  it("CSR commonName round-trips through CSV import", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    original.adConfig.ca.csrSubject.commonName = "sddc-mgr.lab.local";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });
    expect(rebuilt.adConfig.ca.csrSubject.commonName).toBe("sddc-mgr.lab.local");
  });

  it("emits CSR commonName at D69 (9.1) and D68 (9.0)", () => {
    const f = newFleet();
    f.adConfig.ca.csrSubject.commonName = "test-cn.example.com";

    const rows91 = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row91 = rows91.find((r) => r.label === "CSR Common Name");
    expect(row91.cell).toBe("D69");
    expect(row91.value).toBe("test-cn.example.com");

    const rows90 = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const row90 = rows90.find((r) => r.label === "CSR Common Name");
    expect(row90.cell).toBe("D68");
    expect(row90.value).toBe("test-cn.example.com");
  });
});

describe("Theme O sub-theme 1 — ca-bind vault flow", () => {
  it("ca-bind passwordKind is registered in PASSWORD_POLICY", () => {
    expect(PASSWORD_POLICY["ca-bind"]).toBeTruthy();
    expect(PASSWORD_POLICY["ca-bind"].len).toBe(16);
  });

  it("generateWorkbookVault produces a ca-bind credential on 9.1", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const { vault } = generateWorkbookVault(f, { scope: "camp-b", workbookVersion: "9.1" });
    const caCred = vault.credentials.find((c) => c.credentialType === "ca-bind");
    expect(caCred).toBeTruthy();
    expect(caCred.cell).toBe("D85");
    expect(typeof caCred.password).toBe("string");
    expect(caCred.password.length).toBe(16);
  });

  it("generateWorkbookVault produces ca-bind at D84 on 9.0", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    const { vault } = generateWorkbookVault(f, { scope: "camp-b", workbookVersion: "9.0" });
    const caCred = vault.credentials.find((c) => c.credentialType === "ca-bind");
    expect(caCred).toBeTruthy();
    expect(caCred.cell).toBe("D84");
  });
});
