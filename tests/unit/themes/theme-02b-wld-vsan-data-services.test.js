// Theme 2b — WLD vSAN data services (workload-cluster scope).
//
// Mirror of theme 2 (mgmt-cluster) onto the "Deploy Workload Domain"
// sheet, targeting the primary cluster of each workload domain
// (scope: "workload-cluster"). Cells verified against
// test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json 2026-05-24.
//
// Target cells (Deploy Workload Domain sheet):
//   FTT                     D203 / D214   verifyLabel: "vSAN: Failures to Tolerate"
//   Dedup/Compression       D204 / D219   "vSAN: Deduplication and Compression"   Selected/Unselected
//   vSAN Datastore Name     D201 / D212   "vSAN Datastore Name"
//   DIT Encryption On/Off      —  / D215   "Data-in-Transit encryption"           9.1-only, Selected/Unselected
//   DIT Rekey Mode             —  / D216   "Rekey interval"                       9.1-only, Default/Custom
//   DIT Rekey Interval (Def)   —  / D217   "Rekey interval - Default"             9.1-only
//   DIT Rekey Interval (Cust)  —  / D218   "Rekey interval - Custom"              9.1-only
//   NFS Datastore Name      D206 / D221   "NFS: Datastore Name"  (stamps shared `datastoreName`)
//   NFS Share Path          D207 / D222   verifyLabelByVersion: "NFS: Share Path" / "NFS: Folder"
//   NFS Server IP           D208 / D223   verifyLabelByVersion: "NFS: Address of NFS Server" / "NFS: Server IP Address"
//
// Schema delta vs. theme 2 (mgmt):
//   - `dataServices.dit.enabled` (boolean, default true) — wired to the
//     9.1-only D215 toggle. Mgmt + Deploy-Cluster sheets have no
//     equivalent cell so the field is only stamped on workload-cluster
//     scope.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  migrateFleet,
  baseStorageDataServices,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  importWorkbookCellMap,
  parseWorkbookCellMap,
  WORKBOOK_CELL_MAP,
  sizeFleet,
  validatePlacementConstraints,
} = VcfEngine;

function defaultFleetWithWld(vcfVersion = "9.1") {
  const fleet = newFleet();
  fleet.vcfVersion = vcfVersion;
  fleet.version = "vcf-sizer-v9";
  const wld = newWorkloadDomain("WLD-01");
  fleet.instances[0].domains.push(wld);
  return fleet;
}

function findRow(rows, sheet, cell) {
  return rows.find((r) => r.sheet === sheet && r.cell === cell);
}

function wldCluster(fleet) {
  const wld = fleet.instances[0].domains.find((d) => d.type === "workload");
  return wld.clusters[0];
}

const SHEET = "Deploy Workload Domain";

describe("Theme 2b — baseStorageDataServices.dit.enabled defaults", () => {
  it("dit.enabled is present and defaults true (matches pristine 9.1 D215 sampleValue)", () => {
    const ds = baseStorageDataServices();
    expect(ds.dit.enabled).toBe(true);
  });
});

describe("Theme 2b — migrateFleet backfills dit.enabled on legacy clusters", () => {
  it("legacy storage.dataServices.dit without enabled gets enabled=true", () => {
    const fleet = defaultFleetWithWld("9.1");
    wldCluster(fleet).storage.dataServices.dit = {
      rekeyMode: "Custom",
      rekeyInterval: "1 Day",
      rekeyHoursCustom: 720,
    };
    const migrated = migrateFleet(fleet);
    const dit = wldCluster(migrated).storage.dataServices.dit;
    expect(dit.enabled).toBe(true);                 // factory backfill
    expect(dit.rekeyMode).toBe("Custom");           // preserved
    expect(dit.rekeyHoursCustom).toBe(720);         // preserved
  });

  it("explicit dit.enabled=false survives migration (not overwritten by factory)", () => {
    const fleet = defaultFleetWithWld("9.1");
    wldCluster(fleet).storage.dataServices.dit.enabled = false;
    const migrated = migrateFleet(fleet);
    expect(wldCluster(migrated).storage.dataServices.dit.enabled).toBe(false);
  });
});

describe("Theme 2b — WORKBOOK_CELL_MAP entries (workload-cluster scope)", () => {
  const NEW_LABELS = [
    "WLD Failures to Tolerate",
    "WLD vSAN Dedup and Compression",
    "WLD vSAN Datastore Name",
    "WLD DIT Encryption Enabled",
    "WLD DIT Rekey Mode",
    "WLD DIT Rekey Interval (Default)",
    "WLD DIT Rekey Interval (Custom hours)",
    "WLD NFS Datastore Name",
    "WLD NFS Share Path",
    "WLD NFS Server IP",
  ];

  it("all 10 new entries are present on workload-cluster scope", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "workload-cluster");
      expect(e, `missing cell-map entry: ${label}`).toBeTruthy();
      expect(e.sheet).toBe(SHEET);
    }
  });

  it("DIT entries (D215-D218) are gated to 9.1 only", () => {
    const ditLabels = [
      "WLD DIT Encryption Enabled",
      "WLD DIT Rekey Mode",
      "WLD DIT Rekey Interval (Default)",
      "WLD DIT Rekey Interval (Custom hours)",
    ];
    for (const label of ditLabels) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "workload-cluster");
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
  });

  it("dual-version entries carry cellByVersion for the 9.0 → 9.1 row shift", () => {
    const expected = {
      "WLD Failures to Tolerate":         { v90: "D203", v91: "D214" },
      "WLD vSAN Dedup and Compression":   { v90: "D204", v91: "D219" },
      "WLD vSAN Datastore Name":          { v90: "D201", v91: "D212" },
      "WLD NFS Datastore Name":           { v90: "D206", v91: "D221" },
      "WLD NFS Share Path":               { v90: "D207", v91: "D222" },
      "WLD NFS Server IP":                { v90: "D208", v91: "D223" },
    };
    for (const [label, { v90, v91 }] of Object.entries(expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "workload-cluster");
      expect(e.cell, `${label} 9.0 cell`).toBe(v90);
      expect(e.cellByVersion["9.1"], `${label} 9.1 cell`).toBe(v91);
    }
  });

  it("NFS path / server entries carry verifyLabelByVersion (workbook label reworded 9.0→9.1)", () => {
    const path = WORKBOOK_CELL_MAP.find((x) => x.label === "WLD NFS Share Path" && x.scope === "workload-cluster");
    expect(path.verifyLabelByVersion).toEqual({ "9.0": "NFS: Share Path", "9.1": "NFS: Folder" });
    const server = WORKBOOK_CELL_MAP.find((x) => x.label === "WLD NFS Server IP" && x.scope === "workload-cluster");
    expect(server.verifyLabelByVersion).toEqual({ "9.0": "NFS: Address of NFS Server", "9.1": "NFS: Server IP Address" });
  });

  it("none of the new entries carry passwordKind (vault not involved)", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "workload-cluster");
      expect(e.passwordKind).toBeUndefined();
    }
  });
});

describe("Theme 2b — emit semantics (9.1)", () => {
  it("stamps factory defaults to the workbook cells", () => {
    const fleet = defaultFleetWithWld("9.1");
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, SHEET, "D214").value).toBe("1");           // FTT
    expect(findRow(rows, SHEET, "D219").value).toBe("Unselected");   // Dedup
    expect(findRow(rows, SHEET, "D212").value).toBe("");             // vSAN Datastore Name
    expect(findRow(rows, SHEET, "D215").value).toBe("Selected");     // DIT enabled (factory true)
    expect(findRow(rows, SHEET, "D216").value).toBe("Default");      // Rekey mode
    expect(findRow(rows, SHEET, "D217").value).toBe("1 Day");        // Default interval
    expect(findRow(rows, SHEET, "D218").value).toBe("1440");         // Custom hours
    expect(findRow(rows, SHEET, "D221").value).toBe("");             // NFS Datastore Name
    expect(findRow(rows, SHEET, "D222").value).toBe("");             // NFS Share Path
    expect(findRow(rows, SHEET, "D223").value).toBe("");             // NFS Server IP
  });

  it("stamps user-set values, including dit.enabled=false", () => {
    const fleet = defaultFleetWithWld("9.1");
    // Gate NFS principal-storage cells by setting Storage Option=NFSv3.
    wldCluster(fleet).storage.principalStorage = "NFSv3";
    Object.assign(wldCluster(fleet).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "wld-cl01-ds-vsan-a",
      dit: { enabled: false, rekeyMode: "Custom", rekeyInterval: "1 Day", rekeyHoursCustom: 720 },
      nfs: { sharePath: "/share/nfs-wld", serverIp: "10.20.30.40", boundToVmknic: true },
    });
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, SHEET, "D214").value).toBe("2");
    expect(findRow(rows, SHEET, "D219").value).toBe("Selected");
    expect(findRow(rows, SHEET, "D212").value).toBe("wld-cl01-ds-vsan-a");
    expect(findRow(rows, SHEET, "D215").value).toBe("Unselected");   // dit disabled
    expect(findRow(rows, SHEET, "D216").value).toBe("Custom");
    expect(findRow(rows, SHEET, "D218").value).toBe("720");
    expect(findRow(rows, SHEET, "D221").value).toBe("wld-cl01-ds-vsan-a");  // stamped to NFS cell too
    expect(findRow(rows, SHEET, "D222").value).toBe("/share/nfs-wld");
    expect(findRow(rows, SHEET, "D223").value).toBe("10.20.30.40");
  });

  it("only stamps WLD rows for fleets that actually have workload domains", () => {
    const fleet = newFleet();                                   // no WLD added
    fleet.vcfVersion = "9.1";
    fleet.version = "vcf-sizer-v9";
    const rows = emitWorkbookCellMap(fleet, null);
    expect(rows.find((r) => r.sheet === SHEET && r.cell === "D214")).toBeUndefined();
  });
});

describe("Theme 2b — emit semantics (9.0)", () => {
  it("does NOT emit DIT rows on 9.0 (9.1-only cells)", () => {
    const fleet = defaultFleetWithWld("9.0");
    const rows = emitWorkbookCellMap(fleet, null);
    expect(rows.find((r) => r.label === "WLD DIT Encryption Enabled")).toBeUndefined();
    expect(rows.find((r) => r.label === "WLD DIT Rekey Mode")).toBeUndefined();
    expect(rows.find((r) => r.label === "WLD DIT Rekey Interval (Default)")).toBeUndefined();
    expect(rows.find((r) => r.label === "WLD DIT Rekey Interval (Custom hours)")).toBeUndefined();
  });

  it("dit.enabled value never reaches the 9.0 row set even when explicitly toggled", () => {
    const fleet = defaultFleetWithWld("9.0");
    wldCluster(fleet).storage.dataServices.dit.enabled = false;     // explicit override
    const rows = emitWorkbookCellMap(fleet, null);
    // None of the four DIT cells appear on the 9.0 row set — they are
    // gated on workbookVersions: ["9.1"]. dit.enabled lives in the
    // schema for all versions but only stamps a workbook cell on 9.1.
    for (const cell of ["D215", "D216", "D217", "D218"]) {
      expect(rows.find((r) => r.sheet === SHEET && r.cell === cell), `${cell} should not be stamped on 9.0`).toBeUndefined();
    }
  });

  it("dual-version cells land at the 9.0 addresses", () => {
    const fleet = defaultFleetWithWld("9.0");
    wldCluster(fleet).storage.principalStorage = "NFSv3";
    Object.assign(wldCluster(fleet).storage.dataServices, {
      ftt: 2,
      datastoreName: "ds90wld",
      nfs: { sharePath: "/p90", serverIp: "9.9.9.9", boundToVmknic: true },
    });
    const rows = emitWorkbookCellMap(fleet, null);
    expect(findRow(rows, SHEET, "D201").value).toBe("ds90wld");
    expect(findRow(rows, SHEET, "D203").value).toBe("2");
    expect(findRow(rows, SHEET, "D206").value).toBe("ds90wld");
    expect(findRow(rows, SHEET, "D207").value).toBe("/p90");
    expect(findRow(rows, SHEET, "D208").value).toBe("9.9.9.9");
  });
});

describe("Theme 2b — CSV round-trip via importWorkbookCellMap", () => {
  it("rebuilds workload-cluster dataServices from a stamped 9.1 CSV", () => {
    const original = defaultFleetWithWld("9.1");
    wldCluster(original).storage.principalStorage = "NFSv3";
    Object.assign(wldCluster(original).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "wld-rt",
      dit: { enabled: false, rekeyMode: "Custom", rekeyInterval: "1 Day", rekeyHoursCustom: 168 },
      nfs: { sharePath: "/nfs/wld-rt", serverIp: "10.50.50.50", boundToVmknic: true },
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const ds = wldCluster(imported.fleet).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(true);
    expect(ds.datastoreName).toBe("wld-rt");
    expect(ds.dit.enabled).toBe(false);
    expect(ds.dit.rekeyMode).toBe("Custom");
    expect(ds.dit.rekeyHoursCustom).toBe(168);
    expect(ds.nfs.sharePath).toBe("/nfs/wld-rt");
    expect(ds.nfs.serverIp).toBe("10.50.50.50");
  });

  it("9.0 round-trip preserves all dual-version fields, leaves dit.enabled at factory true", () => {
    const original = defaultFleetWithWld("9.0");
    wldCluster(original).storage.principalStorage = "NFSv3";
    Object.assign(wldCluster(original).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "ds90rt",
      nfs: { sharePath: "/p90rt", serverIp: "9.9.9.9", boundToVmknic: true },
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    const ds = wldCluster(imported.fleet).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(true);
    expect(ds.datastoreName).toBe("ds90rt");
    expect(ds.nfs.sharePath).toBe("/p90rt");
    expect(ds.dit.enabled).toBe(true);             // factory default, never stamped on 9.0
  });
});

describe("Theme 2b — no regression on validation / sizing", () => {
  it("validatePlacementConstraints still returns an array for a fleet with WLD", () => {
    const fleet = defaultFleetWithWld("9.1");
    const issues = validatePlacementConstraints(fleet);
    expect(Array.isArray(issues)).toBe(true);
  });

  it("sizeFleet still computes totals for a fleet with WLD", () => {
    const fleet = defaultFleetWithWld("9.1");
    const result = sizeFleet(fleet);
    expect(result.totalHosts).toBeGreaterThan(0);
    expect(typeof result.totalCores).toBe("number");
  });
});
