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

    // supervisor/tiering hasData reflect real field deviation, not just enabled
    const fleet2 = newFleet();
    const c2 = fleet2.instances[0].domains[0].clusters[0];
    expect(capabilityHasData("tiering", { cluster: c2 })).toBe(false);
    c2.tiering.nvmePct = 80;
    expect(capabilityHasData("tiering", { cluster: c2 })).toBe(true);
    expect(capabilityHasData("supervisor", { cluster: c2 })).toBe(false);
    c2.supervisorConfig.supervisorName = "sup-01";
    expect(capabilityHasData("supervisor", { cluster: c2 })).toBe(true);
  });
});

describe("exportGated registry flag", () => {
  const { CAPABILITY_REGISTRY } = engine;
  it("marks exactly the gated set", () => {
    const gated = CAPABILITY_REGISTRY.filter((c) => c.exportGated).map((c) => c.key).sort();
    expect(gated).toEqual(
      ["adsso", "backup", "edge", "federation", "installer", "overlay", "portgroups", "vpc"].sort()
    );
  });
});

describe("toggleCapability — immutable writes", () => {
  const { toggleCapability, isCapabilityEnabled, newFleet } = engine;

  it("returns a new cluster with the flag flipped, input unchanged", () => {
    const cluster = newFleet().instances[0].domains[0].clusters[0];
    const next = toggleCapability("edge", cluster, true, { cluster });
    expect(next).not.toBe(cluster);
    expect(cluster.edgeCluster.enabled).toBe(false);     // input untouched
    expect(next.edgeCluster.enabled).toBe(true);
    expect(isCapabilityEnabled("edge", { cluster: next })).toBe(true);
  });

  it("preserves sibling data on disable (non-destructive)", () => {
    const cluster = newFleet().instances[0].domains[0].clusters[0];
    cluster.edgeCluster.enabled = true;
    cluster.edgeCluster.name = "edge-01";
    const off = toggleCapability("edge", cluster, false, { cluster });
    expect(off.edgeCluster.enabled).toBe(false);
    expect(off.edgeCluster.name).toBe("edge-01");        // data kept
    expect(cluster.edgeCluster.enabled).toBe(true);      // input unchanged
  });

  it("stretched toggle flips placement and seeds stretchSiteIds", () => {
    const fleet = newFleet();
    const instance = fleet.instances[0];
    instance.siteIds = ["s1", "s2"];
    const domain = instance.domains[0];
    domain.placement = "local";
    const on = toggleCapability("stretched", domain, true, { instance, domain });
    expect(on.placement).toBe("stretched");
    expect(on.stretchSiteIds).toEqual(["s1", "s2"]);
    expect(domain.placement).toBe("local");              // input domain unchanged
    const off = toggleCapability("stretched", on, false, { instance, domain: on });
    expect(off.placement).toBe("local");
    expect(off.stretchSiteIds).toBe(null);
  });
});
