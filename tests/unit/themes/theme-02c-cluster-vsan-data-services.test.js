// Theme 2c — Additional-cluster vSAN data services (Deploy Cluster sheet).
//
// Mirror of theme 2 (mgmt-cluster) and theme 2b (workload-cluster) onto
// the "Deploy Cluster" sheet, targeting the second-and-beyond clusters
// of each workload domain (scope: "additional-cluster"). Cells verified
// against test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json
// 2026-05-24.
//
// Target cells (Deploy Cluster sheet):
//   FTT                  D131 / D143   verifyLabel: "vSAN: Failures to Tolerate"
//   Dedup/Compression    D132 / D144   "vSAN: Deduplication and Compression"   Selected/Unselected
//   vSAN Datastore Name  D129 / D141   "vSAN Datastore Name"
//   NFS Datastore Name   D134 / D146   "NFS: Datastore Name"  (stamps shared `datastoreName`)
//   NFS Share Path       D135 / D147   "NFS: Share Path"
//   NFS Server IP        D136 / D148   "NFS: Address of NFS Server"
//
// Scope differences vs. theme 2 / 2b:
//   - No DIT/rekey cells on this sheet (additional clusters inherit DIT
//     settings from their parent WLD).
//   - NFS labels stable across 9.0/9.1 (no rewording like WLD sheet).
//   - No schema additions; reuses fields shipped by theme 2.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  importWorkbookCellMap,
  parseWorkbookCellMap,
  WORKBOOK_CELL_MAP,
  sizeFleet,
} = VcfEngine;

function fleetWithAdditionalCluster(vcfVersion = "9.1") {
  const fleet = newFleet();
  fleet.vcfVersion = vcfVersion;
  fleet.version = "vcf-sizer-v9";
  const wld = newWorkloadDomain("WLD-01");
  // Two clusters: index 0 = workload-cluster (theme 2b), index 1 = additional-cluster (theme 2c).
  wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
  fleet.instances[0].domains.push(wld);
  return fleet;
}

function findRow(rows, sheet, cell) {
  return rows.find((r) => r.sheet === sheet && r.cell === cell);
}

function additionalCluster(fleet) {
  const wld = fleet.instances[0].domains.find((d) => d.type === "workload");
  return wld.clusters[1];                              // second cluster = additional
}

const SHEET = "Deploy Cluster";

describe("Theme 2c — WORKBOOK_CELL_MAP entries (additional-cluster scope)", () => {
  const NEW_LABELS = [
    "Cluster Failures to Tolerate",
    "Cluster vSAN Dedup and Compression",
    "Cluster vSAN Datastore Name",
    "Cluster NFS Datastore Name",
    "Cluster NFS Share Path",
    "Cluster NFS Server IP",
  ];

  it("all 6 new entries are present on additional-cluster scope", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "additional-cluster");
      expect(e, `missing cell-map entry: ${label}`).toBeTruthy();
      expect(e.sheet).toBe(SHEET);
    }
  });

  it("all 6 entries are dual-version (no 9.1-only DIT cells on this sheet)", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "additional-cluster");
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    }
  });

  it("cellByVersion carries the 9.0 → 9.1 row shifts", () => {
    const expected = {
      "Cluster Failures to Tolerate":       { v90: "D131", v91: "D143" },
      "Cluster vSAN Dedup and Compression": { v90: "D132", v91: "D144" },
      "Cluster vSAN Datastore Name":        { v90: "D129", v91: "D141" },
      "Cluster NFS Datastore Name":         { v90: "D134", v91: "D146" },
      "Cluster NFS Share Path":             { v90: "D135", v91: "D147" },
      "Cluster NFS Server IP":              { v90: "D136", v91: "D148" },
    };
    for (const [label, { v90, v91 }] of Object.entries(expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "additional-cluster");
      expect(e.cell, `${label} 9.0 cell`).toBe(v90);
      expect(e.cellByVersion["9.1"], `${label} 9.1 cell`).toBe(v91);
    }
  });

  it("NFS labels do NOT need verifyLabelByVersion (stable across 9.0/9.1)", () => {
    const labels = ["Cluster NFS Datastore Name", "Cluster NFS Share Path", "Cluster NFS Server IP"];
    for (const label of labels) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "additional-cluster");
      expect(e.verifyLabelByVersion).toBeUndefined();
      expect(e.verifyLabel).toBeTruthy();
    }
  });

  it("no DIT cells on additional-cluster scope (inherits from parent WLD)", () => {
    const dit = WORKBOOK_CELL_MAP.filter(
      (x) => x.scope === "additional-cluster" && /\bDIT\b|Rekey|Data-in-Transit/i.test(x.label)
    );
    expect(dit).toEqual([]);
  });
});

describe("Theme 2c — emit semantics (9.1)", () => {
  it("stamps factory defaults to the workbook cells", () => {
    const fleet = fleetWithAdditionalCluster("9.1");
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, SHEET, "D143").value).toBe("1");           // FTT
    expect(findRow(rows, SHEET, "D144").value).toBe("Unselected");   // Dedup
    expect(findRow(rows, SHEET, "D141").value).toBe("");             // vSAN Datastore Name
    expect(findRow(rows, SHEET, "D146").value).toBe("");             // NFS Datastore Name
    expect(findRow(rows, SHEET, "D147").value).toBe("");             // NFS Share Path
    expect(findRow(rows, SHEET, "D148").value).toBe("");             // NFS Server IP
  });

  it("stamps user-set values for the additional cluster", () => {
    const fleet = fleetWithAdditionalCluster("9.1");
    Object.assign(additionalCluster(fleet).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "addl-cl-ds",
      nfs: { sharePath: "/share/addl", serverIp: "10.30.30.30", boundToVmknic: true },
    });
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, SHEET, "D143").value).toBe("2");
    expect(findRow(rows, SHEET, "D144").value).toBe("Selected");
    expect(findRow(rows, SHEET, "D141").value).toBe("addl-cl-ds");
    expect(findRow(rows, SHEET, "D146").value).toBe("addl-cl-ds");   // same value stamped to NFS cell
    expect(findRow(rows, SHEET, "D147").value).toBe("/share/addl");
    expect(findRow(rows, SHEET, "D148").value).toBe("10.30.30.30");
  });

  it("only stamps Deploy Cluster rows for fleets that actually have additional clusters", () => {
    const fleet = newFleet();                                         // single mgmt domain, no WLDs
    fleet.vcfVersion = "9.1";
    fleet.version = "vcf-sizer-v9";
    const wld = newWorkloadDomain("WLD-only-one-cluster");           // WLD with single cluster
    fleet.instances[0].domains.push(wld);
    const rows = emitWorkbookCellMap(fleet, null);
    expect(rows.find((r) => r.sheet === SHEET && r.cell === "D143")).toBeUndefined();
  });

  it("emit context is the SECOND cluster of the WLD, not the first", () => {
    const fleet = fleetWithAdditionalCluster("9.1");
    // First WLD cluster (workload-cluster scope) gets a distinct value
    fleet.instances[0].domains.find((d) => d.type === "workload").clusters[0].storage.dataServices.datastoreName = "FIRST";
    // Second WLD cluster (additional-cluster scope) gets the value we're testing for
    additionalCluster(fleet).storage.dataServices.datastoreName = "SECOND";
    const rows = emitWorkbookCellMap(fleet, null);
    // Deploy Cluster D141 should carry "SECOND", not "FIRST".
    expect(findRow(rows, SHEET, "D141").value).toBe("SECOND");
  });
});

describe("Theme 2c — emit semantics (9.0)", () => {
  it("dual-version cells land at the 9.0 addresses", () => {
    const fleet = fleetWithAdditionalCluster("9.0");
    Object.assign(additionalCluster(fleet).storage.dataServices, {
      ftt: 2,
      datastoreName: "ds90addl",
      nfs: { sharePath: "/p90addl", serverIp: "8.8.8.8", boundToVmknic: true },
    });
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, SHEET, "D129").value).toBe("ds90addl");
    expect(findRow(rows, SHEET, "D131").value).toBe("2");
    expect(findRow(rows, SHEET, "D134").value).toBe("ds90addl");
    expect(findRow(rows, SHEET, "D135").value).toBe("/p90addl");
    expect(findRow(rows, SHEET, "D136").value).toBe("8.8.8.8");
  });
});

describe("Theme 2c — CSV round-trip via importWorkbookCellMap", () => {
  it("rebuilds additional-cluster dataServices from a stamped 9.1 CSV", () => {
    const original = fleetWithAdditionalCluster("9.1");
    Object.assign(additionalCluster(original).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "addl-rt",
      nfs: { sharePath: "/nfs/addl-rt", serverIp: "10.60.60.60", boundToVmknic: true },
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const ds = additionalCluster(imported.fleet).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(true);
    expect(ds.datastoreName).toBe("addl-rt");
    expect(ds.nfs.sharePath).toBe("/nfs/addl-rt");
    expect(ds.nfs.serverIp).toBe("10.60.60.60");
  });

  it("9.0 round-trip preserves all dual-version fields", () => {
    const original = fleetWithAdditionalCluster("9.0");
    Object.assign(additionalCluster(original).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "ds90rt",
      nfs: { sharePath: "/p90rt", serverIp: "9.9.9.9", boundToVmknic: true },
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    const ds = additionalCluster(imported.fleet).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(true);
    expect(ds.datastoreName).toBe("ds90rt");
    expect(ds.nfs.sharePath).toBe("/p90rt");
    expect(ds.nfs.serverIp).toBe("9.9.9.9");
  });

  it("post-import fleet is migrateFleet-idempotent", () => {
    const original = fleetWithAdditionalCluster("9.1");
    additionalCluster(original).storage.dataServices.ftt = 2;
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const after = { ...imported.fleet, version: "vcf-sizer-v9" };
    const migrated = migrateFleet(after);
    expect(additionalCluster(migrated).storage.dataServices).toEqual(additionalCluster(after).storage.dataServices);
  });

  it("round-trips THREE additional clusters with distinct values per cluster", () => {
    // Exercises the per-cell-address import cursor: each unique cell
    // address sees the same number of occurrences (one per additional
    // cluster), and each advance lands on the next cluster context.
    const original = newFleet();
    original.vcfVersion = "9.1";
    original.version = "vcf-sizer-v9";
    const wld = newWorkloadDomain("WLD-multi");
    wld.clusters.push(newWorkloadCluster("addl-1"));
    wld.clusters.push(newWorkloadCluster("addl-2"));
    wld.clusters.push(newWorkloadCluster("addl-3"));
    original.instances[0].domains.push(wld);
    // Distinct datastoreName per additional cluster
    wld.clusters[1].storage.dataServices.datastoreName = "ds-addl-1";
    wld.clusters[2].storage.dataServices.datastoreName = "ds-addl-2";
    wld.clusters[3].storage.dataServices.datastoreName = "ds-addl-3";
    wld.clusters[1].storage.dataServices.ftt = 2;
    wld.clusters[3].storage.dataServices.ftt = 2;

    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const wldOut = imported.fleet.instances[0].domains.find((d) => d.type === "workload");

    // 4 total: 1 primary workload-cluster + 3 additional. Import grows
    // the WLD skeleton to match the max occurrence count of additional-
    // cluster cells (was 1 per cluster before theme 2c; now 7 per
    // cluster, so naive row-counting would have spawned 21 clusters).
    expect(wldOut.clusters.length).toBe(4);
    expect(wldOut.clusters[1].storage.dataServices.datastoreName).toBe("ds-addl-1");
    expect(wldOut.clusters[2].storage.dataServices.datastoreName).toBe("ds-addl-2");
    expect(wldOut.clusters[3].storage.dataServices.datastoreName).toBe("ds-addl-3");
    expect(wldOut.clusters[1].storage.dataServices.ftt).toBe(2);
    expect(wldOut.clusters[2].storage.dataServices.ftt).toBe(1);
    expect(wldOut.clusters[3].storage.dataServices.ftt).toBe(2);
  });
});

describe("Theme 2c — no regression on sizing", () => {
  it("sizeFleet still computes totals for a fleet with additional cluster", () => {
    const fleet = fleetWithAdditionalCluster("9.1");
    const result = sizeFleet(fleet);
    expect(result.totalHosts).toBeGreaterThan(0);
  });
});
