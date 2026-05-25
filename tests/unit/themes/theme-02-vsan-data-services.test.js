// Theme 2 — vSAN data services & encryption (Mgmt scope)
//
// Extends cluster.storage with a `dataServices` block (FTT, dedup/
// compression toggle, datastore name, DIT rekey config, NFS principal-
// storage) and wires the management-cluster cells into WORKBOOK_CELL_MAP.
//
// This first PR covers the **management-domain cluster** only. Workload-
// domain (Deploy WLD) and additional-cluster (Deploy Cluster sheet) cells
// land in follow-up tracking PRs.
//
// Cells exported here (mgmt-cluster scope):
//   - Failures to Tolerate         L118 / L60   (both versions)
//   - vSAN Dedup and Compression   L119 / L61   (both versions)
//   - vSAN Datastore Name          L117 / L190  (both versions)
//   - DIT Rekey Mode               -    / L191  (9.1 only)
//   - DIT Rekey Default Interval   -    / L192  (9.1 only)
//   - DIT Rekey Custom hours       -    / L193  (9.1 only)
//   - NFS Share Path               L120 / L194  (both versions)
//   - NFS Server IP                L121 / L195  (both versions)
//   - NFS Bound to vmknic          L122 / L196  (both versions)

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
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

function defaultFleet(vcfVersion = "9.1") {
  const fleet = newFleet();
  fleet.vcfVersion = vcfVersion;
  fleet.version = "vcf-sizer-v9";
  return fleet;
}

function findRow(rows, sheet, cell) {
  return rows.find((r) => r.sheet === sheet && r.cell === cell);
}

function mgmtCluster(fleet) {
  return fleet.instances[0].domains[0].clusters[0];
}

describe("Theme 2 — baseStorageDataServices defaults", () => {
  it("exports the factory and returns the documented shape", () => {
    expect(typeof baseStorageDataServices).toBe("function");
    const ds = baseStorageDataServices();
    expect(ds.ftt).toBe(1);
    expect(ds.dedupCompressionEnabled).toBe(false);
    expect(ds.datastoreName).toBe("");
    expect(ds.dit).toEqual({
      enabled: true,                          // theme 2b — pristine 9.1 default at D215 is Selected
      rekeyMode: "Default",
      rekeyInterval: "1 Day",
      rekeyHoursCustom: 1440,
    });
    expect(ds.nfs).toEqual({
      sharePath: "",
      serverIp: "",
      boundToVmknic: true,
    });
  });

  it("returns fresh nested objects (no shared references on dit/nfs)", () => {
    const a = baseStorageDataServices();
    const b = baseStorageDataServices();
    expect(a.dit).not.toBe(b.dit);
    expect(a.nfs).not.toBe(b.nfs);
    a.dit.rekeyMode = "Custom";
    expect(b.dit.rekeyMode).toBe("Default");
  });
});

describe("Theme 2 — newFleet seeds dataServices on every cluster", () => {
  it("default mgmt cluster carries dataServices block", () => {
    const fleet = newFleet();
    expect(mgmtCluster(fleet).storage.dataServices).toEqual(baseStorageDataServices());
  });
});

describe("Theme 2 — migrateFleet backfills dataServices on legacy clusters", () => {
  it("legacy storage without dataServices gets factory defaults", () => {
    const legacy = newFleet();
    legacy.version = "vcf-sizer-v9";
    delete mgmtCluster(legacy).storage.dataServices;
    const migrated = migrateFleet(legacy);
    expect(mgmtCluster(migrated).storage.dataServices).toEqual(baseStorageDataServices());
  });

  it("partial dataServices blob is merged with the factory shape (nested dit/nfs whitelist)", () => {
    const fleet = newFleet();
    fleet.version = "vcf-sizer-v9";
    mgmtCluster(fleet).storage.dataServices = {
      ftt: 2,
      dit: { rekeyMode: "Custom" },
      nfs: { sharePath: "/share/x" },
    };
    const migrated = migrateFleet(fleet);
    const ds = mgmtCluster(migrated).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(false);          // factory backfill
    expect(ds.datastoreName).toBe("");
    expect(ds.dit.rekeyMode).toBe("Custom");                 // preserved
    expect(ds.dit.rekeyInterval).toBe("1 Day");              // factory backfill
    expect(ds.dit.rekeyHoursCustom).toBe(1440);              // factory backfill
    expect(ds.nfs.sharePath).toBe("/share/x");               // preserved
    expect(ds.nfs.serverIp).toBe("");                        // factory backfill
    expect(ds.nfs.boundToVmknic).toBe(true);                 // factory backfill
  });

  it("is idempotent — migrate(migrate(x)).dataServices === migrate(x).dataServices", () => {
    // version stamp so migrateFleet stays on the v9 path instead of routing
    // through migrateV3ToV5 (which can't reconstruct the instances tree from
    // newFleet's flat shape).
    const seed = { ...newFleet(), version: "vcf-sizer-v9" };
    const a = migrateFleet(seed);
    const b = migrateFleet({ ...a, version: "vcf-sizer-v9" });
    expect(mgmtCluster(b).storage.dataServices).toEqual(mgmtCluster(a).storage.dataServices);
  });

  it("legacy cluster with no storage at all gets full storage + dataServices", () => {
    const legacy = newFleet();
    legacy.version = "vcf-sizer-v9";
    delete mgmtCluster(legacy).storage;
    const migrated = migrateFleet(legacy);
    expect(mgmtCluster(migrated).storage).toBeTruthy();
    expect(mgmtCluster(migrated).storage.dataServices).toEqual(baseStorageDataServices());
  });
});

describe("Theme 2 — WORKBOOK_CELL_MAP entries (mgmt-cluster scope)", () => {
  const SHEET = "Deploy Management Domain";
  const NEW_LABELS = [
    "Failures to Tolerate",
    "vSAN Dedup and Compression",
    "vSAN Datastore Name",
    "DIT Rekey Mode",
    "DIT Rekey Interval (Default)",
    "DIT Rekey Interval (Custom hours)",
    "NFS Share Path",
    "NFS Server IP",
    "NFS Bound to vmknic",
  ];

  it("every new field is present on mgmt-cluster scope", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(e, `missing cell-map entry: ${label}`).toBeTruthy();
    }
  });

  it("DIT entries are gated to 9.1 only", () => {
    const ditLabels = ["DIT Rekey Mode", "DIT Rekey Interval (Default)", "DIT Rekey Interval (Custom hours)"];
    for (const label of ditLabels) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
  });

  it("dual-version entries carry cellByVersion for the 9.0 → 9.1 row shift", () => {
    const ftt = WORKBOOK_CELL_MAP.find((x) => x.label === "Failures to Tolerate" && x.scope === "mgmt-cluster");
    expect(ftt.cell).toBe("L118");
    expect(ftt.cellByVersion["9.1"]).toBe("L60");

    const ds = WORKBOOK_CELL_MAP.find((x) => x.label === "vSAN Datastore Name" && x.scope === "mgmt-cluster");
    expect(ds.cell).toBe("L117");
    expect(ds.cellByVersion["9.1"]).toBe("L190");

    const nfsBound = WORKBOOK_CELL_MAP.find((x) => x.label === "NFS Bound to vmknic" && x.scope === "mgmt-cluster");
    expect(nfsBound.cell).toBe("L122");
    expect(nfsBound.cellByVersion["9.1"]).toBe("L196");
  });

  it("none of the new entries carry passwordKind (vault not involved)", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "mgmt-cluster");
      expect(e.passwordKind).toBeUndefined();
    }
  });
});

describe("Theme 2 — emit semantics (9.1)", () => {
  it("stamps factory defaults to the workbook cells", () => {
    const fleet = defaultFleet("9.1");
    const rows = emitWorkbookCellMap(fleet, null);
    const SHEET = "Deploy Management Domain";
    expect(findRow(rows, SHEET, "L60").value).toBe("1");           // FTT
    expect(findRow(rows, SHEET, "L61").value).toBe("Unselected");   // Dedup
    expect(findRow(rows, SHEET, "L190").value).toBe("");            // Datastore name
    expect(findRow(rows, SHEET, "L191").value).toBe("Default");     // Rekey mode
    expect(findRow(rows, SHEET, "L192").value).toBe("1 Day");       // Rekey default interval
    expect(findRow(rows, SHEET, "L193").value).toBe("1440");        // Custom hours
    expect(findRow(rows, SHEET, "L194").value).toBe("");            // NFS path (gated — default Storage Option is vSAN-ESA)
    expect(findRow(rows, SHEET, "L195").value).toBe("");            // NFS server (gated)
    expect(findRow(rows, SHEET, "L196").value).toBe("");            // NFS bound (gated)
  });

  it("stamps user-set values through to the workbook cells", () => {
    const fleet = defaultFleet("9.1");
    // Switch principal storage to NFSv3 so the NFS cells emit (gating
    // shipped with the principal-storage selector feature).
    mgmtCluster(fleet).storage.principalStorage = "NFSv3";
    Object.assign(mgmtCluster(fleet).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "mgmt-cl01-ds-vsan-a",
      dit: { rekeyMode: "Custom", rekeyInterval: "1 Day", rekeyHoursCustom: 720 },
      nfs: { sharePath: "/share/nfs-mgmt", serverIp: "10.10.10.5", boundToVmknic: false },
    });
    const rows = emitWorkbookCellMap(fleet, null);
    const SHEET = "Deploy Management Domain";
    expect(findRow(rows, SHEET, "L60").value).toBe("2");
    expect(findRow(rows, SHEET, "L61").value).toBe("Selected");
    expect(findRow(rows, SHEET, "L190").value).toBe("mgmt-cl01-ds-vsan-a");
    expect(findRow(rows, SHEET, "L191").value).toBe("Custom");
    expect(findRow(rows, SHEET, "L193").value).toBe("720");
    expect(findRow(rows, SHEET, "L194").value).toBe("/share/nfs-mgmt");
    expect(findRow(rows, SHEET, "L195").value).toBe("10.10.10.5");
    expect(findRow(rows, SHEET, "L196").value).toBe("Unselected");
  });
});

describe("Theme 2 — emit semantics (9.0)", () => {
  it("does NOT emit DIT rekey rows on 9.0 (9.1-only cells)", () => {
    const fleet = defaultFleet("9.0");
    const rows = emitWorkbookCellMap(fleet, null);
    expect(rows.find((r) => r.label === "DIT Rekey Mode")).toBeUndefined();
    expect(rows.find((r) => r.label === "DIT Rekey Interval (Default)")).toBeUndefined();
    expect(rows.find((r) => r.label === "DIT Rekey Interval (Custom hours)")).toBeUndefined();
  });

  it("dual-version cells land at the 9.0 addresses (L117-L122 contiguous)", () => {
    const fleet = defaultFleet("9.0");
    mgmtCluster(fleet).storage.principalStorage = "NFSv3";
    Object.assign(mgmtCluster(fleet).storage.dataServices, {
      ftt: 2,
      datastoreName: "ds90",
      nfs: { sharePath: "/p", serverIp: "1.2.3.4", boundToVmknic: true },
    });
    const rows = emitWorkbookCellMap(fleet, null);
    const SHEET = "Deploy Management Domain";
    expect(findRow(rows, SHEET, "L117").value).toBe("ds90");        // Datastore Name
    expect(findRow(rows, SHEET, "L118").value).toBe("2");           // FTT
    expect(findRow(rows, SHEET, "L120").value).toBe("/p");          // NFS Path
    expect(findRow(rows, SHEET, "L121").value).toBe("1.2.3.4");     // NFS Server
    expect(findRow(rows, SHEET, "L122").value).toBe("Selected");    // NFS Bound
  });
});

describe("Theme 2 — CSV round-trip via importWorkbookCellMap", () => {
  it("rebuilds dataServices from a stamped 9.1 CSV", () => {
    const original = defaultFleet("9.1");
    mgmtCluster(original).storage.principalStorage = "NFSv3";
    Object.assign(mgmtCluster(original).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "ds-roundtrip",
      dit: { rekeyMode: "Custom", rekeyInterval: "1 Day", rekeyHoursCustom: 168 },
      nfs: { sharePath: "/nfs/path", serverIp: "10.20.30.40", boundToVmknic: false },
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const ds = mgmtCluster(imported.fleet).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(true);
    expect(ds.datastoreName).toBe("ds-roundtrip");
    expect(ds.dit.rekeyMode).toBe("Custom");
    expect(ds.dit.rekeyHoursCustom).toBe(168);
    expect(ds.nfs.sharePath).toBe("/nfs/path");
    expect(ds.nfs.serverIp).toBe("10.20.30.40");
    expect(ds.nfs.boundToVmknic).toBe(false);
  });

  it("9.0 round-trip preserves all dual-version fields", () => {
    const original = defaultFleet("9.0");
    mgmtCluster(original).storage.principalStorage = "NFSv3";
    Object.assign(mgmtCluster(original).storage.dataServices, {
      ftt: 2,
      dedupCompressionEnabled: true,
      datastoreName: "ds90rt",
      nfs: { sharePath: "/p90", serverIp: "9.9.9.9", boundToVmknic: false },
    });
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    const ds = mgmtCluster(imported.fleet).storage.dataServices;
    expect(ds.ftt).toBe(2);
    expect(ds.dedupCompressionEnabled).toBe(true);
    expect(ds.datastoreName).toBe("ds90rt");
    expect(ds.nfs.sharePath).toBe("/p90");
    expect(ds.nfs.boundToVmknic).toBe(false);
    // DIT fields stay at their factory defaults — never set on 9.0.
    expect(ds.dit.rekeyMode).toBe("Default");
  });

  it("post-import fleet is migrateFleet-idempotent", () => {
    const original = defaultFleet("9.1");
    mgmtCluster(original).storage.dataServices.ftt = 2;
    const csv = emitWorkbookCellMapCsv(original, null);
    const rows = parseWorkbookCellMap(csv);
    const imported = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const after = { ...imported.fleet, version: "vcf-sizer-v9" };
    const migrated = migrateFleet(after);
    expect(mgmtCluster(migrated).storage.dataServices).toEqual(mgmtCluster(after).storage.dataServices);
  });
});

describe("Theme 2 — no regression on validation / sizing", () => {
  it("validatePlacementConstraints still returns an array for a default fleet", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    expect(Array.isArray(issues)).toBe(true);
  });

  it("sizeFleet still computes totals on a default fleet (data services are metadata, not sized)", () => {
    const fleet = newFleet();
    const result = sizeFleet(fleet);
    expect(result.totalHosts).toBeGreaterThan(0);
    expect(typeof result.totalCores).toBe("number");
  });
});
