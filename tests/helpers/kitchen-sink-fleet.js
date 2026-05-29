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
  createPortgroupSlot,
  createVdsLag,
  createNetworkIpv6,
  createSupervisorDeployment,
  createFederationLocalManager,
  createFederationTier1,
  createWitnessConfig,
  createClusterAz2HostOverlay,
  createClusterAz2Networks,
  createClusterVsanCompute,
  createClusterNsxHostOverlay,
  createSupervisorDeployment: _supervisorDeployment, // alias for clarity
} = VcfEngine;

// Fill the parts of a cluster that factories leave empty by default.
// Only mutates arrays/toggles that ship as [] or false — does not touch
// objects that createClusterNetworks/createClusterSupervisorConfig already
// populate.
function enrichCluster(cluster) {
  // hostOverrides — factories leave as []; add two entries so the key is
  // populated and the array is non-empty.
  cluster.hostOverrides = [createHostIpOverride(0), createHostIpOverride(1)];

  // t0Gateways — factories leave as []; add one T0 gateway.
  cluster.t0Gateways = [newT0Gateway()];

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
