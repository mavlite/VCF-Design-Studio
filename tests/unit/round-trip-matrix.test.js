// tests/unit/round-trip-matrix.test.js
// M2.1 round-trip matrix — self-check block.
//
// Two assertions:
//   1. sizeFleet() runs without throwing for both 9.0 and 9.1 — a basic
//      structural sanity check (incoherent enriched values throw here).
//   2. Every major factory's output key appears in the serialised tree —
//      ensures the kitchen-sink builder exercised every reachable factory.
//
// Key list uses REAL property names confirmed against engine.js:
//   - federationConfig   (createFleetFederationConfig)
//   - localManager       (createFederationLocalManager  — singular, not localManagers)
//   - tier1              (createFederationTier1          — singular, not tier1s)
//   - adConfig           (createFleetAdConfig)
//   - backupConfig       (createFleetBackupConfig)
//   - installerConfig    (createFleetInstallerConfig)
//   - namingConfig       (createFleetNamingConfig)
//   - reportMetadata     (createFleetReportMetadata)
//   - supervisorConfig   (createClusterSupervisorConfig)
//   - deployment         (createSupervisorDeployment — nested under supervisorConfig)
//   - az2Networks        (createClusterAz2Networks)
//   - az2HostOverlay     (createClusterAz2HostOverlay)
//   - vsanCompute        (createClusterVsanCompute)
//   - edgeCluster        (createEdgeCluster)
//   - nodes              (createEdgeNode[] inside edgeCluster.nodes)
//   - t0Gateways         (newT0Gateway[] — array, singular key present in serialised JSON)
//   - hostOverrides      (createHostIpOverride[] — array)
//   - portgroups         (createClusterPortgroups — object under networks)
//   - nsxHostOverlay     (createClusterNsxHostOverlay — under networks)
//   - advanced           (baseClusterAdvanced)
//   - witnessConfig      (createWitnessConfig — on instance)
//   - globalManager      (federation global manager with nodes)

import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
import { buildKitchenSinkFleet } from "../helpers/kitchen-sink-fleet.js";
import { stampSentinels } from "../helpers/sentinel-walk.js";

// ─── Skip predicate — structural / discriminator / cross-reference fields ─────
//
// Returns true for fields that must NOT be stamped with a sentinel because their
// values drive engine branching, are regenerated on migrate, or are cross-
// references that can't be independently round-tripped. These fields are left at
// their real values and are NOT recorded in the sentinels map.
//
//   type        — domain/entity discriminator ("mgmt" / "workload"). migrateFleet
//                 uses `d.type === "mgmt"` to find the mgmt domain and resolve
//                 componentsClusterId / defaultRole / wldStack; stamping it with
//                 garbage breaks the entire domain-mapper logic.
//   id          — entity ids (fleet, instance, domain, cluster, t0, etc.).
//                 migrateFleet uses `d.id`, `c.id` for cross-reference lookups
//                 (firstWldCluByDomId, mgmtFirstCluId). The engine also
//                 reasserts `fleet.id` via `fleet.id || "fleet-"+localId()`.
//   key         — wldStack / infraStack entry keys. Regenerated via
//                 `e.key || localId()` in the wldStack mapper; a missing-or-new
//                 key is expected structural behaviour, not a coverage gap.
//   localSiteId — Recomputed by the domain mapper as a cross-reference to
//                 inst.siteIds[]. Not free-form user data; stamping it independently
//                 of siteIds always resolves to siteIds[0].
//   "version" at EXACT top-level path only — migration-path selector.
//                 migrateFleet branches on raw.version to choose the upgrade
//                 chain: stamping "rt::version" triggers the v3→v5 migrator,
//                 which completely restructures instances/domains (731 cascade
//                 failures). Must stay a valid value ("vcf-sizer-v9").
//                 NOTE: supervisorConfig.version is a real user field
//                 (free-text Supervisor version string) and must NOT be skipped.
//                 The path-exact guard ensures only the top-level field is skipped.
function structuralSkip(path, leafName) {
  // Leaf-name structural skips (apply at any depth).
  if (leafName === "type")        return true; // discriminator
  if (leafName === "id")          return true; // cross-reference / regenerated id
  if (leafName === "key")         return true; // regenerated wldStack entry key
  if (leafName === "localSiteId") return true; // cross-reference to siteIds[]
  // Path-exact skip: top-level "version" only (migration-path selector).
  // supervisorConfig.version and any other nested "version" field round-trips
  // fine and SHOULD be asserted.
  if (path === "version")         return true; // top-level migration-path selector
  return false;
}

// ─── Overrides — valid enum alternates for fields that must stay in-enum ───────
//
// Returns a valid alternate value (NOT the default) for each enum field, so the
// engine's enum-guard pass-through is exercised: if migrateFleet drops or resets
// a valid value it is surfaced as a failing assertion. These values ARE recorded
// in the sentinels map and are asserted to survive the round-trip.
//
//   ssoMode          — SSO_MODES members: "embedded" (default) | "fleet-wide" |
//                      "multi-broker". Stamp "fleet-wide" (valid non-default).
//                      migrateFleet: `SSO_MODES[fleet.ssoMode] ? fleet.ssoMode : inferSsoMode()`.
//   principalStorage — PRINCIPAL_STORAGE_OPTIONS: "vSAN-ESA" (default) |
//                      "vSAN-OSA" | "VMFS on Fibre Channel (FC)" | "NFSv3".
//                      Stamp "NFSv3" (valid non-default).
//                      migrateV5ToV6: `PRINCIPAL_STORAGE_OPTIONS.includes(p) ? p : "vSAN-ESA"`.
//   placement        — domain placement: "local" (workload default) | "stretched".
//                      Stamp "stretched" (valid non-default). Side effect: localSiteId
//                      is already skipped, so the siteId resolution chain is unaffected.
//                      migrateV5ToV6 spreads `...dom` preserving placement as-is.
function enumOverrides(_path, leafName, _current) {
  if (leafName === "ssoMode")          return "fleet-wide"; // valid SSO_MODES member
  if (leafName === "principalStorage") return "NFSv3";      // valid PRINCIPAL_STORAGE_OPTIONS member
  if (leafName === "placement")        return "stretched";  // valid domain placement member
  return undefined;
}

// ─── Known whitelist gaps in migrateFleet (genuine engine bugs) ───────────────
// Each path below is a value-bearing user field that migrateFleet silently
// drops or does not preserve. Do NOT edit engine.js to fix these — they are
// tracked as follow-up engine bugs. The test filters them out so the suite
// stays green while making the gaps visible.
//
// (empty — no gaps found as of this writing)
const KNOWN_MIGRATE_GAPS = [
  // BUG: <path>  — <explanation>   ← add entries here if gaps are found
];

// Helper: resolve a dot-delimited path in an object, supporting integer
// array indices as well as string keys.
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

// ─── Shared stamping helper ────────────────────────────────────────────────────
// Used by BOTH the JSON round-trip block and the CSV cell-map block so the two
// layers stamp with the same skip + overrides config.
function stampKitchenSink(vcfVersion) {
  const base = buildKitchenSinkFleet({ vcfVersion });
  return stampSentinels(base, { skip: structuralSkip, overrides: enumOverrides });
}

// ─── CSV round-trip helpers ────────────────────────────────────────────────────
const { emitWorkbookCellMapCsv, parseWorkbookCellMap, importWorkbookCellMap } = VcfEngine;

function csvRoundTrip(stampedFleet, workbookVersion) {
  const csv = emitWorkbookCellMapCsv(stampedFleet, null, { workbookVersion });
  const { fleet } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion });
  return fleet;
}

function csvSurvivors(workbookVersion) {
  const { stamped, sentinels } = stampKitchenSink(workbookVersion);
  const rebuilt = csvRoundTrip(stamped, workbookVersion);
  const survived = [];
  for (const [path, expected] of Object.entries(sentinels)) {
    if (getPath(rebuilt, path) === expected) survived.push(path);
  }
  return { survived: survived.sort(), sentinels };
}

// ─── CSV survivor matrix ───────────────────────────────────────────────────────
// Captured empirically (2026-05-29) by running the PRINT dev-aid test below.
// These are the paths that survive the CSV cell-map round-trip for each version.
// 9.0: 268 mapped paths.  9.1: 339 mapped paths.
const CSV_MATRIX_90 = [
  "adConfig.adFqdn",
  "adConfig.adUser",
  "adConfig.ca.csrSubject.commonName",
  "adConfig.ca.csrSubject.email",
  "adConfig.ca.csrSubject.locality",
  "adConfig.ca.csrSubject.org",
  "adConfig.ca.csrSubject.ou",
  "adConfig.ca.csrSubject.state",
  "adConfig.ca.password",
  "adConfig.ca.templateName",
  "adConfig.ca.user",
  "adConfig.serviceAccountUser",
  "backupConfig.directory",
  "backupConfig.host",
  "backupConfig.port",
  "backupConfig.sshFingerprint",
  "backupConfig.user",
  "federationConfig.globalManager.apiThumbprint",
  "federationConfig.globalManager.certificateId",
  "federationConfig.globalManager.clusterId",
  "federationConfig.globalManager.federationName",
  "federationConfig.globalManager.nodes.0.fqdn",
  "federationConfig.globalManager.nodes.0.mgmtIp",
  "federationConfig.globalManager.nodes.0.vmName",
  "federationConfig.globalManager.nodes.1.fqdn",
  "federationConfig.globalManager.nodes.1.mgmtIp",
  "federationConfig.globalManager.nodes.1.vmName",
  "federationConfig.globalManager.nodes.2.fqdn",
  "federationConfig.globalManager.nodes.2.mgmtIp",
  "federationConfig.globalManager.nodes.2.vmName",
  "federationConfig.globalManager.rtep.edgeSwitchName",
  "federationConfig.globalManager.rtep.pool.cidr",
  "federationConfig.globalManager.rtep.pool.gatewayIp",
  "federationConfig.globalManager.rtep.pool.name",
  "federationConfig.globalManager.rtep.pool.rangeEnd",
  "federationConfig.globalManager.rtep.pool.rangeStart",
  "federationConfig.globalManager.rtep.vlan",
  "federationConfig.globalManager.username",
  "federationConfig.globalManager.vipAddress",
  "federationConfig.localManager.gmThumbprint",
  "federationConfig.localManager.lmThumbprint",
  "federationConfig.localManager.locationName",
  "federationConfig.localManager.name",
  "federationConfig.localManager.usernameGm",
  "federationConfig.localManager.usernameLm",
  "federationConfig.tier1.crossInstanceSegment",
  "federationConfig.tier1.linkedT0",
  "federationConfig.tier1.name",
  "federationEnabled",
  "installerConfig.downloadToken",
  "installerConfig.offlineDepotHostname",
  "installerConfig.offlineDepotPort",
  "installerConfig.proxyAuthenticated",
  "installerConfig.proxyEnabled",
  "installerConfig.proxyHost",
  "installerConfig.proxyPort",
  "installerConfig.proxyUser",
  "instances.0.domains.0.clusters.0.advanced.internalClusterCidr",
  "instances.0.domains.0.clusters.0.advanced.nodeNamePrefix",
  "instances.0.domains.0.clusters.0.az2HostOverlay.cidr",
  "instances.0.domains.0.clusters.0.az2HostOverlay.gateway",
  "instances.0.domains.0.clusters.0.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.0.clusters.0.az2HostOverlay.ipRangeStart",
  "instances.0.domains.0.clusters.0.az2HostOverlay.mtu",
  "instances.0.domains.0.clusters.0.az2HostOverlay.poolName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.profileName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.uplinkProfileName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.vlan",
  "instances.0.domains.0.clusters.0.edgeCluster.mtu",
  "instances.0.domains.0.clusters.0.edgeCluster.name",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fqdn",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.hostGroup",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.mgmtIpCidr",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.resourcePool",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.tepIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.tepIps.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fqdn",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.hostGroup",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.mgmtIpCidr",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.tepIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.tepIps.1",
  "instances.0.domains.0.clusters.0.infraStack.0.size",
  "instances.0.domains.0.clusters.0.infraStack.1.size",
  "instances.0.domains.0.clusters.0.infraStack.6.size",
  "instances.0.domains.0.clusters.0.name",
  "instances.0.domains.0.clusters.0.networks.hostTep.useDhcp",
  "instances.0.domains.0.clusters.0.networks.poolName",
  "instances.0.domains.0.clusters.0.networks.portgroups.mgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.nfs.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmMgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmotion.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vsan.name",
  "instances.0.domains.0.clusters.0.networks.uplinks.0.gateway",
  "instances.0.domains.0.clusters.0.networks.uplinks.1.gateway",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.0.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.1.name",
  "instances.0.domains.0.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.0.clusters.0.networks.vsan.mtu",
  "instances.0.domains.0.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.0.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.boundToVmknic",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.0.clusters.0.storage.principalStorage",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.0.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.0.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.version",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.name",
  "instances.0.domains.0.name",
  "instances.0.domains.1.clusters.0.edgeCluster.mtu",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fqdn",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.hostGroup",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.mgmtIpCidr",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.resourcePool",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.tepIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.tepIps.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fqdn",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.hostGroup",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.mgmtIpCidr",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.tepIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.tepIps.1",
  "instances.0.domains.1.clusters.0.name",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.uplinkName1",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.uplinkName2",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.vlan",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.vlanTransportZoneName",
  "instances.0.domains.1.clusters.0.networks.portgroups.mgmt.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.principalStorage.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.vmMgmt.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.vmotion.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.vsanStorageClient.name",
  "instances.0.domains.1.clusters.0.networks.uplinks.0.gateway",
  "instances.0.domains.1.clusters.0.networks.uplinks.1.gateway",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.0.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.1.name",
  "instances.0.domains.1.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.0.networks.vsan.mtu",
  "instances.0.domains.1.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.1.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.controlPlaneIpRange",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.privateTgwCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.1.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.nsxProject",
  "instances.0.domains.1.clusters.0.supervisorConfig.serviceCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.supervisorName",
  "instances.0.domains.1.clusters.0.supervisorConfig.version",
  "instances.0.domains.1.clusters.0.supervisorConfig.vpcConnectivityProfile",
  "instances.0.domains.1.clusters.0.supervisorConfig.workloadDnsServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.workloadNtpServers",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.name",
  "instances.0.domains.1.clusters.1.az2HostOverlay.cidr",
  "instances.0.domains.1.clusters.1.az2HostOverlay.gateway",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.az2HostOverlay.mtu",
  "instances.0.domains.1.clusters.1.az2HostOverlay.poolName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.profileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.vlan",
  "instances.0.domains.1.clusters.1.name",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink1",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink2",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.uplinkName1",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.uplinkName2",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.vlan",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.vlanTransportZoneName",
  "instances.0.domains.1.clusters.1.networks.portgroups.mgmt.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.principalStorage.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.vmMgmt.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.vmotion.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.vsanStorageClient.name",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.0.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.1.name",
  "instances.0.domains.1.clusters.1.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.1.networks.vsan.mtu",
  "instances.0.domains.1.clusters.1.storage.dataServices.datastoreName",
  "instances.0.domains.1.clusters.1.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.1.clusters.1.storage.dataServices.nfs.serverIp",
  "instances.0.domains.1.clusters.1.storage.dataServices.nfs.sharePath",
  "instances.0.domains.1.clusters.1.supervisorConfig.enabled",
  "instances.0.domains.1.name",
  "instances.0.mgmtClusterSddcId",
  "instances.0.name",
  "instances.0.witnessConfig.clusterName",
  "instances.0.witnessConfig.fqdn",
  "instances.0.witnessConfig.mgmtIp",
  "instances.0.witnessConfig.mgmtNetwork",
  "instances.0.witnessConfig.vmName",
  "instances.0.witnessConfig.vsanDatastore",
  "networkConfig.dns.primaryDomain",
  "ssoDomain",
];

const CSV_MATRIX_91 = [
  "adConfig.adFqdn",
  "adConfig.adUser",
  "adConfig.ca.csrSubject.commonName",
  "adConfig.ca.csrSubject.email",
  "adConfig.ca.csrSubject.locality",
  "adConfig.ca.csrSubject.org",
  "adConfig.ca.csrSubject.ou",
  "adConfig.ca.csrSubject.state",
  "adConfig.ca.password",
  "adConfig.ca.templateName",
  "adConfig.ca.user",
  "adConfig.serviceAccountUser",
  "backupConfig.directory",
  "backupConfig.host",
  "backupConfig.port",
  "backupConfig.sshFingerprint",
  "backupConfig.user",
  "federationConfig.globalManager.apiThumbprint",
  "federationConfig.globalManager.certificateId",
  "federationConfig.globalManager.clusterId",
  "federationConfig.globalManager.federationName",
  "federationConfig.globalManager.nodes.0.fqdn",
  "federationConfig.globalManager.nodes.0.mgmtIp",
  "federationConfig.globalManager.nodes.0.searchList",
  "federationConfig.globalManager.nodes.0.vmName",
  "federationConfig.globalManager.nodes.1.fqdn",
  "federationConfig.globalManager.nodes.1.mgmtIp",
  "federationConfig.globalManager.nodes.1.searchList",
  "federationConfig.globalManager.nodes.1.vmName",
  "federationConfig.globalManager.nodes.2.fqdn",
  "federationConfig.globalManager.nodes.2.mgmtIp",
  "federationConfig.globalManager.nodes.2.vmName",
  "federationConfig.globalManager.rtep.edgeSwitchName",
  "federationConfig.globalManager.rtep.pool.cidr",
  "federationConfig.globalManager.rtep.pool.gatewayIp",
  "federationConfig.globalManager.rtep.pool.name",
  "federationConfig.globalManager.rtep.pool.rangeEnd",
  "federationConfig.globalManager.rtep.pool.rangeStart",
  "federationConfig.globalManager.rtep.vlan",
  "federationConfig.globalManager.username",
  "federationConfig.globalManager.vipAddress",
  "federationConfig.localManager.gmThumbprint",
  "federationConfig.localManager.lmThumbprint",
  "federationConfig.localManager.locationName",
  "federationConfig.localManager.name",
  "federationConfig.localManager.usernameGm",
  "federationConfig.localManager.usernameLm",
  "federationConfig.tier1.crossInstanceSegment",
  "federationConfig.tier1.linkedT0",
  "federationConfig.tier1.name",
  "federationEnabled",
  "installerConfig.activationCode",
  "installerConfig.downloadToken",
  "installerConfig.offlineDepotHostname",
  "installerConfig.offlineDepotPort",
  "installerConfig.proxyAuthenticated",
  "installerConfig.proxyEnabled",
  "installerConfig.proxyHost",
  "installerConfig.proxyPort",
  "installerConfig.proxyUser",
  "instances.0.domains.0.clusters.0.advanced.evcSetting",
  "instances.0.domains.0.clusters.0.advanced.internalClusterCidr",
  "instances.0.domains.0.clusters.0.advanced.nodeNamePrefix",
  "instances.0.domains.0.clusters.0.az2HostOverlay.cidr",
  "instances.0.domains.0.clusters.0.az2HostOverlay.gateway",
  "instances.0.domains.0.clusters.0.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.0.clusters.0.az2HostOverlay.ipRangeStart",
  "instances.0.domains.0.clusters.0.az2HostOverlay.mtu",
  "instances.0.domains.0.clusters.0.az2HostOverlay.poolName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.profileName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.uplinkProfileName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.vlan",
  "instances.0.domains.0.clusters.0.edgeCluster.mtu",
  "instances.0.domains.0.clusters.0.edgeCluster.name",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.fqdn",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.hostGroup",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.mgmtIpCidr",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.resourcePool",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.tepIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.0.tepIps.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.fqdn",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.1",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.hostGroup",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.mgmtIpCidr",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.tepIps.0",
  "instances.0.domains.0.clusters.0.edgeCluster.nodes.1.tepIps.1",
  "instances.0.domains.0.clusters.0.infraStack.0.size",
  "instances.0.domains.0.clusters.0.infraStack.1.size",
  "instances.0.domains.0.clusters.0.infraStack.6.size",
  "instances.0.domains.0.clusters.0.name",
  "instances.0.domains.0.clusters.0.networks.hostTep.useDhcp",
  "instances.0.domains.0.clusters.0.networks.mgmt.ipv6.gatewayCidr",
  "instances.0.domains.0.clusters.0.networks.portgroups.mgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.nfs.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmMgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmotion.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vsan.name",
  "instances.0.domains.0.clusters.0.networks.uplinks.0.gateway",
  "instances.0.domains.0.clusters.0.networks.uplinks.1.gateway",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.0.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.1.name",
  "instances.0.domains.0.clusters.0.networks.vmotion.ipv6.rangeEnd",
  "instances.0.domains.0.clusters.0.networks.vmotion.ipv6.rangeStart",
  "instances.0.domains.0.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.0.clusters.0.networks.vsan.ipv6.rangeEnd",
  "instances.0.domains.0.clusters.0.networks.vsan.ipv6.rangeStart",
  "instances.0.domains.0.clusters.0.networks.vsan.mtu",
  "instances.0.domains.0.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.0.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.0.clusters.0.storage.dataServices.dit.rekeyHoursCustom",
  "instances.0.domains.0.clusters.0.storage.dataServices.dit.rekeyInterval",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.boundToVmknic",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.0.clusters.0.storage.principalStorage",
  "instances.0.domains.0.clusters.0.supervisorConfig.apiServerDnsNames",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.0.clusters.0.supervisorConfig.controlPlaneStoragePolicy",
  "instances.0.domains.0.clusters.0.supervisorConfig.dnsSearchDomains",
  "instances.0.domains.0.clusters.0.supervisorConfig.dnsServers",
  "instances.0.domains.0.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.0.clusters.0.supervisorConfig.ephemeralDisksStoragePolicy",
  "instances.0.domains.0.clusters.0.supervisorConfig.externalIpBlocks",
  "instances.0.domains.0.clusters.0.supervisorConfig.imageCacheStoragePolicy",
  "instances.0.domains.0.clusters.0.supervisorConfig.ipAddresses",
  "instances.0.domains.0.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.nsxProject",
  "instances.0.domains.0.clusters.0.supervisorConfig.ntpServers",
  "instances.0.domains.0.clusters.0.supervisorConfig.privateTgwIpBlocks",
  "instances.0.domains.0.clusters.0.supervisorConfig.privateVpcCidrs",
  "instances.0.domains.0.clusters.0.supervisorConfig.serviceCidr",
  "instances.0.domains.0.clusters.0.supervisorConfig.supervisorName",
  "instances.0.domains.0.clusters.0.supervisorConfig.vSphereZoneName",
  "instances.0.domains.0.clusters.0.supervisorConfig.version",
  "instances.0.domains.0.clusters.0.supervisorConfig.vpcConnectivityProfile",
  "instances.0.domains.0.clusters.0.supervisorConfig.workloadDnsServers",
  "instances.0.domains.0.clusters.0.supervisorConfig.workloadNtpServers",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.name",
  "instances.0.domains.0.name",
  "instances.0.domains.1.clusters.0.edgeCluster.mtu",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth0Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fpEth1Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.fqdn",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.gatewayInterfaceIps.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.hostGroup",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.mgmtIpCidr",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.resourcePool",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.tepIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.0.tepIps.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth0Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fpEth1Uplinks.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.fqdn",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.gatewayInterfaceIps.1",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.hostGroup",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.mgmtIpCidr",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.tepIps.0",
  "instances.0.domains.1.clusters.0.edgeCluster.nodes.1.tepIps.1",
  "instances.0.domains.1.clusters.0.name",
  "instances.0.domains.1.clusters.0.networks.dualStackIpv6",
  "instances.0.domains.1.clusters.0.networks.edgeTep.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.0.networks.edgeTep.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.0.networks.edgeTep.ipv6.rangeStart",
  "instances.0.domains.1.clusters.0.networks.hostTep.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.0.networks.hostTep.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.0.networks.hostTep.ipv6.rangeStart",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.uplinkName1",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.uplinkName2",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.vlan",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.vlanTransportZoneName",
  "instances.0.domains.1.clusters.0.networks.portgroups.mgmt.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.principalStorage.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.vmMgmt.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.vmotion.name",
  "instances.0.domains.1.clusters.0.networks.portgroups.vsanStorageClient.name",
  "instances.0.domains.1.clusters.0.networks.uplinks.0.gateway",
  "instances.0.domains.1.clusters.0.networks.uplinks.1.gateway",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.0.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.1.name",
  "instances.0.domains.1.clusters.0.networks.vmotion.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.0.networks.vmotion.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.0.networks.vmotion.ipv6.rangeStart",
  "instances.0.domains.1.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.0.networks.vsan.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.0.networks.vsan.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.0.networks.vsan.ipv6.rangeStart",
  "instances.0.domains.1.clusters.0.networks.vsan.mtu",
  "instances.0.domains.1.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.1.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.enabled",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.rekeyHoursCustom",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.rekeyInterval",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.1.clusters.0.supervisorConfig.apiServerDnsNames",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.1.clusters.0.supervisorConfig.controlPlaneStoragePolicy",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.controlPlaneIpRange",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.gateway",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.privateTgwCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.subnetMask",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.vds",
  "instances.0.domains.1.clusters.0.supervisorConfig.dnsSearchDomains",
  "instances.0.domains.1.clusters.0.supervisorConfig.dnsServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.1.clusters.0.supervisorConfig.ephemeralDisksStoragePolicy",
  "instances.0.domains.1.clusters.0.supervisorConfig.externalIpBlocks",
  "instances.0.domains.1.clusters.0.supervisorConfig.imageCacheStoragePolicy",
  "instances.0.domains.1.clusters.0.supervisorConfig.ipAddresses",
  "instances.0.domains.1.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.nsxProject",
  "instances.0.domains.1.clusters.0.supervisorConfig.ntpServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.privateTgwIpBlocks",
  "instances.0.domains.1.clusters.0.supervisorConfig.privateVpcCidrs",
  "instances.0.domains.1.clusters.0.supervisorConfig.serviceCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.supervisorName",
  "instances.0.domains.1.clusters.0.supervisorConfig.vSphereZoneName",
  "instances.0.domains.1.clusters.0.supervisorConfig.version",
  "instances.0.domains.1.clusters.0.supervisorConfig.vpcConnectivityProfile",
  "instances.0.domains.1.clusters.0.supervisorConfig.workloadDnsServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.workloadNtpServers",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.name",
  "instances.0.domains.1.clusters.1.az2HostOverlay.cidr",
  "instances.0.domains.1.clusters.1.az2HostOverlay.gateway",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.az2HostOverlay.mtu",
  "instances.0.domains.1.clusters.1.az2HostOverlay.poolName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.profileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.vlan",
  "instances.0.domains.1.clusters.1.name",
  "instances.0.domains.1.clusters.1.networks.edgeTep.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.edgeTep.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.edgeTep.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.hostTep.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.hostTep.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.hostTep.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink1",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink2",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.uplinkName1",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.uplinkName2",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.vlan",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.vlanTransportZoneName",
  "instances.0.domains.1.clusters.1.networks.portgroups.mgmt.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.principalStorage.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.vmMgmt.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.vmotion.name",
  "instances.0.domains.1.clusters.1.networks.portgroups.vsanStorageClient.name",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.0.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.1.name",
  "instances.0.domains.1.clusters.1.networks.vmotion.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.vmotion.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.vmotion.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.1.networks.vsan.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.vsan.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.vsan.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.vsan.mtu",
  "instances.0.domains.1.clusters.1.storage.dataServices.datastoreName",
  "instances.0.domains.1.clusters.1.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.1.clusters.1.storage.dataServices.nfs.serverIp",
  "instances.0.domains.1.clusters.1.storage.dataServices.nfs.sharePath",
  "instances.0.domains.1.clusters.1.supervisorConfig.enabled",
  "instances.0.domains.1.name",
  "instances.0.mgmtClusterSddcId",
  "instances.0.name",
  "instances.0.witnessConfig.clusterName",
  "instances.0.witnessConfig.fqdn",
  "instances.0.witnessConfig.mgmtIp",
  "instances.0.witnessConfig.mgmtNetwork",
  "instances.0.witnessConfig.vmName",
  "instances.0.witnessConfig.vsanDatastore",
  "networkConfig.dns.primaryDomain",
  "ssoDomain",
];

describe("kitchen-sink fleet — self check", () => {
  it("sizes without throwing on 9.0 and 9.1", () => {
    for (const vcfVersion of ["9.0", "9.1"]) {
      const fleet = buildKitchenSinkFleet({ vcfVersion });
      expect(() => VcfEngine.sizeFleet(fleet)).not.toThrow();
    }
  });

  it("exercises every exported create*/new* factory (output key reachable)", () => {
    const fleet = buildKitchenSinkFleet({ vcfVersion: "9.1" });
    const json = JSON.stringify(fleet);

    const expectedKeys = [
      // Fleet-level factory outputs
      "federationConfig",
      "localManager",    // singular — createFederationLocalManager
      "tier1",           // singular — createFederationTier1
      "globalManager",   // federation GM with nodes
      "adConfig",
      "backupConfig",
      "installerConfig",
      "namingConfig",
      "reportMetadata",
      "witnessConfig",   // createWitnessConfig on instance

      // Cluster-level factory outputs (all wired by newCluster / enrichCluster)
      "supervisorConfig",
      "deployment",      // createSupervisorDeployment under supervisorConfig
      "az2Networks",
      "az2HostOverlay",
      "vsanCompute",
      "edgeCluster",
      "nodes",           // createEdgeNode[] inside edgeCluster
      "t0Gateways",
      "hostOverrides",
      "portgroups",      // createClusterPortgroups under networks
      "nsxHostOverlay",  // createClusterNsxHostOverlay under networks
      "advanced",
    ];

    for (const key of expectedKeys) {
      expect(json, `expected "${key}" present in kitchen-sink tree`).toContain(`"${key}"`);
    }
  });
});

describe("round-trip matrix — JSON save/load completeness", () => {
  it("every value-bearing field survives JSON.stringify -> migrateFleet", () => {
    const base = buildKitchenSinkFleet({ vcfVersion: "9.1" });
    const { stamped, sentinels } = stampSentinels(base, { skip: structuralSkip, overrides: enumOverrides });
    const rebuilt = VcfEngine.migrateFleet(JSON.parse(JSON.stringify(stamped)));

    // Filter out known whitelist gaps so the suite stays green while
    // keeping the bugs visible in KNOWN_MIGRATE_GAPS above.
    const knownGapSet = new Set(KNOWN_MIGRATE_GAPS);

    const missing = [];
    for (const [path, expected] of Object.entries(sentinels)) {
      if (knownGapSet.has(path)) continue;
      const actual = getPath(rebuilt, path);
      if (actual !== expected) {
        missing.push(
          `${path} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
        );
      }
    }
    expect(
      missing,
      `JSON round-trip dropped/changed ${missing.length} field(s):\n${missing.join("\n")}`
    ).toEqual([]);
  });
});

describe("round-trip matrix — CSV cell-map", () => {
  for (const [v, matrix] of [["9.0", CSV_MATRIX_90], ["9.1", CSV_MATRIX_91]]) {
    it(`every workbook-mapped field survives the ${v} CSV round-trip`, () => {
      const { stamped, sentinels } = stampKitchenSink(v);
      const rebuilt = csvRoundTrip(stamped, v);
      const broken = matrix.filter((p) => getPath(rebuilt, p) !== sentinels[p]);
      expect(broken, `${v}: ${broken.length} mapped field(s) failed CSV round-trip:\n${broken.join("\n")}`).toEqual([]);
    });
  }
});
