// Deep round-trip coverage for themes 11 / 12 / 13.
//
// The existing per-theme round-trip tests assert only a subset of
// fields (the most-used ones). Audit flagged that a resolve/apply
// mismatch on an un-asserted field could land and ship without
// detection. This file exercises EVERY value-bearing field in
// supervisorConfig / witnessConfig / federationConfig.{globalManager,
// localManager, tier1} through a 9.1 CSV round-trip.
//
// We populate each field with a unique sentinel string before emit,
// parse the CSV, import back, and assert each sentinel survived. Any
// resolve/apply path bug would surface as a single missing or
// mis-routed sentinel.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
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

function mgmtCluster(f) {
  return f.instances[0].domains[0].clusters[0];
}

function roundTrip(fleet, workbookVersion = "9.1") {
  const csv = emitWorkbookCellMapCsv(fleet, null, { workbookVersion });
  const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion });
  return rebuilt;
}

describe("Theme 13 — federationConfig: every field round-trips on 9.1", () => {
  it("globalManager — every scalar field survives CSV round-trip", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const gm = f.federationConfig.globalManager;
    gm.clusterId = "rt-clusterId";
    gm.apiThumbprint = "rt-apiThumbprint";
    gm.username = "rt-username";
    gm.federationName = "rt-federationName";
    gm.vipAddress = "rt-vipAddress";
    gm.certificateId = "rt-certificateId";

    const rebuilt = roundTrip(f).federationConfig.globalManager;
    expect(rebuilt.clusterId).toBe("rt-clusterId");
    expect(rebuilt.apiThumbprint).toBe("rt-apiThumbprint");
    expect(rebuilt.username).toBe("rt-username");
    expect(rebuilt.federationName).toBe("rt-federationName");
    expect(rebuilt.vipAddress).toBe("rt-vipAddress");
    expect(rebuilt.certificateId).toBe("rt-certificateId");
  });

  it("globalManager.rtep + rtep.pool — every field survives", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.federationConfig.globalManager.rtep = {
      edgeSwitchName: "rt-edgeSwitch",
      vlan: "rt-vlan",
      pool: {
        name: "rt-poolName",
        rangeStart: "rt-poolStart",
        rangeEnd: "rt-poolEnd",
        cidr: "rt-poolCidr",
        gatewayIp: "rt-poolGw",
      },
    };
    const rebuilt = roundTrip(f).federationConfig.globalManager.rtep;
    expect(rebuilt.edgeSwitchName).toBe("rt-edgeSwitch");
    expect(rebuilt.vlan).toBe("rt-vlan");
    expect(rebuilt.pool).toEqual({
      name: "rt-poolName",
      rangeStart: "rt-poolStart",
      rangeEnd: "rt-poolEnd",
      cidr: "rt-poolCidr",
      gatewayIp: "rt-poolGw",
    });
  });

  it("localManager — every field survives", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.federationConfig.localManager = {
      name: "rt-lmName",
      lmThumbprint: "rt-lmThumb",
      gmThumbprint: "rt-gmThumb",
      usernameGm: "rt-userGm",
      usernameLm: "rt-userLm",
      locationName: "rt-location",
    };
    const rebuilt = roundTrip(f).federationConfig.localManager;
    expect(rebuilt).toEqual({
      name: "rt-lmName",
      lmThumbprint: "rt-lmThumb",
      gmThumbprint: "rt-gmThumb",
      usernameGm: "rt-userGm",
      usernameLm: "rt-userLm",
      locationName: "rt-location",
    });
  });

  it("tier1 — every field survives", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.federationConfig.tier1 = {
      name: "rt-t1Name",
      linkedT0: "rt-linkedT0",
      crossInstanceSegment: "rt-segment",
    };
    const rebuilt = roundTrip(f).federationConfig.tier1;
    expect(rebuilt).toEqual({
      name: "rt-t1Name",
      linkedT0: "rt-linkedT0",
      crossInstanceSegment: "rt-segment",
    });
  });
});

describe("Theme 12 — witness + AZ2 + vsanCompute: every field round-trips on 9.1", () => {
  it("instance.witnessConfig — every field survives", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.instances[0].witnessConfig = {
      vmName: "rt-vmName",
      clusterName: "rt-clusterName",
      vsanDatastore: "rt-datastore",
      mgmtNetwork: "rt-mgmtNet",
      fqdn: "rt-fqdn",
      mgmtIp: "rt-mgmtIp",
    };
    const rebuilt = roundTrip(f).instances[0].witnessConfig;
    expect(rebuilt).toEqual(f.instances[0].witnessConfig);
  });

  it("instance.mgmtClusterSddcId stamps through both 9.0 and 9.1 cell addresses", () => {
    const f = fleetWith91Wld();
    // Need an additional cluster for the SDDC ID cell to actually emit.
    const wld = f.instances[0].domains.find((d) => d.type === "workload");
    wld.clusters.push({ ...wld.clusters[0], id: "extra", name: "wld-extra" });
    f.instances[0].mgmtClusterSddcId = "rt-sddc-id";
    expect(roundTrip(f, "9.1").instances[0].mgmtClusterSddcId).toBe("rt-sddc-id");
    f.vcfVersion = "9.0";
    expect(roundTrip(f, "9.0").instances[0].mgmtClusterSddcId).toBe("rt-sddc-id");
  });

  it("cluster.az2HostOverlay (Mgmt path) — every field survives on 9.1", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const c = mgmtCluster(f);
    c.az2HostOverlay = {
      profileName: "rt-prof",
      staticIpPoolType: "Re-use an existing Pool",
      poolName: "rt-pool",
      uplinkProfileName: "rt-uplink",
      vlan: "rt-vlan",
      gateway: "rt-gw",
      cidr: "rt-cidr",
      mtu: 1700,
      ipRangeStart: "rt-start",
      ipRangeEnd: "rt-end",
    };
    const rebuilt = mgmtCluster(roundTrip(f)).az2HostOverlay;
    expect(rebuilt).toEqual(c.az2HostOverlay);
  });
});

describe("Theme 11 — supervisorConfig: every field round-trips on 9.1", () => {
  function setEveryField(sc, prefix) {
    sc.enabled = true;
    sc.networkingStack = "vSphere Distributed Switch";
    sc.supervisorLocation = "vSphere Zone Deployment";
    sc.supervisorName = `${prefix}-name`;
    sc.haEnabled = "Unselected";
    sc.vSphereZoneName = `${prefix}-zone`;
    sc.controlPlaneStoragePolicy = `${prefix}-spControl`;
    sc.ephemeralDisksStoragePolicy = `${prefix}-spEphemeral`;
    sc.imageCacheStoragePolicy = `${prefix}-spImage`;
    sc.ipAssignmentMode = "DHCP";
    sc.ipAddresses = `${prefix}-ipAddresses`;
    sc.dnsServers = `${prefix}-dnsServers`;
    sc.dnsSearchDomains = `${prefix}-dnsSearch`;
    sc.ntpServers = `${prefix}-ntpServers`;
    sc.nsxProject = `${prefix}-nsxProject`;
    sc.vpcConnectivityProfile = `${prefix}-vpcProfile`;
    sc.externalIpBlocks = `${prefix}-extBlocks`;
    sc.privateTgwIpBlocks = `${prefix}-tgwBlocks`;
    sc.privateVpcCidrs = `${prefix}-vpcCidrs`;
    sc.serviceCidr = `${prefix}-serviceCidr`;
    sc.workloadDnsServers = `${prefix}-workloadDns`;
    sc.workloadNtpServers = `${prefix}-workloadNtp`;
    sc.controlPlaneSize = "Large";
    sc.apiServerDnsNames = `${prefix}-apiDns`;
    sc.version = `${prefix}-version`;
    sc.node1Ip = `${prefix}-node1`;
    sc.node2Ip = `${prefix}-node2`;
    sc.node3Ip = `${prefix}-node3`;
    sc.clusterVip = `${prefix}-vip`;
    sc.clusterFqdn = `${prefix}-fqdn`;
    sc.clusterName = `${prefix}-clusterName`;
  }
  function assertEveryField(rebuilt, prefix) {
    expect(rebuilt.networkingStack).toBe("vSphere Distributed Switch");
    expect(rebuilt.supervisorLocation).toBe("vSphere Zone Deployment");
    expect(rebuilt.supervisorName).toBe(`${prefix}-name`);
    expect(rebuilt.haEnabled).toBe("Unselected");
    expect(rebuilt.vSphereZoneName).toBe(`${prefix}-zone`);
    expect(rebuilt.controlPlaneStoragePolicy).toBe(`${prefix}-spControl`);
    expect(rebuilt.ephemeralDisksStoragePolicy).toBe(`${prefix}-spEphemeral`);
    expect(rebuilt.imageCacheStoragePolicy).toBe(`${prefix}-spImage`);
    expect(rebuilt.ipAssignmentMode).toBe("DHCP");
    expect(rebuilt.ipAddresses).toBe(`${prefix}-ipAddresses`);
    expect(rebuilt.dnsServers).toBe(`${prefix}-dnsServers`);
    expect(rebuilt.dnsSearchDomains).toBe(`${prefix}-dnsSearch`);
    expect(rebuilt.ntpServers).toBe(`${prefix}-ntpServers`);
    expect(rebuilt.nsxProject).toBe(`${prefix}-nsxProject`);
    expect(rebuilt.vpcConnectivityProfile).toBe(`${prefix}-vpcProfile`);
    expect(rebuilt.externalIpBlocks).toBe(`${prefix}-extBlocks`);
    expect(rebuilt.privateTgwIpBlocks).toBe(`${prefix}-tgwBlocks`);
    expect(rebuilt.privateVpcCidrs).toBe(`${prefix}-vpcCidrs`);
    expect(rebuilt.serviceCidr).toBe(`${prefix}-serviceCidr`);
    expect(rebuilt.workloadDnsServers).toBe(`${prefix}-workloadDns`);
    expect(rebuilt.workloadNtpServers).toBe(`${prefix}-workloadNtp`);
    expect(rebuilt.controlPlaneSize).toBe("Large");
    expect(rebuilt.apiServerDnsNames).toBe(`${prefix}-apiDns`);
    expect(rebuilt.version).toBe(`${prefix}-version`);
    expect(rebuilt.node1Ip).toBe(`${prefix}-node1`);
    expect(rebuilt.node2Ip).toBe(`${prefix}-node2`);
    expect(rebuilt.node3Ip).toBe(`${prefix}-node3`);
    expect(rebuilt.clusterVip).toBe(`${prefix}-vip`);
    expect(rebuilt.clusterFqdn).toBe(`${prefix}-fqdn`);
    expect(rebuilt.clusterName).toBe(`${prefix}-clusterName`);
  }

  it("Mgmt-cluster supervisorConfig: every Configure Mgmt field round-trips", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    setEveryField(mgmtCluster(f).supervisorConfig, "mgmt");
    // Edge cluster size: mgmt enum doesn't include Excluded.
    mgmtCluster(f).supervisorConfig.edgeClusterSize = "Large";
    const rebuilt = mgmtCluster(roundTrip(f)).supervisorConfig;
    assertEveryField(rebuilt, "mgmt");
    expect(rebuilt.edgeClusterSize).toBe("Large");
  });

  it("Workload-cluster supervisorConfig: every Configure WLD field round-trips", () => {
    const f = fleetWith91Wld();
    setEveryField(wldCluster(f).supervisorConfig, "wld");
    wldCluster(f).supervisorConfig.edgeClusterSize = "Excluded";   // WLD-only enum value
    const rebuilt = wldCluster(roundTrip(f)).supervisorConfig;
    assertEveryField(rebuilt, "wld");
    expect(rebuilt.edgeClusterSize).toBe("Excluded");
  });

  it("Workload-cluster supervisorConfig.deployment: every Deploy WLD extra field round-trips", () => {
    const f = fleetWith91Wld();
    wldCluster(f).supervisorConfig.deployment = {
      useEsxiMgmtVmk: "Selected",
      controlPlaneIpRange: "rt-cpRange",
      subnetMask: "rt-subnet",
      gateway: "rt-gateway",
      vds: "rt-vds",
      privateTgwCidr: "rt-tgwCidr",
    };
    // Plus the overlapping fields (Supervisor Name, Service CIDR, etc.)
    // that stamp to both Configure WLD AND Deploy WLD via the same model
    // field. Round-trip should preserve them.
    wldCluster(f).supervisorConfig.supervisorName = "rt-shared-name";
    wldCluster(f).supervisorConfig.serviceCidr = "rt-shared-cidr";
    wldCluster(f).supervisorConfig.nsxProject = "rt-shared-nsx";
    wldCluster(f).supervisorConfig.vpcConnectivityProfile = "rt-shared-vpc";
    wldCluster(f).supervisorConfig.workloadDnsServers = "rt-shared-dns";
    wldCluster(f).supervisorConfig.workloadNtpServers = "rt-shared-ntp";

    const rebuilt = wldCluster(roundTrip(f)).supervisorConfig;
    expect(rebuilt.deployment).toEqual({
      useEsxiMgmtVmk: "Selected",
      controlPlaneIpRange: "rt-cpRange",
      subnetMask: "rt-subnet",
      gateway: "rt-gateway",
      vds: "rt-vds",
      privateTgwCidr: "rt-tgwCidr",
    });
    expect(rebuilt.supervisorName).toBe("rt-shared-name");
    expect(rebuilt.serviceCidr).toBe("rt-shared-cidr");
    expect(rebuilt.nsxProject).toBe("rt-shared-nsx");
    expect(rebuilt.vpcConnectivityProfile).toBe("rt-shared-vpc");
    expect(rebuilt.workloadDnsServers).toBe("rt-shared-dns");
    expect(rebuilt.workloadNtpServers).toBe("rt-shared-ntp");
  });
});
