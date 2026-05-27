import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme M — vDS port-group + teaming policy per traffic type (9.0 + 9.1).
//
// Cluster-scoped portgroups block at cluster.networks.portgroups with 7
// traffic-type slots covering the union of Deploy Mgmt + Deploy WLD +
// Deploy Cluster layouts (mgmt, vmMgmt, vmotion, vsan, nfs,
// principalStorage, vsanStorageClient). Each slot is { name,
// loadBalancing, uplink1, uplink2 }.
//
// 60 cell-map entries total (5 slots per sheet × 4 fields × 3 sheets);
// each carries cellByVersion routing both 9.0 and 9.1 row addresses.

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  createClusterNetworks,
  createClusterPortgroups,
  createPortgroupSlot,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
} = VcfEngine;

function fleetWith91Wld() {
  const f = newFleet();
  f.vcfVersion = "9.1";
  f.version = "vcf-sizer-v9";
  f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
  return f;
}

function wldCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
}

function fleetWithAdditionalCluster() {
  const f = fleetWith91Wld();
  const wld = f.instances[0].domains.find((d) => d.type === "workload");
  wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
  return f;
}

function additionalCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[1];
}

function mgmtCluster(f) {
  return f.instances[0].domains[0].clusters[0];
}

describe("Theme M — factory shape", () => {
  it("createPortgroupSlot documents the 4 per-slot fields", () => {
    expect(createPortgroupSlot()).toEqual({
      name: "",
      loadBalancing: "Route based on the source of the port ID",
      uplink1: "Active",
      uplink2: "Active",
    });
  });

  it("createClusterPortgroups documents the 7 traffic-type slots", () => {
    const pg = createClusterPortgroups();
    expect(Object.keys(pg).sort()).toEqual([
      "mgmt", "nfs", "principalStorage", "vmMgmt", "vmotion", "vsan", "vsanStorageClient",
    ]);
    for (const slot of Object.values(pg)) {
      expect(slot).toEqual(createPortgroupSlot());
    }
  });

  it("factories return fresh objects on each call (no shared refs)", () => {
    const a = createClusterPortgroups();
    a.mgmt.name = "mutate";
    const b = createClusterPortgroups();
    expect(b.mgmt.name).toBe("");
  });
});

describe("Theme M — newFleet wires portgroups on every cluster", () => {
  it("every cluster has portgroups with all 7 slots populated by factory defaults", () => {
    const f = fleetWithAdditionalCluster();
    for (const c of [mgmtCluster(f), wldCluster(f), additionalCluster(f)]) {
      expect(c.networks.portgroups).toEqual(createClusterPortgroups());
    }
  });
});

describe("Theme M — migrateFleet backfill", () => {
  it("backfills portgroups on a legacy cluster missing the field", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    delete f.instances[0].domains[0].clusters[0].networks.portgroups;
    const m = migrateFleet(f);
    expect(m.instances[0].domains[0].clusters[0].networks.portgroups).toEqual(createClusterPortgroups());
  });

  it("preserves customized portgroup values across re-migrate (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    const c = f.instances[0].domains[0].clusters[0];
    c.networks.portgroups.mgmt = { name: "PG-Mgmt", loadBalancing: "Route based on IP hash", uplink1: "Active", uplink2: "Standby" };
    c.networks.portgroups.vmotion = { name: "PG-vMotion", loadBalancing: "Use explicit failover order", uplink1: "Active", uplink2: "Unused" };
    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    const rc = r2.instances[0].domains[0].clusters[0];
    expect(rc.networks.portgroups.mgmt).toEqual({
      name: "PG-Mgmt", loadBalancing: "Route based on IP hash", uplink1: "Active", uplink2: "Standby",
    });
    expect(rc.networks.portgroups.vmotion).toEqual({
      name: "PG-vMotion", loadBalancing: "Use explicit failover order", uplink1: "Active", uplink2: "Unused",
    });
  });

  it("drops unknown keys at slot level (whitelist-merge per slot)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.instances[0].domains[0].clusters[0].networks.portgroups = {
      mgmt: { name: "kept", bogus: "junk" },
      // missing all other slots
    };
    const m = migrateFleet(f);
    const pg = m.instances[0].domains[0].clusters[0].networks.portgroups;
    expect(pg.mgmt.name).toBe("kept");
    expect(pg.mgmt).not.toHaveProperty("bogus");
    // Other slots backfilled from factory.
    expect(pg.vmotion).toEqual(createPortgroupSlot());
    expect(pg.principalStorage).toEqual(createPortgroupSlot());
  });
});

describe("Theme M — WORKBOOK_CELL_MAP entries", () => {
  it("ships 60 entries total (5 slots × 4 fields × 3 sheets), all dual-version", () => {
    // Filter to Theme M's actual label shape: "<Slot> PG (<Sheet>...)".
    // The trailing "(" excludes Theme P-tail's "NSX Mgmt-Cluster PG ..."
    // labels which also include the substring " PG " but are scope:
    // mgmt-cluster on Deploy Mgmt for a single 5-cell block.
    const all = WORKBOOK_CELL_MAP.filter((e) => /PortGroup Name|Load Balancing|Uplink [12]/.test(e.label) && / PG \(/.test(e.label));
    expect(all).toHaveLength(60);
    for (const e of all) {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.cellByVersion).toBeTruthy();
      expect(e.cellByVersion["9.0"]).toMatch(/^[DL]\d+$/);
      expect(e.cellByVersion["9.1"]).toMatch(/^[DL]\d+$/);
    }
  });

  it("Deploy Mgmt has 20 entries (5 slots × 4 fields, mgmt-cluster scope)", () => {
    const mgmt = WORKBOOK_CELL_MAP.filter((e) => e.sheet === "Deploy Management Domain" && / PG \(Deploy Mgmt[^)]*\)/.test(e.label));
    expect(mgmt).toHaveLength(20);
    for (const e of mgmt) expect(e.scope).toBe("mgmt-cluster");
  });

  it("Deploy WLD has 20 entries (5 slots × 4 fields, workload-cluster scope)", () => {
    const wld = WORKBOOK_CELL_MAP.filter((e) => e.sheet === "Deploy Workload Domain" && / PG \(Deploy WLD\)/.test(e.label));
    expect(wld).toHaveLength(20);
    for (const e of wld) expect(e.scope).toBe("workload-cluster");
  });

  it("Deploy Cluster has 20 entries (5 slots × 4 fields, additional-cluster scope)", () => {
    const dc = WORKBOOK_CELL_MAP.filter((e) => e.sheet === "Deploy Cluster" && / PG \(Deploy Cluster\)/.test(e.label));
    expect(dc).toHaveLength(20);
    for (const e of dc) expect(e.scope).toBe("additional-cluster");
  });

  it("Load Balancing entries carry the full 5-value dropdown enum", () => {
    const lb = WORKBOOK_CELL_MAP.find((e) => e.label === "Mgmt PG (Deploy WLD) Load Balancing");
    expect(lb.dataValidation).toEqual([
      "Route based on IP hash",
      "Route based on source MAC hash",
      "Route based on the source of the port ID",
      "Use explicit failover order",
      "Route Based on Physical NIC Load",
    ]);
  });

  it("Uplink entries carry the Active/Standby/Unused enum", () => {
    const u = WORKBOOK_CELL_MAP.find((e) => e.label === "vMotion PG (Deploy WLD) Uplink 1");
    expect(u.dataValidation).toEqual(["Active", "Standby", "Unused"]);
  });
});

describe("Theme M — emit + round-trip", () => {
  it("emits factory defaults on a fresh 9.1 fleet", () => {
    const f = fleetWith91Wld();
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // Deploy Mgmt vSAN PG cells.
    const lb = rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === "L260");
    expect(lb).toBeTruthy();
    expect(lb.value).toBe("Route based on the source of the port ID");
    const u1 = rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === "L261");
    expect(u1.value).toBe("Active");
  });

  it("9.0 emit targets the 9.0 row addresses (cellByVersion routing)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
    // Customize one slot per sheet so we can detect drift.
    mgmtCluster(f).networks.portgroups.vsan = { name: "PG-MGMT-vSAN", loadBalancing: "Route based on IP hash", uplink1: "Standby", uplink2: "Active" };
    wldCluster(f).networks.portgroups.principalStorage = { name: "PG-WLD-Storage", loadBalancing: "Route Based on Physical NIC Load", uplink1: "Active", uplink2: "Unused" };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (sheet, cell) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    // Deploy Mgmt vSAN slot: 9.0 cells L236-L239 (vs 9.1 L259-L262).
    expect(find("Deploy Management Domain", "L236").value).toBe("PG-MGMT-vSAN");
    expect(find("Deploy Management Domain", "L237").value).toBe("Route based on IP hash");
    expect(find("Deploy Management Domain", "L238").value).toBe("Standby");
    expect(find("Deploy Management Domain", "L239").value).toBe("Active");
    // Deploy WLD principalStorage slot: 9.0 cells D287-D290 (vs 9.1 D302-D305).
    expect(find("Deploy Workload Domain", "D287").value).toBe("PG-WLD-Storage");
    expect(find("Deploy Workload Domain", "D288").value).toBe("Route Based on Physical NIC Load");
    // 9.1-only Theme M cells must NOT appear in 9.0 emit. (Use Deploy
    // Mgmt range — Theme M's mgmt-cluster scope cells don't collide with
    // Theme P's 9.0 cells, unlike Deploy WLD where D302-D305 also serve
    // Theme P workload-cluster fields.)
    for (const stale of ["L259", "L260", "L261", "L262"]) {
      expect(find("Deploy Management Domain", stale), `9.1-only Theme M cell ${stale} should not emit on 9.0`).toBeUndefined();
    }
  });

  it("9.0 CSV round-trip preserves portgroup values across all 3 cluster scopes", () => {
    const original = newFleet();
    original.vcfVersion = "9.0";
    original.instances[0].domains.push(newWorkloadDomain("WLD-01"));
    const wld = original.instances[0].domains.find((d) => d.type === "workload");
    wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
    mgmtCluster(original).networks.portgroups.mgmt = { name: "PG-90-Mgmt", loadBalancing: "Route based on IP hash", uplink1: "Active", uplink2: "Standby" };
    wldCluster(original).networks.portgroups.principalStorage = { name: "PG-90-WLD-Storage", loadBalancing: "Route Based on Physical NIC Load", uplink1: "Standby", uplink2: "Active" };
    additionalCluster(original).networks.portgroups.vsanStorageClient = { name: "PG-90-AC-vSAN-SC", loadBalancing: "Route based on source MAC hash", uplink1: "Active", uplink2: "Active" };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    expect(mgmtCluster(rebuilt).networks.portgroups.mgmt).toEqual(mgmtCluster(original).networks.portgroups.mgmt);
    expect(wldCluster(rebuilt).networks.portgroups.principalStorage).toEqual(wldCluster(original).networks.portgroups.principalStorage);
    expect(additionalCluster(rebuilt).networks.portgroups.vsanStorageClient).toEqual(additionalCluster(original).networks.portgroups.vsanStorageClient);
  });

  // Comprehensive coverage: every slot of every cluster scope round-trips
  // on both workbook versions. The narrower per-version tests above only
  // hit 1 of 5 slots per scope, leaving a regression window on the other
  // 4 slots × 3 scopes × 2 versions = 24 slot/scope/version combinations.
  // This test closes that window.
  const ALL_SLOT_VALUES = {
    mgmt:              { name: "PG-Mgmt",          loadBalancing: "Route based on IP hash",                       uplink1: "Active",  uplink2: "Standby" },
    vmMgmt:            { name: "PG-VMMgmt",        loadBalancing: "Route based on source MAC hash",               uplink1: "Standby", uplink2: "Active" },
    vmotion:           { name: "PG-vMotion",       loadBalancing: "Route based on the source of the port ID",     uplink1: "Active",  uplink2: "Active" },
    vsan:              { name: "PG-vSAN",          loadBalancing: "Use explicit failover order",                  uplink1: "Active",  uplink2: "Unused" },
    nfs:               { name: "PG-NFS",           loadBalancing: "Route Based on Physical NIC Load",             uplink1: "Standby", uplink2: "Standby" },
    principalStorage:  { name: "PG-PrincipalStg",  loadBalancing: "Route based on IP hash",                       uplink1: "Unused",  uplink2: "Active" },
    vsanStorageClient: { name: "PG-vSANClient",    loadBalancing: "Route Based on Physical NIC Load",             uplink1: "Active",  uplink2: "Standby" },
  };
  function customizeAllSlots(c) {
    for (const [slot, vals] of Object.entries(ALL_SLOT_VALUES)) c.networks.portgroups[slot] = { ...vals };
  }
  for (const version of ["9.0", "9.1"]) {
    // Per-sheet emit covers a different 5-slot subset of the 7-slot model:
    //   Deploy Mgmt   emits mgmt, vmMgmt, vmotion, vsan, nfs
    //   Deploy WLD    emits mgmt, vmMgmt, vmotion, principalStorage, vsanStorageClient
    //   Deploy Cluster emits mgmt, vmMgmt, vmotion, principalStorage, vsanStorageClient
    // So slots not in a sheet's emit list don't round-trip for that cluster.
    const EMITTED_BY_SCOPE = {
      "mgmt-cluster":       ["mgmt", "vmMgmt", "vmotion", "vsan", "nfs"],
      "workload-cluster":   ["mgmt", "vmMgmt", "vmotion", "principalStorage", "vsanStorageClient"],
      "additional-cluster": ["mgmt", "vmMgmt", "vmotion", "principalStorage", "vsanStorageClient"],
    };
    it(`${version} round-trip preserves ALL 5 emitted slots × 3 cluster scopes (15 slot/scope combos)`, () => {
      const original = newFleet();
      original.vcfVersion = version;
      original.instances[0].domains.push(newWorkloadDomain("WLD-01"));
      const wld = original.instances[0].domains.find((d) => d.type === "workload");
      wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
      // Customize all 7 slots on every cluster.
      customizeAllSlots(mgmtCluster(original));
      customizeAllSlots(wldCluster(original));
      customizeAllSlots(additionalCluster(original));
      const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: version });
      const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: version });
      const cases = [
        ["mgmt-cluster",       mgmtCluster(rebuilt)],
        ["workload-cluster",   wldCluster(rebuilt)],
        ["additional-cluster", additionalCluster(rebuilt)],
      ];
      for (const [scopeName, cluster] of cases) {
        for (const slot of EMITTED_BY_SCOPE[scopeName]) {
          expect(cluster.networks.portgroups[slot], `${version} ${scopeName} ${slot}`).toEqual(ALL_SLOT_VALUES[slot]);
        }
      }
    });
  }

  it("9.1 CSV round-trip preserves portgroup values across mgmt + workload clusters", () => {
    const original = fleetWithAdditionalCluster();
    // Set distinct values on each cluster.
    mgmtCluster(original).networks.portgroups.mgmt = { name: "PG-MGMT-Mgmt", loadBalancing: "Route based on IP hash", uplink1: "Active", uplink2: "Standby" };
    mgmtCluster(original).networks.portgroups.nfs = { name: "PG-MGMT-NFS", loadBalancing: "Use explicit failover order", uplink1: "Active", uplink2: "Unused" };
    wldCluster(original).networks.portgroups.principalStorage = { name: "PG-WLD-Storage", loadBalancing: "Route Based on Physical NIC Load", uplink1: "Standby", uplink2: "Active" };
    additionalCluster(original).networks.portgroups.vsanStorageClient = { name: "PG-AC-vSAN-SC", loadBalancing: "Route based on source MAC hash", uplink1: "Active", uplink2: "Active" };

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });

    expect(mgmtCluster(rebuilt).networks.portgroups.mgmt).toEqual(mgmtCluster(original).networks.portgroups.mgmt);
    expect(mgmtCluster(rebuilt).networks.portgroups.nfs).toEqual(mgmtCluster(original).networks.portgroups.nfs);
    expect(wldCluster(rebuilt).networks.portgroups.principalStorage).toEqual(wldCluster(original).networks.portgroups.principalStorage);
    expect(additionalCluster(rebuilt).networks.portgroups.vsanStorageClient).toEqual(additionalCluster(original).networks.portgroups.vsanStorageClient);
  });

  it("Load Balancing apply coerces out-of-enum values to factory default", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "Mgmt PG (Deploy WLD) Load Balancing");
    const f = fleetWith91Wld();
    const ctx = { instance: f.instances[0], cluster: wldCluster(f) };
    e.apply(f, ctx, "bogus value");
    expect(wldCluster(f).networks.portgroups.mgmt.loadBalancing).toBe("Route based on the source of the port ID");
    e.apply(f, ctx, "Route based on IP hash");
    expect(wldCluster(f).networks.portgroups.mgmt.loadBalancing).toBe("Route based on IP hash");
  });

  it("Uplink apply coerces out-of-enum to Active (factory default)", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "vMotion PG (Deploy WLD) Uplink 2");
    const f = fleetWith91Wld();
    const ctx = { instance: f.instances[0], cluster: wldCluster(f) };
    e.apply(f, ctx, "garbage");
    expect(wldCluster(f).networks.portgroups.vmotion.uplink2).toBe("Active");
    e.apply(f, ctx, "Standby");
    expect(wldCluster(f).networks.portgroups.vmotion.uplink2).toBe("Standby");
  });
});
