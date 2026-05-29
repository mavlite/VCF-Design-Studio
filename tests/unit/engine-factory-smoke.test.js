// engine.js Phase A smoke coverage — call every create*Config /
// new*Gateway factory once so the v8 coverage report stops listing
// their object-literal continuation lines as uncovered. Asserts only
// non-null shaped return — does NOT exercise behavior. Real-behavior
// coverage lives in Phase B suites (naming templates, IP allocator,
// AZ2/BGP validators) under their own test files.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newT0Gateway,
  createFleetNetworkConfig,
  createVdsLag,
  createNetworkIpv6,
  createPortgroupSlot,
  createClusterNsxHostOverlay,
  createClusterPortgroups,
  createClusterNetworks,
  createHostIpOverride,
  createFleetReportMetadata,
  createFleetInstallerConfig,
  createFleetBackupConfig,
  createEdgeNode,
  createEdgeCluster,
  // createFederationNode — not exported (internal helper called by createFleetFederationConfig)
  createFederationGlobalManagerExtras,
  createFederationLocalManager,
  createFederationTier1,
  createWitnessConfig,
  createClusterAz2HostOverlay,
  createClusterAz2Networks,
  createSupervisorDeployment,
  createClusterSupervisorConfig,
  createClusterVsanCompute,
  createFleetFederationConfig,
  createFleetAdConfig,
  createFleetNamingConfig,
  createClusterNaming,
  newCluster,
  newMgmtCluster,
  newWorkloadCluster,
  newMgmtDomain,
  newWorkloadDomain,
  newInstance,
  newSite,
  newFleet,
} = VcfEngine;

describe("engine.js factory smoke — Phase A", () => {
  it("newT0Gateway returns a shaped object", () => {
    const t0 = newT0Gateway();
    expect(t0).toBeDefined();
    expect(typeof t0).toBe("object");
    expect(t0.name).toBeDefined();
  });

  it("createFleetNetworkConfig returns a shaped object", () => {
    const cfg = createFleetNetworkConfig();
    expect(cfg).toBeDefined();
    expect(typeof cfg).toBe("object");
    expect(cfg.dns).toBeDefined();
  });

  it("createVdsLag returns a shaped object", () => {
    const lag = createVdsLag();
    expect(lag).toBeDefined();
    expect(typeof lag).toBe("object");
    expect(lag.mode).toBeDefined();
  });

  it("createNetworkIpv6 returns a shaped object", () => {
    const ipv6 = createNetworkIpv6();
    expect(ipv6).toBeDefined();
    expect(typeof ipv6).toBe("object");
    expect(ipv6).toHaveProperty("gatewayCidr");
  });

  it("createPortgroupSlot returns a shaped object", () => {
    const slot = createPortgroupSlot();
    expect(slot).toBeDefined();
    expect(typeof slot).toBe("object");
    expect(slot.loadBalancing).toBeDefined();
  });

  it("createClusterNsxHostOverlay returns a shaped object", () => {
    const overlay = createClusterNsxHostOverlay();
    expect(overlay).toBeDefined();
    expect(typeof overlay).toBe("object");
    expect(overlay.operationalMode).toBeDefined();
  });

  it("createClusterPortgroups returns a shaped object", () => {
    const pgs = createClusterPortgroups();
    expect(pgs).toBeDefined();
    expect(typeof pgs).toBe("object");
    expect(pgs.mgmt).toBeDefined();
  });

  it("createClusterNetworks returns a shaped object", () => {
    const nets = createClusterNetworks();
    expect(nets).toBeDefined();
    expect(typeof nets).toBe("object");
    expect(nets.mgmt).toBeDefined();
  });

  it("createHostIpOverride(0) returns a shaped object", () => {
    const override = createHostIpOverride(0);
    expect(override).toBeDefined();
    expect(typeof override).toBe("object");
    expect(override.hostIndex).toBe(0);
  });

  it("createFleetReportMetadata returns a shaped object", () => {
    const meta = createFleetReportMetadata();
    expect(meta).toBeDefined();
    expect(typeof meta).toBe("object");
    expect(meta).toHaveProperty("clientName");
  });

  it("createFleetInstallerConfig returns a shaped object", () => {
    const cfg = createFleetInstallerConfig();
    expect(cfg).toBeDefined();
    expect(typeof cfg).toBe("object");
  });

  it("createFleetBackupConfig returns a shaped object", () => {
    const cfg = createFleetBackupConfig();
    expect(cfg).toBeDefined();
    expect(typeof cfg).toBe("object");
  });

  it("createEdgeNode returns a shaped object", () => {
    const node = createEdgeNode();
    expect(node).toBeDefined();
    expect(typeof node).toBe("object");
    expect(node).toHaveProperty("fqdn");
  });

  it("createEdgeCluster returns a shaped object", () => {
    const cluster = createEdgeCluster();
    expect(cluster).toBeDefined();
    expect(typeof cluster).toBe("object");
    expect(cluster.nodes).toBeDefined();
  });

  // createFederationNode is not exported — it is an internal helper called only
  // by createFleetFederationConfig. Coverage is reclaimed via that factory's test.
  it.skip("createFederationNode returns a shaped object", () => {
    // not exported from engine.js — covered transitively via createFleetFederationConfig
  });

  it("createFederationGlobalManagerExtras returns a shaped object", () => {
    const extras = createFederationGlobalManagerExtras();
    expect(extras).toBeDefined();
    expect(typeof extras).toBe("object");
    expect(extras).toHaveProperty("clusterId");
  });

  it("createFederationLocalManager returns a shaped object", () => {
    const lm = createFederationLocalManager();
    expect(lm).toBeDefined();
    expect(typeof lm).toBe("object");
    expect(lm).toHaveProperty("name");
  });

  it("createFederationTier1 returns a shaped object", () => {
    const t1 = createFederationTier1();
    expect(t1).toBeDefined();
    expect(typeof t1).toBe("object");
    expect(t1).toHaveProperty("name");
  });

  it("createWitnessConfig returns a shaped object", () => {
    const wc = createWitnessConfig();
    expect(wc).toBeDefined();
    expect(typeof wc).toBe("object");
    expect(wc).toHaveProperty("vmName");
  });

  it("createClusterAz2HostOverlay returns a shaped object", () => {
    const az2 = createClusterAz2HostOverlay();
    expect(az2).toBeDefined();
    expect(typeof az2).toBe("object");
    expect(az2).toHaveProperty("profileName");
  });

  it("createClusterAz2Networks returns a shaped object", () => {
    const az2nets = createClusterAz2Networks();
    expect(az2nets).toBeDefined();
    expect(typeof az2nets).toBe("object");
    expect(az2nets.mgmt).toBeDefined();
  });

  it("createSupervisorDeployment returns a shaped object", () => {
    const dep = createSupervisorDeployment();
    expect(dep).toBeDefined();
    expect(typeof dep).toBe("object");
    expect(dep).toHaveProperty("useEsxiMgmtVmk");
  });

  it("createClusterSupervisorConfig returns a shaped object", () => {
    const sup = createClusterSupervisorConfig();
    expect(sup).toBeDefined();
    expect(typeof sup).toBe("object");
    expect(sup.enabled).toBe(false);
  });

  it("createClusterVsanCompute returns a shaped object", () => {
    const vc = createClusterVsanCompute();
    expect(vc).toBeDefined();
    expect(typeof vc).toBe("object");
    expect(vc).toHaveProperty("siteNetworkTopology");
  });

  it("createFleetFederationConfig returns a shaped object", () => {
    const fc = createFleetFederationConfig();
    expect(fc).toBeDefined();
    expect(typeof fc).toBe("object");
    expect(fc.globalManager).toBeDefined();
  });

  it("createFleetAdConfig returns a shaped object", () => {
    const ad = createFleetAdConfig();
    expect(ad).toBeDefined();
    expect(typeof ad).toBe("object");
    expect(ad).toHaveProperty("adFqdn");
  });

  it("createFleetNamingConfig returns a shaped object", () => {
    const nc = createFleetNamingConfig();
    expect(nc).toBeDefined();
    expect(typeof nc).toBe("object");
    expect(nc).toHaveProperty("hostTemplate");
  });

  it("createClusterNaming returns a shaped object", () => {
    const cn = createClusterNaming();
    expect(cn).toBeDefined();
    expect(typeof cn).toBe("object");
    expect(cn).toHaveProperty("hostTemplate");
  });

  it("newCluster returns a shaped object", () => {
    const c = newCluster();
    expect(c).toBeDefined();
    expect(typeof c).toBe("object");
    expect(c.id).toBeDefined();
    expect(c.name).toBe("cluster-01");
  });

  it("newMgmtCluster returns a shaped object", () => {
    const c = newMgmtCluster();
    expect(c).toBeDefined();
    expect(typeof c).toBe("object");
    expect(c.id).toBeDefined();
    expect(Array.isArray(c.infraStack)).toBe(true);
  });

  it("newWorkloadCluster returns a shaped object", () => {
    const c = newWorkloadCluster();
    expect(c).toBeDefined();
    expect(typeof c).toBe("object");
    expect(c.id).toBeDefined();
    expect(Array.isArray(c.infraStack)).toBe(true);
  });

  it("newMgmtDomain returns a shaped object", () => {
    const d = newMgmtDomain();
    expect(d).toBeDefined();
    expect(typeof d).toBe("object");
    expect(d.id).toBeDefined();
    expect(d.type).toBe("mgmt");
  });

  it("newWorkloadDomain returns a shaped object", () => {
    const d = newWorkloadDomain();
    expect(d).toBeDefined();
    expect(typeof d).toBe("object");
    expect(d.id).toBeDefined();
    expect(d.type).toBe("workload");
  });

  it("newInstance returns a shaped object", () => {
    const inst = newInstance();
    expect(inst).toBeDefined();
    expect(typeof inst).toBe("object");
    expect(inst.id).toBeDefined();
    expect(Array.isArray(inst.domains)).toBe(true);
  });

  it("newSite returns a shaped object", () => {
    const site = newSite();
    expect(site).toBeDefined();
    expect(typeof site).toBe("object");
    expect(site.id).toBeDefined();
    expect(site.name).toBe("Primary Site");
  });

  it("newFleet returns a shaped object", () => {
    const fleet = newFleet();
    expect(fleet).toBeDefined();
    expect(typeof fleet).toBe("object");
    expect(fleet.id).toBeDefined();
    expect(fleet.name).toBe("Production Fleet");
  });
});
