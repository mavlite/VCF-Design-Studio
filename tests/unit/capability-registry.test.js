import { describe, it, expect } from "vitest";
import * as engine from "../../engine.js";

const {
  createFleetAdConfig, createFleetBackupConfig, createFleetInstallerConfig,
  createEdgeCluster, createClusterNsxHostOverlay, createClusterVpcConfig,
  baseStorageDataServices, createClusterPortgroups, baseClusterAdvanced,
  newFleet, newInstance,
} = engine;

describe("capability enabled flags — factory defaults", () => {
  it("flagless capability objects default enabled:false", () => {
    expect(createFleetAdConfig().enabled).toBe(false);
    expect(createFleetBackupConfig().enabled).toBe(false);
    expect(createFleetInstallerConfig().enabled).toBe(false);
    expect(createEdgeCluster().enabled).toBe(false);
    expect(createClusterNsxHostOverlay().enabled).toBe(false);
    expect(createClusterVpcConfig().enabled).toBe(false);
    expect(baseStorageDataServices().enabled).toBe(false);
    expect(createClusterPortgroups().enabled).toBe(false);
    expect(baseClusterAdvanced().enabled).toBe(false);
  });

  it("ops defaults on (appliances ship today); dr defaults off", () => {
    expect(newFleet().vcfOpsEnabled).toBe(true);
    expect(newInstance("i", ["s1"]).drEnabled).toBe(false);
  });
});

describe("CAPABILITY_REGISTRY + reads", () => {
  const { CAPABILITY_REGISTRY, capabilitiesForScope, isCapabilityEnabled,
          capabilityHasData, newFleet } = engine;

  it("declares the expected keys per scope", () => {
    const keys = CAPABILITY_REGISTRY.map((c) => c.key).sort();
    expect(keys).toEqual([
      "adsso","advanced","backup","dataservices","dr","edge","federation",
      "installer","ops","overlay","portgroups","stretched","supervisor","tiering","vpc",
    ].sort());
    expect(capabilitiesForScope("cluster").map((c) => c.key).sort()).toEqual([
      "advanced","dataservices","edge","overlay","portgroups","supervisor","tiering","vpc",
    ].sort());
  });

  it("isCapabilityEnabled reads the underlying field", () => {
    const fleet = newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(isCapabilityEnabled("edge", { cluster })).toBe(false);
    cluster.edgeCluster.enabled = true;
    expect(isCapabilityEnabled("edge", { cluster })).toBe(true);
    expect(isCapabilityEnabled("supervisor", { cluster })).toBe(false);
    cluster.supervisorConfig.enabled = true;
    expect(isCapabilityEnabled("supervisor", { cluster })).toBe(true);
    const domain = fleet.instances[0].domains[0];
    domain.placement = "local";
    expect(isCapabilityEnabled("stretched", { domain })).toBe(false);
    domain.placement = "stretched";
    expect(isCapabilityEnabled("stretched", { domain })).toBe(true);
    expect(isCapabilityEnabled("ops", { fleet })).toBe(true);
  });

  it("capabilityHasData detects deviation from factory defaults", () => {
    const fleet = newFleet();
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(capabilityHasData("edge", { cluster })).toBe(false);
    cluster.edgeCluster.nodes[0].fqdn = "en01.lab.local";
    expect(capabilityHasData("edge", { cluster })).toBe(true);

    expect(capabilityHasData("advanced", { cluster })).toBe(false);
    cluster.advanced.evcSetting = "Intel Cascade Lake";
    expect(capabilityHasData("advanced", { cluster })).toBe(true);

    expect(capabilityHasData("dataservices", { cluster })).toBe(false);
    cluster.storage.dataServices.dit.enabled = false; // dit toggle must NOT count as data
    expect(capabilityHasData("dataservices", { cluster })).toBe(false);
    cluster.storage.dataServices.datastoreName = "ds-01";
    expect(capabilityHasData("dataservices", { cluster })).toBe(true);
  });
});
