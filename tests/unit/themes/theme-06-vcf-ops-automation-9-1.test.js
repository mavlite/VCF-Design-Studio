// Theme 6 — VCF Operations / Automation appliance detail (9.1-only).
//
// Adds 11 new cell-map entries on Deploy Mgmt for fleet services that
// landed in 9.1:
//   VCF Ops cluster   L157  Primary Node FQDN     (emit-only, derived)
//                     L158  Replica Node FQDN     (emit-only)
//                     L159  Data Node FQDN        (emit-only)
//                     L161  Load Balancer FQDN    (emit-only)
//                     L163  Collector Plane FQDN  (emit-only)
//                     L165  Lifecycle FQDN        (emit-only)
//                     L167  Fleet Components FQDN (emit-only)
//   VCF Automation    L175  Appliance FQDN        (emit-only)
//   Mgmt identity     L182  Datacenter Name       (emit-only)
//                     L184  SSO Domain Name       (round-trips fleet.ssoDomain)
//                     L185  SSO Username          (emit-only, derived from ssoDomain)
//
// Only fleet.ssoDomain is a new model field — defaults to "vsphere.local".
// All FQDNs derive from instance.name + suffix + DNS primary domain,
// matching the existing fleet-services FQDN stubs.
//
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// 9.1.json 2026-05-25.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  migrateFleet,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

const SHEET = "Deploy Management Domain";

describe("Theme 6 — fleet.ssoDomain model field", () => {
  it("newFleet defaults ssoDomain to vsphere.local", () => {
    const f = newFleet();
    expect(f.ssoDomain).toBe("vsphere.local");
  });

  it("migrateFleet backfills missing ssoDomain", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    delete raw.ssoDomain;
    const migrated = migrateFleet(raw);
    expect(migrated.ssoDomain).toBe("vsphere.local");
  });

  it("migrateFleet preserves custom ssoDomain", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9", ssoDomain: "lab.local" };
    const migrated = migrateFleet(raw);
    expect(migrated.ssoDomain).toBe("lab.local");
  });

  it("migrateFleet trims whitespace and falls back on empty", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9", ssoDomain: "   " };
    const migrated = migrateFleet(raw);
    expect(migrated.ssoDomain).toBe("vsphere.local");
  });
});

describe("Theme 6 — WORKBOOK_CELL_MAP entries", () => {
  const EXPECTED_CELLS = {
    "VCF Ops Primary Node FQDN":     "L157",
    "VCF Ops Replica Node FQDN":     "L158",
    "VCF Ops Data Node FQDN":        "L159",
    "VCF Ops Load Balancer FQDN":    "L161",
    "VCF Ops Collector Plane FQDN":  "L163",
    "VCF Ops Lifecycle FQDN":        "L165",
    "VCF Ops Fleet Components FQDN": "L167",
    "VCF Automation Appliance FQDN": "L175",
    "Mgmt Datacenter Name":          "L182",
    "SSO Domain Name":               "L184",
    "SSO Administrator Username":    "L185",
  };

  // 3 entries got 9.0 backfill in a later PR: the Load Balancer FQDN
  // (L161 → L63), Datacenter Name (L182 → L93), and SSO Administrator
  // Username (L185 → L96) exist in 9.0 at row-shifted addresses with
  // matching labels. The other 8 stay 9.1-only.
  const DUAL_VERSION_LABELS_90 = {
    "VCF Ops Load Balancer FQDN": "L63",
    "Mgmt Datacenter Name": "L93",
    "SSO Administrator Username": "L96",
  };

  it("all 11 entries are present with correct 9.1 cells (8 9.1-only + 3 dual-version)", () => {
    for (const [label, cell] of Object.entries(EXPECTED_CELLS)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.sheet === SHEET);
      expect(e, `missing ${label}`).toBeTruthy();
      expect(e.cell).toBe(cell);
      if (label in DUAL_VERSION_LABELS_90) {
        expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
        expect(e.cellByVersion).toEqual({ "9.0": DUAL_VERSION_LABELS_90[label], "9.1": cell });
      } else {
        expect(e.workbookVersions).toEqual(["9.1"]);
      }
    }
  });

  it("10 of 11 are emit-only; only SSO Domain Name round-trips", () => {
    for (const [label] of Object.entries(EXPECTED_CELLS)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.sheet === SHEET);
      if (label === "SSO Domain Name") {
        expect(e.emitOnly).toBeFalsy();
        expect(typeof e.apply).toBe("function");
      } else {
        expect(e.emitOnly).toBe(true);
        expect(e.apply).toBeUndefined();
      }
    }
  });
});

describe("Theme 6 — emit semantics (9.1)", () => {
  it("derives VCF Ops FQDNs from instance name + suffix + DNS", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.instances[0].name = "lab-vcf01";
    f.networkConfig.dns = f.networkConfig.dns || {};
    f.networkConfig.dns.primaryDomain = "lab.local";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("L157").value).toBe("lab-vcf01-ops01a.lab.local");
    expect(find("L158").value).toBe("lab-vcf01-ops01b.lab.local");
    expect(find("L159").value).toBe("lab-vcf01-ops01c.lab.local");
    expect(find("L161").value).toBe("lab-vcf01-ops01.lab.local");
    expect(find("L163").value).toBe("lab-vcf01-cp01.lab.local");
    expect(find("L165").value).toBe("lab-vcf01-lc01.lab.local");
    expect(find("L167").value).toBe("lab-vcf01-fc01.lab.local");
    expect(find("L175").value).toBe("lab-vcf01-auto01.lab.local");
    expect(find("L182").value).toBe("lab-vcf01-m01-dc01");
  });

  it("emits FQDNs without DNS suffix when primaryDomain isn't set", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.instances[0].name = "vcf";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("L157").value).toBe("vcf-ops01a");
    expect(find("L175").value).toBe("vcf-auto01");
  });

  it("derives SSO Administrator Username from ssoDomain", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.ssoDomain = "corp.example.com";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("L184").value).toBe("corp.example.com");
    expect(find("L185").value).toBe("administrator@corp.example.com");
  });

  it("does NOT emit theme 6 entries on a 9.0 fleet (9.1-only gating)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => r.cell === "L184" && r.label === "SSO Domain Name")).toBeUndefined();
    expect(rows.find((r) => r.cell === "L157" && r.label === "VCF Ops Primary Node FQDN")).toBeUndefined();
  });
});

describe("Theme 6 — import round-trip", () => {
  it("SSO Domain Name round-trips through CSV", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    original.ssoDomain = "rainpole.io";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    expect(rebuilt.ssoDomain).toBe("rainpole.io");
  });

  it("SSO Domain Name apply falls back to vsphere.local on empty input", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: SHEET, cell: "L184", label: "SSO Domain Name", value: "" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(rebuilt.ssoDomain).toBe("vsphere.local");
  });

  it("emit-only FQDN cells appear as skipped on import (intentionally)", () => {
    const csv = emitWorkbookCellMapCsv(
      { ...newFleet(), vcfVersion: "9.1" },
      null,
      { workbookVersion: "9.1" }
    );
    const parsed = parseWorkbookCellMap(csv);
    const { skipped } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const opsPrimarySkipped = skipped.find((s) => s.row.label === "VCF Ops Primary Node FQDN");
    expect(opsPrimarySkipped).toBeTruthy();
    expect(opsPrimarySkipped.reason).toMatch(/emit-only/);
  });
});
