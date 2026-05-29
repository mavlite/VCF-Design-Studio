// tests/helpers/kitchen-sink-fleet.js
// Builds a maximally-populated fleet: every exported create*/new* factory is
// exercised in a reachable position, every empty array/toggle that factories
// leave blank is filled. This is the single source-of-truth "model surface"
// for the M2.1 round-trip matrix. Field VALUES are not set here — the
// sentinel walk (tests/helpers/sentinel-walk.js) stamps them.
//
// Corrections vs plan snippet (confirmed against engine.js):
//   - federationConfig.localManager is a SINGULAR object (not an array),
//     federationConfig.tier1 is a SINGULAR object (not an array). Both are
//     already populated by createFleetFederationConfig(); no mutation needed.
//   - networks.lags does NOT exist. Each vds entry has its own .lag property
//     (createVdsLag()). No top-level lags array.
//   - networks.ipv6 does NOT exist at top level. Each per-network sub-object
//     (mgmt/vmotion/vsan/hostTep/edgeTep) carries its own .ipv6 field,
//     already wired by createClusterNetworks().
//   - networks.portgroups is an OBJECT (not an array) keyed by traffic type,
//     already populated by createClusterNetworks() via createClusterPortgroups().
//   - edgeCluster.nodes already has 2 createEdgeNode() instances from
//     createEdgeCluster(); we keep them but ensure non-zero length.
//   - supervisorConfig.deployment is already wired inside
//     createClusterSupervisorConfig(); we just set enabled=true.
//   - createFederationGlobalManagerExtras, createWitnessConfig,
//     createClusterAz2HostOverlay, createClusterAz2Networks,
//     createClusterVsanCompute, createClusterNsxHostOverlay,
//     createClusterPortgroups are all already wired by the lower-level
//     factories; no manual wiring needed.

import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  newT0Gateway,
  createHostIpOverride,
  createEdgeNode,
  createVdsLag,
  createNetworkIpv6,
  createSupervisorDeployment,
  createFederationLocalManager,
  createFederationTier1,
  createWitnessConfig,
} = VcfEngine;

// Fill the parts of a cluster that factories leave empty by default.
// Only mutates arrays/toggles that ship as [] or false — does not touch
// objects that createClusterNetworks/createClusterSupervisorConfig already
// populate.
function enrichCluster(cluster) {
  // hostOverrides — factories leave as []; add two entries so the key is
  // populated and the array is non-empty.
  cluster.hostOverrides = [createHostIpOverride(0), createHostIpOverride(1)];

  // t0Gateways — factories leave as []; add one T0 gateway with value-
  // bearing fields set so the sentinel walk stamps them and the CSV matrix
  // covers BGP paths. Field names confirmed against newT0Gateway() in
  // engine.js and the bgpPeers cell-map entries (ip/asn/mtu/bfdEnabled).
  const t0 = newT0Gateway();
  t0.asnLocal = 65001;
  t0.bgpPeers = [
    { id: "peer-ks-0", name: null, ip: "10.1.1.1", asn: 65010, mtu: 9000, bfdEnabled: true },
    { id: "peer-ks-1", name: null, ip: "10.1.1.2", asn: 65011, mtu: 9000, bfdEnabled: true },
  ];
  cluster.t0Gateways = [t0];

  // edgeCluster.nodes — already has 2 nodes from createEdgeCluster(); ensure
  // they are the real createEdgeNode() shape by replacing with fresh ones.
  if (cluster.edgeCluster && Array.isArray(cluster.edgeCluster.nodes)) {
    cluster.edgeCluster.nodes = [createEdgeNode(), createEdgeNode()];
  }

  // networks.vds[i].lag — each vds entry ships with a createVdsLag() already;
  // replace with a fresh one to confirm the factory is exercised.
  if (cluster.networks && Array.isArray(cluster.networks.vds)) {
    cluster.networks.vds.forEach((v) => {
      v.lag = createVdsLag();
    });
  }

  // networks per-protocol .ipv6 — already wired by createClusterNetworks();
  // overwrite each with a fresh createNetworkIpv6() so the factory is
  // explicitly exercised in the kitchen-sink surface.
  if (cluster.networks) {
    for (const proto of ["mgmt", "vmotion", "vsan", "hostTep", "edgeTep"]) {
      if (cluster.networks[proto]) {
        cluster.networks[proto].ipv6 = createNetworkIpv6();
      }
    }
  }

  // networks per-protocol value-bearing fields — factory ships null; the
  // sentinel walk skips null leaves, so these never enter the matrix.
  // Set type-correct placeholders so the walk stamps them. Field names
  // confirmed against createClusterNetworks() in engine.js (~line 1035):
  // each protocol sub-object has { vlan: null, subnet: null, gateway: null,
  // pool: { start: null, end: null } }.
  if (cluster.networks) {
    for (const proto of ["mgmt", "vmotion", "vsan", "hostTep", "edgeTep"]) {
      const net = cluster.networks[proto];
      if (net) {
        net.vlan    = 100;
        net.subnet  = "10.0.0.0/24";
        net.gateway = "10.0.0.1";
        if (net.pool) {
          net.pool.start = "10.0.0.10";
          net.pool.end   = "10.0.0.50";
        }
      }
    }
  }

  // az2Networks per-protocol value-bearing fields — same pattern.
  // Keys confirmed against createClusterAz2Networks() in engine.js
  // (~line 1408): mgmt, vmotion, vsan, hostTep.
  if (cluster.az2Networks) {
    for (const proto of ["mgmt", "vmotion", "vsan", "hostTep"]) {
      const net = cluster.az2Networks[proto];
      if (net) {
        net.vlan    = 200;
        net.subnet  = "10.1.0.0/24";
        net.gateway = "10.1.0.1";
        if (net.pool) {
          net.pool.start = "10.1.0.10";
          net.pool.end   = "10.1.0.50";
        }
      }
    }
  }

  // supervisorConfig — enable and wire a fresh deployment sub-object so the
  // createSupervisorDeployment factory is visibly exercised.
  if (cluster.supervisorConfig) {
    cluster.supervisorConfig.enabled = true;
    cluster.supervisorConfig.deployment = createSupervisorDeployment();
  }

  return cluster;
}

export function buildKitchenSinkFleet({ vcfVersion = "9.1" } = {}) {
  const fleet = newFleet();
  fleet.vcfVersion = vcfVersion;
  fleet.version = "vcf-sizer-v9";

  // federationConfig — already populated by createFleetFederationConfig().
  // It ships with:
  //   .globalManager (3 nodes + extras from createFederationGlobalManagerExtras)
  //   .localManager  (createFederationLocalManager())
  //   .tier1         (createFederationTier1())
  // We just flip the fleet-level toggle so the tree is "active".
  fleet.federationEnabled = true;

  // witnessConfig — already present on inst via createWitnessConfig(); accessed
  // via inst.witnessConfig.
  const inst = fleet.instances[0];

  // Push a workload domain so every workload-cluster factory is represented.
  inst.domains.push(newWorkloadDomain("WLD-01"));

  // Enrich every cluster in every domain.
  for (const dom of inst.domains) {
    // Workload domains ship with one cluster; add a second to exercise
    // newWorkloadCluster() independently.
    if (dom.type === "workload" && dom.clusters.length === 1) {
      dom.clusters.push(newWorkloadCluster("wld-cluster-02"));
    }
    dom.clusters.forEach(enrichCluster);
  }

  return fleet;
}
