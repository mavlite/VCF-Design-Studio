import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme 12 — Stretched-cluster witness appliance + AZ2 host overlay.
// New model surface:
//   instance.witnessConfig  — vSAN witness appliance deployment metadata
//   instance.mgmtClusterSddcId — UUID referenced from additional clusters
//   cluster.az2HostOverlay  — per-cluster AZ2 NSX host overlay block
//   cluster.vsanCompute     — workload-cluster-only fault-domain mapping
// Witness root password rides the existing "vsan-witness-root" vault flow.

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  createWitnessConfig,
  createClusterAz2HostOverlay,
  createClusterVsanCompute,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
} = VcfEngine;

const MGMT_SHEET = "Configure Management Domain";
const CLUSTER_SHEET = "Deploy Cluster";

function findEntry(label) {
  return WORKBOOK_CELL_MAP.find((e) => e.label === label);
}

function fleetWithAdditionalCluster(vcfVersion = "9.1") {
  const f = newFleet();
  f.vcfVersion = vcfVersion;
  f.version = "vcf-sizer-v9";
  const wld = newWorkloadDomain("WLD-01");
  wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
  f.instances[0].domains.push(wld);
  return f;
}

function additionalCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[1];
}

describe("Theme 12 — factory shape", () => {
  it("createWitnessConfig documents the 6 witness identity fields", () => {
    expect(createWitnessConfig()).toEqual({
      vmName: "",
      clusterName: "",
      vsanDatastore: "",
      mgmtNetwork: "",
      fqdn: "",
      mgmtIp: "",
    });
  });

  it("createClusterAz2HostOverlay documents profile + pool + network fields with sane defaults", () => {
    expect(createClusterAz2HostOverlay()).toEqual({
      profileName: "",
      staticIpPoolType: "Create New Static IP Pool",
      poolName: "",
      uplinkProfileName: "",
      vlan: "",
      gateway: "",
      cidr: "",
      mtu: 9000,
      ipRangeStart: "",
      ipRangeEnd: "",
    });
  });

  it("createClusterVsanCompute defaults to Symmetric / Primary", () => {
    expect(createClusterVsanCompute()).toEqual({
      siteNetworkTopology: "Symmetric",
      faultDomainMapping: "Primary",
    });
  });

  it("factories return fresh objects on each call (no shared refs)", () => {
    const a = createWitnessConfig();
    a.fqdn = "mutate";
    expect(createWitnessConfig().fqdn).toBe("");
    const b = createClusterAz2HostOverlay();
    b.vlan = "mutate";
    expect(createClusterAz2HostOverlay().vlan).toBe("");
  });
});

describe("Theme 12 — newFleet wires the new fields", () => {
  it("instance has witnessConfig + mgmtClusterSddcId; every cluster has az2HostOverlay + vsanCompute", () => {
    const f = newFleet();
    const inst = f.instances[0];
    expect(inst.witnessConfig).toEqual(createWitnessConfig());
    expect(inst.mgmtClusterSddcId).toBe("");
    const mgmtCluster = inst.domains[0].clusters[0];
    expect(mgmtCluster.az2HostOverlay).toEqual(createClusterAz2HostOverlay());
    expect(mgmtCluster.vsanCompute).toEqual(createClusterVsanCompute());
  });
});

describe("Theme 12 — migrateFleet backfill", () => {
  it("backfills witnessConfig + mgmtClusterSddcId on a legacy instance that lacks them", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    delete f.instances[0].witnessConfig;
    delete f.instances[0].mgmtClusterSddcId;
    const m = migrateFleet(f);
    expect(m.instances[0].witnessConfig).toEqual(createWitnessConfig());
    expect(m.instances[0].mgmtClusterSddcId).toBe("");
  });

  it("backfills cluster.az2HostOverlay + cluster.vsanCompute on legacy clusters", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    delete f.instances[0].domains[0].clusters[0].az2HostOverlay;
    delete f.instances[0].domains[0].clusters[0].vsanCompute;
    const m = migrateFleet(f);
    expect(m.instances[0].domains[0].clusters[0].az2HostOverlay).toEqual(createClusterAz2HostOverlay());
    expect(m.instances[0].domains[0].clusters[0].vsanCompute).toEqual(createClusterVsanCompute());
  });

  it("preserves user-customized values across re-migrate (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.instances[0].witnessConfig.fqdn = "witness.example.com";
    f.instances[0].witnessConfig.mgmtIp = "10.99.99.5";
    f.instances[0].mgmtClusterSddcId = "abc-uuid";
    const c = f.instances[0].domains[0].clusters[0];
    c.az2HostOverlay.profileName = "az2-profile-a";
    c.az2HostOverlay.vlan = "3002";
    c.az2HostOverlay.cidr = "10.20.30.0/24";
    c.az2HostOverlay.mtu = 1700;
    c.vsanCompute.siteNetworkTopology = "Asymmetric";
    c.vsanCompute.faultDomainMapping = "Secondary";

    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    expect(r2.instances[0].witnessConfig.fqdn).toBe("witness.example.com");
    expect(r2.instances[0].witnessConfig.mgmtIp).toBe("10.99.99.5");
    expect(r2.instances[0].mgmtClusterSddcId).toBe("abc-uuid");
    const rc = r2.instances[0].domains[0].clusters[0];
    expect(rc.az2HostOverlay.profileName).toBe("az2-profile-a");
    expect(rc.az2HostOverlay.vlan).toBe("3002");
    expect(rc.az2HostOverlay.cidr).toBe("10.20.30.0/24");
    expect(rc.az2HostOverlay.mtu).toBe(1700);
    expect(rc.vsanCompute.siteNetworkTopology).toBe("Asymmetric");
    expect(rc.vsanCompute.faultDomainMapping).toBe("Secondary");
  });

  it("drops unknown keys at every theme-12 sub-object (whitelist-merge)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.instances[0].witnessConfig = { fqdn: "x", bogus1: "junk" };
    f.instances[0].domains[0].clusters[0].az2HostOverlay = { vlan: "v", bogus2: "junk" };
    f.instances[0].domains[0].clusters[0].vsanCompute = { siteNetworkTopology: "Asymmetric", bogus3: "junk" };
    const m = migrateFleet(f);
    expect(m.instances[0].witnessConfig).not.toHaveProperty("bogus1");
    expect(m.instances[0].witnessConfig.fqdn).toBe("x");
    const c = m.instances[0].domains[0].clusters[0];
    expect(c.az2HostOverlay).not.toHaveProperty("bogus2");
    expect(c.az2HostOverlay.vlan).toBe("v");
    expect(c.vsanCompute).not.toHaveProperty("bogus3");
    expect(c.vsanCompute.siteNetworkTopology).toBe("Asymmetric");
  });
});

describe("Theme 12 — WORKBOOK_CELL_MAP entries", () => {
  it("ships 7 Configure Mgmt witness identity entries (6 instance + 1 vault, 9.1-only)", () => {
    for (const [label, cell] of [
      ["Witness VM Name", "D383"],
      ["Witness Cluster Name", "D384"],
      ["Witness vSAN Datastore Name", "D386"],
      ["Witness Management Network", "D387"],
      ["Witness Management IP", "D390"],
      ["Witness FQDN", "D442"],
    ]) {
      const e = findEntry(label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe(MGMT_SHEET);
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("instance");
    }
    // Vault entry — emitOnly, passwordKind set, no apply.
    const pwd = findEntry("Witness Root Password");
    expect(pwd).toBeTruthy();
    expect(pwd.cell).toBe("D389");
    expect(pwd.passwordKind).toBe("vsan-witness-root");
    expect(pwd.emitOnly).toBe(true);
    expect(pwd.workbookVersions).toEqual(["9.1"]);
  });

  it("ships 10 Configure Mgmt AZ2 overlay entries (mgmt-cluster, 9.1-only)", () => {
    const mgmtAz2 = WORKBOOK_CELL_MAP.filter((e) => /^AZ2 Host Overlay.*\(Mgmt\)$/.test(e.label));
    expect(mgmtAz2).toHaveLength(10);
    for (const e of mgmtAz2) {
      expect(e.sheet).toBe(MGMT_SHEET);
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("mgmt-cluster");
    }
    // Spot-check the dropdown enum matches the workbook.
    const poolType = findEntry("AZ2 Host Overlay Static IP Pool Type (Mgmt)");
    expect(poolType.dataValidation).toEqual(["Re-use an existing Pool", "Create New Static IP Pool"]);
  });

  it("ships 13 Deploy Cluster entries (2 vSAN compute + 10 AZ2 + 1 SDDC ID), all dual-version", () => {
    const dcEntries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === CLUSTER_SHEET && (
        /^AZ2 Host Overlay.*\(Additional Cluster\)$/.test(e.label) ||
        e.label === "vSAN Compute Site Network Topology" ||
        e.label === "vSAN Compute Fault Domain Mapping" ||
        e.label === "Management Cluster SDDC ID"
      )
    );
    expect(dcEntries).toHaveLength(13);
    for (const e of dcEntries) {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.scope).toBe("additional-cluster");
    }
    // Spot-check dropdown enums.
    expect(findEntry("vSAN Compute Site Network Topology").dataValidation).toEqual(["Symmetric", "Asymmetric"]);
    expect(findEntry("vSAN Compute Fault Domain Mapping").dataValidation).toEqual(["Primary", "Secondary"]);
    expect(findEntry("AZ2 Host Overlay Static IP Pool Type (Additional Cluster)").dataValidation).toEqual(["Re-use an existing Pool", "Create New Static IP Pool"]);
  });

  it("vSAN compute + AZ2 overlay cells map 9.0 -> 9.1 with a +12 row shift", () => {
    const pairs = [
      ["vSAN Compute Site Network Topology", "D403", "D415"],
      ["vSAN Compute Fault Domain Mapping", "D404", "D416"],
      ["AZ2 Host Overlay Profile Name (Additional Cluster)", "D405", "D417"],
      ["AZ2 Host Overlay Static IP Pool Type (Additional Cluster)", "D406", "D418"],
      ["AZ2 Host Overlay VLAN (Additional Cluster)", "D409", "D421"],
      ["AZ2 Host Overlay MTU (Additional Cluster)", "D412", "D424"],
      ["AZ2 Host Overlay IP Range End (Additional Cluster)", "D414", "D426"],
      ["Management Cluster SDDC ID", "D418", "D430"],
    ];
    for (const [label, c90, c91] of pairs) {
      const e = findEntry(label);
      expect(e, label).toBeTruthy();
      expect(e.cell).toBe(c90);
      expect(e.cellByVersion).toEqual({ "9.1": c91 });
    }
  });
});

describe("Theme 12 — emit + round-trip", () => {
  it("emits empty defaults + 9000 MTU + Symmetric/Primary on a fresh 9.1 fleet", () => {
    const f = fleetWithAdditionalCluster("9.1");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell, sheet = CLUSTER_SHEET) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    // Configure Mgmt witness defaults.
    expect(find("D383", MGMT_SHEET).value).toBe("");
    expect(find("D442", MGMT_SHEET).value).toBe("");
    // Mgmt-cluster AZ2 default MTU + pool type.
    expect(find("D439", MGMT_SHEET).value).toBe("9000");
    expect(find("D433", MGMT_SHEET).value).toBe("Create New Static IP Pool");
    // Additional-cluster defaults (at 9.1 addresses).
    expect(find("D415").value).toBe("Symmetric");
    expect(find("D416").value).toBe("Primary");
    expect(find("D418").value).toBe("Create New Static IP Pool");
    expect(find("D424").value).toBe("9000");
  });

  it("does NOT emit witness-identity or mgmt AZ2 cells on a 9.0 fleet (9.1-only gate)", () => {
    const f = fleetWithAdditionalCluster("9.0");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => r.label === "Witness FQDN")).toBeUndefined();
    expect(rows.find((r) => r.label === "AZ2 Host Overlay VLAN (Mgmt)")).toBeUndefined();
    expect(rows.find((r) => r.label === "Witness Root Password")).toBeUndefined();
    // Additional-cluster AZ2 still emits on 9.0 at 9.0 addresses.
    const az2Vlan = rows.find((r) => r.label === "AZ2 Host Overlay VLAN (Additional Cluster)");
    expect(az2Vlan).toBeTruthy();
    expect(az2Vlan.cell).toBe("D409");
  });

  it("9.1 CSV round-trip preserves witness identity + per-cluster AZ2 + vsan compute + SDDC ID", () => {
    const original = fleetWithAdditionalCluster("9.1");
    const inst = original.instances[0];
    inst.witnessConfig = {
      vmName: "vcf01-witness-01",
      clusterName: "Witness-Cluster",
      vsanDatastore: "vsanDatastore-witness",
      mgmtNetwork: "vDS-Mgmt-PG",
      fqdn: "witness01.example.com",
      mgmtIp: "10.99.99.5",
    };
    inst.mgmtClusterSddcId = "11111111-2222-3333-4444-555555555555";
    const c = additionalCluster(original);
    c.az2HostOverlay = {
      profileName: "az2-prof",
      staticIpPoolType: "Re-use an existing Pool",
      poolName: "az2-pool",
      uplinkProfileName: "az2-uplink",
      vlan: "3002",
      gateway: "10.20.30.1",
      cidr: "10.20.30.0/24",
      mtu: 1700,
      ipRangeStart: "10.20.30.10",
      ipRangeEnd: "10.20.30.50",
    };
    c.vsanCompute = {
      siteNetworkTopology: "Asymmetric",
      faultDomainMapping: "Secondary",
    };

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });

    expect(rebuilt.instances[0].witnessConfig).toEqual(inst.witnessConfig);
    expect(rebuilt.instances[0].mgmtClusterSddcId).toBe("11111111-2222-3333-4444-555555555555");
    const rc = additionalCluster(rebuilt);
    expect(rc.az2HostOverlay).toEqual(c.az2HostOverlay);
    expect(rc.vsanCompute).toEqual(c.vsanCompute);
  });

  it("9.0 round-trip preserves only the additional-cluster fields (witness identity is 9.1-only)", () => {
    const original = fleetWithAdditionalCluster("9.0");
    const c = additionalCluster(original);
    c.az2HostOverlay.vlan = "3003";
    c.az2HostOverlay.cidr = "10.20.31.0/24";
    c.vsanCompute.siteNetworkTopology = "Asymmetric";
    original.instances[0].mgmtClusterSddcId = "uuid-90";

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    const rc = additionalCluster(rebuilt);
    expect(rc.az2HostOverlay.vlan).toBe("3003");
    expect(rc.az2HostOverlay.cidr).toBe("10.20.31.0/24");
    expect(rc.vsanCompute.siteNetworkTopology).toBe("Asymmetric");
    expect(rebuilt.instances[0].mgmtClusterSddcId).toBe("uuid-90");
  });

  it("MTU apply coerces non-numeric values back to the factory default 9000", () => {
    const mtu = findEntry("AZ2 Host Overlay MTU (Additional Cluster)");
    const f = fleetWithAdditionalCluster("9.1");
    const c = additionalCluster(f);
    const ctx = { instance: f.instances[0], cluster: c };
    mtu.apply(f, ctx, "garbage");
    expect(c.az2HostOverlay.mtu).toBe(9000);
    mtu.apply(f, ctx, "1700");
    expect(c.az2HostOverlay.mtu).toBe(1700);
  });

  it("Static IP Pool Type apply rejects out-of-enum values, falls back to factory default", () => {
    const e = findEntry("AZ2 Host Overlay Static IP Pool Type (Mgmt)");
    const f = newFleet();
    const ctx = { instance: f.instances[0], cluster: f.instances[0].domains[0].clusters[0] };
    e.apply(f, ctx, "bogus value");
    expect(ctx.cluster.az2HostOverlay.staticIpPoolType).toBe("Create New Static IP Pool");
    e.apply(f, ctx, "Re-use an existing Pool");
    expect(ctx.cluster.az2HostOverlay.staticIpPoolType).toBe("Re-use an existing Pool");
  });
});
