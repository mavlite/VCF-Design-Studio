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
function jsonSkip(path, leafName) {
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
function jsonOverrides(_path, leafName, _current) {
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

describe("round-trip matrix — JSON save/load completeness", () => {
  it("every value-bearing field survives JSON.stringify -> migrateFleet", () => {
    const base = buildKitchenSinkFleet({ vcfVersion: "9.1" });
    const { stamped, sentinels } = stampSentinels(base, { skip: jsonSkip, overrides: jsonOverrides });
    const rebuilt = VcfEngine.migrateFleet(JSON.parse(JSON.stringify(stamped)));

    // Filter out known whitelist gaps so the suite stays green while
    // keeping the bugs visible in KNOWN_MIGRATE_GAPS above.
    const knownGapSet = new Set(KNOWN_MIGRATE_GAPS);

    const missing = [];
    for (const [path, expected] of Object.entries(sentinels)) {
      if (knownGapSet.has(path)) continue;
      if (getPath(rebuilt, path) !== expected) {
        missing.push(
          `${path} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(getPath(rebuilt, path))})`
        );
      }
    }
    expect(
      missing,
      `JSON round-trip dropped/changed ${missing.length} field(s):\n${missing.join("\n")}`
    ).toEqual([]);
  });
});
