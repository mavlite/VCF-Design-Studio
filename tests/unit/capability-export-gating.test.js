import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { newFleet, newWorkloadDomain, sizeFleet, emitWorkbookCellMap, CAPABILITY_REGISTRY } = VcfEngine;

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
