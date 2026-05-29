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
// Each override returns a VALID non-default enum/dropdown member so the field
// actually round-trips through the workbook cell-map (which validates membership
// on import and rejects the generic `rt::<path>` sentinel). The valid set for
// each field is sourced from the cell-map entry's dataValidation list / enumApply
// allow-list / the resolve+apply translation in engine.js. Engine sources are
// cited inline (line numbers approximate, valid as of 2026-05-29).
//
// Matching is by leaf name where the leaf is globally unambiguous, and by
// path-suffix where a leaf name collides across scopes with different valid sets.
function enumOverrides(path, leafName, _current) {
  // ── Fleet-level pre-existing overrides ───────────────────────────────────
  if (leafName === "ssoMode")          return "fleet-wide"; // SSO_MODES (engine ~9677)
  if (leafName === "principalStorage") return "NFSv3";      // PRINCIPAL_STORAGE_OPTIONS (engine 3641)
  if (leafName === "placement")        return "stretched";  // domain placement (migrateV5ToV6)

  // ── installerConfig enums ────────────────────────────────────────────────
  // depotType resolve emits "Offline"/"Online"; apply lower-cases & maps
  // "offline"→"offline" else "online" (engine 5150-5153). Default "online".
  if (path === "installerConfig.depotType")     return "offline";
  // proxyProtocol resolve emits "HTTP"/"HTTPS"; apply maps "http"→"http" else
  // "https" (engine 5228-5231). Default "https".
  if (path === "installerConfig.proxyProtocol") return "http";

  // ── instance-level enums ─────────────────────────────────────────────────
  // deploymentProfile dataValidation ["Deploy Simple","Deploy HA","Deploy HA
  // with NSX Federation"]; model keys simple|ha|haFederation (engine 5318-5338).
  // Default "ha". Stamp "simple" (valid non-default).
  if (leafName === "deploymentProfile") return "simple";

  // ── backupConfig enum ────────────────────────────────────────────────────
  // protocol resolve uppercases; apply maps "ftps"→"ftps" else "sftp"
  // (engine 7041-7045). Stored lower-case "sftp"|"ftps". Default "sftp".
  if (path === "backupConfig.protocol") return "ftps";

  // ── adConfig CA certificate enums ────────────────────────────────────────
  // ca.algorithm dataValidation RSA|ECDSA; apply maps "ECDSA"→"ECDSA" else
  // "RSA" (engine 7204-7207). Default "RSA".
  if (path === "adConfig.ca.algorithm") return "ECDSA";
  // ca.keySize one of [2048,3072,4096]; apply parses+validates (engine 7275-
  // 7278). Number. Default 4096. Stamp 2048 (valid non-default).
  if (path === "adConfig.ca.keySize") return 2048;
  // ca.csrSubject.country apply upper-cases + slices to 2 chars (engine 7234-
  // 7238); the generic sentinel "rt::…" would slice to "RT" (still round-trips,
  // but stamp an explicit valid ISO-2 code so intent is clear). Default "".
  if (path === "adConfig.ca.csrSubject.country") return "US";

  // ── federation Global Manager node-0 deploy size ─────────────────────────
  // dataValidation Small|Medium|Large|X-Large; apply validates against that
  // list (engine 7543-7548). ONLY node 0 has a cell (resolve/apply hardcode
  // index 0); nodes 1/2 are unmapped (handled in NON_WORKBOOK_ALLOWLIST).
  // Default "Medium". Stamp "Large".
  if (path === "federationConfig.globalManager.nodes.0.deploySize") return "Large";

  // ── vDS LACP enums (LACP Mode / Time Out) ────────────────────────────────
  // mode dataValidation Active|Passive (engine 3835-3840); timeout
  // dataValidation Slow|Fast (engine 3849-3854). Stored as the display string.
  // Defaults Active / Slow. Match the `.lag.` path suffix to avoid colliding
  // with other "mode"/"timeout" leaves.
  if (/\.lag\.mode$/.test(path))    return "Passive";
  if (/\.lag\.timeout$/.test(path)) return "Fast";

  // ── nsxHostOverlay enums (Selected/Unselected + named enums) ─────────────
  // Valid sets from _nsxHostOverlayBlockEntries (engine 4121-4216) and the
  // mgmt-cluster trailing block (engine 8340-8428). enumApply stores the exact
  // display string, so the override IS the round-tripped value.
  //   SELECTED_UNSELECTED = ["Selected","Unselected"]
  //   OPERATIONAL_MODE    = ["Standard","Enhanced Datapath Standard","Enhanced Datapath Dedicated"]
  //   IP_ASSIGNMENT       = ["DHCP","Static IP Pool"]
  //   STATIC_POOL_TYPE    = ["Re-use an existing Pool","Create New Static IP Pool"]
  //   TEAMING_POLICY      = ["Load Balance Source","Failover Order","Load Balance Source MAC Address"]
  if (/\.nsxHostOverlay\.applyDefaultOperationMode$/.test(path)) return "Unselected"; // default Selected
  if (/\.nsxHostOverlay\.operationalMode$/.test(path))           return "Enhanced Datapath Standard"; // default Standard
  if (/\.nsxHostOverlay\.transportZoneOverlay$/.test(path))      return "Unselected"; // default Selected
  if (/\.nsxHostOverlay\.transportZoneVlan$/.test(path))         return "Unselected"; // default Selected
  if (/\.nsxHostOverlay\.ipAssignment$/.test(path))              return "DHCP";       // default Static IP Pool
  if (/\.nsxHostOverlay\.staticIpPoolType$/.test(path))          return "Re-use an existing Pool"; // default Create New
  if (/\.nsxHostOverlay\.teamingPolicy$/.test(path))             return "Failover Order"; // default Load Balance Source
  // activeUplink1/2: Selected/Unselected ONLY on the workload-cluster sheet
  // (engine 8262 activeUplinkEnum); additional-cluster is free text (8298 →
  // null) and the generic sentinel works there. mgmt-cluster has no activeUplink
  // cell at all. Restrict the enum override to the WLD-cluster position.
  if (/domains\.1\.clusters\.0\.networks\.nsxHostOverlay\.activeUplink[12]$/.test(path)) return "Unselected";
  // mgmtClusterPortgroup enums (mgmt cluster only — engine 8368-8428):
  if (/\.nsxHostOverlay\.mgmtClusterPortgroup\.loadBalancing$/.test(path)) return "Route based on source MAC hash"; // default "Route based on the source of the port ID"
  if (/\.nsxHostOverlay\.mgmtClusterPortgroup\.uplink1$/.test(path))       return "Standby"; // default Active
  if (/\.nsxHostOverlay\.mgmtClusterPortgroup\.uplink2$/.test(path))       return "Standby"; // default Active

  // ── az2HostOverlay static IP pool type ───────────────────────────────────
  // dataValidation ["Re-use an existing Pool","Create New Static IP Pool"]
  // (engine 7928-7934 mgmt + the additional-cluster variant). Default
  // "Create New Static IP Pool".
  if (/\.az2HostOverlay\.staticIpPoolType$/.test(path)) return "Re-use an existing Pool";

  // ── storage DIT rekey mode ───────────────────────────────────────────────
  // values Default|Custom (engine 5566 mgmt + 5744-5748 WLD). Default "Default".
  if (/\.storage\.dataServices\.dit\.rekeyMode$/.test(path)) return "Custom";

  // ── supervisorConfig enums (mgmt + WLD scopes; engine 4312-4380) ─────────
  //   CP_SIZES           = ["Tiny","Small","Medium","Large","XLarge"]      (default Small)
  //   SELECTED_UNSELECTED for haEnabled                                     (default Selected)
  //   IP_MODES           = ["Static","DHCP"]   for ipAssignmentMode        (default Static)
  //   NETWORKING_STACK   = ["VCF Networking with VPC","vSphere Distributed Switch"] (default VCF…VPC)
  //   SUPERVISOR_LOCATION= ["vSphere Zone Deployment","Cluster Deployment"] (default Cluster Deployment)
  //   edgeClusterEnum / Medium fallback for edgeClusterSize
  // additional-cluster (domains.1.clusters.1) has no supervisor cells → those
  // positions fall to NON_WORKBOOK_ALLOWLIST, the override value is harmless.
  if (/\.supervisorConfig\.controlPlaneSize$/.test(path))   return "Large";        // default Small
  if (/\.supervisorConfig\.haEnabled$/.test(path))          return "Unselected";   // default Selected
  if (/\.supervisorConfig\.ipAssignmentMode$/.test(path))   return "DHCP";         // default Static
  if (/\.supervisorConfig\.networkingStack$/.test(path))    return "vSphere Distributed Switch"; // default VCF…VPC
  if (/\.supervisorConfig\.edgeClusterSize$/.test(path))    return "Large";        // edgeClusterEnum member
  if (/\.supervisorConfig\.supervisorLocation$/.test(path)) return "vSphere Zone Deployment"; // default Cluster Deployment
  // deployment.useEsxiMgmtVmk Selected/Unselected (engine 8541-8549; WLD scope).
  // Default "Unselected". Stamp "Selected".
  if (/\.supervisorConfig\.deployment\.useEsxiMgmtVmk$/.test(path)) return "Selected";

  // ── T0 gateway HA mode ───────────────────────────────────────────────────
  // resolve emits "Active Active"/"Active Standby"; apply maps back to
  // active-active/active-standby (engine 6590-6605). Model stores the hyphen
  // form. Default "active-standby". Stamp "active-active".
  if (/\.t0Gateways\.\d+\.haMode$/.test(path)) return "active-active";

  // ── dualStackIpv6 (boolean) ──────────────────────────────────────────────
  // resolve emits Include/Exclude; apply maps "include"→true (engine 9123-
  // 9130; WLD scope, 9.1 only). The sentinel walk already negates the boolean
  // (default false → true), which round-trips, but stamp true explicitly so the
  // expected value is unambiguous regardless of factory default.
  if (/\.networks\.dualStackIpv6$/.test(path)) return true;

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

// ─── Known whitelist gaps in the CSV round-trip (genuine engine bugs) ─────────
// Each path below is a workbook-mapped field that is emitted correctly by
// emitWorkbookCellMapCsv but is NOT restored by importWorkbookCellMap —
// making the CSV path effectively write-only for that field.
//
// ROOT CAUSE: importWorkbookCellMap builds a fresh fleet with
// domain.placement = "local" (the factory default). All az2Networks cell-map
// entries are gated by _isStretchedCtx(ctx) (domain.placement === "stretched"),
// so their apply() bodies no-op on import even though their resolve() bodies
// correctly emit. Fix requires either persisting placement inside the CSV or
// pre-setting placement before applying az2Networks rows — tracked as a
// follow-up engine bug.
//
// Paths are keyed to the kitchen-sink cluster positions:
//   domains.0.clusters.0 = mgmt-cluster scope
//   domains.1.clusters.0 = workload-cluster scope
//   domains.1.clusters.1 = additional-cluster scope
const KNOWN_CSV_GAPS = [
  // ─── GENUINE ENGINE BUG — az2Networks CSV round-trip (placement gating) ──────
  // These are the ONLY genuine engine bugs left in this list. Every other field
  // that was previously parked here was a TEST ARTIFACT (an enum/boolean field
  // stamped with the generic `rt::<path>` sentinel that the cell-map validator
  // rejected) — those are now stamped with a VALID member via enumOverrides and
  // have moved into CSV_MATRIX_*; the genuinely-unmapped ones (no workbook cell,
  // or scope mismatch) moved into NON_WORKBOOK_ALLOWLIST.
  //
  // ROOT CAUSE (engine, tracked as a follow-up — do NOT fix here): the
  // az2Networks {mgmt,vmotion,vsan}.{gateway,subnet,vlan,pool.start,pool.end}
  // cell-map entries (engine.js _az2NetworkBlockEntries, ~4445-4508) gate BOTH
  // their resolve() and apply() behind `_isStretchedCtx(ctx)`
  // (domain.placement === "stretched"). `importWorkbookCellMap` builds its draft
  // from `newFleet()`, whose domains default to placement="local", and
  // `placement` is NOT a workbook field (it has no cell), so it is never restored
  // before the az2Networks rows apply → every apply() no-ops on import. The cells
  // are therefore write-only via CSV even for a genuinely-stretched design.
  // (The kitchen-sink stamps placement="stretched" via enumOverrides, which is
  // why these fields ARE emitted, but the import-side draft is still "local".)
  // These fields DO survive the JSON round-trip (verified by the JSON
  // completeness layer above), so they remain covered there.
  // Fix options: infer stretched on import from non-empty az2 cells (mirrors
  // migrateFleet's legacy inference), or make domain.placement a real workbook
  // field applied before az2Networks rows.
  //
  // Cluster positions: domains.0.clusters.0 = mgmt, domains.1.clusters.0 = WLD,
  // domains.1.clusters.1 = additional.
  "instances.0.domains.0.clusters.0.az2Networks.mgmt.gateway",
  "instances.0.domains.0.clusters.0.az2Networks.mgmt.subnet",
  "instances.0.domains.0.clusters.0.az2Networks.mgmt.vlan",
  "instances.0.domains.0.clusters.0.az2Networks.vmotion.gateway",
  "instances.0.domains.0.clusters.0.az2Networks.vmotion.pool.end",
  "instances.0.domains.0.clusters.0.az2Networks.vmotion.pool.start",
  "instances.0.domains.0.clusters.0.az2Networks.vmotion.subnet",
  "instances.0.domains.0.clusters.0.az2Networks.vmotion.vlan",
  "instances.0.domains.0.clusters.0.az2Networks.vsan.gateway",
  "instances.0.domains.0.clusters.0.az2Networks.vsan.pool.end",
  "instances.0.domains.0.clusters.0.az2Networks.vsan.pool.start",
  "instances.0.domains.0.clusters.0.az2Networks.vsan.subnet",
  "instances.0.domains.0.clusters.0.az2Networks.vsan.vlan",
  "instances.0.domains.1.clusters.0.az2Networks.mgmt.gateway",
  "instances.0.domains.1.clusters.0.az2Networks.mgmt.subnet",
  "instances.0.domains.1.clusters.0.az2Networks.mgmt.vlan",
  "instances.0.domains.1.clusters.0.az2Networks.vmotion.gateway",
  "instances.0.domains.1.clusters.0.az2Networks.vmotion.pool.end",
  "instances.0.domains.1.clusters.0.az2Networks.vmotion.pool.start",
  "instances.0.domains.1.clusters.0.az2Networks.vmotion.subnet",
  "instances.0.domains.1.clusters.0.az2Networks.vmotion.vlan",
  "instances.0.domains.1.clusters.0.az2Networks.vsan.gateway",
  "instances.0.domains.1.clusters.0.az2Networks.vsan.pool.end",
  "instances.0.domains.1.clusters.0.az2Networks.vsan.pool.start",
  "instances.0.domains.1.clusters.0.az2Networks.vsan.subnet",
  "instances.0.domains.1.clusters.0.az2Networks.vsan.vlan",
  "instances.0.domains.1.clusters.1.az2Networks.mgmt.gateway",
  "instances.0.domains.1.clusters.1.az2Networks.mgmt.subnet",
  "instances.0.domains.1.clusters.1.az2Networks.mgmt.vlan",
  "instances.0.domains.1.clusters.1.az2Networks.vmotion.gateway",
  "instances.0.domains.1.clusters.1.az2Networks.vmotion.pool.end",
  "instances.0.domains.1.clusters.1.az2Networks.vmotion.pool.start",
  "instances.0.domains.1.clusters.1.az2Networks.vmotion.subnet",
  "instances.0.domains.1.clusters.1.az2Networks.vmotion.vlan",
  "instances.0.domains.1.clusters.1.az2Networks.vsan.gateway",
  "instances.0.domains.1.clusters.1.az2Networks.vsan.pool.end",
  "instances.0.domains.1.clusters.1.az2Networks.vsan.pool.start",
  "instances.0.domains.1.clusters.1.az2Networks.vsan.subnet",
  "instances.0.domains.1.clusters.1.az2Networks.vsan.vlan",
];

// ─── NON_WORKBOOK_ALLOWLIST ──────────────────────────────────────────────────
//
// Fields that are value-bearing (non-null, non-structural) in the kitchen-sink
// model BUT have NO workbook cell — they are JSON-only fields. Verified against
// WORKBOOK_CELL_MAP in engine.js: none of the patterns below appear as a
// cell-map resolve/apply target (only these exact model fields; adjacent fields
// like names/FQDNs that DO appear in the cell-map are in CSV_MATRIX_*, not here).
//
// Each entry has:
//   test(path) → boolean   — true if the path belongs to this category
//   why         → string   — explanation of why no workbook cell exists
//
// Ordered from most-specific to most-general so that the allowlisted() check
// short-circuits on first match.
//
const NON_WORKBOOK_ALLOWLIST = [
  // ── Passwords / secrets ─────────────────────────────────────────────────
  // These fields intentionally have no workbook cell; workbook exports never
  // store credentials. The user fills them in outside of the planning workbook.
  {
    test: (p) =>
      p === "adConfig.adPassword" ||
      p === "backupConfig.password" ||
      p === "backupConfig.encryptionPassphrase" ||
      p === "installerConfig.proxyPassword",
    why: "credential/secret fields — workbook never stores passwords; user fills post-export",
  },

  // ── CA cert sub-fields without a cell-map entry ──────────────────────────
  // adConfig.ca.fqdn and adConfig.ca.url have no WORKBOOK_CELL_MAP entry
  // (confirmed by grep: no resolve/apply references these exact paths).
  // ca.algorithm / ca.keySize / ca.csrSubject.country ARE workbook-mapped but
  // fail CSV import (in KNOWN_CSV_GAPS). adConfig.adPassword is above.
  {
    test: (p) => p === "adConfig.ca.fqdn" || p === "adConfig.ca.url",
    why: "adConfig.ca.fqdn and .url have no workbook cell; no WORKBOOK_CELL_MAP entry found",
  },

  // ── Host physical sizing inputs ──────────────────────────────────────────
  // Physical host hardware specs (CPU/RAM/NVMe/oversubscription ratios) are
  // studio sizing inputs used to compute cluster capacity. They do not appear
  // in the design workbook, which documents WHAT to deploy, not how to size it.
  {
    test: (p) => /\.host\.(coresPerCpu|cpuOversub|cpuQty|hyperthreadingEnabled|nvmeQty|nvmeSizeTb|ramGb|ramOversub|reservePct)$/.test(p),
    why: "physical host hardware sizing inputs — studio capacity model, not a workbook field",
  },

  // ── Workload VM sizing inputs ─────────────────────────────────────────────
  // Workload profile (VM count, disk/RAM/vCPU per VM) drives studio sizing.
  // Not a workbook field. The only workload.* fields that DO appear in the
  // cell-map are workloadDnsServers and workloadNtpServers (those are already
  // in CSV_MATRIX_*).
  {
    test: (p) => /\.workload\.(vmCount|diskPerVm|ramPerVm|vcpuPerVm)$/.test(p),
    why: "workload VM sizing inputs (vmCount/diskPerVm/ramPerVm/vcpuPerVm) — studio sizing model, not workbook fields",
  },

  // ── Storage sizing inputs ────────────────────────────────────────────────
  // These control studio capacity calculations (overhead percentages, growth
  // headroom, FTT redundancy, dedup/compression projections). Not workbook
  // fields. Note: storage.principalStorage IS a workbook field (in CSV_MATRIX),
  // and dataServices.* (datastoreName, nfs.*, dit.rekey*, dedupCompression) are
  // also workbook fields and are in CSV_MATRIX or KNOWN_CSV_GAPS.
  {
    test: (p) =>
      /\.storage\.(compression|dedup|policy|freePct|growthPct|swapPct|externalStorage|externalArrayTib)$/.test(p) ||
      /\.storage\.dataServices\.ftt$/.test(p),
    why: "storage sizing/policy inputs (compression ratio, dedup factor, FTT, overhead %%) — studio model, not workbook fields",
  },

  // ── vSAN tiering inputs ───────────────────────────────────────────────────
  // vSAN OSA/ESA tiering configuration (eligibility, tier size, NVMe %)
  // is a studio capacity feature, not present in the design workbook.
  {
    test: (p) => /\.tiering\.(eligibilityPct|enabled|nvmePct|tierDriveSizeTb)$/.test(p),
    why: "vSAN tiering sizing inputs — studio capacity model, no workbook cell",
  },

  // ── vsanCompute inputs ───────────────────────────────────────────────────
  // vSAN compute configuration (fault domain mapping, site network topology)
  // is a studio planning feature, not a workbook field.
  {
    test: (p) => /\.vsanCompute\.(faultDomainMapping|siteNetworkTopology)$/.test(p),
    why: "vsanCompute configuration — studio planning input, no workbook cell",
  },

  // ── infraStack (non-workbook entries) ────────────────────────────────────
  // The ONLY infraStack entries that have workbook cell-map entries are:
  //   domains.0.clusters.0.infraStack.{0,1,6}.size  (mgmt cluster only)
  // All other infraStack entries have no workbook cell:
  //   - .instances on any index/cluster — sizing output, no workbook cell
  //   - .size at non-{0,1,6} indices even on the mgmt cluster
  //   - ALL infraStack entries for workload/additional clusters (domains.1.*)
  {
    test: (p) => /\.infraStack\.\d+\.instances$/.test(p),
    why: "infraStack.N.instances — computed appliance instance count (sizing output), no workbook cell",
  },
  {
    test: (p) => {
      const m = p.match(/\.infraStack\.(\d+)\.size$/);
      if (!m) return false;
      const idx = Number(m[1]);
      // For mgmt cluster (domains.0.clusters.0), only indices 0, 1, 6 have
      // workbook cells. For workload/additional clusters, NO infraStack has cells.
      const isMgmtCluster = p.includes("domains.0.clusters.0.");
      if (!isMgmtCluster) return true; // workload cluster infraStack — no cell
      return idx !== 0 && idx !== 1 && idx !== 6;
    },
    why: "infraStack.N.size: only mgmt-cluster indices 0 (vCenter), 1 (vCenter Storage), 6 (VCF-Ops) are workbook-mapped; all other cluster infraStacks and non-{0,1,6} indices have no cell",
  },

  // ── hostOverrides (non-FQDN fields) ──────────────────────────────────────
  // The FQDN and management IP overrides within hostOverrides[] are workbook-
  // mapped; they survive CSV and are in CSV_MATRIX_*. hostOverrides[N].hostIndex
  // is the lookup key used by the cell-map logic to find the right override slot
  // — it is an internal cross-reference, not a user-facing workbook field.
  // cluster.hostOverride (boolean) is the toggle enabling per-host overrides —
  // also not a workbook field.
  {
    test: (p) => /\.hostOverrides\.\d+\.hostIndex$/.test(p) || /\.hostOverride$/.test(p),
    why: "hostOverrides[N].hostIndex is an internal key (cross-reference) used by the cell-map loop, not a workbook field; hostOverride (boolean) is the toggle, also not mapped",
  },

  // ── portgroup uplink/loadBalancing ───────────────────────────────────────
  // Each portgroup has three NIC-profile computed fields: uplink1, uplink2,
  // loadBalancing. Only the portgroup .name is a workbook field (in CSV_MATRIX).
  // The uplink/loadBalancing fields are NIC-profile-derived and have no
  // independent workbook cells.
  {
    test: (p) => /\.networks\.portgroups\.\w+\.(uplink1|uplink2|loadBalancing)$/.test(p),
    why: "portgroup uplink/loadBalancing fields are NIC-profile-derived — only the portgroup .name is a workbook field",
  },

  // ── advanced.* for WLD/additional clusters ───────────────────────────────
  // advanced.evcSetting, .internalClusterCidr, .nodeNamePrefix are workbook-
  // mapped but only for the MGMT cluster scope (Deploy Mgmt Domain sheet).
  // WLD and additional cluster positions (domains.1.*) have no workbook cells
  // for these advanced fields. Confirmed: no CSV_MATRIX entry for domains.1
  // advanced fields.
  {
    test: (p) => /domains\.1\.clusters\.\d+\.advanced\.(evcSetting|internalClusterCidr|nodeNamePrefix)$/.test(p),
    why: "advanced.evcSetting/internalClusterCidr/nodeNamePrefix are workbook-mapped only for the mgmt cluster; WLD/additional clusters have no workbook cells for these fields",
  },

  // ── az2HostOverlay non-pool/non-mtu fields for WLD cluster ───────────────
  // az2HostOverlay.(cidr, gateway, ipRangeEnd, ipRangeStart, poolName,
  // profileName, uplinkProfileName, vlan) have WORKBOOK_CELL_MAP entries
  // only for mgmt (domains.0) and additional cluster (domains.1.clusters.1).
  // For WLD cluster (domains.1.clusters.0) there is no az2HostOverlay cell-map
  // scope — confirmed: these fields are in CSV_MATRIX_* only for mgmt and
  // additional cluster positions, never for WLD cluster.
  {
    test: (p) => /domains\.1\.clusters\.0\.az2HostOverlay\.(cidr|gateway|ipRangeEnd|ipRangeStart|mtu|poolName|profileName|uplinkProfileName|vlan)$/.test(p),
    why: "az2HostOverlay fields for WLD cluster (domains.1.clusters.0) have no workbook cells; cell-map covers mgmt cluster and additional cluster only",
  },

  // ── edgeCluster.name for WLD cluster ─────────────────────────────────────
  // edgeCluster.name is NOT in WORKBOOK_CELL_MAP (confirmed: grep found no entry).
  // It exists as a user-named string in the model but is not a workbook input.
  // Note: edgeCluster.mtu and edgeCluster.nodes.* ARE workbook-mapped and are
  // in CSV_MATRIX_* for mgmt and WLD clusters.
  // The mgmt cluster's edgeCluster.name IS in CSV_MATRIX (covered there).
  // WLD cluster edgeCluster.name is absent from CSV_MATRIX_90/91.
  {
    test: (p) => /domains\.1\.clusters\.\d+\.edgeCluster\.name$/.test(p),
    why: "edgeCluster.name for WLD/additional clusters: no WORKBOOK_CELL_MAP entry; mgmt cluster name IS in CSV_MATRIX_*; WLD cluster edgeCluster.name has no workbook cell",
  },

  // ── networks.hostTep.* for WLD/additional clusters ───────────────────────
  // hostTep.(gateway, pool.end, pool.start, useDhcp, vlan) are workbook-mapped
  // for the mgmt cluster (in CSV_MATRIX_*). For WLD and additional clusters,
  // these fields have no workbook cells (confirmed: no CSV_MATRIX entry for
  // domains.1.clusters.* hostTep in either version).
  {
    test: (p) => /domains\.1\.clusters\.\d+\.networks\.hostTep\.(gateway|pool\.(end|start)|useDhcp|vlan)$/.test(p),
    why: "networks.hostTep.gateway/pool/useDhcp/vlan for WLD/additional clusters have no workbook cells; only mgmt cluster hostTep is workbook-mapped",
  },

  // ── vDS uplinks array (not to be confused with networks.uplinks.*) ────────
  // networks.vds[N].uplinks[0/1] are the vDS uplink slot assignments
  // (uplink1/uplink2 name strings from the NIC profile). These are computed
  // from the NIC profile, not a workbook field. Distinct from
  // networks.uplinks[N].gateway which IS in CSV_MATRIX.
  {
    test: (p) => /\.networks\.vds\.\d+\.uplinks\.\d+$/.test(p),
    why: "vds[N].uplinks[N] are NIC-profile-derived uplink name slots — computed, not a workbook field (distinct from networks.uplinks[N].gateway which is workbook-mapped)",
  },

  // ── edgeTep network sub-fields ────────────────────────────────────────────
  // The edgeTep sub-object holds Edge TEP VLAN/subnet/gateway/pool/mtu fields.
  // None of these have WORKBOOK_CELL_MAP entries (confirmed by grep). The only
  // edgeTep fields in the workbook are the IPv6 sub-fields for 9.1 workload
  // clusters — those are already in CSV_MATRIX_91. The IPv4 edgeTep fields have
  // no cell-map coverage.
  {
    test: (p) => /\.networks\.edgeTep\.(vlan|subnet|gateway|mtu|useDhcp)$/.test(p) ||
                 /\.networks\.edgeTep\.pool\.(start|end)$/.test(p),
    why: "networks.edgeTep IPv4 fields (vlan/subnet/gateway/pool/mtu) have no workbook cell; only edgeTep.ipv6.* sub-fields for 9.1 WLD clusters are workbook-mapped",
  },

  // ── hostTep: mtu and subnet for non-9.1-WLD clusters ─────────────────────
  // networks.hostTep.mtu and .subnet are NOT in the workbook for most cluster
  // scopes. The only hostTep fields that ARE workbook-mapped are
  // gateway/pool.start/pool.end/useDhcp/vlan (in CSV_MATRIX_*). The 9.1 WLD
  // clusters also get hostTep.ipv6.* (in CSV_MATRIX_91).
  // In 9.0, the mgmt cluster has hostTep.mtu and .subnet as not-workbook-mapped.
  // In 9.1, some clusters have hostTep.mtu/.subnet also not mapped.
  {
    test: (p) => /\.networks\.hostTep\.(mtu|subnet)$/.test(p),
    why: "networks.hostTep.mtu and .subnet have no workbook cells; workbook only covers gateway/pool/useDhcp/vlan for hostTep",
  },

  // ── networks.mgmt.pool.end (9.0 only — 9.1 maps pool.start) ─────────────
  // In 9.0, networks.mgmt.pool.end and pool.start have no workbook cells.
  // In 9.1, pool.start IS workbook-mapped (VCFMS Node IPv4 IP Range — From) and
  // is in CSV_MATRIX_91. pool.end has no 9.1 workbook cell either.
  // networks.mgmt.subnet is workbook-mapped and in CSV_MATRIX_90/91.
  {
    test: (p) => /\.networks\.mgmt\.pool\.(start|end)$/.test(p),
    why: "networks.mgmt.pool.start/end have no workbook cell for 9.0; 9.1 maps pool.start to VCFMS IP Range (in CSV_MATRIX_91) but pool.end remains unmapped",
  },

  // ── networks.vmotion.subnet and networks.vsan.subnet ─────────────────────
  // For some cluster positions, vmotion.subnet and vsan.subnet are not in the
  // workbook. In 9.0 mgmt cluster, vmotion and vsan subnets appear in
  // CSV_MATRIX_90 (confirmed). For clusters not in CSV_MATRIX they have no cell.
  // These are also NOT in KNOWN_CSV_GAPS (they don't have cell-map entries for
  // those cluster scopes). Confirmed no dedicated cell-map entry for vmotion/vsan
  // subnet in the non-covered cluster positions.
  {
    test: (p) => /\.networks\.(vmotion|vsan)\.subnet$/.test(p),
    why: "networks.vmotion.subnet and vsan.subnet: only the CSV_MATRIX_* positions have workbook cells; remaining cluster positions have no cell-map entry for subnet",
  },

  // ── networks.nicProfileId ────────────────────────────────────────────────
  // NIC profile selection (which physical NIC layout to use). Studio internal
  // setting. Not a workbook field. No WORKBOOK_CELL_MAP entry found.
  {
    test: (p) => /\.networks\.nicProfileId$/.test(p),
    why: "networks.nicProfileId — studio NIC profile selector, no workbook cell",
  },

  // ── networks.poolName (non-mgmt clusters) ────────────────────────────────
  // networks.poolName in the mgmt cluster IS workbook-mapped ("Host TEP Pool
  // Name") and is in CSV_MATRIX_90/91. For workload and additional clusters it
  // has no cell-map entry.
  {
    test: (p) => /\.networks\.poolName$/.test(p) &&
                 !p.includes("domains.0.clusters.0."),
    why: "networks.poolName for workload/additional clusters has no workbook cell; only the mgmt-cluster poolName is workbook-mapped (in CSV_MATRIX_*)",
  },

  // ── networks.*.ipv6.* for 9.0 / mgmt-cluster positions ──────────────────
  // The IPv6 sub-fields (gatewayCidr, rangeStart, rangeEnd) exist in the model
  // for all protocols and clusters. Only a subset are workbook-mapped (those in
  // CSV_MATRIX_91 for 9.1 WLD clusters). All other ipv6.* sub-fields have no
  // workbook cell.
  {
    test: (p) => /\.networks\.\w+\.ipv6\.(gatewayCidr|rangeStart|rangeEnd)$/.test(p),
    why: "network IPv6 sub-fields: only the 9.1 WLD cluster entries are workbook-mapped (in CSV_MATRIX_91); all other ipv6.* positions have no workbook cell",
  },

  // ── nsxHostOverlay (mgmt cluster) non-mapped fields ──────────────────────
  // The mgmt cluster's nsxHostOverlay has several fields that have no workbook
  // cell-map entry for the mgmt scope (workbook only maps WLD/additional cluster
  // nsxHostOverlay). These are distinct from the fields in KNOWN_CSV_GAPS above
  // (which have cell-map entries but fail enum/context on import).
  {
    test: (p) =>
      /domains\.0\.clusters\.0\.networks\.nsxHostOverlay\.(cidr|gatewayIp|hostOverlayProfileName|ipRangeEnd|ipRangeStart|numberOfUplinks|poolDescription|poolName|transportZoneName|uplinkName1|uplinkName2|uplinkProfileName|vlan|vlanTransportZoneName)$/.test(p),
    why: "mgmt-cluster nsxHostOverlay IP/profile/zone fields: these WLD-scope fields have no dedicated workbook cell for the mgmt cluster position; they appear in the model but are not individually mapped for mgmt scope",
  },

  // ── nsxHostOverlay (mgmt cluster) enum fields with NO mgmt-scope cell ──────
  // The mgmt-cluster NSX overlay block on Deploy Mgmt (engine ~8340-8428) maps
  // ONLY applyDefaultOperationMode + operationalMode + the mgmtClusterPortgroup
  // {loadBalancing,uplink1,uplink2} trio (all in CSV_MATRIX_*). The remaining
  // overlay enum fields (teamingPolicy / transportZoneOverlay / transportZoneVlan
  // / ipAssignment / staticIpPoolType / activeUplink1 / activeUplink2) are only
  // emitted by _nsxHostOverlayBlockEntries which is invoked for WLD + additional
  // cluster scopes only — never for mgmt. So these have no mgmt-scope cell even
  // with a valid enum value; they are model state, not workbook fields here.
  {
    test: (p) =>
      /domains\.0\.clusters\.0\.networks\.nsxHostOverlay\.(teamingPolicy|transportZoneOverlay|transportZoneVlan|ipAssignment|staticIpPoolType|activeUplink1|activeUplink2)$/.test(p),
    why: "mgmt-cluster nsxHostOverlay teamingPolicy/transportZone*/ipAssignment/staticIpPoolType/activeUplink1/2: the mgmt Deploy block only maps applyDefaultOperationMode+operationalMode+mgmtClusterPortgroup.*; these other overlay enums are emitted only for WLD/additional cluster scopes, so no mgmt-scope workbook cell exists",
  },

  // ── nsxHostOverlay.mgmtClusterPortgroup.* for WLD/additional clusters ──────
  // mgmtClusterPortgroup.{loadBalancing,uplink1,uplink2} are mapped ONLY on the
  // Deploy Mgmt sheet (engine ~8368-8428, scope mgmt-cluster) and survive CSV
  // for the mgmt cluster (in CSV_MATRIX_*). They exist in the model for every
  // cluster's nsxHostOverlay but have no workbook cell for WLD/additional scopes.
  {
    test: (p) =>
      /domains\.1\.clusters\.\d+\.networks\.nsxHostOverlay\.mgmtClusterPortgroup\.(loadBalancing|uplink1|uplink2)$/.test(p),
    why: "nsxHostOverlay.mgmtClusterPortgroup.* is a mgmt-cluster-only cell (Deploy Mgmt sheet); WLD/additional clusters carry the field in-model but have no workbook cell for it",
  },

  // ── az2Networks no-cell sub-fields (hostTep / mgmt.pool / vmotion+vsan.mtu) ─
  // The az2Networks cell-map (engine _az2NetworkBlockEntries ~4445-4508) maps
  // ONLY the mgmt {gateway,subnet,vlan} and the vmotion/vsan {gateway,subnet,
  // vlan,pool.start,pool.end} cells (those gated entries are the genuine engine
  // bug tracked in KNOWN_CSV_GAPS). It has NO cells for the hostTep sub-object,
  // for mgmt.pool.*, or for vmotion/vsan .mtu — those are model-only fields.
  {
    test: (p) =>
      /\.az2Networks\.hostTep\.(gateway|mtu|pool\.(end|start)|subnet|useDhcp|vlan)$/.test(p) ||
      /\.az2Networks\.mgmt\.pool\.(end|start)$/.test(p) ||
      /\.az2Networks\.(vmotion|vsan)\.mtu$/.test(p),
    why: "az2Networks hostTep.*, mgmt.pool.*, and vmotion/vsan.mtu have no cell in _az2NetworkBlockEntries (it maps only mgmt {gateway,subnet,vlan} + vmotion/vsan {gateway,subnet,vlan,pool} — those gated entries are the genuine bug in KNOWN_CSV_GAPS); these sub-fields are model-only state",
  },

  // ── az2HostOverlay.staticIpPoolType for the WLD cluster ───────────────────
  // az2HostOverlay cells exist for the mgmt cluster (Configure Mgmt) and the
  // additional cluster, where staticIpPoolType round-trips with a valid member
  // (in CSV_MATRIX_*). The WLD cluster (domains.1.clusters.0) has no az2HostOverlay
  // cell-map scope at all — its az2HostOverlay fields are already allowlisted
  // above; staticIpPoolType is the enum sibling, equally unmapped for WLD.
  {
    test: (p) => p.startsWith("instances.0.domains.1.clusters.0.az2HostOverlay.staticIpPoolType"),
    why: "az2HostOverlay.staticIpPoolType for the WLD cluster (domains.1.clusters.0) has no workbook cell; az2HostOverlay is mapped for mgmt + additional clusters only (where the enum round-trips into CSV_MATRIX_*)",
  },

  // ── edgeCluster.nodes[1].resourcePool ─────────────────────────────────────
  // The "Edge Node Resource Pool" cell maps node 0 only (CSV_MATRIX_* has
  // nodes.0.resourcePool). nodes[1] has no separate workbook cell.
  {
    test: (p) => /\.edgeCluster\.nodes\.1\.resourcePool$/.test(p),
    why: "edgeCluster.nodes[1].resourcePool has no workbook cell; the Edge Node Resource Pool cell maps node 0 only (nodes.0.resourcePool is in CSV_MATRIX_*)",
  },

  // ── federation GM nodes[1]/[2] deploySize + node[2] searchList ────────────
  // The "NSX GM Deployment Size" cell resolves/applies node 0 only (engine
  // ~7543-7548 hardcode index 0); nodes 1/2 deploySize have no cell. searchList
  // is mapped for nodes 0/1 (9.1) but node 2 has no searchList cell.
  {
    test: (p) =>
      /^federationConfig\.globalManager\.nodes\.[12]\.deploySize$/.test(p) ||
      p === "federationConfig.globalManager.nodes.2.searchList",
    why: "GM node deploySize maps node 0 only (resolve/apply hardcode index 0); nodes 1/2 deploySize have no cell. node-2 searchList also has no cell (searchList maps nodes 0/1 in 9.1, in CSV_MATRIX_91)",
  },

  // ── supervisorConfig / dit.rekeyMode / dualStackIpv6 / t0.haMode for the
  //    ADDITIONAL cluster (domains.1.clusters.1) ─────────────────────────────
  // The supervisor block (engine ~8459/8484) is invoked for mgmt-cluster +
  // workload-cluster scopes only — NOT additional-cluster. Likewise dit.rekeyMode
  // (mgmt + WLD scopes), dualStackIpv6 (WLD scope), useEsxiMgmtVmk (WLD scope),
  // and t0 haMode (mgmt + WLD scopes) have no additional-cluster cell. So for the
  // additional cluster these enums round-trip nowhere via the workbook.
  {
    test: (p) =>
      /^instances\.0\.domains\.1\.clusters\.1\.supervisorConfig\.(controlPlaneSize|edgeClusterSize|haEnabled|ipAssignmentMode|networkingStack|supervisorLocation|deployment\.useEsxiMgmtVmk)$/.test(p) ||
      p === "instances.0.domains.1.clusters.1.storage.dataServices.dit.rekeyMode" ||
      p === "instances.0.domains.1.clusters.1.networks.dualStackIpv6" ||
      p === "instances.0.domains.1.clusters.1.t0Gateways.0.haMode",
    why: "additional-cluster (domains.1.clusters.1) supervisorConfig enums, dit.rekeyMode, dualStackIpv6, and t0 haMode have no workbook cell: the supervisor/rekey/t0 blocks scope to mgmt+WLD only, dualStackIpv6 to WLD only — additional cluster is unmapped for these",
  },

  // ── dualStackIpv6 / useEsxiMgmtVmk for the MGMT cluster (domains.0.clusters.0) ─
  // dualStackIpv6 (engine ~9117, scope workload-cluster) and
  // supervisorConfig.deployment.useEsxiMgmtVmk (engine ~8541, scope
  // workload-cluster) are WLD-only cells. The mgmt cluster carries both fields
  // in-model but has no workbook cell for them.
  {
    test: (p) =>
      p === "instances.0.domains.0.clusters.0.networks.dualStackIpv6" ||
      p === "instances.0.domains.0.clusters.0.supervisorConfig.deployment.useEsxiMgmtVmk",
    why: "mgmt-cluster dualStackIpv6 and supervisorConfig.deployment.useEsxiMgmtVmk have no workbook cell; both cells are workload-cluster scope only (in CSV_MATRIX_* for the WLD cluster)",
  },

  // ── storage.principalStorage / nfs.boundToVmknic for WLD + additional ─────
  // "Storage Option" (principalStorage, engine ~5469) and "NFS Bound to vmknic"
  // (engine theme 2) are mgmt-cluster scope only. The WLD and additional cluster
  // positions carry these in-model but have no workbook cell. (principalStorage
  // round-trips into CSV_MATRIX_* for the mgmt cluster via the NFSv3 override.)
  {
    test: (p) =>
      /^instances\.0\.domains\.1\.clusters\.\d+\.storage\.principalStorage$/.test(p) ||
      /^instances\.0\.domains\.1\.clusters\.\d+\.storage\.dataServices\.nfs\.boundToVmknic$/.test(p),
    why: "storage.principalStorage and storage.dataServices.nfs.boundToVmknic are mgmt-cluster-scope cells only; WLD/additional cluster positions have no workbook cell (mgmt principalStorage round-trips into CSV_MATRIX_* via a valid enum override)",
  },

  // ── t0Gateways.N.stateful ────────────────────────────────────────────────
  // T0 gateway stateful flag. No WORKBOOK_CELL_MAP entry found (confirmed by
  // grep: no resolve/apply touches t0.stateful). JSON-covered.
  {
    test: (p) => /\.t0Gateways\.\d+\.stateful$/.test(p),
    why: "t0Gateways[N].stateful — no workbook cell; stateful is a design attribute not covered by any WORKBOOK_CELL_MAP entry",
  },

  // ── supervisorConfig: deployment sub-fields without cells ────────────────
  // supervisorConfig.deployment.gateway, .subnetMask, .vds are workbook-mapped
  // for 9.1 (in CSV_MATRIX_91). For 9.0 these have no cell. privateTgwCidr and
  // controlPlaneIpRange ARE mapped for 9.0 (in CSV_MATRIX_90).
  // deployment.useEsxiMgmtVmk is in KNOWN_CSV_GAPS (enum sentinel failure).
  // No allowlist needed for deployment sub-fields — all are covered elsewhere.
  // This comment is intentionally empty (no allowlist entry needed here).

  // ── Instance-level non-workbook fields ───────────────────────────────────
  // These instance-level fields are studio planning state with no workbook cells.
  {
    test: (p) =>
      /^instances\.\d+\.(drPosture|witnessEnabled|witnessSize)$/.test(p) ||
      /^instances\.\d+\.witnessSite\.(location|name)$/.test(p) ||
      /^instances\.\d+\.siteIds\.\d+$/.test(p),
    why: "instance-level studio planning fields (drPosture, witnessEnabled/Size, witnessSite, siteIds) — no workbook cells; these are plan metadata not deployment config. NOTE: deploymentProfile IS workbook-mapped (\"Deployment model\" dropdown) and now round-trips into CSV_MATRIX_* via a valid enum override, so it is intentionally NOT listed here.",
  },

  // ── Domain-level non-workbook fields ─────────────────────────────────────
  {
    test: (p) =>
      /^instances\.\d+\.domains\.\d+\.(imported|hostSplitPct|placement)$/.test(p),
    why: "domain-level planning fields (imported, hostSplitPct, placement) — no workbook cells; placement is internal state (its absence from the workbook is the root cause of the az2Networks CSV gap)",
  },

  // ── Cluster-level non-workbook flags ─────────────────────────────────────
  {
    test: (p) =>
      /\.clusters\.\d+\.(preExisting|isDefault|hostOverride)$/.test(p),
    why: "cluster planning flags (preExisting, isDefault, hostOverride) — studio-internal state, no workbook cells",
  },

  // ── Naming config ────────────────────────────────────────────────────────
  // Fleet naming templates (host/vDS naming patterns, prefix, postfix, etc.)
  // are studio UI features. No WORKBOOK_CELL_MAP entry found for any
  // namingConfig field. JSON-covered.
  {
    test: (p) => p.startsWith("namingConfig."),
    why: "namingConfig.* — studio hostname/vDS naming templates; no workbook cells (user-configures via Studio UI only)",
  },

  // ── Report metadata ──────────────────────────────────────────────────────
  // PDF cover-page metadata (client name, prepared-by, date, revision, etc.)
  // No WORKBOOK_CELL_MAP entry for any reportMetadata field. JSON-covered.
  {
    test: (p) => p.startsWith("reportMetadata."),
    why: "reportMetadata.* — PDF report cover-page metadata; no workbook cells (studio-only fields)",
  },

  // ── Fleet / instance metadata ─────────────────────────────────────────────
  // Fleet name, vcfVersion, deploymentPathway — metadata fields with no workbook
  // cells. The workbook is version-specific, so vcfVersion is implicit. name
  // is studio display name. deploymentPathway is inferred from inst count.
  {
    test: (p) =>
      p === "name" || p === "vcfVersion" || p === "deploymentPathway" ||
      p === "ssoMode",
    why: "fleet-level metadata (name, vcfVersion, deploymentPathway) and ssoMode — no workbook cells; ssoMode is inferred/UI-set, not a workbook field",
  },

  // ── Sites ────────────────────────────────────────────────────────────────
  // Site definitions (name, location, region, role) are studio planning
  // metadata. No WORKBOOK_CELL_MAP entry for any sites.* field. JSON-covered.
  {
    test: (p) => p.startsWith("sites."),
    why: "sites.* — site planning metadata (name, location, region, role); no workbook cells",
  },

  // ── networkConfig.ntp.timezone ───────────────────────────────────────────
  // The NTP timezone preference has no workbook cell. networkConfig.dns.* and
  // ntp.servers[] ARE workbook-mapped (in CSV_MATRIX_*). timezone is a studio
  // planning preference not covered by any WORKBOOK_CELL_MAP entry.
  {
    test: (p) => p === "networkConfig.ntp.timezone",
    why: "networkConfig.ntp.timezone — NTP timezone preference; no workbook cell (ntp.servers[] IS mapped and in CSV_MATRIX_*)",
  },

  // ── portgroups.nfs.name and portgroups.vsan.name ─────────────────────────
  // Confirmed: no WORKBOOK_CELL_MAP entry for portgroups.nfs.name or
  // portgroups.vsan.name. These portgroup names for NFS and vSAN traffic types
  // are studio display names, not workbook fields. Only mgmt/vmMgmt/vmotion/
  // principalStorage/vsanStorageClient portgroup names are workbook-mapped.
  {
    test: (p) => /\.networks\.portgroups\.(nfs|vsan)\.name$/.test(p),
    why: "portgroups.nfs.name and portgroups.vsan.name have no workbook cells (confirmed no WORKBOOK_CELL_MAP entry); only mgmt/vmMgmt/vmotion/principalStorage/vsanStorageClient portgroup names are mapped",
  },

  // ── networks.mgmt.subnet for WLD clusters ────────────────────────────────
  // The mgmt cluster's networks.mgmt.subnet IS workbook-mapped in 9.0 (in
  // CSV_MATRIX_90). In 9.1 the cell was dropped from the workbook (no cell-map
  // entry for mgmt.subnet in any cluster in 9.1). For WLD/additional clusters
  // in both versions, mgmt.subnet has no workbook cell.
  // The allowlist covers: (a) all WLD/additional clusters for both versions,
  // (b) the 9.1 mgmt cluster (handled in NON_WORKBOOK_ALLOWLIST_91_ONLY).
  {
    test: (p) => /domains\.1\.clusters\.\d+\.networks\.mgmt\.subnet$/.test(p),
    why: "networks.mgmt.subnet for WLD/additional clusters has no workbook cell in either version; only the mgmt cluster in 9.0 is workbook-mapped",
  },

  // ── networks.poolName for WLD/additional clusters ─────────────────────────
  // networks.poolName (Host TEP Pool Name) is workbook-mapped only for the mgmt
  // cluster in 9.0 (in CSV_MATRIX_90). WLD/additional clusters have no cell.
  // In 9.1 even the mgmt cluster cell was dropped (handled below in _91_ONLY).
  {
    test: (p) => /domains\.1\.clusters\.\d+\.networks\.poolName$/.test(p),
    why: "networks.poolName for WLD/additional clusters has no workbook cell; only mgmt cluster (9.0) is workbook-mapped (in CSV_MATRIX_90); 9.1 dropped the cell",
  },
];

// Fields present in 9.1 kitchen-sink but whose workbook cells were dropped in
// 9.1 (i.e., they are in CSV_MATRIX_90 but NOT CSV_MATRIX_91). For 9.1 these
// fields have no workbook cell. Checked only when version === "9.1".
const NON_WORKBOOK_ALLOWLIST_91_ONLY = [
  // networks.mgmt.subnet — the 9.0 workbook ("Mgmt Subnet") had a cell but 9.1
  //   removed it (not in CSV_MATRIX_91 for any cluster position).
  (p) => /\.networks\.mgmt\.subnet$/.test(p),

  // networks.poolName — the 9.0 workbook ("Host TEP Pool Name") mapped only the
  //   mgmt cluster. In 9.1 this cell was dropped (not in CSV_MATRIX_91 at all).
  (p) => p === "instances.0.domains.0.clusters.0.networks.poolName",

  // The second workload cluster (domains.1.clusters.1) in 9.1 has a more limited
  // set of workbook cells than the first WLD cluster. Many fields that ARE in
  // CSV_MATRIX_91 for clusters.0 have no cell for clusters.1. These are
  // clusters.1-specific fields not covered by the cell-map for 9.1:
  //   - edgeCluster.nodes.* (fqdn, mgmtIpCidr, tepIps, fp-eth, hostGroup, gatewayInterfaceIps)
  //   - edgeCluster.mtu / edgeCluster.name
  //   - t0Gateways.*
  //   - supervisorConfig.* (most fields except .enabled which IS mapped)
  //   - networks.hostTep.* (gateway/pool/useDhcp/vlan)
  //   - networks.uplinks.*.gateway
  //   - networks.portgroups.nfs.name / portgroups.vsan.name (already in NON_WORKBOOK_ALLOWLIST)
  //   - storage.dataServices.dit.enabled / rekeyHoursCustom / rekeyInterval
  //   - advanced.evcSetting / internalClusterCidr / nodeNamePrefix
  (p) => {
    if (!p.includes("domains.1.clusters.1.")) return false;
    const suffix = p.replace(/^.*domains\.1\.clusters\.1\./, "");
    return (
      /^edgeCluster\.(nodes\.[01]\.(fp(Eth0|Eth1)Uplinks\.[01]|fqdn|gatewayInterfaceIps\.[01]|hostGroup|mgmtIpCidr|resourcePool|tepIps\.[01])|mtu|name)$/.test(suffix) ||
      /^t0Gateways\.\d+\.(asnLocal|bgpEnabled|name|bgpPeers\.\d+\.(asn|bfdEnabled|ip|mtu))$/.test(suffix) ||
      /^supervisorConfig\.(apiServerDnsNames|clusterFqdn|clusterName|clusterVip|controlPlaneStoragePolicy|dnsSearchDomains|dnsServers|ephemeralDisksStoragePolicy|externalIpBlocks|imageCacheStoragePolicy|ipAddresses|node[123]Ip|nsxProject|ntpServers|privateTgwIpBlocks|privateVpcCidrs|serviceCidr|supervisorName|version|vpcConnectivityProfile|vSphereZoneName|workloadDnsServers|workloadNtpServers)$/.test(suffix) ||
      /^supervisorConfig\.deployment\.(controlPlaneIpRange|gateway|privateTgwCidr|subnetMask|vds)$/.test(suffix) ||
      /^networks\.(hostTep\.(gateway|pool\.(end|start)|useDhcp|vlan)|uplinks\.[01]\.gateway)$/.test(suffix) ||
      /^storage\.dataServices\.dit\.(enabled|rekeyHoursCustom|rekeyInterval)$/.test(suffix) ||
      /^advanced\.(evcSetting|internalClusterCidr|nodeNamePrefix)$/.test(suffix)
    );
  },

  // domains.0.clusters.0 (mgmt cluster) supervisorConfig.deployment fields —
  //   these deployment sub-fields are workbook-mapped for WLD cluster scope
  //   ("Deploy Workload Domain" sheet) but NOT for the mgmt cluster. The kitchen-
  //   sink populates supervisorConfig.deployment on all clusters (factory creates
  //   it), but the cell-map has no mgmt-cluster entries for these sub-fields.
  (p) => /domains\.0\.clusters\.0\.supervisorConfig\.deployment\.(controlPlaneIpRange|gateway|privateTgwCidr|subnetMask|vds)$/.test(p),

  // domains.0.clusters.0 (mgmt cluster) storage.dataServices.dit.enabled —
  //   workbook-mapped for WLD cluster ("WLD DIT Encryption Enabled"). No
  //   mgmt-cluster scope cell. In CSV_MATRIX_91 for WLD cluster only.
  (p) => p === "instances.0.domains.0.clusters.0.storage.dataServices.dit.enabled",

  // domains.0.clusters.0 networks.portgroups.principalStorage.name and
  //   vsanStorageClient.name — these portgroup names for the mgmt cluster in 9.1
  //   have no workbook cells (confirmed: not in CSV_MATRIX_91 for mgmt cluster;
  //   these types were not added to the 9.1 mgmt workbook page). JSON-covered.
  (p) =>
    p === "instances.0.domains.0.clusters.0.networks.portgroups.principalStorage.name" ||
    p === "instances.0.domains.0.clusters.0.networks.portgroups.vsanStorageClient.name",

  // domains.1.clusters.0 fields that are in CSV_MATRIX_91 (WLD) but were NOT in
  // CSV_MATRIX_90 for the same position. Already handled by NON_WORKBOOK_ALLOWLIST_90_ONLY.
  // Conversely, some WLD-cluster fields are workbook-mapped in both 9.0 and 9.1
  // but only appear in CSV_MATRIX for specific sub-fields. The remaining orphans
  // for 9.1 WLD cluster are handled by KNOWN_CSV_GAPS above.
];

// Fields that are workbook-mapped in 9.1 (and thus in CSV_MATRIX_91) but have
// NO workbook cell in 9.0. For 9.0, these are treated as non-workbook fields.
// This list is checked only when version === "9.0". All entries are JSON-covered.
const NON_WORKBOOK_ALLOWLIST_90_ONLY = [
  // globalManager.nodes.N.searchList — 9.1 workbook cell added ("NSX GM Domain
  //   Search List"). No 9.0 workbook cell. CSV_MATRIX_91 covers node 0 and 1.
  (p) => /^federationConfig\.globalManager\.nodes\.\d+\.searchList$/.test(p),

  // installerConfig.activationCode — 9.1-only field + workbook cell ("Activation
  //   Code"). Not present in 9.0 workbook. In CSV_MATRIX_91, absent from 9.0.
  (p) => p === "installerConfig.activationCode",

  // advanced.evcSetting — 9.1-only workbook cell ("EVC Setting"). In
  //   CSV_MATRIX_91 for both mgmt and WLD clusters. No 9.0 workbook cell.
  //   (Note: advanced.evcSetting for mgmt cluster is in KNOWN_CSV_GAPS because
  //   the kitchen-sink stamps it there, but the path above covers it for WLD.)
  (p) => /\.advanced\.evcSetting$/.test(p),

  // networks.portgroups.principalStorage.name — 9.1-only workbook cell. Not in
  //   CSV_MATRIX_90 for mgmt cluster (only WLD clusters have it in 9.0).
  (p) => /domains\.0\.clusters\.0\.networks\.portgroups\.principalStorage\.name$/.test(p),

  // networks.portgroups.vsanStorageClient.name — similar to above; 9.1-only
  //   for the mgmt cluster position.
  (p) => /domains\.0\.clusters\.0\.networks\.portgroups\.vsanStorageClient\.name$/.test(p),

  // storage.dataServices.dit.enabled — 9.1-only workbook cell ("DIT Enabled").
  //   CSV_MATRIX_91 covers WLD clusters. No 9.0 workbook cell.
  (p) => /\.storage\.dataServices\.dit\.enabled$/.test(p),

  // storage.dataServices.dit.rekeyHoursCustom and rekeyInterval — 9.1-only.
  //   CSV_MATRIX_91 covers mgmt and WLD. No 9.0 cells.
  (p) => /\.storage\.dataServices\.dit\.(rekeyHoursCustom|rekeyInterval)$/.test(p),

  // Many supervisorConfig fields added in 9.1 workbook:
  //   apiServerDnsNames, controlPlaneStoragePolicy, dnsSearchDomains, dnsServers,
  //   ephemeralDisksStoragePolicy, externalIpBlocks, imageCacheStoragePolicy,
  //   ipAddresses, nsxProject, ntpServers, privateTgwIpBlocks, privateVpcCidrs,
  //   serviceCidr, supervisorName, vSphereZoneName, vpcConnectivityProfile,
  //   workloadDnsServers, workloadNtpServers
  //   — all in CSV_MATRIX_91, none in CSV_MATRIX_90.
  (p) => /\.supervisorConfig\.(apiServerDnsNames|controlPlaneStoragePolicy|dnsSearchDomains|dnsServers|ephemeralDisksStoragePolicy|externalIpBlocks|imageCacheStoragePolicy|ipAddresses|nsxProject|ntpServers|privateTgwIpBlocks|privateVpcCidrs|serviceCidr|supervisorName|vSphereZoneName|vpcConnectivityProfile|workloadDnsServers|workloadNtpServers)$/.test(p),

  // supervisorConfig enum fields added to the workbook in 9.1 only:
  //   controlPlaneSize, haEnabled, ipAssignmentMode, networkingStack,
  //   supervisorLocation. The 9.0 Supervisor block carried only ~9 fields
  //   (Version, Edge Cluster, Admin Password, Node 1/2/3 IPs, Cluster
  //   VIP/FQDN/Name); these enum dropdowns did not exist in the 9.0 workbook.
  //   In 9.1 they round-trip with a valid member (in CSV_MATRIX_91 for mgmt+WLD).
  //   (edgeClusterSize IS dual-version — "Edge Cluster" existed in 9.0 — so it
  //   stays in CSV_MATRIX_90 and is NOT listed here.)
  (p) => /\.supervisorConfig\.(controlPlaneSize|haEnabled|ipAssignmentMode|networkingStack|supervisorLocation)$/.test(p),

  // storage.dataServices.dit.rekeyMode — 9.1-only workbook cell ("DIT Rekey
  //   Mode" / "WLD DIT Rekey Mode", engine ~5555/5740). No 9.0 cell. In 9.1 it
  //   round-trips for mgmt+WLD (in CSV_MATRIX_91 via the "Custom" override).
  (p) => /\.storage\.dataServices\.dit\.rekeyMode$/.test(p),

  // supervisorConfig.deployment.* — 9.1-only workbook cells:
  //   gateway, subnetMask, vds. Also controlPlaneIpRange and privateTgwCidr are
  //   in CSV_MATRIX_90 (the WLD cluster) but NOT in CSV_MATRIX_90 for the mgmt
  //   cluster.
  (p) => /\.supervisorConfig\.deployment\.(gateway|subnetMask|vds)$/.test(p),
  // controlPlaneIpRange and privateTgwCidr are in CSV_MATRIX_90 only for
  // domains.1.clusters.0 (the WLD cluster). For domains.0.clusters.0 (mgmt)
  // they're 9.1-only. For domains.1.clusters.1 (additional), they were absent
  // from 9.0 but present in 9.1.
  (p) => /domains\.(0|1)\.clusters\.(0|1)\.supervisorConfig\.deployment\.(controlPlaneIpRange|privateTgwCidr)$/.test(p) &&
         // domains.1.clusters.0 is in CSV_MATRIX_90 — only exclude mgmt+additional
         !p.includes("domains.1.clusters.0."),

  // nsxHostOverlay.activeUplink1/2 for WLD clusters — 9.1 adds these; 9.0 only
  //   has them for the additional cluster (clusters.1). CSV_MATRIX_90 includes
  //   clusters.1.nsxHostOverlay.activeUplink1/2 but not clusters.0.
  (p) => /domains\.1\.clusters\.0\.networks\.nsxHostOverlay\.activeUplink[12]$/.test(p),

  // All workload cluster and additional cluster fields that appear in
  // CSV_MATRIX_91 but NOT in CSV_MATRIX_90. These are systematically identified
  // as the entire second-workload-cluster (clusters.1) block for supervisorConfig,
  // edgeCluster.nodes, t0Gateways, portgroups.nfs/vsan, networks.uplinks,
  // storage.principalStorage, storage.dataServices.nfs.boundToVmknic — fields
  // that only appear in CSV_MATRIX_91.domains.1.clusters.1 rows.
  (p) => {
    if (!p.includes("domains.1.clusters.1.")) return false;
    const suffix = p.replace(/^.*domains\.1\.clusters\.1\./, "");
    return (
      /^edgeCluster\.(nodes\.[01]\.(fpEth[01]Uplinks\.[01]|fqdn|gatewayInterfaceIps\.[01]|hostGroup|mgmtIpCidr|resourcePool|tepIps\.[01])|mtu|name)$/.test(suffix) ||
      /^networks\.(portgroups\.(nfs|vsan)\.name|uplinks\.[01]\.gateway)$/.test(suffix) ||
      /^t0Gateways\.\d+\.(asnLocal|bgpEnabled|name|bgpPeers\.\d+\.(asn|bfdEnabled|ip|mtu))$/.test(suffix) ||
      /^storage\.(principalStorage|dataServices\.nfs\.(boundToVmknic|serverIp|sharePath)|dataServices\.datastoreName|dataServices\.dedupCompressionEnabled)$/.test(suffix) ||
      /^supervisorConfig\.(clusterFqdn|clusterName|clusterVip|node[123]Ip|version)$/.test(suffix)
    );
  },

  // advanced.internalClusterCidr and nodeNamePrefix for 9.0 workload clusters
  //   — these appear in CSV_MATRIX_91 but NOT CSV_MATRIX_90 for domains.1.clusters.0.
  //   However CSV_MATRIX_90 DOES have them for domains.0.clusters.0 (mgmt cluster).
  //   For WLD cluster in 9.0, they have no workbook cell.
  (p) => /domains\.1\.clusters\.(0|1)\.advanced\.(internalClusterCidr|nodeNamePrefix)$/.test(p),

  // az2HostOverlay fields for domains.1.clusters.0 — in 9.0, only the
  //   domains.0.clusters.0 az2HostOverlay is in CSV_MATRIX_90. The WLD cluster's
  //   az2HostOverlay fields (cidr, gateway, ipRangeEnd, etc.) have no 9.0 workbook
  //   cells and are not in CSV_MATRIX_90. They ARE in CSV_MATRIX_91.
  //   Note: clusters.1.az2HostOverlay IS in CSV_MATRIX_90 (it's the additional).
  (p) => /domains\.1\.clusters\.0\.az2HostOverlay\.(cidr|gateway|ipRangeEnd|ipRangeStart|mtu|poolName|profileName|uplinkProfileName|vlan)$/.test(p),

  // edgeCluster.name for domains.1.clusters.0 — WLD cluster's edge cluster name
  //   is in CSV_MATRIX_91 but not CSV_MATRIX_90.
  (p) => p === "instances.0.domains.1.clusters.0.edgeCluster.name",

  // networks.hostTep.* for domains.1.clusters.0 — WLD cluster hostTep fields
  //   (gateway, pool.end, pool.start, useDhcp, vlan) are in CSV_MATRIX_91 but
  //   NOT in CSV_MATRIX_90 for this cluster position.
  (p) => /domains\.1\.clusters\.0\.networks\.hostTep\.(gateway|pool\.(end|start)|useDhcp|vlan)$/.test(p),

  // domains.1.clusters.0.infraStack.0.size — WLD cluster has no workbook cell
  //   for any infraStack size in 9.0 (confirmed: not in CSV_MATRIX_90). This is
  //   already handled by the version-agnostic rule above (non-mgmt infraStack).
  // (already covered by the general infraStack allowlist rule above)

  // domains.1.clusters.0 networks.dualStackIpv6 — workbook-mapped in 9.1 only
  //   ("WLD Dual Stack IPv6 Enabled"); in CSV_MATRIX_91 for this position.
  //   In 9.0 no workbook cell exists for the toggle.
  (p) => p === "instances.0.domains.1.clusters.0.networks.dualStackIpv6",
];

function allowlisted(path, version) {
  if (NON_WORKBOOK_ALLOWLIST.some((e) => e.test(path))) return true;
  if (version === "9.0" && NON_WORKBOOK_ALLOWLIST_90_ONLY.some((fn) => fn(path))) return true;
  if (version === "9.1" && NON_WORKBOOK_ALLOWLIST_91_ONLY.some((fn) => fn(path))) return true;
  return false;
}

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
// Captured empirically (2026-05-29) via the skipped "PRINT csv survivors"
// dev-aid test in the CSV describe block below — unskip it to re-capture after
// model/cell-map changes, then paste the logged lists here.
// These are the paths that survive the CSV cell-map round-trip for each version.
// 9.0: 378 mapped paths.  9.1: 453 mapped paths.
const CSV_MATRIX_90 = [
  "adConfig.adFqdn",
  "adConfig.adUser",
  "adConfig.ca.algorithm",
  "adConfig.ca.csrSubject.commonName",
  "adConfig.ca.csrSubject.country",
  "adConfig.ca.csrSubject.email",
  "adConfig.ca.csrSubject.locality",
  "adConfig.ca.csrSubject.org",
  "adConfig.ca.csrSubject.ou",
  "adConfig.ca.csrSubject.state",
  "adConfig.ca.keySize",
  "adConfig.ca.password",
  "adConfig.ca.templateName",
  "adConfig.ca.user",
  "adConfig.serviceAccountUser",
  "backupConfig.directory",
  "backupConfig.host",
  "backupConfig.port",
  "backupConfig.protocol",
  "backupConfig.sshFingerprint",
  "backupConfig.user",
  "federationConfig.globalManager.apiThumbprint",
  "federationConfig.globalManager.certificateId",
  "federationConfig.globalManager.clusterId",
  "federationConfig.globalManager.federationName",
  "federationConfig.globalManager.nodes.0.deploySize",
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
  "installerConfig.depotType",
  "installerConfig.downloadToken",
  "installerConfig.offlineDepotHostname",
  "installerConfig.offlineDepotPort",
  "installerConfig.proxyAuthenticated",
  "installerConfig.proxyEnabled",
  "installerConfig.proxyHost",
  "installerConfig.proxyPort",
  "installerConfig.proxyProtocol",
  "installerConfig.proxyUser",
  "instances.0.deploymentProfile",
  "instances.0.domains.0.clusters.0.advanced.internalClusterCidr",
  "instances.0.domains.0.clusters.0.advanced.nodeNamePrefix",
  "instances.0.domains.0.clusters.0.az2HostOverlay.cidr",
  "instances.0.domains.0.clusters.0.az2HostOverlay.gateway",
  "instances.0.domains.0.clusters.0.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.0.clusters.0.az2HostOverlay.ipRangeStart",
  "instances.0.domains.0.clusters.0.az2HostOverlay.mtu",
  "instances.0.domains.0.clusters.0.az2HostOverlay.poolName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.profileName",
  "instances.0.domains.0.clusters.0.az2HostOverlay.staticIpPoolType",
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
  "instances.0.domains.0.clusters.0.networks.hostTep.gateway",
  "instances.0.domains.0.clusters.0.networks.hostTep.pool.end",
  "instances.0.domains.0.clusters.0.networks.hostTep.pool.start",
  "instances.0.domains.0.clusters.0.networks.hostTep.subnet",
  "instances.0.domains.0.clusters.0.networks.hostTep.useDhcp",
  "instances.0.domains.0.clusters.0.networks.hostTep.vlan",
  "instances.0.domains.0.clusters.0.networks.mgmt.gateway",
  "instances.0.domains.0.clusters.0.networks.mgmt.subnet",
  "instances.0.domains.0.clusters.0.networks.mgmt.vlan",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.applyDefaultOperationMode",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.mgmtClusterPortgroup.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.mgmtClusterPortgroup.uplink1",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.mgmtClusterPortgroup.uplink2",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.operationalMode",
  "instances.0.domains.0.clusters.0.networks.poolName",
  "instances.0.domains.0.clusters.0.networks.portgroups.mgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.nfs.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmMgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmotion.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vsan.name",
  "instances.0.domains.0.clusters.0.networks.uplinks.0.gateway",
  "instances.0.domains.0.clusters.0.networks.uplinks.1.gateway",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.mode",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.timeout",
  "instances.0.domains.0.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.0.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.mode",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.timeout",
  "instances.0.domains.0.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.1.name",
  "instances.0.domains.0.clusters.0.networks.vmotion.gateway",
  "instances.0.domains.0.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.0.clusters.0.networks.vmotion.pool.end",
  "instances.0.domains.0.clusters.0.networks.vmotion.pool.start",
  "instances.0.domains.0.clusters.0.networks.vmotion.subnet",
  "instances.0.domains.0.clusters.0.networks.vmotion.vlan",
  "instances.0.domains.0.clusters.0.networks.vsan.gateway",
  "instances.0.domains.0.clusters.0.networks.vsan.mtu",
  "instances.0.domains.0.clusters.0.networks.vsan.pool.end",
  "instances.0.domains.0.clusters.0.networks.vsan.pool.start",
  "instances.0.domains.0.clusters.0.networks.vsan.subnet",
  "instances.0.domains.0.clusters.0.networks.vsan.vlan",
  "instances.0.domains.0.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.0.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.boundToVmknic",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.0.clusters.0.storage.principalStorage",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.0.clusters.0.supervisorConfig.edgeClusterSize",
  "instances.0.domains.0.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.0.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.version",
  "instances.0.domains.0.clusters.0.t0Gateways.0.asnLocal",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.asn",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.bfdEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.ip",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.mtu",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.asn",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.bfdEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.ip",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.mtu",
  "instances.0.domains.0.clusters.0.t0Gateways.0.haMode",
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
  "instances.0.domains.1.clusters.0.networks.mgmt.gateway",
  "instances.0.domains.1.clusters.0.networks.mgmt.subnet",
  "instances.0.domains.1.clusters.0.networks.mgmt.vlan",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.activeUplink1",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.activeUplink2",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.applyDefaultOperationMode",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipAssignment",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.operationalMode",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.staticIpPoolType",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.teamingPolicy",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneOverlay",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneVlan",
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
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.mode",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.timeout",
  "instances.0.domains.1.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.0.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.mode",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.timeout",
  "instances.0.domains.1.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.1.name",
  "instances.0.domains.1.clusters.0.networks.vmotion.gateway",
  "instances.0.domains.1.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.0.networks.vmotion.pool.end",
  "instances.0.domains.1.clusters.0.networks.vmotion.pool.start",
  "instances.0.domains.1.clusters.0.networks.vmotion.subnet",
  "instances.0.domains.1.clusters.0.networks.vmotion.vlan",
  "instances.0.domains.1.clusters.0.networks.vsan.gateway",
  "instances.0.domains.1.clusters.0.networks.vsan.mtu",
  "instances.0.domains.1.clusters.0.networks.vsan.pool.end",
  "instances.0.domains.1.clusters.0.networks.vsan.pool.start",
  "instances.0.domains.1.clusters.0.networks.vsan.subnet",
  "instances.0.domains.1.clusters.0.networks.vsan.vlan",
  "instances.0.domains.1.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.1.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.controlPlaneIpRange",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.privateTgwCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.useEsxiMgmtVmk",
  "instances.0.domains.1.clusters.0.supervisorConfig.edgeClusterSize",
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
  "instances.0.domains.1.clusters.0.t0Gateways.0.asnLocal",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.asn",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.bfdEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.ip",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.mtu",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.asn",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.bfdEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.ip",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.mtu",
  "instances.0.domains.1.clusters.0.t0Gateways.0.haMode",
  "instances.0.domains.1.clusters.0.t0Gateways.0.name",
  "instances.0.domains.1.clusters.1.az2HostOverlay.cidr",
  "instances.0.domains.1.clusters.1.az2HostOverlay.gateway",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.az2HostOverlay.mtu",
  "instances.0.domains.1.clusters.1.az2HostOverlay.poolName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.profileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.staticIpPoolType",
  "instances.0.domains.1.clusters.1.az2HostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.vlan",
  "instances.0.domains.1.clusters.1.name",
  "instances.0.domains.1.clusters.1.networks.mgmt.gateway",
  "instances.0.domains.1.clusters.1.networks.mgmt.subnet",
  "instances.0.domains.1.clusters.1.networks.mgmt.vlan",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink1",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink2",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.applyDefaultOperationMode",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipAssignment",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.operationalMode",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.staticIpPoolType",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.teamingPolicy",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneOverlay",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneVlan",
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
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.mode",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.timeout",
  "instances.0.domains.1.clusters.1.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.0.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.mode",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.timeout",
  "instances.0.domains.1.clusters.1.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.1.name",
  "instances.0.domains.1.clusters.1.networks.vmotion.gateway",
  "instances.0.domains.1.clusters.1.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.1.networks.vmotion.pool.end",
  "instances.0.domains.1.clusters.1.networks.vmotion.pool.start",
  "instances.0.domains.1.clusters.1.networks.vmotion.subnet",
  "instances.0.domains.1.clusters.1.networks.vmotion.vlan",
  "instances.0.domains.1.clusters.1.networks.vsan.gateway",
  "instances.0.domains.1.clusters.1.networks.vsan.mtu",
  "instances.0.domains.1.clusters.1.networks.vsan.pool.end",
  "instances.0.domains.1.clusters.1.networks.vsan.pool.start",
  "instances.0.domains.1.clusters.1.networks.vsan.subnet",
  "instances.0.domains.1.clusters.1.networks.vsan.vlan",
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
  "adConfig.ca.algorithm",
  "adConfig.ca.csrSubject.commonName",
  "adConfig.ca.csrSubject.country",
  "adConfig.ca.csrSubject.email",
  "adConfig.ca.csrSubject.locality",
  "adConfig.ca.csrSubject.org",
  "adConfig.ca.csrSubject.ou",
  "adConfig.ca.csrSubject.state",
  "adConfig.ca.keySize",
  "adConfig.ca.password",
  "adConfig.ca.templateName",
  "adConfig.ca.user",
  "adConfig.serviceAccountUser",
  "backupConfig.directory",
  "backupConfig.host",
  "backupConfig.port",
  "backupConfig.protocol",
  "backupConfig.sshFingerprint",
  "backupConfig.user",
  "federationConfig.globalManager.apiThumbprint",
  "federationConfig.globalManager.certificateId",
  "federationConfig.globalManager.clusterId",
  "federationConfig.globalManager.federationName",
  "federationConfig.globalManager.nodes.0.deploySize",
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
  "installerConfig.depotType",
  "installerConfig.downloadToken",
  "installerConfig.offlineDepotHostname",
  "installerConfig.offlineDepotPort",
  "installerConfig.proxyAuthenticated",
  "installerConfig.proxyEnabled",
  "installerConfig.proxyHost",
  "installerConfig.proxyPort",
  "installerConfig.proxyProtocol",
  "installerConfig.proxyUser",
  "instances.0.deploymentProfile",
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
  "instances.0.domains.0.clusters.0.az2HostOverlay.staticIpPoolType",
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
  "instances.0.domains.0.clusters.0.networks.hostTep.gateway",
  "instances.0.domains.0.clusters.0.networks.hostTep.pool.end",
  "instances.0.domains.0.clusters.0.networks.hostTep.pool.start",
  "instances.0.domains.0.clusters.0.networks.hostTep.useDhcp",
  "instances.0.domains.0.clusters.0.networks.hostTep.vlan",
  "instances.0.domains.0.clusters.0.networks.mgmt.gateway",
  "instances.0.domains.0.clusters.0.networks.mgmt.ipv6.gatewayCidr",
  "instances.0.domains.0.clusters.0.networks.mgmt.pool.start",
  "instances.0.domains.0.clusters.0.networks.mgmt.vlan",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.applyDefaultOperationMode",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.mgmtClusterPortgroup.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.mgmtClusterPortgroup.uplink1",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.mgmtClusterPortgroup.uplink2",
  "instances.0.domains.0.clusters.0.networks.nsxHostOverlay.operationalMode",
  "instances.0.domains.0.clusters.0.networks.portgroups.mgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.nfs.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmMgmt.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vmotion.name",
  "instances.0.domains.0.clusters.0.networks.portgroups.vsan.name",
  "instances.0.domains.0.clusters.0.networks.uplinks.0.gateway",
  "instances.0.domains.0.clusters.0.networks.uplinks.1.gateway",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.mode",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.0.lag.timeout",
  "instances.0.domains.0.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.0.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.mode",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.0.clusters.0.networks.vds.1.lag.timeout",
  "instances.0.domains.0.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.0.clusters.0.networks.vds.1.name",
  "instances.0.domains.0.clusters.0.networks.vmotion.gateway",
  "instances.0.domains.0.clusters.0.networks.vmotion.ipv6.rangeEnd",
  "instances.0.domains.0.clusters.0.networks.vmotion.ipv6.rangeStart",
  "instances.0.domains.0.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.0.clusters.0.networks.vmotion.pool.end",
  "instances.0.domains.0.clusters.0.networks.vmotion.pool.start",
  "instances.0.domains.0.clusters.0.networks.vmotion.vlan",
  "instances.0.domains.0.clusters.0.networks.vsan.gateway",
  "instances.0.domains.0.clusters.0.networks.vsan.ipv6.rangeEnd",
  "instances.0.domains.0.clusters.0.networks.vsan.ipv6.rangeStart",
  "instances.0.domains.0.clusters.0.networks.vsan.mtu",
  "instances.0.domains.0.clusters.0.networks.vsan.pool.end",
  "instances.0.domains.0.clusters.0.networks.vsan.pool.start",
  "instances.0.domains.0.clusters.0.networks.vsan.vlan",
  "instances.0.domains.0.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.0.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.0.clusters.0.storage.dataServices.dit.rekeyHoursCustom",
  "instances.0.domains.0.clusters.0.storage.dataServices.dit.rekeyInterval",
  "instances.0.domains.0.clusters.0.storage.dataServices.dit.rekeyMode",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.boundToVmknic",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.0.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.0.clusters.0.storage.principalStorage",
  "instances.0.domains.0.clusters.0.supervisorConfig.apiServerDnsNames",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.0.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.0.clusters.0.supervisorConfig.controlPlaneSize",
  "instances.0.domains.0.clusters.0.supervisorConfig.controlPlaneStoragePolicy",
  "instances.0.domains.0.clusters.0.supervisorConfig.dnsSearchDomains",
  "instances.0.domains.0.clusters.0.supervisorConfig.dnsServers",
  "instances.0.domains.0.clusters.0.supervisorConfig.edgeClusterSize",
  "instances.0.domains.0.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.0.clusters.0.supervisorConfig.ephemeralDisksStoragePolicy",
  "instances.0.domains.0.clusters.0.supervisorConfig.externalIpBlocks",
  "instances.0.domains.0.clusters.0.supervisorConfig.haEnabled",
  "instances.0.domains.0.clusters.0.supervisorConfig.imageCacheStoragePolicy",
  "instances.0.domains.0.clusters.0.supervisorConfig.ipAddresses",
  "instances.0.domains.0.clusters.0.supervisorConfig.ipAssignmentMode",
  "instances.0.domains.0.clusters.0.supervisorConfig.networkingStack",
  "instances.0.domains.0.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.0.clusters.0.supervisorConfig.nsxProject",
  "instances.0.domains.0.clusters.0.supervisorConfig.ntpServers",
  "instances.0.domains.0.clusters.0.supervisorConfig.privateTgwIpBlocks",
  "instances.0.domains.0.clusters.0.supervisorConfig.privateVpcCidrs",
  "instances.0.domains.0.clusters.0.supervisorConfig.serviceCidr",
  "instances.0.domains.0.clusters.0.supervisorConfig.supervisorLocation",
  "instances.0.domains.0.clusters.0.supervisorConfig.supervisorName",
  "instances.0.domains.0.clusters.0.supervisorConfig.vSphereZoneName",
  "instances.0.domains.0.clusters.0.supervisorConfig.version",
  "instances.0.domains.0.clusters.0.supervisorConfig.vpcConnectivityProfile",
  "instances.0.domains.0.clusters.0.supervisorConfig.workloadDnsServers",
  "instances.0.domains.0.clusters.0.supervisorConfig.workloadNtpServers",
  "instances.0.domains.0.clusters.0.t0Gateways.0.asnLocal",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.asn",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.bfdEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.ip",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.0.mtu",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.asn",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.bfdEnabled",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.ip",
  "instances.0.domains.0.clusters.0.t0Gateways.0.bgpPeers.1.mtu",
  "instances.0.domains.0.clusters.0.t0Gateways.0.haMode",
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
  "instances.0.domains.1.clusters.0.networks.mgmt.gateway",
  "instances.0.domains.1.clusters.0.networks.mgmt.vlan",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.activeUplink1",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.activeUplink2",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.applyDefaultOperationMode",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipAssignment",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.operationalMode",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.staticIpPoolType",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.teamingPolicy",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneOverlay",
  "instances.0.domains.1.clusters.0.networks.nsxHostOverlay.transportZoneVlan",
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
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.mode",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.0.lag.timeout",
  "instances.0.domains.1.clusters.0.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.0.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.mode",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.0.networks.vds.1.lag.timeout",
  "instances.0.domains.1.clusters.0.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.0.networks.vds.1.name",
  "instances.0.domains.1.clusters.0.networks.vmotion.gateway",
  "instances.0.domains.1.clusters.0.networks.vmotion.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.0.networks.vmotion.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.0.networks.vmotion.ipv6.rangeStart",
  "instances.0.domains.1.clusters.0.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.0.networks.vmotion.pool.end",
  "instances.0.domains.1.clusters.0.networks.vmotion.pool.start",
  "instances.0.domains.1.clusters.0.networks.vmotion.vlan",
  "instances.0.domains.1.clusters.0.networks.vsan.gateway",
  "instances.0.domains.1.clusters.0.networks.vsan.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.0.networks.vsan.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.0.networks.vsan.ipv6.rangeStart",
  "instances.0.domains.1.clusters.0.networks.vsan.mtu",
  "instances.0.domains.1.clusters.0.networks.vsan.pool.end",
  "instances.0.domains.1.clusters.0.networks.vsan.pool.start",
  "instances.0.domains.1.clusters.0.networks.vsan.vlan",
  "instances.0.domains.1.clusters.0.storage.dataServices.datastoreName",
  "instances.0.domains.1.clusters.0.storage.dataServices.dedupCompressionEnabled",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.enabled",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.rekeyHoursCustom",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.rekeyInterval",
  "instances.0.domains.1.clusters.0.storage.dataServices.dit.rekeyMode",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.serverIp",
  "instances.0.domains.1.clusters.0.storage.dataServices.nfs.sharePath",
  "instances.0.domains.1.clusters.0.supervisorConfig.apiServerDnsNames",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterFqdn",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterName",
  "instances.0.domains.1.clusters.0.supervisorConfig.clusterVip",
  "instances.0.domains.1.clusters.0.supervisorConfig.controlPlaneSize",
  "instances.0.domains.1.clusters.0.supervisorConfig.controlPlaneStoragePolicy",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.controlPlaneIpRange",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.gateway",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.privateTgwCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.subnetMask",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.useEsxiMgmtVmk",
  "instances.0.domains.1.clusters.0.supervisorConfig.deployment.vds",
  "instances.0.domains.1.clusters.0.supervisorConfig.dnsSearchDomains",
  "instances.0.domains.1.clusters.0.supervisorConfig.dnsServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.edgeClusterSize",
  "instances.0.domains.1.clusters.0.supervisorConfig.enabled",
  "instances.0.domains.1.clusters.0.supervisorConfig.ephemeralDisksStoragePolicy",
  "instances.0.domains.1.clusters.0.supervisorConfig.externalIpBlocks",
  "instances.0.domains.1.clusters.0.supervisorConfig.haEnabled",
  "instances.0.domains.1.clusters.0.supervisorConfig.imageCacheStoragePolicy",
  "instances.0.domains.1.clusters.0.supervisorConfig.ipAddresses",
  "instances.0.domains.1.clusters.0.supervisorConfig.ipAssignmentMode",
  "instances.0.domains.1.clusters.0.supervisorConfig.networkingStack",
  "instances.0.domains.1.clusters.0.supervisorConfig.node1Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.node2Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.node3Ip",
  "instances.0.domains.1.clusters.0.supervisorConfig.nsxProject",
  "instances.0.domains.1.clusters.0.supervisorConfig.ntpServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.privateTgwIpBlocks",
  "instances.0.domains.1.clusters.0.supervisorConfig.privateVpcCidrs",
  "instances.0.domains.1.clusters.0.supervisorConfig.serviceCidr",
  "instances.0.domains.1.clusters.0.supervisorConfig.supervisorLocation",
  "instances.0.domains.1.clusters.0.supervisorConfig.supervisorName",
  "instances.0.domains.1.clusters.0.supervisorConfig.vSphereZoneName",
  "instances.0.domains.1.clusters.0.supervisorConfig.version",
  "instances.0.domains.1.clusters.0.supervisorConfig.vpcConnectivityProfile",
  "instances.0.domains.1.clusters.0.supervisorConfig.workloadDnsServers",
  "instances.0.domains.1.clusters.0.supervisorConfig.workloadNtpServers",
  "instances.0.domains.1.clusters.0.t0Gateways.0.asnLocal",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.asn",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.bfdEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.ip",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.0.mtu",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.asn",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.bfdEnabled",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.ip",
  "instances.0.domains.1.clusters.0.t0Gateways.0.bgpPeers.1.mtu",
  "instances.0.domains.1.clusters.0.t0Gateways.0.haMode",
  "instances.0.domains.1.clusters.0.t0Gateways.0.name",
  "instances.0.domains.1.clusters.1.az2HostOverlay.cidr",
  "instances.0.domains.1.clusters.1.az2HostOverlay.gateway",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.az2HostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.az2HostOverlay.mtu",
  "instances.0.domains.1.clusters.1.az2HostOverlay.poolName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.profileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.staticIpPoolType",
  "instances.0.domains.1.clusters.1.az2HostOverlay.uplinkProfileName",
  "instances.0.domains.1.clusters.1.az2HostOverlay.vlan",
  "instances.0.domains.1.clusters.1.name",
  "instances.0.domains.1.clusters.1.networks.edgeTep.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.edgeTep.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.edgeTep.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.hostTep.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.hostTep.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.hostTep.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.mgmt.gateway",
  "instances.0.domains.1.clusters.1.networks.mgmt.subnet",
  "instances.0.domains.1.clusters.1.networks.mgmt.vlan",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink1",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.activeUplink2",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.applyDefaultOperationMode",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.cidr",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.gatewayIp",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.hostOverlayProfileName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipAssignment",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeEnd",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.ipRangeStart",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.numberOfUplinks",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.operationalMode",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolDescription",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.poolName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.staticIpPoolType",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.teamingPolicy",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneName",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneOverlay",
  "instances.0.domains.1.clusters.1.networks.nsxHostOverlay.transportZoneVlan",
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
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.mode",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.0.lag.timeout",
  "instances.0.domains.1.clusters.1.networks.vds.0.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.0.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.loadBalancing",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.mode",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.name",
  "instances.0.domains.1.clusters.1.networks.vds.1.lag.timeout",
  "instances.0.domains.1.clusters.1.networks.vds.1.mtu",
  "instances.0.domains.1.clusters.1.networks.vds.1.name",
  "instances.0.domains.1.clusters.1.networks.vmotion.gateway",
  "instances.0.domains.1.clusters.1.networks.vmotion.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.vmotion.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.vmotion.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.vmotion.mtu",
  "instances.0.domains.1.clusters.1.networks.vmotion.pool.end",
  "instances.0.domains.1.clusters.1.networks.vmotion.pool.start",
  "instances.0.domains.1.clusters.1.networks.vmotion.vlan",
  "instances.0.domains.1.clusters.1.networks.vsan.gateway",
  "instances.0.domains.1.clusters.1.networks.vsan.ipv6.gatewayCidr",
  "instances.0.domains.1.clusters.1.networks.vsan.ipv6.rangeEnd",
  "instances.0.domains.1.clusters.1.networks.vsan.ipv6.rangeStart",
  "instances.0.domains.1.clusters.1.networks.vsan.mtu",
  "instances.0.domains.1.clusters.1.networks.vsan.pool.end",
  "instances.0.domains.1.clusters.1.networks.vsan.pool.start",
  "instances.0.domains.1.clusters.1.networks.vsan.vlan",
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
    const { stamped, sentinels } = stampKitchenSink("9.1");
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

  // Dev aid (skipped): re-capture the CSV survivor matrix after model/cell-map
  // changes. Unskip, run with --reporter=verbose, and paste the logged lists
  // into CSV_MATRIX_90 / CSV_MATRIX_91 above.
  it.skip("PRINT csv survivors", () => {
    for (const v of ["9.0", "9.1"]) {
      // eslint-disable-next-line no-console
      console.log(`--- ${v} (${csvSurvivors(v).survived.length}) ---\n` + csvSurvivors(v).survived.join("\n"));
    }
  });

  // Tracker for KNOWN_CSV_GAPS: these workbook-mapped fields do NOT survive the
  // CSV round-trip today due to a tracked engine bug (see KNOWN_CSV_GAPS note).
  // This asserts they stay broken; if the engine fix lands they start surviving
  // and this flips — the failure message says to move them into CSV_MATRIX_*.
  for (const v of ["9.0", "9.1"]) {
    it(`KNOWN_CSV_GAPS still do not round-trip on ${v} (remove from the list when the engine fix lands)`, () => {
      const { stamped, sentinels } = stampKitchenSink(v);
      const rebuilt = csvRoundTrip(stamped, v);
      const nowFixed = KNOWN_CSV_GAPS.filter((p) => sentinels[p] !== undefined && getPath(rebuilt, p) === sentinels[p]);
      expect(
        nowFixed,
        `${v}: these KNOWN_CSV_GAPS now round-trip — move them into CSV_MATRIX_* and drop from KNOWN_CSV_GAPS:\n${nowFixed.join("\n")}`
      ).toEqual([]);
    });
  }
});

// ─── Meta-guard — every sentinel is classified ────────────────────────────────
//
// For each version v in {9.0, 9.1}, EVERY sentinel path produced by
// stampKitchenSink(v) MUST be in exactly one of:
//   1. CSV_MATRIX_{v}         — verified to survive the CSV round-trip, OR
//   2. KNOWN_CSV_GAPS         — workbook-mapped but a tracked CSV bug; JSON-covered, OR
//   3. NON_WORKBOOK_ALLOWLIST — value-bearing field with no workbook cell by design.
//
// An "orphan" is a sentinel that falls into none of the above.
// The test fails with a descriptive message listing all orphans so they can be
// classified by the developer.
//
// NOTE — null-default boundary: fields whose factory default is null/undefined
// are never stamped by stampSentinels (the walk skips null leaves), so the
// guard cannot flag them as orphans even if they have no workbook cell and no
// allowlist entry. New value-bearing fields that default to null must be
// populated in the kitchen-sink (tests/helpers/kitchen-sink-fleet.js) to fall
// under guard coverage. This is exactly why Task 4 had to explicitly populate
// network/az2/bgp fields — without that population, their paths never appear
// in the sentinels map and the guard silently misses them.
//
describe("round-trip matrix — meta-guard (every field is CSV-mapped, allowlisted, or a known gap)", () => {
  it.each([["9.0", CSV_MATRIX_90], ["9.1", CSV_MATRIX_91]])(
    "no unclassified sentinel fields for version %s",
    (v, matrix) => {
      const { sentinels } = stampKitchenSink(v);
      const csvSet = new Set(matrix);
      const gapsSet = new Set(KNOWN_CSV_GAPS);

      const orphans = Object.keys(sentinels)
        .filter((p) => !csvSet.has(p) && !gapsSet.has(p) && !allowlisted(p, v))
        .sort();

      expect(
        orphans,
        `${orphans.length} field(s) lack CSV-coverage classification. Each is JSON-covered ` +
          `but not CSV-mapped; add to CSV_MATRIX_* (if it should round-trip via workbook), ` +
          `or to NON_WORKBOOK_ALLOWLIST (with a // why:), or KNOWN_CSV_GAPS (if a real cell-map bug):\n` +
          orphans.join("\n")
      ).toEqual([]);
    }
  );

  it("self-test: the guard surfaces an unclassified synthetic path", () => {
    const fake = "instances.0.domains.0.clusters.0.__synthetic__.newUncoveredField";
    const csvSet = new Set(CSV_MATRIX_90);
    const gapsSet = new Set(KNOWN_CSV_GAPS);
    const isOrphan = !csvSet.has(fake) && !gapsSet.has(fake) && !allowlisted(fake, "9.0");
    expect(isOrphan, "meta-guard must classify a never-seen path as an orphan (guard is alive)").toBe(true);
  });
});


