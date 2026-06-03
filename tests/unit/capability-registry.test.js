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
