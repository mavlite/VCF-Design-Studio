import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { newFleet, newInstance, newWorkloadDomain, sizeFleet, emitWorkbookCellMap, CAPABILITY_REGISTRY } = VcfEngine;

// Emit cell rows for a fleet. emitWorkbookCellMap(fleet, fleetResult) returns
// [{ workbookVersion, sheet, cell, label, value }].
function rows(fleet) {
  return emitWorkbookCellMap(fleet, sizeFleet(fleet));
}

describe("export-gating — clean cluster builders", () => {
  // Build a fleet that has BOTH a mgmt cluster and a workload cluster, so cells
  // at either scope can be asserted. Adjust if the helper names differ.
  function fleetWithWorkload() {
    const fleet = newFleet();
    // Add a workload domain+cluster so workload-scope cells emit.
    const inst = fleet.instances[0];
    const wldDom = newWorkloadDomain("WLD");
    wldDom.localSiteId = inst.siteIds[0];
    inst.domains.push(wldDom);
    return fleet;
  }
  const wldCluster = (f) => f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
  const has = (fleet, val) => rows(fleet).some((x) => x.value === val);

  it("vpc: data present but disabled → no vpc cells; enabled → present", () => {
    const fleet = fleetWithWorkload();
    const c = wldCluster(fleet);
    c.vpcConfig.externalPool.poolName = "ext-pool-1";
    c.vpcConfig.networkConnectivity = "Distributed Connectivity"; // non-default
    c.vpcConfig.enabled = false;
    expect(has(fleet, "ext-pool-1")).toBe(false);
    expect(has(fleet, "Distributed Connectivity")).toBe(false); // networkConnectivity entry gated too
    c.vpcConfig.enabled = true;
    expect(has(fleet, "ext-pool-1")).toBe(true);
    expect(has(fleet, "Distributed Connectivity")).toBe(true);
  });

  it("overlay: disabled with data → blank; enabled → present", () => {
    const fleet = fleetWithWorkload();
    const c = wldCluster(fleet);
    c.networks.nsxHostOverlay.transportZoneName = "tz-overlay-1";
    c.networks.nsxHostOverlay.enabled = false;
    expect(has(fleet, "tz-overlay-1")).toBe(false);
    c.networks.nsxHostOverlay.enabled = true;
    expect(has(fleet, "tz-overlay-1")).toBe(true);

    // Also cover the inline-tagged mgmt-cluster P-tail (Deploy Mgmt L269-273).
    const mgmtC = fleet.instances[0].domains[0].clusters[0];
    mgmtC.networks.nsxHostOverlay.operationalMode = "Enhanced Datapath Dedicated"; // non-default ("Standard")
    mgmtC.networks.nsxHostOverlay.enabled = false;
    expect(has(fleet, "Enhanced Datapath Dedicated")).toBe(false);
    mgmtC.networks.nsxHostOverlay.enabled = true;
    expect(has(fleet, "Enhanced Datapath Dedicated")).toBe(true);
  });

  it("portgroups: disabled with data → blank; enabled → present", () => {
    const fleet = fleetWithWorkload();
    const c = wldCluster(fleet);
    c.networks.portgroups.mgmt.name = "pg-mgmt-custom";
    c.networks.portgroups.enabled = false;
    expect(has(fleet, "pg-mgmt-custom")).toBe(false);
    c.networks.portgroups.enabled = true;
    expect(has(fleet, "pg-mgmt-custom")).toBe(true);
  });
});

describe("export-gating — fleet inline runs", () => {
  const has = (fleet, val) => rows(fleet).some((x) => x.value === val);

  it("installer: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    fleet.installerConfig.offlineDepotHostname = "depot.lab.local";
    fleet.installerConfig.depotType = "offline";
    fleet.installerConfig.enabled = false;
    expect(has(fleet, "depot.lab.local")).toBe(false);
    fleet.installerConfig.enabled = true;
    expect(has(fleet, "depot.lab.local")).toBe(true);
  });

  it("backup: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    fleet.backupConfig.host = "sftp.lab.local";
    fleet.backupConfig.enabled = false;
    expect(has(fleet, "sftp.lab.local")).toBe(false);
    fleet.backupConfig.enabled = true;
    expect(has(fleet, "sftp.lab.local")).toBe(true);
  });

  it("adsso: disabled with data → blank; enabled → present", () => {
    const fleet = newFleet();
    fleet.adConfig.adFqdn = "ad.lab.local";
    fleet.adConfig.enabled = false;
    expect(has(fleet, "ad.lab.local")).toBe(false);
    fleet.adConfig.enabled = true;
    expect(has(fleet, "ad.lab.local")).toBe(true);
  });
});

describe("export-gating — federation", () => {
  const has = (fleet, val) => rows(fleet).some((x) => x.value === val);

  function fedFleet() {
    const fleet = newFleet();
    // Federation cells require >= 2 instances. Add a second instance.
    fleet.instances.push(newInstance("vcf-instance-02", fleet.sites.map((s) => s.id)));
    return fleet;
  }

  it("disabled with data → blank; enabled → present", () => {
    const fleet = fedFleet();
    // Set a unique sentinel on fleet.federationConfig.globalManager.nodes[0].fqdn,
    // which is read by _nsxGmNodeIdentEntries(0, ...) via _getFederationNode(f, 0).fqdn.
    fleet.federationConfig = fleet.federationConfig || {};
    fleet.federationConfig.globalManager = fleet.federationConfig.globalManager || {};
    fleet.federationConfig.globalManager.nodes = fleet.federationConfig.globalManager.nodes || [];
    if (!fleet.federationConfig.globalManager.nodes[0]) {
      fleet.federationConfig.globalManager.nodes[0] = {};
    }
    fleet.federationConfig.globalManager.nodes[0].fqdn = "gm01.fed.local";
    fleet.federationEnabled = false;
    expect(has(fleet, "gm01.fed.local")).toBe(false);
    fleet.federationEnabled = true;
    expect(has(fleet, "gm01.fed.local")).toBe(true);
  });
});

describe("export-gating mechanism", () => {
  it("emitWorkbookCellMap + CAPABILITY_REGISTRY are exported", () => {
    expect(typeof emitWorkbookCellMap).toBe("function");
    expect(Array.isArray(CAPABILITY_REGISTRY)).toBe(true);
  });

  it("untagged entries are unaffected (a known always-on cell still stamps)", () => {
    const fleet = newFleet();
    fleet.networkConfig = fleet.networkConfig || {};
    fleet.networkConfig.dns = { primaryDomain: "lab.example.com" };
    const r = rows(fleet);
    expect(r.some((x) => x.value === "lab.example.com")).toBe(true);
  });
});

// Shared helpers for the guard suites below.
function fleetWithWorkloadCluster() {
  const fleet = newFleet();
  const inst = fleet.instances[0];
  const wldDom = newWorkloadDomain("WLD");
  wldDom.localSiteId = inst.siteIds[0];
  inst.domains.push(wldDom);
  return fleet;
}
const wldClusterOf = (f) => f.instances[0].domains.find((d) => d.type === "workload").clusters[0];

describe("export-gating — NON-gated capabilities still export when off", () => {
  const has = (fleet, val) => rows(fleet).some((x) => x.value === val);

  it("dataservices still exports when disabled (visibility-only)", () => {
    const fleet = fleetWithWorkloadCluster();
    const c = wldClusterOf(fleet);
    c.storage.dataServices.datastoreName = "ds-keepme";
    c.storage.dataServices.enabled = false;
    expect(has(fleet, "ds-keepme")).toBe(true);
  });

  it("supervisor still exports its config when disabled (not gated)", () => {
    const fleet = fleetWithWorkloadCluster();
    const c = wldClusterOf(fleet);
    c.supervisorConfig.supervisorName = "sup-keepme";
    c.supervisorConfig.enabled = false;
    expect(has(fleet, "sup-keepme")).toBe(true);
  });

  it("T0 uplink cells are independent of the edge capability flag", () => {
    const fleet = fleetWithWorkloadCluster();
    const c = wldClusterOf(fleet);
    c.networks.uplinks = [{ vlan: 100, gateway: "10.0.0.1" }, { vlan: 101, gateway: "10.0.1.1" }];
    c.edgeCluster.enabled = false; // edge off must NOT blank T0 uplink VLAN/gateway cells
    expect(has(fleet, "10.0.0.1")).toBe(true);
  });
});

// Straggler-completeness guard: stamp a unique sentinel across many fields of a
// gated capability's model object, disable it, and assert NO emitted cell leaks
// the sentinel. If a future entry reads the object but is missing the capability
// tag, its cell stamps the sentinel and the matching test fails. (edge is covered
// in its own task once its mixed-builder split lands.)
describe("export-gating — straggler completeness (no untagged cell leaks when off)", () => {
  const leaks = (fleet, sentinel) =>
    rows(fleet).filter((x) => typeof x.value === "string" && x.value.includes(sentinel));

  it("vpc: no cell leaks when disabled", () => {
    const fleet = fleetWithWorkloadCluster();
    const c = wldClusterOf(fleet);
    for (const pool of [c.vpcConfig.externalPool, c.vpcConfig.tgwPool]) {
      pool.poolName = "SENTVPC-name";
      pool.ipBlocks = "SENTVPC-blk";
      pool.excludedIps = "SENTVPC-excl";
      pool.reservedSubnet = "SENTVPC-rsv";
      pool.visibility = "SENTVPC-vis";
    }
    c.vpcConfig.enabled = false;
    expect(leaks(fleet, "SENTVPC")).toEqual([]);
  });

  it("overlay: no cell leaks when disabled", () => {
    const fleet = fleetWithWorkloadCluster();
    const o = wldClusterOf(fleet).networks.nsxHostOverlay;
    for (const k of ["transportZoneName", "vlanTransportZoneName", "poolName", "poolDescription",
                     "cidr", "ipRangeStart", "ipRangeEnd", "gatewayIp", "uplinkProfileName",
                     "hostOverlayProfileName"]) o[k] = "SENTOVL-" + k;
    o.enabled = false;
    expect(leaks(fleet, "SENTOVL")).toEqual([]);
  });

  it("portgroups: no cell leaks when disabled", () => {
    const fleet = fleetWithWorkloadCluster();
    const pg = wldClusterOf(fleet).networks.portgroups;
    for (const k of Object.keys(pg)) {
      if (k === "enabled") continue;
      if (pg[k] && typeof pg[k] === "object") pg[k].name = "SENTPG-" + k;
    }
    pg.enabled = false;
    expect(leaks(fleet, "SENTPG")).toEqual([]);
  });

  it("installer: no cell leaks when disabled", () => {
    const fleet = newFleet();
    Object.assign(fleet.installerConfig, {
      offlineDepotHostname: "SENTINST-host", downloadToken: "SENTINST-tok",
      activationCode: "SENTINST-act", proxyHost: "SENTINST-proxy", proxyUser: "SENTINST-user",
    });
    fleet.installerConfig.enabled = false;
    expect(leaks(fleet, "SENTINST")).toEqual([]);
  });

  it("backup: no cell leaks when disabled", () => {
    const fleet = newFleet();
    Object.assign(fleet.backupConfig, {
      host: "SENTBK-host", user: "SENTBK-user", directory: "SENTBK-dir", sshFingerprint: "SENTBK-fp",
    });
    fleet.backupConfig.enabled = false;
    expect(leaks(fleet, "SENTBK")).toEqual([]);
  });

  it("adsso: no cell leaks when disabled", () => {
    const fleet = newFleet();
    fleet.adConfig.adFqdn = "SENTAD-fqdn";
    fleet.adConfig.adUser = "SENTAD-user";
    fleet.adConfig.serviceAccountUser = "SENTAD-svc";
    fleet.adConfig.ca.fqdn = "SENTAD-ca";
    fleet.adConfig.ca.url = "SENTAD-url";
    fleet.adConfig.ca.csrSubject.commonName = "SENTAD-cn";
    fleet.adConfig.ca.csrSubject.org = "SENTAD-org";
    fleet.adConfig.enabled = false;
    expect(leaks(fleet, "SENTAD")).toEqual([]);
  });

  it("federation: no cell leaks when disabled", () => {
    const fleet = newFleet();
    fleet.instances.push(newInstance("vcf-instance-02", fleet.sites.map((s) => s.id)));
    fleet.federationConfig = fleet.federationConfig || {};
    const gm = (fleet.federationConfig.globalManager = fleet.federationConfig.globalManager || {});
    gm.nodes = gm.nodes || [{}, {}, {}];
    gm.nodes[0].fqdn = "SENTFED-gm0";
    gm.federationName = "SENTFED-name";
    gm.vipAddress = "SENTFED-vip";
    fleet.federationEnabled = false;
    expect(leaks(fleet, "SENTFED")).toEqual([]);
  });
});
