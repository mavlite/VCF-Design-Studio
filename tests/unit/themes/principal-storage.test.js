// Principal Storage selector — completes the "Storage Option" feature
// that the UI hint promised but was never wired up. Adds:
//
//   - cluster.storage.principalStorage enum field
//     ("vSAN-ESA" | "vSAN-OSA" | "VMFS on Fibre Channel (FC)" | "NFSv3")
//   - Cell-map entry at Deploy Mgmt L116 (9.0) / L58 (9.1) — the same
//     cell the older "vSAN Architecture" entry pointed at, now driving
//     the canonical model field rather than the phantom
//     cluster.host.vsanArchitecture field.
//   - NFS principal-storage gating: theme 2/2b/2c NFS Share Path,
//     Server IP, and Bound-to-vmknic cells emit empty when the
//     cluster's Storage Option isn't NFSv3.
//
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// {9.0,9.1}.json 2026-05-25 (L116 / L58 carry the same enum on both).

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  migrateFleet,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
  PRINCIPAL_STORAGE_OPTIONS,
} = VcfEngine;

function mgmtCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
}

function fleetWithWld(version = "9.1") {
  const f = newFleet();
  f.vcfVersion = version;
  f.version = "vcf-sizer-v9";
  f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
  return f;
}

function wldCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
}

describe("Principal Storage — model + enum", () => {
  it("PRINCIPAL_STORAGE_OPTIONS exports the workbook enum", () => {
    expect(PRINCIPAL_STORAGE_OPTIONS).toEqual([
      "vSAN-ESA",
      "vSAN-OSA",
      "VMFS on Fibre Channel (FC)",
      "NFSv3",
    ]);
  });

  it("newFleet defaults principalStorage to vSAN-ESA on every cluster", () => {
    const f = newFleet();
    expect(mgmtCluster(f).storage.principalStorage).toBe("vSAN-ESA");
  });
});

describe("Principal Storage — cell-map entry at Deploy Mgmt L116/L58", () => {
  it("uses the canonical cluster.storage.principalStorage field", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.cell === "L116" && x.scope === "mgmt-cluster");
    expect(e).toBeTruthy();
    expect(e.label).toBe("Storage Option");
    expect(e.cellByVersion["9.1"]).toBe("L58");
    expect(e.dataValidation).toEqual(PRINCIPAL_STORAGE_OPTIONS);
  });

  it("emit reads from cluster.storage.principalStorage", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).storage.principalStorage = "NFSv3";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === "L58");
    expect(row.value).toBe("NFSv3");
  });

  it("emit on 9.0 lands at L116", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    mgmtCluster(f).storage.principalStorage = "vSAN-OSA";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const row = rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === "L116");
    expect(row.value).toBe("vSAN-OSA");
  });

  it("apply normalizes garbage to vSAN-ESA", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L58", label: "Storage Option", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).storage.principalStorage).toBe("vSAN-ESA");
  });

  it("apply accepts all 4 enum values", () => {
    for (const v of PRINCIPAL_STORAGE_OPTIONS) {
      const rows = [
        { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L58", label: "Storage Option", value: v },
      ];
      const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
      expect(mgmtCluster(rebuilt).storage.principalStorage).toBe(v);
    }
  });

  it("round-trip preserves principalStorage", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    mgmtCluster(original).storage.principalStorage = "VMFS on Fibre Channel (FC)";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).storage.principalStorage).toBe("VMFS on Fibre Channel (FC)");
  });
});

describe("Principal Storage — NFS emit gating", () => {
  it("mgmt-cluster NFS cells emit EMPTY when Storage Option != NFSv3", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    // Default principalStorage is vSAN-ESA. Populate NFS fields with
    // values the workbook should ignore.
    mgmtCluster(f).storage.dataServices.nfs = {
      sharePath: "/should-not-emit",
      serverIp: "10.1.1.1",
      boundToVmknic: false,
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.cell === "L194").value).toBe("");        // NFS Share Path
    expect(rows.find((r) => r.cell === "L195").value).toBe("");        // NFS Server IP
    expect(rows.find((r) => r.cell === "L196").value).toBe("");        // NFS Bound to vmknic
  });

  it("mgmt-cluster NFS cells emit values when Storage Option == NFSv3", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).storage.principalStorage = "NFSv3";
    mgmtCluster(f).storage.dataServices.nfs = {
      sharePath: "/share/nfs01",
      serverIp: "10.1.1.1",
      boundToVmknic: false,
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.cell === "L194").value).toBe("/share/nfs01");
    expect(rows.find((r) => r.cell === "L195").value).toBe("10.1.1.1");
    expect(rows.find((r) => r.cell === "L196").value).toBe("Unselected");
  });

  it("workload-cluster NFS cells gate identically", () => {
    const f = fleetWithWld("9.1");
    wldCluster(f).storage.dataServices.nfs = {
      sharePath: "/wld-nfs",
      serverIp: "10.2.2.2",
      boundToVmknic: true,
    };
    // Default vSAN-ESA → empty
    let rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D222").value).toBe("");
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D223").value).toBe("");
    // Flip to NFSv3 → values flow through
    wldCluster(f).storage.principalStorage = "NFSv3";
    rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D222").value).toBe("/wld-nfs");
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D223").value).toBe("10.2.2.2");
  });

  it("NFS Datastore Name is NOT gated (intentional dual-stamp design)", () => {
    // Theme 2b's design: cluster.storage.dataServices.datastoreName
    // is stamped to BOTH the vSAN and NFS datastore cells regardless
    // of principalStorage. The workbook's downstream formulas pick
    // the right cell.
    const f = fleetWithWld("9.1");
    wldCluster(f).storage.dataServices.datastoreName = "shared-ds-name";
    // principalStorage stays at default vSAN-ESA
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D221").value).toBe("shared-ds-name");
  });

  it("apply still writes the field even when gated on emit", () => {
    // If the user manually crafts a CSV with NFS values, import should
    // still capture them on the model — gating only affects emit.
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L194", label: "NFS Share Path", value: "/imported" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).storage.dataServices.nfs.sharePath).toBe("/imported");
  });
});

describe("Principal Storage — migration backfill", () => {
  it("legacy clusters without principalStorage default to vSAN-ESA", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    delete mgmtCluster(f).storage.principalStorage;
    const migrated = migrateFleet(f);
    expect(mgmtCluster(migrated).storage.principalStorage).toBe("vSAN-ESA");
  });

  it("preserves valid principalStorage on round-trip (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).storage.principalStorage = "NFSv3";
    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    expect(mgmtCluster(r2).storage.principalStorage).toBe("NFSv3");
  });

  it("resets unknown values to the safe default", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).storage.principalStorage = "RAID6+SSD";
    const migrated = migrateFleet(f);
    expect(mgmtCluster(migrated).storage.principalStorage).toBe("vSAN-ESA");
  });
});
