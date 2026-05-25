// Theme 16 — EVC / advanced cluster settings (9.1-only).
//
// Three fields under the "Possible Advanced Settings" section at row 410
// on the Deploy Management Domain sheet. Mgmt-cluster scope. All entries
// gated workbookVersions: ["9.1"]. Cells verified against
// test-fixtures/workbook/workbook-cell-meta-9.1.json 2026-05-24.
//
// Target cells (Deploy Management Domain):
//   EVC Setting             L411   labelText "EVC Setting"
//   Node Name Prefix        L412   labelText "Node Name Prefix"
//   Internal Cluster CIDR   L413   labelText "Internal Cluster CIDR"
//
// Schema: cluster.advanced = { evcSetting, nodeNamePrefix, internalClusterCidr }
// internalClusterCidr defaults to "198.18.0.0/15" (the K413 sample, also
// the VCFMS internal pod CIDR per VCF-9.1-DELTA.md). The other two
// default to empty string — leaves the workbook's K-column sample value
// alone.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newCluster,
  newMgmtCluster,
  migrateFleet,
  baseClusterAdvanced,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

const SHEET = "Deploy Management Domain";
const ENTRY_LABELS = ["EVC Setting", "Node Name Prefix", "Internal Cluster CIDR"];
const ENTRY_CELLS = { "EVC Setting": "L411", "Node Name Prefix": "L412", "Internal Cluster CIDR": "L413" };

function fleet91() {
  return { ...newFleet(), vcfVersion: "9.1", version: "vcf-sizer-v9" };
}

function mgmtCluster(fleet) {
  const inst = fleet.instances[0];
  const mgmt = inst.domains.find((d) => d.type === "mgmt");
  return mgmt.clusters[0];
}

describe("Theme 16 — data model", () => {
  it("baseClusterAdvanced() returns the documented shape", () => {
    const adv = baseClusterAdvanced();
    expect(adv).toEqual({
      evcSetting: "",
      nodeNamePrefix: "",
      internalClusterCidr: "198.18.0.0/15",
    });
  });

  it("newCluster() initializes advanced via baseClusterAdvanced", () => {
    const c = newCluster();
    expect(c.advanced).toEqual(baseClusterAdvanced());
  });

  it("newMgmtCluster() initializes advanced via baseClusterAdvanced", () => {
    const c = newMgmtCluster();
    expect(c.advanced).toEqual(baseClusterAdvanced());
  });

  it("baseClusterAdvanced returns a fresh object on each call (no shared state)", () => {
    const a = baseClusterAdvanced();
    const b = baseClusterAdvanced();
    a.evcSetting = "Intel Skylake";
    expect(b.evcSetting).toBe("");
  });
});

describe("Theme 16 — migrateFleet backfill", () => {
  it("backfills advanced on legacy clusters that lack it", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    delete mgmtCluster(raw).advanced;
    const migrated = migrateFleet(raw);
    expect(mgmtCluster(migrated).advanced).toEqual(baseClusterAdvanced());
  });

  it("preserves customized advanced fields on round-trip (idempotent)", () => {
    const f = fleet91();
    mgmtCluster(f).advanced = {
      evcSetting: "Intel Skylake Generation",
      nodeNamePrefix: "lab-mgmt",
      internalClusterCidr: "10.244.0.0/14",
    };
    const round1 = migrateFleet(f);
    const round2 = migrateFleet(round1);
    expect(mgmtCluster(round2).advanced).toEqual({
      evcSetting: "Intel Skylake Generation",
      nodeNamePrefix: "lab-mgmt",
      internalClusterCidr: "10.244.0.0/14",
    });
  });

  it("drops unknown keys on migration (whitelist merge)", () => {
    const f = fleet91();
    mgmtCluster(f).advanced = { evcSetting: "AMD Zen 4", bogusField: "junk" };
    const migrated = migrateFleet(f);
    const adv = mgmtCluster(migrated).advanced;
    expect(adv.evcSetting).toBe("AMD Zen 4");
    expect(adv).not.toHaveProperty("bogusField");
    // Missing fields fall back to factory defaults.
    expect(adv.nodeNamePrefix).toBe("");
    expect(adv.internalClusterCidr).toBe("198.18.0.0/15");
  });
});

describe("Theme 16 — WORKBOOK_CELL_MAP entries", () => {
  it("all 3 entries present on mgmt-cluster scope", () => {
    for (const label of ENTRY_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(e, `missing cell-map entry: ${label}`).toBeTruthy();
      expect(e.sheet).toBe(SHEET);
    }
  });

  it("all 3 entries are 9.1-only", () => {
    for (const label of ENTRY_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
  });

  it("each entry targets the documented L4xx cell", () => {
    for (const [label, cell] of Object.entries(ENTRY_CELLS)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(e.cell, `${label} cell`).toBe(cell);
      // Workbook labels are stable; no cellByVersion override needed.
      expect(e.cellByVersion).toBeUndefined();
    }
  });

  it("each entry carries resolve + apply (not emit-only)", () => {
    for (const label of ENTRY_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(typeof e.resolve).toBe("function");
      expect(typeof e.apply).toBe("function");
      expect(e.emitOnly).toBeFalsy();
      expect(e.passwordKind).toBeFalsy();
    }
  });
});

describe("Theme 16 — emit semantics", () => {
  it("emits factory defaults at the right cells on a 9.1 fleet", () => {
    const f = fleet91();
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("L411").value).toBe("");
    expect(find("L412").value).toBe("");
    expect(find("L413").value).toBe("198.18.0.0/15");
  });

  it("emits customized values when cluster.advanced is set", () => {
    const f = fleet91();
    mgmtCluster(f).advanced = {
      evcSetting: "Intel Sapphire Rapids",
      nodeNamePrefix: "lab-m01",
      internalClusterCidr: "10.250.0.0/15",
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("L411").value).toBe("Intel Sapphire Rapids");
    expect(find("L412").value).toBe("lab-m01");
    expect(find("L413").value).toBe("10.250.0.0/15");
  });

  it("emits NO rows for these cells on a 9.0 fleet (9.1-only gate)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const advRows = rows.filter((r) => r.sheet === SHEET && ["L411", "L412", "L413"].includes(r.cell));
    expect(advRows).toEqual([]);
  });
});

describe("Theme 16 — import round-trip", () => {
  it("import-then-emit reconstructs cluster.advanced exactly", () => {
    const original = fleet91();
    mgmtCluster(original).advanced = {
      evcSetting: "AMD EPYC Generation",
      nodeNamePrefix: "prod-m01",
      internalClusterCidr: "172.16.0.0/15",
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).advanced.evcSetting).toBe("AMD EPYC Generation");
    expect(mgmtCluster(rebuilt).advanced.nodeNamePrefix).toBe("prod-m01");
    expect(mgmtCluster(rebuilt).advanced.internalClusterCidr).toBe("172.16.0.0/15");
  });

  it("empty L413 value in input falls back to workbook default on apply", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: SHEET, cell: "L411", label: "EVC Setting", value: "Intel Skylake" },
      { workbookVersion: "9.1", sheet: SHEET, cell: "L412", label: "Node Name Prefix", value: "" },
      { workbookVersion: "9.1", sheet: SHEET, cell: "L413", label: "Internal Cluster CIDR", value: "" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const adv = mgmtCluster(rebuilt).advanced;
    expect(adv.evcSetting).toBe("Intel Skylake");
    expect(adv.nodeNamePrefix).toBe("");
    // L413 apply() coerces empty back to the workbook sample default
    // (matches the CIDR field's role — empty is never a valid CIDR).
    expect(adv.internalClusterCidr).toBe("198.18.0.0/15");
  });
});
