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
