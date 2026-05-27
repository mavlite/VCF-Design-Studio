import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme P — NSX Host Overlay TEP configuration (9.1 only).
// Workload-cluster scope on Deploy WLD D312-D336 + additional-cluster
// scope on Deploy Cluster D237-D261. 22 cells per sheet × 2 sheets =
// 44 cells (skipping the 5-cell Deploy Mgmt trailing block, deferred).
//
// Adds cluster.networks.nsxHostOverlay (~23-field block) wrapping the
// existing hostTep IP config with NSX-specific metadata (TZ names,
// IP assignment + pool config, uplink profile, teaming policy).

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  createClusterNsxHostOverlay,
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

describe("Theme P — factory shape", () => {
  it("createClusterNsxHostOverlay documents the 23 fields with sensible defaults", () => {
    expect(createClusterNsxHostOverlay()).toEqual({
      applyDefaultOperationMode: "Selected",
      operationalMode: "Standard",
      transportZoneOverlay: "Selected",
      transportZoneVlan: "Selected",
      transportZoneName: "",
      vlanTransportZoneName: "",
      vlan: "",
      ipAssignment: "Static IP Pool",
      staticIpPoolType: "Create New Static IP Pool",
      poolName: "",
      poolDescription: "",
      cidr: "",
      ipRangeStart: "",
      ipRangeEnd: "",
      gatewayIp: "",
      uplinkProfileName: "",
      numberOfUplinks: "2",
      uplinkName1: "uplink-1",
      uplinkName2: "uplink-2",
      hostOverlayProfileName: "",
      teamingPolicy: "Load Balance Source",
      activeUplink1: "",
      activeUplink2: "",
      mgmtClusterPortgroup: {
        loadBalancing: "Route based on the source of the port ID",
        uplink1: "Active",
        uplink2: "Active",
      },
    });
  });

  it("factory returns fresh objects on each call (no shared refs)", () => {
    const a = createClusterNsxHostOverlay();
    a.vlan = "mutate";
    const b = createClusterNsxHostOverlay();
    expect(b.vlan).toBe("");
  });
});

describe("Theme P — newFleet wires nsxHostOverlay on every cluster", () => {
  it("every cluster has cluster.networks.nsxHostOverlay with factory defaults", () => {
    const f = fleetWithAdditionalCluster();
    for (const c of [wldCluster(f), additionalCluster(f)]) {
      expect(c.networks.nsxHostOverlay).toEqual(createClusterNsxHostOverlay());
    }
  });
});

describe("Theme P — migrateFleet backfill", () => {
  it("backfills nsxHostOverlay on a legacy cluster missing the field", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    delete f.instances[0].domains[0].clusters[0].networks.nsxHostOverlay;
    const m = migrateFleet(f);
    expect(m.instances[0].domains[0].clusters[0].networks.nsxHostOverlay).toEqual(createClusterNsxHostOverlay());
  });

  it("preserves customized values across re-migrate (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    const c = f.instances[0].domains[0].clusters[0];
    c.networks.nsxHostOverlay = {
      ...createClusterNsxHostOverlay(),
      transportZoneName: "tz-overlay-az1",
      vlan: "3001",
      cidr: "10.40.50.0/24",
      teamingPolicy: "Failover Order",
    };
    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    const rc = r2.instances[0].domains[0].clusters[0];
    expect(rc.networks.nsxHostOverlay.transportZoneName).toBe("tz-overlay-az1");
    expect(rc.networks.nsxHostOverlay.vlan).toBe("3001");
    expect(rc.networks.nsxHostOverlay.cidr).toBe("10.40.50.0/24");
    expect(rc.networks.nsxHostOverlay.teamingPolicy).toBe("Failover Order");
  });

  it("drops unknown keys (whitelist-merge)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.instances[0].domains[0].clusters[0].networks.nsxHostOverlay = {
      vlan: "kept", bogusKey: "junk",
    };
    const m = migrateFleet(f);
    const nsx = m.instances[0].domains[0].clusters[0].networks.nsxHostOverlay;
    expect(nsx.vlan).toBe("kept");
    expect(nsx).not.toHaveProperty("bogusKey");
    expect(nsx.cidr).toBe("");  // factory default
  });
});

describe("Theme P — WORKBOOK_CELL_MAP entries", () => {
  it("ships 23 workload-cluster entries on Deploy WLD (9.1-only)", () => {
    const wld = WORKBOOK_CELL_MAP.filter((e) => e.sheet === "Deploy Workload Domain" && /^NSX (Apply|Operational|Transport|Host Overlay|TEP|Static|Uplink|Number|VLAN|Teaming|Active)/.test(e.label));
    expect(wld).toHaveLength(23);
    for (const e of wld) {
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("workload-cluster");
    }
  });

  it("ships 23 additional-cluster entries on Deploy Cluster (9.1-only)", () => {
    const dc = WORKBOOK_CELL_MAP.filter((e) => e.sheet === "Deploy Cluster" && /^NSX (Apply|Operational|Transport|Host Overlay|TEP|Static|Uplink|Number|VLAN|Teaming|Active)/.test(e.label));
    expect(dc).toHaveLength(23);
    for (const e of dc) {
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("additional-cluster");
    }
  });

  it("Operational Mode entries carry the 3-value workbook enum", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "NSX Operational Mode" && x.sheet === "Deploy Workload Domain");
    expect(e.dataValidation).toEqual(["Standard", "Enhanced Datapath Standard", "Enhanced Datapath Dedicated"]);
  });

  it("Teaming Policy entries carry the 3-value workbook enum", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "NSX Teaming Policy" && x.sheet === "Deploy Workload Domain");
    expect(e.dataValidation).toEqual(["Load Balance Source", "Failover Order", "Load Balance Source MAC Address"]);
  });

  it("Active Uplink enum differs per sheet (Deploy WLD: Selected/Unselected; Deploy Cluster: free text)", () => {
    const wld = WORKBOOK_CELL_MAP.find((x) => x.label === "NSX Active Uplink 1" && x.sheet === "Deploy Workload Domain");
    expect(wld.dataValidation).toEqual(["Selected", "Unselected"]);
    const dc = WORKBOOK_CELL_MAP.find((x) => x.label === "NSX Active Uplink 1" && x.sheet === "Deploy Cluster");
    expect(dc.dataValidation).toBeFalsy();
  });
});

describe("Theme P — emit + round-trip", () => {
  it("emits factory defaults on a fresh 9.1 fleet", () => {
    const f = fleetWith91Wld();
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (sheet, cell) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    expect(find("Deploy Workload Domain", "D312").value).toBe("Selected");  // applyDefault
    expect(find("Deploy Workload Domain", "D313").value).toBe("Standard");  // operationalMode
    expect(find("Deploy Workload Domain", "D319").value).toBe("Static IP Pool");  // ipAssignment
    expect(find("Deploy Workload Domain", "D334").value).toBe("Load Balance Source");  // teaming
  });

  it("does NOT emit Theme P entries on a 9.0 fleet (9.1-only gate)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => /^NSX (Apply|Operational|Transport|TEP|Static)/.test(r.label))).toBeUndefined();
  });

  it("9.1 CSV round-trip preserves nsxHostOverlay across workload + additional clusters", () => {
    const original = fleetWithAdditionalCluster();
    wldCluster(original).networks.nsxHostOverlay = {
      ...createClusterNsxHostOverlay(),
      transportZoneName: "tz-overlay-wld",
      vlanTransportZoneName: "tz-vlan-wld",
      vlan: "3001",
      poolName: "wld-tep-pool",
      cidr: "10.40.50.0/24",
      ipRangeStart: "10.40.50.10",
      ipRangeEnd: "10.40.50.250",
      gatewayIp: "10.40.50.1",
      uplinkProfileName: "wld-uplink-profile",
      hostOverlayProfileName: "wld-host-overlay",
      teamingPolicy: "Failover Order",
      activeUplink1: "Selected",
      activeUplink2: "Unselected",
    };
    additionalCluster(original).networks.nsxHostOverlay = {
      ...createClusterNsxHostOverlay(),
      transportZoneName: "tz-overlay-ac",
      vlan: "3002",
      cidr: "10.50.50.0/24",
      teamingPolicy: "Load Balance Source MAC Address",
      activeUplink1: "uplink-1",  // free text on this sheet
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });

    const reWld = wldCluster(rebuilt).networks.nsxHostOverlay;
    expect(reWld.transportZoneName).toBe("tz-overlay-wld");
    expect(reWld.vlan).toBe("3001");
    expect(reWld.poolName).toBe("wld-tep-pool");
    expect(reWld.cidr).toBe("10.40.50.0/24");
    expect(reWld.ipRangeStart).toBe("10.40.50.10");
    expect(reWld.ipRangeEnd).toBe("10.40.50.250");
    expect(reWld.teamingPolicy).toBe("Failover Order");
    expect(reWld.activeUplink1).toBe("Selected");
    expect(reWld.activeUplink2).toBe("Unselected");

    const reAc = additionalCluster(rebuilt).networks.nsxHostOverlay;
    expect(reAc.transportZoneName).toBe("tz-overlay-ac");
    expect(reAc.vlan).toBe("3002");
    expect(reAc.teamingPolicy).toBe("Load Balance Source MAC Address");
    expect(reAc.activeUplink1).toBe("uplink-1");
  });

  it("Operational Mode apply coerces out-of-enum to Standard", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "NSX Operational Mode" && x.sheet === "Deploy Workload Domain");
    const f = fleetWith91Wld();
    const ctx = { instance: f.instances[0], cluster: wldCluster(f) };
    e.apply(f, ctx, "garbage");
    expect(wldCluster(f).networks.nsxHostOverlay.operationalMode).toBe("Standard");
    e.apply(f, ctx, "Enhanced Datapath Dedicated");
    expect(wldCluster(f).networks.nsxHostOverlay.operationalMode).toBe("Enhanced Datapath Dedicated");
  });

  it("Teaming Policy apply coerces out-of-enum to Load Balance Source", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "NSX Teaming Policy" && x.sheet === "Deploy Workload Domain");
    const f = fleetWith91Wld();
    const ctx = { instance: f.instances[0], cluster: wldCluster(f) };
    e.apply(f, ctx, "Round Robin");
    expect(wldCluster(f).networks.nsxHostOverlay.teamingPolicy).toBe("Load Balance Source");
  });
});

// Theme P-tail — Deploy Mgmt L269-L273 trailing portgroup (mgmt-cluster scope).
describe("Theme P-tail — Deploy Mgmt mgmt-cluster portgroup (5 cells)", () => {
  function findMgmt(label) {
    return WORKBOOK_CELL_MAP.find((x) => x.label === label && x.sheet === "Deploy Management Domain");
  }
  it("ships 5 mgmt-cluster entries on Deploy Mgmt L269-L273", () => {
    const labels = [
      ["NSX Apply Default Operation Mode (Mgmt)", "L269"],
      ["NSX Operational Mode (Mgmt)", "L270"],
      ["NSX Mgmt-Cluster PG Load Balancing", "L271"],
      ["NSX Mgmt-Cluster PG Uplink 1", "L272"],
      ["NSX Mgmt-Cluster PG Uplink 2", "L273"],
    ];
    for (const [label, cell] of labels) {
      const e = findMgmt(label);
      expect(e, label).toBeTruthy();
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("mgmt-cluster");
    }
  });

  it("L271 Load Balancing carries the 3-value NSX-Overlay enum (different from Theme M/P)", () => {
    const lb = findMgmt("NSX Mgmt-Cluster PG Load Balancing");
    expect(lb.dataValidation).toEqual([
      "Route based on source MAC hash",
      "Route based on the source of the port ID",
      "Use explicit failover order",
    ]);
  });

  it("L272/L273 uplinks carry Active/Standby/Unused", () => {
    expect(findMgmt("NSX Mgmt-Cluster PG Uplink 1").dataValidation).toEqual(["Active", "Standby", "Unused"]);
    expect(findMgmt("NSX Mgmt-Cluster PG Uplink 2").dataValidation).toEqual(["Active", "Standby", "Unused"]);
  });

  it("L269/L270 resolve from nsxHostOverlay top-level fields (shared with workload scope, per-cluster instance)", () => {
    const f = newFleet();
    f.instances[0].domains[0].clusters[0].networks.nsxHostOverlay.applyDefaultOperationMode = "Unselected";
    f.instances[0].domains[0].clusters[0].networks.nsxHostOverlay.operationalMode = "Enhanced Datapath Standard";
    const ctx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    expect(findMgmt("NSX Apply Default Operation Mode (Mgmt)").resolve(f, ctx)).toBe("Unselected");
    expect(findMgmt("NSX Operational Mode (Mgmt)").resolve(f, ctx)).toBe("Enhanced Datapath Standard");
  });

  it("L271-L273 resolve from nsxHostOverlay.mgmtClusterPortgroup sub-object", () => {
    const f = newFleet();
    const c = f.instances[0].domains[0].clusters[0];
    c.networks.nsxHostOverlay.mgmtClusterPortgroup = {
      loadBalancing: "Use explicit failover order",
      uplink1: "Standby",
      uplink2: "Unused",
    };
    const ctx = { instance: f.instances[0], cluster: c };
    expect(findMgmt("NSX Mgmt-Cluster PG Load Balancing").resolve(f, ctx)).toBe("Use explicit failover order");
    expect(findMgmt("NSX Mgmt-Cluster PG Uplink 1").resolve(f, ctx)).toBe("Standby");
    expect(findMgmt("NSX Mgmt-Cluster PG Uplink 2").resolve(f, ctx)).toBe("Unused");
  });

  it("apply normalizers coerce out-of-enum values to factory defaults", () => {
    const f = newFleet();
    const c = f.instances[0].domains[0].clusters[0];
    const ctx = { instance: f.instances[0], cluster: c };
    findMgmt("NSX Mgmt-Cluster PG Load Balancing").apply(f, ctx, "bogus");
    expect(c.networks.nsxHostOverlay.mgmtClusterPortgroup.loadBalancing).toBe("Route based on the source of the port ID");
    findMgmt("NSX Mgmt-Cluster PG Uplink 1").apply(f, ctx, "Diagonal");
    expect(c.networks.nsxHostOverlay.mgmtClusterPortgroup.uplink1).toBe("Active");
  });

  it("Deploy Mgmt mgmt-cluster portgroup round-trips through CSV import", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    const c = original.instances[0].domains[0].clusters[0];
    c.networks.nsxHostOverlay.applyDefaultOperationMode = "Unselected";
    c.networks.nsxHostOverlay.operationalMode = "Enhanced Datapath Dedicated";
    c.networks.nsxHostOverlay.mgmtClusterPortgroup = {
      loadBalancing: "Route based on source MAC hash",
      uplink1: "Standby",
      uplink2: "Active",
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });
    const reC = rebuilt.instances[0].domains[0].clusters[0];
    expect(reC.networks.nsxHostOverlay.applyDefaultOperationMode).toBe("Unselected");
    expect(reC.networks.nsxHostOverlay.operationalMode).toBe("Enhanced Datapath Dedicated");
    expect(reC.networks.nsxHostOverlay.mgmtClusterPortgroup).toEqual({
      loadBalancing: "Route based on source MAC hash",
      uplink1: "Standby",
      uplink2: "Active",
    });
  });
});
