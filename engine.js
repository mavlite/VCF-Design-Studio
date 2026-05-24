// ─────────────────────────────────────────────────────────────────────────────
// VCF Design Studio — engine.js
//
// Pure sizing engine: constants, factories, sizing math, and JSON migration.
// Zero JSX, zero React, zero DOM. Safe to require() in Node for testing.
//
// Runtime: inlined into vcf-design-studio-v5.html as a plain <script> before
// the JSX module, which destructures symbols off window.VcfEngine.
// Tests: require("./engine.js") gives the same symbol table via module.exports.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// APPLIANCE DATABASE — sourced from P&P Workbook Static Reference Tables sheet
// (rows B8–B266) plus VKS Supervisor from techdocs.broadcom.com.
// ─────────────────────────────────────────────────────────────────────────────
// Placement constraints (Plan 2 / VCF-INV-003).
//   - "mgmt-only-greenfield" — appliance VMs must run on mgmt-domain hosts
//     for greenfield/expand/converge. Imported (brownfield) workload domains
//     are exempt because pre-existing VMs may already live on WLD hosts.
//   - "flexible" — placement is a user design decision in any pathway
//     (canonical case: NSX Edge — see VCF-APP-006-SUP-1 / SUP-4).
//   - "wld-only" — appliance is always cluster-internal to a WLD cluster
//     (canonical case: VKS Supervisor).
const PLACEMENT_CONSTRAINTS = {
  MGMT_ONLY_GREENFIELD: "mgmt-only-greenfield",
  FLEXIBLE: "flexible",
  WLD_ONLY: "wld-only",
};

const APPLIANCE_DB = {
  vcenter: {
    ruleId: "VCF-APP-002/003",
    scope: "per-instance-or-per-domain",   // mgmt vcenter: per-instance; workload vcenter: per-domain (runs in mgmt cluster)
    dualRole: true,                         // research splits into vcenter_mgmt / vcenter_wld — discriminator on stack entry
    placement: "per-domain",
    recommendedScope: "mgmt",
    placementConstraint: "mgmt-only-greenfield",  // VCF-INV-003 — wld vCenter VMs run on mgmt hosts
    label: "vCenter Server",
    source: "P&P Workbook — vCenter Appliance CPU/RAM/Disk tables (VCF 9.0)",
    // vCenter is the only appliance with an independent storage-size knob
    // (Default / Large / XLarge) that scales disk without changing compute.
    // Values from VCF 9.0 P&P Workbook — Static Reference Tables, rows 46–60.
    storageProfiles: ["default", "large", "xlarge"],
    defaultStorageProfile: "default",
    sizes: {
      Tiny:   { vcpu: 2,  ram: 14, storage: { default:  579, large: 2019, xlarge: 4279 }, note: "≤10 hosts / 100 VMs" },
      Small:  { vcpu: 4,  ram: 21, storage: { default:  694, large: 2044, xlarge: 4304 }, note: "≤100 hosts / 1k VMs" },
      Medium: { vcpu: 8,  ram: 30, storage: { default:  908, large: 2208, xlarge: 4468 }, note: "≤400 hosts / 4k VMs" },
      Large:  { vcpu: 16, ram: 39, storage: { default: 1358, large: 2258, xlarge: 4518 }, note: "≤1k hosts / 10k VMs" },
      XLarge: { vcpu: 24, ram: 58, storage: { default: 2283, large: 2383, xlarge: 4643 }, note: "≤2k hosts / 35k VMs" },
    },
    // VCF 9.1 P&P Workbook — Static Reference Tables rows 49–63.
    // vCPU and RAM unchanged; storage values reduced across all profiles.
    // Resolver semantics: FULL REPLACEMENT — when fleet.vcfVersion === "9.1",
    // applianceSize() returns from sizesByVersion["9.1"] instead of sizes.
    sizesByVersion: {
      "9.1": {
        Tiny:   { vcpu: 2,  ram: 14, storage: { default:  604, large: 1494, xlarge: 2874 }, note: "≤10 hosts / 100 VMs" },
        Small:  { vcpu: 4,  ram: 21, storage: { default:  694, large: 1519, xlarge: 2899 }, note: "≤100 hosts / 1k VMs" },
        Medium: { vcpu: 8,  ram: 30, storage: { default:  858, large: 1658, xlarge: 3038 }, note: "≤400 hosts / 4k VMs" },
        Large:  { vcpu: 16, ram: 39, storage: { default: 1158, large: 1708, xlarge: 3088 }, note: "≤1k hosts / 10k VMs" },
        XLarge: { vcpu: 24, ram: 58, storage: { default: 1783, large: 1833, xlarge: 3213 }, note: "≤2k hosts / 35k VMs" },
      },
    },
    defaultSize: "Medium",
  },
  nsxMgr: {
    ruleId: "VCF-APP-004/005",
    scope: "per-instance-or-per-domain-shared",  // mgmt NSX: per-instance; workload NSX: per-domain-shared within same instance
    dualRole: true,
    placement: "per-domain",
    recommendedScope: "mgmt",
    placementConstraint: "mgmt-only-greenfield",  // VCF-INV-003 — wld NSX Manager VMs run on mgmt hosts
    label: "NSX Manager",
    source: "P&P Workbook — NSX-T Manager CPU/RAM/Disk tables",
    sizes: {
      ExtraSmall: { vcpu: 2,  ram: 8,  disk: 300, note: "CSM only — not for production" },
      Small:      { vcpu: 4,  ram: 16, disk: 300, note: "Lab/PoC only" },
      Medium:     { vcpu: 6,  ram: 24, disk: 300, note: "Default, ≤128 hosts" },
      Large:      { vcpu: 12, ram: 48, disk: 300, note: "≤1024 hosts" },
      XLarge:     { vcpu: 24, ram: 96, disk: 400, note: "≤2048 hosts" },
    },
    defaultSize: "Medium",
  },
  nsxEdge: {
    ruleId: "VCF-APP-006",
    scope: "per-nsx-manager",
    placement: "per-domain",
    placementConstraint: "flexible",  // VCF-APP-006-SUP-1/4 — Edge VMs may run on mgmt OR wld hosts (user choice)
    label: "NSX Edge",
    source: "P&P Workbook — NSX-T Edge CPU/RAM/Disk tables",
    sizes: {
      Small:  { vcpu: 2,  ram: 4,  disk: 200, note: "Lab/PoC only" },
      Medium: { vcpu: 4,  ram: 8,  disk: 200, note: "Production w/ LB" },
      Large:  { vcpu: 8,  ram: 32, disk: 200, note: "Production w/ LB" },
      XLarge: { vcpu: 16, ram: 64, disk: 200, note: "Largest production" },
    },
    defaultSize: "Large",
  },
  sddcMgr: {
    ruleId: "VCF-APP-001",
    scope: "per-instance",
    placement: "per-instance",
    label: "SDDC Manager",
    source: "P&P Workbook — SDDC Manager fixed values",
    sizes: { Default: { vcpu: 4, ram: 16, disk: 914, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  fleetMgr: {
    ruleId: "VCF-APP-012",
    scope: "per-fleet",                     // corrected per research — one per fleet, on initial instance
    placement: "per-instance",
    label: "VCF Operations Fleet Manager",
    source: "P&P Workbook — VCF Operations Fleet Manager fixed values",
    sizes: { Default: { vcpu: 4, ram: 12, disk: 194, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // VCFMS (VCF Management Service) — new in VCF 9.1. Kubernetes-based
  // fleet-level control plane. Mirrors fleetMgr's scope/placement model:
  // one set per fleet, deployed on the initial instance only. stackForInstance()
  // filters scope:"per-fleet" entries from non-initial instances automatically.
  vcfmsControl: {
    ruleId: "VCF-APP-NEW-91-1",
    scope: "per-fleet",
    placement: "per-instance",
    placementConstraint: "mgmt-only-greenfield",  // matches fleetMgr
    label: "VCF Management Service — Control Node",
    source: "VCF 9.1 P&P Workbook — Static Reference Tables rows 276–290",
    availableInVersions: ["9.1"],
    sizes: {
      Small:   { vcpu: 4, ram: 10, disk: 100, note: "1 control node (Simple deployment)" },
      SmallHA: { vcpu: 4, ram: 10, disk: 100, note: "3 control nodes (HA deployment)" },
      Medium:  { vcpu: 4, ram: 10, disk: 100, note: "3 control nodes (HA, medium worker pool)" },
      Large:   { vcpu: 8, ram: 14, disk: 100, note: "3 control nodes (HA, large worker pool)" },
    },
    defaultSize: "Medium",
  },
  vcfmsWorker: {
    ruleId: "VCF-APP-NEW-91-2",
    scope: "per-fleet",
    placement: "per-instance",
    placementConstraint: "mgmt-only-greenfield",
    label: "VCF Management Service — Worker Node",
    source: "VCF 9.1 P&P Workbook — Static Reference Tables rows 291–306",
    availableInVersions: ["9.1"],
    sizes: {
      Small:  { vcpu: 12, ram: 24, disk: 100, defaultInstances: 3, note: "3-worker pool" },
      Medium: { vcpu: 24, ram: 48, disk: 100, defaultInstances: 3, note: "3-worker pool" },
      Large:  { vcpu: 24, ram: 48, disk: 100, defaultInstances: 4, note: "4-worker pool" },
    },
    defaultSize: "Medium",
  },
  vcls: {
    scope: "cluster-internal",
    placement: "cluster-internal",
    label: "vSphere Cluster Services (vCLS)",
    source: "P&P Workbook — vCLS Virtual Machines fixed values",
    sizes: { Default: { vcpu: 1, ram: 0.125, disk: 2, note: "Per VM (typically 2 per cluster)" } },
    defaultSize: "Default",
    fixed: true,
  },
  vcfOps: {
    ruleId: "VCF-APP-010",
    scope: "per-fleet",                     // corrected per research — initial instance only
    placement: "per-instance",
    label: "VCF Operations",
    source: "P&P Workbook + Broadcom KB 397782",
    sizes: {
      ExtraSmall: { vcpu: 2,  ram: 8,   disk: 274, note: "≤700 objects" },
      Small:      { vcpu: 4,  ram: 16,  disk: 274, note: "≤10k objects" },
      Medium:     { vcpu: 8,  ram: 32,  disk: 274, note: "≤30k objects" },
      Large:      { vcpu: 16, ram: 48,  disk: 274, note: "≤44k objects" },
      ExtraLarge: { vcpu: 24, ram: 128, disk: 274, note: "≤100k objects" },
    },
    defaultSize: "Medium",
  },
  vcfOpsCollector: {
    ruleId: "VCF-APP-011",
    scope: "per-instance",                  // every instance deploys its own Collector
    placement: "per-instance",
    label: "VCF Operations Collector",
    source: "P&P Workbook + KB 397782 — collector inherits node profile",
    sizes: {
      ExtraSmall: { vcpu: 2,  ram: 8,   disk: 274 },
      Small:      { vcpu: 4,  ram: 16,  disk: 274 },
      Medium:     { vcpu: 8,  ram: 32,  disk: 274 },
      Large:      { vcpu: 16, ram: 48,  disk: 274 },
      ExtraLarge: { vcpu: 24, ram: 128, disk: 274 },
    },
    defaultSize: "Medium",
  },
  vcfOpsProxy: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "VCF Operations Unified Cloud Proxy",
    source: "P&P Workbook — VCF Operations Proxy",
    sizes: {
      Small:    { vcpu: 4, ram: 16, disk: 264, note: "≤16k objects" },
      Standard: { vcpu: 8, ram: 48, disk: 264, note: "≤80k objects" },
    },
    defaultSize: "Small",
  },
  vcfAuto: {
    ruleId: "VCF-APP-020",
    scope: "per-fleet",                     // corrected per research — initial instance only
    placement: "per-instance",
    label: "VCF Automation",
    source: "P&P Workbook — VCF Automation CPU/RAM/Disk tables",
    sizes: {
      Small:  { vcpu: 24, ram: 96,  disk: 455 },
      Medium: { vcpu: 24, ram: 96,  disk: 334 },
      Large:  { vcpu: 32, ram: 128, disk: 430 },
    },
    defaultSize: "Small",
  },
  vcfOpsLogs: {
    ruleId: "VCF-APP-013",
    scope: "per-fleet",                     // corrected per research — can be per-instance for compliance isolation, default fleet
    placement: "per-instance",
    label: "VCF Operations for Logs",
    source: "P&P Workbook — vRLI tables",
    sizes: {
      Small:  { vcpu: 4,  ram: 8,  disk: 530, note: "PoC/test only" },
      Medium: { vcpu: 8,  ram: 16, disk: 530, note: "Min for production cluster" },
      Large:  { vcpu: 16, ram: 32, disk: 530, note: "15k EPS / node" },
    },
    defaultSize: "Medium",
  },
  vcfOpsNet: {
    ruleId: "VCF-APP-014",
    scope: "per-fleet",                     // corrected per research — Platform is fleet-wide, one per fleet
    placement: "per-instance",
    label: "VCF Operations for Networks (Platform)",
    source: "P&P Workbook + techdocs VCF 9 system requirements",
    sizes: {
      Small:      { vcpu: 4,  ram: 16,  disk: 1024, note: "Eval only" },
      Medium:     { vcpu: 8,  ram: 32,  disk: 1024, note: "≤4k VMs" },
      Large:      { vcpu: 12, ram: 48,  disk: 1024, note: "≤6k VMs" },
      ExtraLarge: { vcpu: 16, ram: 64,  disk: 1024, note: "≤10k VMs" },
      XXLarge:    { vcpu: 24, ram: 128, disk: 1024, note: "≤15k VMs" },
    },
    defaultSize: "Large",
  },
  vcfOpsNetCollector: {
    ruleId: "VCF-APP-014",
    scope: "per-monitored-scope",           // per workload domain or per VCF instance being monitored
    placement: "per-instance",
    label: "VCF Operations for Networks Collector",
    source: "P&P Workbook — Networks Collector tables",
    sizes: {
      Small:      { vcpu: 2,  ram: 4,  disk: 250 },
      Medium:     { vcpu: 4,  ram: 12, disk: 250 },
      Large:      { vcpu: 8,  ram: 16, disk: 250 },
      ExtraLarge: { vcpu: 8,  ram: 24, disk: 250 },
      XXLarge:    { vcpu: 16, ram: 48, disk: 250 },
    },
    defaultSize: "Large",
  },
  identityBroker: {
    ruleId: "VCF-APP-030",
    scope: "flex",                          // mode-dependent: embedded (per-instance), fleet-wide, or multi-broker per region
    placement: "per-instance",
    label: "VCF Identity Broker (WSA)",
    source: "P&P Workbook — WSA CPU/RAM/Disk tables",
    sizes: {
      ExtraSmall:      { vcpu: 4,  ram: 8,  disk: 100 },
      Small:           { vcpu: 8,  ram: 16, disk: 290 },
      Medium:          { vcpu: 8,  ram: 16, disk: 220 },
      Large:           { vcpu: 10, ram: 16, disk: 100 },
      ExtraLarge:      { vcpu: 12, ram: 32, disk: 100 },
      ExtraExtraLarge: { vcpu: 14, ram: 48, disk: 100 },
    },
    defaultSize: "Medium",
  },
  // Avi Controller — the management plane of NSX Advanced Load Balancer.
  // Always runs in the management domain regardless of which workload domain
  // it serves, per Broadcom docs ("All Avi Controllers are deployed in the
  // management domain, even when the Avi Load Balancer is deployed in a VI
  // workload domain").
  aviController: {
    ruleId: "VCF-APP-050a",
    scope: "per-instance",
    placement: "per-domain",
    recommendedScope: "mgmt",
    placementConstraint: "mgmt-only-greenfield",
    label: "Avi Load Balancer Controller",
    source: "P&P Workbook — AVI Controller VM tables; Broadcom Avi VCF docs",
    sizes: {
      Small:  { vcpu: 6,  ram: 32, disk: 512 },
      Large:  { vcpu: 16, ram: 48, disk: 1400 },
      XLarge: { vcpu: 16, ram: 64, disk: 1750 },
    },
    defaultSize: "Small",
  },
  // Avi Service Engine — the data plane. Deployed in the workload domain
  // it serves (per Broadcom: "Service Engines (SEs) are deployed in the
  // workload domain in which the Avi Load Balancer is providing load
  // balancing services"). Placement-constrained to wld-only.
  aviServiceEngine: {
    ruleId: "VCF-APP-050b",
    scope: "per-domain",
    placement: "per-domain",
    recommendedScope: "wld",
    placementConstraint: "wld-only",
    label: "Avi Load Balancer Service Engine",
    source: "Avi DataSheet / VCF SE deployment guide — typical SE group sizing",
    sizes: {
      Small:  { vcpu: 1, ram: 2, disk: 15, note: "Minimum SE; small environments" },
      Medium: { vcpu: 2, ram: 4, disk: 15, note: "Default production SE" },
      Large:  { vcpu: 4, ram: 8, disk: 15, note: "High throughput / SSL offload" },
    },
    defaultSize: "Small",
  },
  // Legacy alias retained so unmigrated v5/v6 fixtures keep loading. New
  // designs should use aviController + aviServiceEngine. The migrateFleet
  // pass rewrites aviLb entries; this entry exists only for the brief
  // window before migration runs.
  aviLb: {
    ruleId: "VCF-APP-050",
    scope: "per-instance",
    placement: "per-domain",
    recommendedScope: "mgmt",
    placementConstraint: "mgmt-only-greenfield",
    label: "Avi Load Balancer (legacy — migrates to Controller + SE)",
    source: "P&P Workbook — AVI Load Balancer tables (deprecated id; see aviController)",
    sizes: {
      Small:  { vcpu: 6,  ram: 32, disk: 512 },
      Large:  { vcpu: 16, ram: 48, disk: 1400 },
      XLarge: { vcpu: 16, ram: 64, disk: 1750 },
    },
    defaultSize: "Small",
    deprecated: true,
  },
  hcxConnector: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "HCX Connector",
    source: "P&P Workbook — Cross-Cloud Mobility HCX",
    sizes: { Default: { vcpu: 4, ram: 12, disk: 65, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // Security Services Platform — values are aggregate across constituent VMs.
  ssp: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "Security Services Platform (SSP)",
    source: "P&P Workbook — SSP CPU/RAM/Disk (aggregate: installer + controllers + workers)",
    sizes: {
      Medium: { vcpu: 112, ram: 414, disk: 4096, note: "1 SSPI + 3 Ctrl + 5 Workers (9 VMs total)" },
      Large:  { vcpu: 160, ram: 606, disk: 5120, note: "1 SSPI + 3 Ctrl + 8 Workers (12 VMs total)" },
      XLarge: { vcpu: 192, ram: 734, disk: 6656, note: "1 SSPI + 3 Ctrl + 10 Workers (14 VMs total)" },
    },
    defaultSize: "Medium",
  },
  // VKS Supervisor Control Plane — sourced from techdocs.broadcom.com (the
  // workbook has no VKS sizing). The "instances" field models the control
  // plane availability model: Simple = 1 VM, HA = 3 VMs. Both deployment
  // flavors (traditional 3-node and Single Management Zone with NSX VPC) use
  // identical per-VM sizes — the difference is just instance count.
  vksSupervisor: {
    ruleId: "VCF-APP-070",
    scope: "per-cluster",                   // enabled per cluster; runs as cluster-internal VMs
    placement: "cluster-internal",
    placementConstraint: "wld-only",         // cluster-internal; the picker doesn't apply
    label: "VKS Supervisor (Control Plane)",
    source: "techdocs.broadcom.com — VCF 9.0 Change the Control Plane Size of a Supervisor",
    sizes: {
      Tiny:   { vcpu: 2,  ram: 8,  disk: 32, note: "Smallest tier" },
      Small:  { vcpu: 4,  ram: 16, disk: 32, note: "Default" },
      Medium: { vcpu: 8,  ram: 16, disk: 32, note: "Note: same RAM as Small" },
      Large:  { vcpu: 16, ram: 32, disk: 32, note: "Largest tier" },
    },
    defaultSize: "Small",
    info: "VKS Supervisor deploys Simple (1 VM) or HA (3 VMs). Set Inst=1 for Single Management Zone / single-VM. Set Inst=3 for HA control plane (required for 3-zone, recommended for production). Per-VM sizing is identical regardless of deployment flavor — the only difference is VM count and zone topology.",
  },
  // NSX Global Manager — uses same sizing table as Local Manager but tracked
  // separately. Required for NSX Federation (active/active cross-instance).
  nsxGlobalMgr: {
    ruleId: "VCF-APP-040",
    scope: "fleet-wide",                    // only when NSX Federation enabled; active/standby across two instances
    placement: "per-instance",
    label: "NSX Global Manager",
    source: "P&P Workbook — NSX-T Manager tables (GM uses same sizing as LM)",
    sizes: {
      Medium:     { vcpu: 6,  ram: 24, disk: 300, note: "≤128 hosts" },
      Large:      { vcpu: 12, ram: 48, disk: 300, note: "≤1024 hosts" },
      XLarge:     { vcpu: 24, ram: 96, disk: 400, note: "≤2048 hosts" },
    },
    defaultSize: "Large",
  },
  // Site Recovery Manager — for Site Protection & DR validated solution
  srm: {
    ruleId: "VCF-APP-060",
    scope: "per-instance",
    placement: "per-instance",
    label: "Site Recovery Manager (SRM)",
    source: "P&P Workbook — SRM CPU/RAM/Disk tables",
    sizes: {
      Light:    { vcpu: 2, ram: 8,  disk: 20,  note: "Small environments" },
      Standard: { vcpu: 8, ram: 24, disk: 800, note: "Production" },
    },
    defaultSize: "Standard",
  },
  // vSphere Replication Manager Server — paired with SRM for DR
  vrms: {
    ruleId: "VCF-APP-061",
    scope: "per-instance",
    placement: "per-instance",
    label: "vSphere Replication (VRMS)",
    source: "P&P Workbook — VRMS CPU/RAM/Disk tables",
    sizes: {
      Light:    { vcpu: 2, ram: 8, disk: 33, note: "Small environments" },
      Standard: { vcpu: 4, ram: 8, disk: 33, note: "Production" },
    },
    defaultSize: "Standard",
  },
  // Health Reporting and Monitoring VM
  hvm: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "Health Reporting & Monitoring (HVM)",
    source: "P&P Workbook — Health Reporting and Monitoring fixed values",
    sizes: { Default: { vcpu: 2, ram: 8, disk: 20, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // Cloud-Based Ransomware Recovery Connector
  cyberRecoveryConnector: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "Live Cyber Recovery Connector",
    source: "P&P Workbook — Cloud-Based Ransomware Recovery",
    sizes: { Default: { vcpu: 8, ram: 12, disk: 100, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // vSAN Witness Host Appliance — required at a third fault domain for vSAN
  // stretched clusters only. Not needed when using array-based replication.
  // Deploys as a nested ESXi VM. Sizes per techdocs.broadcom.com.
  vsanWitness: {
    ruleId: "VCF-APP-080",
    scope: "per-stretched-cluster",         // one witness per stretched vSAN cluster at a third fault domain
    placement: "site-level",
    label: "vSAN Witness Host Appliance",
    source: "techdocs.broadcom.com — vSAN Witness Host Appliance sizing",
    sizes: {
      Tiny:   { vcpu: 2, ram: 8,  disk: 15,  note: "≤10 hosts, ≤750 components" },
      Medium: { vcpu: 2, ram: 16, disk: 350,  note: "≤21 hosts, ≤22.5k components" },
      Large:  { vcpu: 2, ram: 32, disk: 730,  note: "≤64 hosts, ≤45k components" },
    },
    defaultSize: "Medium",
    info: "Deploys at the witness site (third fault domain), NOT at either data site. One witness per stretched cluster. Resources are consumed at the witness location only.",
  },
};

// Plan 2 — placement helper.
//
// Returns the legal cluster options the UI should expose for a given
// appliance, accounting for the appliance's placementConstraint and
// whether the owning workload domain is imported (brownfield).
//
// Inputs:
//   applianceId         — key into APPLIANCE_DB (e.g. "vcenter", "nsxEdge")
//   { isImportedDomain, mgmtClusters, wldClusters }
//     - mgmtClusters — array of { id, label } for the instance's mgmt clusters
//     - wldClusters  — array of { id, label } for THIS workload domain's clusters
//
// Output: array of { id, label, scope: "mgmt"|"wld" } eligible options.
//
// Rules:
//   - mgmt-only-greenfield: only mgmtClusters returned, unless imported (then both).
//   - flexible:             both groups always returned.
//   - wld-only:             only wldClusters returned (cluster-internal apps).
//   - undefined constraint: legacy behavior — both groups (preserves UX for
//     appliances that haven't been classified yet).
function placementOptionsFor(applianceId, ctx = {}) {
  const def = APPLIANCE_DB[applianceId];
  const mgmt = (ctx.mgmtClusters || []).map((c) => ({ ...c, scope: "mgmt" }));
  const wld = (ctx.wldClusters || []).map((c) => ({ ...c, scope: "wld" }));
  if (!def) return [...mgmt, ...wld];
  switch (def.placementConstraint) {
    case "mgmt-only-greenfield":
      return ctx.isImportedDomain ? [...mgmt, ...wld] : mgmt;
    case "wld-only":
      return wld;
    case "flexible":
    default:
      return [...mgmt, ...wld];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENT PROFILES — instance counts derived from the P&P Workbook formulas.
// Each profile defines the management appliance stack that gets auto-applied
// when the user selects a deployment model at the VCF Instance level. Users
// can still customize after applying a profile.
//
// Source: workbook "Management Domain Sizing" sheet, column J formulas:
//   - NSX Mgr: J11 = IF(H32="Mandatory - Single Node",1,3)
//   - VCF Ops: J20 = IF(Deploy HA → 3, Deploy Simple → 1)
//   - VCF Auto: J22 = IF(Small → 1, Medium → 3, Large → 3)
//   - VCF Logs: J23 = IF(Deploy HA → 3, 1)
//   - VCF Net:  J24 = IF(Deploy HA → 3, 1)
//   - Identity: J26 = IF(Deploy HA → 3, Deploy → 1, Embedded → 0)
//   - Avi LB:   J13 = IF(deployed → 3)
//   - NSX Edge: J12 = IF(deployed → 2)
//   - NSX GM:   J11 += IF(GM deployed → 3)
// ─────────────────────────────────────────────────────────────────────────────
const DEPLOYMENT_PROFILES = {
  simple: {
    label: "Simple (Lab / PoC)",
    description: "Single-node appliances, no redundancy. Per workbook 'Deploy Simple' model. Not for production.",
    stack: [
      { id: "vcenter",         size: "Small",   instances: 1 },
      { id: "nsxMgr",          size: "Medium",  instances: 1 },
      { id: "sddcMgr",         size: "Default", instances: 1 },
      { id: "fleetMgr",        size: "Default", instances: 1 },
      { id: "vcls",            size: "Default", instances: 2 },
      { id: "vcfOps",          size: "Medium",  instances: 1 },
      { id: "vcfOpsCollector", size: "Medium",  instances: 1 },
    ],
    // 9.1 adds VCFMS (mandatory per Broadcom 9.1 guidance, even for simple).
    // Simple: 1 control node (Small, non-HA) + 3-worker pool (Small).
    stackByVersion: {
      "9.1": [
        { id: "vcenter",         size: "Small",   instances: 1 },
        { id: "nsxMgr",          size: "Medium",  instances: 1 },
        { id: "sddcMgr",         size: "Default", instances: 1 },
        { id: "fleetMgr",        size: "Default", instances: 1 },
        { id: "vcls",            size: "Default", instances: 2 },
        { id: "vcfOps",          size: "Medium",  instances: 1 },
        { id: "vcfOpsCollector", size: "Medium",  instances: 1 },
        { id: "vcfmsControl",    size: "Small",   instances: 1 },
        { id: "vcfmsWorker",     size: "Small",   instances: 3 },
      ],
    },
  },
  ha: {
    label: "HA Production",
    description: "Clustered appliances with full redundancy. Per workbook 'Deploy HA' model with NSX HA Cluster, recommended for all production deployments.",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviController",      size: "Small",   instances: 3 },
    ],
    // 9.1 adds VCFMS HA cluster: 3 control nodes (Medium) + 3 workers (Medium).
    stackByVersion: {
      "9.1": [
        { id: "vcenter",            size: "Medium",  instances: 1 },
        { id: "nsxMgr",             size: "Medium",  instances: 3 },
        { id: "nsxEdge",            size: "Large",   instances: 2 },
        { id: "sddcMgr",            size: "Default", instances: 1 },
        { id: "fleetMgr",           size: "Default", instances: 1 },
        { id: "vcls",               size: "Default", instances: 2 },
        { id: "vcfOps",             size: "Medium",  instances: 3 },
        { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
        { id: "vcfAuto",            size: "Small",   instances: 1 },
        { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
        { id: "vcfOpsNet",          size: "Large",   instances: 3 },
        { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
        { id: "identityBroker",     size: "Medium",  instances: 3 },
        { id: "aviController",      size: "Small",   instances: 3 },
        { id: "vcfmsControl",       size: "Medium",  instances: 3 },
        { id: "vcfmsWorker",        size: "Medium",  instances: 3 },
      ],
    },
  },
  haFederation: {
    label: "HA + NSX Federation",
    description: "HA production plus NSX Global Manager (3-node HA cluster) for cross-instance networking. Required when federating NSX across multiple VCF instances (active/active datacenters).",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxGlobalMgr",       size: "Large",   instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviController",      size: "Small",   instances: 3 },
    ],
    stackByVersion: {
      "9.1": [
        { id: "vcenter",            size: "Medium",  instances: 1 },
        { id: "nsxMgr",             size: "Medium",  instances: 3 },
        { id: "nsxGlobalMgr",       size: "Large",   instances: 3 },
        { id: "nsxEdge",            size: "Large",   instances: 2 },
        { id: "sddcMgr",            size: "Default", instances: 1 },
        { id: "fleetMgr",           size: "Default", instances: 1 },
        { id: "vcls",               size: "Default", instances: 2 },
        { id: "vcfOps",             size: "Medium",  instances: 3 },
        { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
        { id: "vcfAuto",            size: "Small",   instances: 1 },
        { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
        { id: "vcfOpsNet",          size: "Large",   instances: 3 },
        { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
        { id: "identityBroker",     size: "Medium",  instances: 3 },
        { id: "aviController",      size: "Small",   instances: 3 },
        { id: "vcfmsControl",       size: "Medium",  instances: 3 },
        { id: "vcfmsWorker",        size: "Medium",  instances: 3 },
      ],
    },
  },
  haSiteProtection: {
    label: "HA + Site Protection (DR)",
    description: "HA production plus VMware Live Recovery (SRM + vSphere Replication) for disaster recovery to a secondary site. Deploy matching profile on recovery site.",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviController",      size: "Small",   instances: 3 },
      { id: "srm",                size: "Standard", instances: 1 },
      { id: "vrms",               size: "Standard", instances: 1 },
    ],
    stackByVersion: {
      "9.1": [
        { id: "vcenter",            size: "Medium",  instances: 1 },
        { id: "nsxMgr",             size: "Medium",  instances: 3 },
        { id: "nsxEdge",            size: "Large",   instances: 2 },
        { id: "sddcMgr",            size: "Default", instances: 1 },
        { id: "fleetMgr",           size: "Default", instances: 1 },
        { id: "vcls",               size: "Default", instances: 2 },
        { id: "vcfOps",             size: "Medium",  instances: 3 },
        { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
        { id: "vcfAuto",            size: "Small",   instances: 1 },
        { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
        { id: "vcfOpsNet",          size: "Large",   instances: 3 },
        { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
        { id: "identityBroker",     size: "Medium",  instances: 3 },
        { id: "aviController",      size: "Small",   instances: 3 },
        { id: "srm",                size: "Standard", instances: 1 },
        { id: "vrms",               size: "Standard", instances: 1 },
        { id: "vcfmsControl",       size: "Medium",  instances: 3 },
        { id: "vcfmsWorker",        size: "Medium",  instances: 3 },
      ],
    },
  },
  haFederationSiteProtection: {
    label: "HA + Federation + Site Protection",
    description: "Full enterprise: HA appliances, NSX Federation for active/active networking across instances, plus VMware Live Recovery for DR. Maximum resilience deployment.",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxGlobalMgr",       size: "Large",   instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviController",      size: "Small",   instances: 3 },
      { id: "srm",                size: "Standard", instances: 1 },
      { id: "vrms",               size: "Standard", instances: 1 },
    ],
    stackByVersion: {
      "9.1": [
        { id: "vcenter",            size: "Medium",  instances: 1 },
        { id: "nsxMgr",             size: "Medium",  instances: 3 },
        { id: "nsxGlobalMgr",       size: "Large",   instances: 3 },
        { id: "nsxEdge",            size: "Large",   instances: 2 },
        { id: "sddcMgr",            size: "Default", instances: 1 },
        { id: "fleetMgr",           size: "Default", instances: 1 },
        { id: "vcls",               size: "Default", instances: 2 },
        { id: "vcfOps",             size: "Medium",  instances: 3 },
        { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
        { id: "vcfAuto",            size: "Small",   instances: 1 },
        { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
        { id: "vcfOpsNet",          size: "Large",   instances: 3 },
        { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
        { id: "identityBroker",     size: "Medium",  instances: 3 },
        { id: "aviController",      size: "Small",   instances: 3 },
        { id: "srm",                size: "Standard", instances: 1 },
        { id: "vrms",               size: "Standard", instances: 1 },
        { id: "vcfmsControl",       size: "Medium",  instances: 3 },
        { id: "vcfmsWorker",        size: "Medium",  instances: 3 },
      ],
    },
  },
};

// Plan 12: DEFAULT_MGMT_STACK_TEMPLATE removed — newMgmtCluster now resolves
// the seed stack at call time via profileStack(DEPLOYMENT_PROFILES.ha, vcfVersion).
// Keeping a frozen module-level template would silently pin new clusters to
// the 9.0 baseline regardless of fleet.vcfVersion.

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL-INSTANCE HELPERS — per VCF-DEPLOYMENT-PATTERNS.md §3 (VCF-INV-011),
// fleet.instances[0] is the "initial" instance that carries per-fleet
// appliances (VCF Operations, VCF Automation, Fleet Mgr, Logs, Networks
// Platform). Other instances in a multi-instance fleet carry only their
// per-instance appliances plus a Collector.
// ─────────────────────────────────────────────────────────────────────────────
function getInitialInstance(fleet) {
  return (fleet?.instances && fleet.instances[0]) || null;
}

function isInitialInstance(fleet, instance) {
  const initial = getInitialInstance(fleet);
  return !!initial && instance && initial.id === instance.id;
}

// Read `.hostSplitPct` from a stretched-domain-like object, defaulting to 50
// (even split) when unset or non-numeric. Pre-v5 data sometimes omits this
// field on local domains that were later promoted to stretched.
function getHostSplitPct(x) {
  return typeof x?.hostSplitPct === "number" ? x.hostSplitPct : 50;
}

// Return the mgmt-stack entries appropriate for `instance` given its profile.
// Initial instance gets the full profile stack; subsequent instances drop any
// appliance whose APPLIANCE_DB entry has scope === "per-fleet".
// Plan 12: routes through profileStack() so 9.1-extended stacks (VCFMS) flow
// here too. Defaults to legacy 9.0 when vcfVersion is omitted.
function stackForInstance(profileKey, isInitial, vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  const profile = DEPLOYMENT_PROFILES[profileKey];
  if (!profile) return [];
  const base = profileStack(profile, vcfVersion);
  if (isInitial) return base.slice();
  return base.filter((e) => APPLIANCE_DB[e.id]?.scope !== "per-fleet");
}

// Reorder instances so the given id becomes fleet.instances[0] (the new
// initial). Also re-stacks the mgmt domain's initial cluster on BOTH the
// new initial and the demoted old-initial per VCF-INV-011 so per-fleet
// appliances (vcfOps, vcfAuto, fleetMgr, vcfOpsLogs, vcfOpsNet) move with
// the initial flag. Preserves user customization that doesn't conflict with
// per-fleet scope rules.
// Returns a new fleet object (immutable contract).
function promoteToInitial(fleet, instanceId) {
  if (!fleet?.instances?.length) return fleet;
  const idx = fleet.instances.findIndex((i) => i.id === instanceId);
  if (idx <= 0) return fleet;  // already initial, or not found

  const next = fleet.instances.slice();
  const [promoted] = next.splice(idx, 1);
  next.unshift(promoted);

  // Re-stack the old initial (now at index idx) and the new initial (index 0).
  // Only rewrites the mgmt domain's first cluster's infraStack; other
  // clusters and domains are untouched.
  // Plan 12: thread fleet.vcfVersion through so re-stamping picks up the
  // version-appropriate stack (e.g., includes VCFMS on 9.1 fleets).
  const vcfVersion = fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
  const rewriteMgmtStack = (inst, isInitial) => {
    const profileKey = inst.deploymentProfile;
    if (!profileKey || !DEPLOYMENT_PROFILES[profileKey]) return inst;
    const nextStack = stackForInstance(profileKey, isInitial, vcfVersion).map((e) => ({
      ...e,
      key: localId(),
    }));
    return {
      ...inst,
      domains: (inst.domains || []).map((d, di) => {
        if (d.type !== "mgmt") return d;
        return {
          ...d,
          clusters: (d.clusters || []).map((c, ci) => (
            di === inst.domains.findIndex((x) => x.type === "mgmt") && ci === 0
              ? { ...c, infraStack: nextStack }
              : c
          )),
        };
      }),
    };
  };

  return {
    ...fleet,
    instances: next.map((inst, i) => {
      if (i === 0) return rewriteMgmtStack(inst, true);
      if (i === idx) return rewriteMgmtStack(inst, false);
      return inst;
    }),
  };
}

// Infer deployment pathway for a legacy fleet (v5 export that predates the
// pathway field). Single-instance fleets are always greenfield; multi-
// instance fleets are inferred as expand-fleet. Users can override in the UI.
function inferDeploymentPathway(fleet) {
  if (fleet?.deploymentPathway) return fleet.deploymentPathway;
  const n = fleet?.instances?.length || 0;
  return n > 1 ? "expand" : "greenfield";
}

// Infer federation intent from legacy fleets that predate the explicit
// federationEnabled flag. Any instance using an "haFederation*" profile
// signals federation. Callers in the UI / tests should prefer
// fleet.federationEnabled when present; this helper is only the migration
// default.
function inferFederationEnabled(fleet) {
  if (typeof fleet?.federationEnabled === "boolean") return fleet.federationEnabled;
  const anyFederationProfile = (fleet?.instances || []).some((i) =>
    (i?.deploymentProfile || "").toLowerCase().includes("federation")
  );
  return anyFederationProfile;
}

// Edge cluster deployment models per VCF-APP-006 research doc §2. These are
// NSX Edge cluster topology options independent of T0 HA mode. Purely
// informational at the design studio level — sizing doesn't change — but
// the model drives DC layout and survivability expectations.
const EDGE_DEPLOYMENT_MODELS = {
  host_fault_tolerant: {
    ruleId: "VCF-APP-006-EDGE-HFT",
    label: "Host Fault-Tolerant",
    description: "Single AZ. Edge VMs survive a host failure via vSphere HA.",
  },
  rack_fault_tolerant: {
    ruleId: "VCF-APP-006-EDGE-RFT",
    label: "Rack Fault-Tolerant",
    description: "Multi-rack within a single AZ. Higher N-S throughput; tolerates rack-level failures.",
  },
  az_fault_tolerant_edge_ha: {
    ruleId: "VCF-APP-006-EDGE-AZ-EHA",
    label: "AZ FT — Edge HA",
    description: "Dual-AZ with NSX Edge Node HA (fast failover). Requires paired Edge nodes across AZs.",
  },
  az_fault_tolerant_vsphere_ha: {
    ruleId: "VCF-APP-006-EDGE-AZ-VHA",
    label: "AZ FT — vSphere HA",
    description: "Dual-AZ with vSphere HA. Requires VIRTUAL Edge form factor; bare-metal is NOT supported.",
  },
};

// T0 gateway constants per VCF-APP-006 and VCF-INV-060..065.
const T0_HA_MODES = {
  "active-standby": {
    ruleId: "VCF-APP-006-T0-AS",
    label: "Active/Standby",
    maxEdgeNodes: 2,               // VCF-INV-060
    bgpDefault: false,
    description: "Elected active + standby Edge nodes. Required for VCF Automation All Apps and vSphere Supervisor (VKS).",
    requiredFor: ["vcfAutomationAllApps", "vks"],
  },
  "active-active": {
    ruleId: "VCF-APP-006-T0-AA",
    label: "Active/Active",
    maxEdgeNodes: 8,               // VCF-INV-060
    bgpDefault: true,
    description: "Up to 8 Edge transport nodes. Stateless N-S by default; stateful services require even node count forming sub-cluster pairs (Day-2 NSX Manager UI).",
    requiredFor: [],
  },
};
const T0_MAX_T0S_PER_EDGE_NODE = 1;  // VCF-INV-061
const T0_MAX_UPLINKS_PER_EDGE_AA = 2; // VCF-INV-065 — per research §2 VCF-APP-006

function newT0Gateway(name = "t0-prod") {
  return {
    id: "t0-" + localId(),
    name,
    haMode: "active-standby",       // safest default, unlocks VKS + Auto All-Apps
    // Stack-entry keys (not appliance ids) of the nsxEdge entries that host
    // this T0's Edge nodes. Kept as keys so moving an Edge entry around in
    // the stack doesn't break the binding.
    edgeNodeKeys: [],
    // Uplinks per edge node for this T0. Array is parallel to edgeNodeKeys;
    // entry i is the uplink count on edgeNodeKeys[i]. Capped at
    // T0_MAX_UPLINKS_PER_EDGE_AA (2) for A/A per VCF-INV-065. Default 1
    // uplink each when not specified.
    uplinksPerEdge: [],
    stateful: false,                // Only meaningful when haMode === "active-active"
    bgpEnabled: false,              // Users toggle; default differs by haMode
    asnLocal: null,
    bgpPeers: [],
    featureRequirements: [],        // e.g. ["vks", "vcfAutomationAllApps"]
  };
}

function createFleetNetworkConfig() {
  return {
    dns: { servers: [], searchDomains: [], primaryDomain: "" },
    ntp: { servers: [], timezone: "UTC" },
    syslog: { servers: [] },
    rootCaBundle: null,
  };
}

function createClusterNetworks() {
  return {
    nicProfileId: "4-nic",
    vds: NIC_PROFILES["4-nic"].vds.map(function(v) { return { name: v.name, uplinks: v.uplinks.slice(), mtu: v.mtu }; }),
    mgmt:    { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null } },
    vmotion: { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_VMOTION },
    vsan:    { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_VSAN },
    hostTep: { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_TEP_RECOMMENDED, useDhcp: false },
    edgeTep: { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_TEP_RECOMMENDED },
    uplinks: [],
  };
}

function createHostIpOverride(hostIndex) {
  return {
    hostIndex: hostIndex,
    mgmtIp: null,
    vmotionIp: null,
    vsanIp: null,
    hostTepIps: null,
    bmcIp: null,
    // Plan 7 — explicit hostname override. Null = resolve from
    // fleet.namingConfig.hostTemplate at IP allocation time.
    hostname: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7 — NAMING CONVENTIONS
//
// Token-based templates for host and vDS names. Templates live at fleet
// level with optional cluster overrides. Hostnames render virtually each
// time allocateClusterIps runs (no storage except per-host overrides).
// vDS names are stored on the cluster (cluster.networks.vds[i].name) so
// users can hand-edit; "Re-apply naming template" regenerates them.
// ─────────────────────────────────────────────────────────────────────────────

// Plan 8 — Report metadata for the cover page of the PDF export. Persists
// alongside the rest of the fleet so the values round-trip through Export
// JSON / Import JSON. All fields default to empty strings; the user opts
// in via the "Report Metadata" section in Fleet Summary. `documentDate`
// uses ISO YYYY-MM-DD format; an empty string means "use today's date at
// PDF generation time" (resolved by the print view, not the engine, so
// re-prints with no explicit date stay current).
function createFleetReportMetadata() {
  return {
    clientName: "",     // e.g. "Acme Corp"
    projectId: "",      // e.g. "VCF-2026-Q2"
    preparedBy: "",     // e.g. "J. Smith, Solutions Architect"
    revision: "",       // e.g. "Draft 2", "v1.0"
    documentDate: "",   // ISO YYYY-MM-DD; empty = print-time today
  };
}

// Theme 1a/1b — VCF Installer / depot / proxy configuration.
//
// Describes how the VCF Installer reaches the Broadcom depot (or an offline
// mirror) and what activation material is needed at deploy time. Fleet-level
// because the installer is a single appliance per fleet that bootstraps the
// initial instance. Workbook export lands in Deploy Mgmt L9–L20 (theme 1b).
//
// Schema mirrors the actual Deploy Management Domain rows in the pristine
// workbook (verified against test-fixtures/workbook/workbook-cell-meta-*).
// `Protocol` (L14/L15) and `Authenticated` (L17/L18) belong to the PROXY
// section in the workbook, NOT to depot auth — depot credentials live in
// `downloadToken` (Online: Broadcom-issued token) or are implicit (Offline:
// the depot mirror handles its own auth).
//
//   depotType            — "online" (default; pulls from depot.broadcom.com)
//                          or "offline" (on-prem mirror reachable on the
//                          installer's mgmt network).
//   offlineDepotHostname — hostname/FQDN of the offline mirror. Workbook
//                          row L10; only meaningful when depotType=offline.
//   offlineDepotPort     — TCP port of the offline mirror (default 443).
//                          Workbook row L11.
//   downloadToken        — Broadcom-issued credential. Workbook labels:
//                          "Download Token" (9.0), "Download Service ID"
//                          (9.1). User-supplied, not generated; stays in
//                          the cell-map as a plain string (no passwordKind).
//   activationCode       — VCF 9.1 activation key issued by Broadcom.
//                          Workbook row L13 (9.1 only). User-supplied.
//   proxyEnabled         — false (default). When true, the installer routes
//                          depot traffic through the configured HTTP/S proxy.
//   proxyProtocol        — "https" (default) or "http". This is the PROXY
//                          scheme — the depot scheme is fixed by Broadcom.
//   proxyHost            — proxy FQDN or IP.
//   proxyPort            — proxy TCP port (default 443).
//   proxyAuthenticated   — false (default). When true, the installer sends
//                          Basic-auth credentials to the proxy.
//   proxyUser / proxyPassword — proxy credentials. proxyPassword routes
//                          through PASSWORD_POLICY ("proxy") so the vault
//                          can generate / capture it.
function createFleetInstallerConfig() {
  return {
    depotType: "online",
    offlineDepotHostname: "",
    offlineDepotPort: 443,
    downloadToken: "",
    activationCode: "",
    proxyEnabled: false,
    proxyProtocol: "https",
    proxyHost: "",
    proxyPort: 443,
    proxyAuthenticated: false,
    proxyUser: "",
    proxyPassword: "",
  };
}

// Default fleet-level naming config. Empty templates preserve today's
// behavior — exports emit `hostname: null` and existing vDS names stay
// untouched until the user opts in by setting a template.
function createFleetNamingConfig() {
  return {
    hostTemplate: "",
    vdsTemplate: "",
    prefix: "",
    postfix: "",
    separator: "-",
    seqStart: 1,
    seqPadding: 2,
  };
}

// Default cluster-level override. All fields null = inherit from fleet.
function createClusterNaming() {
  return {
    hostTemplate: null,
    vdsTemplate: null,
    prefix: null,
    postfix: null,
  };
}

// Slug rules: lowercase, replace whitespace + underscore with separator,
// strip non-[a-z0-9-], collapse separator runs, trim edges, cap length.
// Defensive against null/undefined input — returns empty string.
function slugify(s, separator, maxLen) {
  separator = separator || "-";
  maxLen = maxLen || 32;
  if (s == null) return "";
  var raw = String(s).toLowerCase();
  // Whitespace + underscore → separator (whitespace covers Unicode spaces)
  raw = raw.replace(/[\s_]+/g, separator);
  // Strip everything that isn't [a-z0-9] or the separator itself
  var sepEsc = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  raw = raw.replace(new RegExp("[^a-z0-9" + sepEsc + "]+", "g"), "");
  // Collapse runs of separator
  raw = raw.replace(new RegExp(sepEsc + "+", "g"), separator);
  // Trim leading/trailing separators
  raw = raw.replace(new RegExp("^" + sepEsc + "+|" + sepEsc + "+$", "g"), "");
  if (raw.length > maxLen) raw = raw.slice(0, maxLen).replace(new RegExp(sepEsc + "+$"), "");
  return raw;
}

// Resolve a token template against a context map. Tokens look like
// `{name}` or `{name:NN}` (zero-padded numeric). Unknown tokens render as
// empty string. After substitution, runs of the separator are collapsed
// and leading/trailing separators trimmed so empty tokens don't leave
// double-dashes.
function resolveTemplate(template, tokens, separator) {
  if (!template) return "";
  separator = separator || "-";
  var out = String(template).replace(/\{([a-zA-Z]+)(?::(\d+))?\}/g, function(_, key, pad) {
    var v = tokens[key];
    if (v == null) return "";
    if (pad && typeof v === "number") {
      return String(v).padStart(parseInt(pad, 10), "0");
    }
    return String(v);
  });
  // Collapse runs of separator and trim ONLY when the postfix doesn't
  // start with a non-separator character (avoid eating a legitimate "."
  // that prefixes an FQDN suffix). Cheap heuristic: collapse internal
  // separators but never strip leading/trailing dots.
  var sepEsc = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(sepEsc + sepEsc + "+", "g"), separator);
  // Trim leading separator only (FQDN suffix may legitimately end in ".tld")
  out = out.replace(new RegExp("^" + sepEsc + "+"), "");
  return out;
}

// Merge cluster-level naming overrides on top of fleet-level config.
// Cluster fields with null/undefined fall through to the fleet's value.
function mergeNamingConfig(fleetCfg, clusterCfg) {
  var f = fleetCfg || createFleetNamingConfig();
  var c = clusterCfg || {};
  return {
    hostTemplate: c.hostTemplate != null ? c.hostTemplate : f.hostTemplate,
    vdsTemplate:  c.vdsTemplate  != null ? c.vdsTemplate  : f.vdsTemplate,
    prefix:       c.prefix       != null ? c.prefix       : f.prefix,
    postfix:      c.postfix      != null ? c.postfix      : f.postfix,
    separator:    f.separator || "-",
    seqStart:     typeof f.seqStart === "number" ? f.seqStart : 1,
    seqPadding:   typeof f.seqPadding === "number" ? f.seqPadding : 2,
  };
}

// Build the token map for a host. Site / instance / cluster slugs are
// resolved against the live fleet structure; missing context renders as
// an empty token.
function hostTokensFor(fleet, instance, domain, cluster, hostIndex, cfg) {
  var sep = cfg.separator;
  var siteId = (domain && domain.localSiteId)
    || (domain && Array.isArray(domain.stretchSiteIds) && domain.stretchSiteIds[0])
    || (instance && instance.siteIds && instance.siteIds[0])
    || null;
  var site = (fleet && fleet.sites || []).find(function(s) { return s.id === siteId; });
  return {
    prefix: cfg.prefix || "",
    postfix: cfg.postfix || "",
    site: slugify(site && site.name, sep),
    instance: slugify(instance && instance.name, sep),
    cluster: slugify(cluster && cluster.name, sep),
    domain: domain && domain.type === "mgmt" ? "mgmt" : "wld",
    role:   domain && domain.type === "mgmt" ? "mgmt" : "wld",
    seq: cfg.seqStart + hostIndex,
  };
}

// Build the token map for a vDS slot. `purpose` derives from the slot's
// portgroup mapping in NIC_PROFILES — for a vDS that hosts mgmt + vmotion
// portgroups, the canonical purpose is "mgmt-vmotion".
function vdsTokensFor(fleet, instance, domain, cluster, vdsSlot, cfg) {
  var sep = cfg.separator;
  return {
    prefix: cfg.prefix || "",
    postfix: cfg.postfix || "",
    site: slugify(((fleet && fleet.sites || []).find(function(s) {
      return s.id === ((domain && domain.localSiteId)
        || (domain && Array.isArray(domain.stretchSiteIds) && domain.stretchSiteIds[0])
        || (instance && instance.siteIds && instance.siteIds[0]) || null);
    }) || {}).name, sep),
    instance: slugify(instance && instance.name, sep),
    cluster: slugify(cluster && cluster.name, sep),
    domain: domain && domain.type === "mgmt" ? "mgmt" : "wld",
    role:   domain && domain.type === "mgmt" ? "mgmt" : "wld",
    purpose: vdsSlot && vdsSlot.purpose ? vdsSlot.purpose : "",
  };
}

// Resolve the hostname for one host in a cluster. Returns null when no
// template is set and no per-host override exists (preserves today's
// "no hostname" export behavior).
function resolveHostname(fleet, instance, domain, cluster, hostIndex) {
  var ovs = (cluster && cluster.hostOverrides) || [];
  var ov = ovs.find(function(o) { return o.hostIndex === hostIndex; });
  if (ov && ov.hostname) return ov.hostname;
  var cfg = mergeNamingConfig(fleet && fleet.namingConfig, cluster && cluster.naming);
  if (!cfg.hostTemplate) return null;
  var tokens = hostTokensFor(fleet, instance, domain, cluster, hostIndex, cfg);
  return resolveTemplate(cfg.hostTemplate, tokens, cfg.separator);
}

// Resolve the canonical "purpose" string for a vDS slot by inspecting
// the cluster's NIC profile portgroup mapping. Returns the dash-joined
// list of portgroup keys whose vDS this slot is — e.g. mgmt+vmotion
// share one vDS → "mgmt-vmotion". Falls back to the slot index.
function vdsSlotPurpose(cluster, vdsName) {
  var nets = cluster && cluster.networks;
  if (!nets) return "";
  var profile = NIC_PROFILES[nets.nicProfileId];
  if (!profile || !profile.portgroups) return slugify(vdsName);
  // Find the profile slot that today maps to this vDS name. Profile vds
  // names are deterministic per profile; cluster-stored names may differ
  // (user override). Match by slot index when names diverge.
  var profileSlotIdx = -1;
  for (var i = 0; i < profile.vds.length; i++) {
    if (profile.vds[i].name === vdsName) { profileSlotIdx = i; break; }
  }
  if (profileSlotIdx === -1) {
    var clusterSlotIdx = (nets.vds || []).findIndex(function(v) { return v.name === vdsName; });
    if (clusterSlotIdx === -1) return slugify(vdsName);
    profileSlotIdx = clusterSlotIdx;
  }
  var profileVdsName = profile.vds[profileSlotIdx] && profile.vds[profileSlotIdx].name;
  // Collect portgroup keys mapped to this profile slot's vDS, lowercased
  // so the resolved {purpose} token survives DNS-label validation.
  var purposes = [];
  for (var key in profile.portgroups) {
    if (profile.portgroups[key] === profileVdsName) purposes.push(key.toLowerCase());
  }
  return purposes.length > 0 ? purposes.join("-") : slugify(profileVdsName);
}

function resolveVdsName(fleet, instance, domain, cluster, vdsIndex) {
  var nets = cluster && cluster.networks;
  if (!nets || !Array.isArray(nets.vds) || !nets.vds[vdsIndex]) return null;
  var slot = nets.vds[vdsIndex];
  var cfg = mergeNamingConfig(fleet && fleet.namingConfig, cluster && cluster.naming);
  if (!cfg.vdsTemplate) return null;
  var tokens = vdsTokensFor(fleet, instance, domain, cluster, {
    purpose: vdsSlotPurpose(cluster, slot.name),
  }, cfg);
  return resolveTemplate(cfg.vdsTemplate, tokens, cfg.separator);
}

// Apply the vDS template to a cluster, returning a new cluster object
// with networks.vds[].name regenerated. User-edited names that differ
// from the prior template output are preserved iff `preserveCustom` is
// truthy. UI exposes this as a "Re-apply naming template" action.
function applyVdsTemplate(fleet, instance, domain, cluster, opts) {
  opts = opts || {};
  var nets = cluster && cluster.networks;
  if (!nets || !Array.isArray(nets.vds)) return cluster;
  var cfg = mergeNamingConfig(fleet && fleet.namingConfig, cluster && cluster.naming);
  if (!cfg.vdsTemplate) return cluster;
  var profile = NIC_PROFILES[nets.nicProfileId];
  var nextVds = nets.vds.map(function(slot, i) {
    var profileSlotName = profile && profile.vds[i] && profile.vds[i].name;
    if (opts.preserveCustom && profileSlotName && slot.name !== profileSlotName) {
      // User hand-edited away from the profile default — keep it.
      return slot;
    }
    var resolved = resolveVdsName(fleet, instance, domain, cluster, i);
    return resolved ? Object.assign({}, slot, { name: resolved }) : slot;
  });
  return Object.assign({}, cluster, {
    networks: Object.assign({}, nets, { vds: nextVds }),
  });
}

function ipToInt(ip) {
  var parts = ip.split(".");
  return ((parseInt(parts[0], 10) << 24) | (parseInt(parts[1], 10) << 16) | (parseInt(parts[2], 10) << 8) | parseInt(parts[3], 10)) >>> 0;
}

function intToIp(num) {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join(".");
}

function ipPoolSize(start, end) {
  if (!start || !end) return 0;
  return ipToInt(end) - ipToInt(start) + 1;
}

function subnetContainsIp(subnet, ip) {
  if (!subnet || !ip) return false;
  var parts = subnet.split("/");
  var netIp = ipToInt(parts[0]);
  var bits = parseInt(parts[1], 10);
  var mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (netIp & mask);
}

// Plan 7 — `ctx` (optional) carries `{ fleet, instance, domain }` so the
// allocator can resolve hostnames from the naming template. When ctx is
// omitted, every emitted host has `hostname: null` (preserves the
// pre-Plan-7 export shape used by tests that haven't migrated yet).
function allocateClusterIps(cluster, finalHosts, ctx) {
  var nets = cluster.networks;
  if (!nets) return { hosts: [], edgeNodes: [], warnings: [] };

  var warnings = [];
  var overrideMap = {};
  (cluster.hostOverrides || []).forEach(function(o) { overrideMap[o.hostIndex] = o; });

  var overrideIps = {};
  (cluster.hostOverrides || []).forEach(function(o) {
    if (o.mgmtIp) overrideIps[o.mgmtIp] = true;
    if (o.vmotionIp) overrideIps[o.vmotionIp] = true;
    if (o.vsanIp) overrideIps[o.vsanIp] = true;
    if (o.bmcIp) overrideIps[o.bmcIp] = true;
    if (o.hostTepIps) o.hostTepIps.forEach(function(ip) { overrideIps[ip] = true; });
  });

  function nextFromPool(pool, count, networkName) {
    if (!pool || !pool.start || !pool.end) {
      if (count > 0) warnings.push({ severity: "error", ruleId: "VCF-IP-002", message: networkName + " pool not defined but " + count + " IPs needed" });
      return [];
    }
    var start = ipToInt(pool.start);
    var end = ipToInt(pool.end);
    var allocated = [];
    var cursor = start;
    while (allocated.length < count && cursor <= end) {
      var candidate = intToIp(cursor);
      if (!overrideIps[candidate]) {
        allocated.push(candidate);
      }
      cursor++;
    }
    if (allocated.length < count) {
      warnings.push({ severity: "error", ruleId: "VCF-IP-002", message: networkName + " pool exhausted: needed " + count + ", got " + allocated.length });
    }
    return allocated;
  }

  var mgmtPool = nextFromPool(nets.mgmt && nets.mgmt.pool, finalHosts, "mgmt");
  var vmotionPool = nextFromPool(nets.vmotion && nets.vmotion.pool, finalHosts, "vmotion");
  var vsanPool = nextFromPool(nets.vsan && nets.vsan.pool, finalHosts, "vsan");

  var tepCount = finalHosts * 2;
  var tepPool = [];
  if (nets.hostTep && nets.hostTep.useDhcp) {
    warnings.push({ severity: "info", ruleId: "VCF-IP-019", message: "Host TEP uses DHCP — skipping static allocation" });
  } else {
    tepPool = nextFromPool(nets.hostTep && nets.hostTep.pool, tepCount, "hostTep");
  }

  var poolHostIdx = 0;
  var hosts = [];
  for (var i = 0; i < finalHosts; i++) {
    var ov = overrideMap[i];
    var tepPair = nets.hostTep && nets.hostTep.useDhcp ? null : [tepPool[i * 2] || null, tepPool[i * 2 + 1] || null];
    var hostname = null;
    if (ctx && ctx.fleet) {
      hostname = resolveHostname(ctx.fleet, ctx.instance, ctx.domain, cluster, i);
    } else if (ov && ov.hostname) {
      hostname = ov.hostname;
    }
    hosts.push({
      index: i,
      hostname: hostname,
      mgmtIp: (ov && ov.mgmtIp) || mgmtPool[poolHostIdx] || null,
      vmotionIp: (ov && ov.vmotionIp) || vmotionPool[poolHostIdx] || null,
      vsanIp: (ov && ov.vsanIp) || vsanPool[poolHostIdx] || null,
      hostTepIps: (ov && ov.hostTepIps) || tepPair,
      bmcIp: (ov && ov.bmcIp) || null,
      source: ov ? "override" : "pool",
    });
    if (!ov) poolHostIdx++;
  }

  var edgeNodes = [];
  var edgeTepPool = nextFromPool(nets.edgeTep && nets.edgeTep.pool, (cluster.t0Gateways || []).reduce(function(n, t0) { return n + (t0.edgeNodeKeys || []).length; }, 0) * 2, "edgeTep");
  var edgeTepIdx = 0;
  (cluster.t0Gateways || []).forEach(function(t0) {
    (t0.edgeNodeKeys || []).forEach(function(key, ei) {
      edgeNodes.push({
        t0Id: t0.id,
        edgeNodeKey: key,
        edgeTepIps: [edgeTepPool[edgeTepIdx] || null, edgeTepPool[edgeTepIdx + 1] || null],
      });
      edgeTepIdx += 2;
    });
  });

  return { hosts: hosts, edgeNodes: edgeNodes, warnings: warnings };
}

// Plan 7 — DNS label rules. Each label between dots must:
//   - be 1..63 chars
//   - contain only [a-z0-9-]
//   - not start or end with a hyphen
// Total FQDN length must be <= 253 chars.
var NAMING_DNS_LABEL_MAX = 63;
var NAMING_DNS_FQDN_MAX = 253;
var NAMING_DNS_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateHostnameFormat(name) {
  if (!name) return null;
  if (name.length > NAMING_DNS_FQDN_MAX) {
    return "exceeds " + NAMING_DNS_FQDN_MAX + "-char FQDN limit (got " + name.length + ")";
  }
  var labels = name.split(".");
  for (var i = 0; i < labels.length; i++) {
    var lbl = labels[i];
    if (lbl.length === 0) {
      // Trailing dot is OK (rooted FQDN); empty label elsewhere is not.
      if (i === labels.length - 1) continue;
      return "empty label at position " + i;
    }
    if (lbl.length > NAMING_DNS_LABEL_MAX) {
      return "label \"" + lbl + "\" exceeds " + NAMING_DNS_LABEL_MAX + " chars";
    }
    if (!NAMING_DNS_LABEL_RE.test(lbl)) {
      return "label \"" + lbl + "\" has invalid chars (allowed: a-z 0-9 -, no leading/trailing hyphen)";
    }
  }
  return null;
}

// Plan 7 — naming validators (VCF-NAMING-001 uniqueness, VCF-NAMING-002 format).
// Walks every cluster, resolves hostnames for its actual host count (from
// fleetResult when provided, else cluster.hostOverrides only), and checks
// uniqueness across the entire fleet plus per-name format compliance.
function validateNamingDesign(fleet, fleetResult) {
  var issues = [];
  var seen = {};

  function clusterFinalHosts(instanceIdx, domainIdx, clusterIdx, clusterFallback) {
    var ir = fleetResult && fleetResult.instanceResults && fleetResult.instanceResults[instanceIdx];
    var dr = ir && ir.domainResults && ir.domainResults[domainIdx];
    var cr = dr && dr.clusterResults && dr.clusterResults[clusterIdx];
    if (cr && typeof cr.finalHosts === "number") return cr.finalHosts;
    // Fallback: validate at least the explicit per-host overrides we can see.
    return ((clusterFallback && clusterFallback.hostOverrides) || []).length;
  }

  (fleet.instances || []).forEach(function(inst, instIdx) {
    (inst.domains || []).forEach(function(dom, domIdx) {
      (dom.clusters || []).forEach(function(cl, clIdx) {
        var path = inst.name + " / " + dom.name + " / " + cl.name;
        var n = clusterFinalHosts(instIdx, domIdx, clIdx, cl);
        for (var i = 0; i < n; i++) {
          var name = resolveHostname(fleet, inst, dom, cl, i);
          if (!name) continue;
          // VCF-NAMING-002 — format/length
          var formatErr = validateHostnameFormat(name);
          if (formatErr) {
            issues.push({
              ruleId: "VCF-NAMING-002",
              severity: "error",
              message: path + ": host " + i + " hostname \"" + name + "\" is invalid — " + formatErr,
            });
          }
          // VCF-NAMING-001 — uniqueness
          if (seen[name]) {
            issues.push({
              ruleId: "VCF-NAMING-001",
              severity: "error",
              message: "Hostname \"" + name + "\" collides: " + seen[name] + " vs " + path + " host " + i,
            });
          } else {
            seen[name] = path + " host " + i;
          }
        }
      });
    });
  });

  return issues;
}

function validateNetworkDesign(fleet, fleetResult) {
  var issues = [];

  // ─── Fleet-level checks ───────────────────────────────────────────────────
  var nc = fleet.networkConfig;
  if (!nc || !nc.dns || !nc.dns.servers || nc.dns.servers.length === 0) {
    issues.push({ ruleId: "VCF-NET-010", severity: "error", message: "Fleet DNS servers not configured" });
  }
  if (!nc || !nc.ntp || !nc.ntp.servers || nc.ntp.servers.length === 0) {
    issues.push({ ruleId: "VCF-NET-011", severity: "error", message: "Fleet NTP servers not configured" });
  }

  // ─── Collect all cluster mgmt subnets for cross-cluster check ───────
  var allMgmtSubnets = [];

  (fleet.instances || []).forEach(function(inst) {
    (inst.domains || []).forEach(function(dom) {
      (dom.clusters || []).forEach(function(cl) {
        var nets = cl.networks;
        if (!nets) return;
        var clusterPath = inst.name + " / " + dom.name + " / " + cl.name;

        // VCF-IP-001 — distinct VLANs within cluster
        var vlans = {};
        var vlanFields = [
          { key: "mgmt", net: nets.mgmt },
          { key: "vmotion", net: nets.vmotion },
          { key: "vsan", net: nets.vsan },
          { key: "hostTep", net: nets.hostTep },
          { key: "edgeTep", net: nets.edgeTep },
        ];
        vlanFields.forEach(function(f) {
          if (f.net && f.net.vlan != null) {
            if (vlans[f.net.vlan]) {
              issues.push({ ruleId: "VCF-IP-001", severity: "error", message: clusterPath + ": " + f.key + " VLAN " + f.net.vlan + " duplicates " + vlans[f.net.vlan] });
            } else {
              vlans[f.net.vlan] = f.key;
            }
          }
        });

        // VCF-IP-003 — pool range within subnet
        // VCF-IP-004 — pool start ≤ pool end
        var poolNetworks = [
          { key: "mgmt", net: nets.mgmt },
          { key: "vmotion", net: nets.vmotion },
          { key: "vsan", net: nets.vsan },
          { key: "hostTep", net: nets.hostTep },
          { key: "edgeTep", net: nets.edgeTep },
        ];
        poolNetworks.forEach(function(f) {
          if (f.net && f.net.pool && f.net.pool.start && f.net.pool.end) {
            if (ipToInt(f.net.pool.start) > ipToInt(f.net.pool.end)) {
              issues.push({ ruleId: "VCF-IP-004", severity: "error", message: clusterPath + ": " + f.key + " pool start > end" });
            }
            if (f.net.subnet) {
              if (!subnetContainsIp(f.net.subnet, f.net.pool.start)) {
                issues.push({ ruleId: "VCF-IP-003", severity: "error", message: clusterPath + ": " + f.key + " pool start outside subnet " + f.net.subnet });
              }
              if (!subnetContainsIp(f.net.subnet, f.net.pool.end)) {
                issues.push({ ruleId: "VCF-IP-003", severity: "error", message: clusterPath + ": " + f.key + " pool end outside subnet " + f.net.subnet });
              }
            }
          }
        });

        // VCF-IP-005 — subnets within same cluster must not overlap
        var subnets = [];
        poolNetworks.forEach(function(f) {
          if (f.net && f.net.subnet) subnets.push({ key: f.key, subnet: f.net.subnet });
        });
        for (var si = 0; si < subnets.length; si++) {
          for (var sj = si + 1; sj < subnets.length; sj++) {
            var a = subnets[si], b = subnets[sj];
            if (a.subnet === b.subnet) {
              issues.push({ ruleId: "VCF-IP-005", severity: "error", message: clusterPath + ": " + a.key + " and " + b.key + " share subnet " + a.subnet });
            }
          }
        }

        // VCF-IP-007 — host overrides must be in subnet
        (cl.hostOverrides || []).forEach(function(ov) {
          if (ov.mgmtIp && nets.mgmt && nets.mgmt.subnet && !subnetContainsIp(nets.mgmt.subnet, ov.mgmtIp)) {
            issues.push({ ruleId: "VCF-IP-007", severity: "error", message: clusterPath + ": host " + ov.hostIndex + " mgmt override " + ov.mgmtIp + " outside subnet " + nets.mgmt.subnet });
          }
          if (ov.vmotionIp && nets.vmotion && nets.vmotion.subnet && !subnetContainsIp(nets.vmotion.subnet, ov.vmotionIp)) {
            issues.push({ ruleId: "VCF-IP-007", severity: "error", message: clusterPath + ": host " + ov.hostIndex + " vmotion override " + ov.vmotionIp + " outside subnet " + nets.vmotion.subnet });
          }
          if (ov.vsanIp && nets.vsan && nets.vsan.subnet && !subnetContainsIp(nets.vsan.subnet, ov.vsanIp)) {
            issues.push({ ruleId: "VCF-IP-007", severity: "error", message: clusterPath + ": host " + ov.hostIndex + " vsan override " + ov.vsanIp + " outside subnet " + nets.vsan.subnet });
          }
        });

        // VCF-HW-NET-020 — MTU checks
        if (nets.hostTep && nets.hostTep.mtu != null && nets.hostTep.mtu < MTU_TEP_MIN) {
          issues.push({ ruleId: "VCF-HW-NET-020", severity: "error", message: clusterPath + ": host TEP MTU " + nets.hostTep.mtu + " below minimum " + MTU_TEP_MIN });
        }
        if (nets.vmotion && nets.vmotion.mtu != null && nets.vmotion.mtu < MTU_VMOTION) {
          issues.push({ ruleId: "VCF-HW-NET-020", severity: "warn", message: clusterPath + ": vMotion MTU " + nets.vmotion.mtu + " below recommended " + MTU_VMOTION });
        }
        if (nets.vsan && nets.vsan.mtu != null && nets.vsan.mtu < MTU_VSAN) {
          issues.push({ ruleId: "VCF-HW-NET-020", severity: "warn", message: clusterPath + ": vSAN MTU " + nets.vsan.mtu + " below recommended " + MTU_VSAN });
        }

        // VCF-HW-NET-022 — T0 edge uplink VLAN must match cluster uplinks
        var uplinkVlans = {};
        (nets.uplinks || []).forEach(function(u) { if (u.vlan != null) uplinkVlans[u.vlan] = true; });
        (cl.t0Gateways || []).forEach(function(t0) {
          (t0.bgpPeers || []).forEach(function(peer) {
            if (peer.ip && nets.uplinks && nets.uplinks.length > 0) {
              var inAny = nets.uplinks.some(function(u) { return u.subnet && subnetContainsIp(u.subnet, peer.ip); });
              if (!inAny) {
                issues.push({ ruleId: "VCF-NET-030", severity: "error", message: clusterPath + ": BGP peer " + peer.ip + " not in any uplink subnet" });
              }
            }
            if (peer.asn != null && t0.asnLocal != null && peer.asn === t0.asnLocal) {
              issues.push({ ruleId: "VCF-NET-031", severity: "warn", message: clusterPath + ": BGP peer ASN " + peer.asn + " equals local ASN (iBGP?) on T0 " + t0.name });
            }
          });
        });

        // Collect mgmt subnets for cross-cluster check
        if (nets.mgmt && nets.mgmt.subnet) {
          allMgmtSubnets.push({ subnet: nets.mgmt.subnet, path: clusterPath });
        }
      });
    });
  });

  // VCF-IP-006 — cross-cluster mgmt subnet reuse (warn)
  for (var mi = 0; mi < allMgmtSubnets.length; mi++) {
    for (var mj = mi + 1; mj < allMgmtSubnets.length; mj++) {
      if (allMgmtSubnets[mi].subnet === allMgmtSubnets[mj].subnet) {
        issues.push({ ruleId: "VCF-IP-006", severity: "warn", message: "Mgmt subnet " + allMgmtSubnets[mi].subnet + " reused: " + allMgmtSubnets[mi].path + " and " + allMgmtSubnets[mj].path });
      }
    }
  }

  // VCF-NAMING-001/002 — hostname uniqueness + format. Skipped silently
  // when no template is configured AND no per-host overrides exist (the
  // resolved hostnames are all null in that case).
  validateNamingDesign(fleet, fleetResult).forEach(function(iss) { issues.push(iss); });

  return issues;
}

function emitInstallerJson(fleet, fleetResult) {
  var nc = fleet.networkConfig || {};
  var dns = nc.dns || {};
  var ntp = nc.ntp || {};

  var networkSpecs = [];
  var hostSpecs = [];
  var edgeSpecs = [];

  (fleet.instances || []).forEach(function(inst, instIdx) {
    (inst.domains || []).forEach(function(dom, domIdx) {
      (dom.clusters || []).forEach(function(cl, clIdx) {
        var nets = cl.networks;
        if (!nets) return;

        var instResult = fleetResult.instanceResults[instIdx];
        var domResult = instResult && instResult.domainResults[domIdx];
        var clResult = domResult && domResult.clusterResults[clIdx];
        var finalHosts = clResult ? clResult.finalHosts : 0;

        if (nets.mgmt && nets.mgmt.vlan != null) {
          networkSpecs.push({ type: "mgmt", vlanId: nets.mgmt.vlan, subnet: nets.mgmt.subnet, defaultGateway: nets.mgmt.gateway, mtu: nets.mgmt.mtu || 1500, cluster: cl.name });
        }
        if (nets.vmotion && nets.vmotion.vlan != null) {
          networkSpecs.push({ type: "vmotion", vlanId: nets.vmotion.vlan, subnet: nets.vmotion.subnet, mtu: nets.vmotion.mtu || 9000, cluster: cl.name });
        }
        if (nets.vsan && nets.vsan.vlan != null) {
          networkSpecs.push({ type: "vsan", vlanId: nets.vsan.vlan, subnet: nets.vsan.subnet, mtu: nets.vsan.mtu || 9000, cluster: cl.name });
        }
        if (nets.hostTep && nets.hostTep.vlan != null) {
          networkSpecs.push({
            type: "hostTep", vlanId: nets.hostTep.vlan, subnet: nets.hostTep.subnet,
            gateway: nets.hostTep.gateway, mtu: nets.hostTep.mtu || 1700,
            ipPool: nets.hostTep.pool, useDhcp: !!nets.hostTep.useDhcp, cluster: cl.name,
          });
        }
        if (nets.edgeTep && nets.edgeTep.vlan != null) {
          networkSpecs.push({ type: "edgeTep", vlanId: nets.edgeTep.vlan, subnet: nets.edgeTep.subnet, mtu: nets.edgeTep.mtu || 1700, ipPool: nets.edgeTep.pool, cluster: cl.name });
        }

        var ipPlan = allocateClusterIps(cl, finalHosts, { fleet: fleet, instance: inst, domain: dom });
        ipPlan.hosts.forEach(function(h) {
          hostSpecs.push({
            cluster: cl.name,
            hostIndex: h.index,
            // Plan 7 — `hostname` resolved from naming template (or null when
            // no template is set). VCF Installer expects this at the top
            // level of each host spec.
            hostname: h.hostname,
            ipAddress: { mgmtIp: h.mgmtIp, vmotionIp: h.vmotionIp, vsanIp: h.vsanIp, hostTepIps: h.hostTepIps },
            bmcConfig: { ipAddress: h.bmcIp },
          });
        });

        ipPlan.edgeNodes.forEach(function(en) {
          edgeSpecs.push({ cluster: cl.name, edgeNodeKey: en.edgeNodeKey, t0Id: en.t0Id, tepIpConfig: en.edgeTepIps });
        });
      });
    });
  });

  return {
    dnsSpec: { primaryDomain: dns.primaryDomain || "", dnsServers: dns.servers || [], searchDomains: dns.searchDomains || [] },
    ntpServers: ntp.servers || [],
    syslogSpec: { servers: (nc.syslog && nc.syslog.servers) || [] },
    networkSpecs: networkSpecs,
    hostSpecs: hostSpecs,
    edgeSpecs: edgeSpecs,
  };
}

// ─── WORKBOOK CELL-MAP EMITTER ──────────────────────────────────────────────
// Produces a cell-addressable CSV that targets the official VCF P&P Workbook
// for either 9.0 or 9.1 (selected by fleet.vcfVersion). The cell-map is the
// single source of truth; `emitWorkbookCellMap` walks the fleet per the
// scope iteration semantics defined in _iterateScope below.
//
// Output is an array of { workbookVersion, sheet, cell, label, value } rows.
// The values are always strings (numbers serialized via String()). The
// stamp script (scripts/stamp-workbook.py) writes these into a pristine
// .xlsx via openpyxl.

// Scope iteration: walks the fleet and produces one (context) per scope value.
// Each context carries the fleet plus whatever ancestor objects make sense
// for that scope. The cell-map's resolve() reads from this context.
function _iterateScope(fleet, scope) {
  const out = [];
  const instances = fleet.instances || [];
  const initial = getInitialInstance(fleet);

  function eachMgmtDomain(inst, cb) {
    for (const dom of inst.domains || []) {
      if (dom.type === "mgmt") cb(dom);
    }
  }
  function eachWorkloadDomain(inst, cb) {
    for (const dom of inst.domains || []) {
      if (dom.type === "workload") cb(dom);
    }
  }

  switch (scope) {
    case "per-fleet":
      out.push({ fleet });
      break;
    case "instance":
      for (const inst of instances) out.push({ fleet, instance: inst });
      break;
    case "initial-instance-mgmt-cluster":
      if (initial) {
        eachMgmtDomain(initial, (dom) => {
          const cluster = (dom.clusters || [])[0];
          if (cluster) out.push({ fleet, instance: initial, domain: dom, cluster });
        });
      }
      break;
    case "mgmt-domain":
      for (const inst of instances) eachMgmtDomain(inst, (dom) => out.push({ fleet, instance: inst, domain: dom }));
      break;
    case "mgmt-cluster":
      for (const inst of instances) {
        eachMgmtDomain(inst, (dom) => {
          for (const cluster of dom.clusters || []) out.push({ fleet, instance: inst, domain: dom, cluster });
        });
      }
      break;
    case "mgmt-cluster-host":
      for (const inst of instances) {
        eachMgmtDomain(inst, (dom) => {
          for (const cluster of dom.clusters || []) {
            out.push({ fleet, instance: inst, domain: dom, cluster, hostScope: true });
          }
        });
      }
      break;
    case "workload-domain":
      for (const inst of instances) eachWorkloadDomain(inst, (dom) => out.push({ fleet, instance: inst, domain: dom }));
      break;
    case "workload-cluster":
      for (const inst of instances) {
        eachWorkloadDomain(inst, (dom) => {
          const cluster = (dom.clusters || [])[0];
          if (cluster) out.push({ fleet, instance: inst, domain: dom, cluster });
        });
      }
      break;
    case "workload-cluster-host":
      for (const inst of instances) {
        eachWorkloadDomain(inst, (dom) => {
          const cluster = (dom.clusters || [])[0];
          if (cluster) out.push({ fleet, instance: inst, domain: dom, cluster, hostScope: true });
        });
      }
      break;
    case "additional-cluster":
      for (const inst of instances) {
        eachWorkloadDomain(inst, (dom) => {
          const extras = (dom.clusters || []).slice(1);
          for (const cluster of extras) out.push({ fleet, instance: inst, domain: dom, cluster });
        });
      }
      break;
    case "additional-cluster-host":
      for (const inst of instances) {
        eachWorkloadDomain(inst, (dom) => {
          const extras = (dom.clusters || []).slice(1);
          for (const cluster of extras) out.push({ fleet, instance: inst, domain: dom, cluster, hostScope: true });
        });
      }
      break;
    default:
      // Unknown scope — no contexts. Caller decides whether to error.
      break;
  }
  return out;
}

// Resolve the cell address for a given entry at a given workbook version.
// Supports `cellByVersion` overrides and `cellPattern` (e.g. "L{82+i}") with
// `expandsTo` per-iteration expansion.
function _resolveCellAddress(entry, version, i) {
  // Prefer version-specific cellPattern, then version-specific cell, then
  // fall back to base cellPattern / cell.
  const pattern = (entry.cellPatternByVersion && entry.cellPatternByVersion[version]) || entry.cellPattern;
  if (pattern) {
    return pattern
      .replace(/\{(\d+)\+i\}/g, (_, base) => String(parseInt(base, 10) + i))
      .replace(/\{i\}/g, String(i));
  }
  let cell = (entry.cellByVersion && entry.cellByVersion[version]) || entry.cell;
  if (typeof cell === "string" && /\{i\}/.test(cell)) {
    cell = cell.replace(/\{i\}/g, String(i));
  }
  return cell;
}

// Resolve a label string for the CSV's `label` column, expanding {i+N} tokens.
function _resolveLabel(entry, i) {
  let label = entry.label || "";
  label = label.replace(/\{i\+(\d+)\}/g, (_, n) => String(i + parseInt(n, 10)));
  label = label.replace(/\{i\}/g, String(i));
  return label;
}

// Determine the per-iteration expansion count for `expandsTo` entries.
// May be a number or a function(ctx) that returns the count (for context-
// sensitive expansion like "all hosts of this cluster").
function _resolveExpansion(entry, ctx) {
  if (entry.expandsTo == null) return [0]; // single iteration with i=0
  const n = typeof entry.expandsTo === "function" ? entry.expandsTo(ctx) : entry.expandsTo;
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

// emitWorkbookCellMap — produces { workbookVersion, sheet, cell, label,
// value } rows for the given fleet at fleet.vcfVersion's matching workbook.
// `options.workbookVersion` overrides the default version-routing.
function emitWorkbookCellMap(fleet, fleetResult, options) {
  if (!fleet) return [];
  options = options || {};
  const version = options.workbookVersion || workbookVersionForFleet(fleet);

  const rows = [];
  for (const entry of WORKBOOK_CELL_MAP) {
    if (!entry.workbookVersions || !entry.workbookVersions.includes(version)) continue;
    // Password cells never flow through the normal export — they only
    // emit via generateWorkbookVault → emitWorkbookXlsxWithPasswords.
    // Skip them here so the cell-map CSV / default .xlsx export stays
    // credential-free.
    if (entry.passwordKind) continue;
    const contexts = _iterateScope(fleet, entry.scope);
    for (const ctx of contexts) {
      const expansion = _resolveExpansion(entry, ctx);
      for (const i of expansion) {
        const cell = _resolveCellAddress(entry, version, i);
        if (!cell) continue;
        let value;
        try {
          value = entry.resolve(fleet, ctx, i);
        } catch (err) {
          value = "";
        }
        if (value === null || value === undefined) value = "";
        rows.push({
          workbookVersion: version,
          sheet: entry.sheet,
          cell,
          label: _resolveLabel(entry, i),
          value: String(value),
        });
      }
    }
  }
  return rows;
}

// CSV serialization with RFC-4180 quoting (commas, quotes, newlines).
function _csvEscape(s) {
  s = String(s == null ? "" : s);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function emitWorkbookCellMapCsv(fleet, fleetResult, options) {
  const rows = emitWorkbookCellMap(fleet, fleetResult, options);
  const header = ["workbookVersion", "sheet", "cell", "label", "value"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map((k) => _csvEscape(r[k])).join(","));
  }
  return lines.join("\n") + "\n";
}

// ─── NATIVE .xlsx EMITTER ──────────────────────────────────────────────────
// Resolves SheetJS in both environments — window.XLSX in the browser
// (inlined by build-html.mjs) and `require("xlsx")` in Node for tests.
function _resolveXLSX() {
  if (typeof window !== "undefined" && window.XLSX) return window.XLSX;
  if (typeof globalThis !== "undefined" && globalThis.XLSX) return globalThis.XLSX;
  if (typeof require === "function") {
    try { return require("xlsx"); } catch (_) { /* fall through */ }
  }
  throw new Error(
    "emitWorkbookXlsx: SheetJS (XLSX) is not available. " +
    "In the browser, ensure the HTML was rebuilt via `npm run build-html`. " +
    "In Node tests, ensure `xlsx` is installed as a devDependency."
  );
}

// detectWorkbookVersion — reads Sheet2!J16 (the canonical version cell;
// both 9.0 and 9.1 carry a literal "9.x.y.z" string there). Returns the
// detected workbook version ("9.0" / "9.1") or null when ambiguous.
//
// Used by the .xlsx export flow to refuse a pristine workbook that doesn't
// match `fleet.vcfVersion` — prevents stamping a 9.1 cell-map's L67/L181/etc
// into a 9.0 workbook (where those cells have different semantics).
function detectWorkbookVersion(xlsxArrayBufferOrWorkbook) {
  const XLSX = _resolveXLSX();
  let wb = xlsxArrayBufferOrWorkbook;
  // If caller passed an ArrayBuffer / Uint8Array, parse it; otherwise assume
  // it's already a SheetJS workbook object.
  if (wb && (wb instanceof ArrayBuffer || ArrayBuffer.isView(wb))) {
    const data = wb instanceof ArrayBuffer ? new Uint8Array(wb) : wb;
    wb = XLSX.read(data, { type: "array", cellFormula: true });
  } else if (typeof wb === "object" && wb && wb.SheetNames) {
    // already a parsed workbook
  } else {
    return null;
  }
  // Sheet2 is the second physical sheet in the workbook (positional, not by
  // name — that sheet has no canonical name in either version).
  const sheetName = wb.SheetNames && wb.SheetNames[1];
  if (!sheetName) return null;
  const sheet = wb.Sheets[sheetName];
  const cell = sheet && sheet["J16"];
  const raw = cell && (cell.v != null ? String(cell.v) : "");
  if (!raw) return null;
  // "9.0.2.0" → "9.0"; "9.1.0.0" → "9.1".
  const m = raw.match(/^(9\.\d)\b/);
  return m ? m[1] : null;
}

// emitWorkbookXlsx — stamp the cell-map values into a copy of the pristine
// VCF Planning & Preparation workbook and return the result as a Blob
// (browser) or ArrayBuffer (Node).
//
// pristineWorkbookInput must be either:
//   - an ArrayBuffer / Uint8Array containing the raw .xlsx bytes
//   - a SheetJS workbook object already parsed by XLSX.read
//
// Returns:
//   - In the browser: a Blob with type
//     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//   - In Node: a Uint8Array (the .xlsx file bytes)
//
// The stamper refuses if the pristine workbook's detected version
// (Sheet2!J16) does not match the cell-map's target version. This guards
// against the silent-corruption failure mode where 9.1 cell addresses get
// written into a 9.0 workbook.
function emitWorkbookXlsx(fleet, fleetResult, pristineWorkbookInput, options) {
  if (!fleet) throw new Error("emitWorkbookXlsx: fleet is required");
  if (!pristineWorkbookInput) {
    throw new Error("emitWorkbookXlsx: pristineWorkbookInput is required (drop the official VCF P&P Workbook)");
  }
  options = options || {};
  const XLSX = _resolveXLSX();
  const targetVersion = options.workbookVersion || workbookVersionForFleet(fleet);

  // Parse pristine workbook (or accept already-parsed input).
  let wb = pristineWorkbookInput;
  if (wb instanceof ArrayBuffer || ArrayBuffer.isView(wb)) {
    const data = wb instanceof ArrayBuffer ? new Uint8Array(wb) : wb;
    wb = XLSX.read(data, { type: "array", cellFormula: true });
  }
  if (!wb || !wb.SheetNames) {
    throw new Error("emitWorkbookXlsx: unable to parse pristine workbook input");
  }

  // Version check (skippable via options.skipVersionCheck for fixture tests
  // where the synthetic .xlsx has no Sheet2!J16).
  if (!options.skipVersionCheck) {
    const detected = detectWorkbookVersion(wb);
    if (detected && detected !== targetVersion) {
      throw new Error(
        `emitWorkbookXlsx: workbook version mismatch — pristine workbook is ${detected} but fleet targets ${targetVersion}. ` +
        `Drop the correct VCF ${targetVersion} Planning & Preparation Workbook.`
      );
    }
  }

  const rows = emitWorkbookCellMap(fleet, fleetResult, { workbookVersion: targetVersion });
  let stamped = 0;
  const skipped = [];
  for (const row of rows) {
    const sheet = wb.Sheets[row.sheet];
    if (!sheet) {
      skipped.push({ row, reason: `sheet "${row.sheet}" not present in workbook` });
      continue;
    }
    const existing = sheet[row.cell];
    // Refuse to overwrite formula cells — the verify-cell-map gate should
    // catch this at authoring time, but defense-in-depth: if a pristine
    // workbook update introduces a formula at our target, fail loudly
    // rather than silently destroying Broadcom's wiring.
    if (existing && existing.f) {
      skipped.push({ row, reason: `cell ${row.cell} carries a formula — refusing to overwrite` });
      continue;
    }
    // Pick the cell type. Numeric strings stamp as numbers when the
    // target cell was numeric in the pristine; otherwise stamp as string.
    const value = row.value == null ? "" : String(row.value);
    const looksNumeric = value !== "" && !isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value);
    if (looksNumeric && existing && existing.t === "n") {
      sheet[row.cell] = { t: "n", v: Number(value) };
    } else {
      sheet[row.cell] = { t: "s", v: value };
    }
    // Extend the sheet's !ref bounding-box if we wrote past it. SheetJS
    // doesn't auto-expand !ref on direct cell assignment; if we stamp a
    // cell address outside the current ref, Excel may not render it.
    // The pristine workbooks already cover the full range we touch, so
    // this is a defensive no-op in practice.
    stamped++;
  }

  if (options.onProgress) options.onProgress({ stamped, skipped });

  // Serialize. type:"array" returns ArrayBuffer in browser-like envs and
  // Uint8Array in Node — both are Blob-compatible.
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  if (typeof Blob !== "undefined" && typeof window !== "undefined") {
    return new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
  return buf;
}

// emitWorkbookXlsxWithPasswords — same contract as emitWorkbookXlsx but
// ALSO stamps generated passwords into the workbook's password cells AND
// returns the vault data the caller will hand to the user as a second
// download.
//
// Flow (single-parse, no Blob round-trip):
//   1. Parse the pristine workbook ONCE via SheetJS.
//   2. Detect / validate workbook version (Sheet2!J16 must match
//      `targetVersion`) unless options.skipVersionCheck.
//   3. Stamp every non-password cell (same value sequence as
//      emitWorkbookXlsx — auto-generate toggles emit "Selected",
//      formula cells are refused, numeric cells preserved as numeric).
//   4. Generate the password vault via generateWorkbookVault, stamp
//      each password into its cell. Formula cells refused (defense in
//      depth).
//   5. Serialize the workbook once and return { xlsx, vault, stamped }.
//
// Returns:
//   { xlsx: Blob (browser) | Uint8Array (Node), vault: VaultJson,
//     stamped: { cells: number, passwords: number, skipped: array } }
//
// The studio retains no copy of the passwords beyond the call return.
function emitWorkbookXlsxWithPasswords(fleet, fleetResult, pristineWorkbookInput, options) {
  if (!fleet) throw new Error("emitWorkbookXlsxWithPasswords: fleet is required");
  if (!pristineWorkbookInput) {
    throw new Error("emitWorkbookXlsxWithPasswords: pristineWorkbookInput is required");
  }
  options = options || {};
  const XLSX = _resolveXLSX();
  const targetVersion = options.workbookVersion || workbookVersionForFleet(fleet);
  const scope = options.scope || "all";

  // Parse pristine workbook (or accept already-parsed input — same
  // shape contract as emitWorkbookXlsx).
  let wb = pristineWorkbookInput;
  if (wb instanceof ArrayBuffer || ArrayBuffer.isView(wb)) {
    const data = wb instanceof ArrayBuffer ? new Uint8Array(wb) : wb;
    wb = XLSX.read(data, { type: "array", cellFormula: true });
  }
  if (!wb || !wb.SheetNames) {
    throw new Error("emitWorkbookXlsxWithPasswords: unable to parse pristine workbook input");
  }

  if (!options.skipVersionCheck) {
    const detected = detectWorkbookVersion(wb);
    if (detected && detected !== targetVersion) {
      throw new Error(
        `emitWorkbookXlsxWithPasswords: workbook version mismatch — pristine is ${detected} but fleet targets ${targetVersion}.`
      );
    }
  }

  const skipped = [];

  // Stamp non-password cells — same logic as emitWorkbookXlsx inlined
  // here so we don't round-trip through bytes.
  const cellRows = emitWorkbookCellMap(fleet, fleetResult, { workbookVersion: targetVersion });
  let cellsStamped = 0;
  for (const row of cellRows) {
    const sheet = wb.Sheets[row.sheet];
    if (!sheet) { skipped.push({ stage: "cells", row, reason: `sheet "${row.sheet}" not present` }); continue; }
    const existing = sheet[row.cell];
    if (existing && existing.f) { skipped.push({ stage: "cells", row, reason: `cell ${row.cell} carries a formula` }); continue; }
    const value = row.value == null ? "" : String(row.value);
    const looksNumeric = value !== "" && !isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value);
    if (looksNumeric && existing && existing.t === "n") {
      sheet[row.cell] = { t: "n", v: Number(value) };
    } else {
      sheet[row.cell] = { t: "s", v: value };
    }
    cellsStamped++;
  }

  // Generate the vault and stamp password cells.
  const { passwords, vault } = generateWorkbookVault(fleet, { workbookVersion: targetVersion, scope });
  let passwordsStamped = 0;
  for (const [cellKey, password] of passwords.entries()) {
    const sep = cellKey.indexOf("!");
    if (sep < 0) { skipped.push({ stage: "password", cellKey, reason: "malformed cell key" }); continue; }
    const sheetName = cellKey.slice(0, sep);
    const cellAddr = cellKey.slice(sep + 1);
    const sheet = wb.Sheets[sheetName];
    if (!sheet) { skipped.push({ stage: "password", cellKey, reason: `sheet "${sheetName}" not present` }); continue; }
    const existing = sheet[cellAddr];
    if (existing && existing.f) { skipped.push({ stage: "password", cellKey, reason: `cell ${cellAddr} carries a formula` }); continue; }
    sheet[cellAddr] = { t: "s", v: password };
    passwordsStamped++;
  }

  // Serialize once.
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const xlsx = (typeof Blob !== "undefined" && typeof window !== "undefined")
    ? new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    : buf;

  return {
    xlsx,
    vault,
    stamped: { cells: cellsStamped, passwords: passwordsStamped, skipped },
  };
}

// ─── WORKBOOK IMPORT ───────────────────────────────────────────────────────
// Reverse of the emit path: turn a stamped .xlsx (or a cell-map CSV) into
// a draft fleet by walking WORKBOOK_CELL_MAP and calling each entry's
// apply(fleet, ctx, value) function.
//
// Two-step design:
//   1. readWorkbookXlsxAsCellMapRows / parseWorkbookCellMap → unified
//      array of { workbookVersion, sheet, cell, label, value } rows.
//   2. importWorkbookCellMap(rows) → walks the cell-map, applies values to
//      a fresh draft fleet, returns { fleet, version, applied, skipped }.
//
// computeReconcileDiff(fleet) lists the appliance-stack entries that
// reconcileFleetVersion would strip — so the UI can show a pre-flight
// confirmation before silently dropping user data on a cross-version
// import.

// Read every cell-map target cell from a stamped pristine workbook (or its
// ArrayBuffer / Uint8Array bytes) and return CSV-row-shaped objects.
// Detects the workbook version from Sheet2!J16 and includes it on every
// row. Used by the .xlsx import path; the CSV path uses parseWorkbookCellMap
// directly.
function readWorkbookXlsxAsCellMapRows(xlsxInput) {
  const XLSX = _resolveXLSX();
  let wb = xlsxInput;
  if (wb instanceof ArrayBuffer || ArrayBuffer.isView(wb)) {
    const data = wb instanceof ArrayBuffer ? new Uint8Array(wb) : wb;
    wb = XLSX.read(data, { type: "array", cellFormula: true });
  }
  if (!wb || !wb.SheetNames) {
    throw new Error("readWorkbookXlsxAsCellMapRows: unable to parse workbook input");
  }
  const version = detectWorkbookVersion(wb);
  if (!version) {
    throw new Error(
      "readWorkbookXlsxAsCellMapRows: couldn't detect workbook version (Sheet2!J16). " +
      "Drop the official Broadcom Planning & Preparation Workbook."
    );
  }

  const rows = [];
  for (const entry of WORKBOOK_CELL_MAP) {
    if (!entry.workbookVersions || !entry.workbookVersions.includes(version)) continue;
    const sheet = wb.Sheets[entry.sheet];
    if (!sheet) continue;
    // expansion: iterate the same way emit does, since the addresses
    // are scope-independent (per-host FQDN expansion etc.).
    const expansionCount = (typeof entry.expandsTo === "number") ? entry.expandsTo : 1;
    for (let i = 0; i < expansionCount; i++) {
      const cellAddr = _resolveCellAddress(entry, version, i);
      if (!cellAddr) continue;
      const cell = sheet[cellAddr];
      // Read the stamped value. Skip cells the user hasn't filled
      // (still carrying Broadcom's sample formula or left blank).
      let value = "";
      if (cell) {
        if (cell.f) {
          // Formula cell — skip; the user hasn't stamped a real value.
          // (Could still be a cell where the user intentionally cleared
          // the formula and typed a value, but distinguishing those is
          // not worth the false-positive risk on import.)
          continue;
        }
        value = cell.v != null ? String(cell.v) : "";
      }
      if (!value) continue; // skip blanks
      rows.push({
        workbookVersion: version,
        sheet: entry.sheet,
        cell: cellAddr,
        label: _resolveLabel(entry, i),
        value,
      });
    }
  }
  return rows;
}

// Apply cell-map rows to a fresh draft fleet. Returns the populated draft
// plus diagnostic counts. Greenfield-only — callers replace their existing
// fleet state with the returned draft.
//
// Algorithm:
//   1. Detect version from rows[0].workbookVersion (all rows share the
//      same version, since both emit paths and the import-side reader
//      stamp it consistently).
//   2. Build draft = newFleet() and set vcfVersion to the detected version.
//   3. If any imported row's scope is workload-domain / workload-cluster /
//      additional-cluster, append a workload-domain skeleton so the scope
//      iterator has a context to walk.
//   4. Group rows by sheet+cell so we can look up the entry to apply.
//      For each row, find the matching WORKBOOK_CELL_MAP entry, walk the
//      scope to derive ctx, then call entry.apply(draft, ctx, row.value).
//   5. Return { fleet: draft, version, applied, skipped } where skipped
//      lists rows the importer couldn't process (no apply function, or
//      no matching cell-map entry).
function importWorkbookCellMap(rows, options) {
  options = options || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("importWorkbookCellMap: rows array is empty");
  }
  const version = options.workbookVersion
    || rows.find((r) => r && r.workbookVersion)?.workbookVersion
    || DEFAULT_VCF_VERSION_LEGACY;
  if (!SUPPORTED_WORKBOOK_VERSIONS.includes(version)) {
    throw new Error(`importWorkbookCellMap: unsupported workbook version "${version}"`);
  }

  // Build draft skeleton. newFleet() defaults to the studio's new-fleet
  // version (currently 9.1); override to match the import.
  const draft = newFleet();
  draft.vcfVersion = version;

  // If the rows touch any workload-domain/cluster scope, append a workload
  // domain skeleton so _iterateScope has somewhere to walk. Count
  // additional-cluster rows up front so the WLD gets enough cluster
  // skeletons for each additional cluster the workbook describes (one
  // beyond the first).
  const wldScopes = new Set(["workload-domain", "workload-cluster", "workload-cluster-host", "additional-cluster", "additional-cluster-host"]);
  let additionalClusterRows = 0;
  let needsWld = false;
  for (const r of rows) {
    const matched = _findCellMapEntry(r.sheet, r.cell, version);
    if (!matched) continue;
    if (wldScopes.has(matched.scope)) needsWld = true;
    if (matched.scope === "additional-cluster" || matched.scope === "additional-cluster-host") {
      additionalClusterRows++;
    }
  }
  if (needsWld) {
    const wld = newWorkloadDomain("Workload Domain 01");
    wld.clusters = [newWorkloadCluster("wld-cluster-01")];
    // Add one skeleton cluster per additional-cluster row. (additional-
    // cluster scope iterates clusters.slice(1), so the second cluster
    // onward is the import target.)
    for (let i = 0; i < additionalClusterRows; i++) {
      wld.clusters.push(newWorkloadCluster(`wld-cluster-0${i + 2}`));
    }
    draft.instances[0].domains.push(wld);
  }

  // Sort rows by scope priority before applying so dependent values
  // resolve in order — e.g. DNS Domain name (mgmt-domain) must be set
  // before per-host FQDN apply tries to strip the DNS suffix off each
  // host's value. Emit naturally produces this order; CSV imports that
  // shuffle rows would otherwise break the host-FQDN suffix stripping.
  const SCOPE_PRIORITY = {
    "per-fleet": 1,
    "instance": 2,
    "mgmt-domain": 3,
    "initial-instance-mgmt-cluster": 4,
    "mgmt-cluster": 5,
    "mgmt-cluster-host": 6,
    "workload-domain": 7,
    "workload-cluster": 8,
    "workload-cluster-host": 9,
    "additional-cluster": 10,
    "additional-cluster-host": 11,
  };
  const sortedRows = [...rows].sort((a, b) => {
    const ea = _findCellMapEntry(a.sheet, a.cell, version);
    const eb = _findCellMapEntry(b.sheet, b.cell, version);
    const pa = (ea && SCOPE_PRIORITY[ea.scope]) || 99;
    const pb = (eb && SCOPE_PRIORITY[eb.scope]) || 99;
    return pa - pb;
  });

  // Apply each row. Walk WORKBOOK_CELL_MAP entries; for each entry, look
  // up matching rows (an entry may have multiple rows in expansion).
  const applied = [];
  const skipped = [];
  // Track which additional-cluster context to use per row; multiple
  // additional-cluster rows must address different clusters in iteration
  // order rather than all landing on the first context.
  let additionalClusterCursor = 0;
  for (const row of sortedRows) {
    const entry = _findCellMapEntry(row.sheet, row.cell, version);
    if (!entry) {
      skipped.push({ row, reason: "no matching cell-map entry" });
      continue;
    }
    if (typeof entry.apply !== "function") {
      // Distinguish intentional emit-only entries (e.g. naming-template-
      // derived FQDNs, computed pool ranges) from cell-map entries that
      // just haven't gained an apply function yet. The diagnostic helps
      // future broaden-apply PRs know which entries are deliberately left
      // alone vs. genuinely missing.
      const reason = entry.emitOnly
        ? "cell-map entry is intentionally emit-only (derived from other cells)"
        : "cell-map entry has no apply function (emit-only)";
      skipped.push({ row, reason });
      continue;
    }
    // Resolve iteration index for expansion entries.
    const i = _findExpansionIndexForCell(entry, version, row.cell);
    // Walk scope to find the matching context.
    const contexts = _iterateScope(draft, entry.scope);
    // For expansion entries we apply per-iteration; for single-cell
    // entries the first context wins. additional-cluster is the
    // exception — each row targets the next cluster context in turn.
    let ctx;
    if (entry.scope === "additional-cluster" || entry.scope === "additional-cluster-host") {
      ctx = contexts[additionalClusterCursor++];
    } else {
      ctx = contexts[0];
    }
    if (!ctx) {
      skipped.push({ row, reason: `no context for scope "${entry.scope}"` });
      continue;
    }
    try {
      entry.apply(draft, ctx, row.value, i);
      applied.push({ row, entry: entry.label });
    } catch (err) {
      skipped.push({ row, reason: `apply threw: ${err.message}` });
    }
  }

  return { fleet: draft, version, applied, skipped };
}

// Look up the WORKBOOK_CELL_MAP entry that owns a given (sheet, cell)
// address at the given version. Handles both literal cells and cellPattern
// expansions (matches the pattern's row range).
function _findCellMapEntry(sheet, cell, version) {
  if (!sheet || !cell) return null;
  for (const entry of WORKBOOK_CELL_MAP) {
    if (entry.sheet !== sheet) continue;
    if (!entry.workbookVersions || !entry.workbookVersions.includes(version)) continue;
    // Literal cell match.
    const literal = (entry.cellByVersion && entry.cellByVersion[version]) || entry.cell;
    if (literal === cell) return entry;
    // Pattern match (e.g. "L{82+i}" for 9.1 host FQDN block).
    const pattern = (entry.cellPatternByVersion && entry.cellPatternByVersion[version]) || entry.cellPattern;
    if (pattern && typeof entry.expandsTo === "number") {
      for (let i = 0; i < entry.expandsTo; i++) {
        const addr = pattern.replace(/\{(\d+)\+i\}/g, (_, base) => String(parseInt(base, 10) + i));
        if (addr === cell) return entry;
      }
    }
  }
  return null;
}

// For expansion entries, find which iteration index `i` produced the given
// cell address. Returns 0 for non-expansion entries.
function _findExpansionIndexForCell(entry, version, cell) {
  const pattern = (entry.cellPatternByVersion && entry.cellPatternByVersion[version]) || entry.cellPattern;
  if (!pattern || typeof entry.expandsTo !== "number") return 0;
  for (let i = 0; i < entry.expandsTo; i++) {
    const addr = pattern.replace(/\{(\d+)\+i\}/g, (_, base) => String(parseInt(base, 10) + i));
    if (addr === cell) return i;
  }
  return 0;
}

// Compute the entries reconcileFleetVersion would strip from a fleet. Used
// by the import-confirm UI to warn the user before destructive reconciles.
// Returns array of { instanceId, instanceName, domainId, domainName,
// clusterId, clusterName, entryId, applianceLabel, reason }.
function computeReconcileDiff(fleet, targetVersion) {
  if (!fleet) return [];
  const version = targetVersion || fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
  const out = [];
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      for (const clu of dom.clusters || []) {
        for (const stackKey of ["infraStack", "wldStack"]) {
          for (const e of (clu[stackKey] || [])) {
            const def = APPLIANCE_DB[e?.id];
            if (!def) continue;
            if (applianceAvailableIn(def, version)) continue;
            out.push({
              instanceId: inst.id,
              instanceName: inst.name,
              domainId: dom.id,
              domainName: dom.name,
              clusterId: clu.id,
              clusterName: clu.name,
              entryId: e.id,
              applianceLabel: def.label || e.id,
              stack: stackKey,
              reason: `appliance not available in VCF ${version}`,
            });
          }
        }
      }
    }
  }
  return out;
}

// ─── PASSWORD GENERATION ───────────────────────────────────────────────────
//
// Per-credential-type complexity rules sourced from Broadcom techdocs and
// the workbook's data-validation lists. The studio uses these to generate
// strong unique passwords client-side at export time; passwords are never
// stored in studio state, only flow through the vault download.
//
// Security guarantees enforced by the tests in workbook-passwords.test.js:
// crypto.getRandomValues only (non-cryptographic PRNGs are not an
// acceptable fallback); no persistence (no localStorage / sessionStorage
// / module-scoped cache / React refs hold password values); vault file
// is the only delivery channel; no clipboard auto-copy; no network egress.
//
// Each policy carries:
//   - len: target password length (chars)
//   - classes: { upper, lower, digit, special } — minimum count per class.
//     Sum must equal `len`; the generator fills the password exactly to
//     `len` chars by picking from each class in turn.
//   - alphabet: per-class character pools. Special chars exclude
//     Excel-formula triggers (=, +, -, @ at position 0) and shell-fragile
//     chars (\, ', ", <, >, backtick, semicolon).
const _SPECIAL_SAFE = "!#$%^&*_?";
const PASSWORD_POLICY = {
  "esx-root":              { len: 16, classes: { upper: 4, lower: 4, digit: 4, special: 4 }, alphabet: { special: _SPECIAL_SAFE } },
  "vcenter-root":          { len: 16, classes: { upper: 4, lower: 4, digit: 4, special: 4 }, alphabet: { special: _SPECIAL_SAFE } },
  "nsx-admin":             { len: 24, classes: { upper: 6, lower: 6, digit: 6, special: 6 }, alphabet: { special: _SPECIAL_SAFE } },
  "nsx-root":              { len: 24, classes: { upper: 6, lower: 6, digit: 6, special: 6 }, alphabet: { special: _SPECIAL_SAFE } },
  "nsx-audit":             { len: 24, classes: { upper: 6, lower: 6, digit: 6, special: 6 }, alphabet: { special: _SPECIAL_SAFE } },
  "sddc-root":             { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "sddc-vcf":              { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "sddc-admin":            { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "ops-admin":             { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "ops-root":              { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "edge-root":             { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "edge-admin":            { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
  "sso-admin":             { len: 16, classes: { upper: 4, lower: 4, digit: 4, special: 4 }, alphabet: { special: _SPECIAL_SAFE } },
  "sso-user":              { len: 16, classes: { upper: 4, lower: 4, digit: 4, special: 4 }, alphabet: { special: _SPECIAL_SAFE } },
  "encryption-passphrase": { len: 32, classes: { upper: 8, lower: 8, digit: 8, special: 8 }, alphabet: { special: _SPECIAL_SAFE } },
  "vsan-witness-root":     { len: 16, classes: { upper: 4, lower: 4, digit: 4, special: 4 }, alphabet: { special: _SPECIAL_SAFE } },
  // BGP MD5 peers — alphanumeric only because some router stacks reject
  // certain special characters in TCP-MD5 keys. Length 24 lands inside
  // the 8-80 RFC 2385 envelope and gives ~140 bits of entropy.
  "bgp-peer":              { len: 24, classes: { upper: 8, lower: 8, digit: 8, special: 0 }, alphabet: { special: "" } },
  // Theme 1a/1b — VCF Installer proxy credentials. Pass through HTTP
  // Basic-Auth headers, so the default _SPECIAL_SAFE alphabet stays
  // URL-safe (no /, ?, #, &, =) and Excel-safe (no =, +, -, @). The
  // depot side has no generatable password — downloadToken is issued by
  // Broadcom and the offline depot's auth (if any) is handled by the
  // mirror itself, not the installer config.
  "proxy":                 { len: 20, classes: { upper: 5, lower: 5, digit: 5, special: 5 }, alphabet: { special: _SPECIAL_SAFE } },
};

// Resolve the crypto provider in any environment. Browsers expose it as
// `window.crypto`; Node 16+ exposes `globalThis.crypto`. Refuse to operate
// if neither is present — non-CSPRNG fallbacks (predictable PRNGs) are
// never acceptable for password generation; the workbook-passwords test
// suite asserts the literal token absence below.
function _resolveCrypto() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    return globalThis.crypto;
  }
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.getRandomValues === "function") {
    return window.crypto;
  }
  throw new Error(
    "generatePassword: crypto.getRandomValues is not available. " +
    "Non-cryptographic PRNGs are not an acceptable fallback for password generation. " +
    "Upgrade to a current browser or Node 16+."
  );
}

// Pick `count` items from `alphabet` using uniform unbiased rejection
// sampling on the crypto-RNG output. Returns an array of single-char
// strings; caller shuffles them into the final password.
function _pickFromAlphabet(crypto, alphabet, count) {
  if (count <= 0 || !alphabet || alphabet.length === 0) return [];
  const out = new Array(count);
  // Find the largest multiple of alphabet.length that fits in a Uint32
  // so we can reject sampled values >= that threshold for uniformity.
  const max = Math.floor(0xFFFFFFFF / alphabet.length) * alphabet.length;
  const buf = new Uint32Array(1);
  let filled = 0;
  while (filled < count) {
    crypto.getRandomValues(buf);
    if (buf[0] >= max) continue;
    out[filled++] = alphabet.charAt(buf[0] % alphabet.length);
  }
  return out;
}

// Fisher-Yates shuffle using crypto.getRandomValues (so the per-class
// ordering inside the password is unpredictable — without this, the
// password would always be N upper, then N lower, then N digit, then N
// special, which leaks the policy shape).
function _cryptoShuffle(crypto, arr) {
  const buf = new Uint32Array(1);
  for (let i = arr.length - 1; i > 0; i--) {
    // Unbiased rejection sample 0..i (inclusive) — same rejection trick
    // as _pickFromAlphabet but with i+1 as the modulus.
    const range = i + 1;
    const max = Math.floor(0xFFFFFFFF / range) * range;
    let r;
    do {
      crypto.getRandomValues(buf);
      r = buf[0];
    } while (r >= max);
    const j = r % range;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const _DEFAULT_ALPHABETS = {
  upper:   "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower:   "abcdefghijklmnopqrstuvwxyz",
  digit:   "0123456789",
  // Default special set excludes Excel-formula triggers (=, +, -, @) and
  // shell-fragile chars (\, ', ", <, >, backtick, semicolon). Per-policy
  // alphabet overrides can narrow further (e.g. bgp-peer uses none).
  special: _SPECIAL_SAFE,
};

// generatePassword(kind) — generate a single password meeting the policy
// for `kind`. Uses crypto.getRandomValues exclusively. Returns a string.
// Throws if `kind` is unknown or if `crypto.getRandomValues` is missing.
function generatePassword(kind) {
  const policy = PASSWORD_POLICY[kind];
  if (!policy) {
    throw new Error(`generatePassword: unknown passwordKind "${kind}". Add to PASSWORD_POLICY.`);
  }
  const crypto = _resolveCrypto();
  const classes = policy.classes || {};
  const chars = [];
  for (const cls of ["upper", "lower", "digit", "special"]) {
    const need = classes[cls] || 0;
    const alphabet = (policy.alphabet && policy.alphabet[cls] !== undefined)
      ? policy.alphabet[cls]
      : _DEFAULT_ALPHABETS[cls];
    chars.push(..._pickFromAlphabet(crypto, alphabet, need));
  }
  // If policy.len exceeds the sum of class counts, pad with uniformly
  // random picks across all class alphabets so the password reaches the
  // requested length. (Today every policy sums to len exactly; this
  // future-proofs the generator.)
  const sumNeeded = (classes.upper || 0) + (classes.lower || 0) + (classes.digit || 0) + (classes.special || 0);
  const pad = (policy.len || sumNeeded) - sumNeeded;
  if (pad > 0) {
    const combined =
      ((policy.alphabet && policy.alphabet.upper)   || _DEFAULT_ALPHABETS.upper)   +
      ((policy.alphabet && policy.alphabet.lower)   || _DEFAULT_ALPHABETS.lower)   +
      ((policy.alphabet && policy.alphabet.digit)   || _DEFAULT_ALPHABETS.digit)   +
      ((policy.alphabet && policy.alphabet.special) || _DEFAULT_ALPHABETS.special);
    chars.push(..._pickFromAlphabet(crypto, combined, pad));
  }
  _cryptoShuffle(crypto, chars);
  return chars.join("");
}

// generateWorkbookVault(fleet, options?) — walk WORKBOOK_CELL_MAP for
// every entry with a `passwordKind`, generate per-cell strong passwords
// using PASSWORD_POLICY, return:
//   {
//     passwords: Map<cellAddress, string>,
//     vault: { workbookVersion, generatedAt, fleetName, totalPasswords, credentials[] }
//   }
//
// Options:
//   - workbookVersion: "9.0" | "9.1" (defaults to workbookVersionForFleet(fleet))
//   - scope: "all" (default) | "camp-b" (Camp B / user-required only) |
//            "skip-bgp" (all except BGP peer passwords — for users who
//            coordinate BGP secrets with their network team manually)
//
// The studio retains no copy of `passwords` or `vault` beyond the return
// value of this call. Callers are expected to use them immediately
// (stamp into .xlsx + offer vault download) and let them go out of scope.
function generateWorkbookVault(fleet, options) {
  options = options || {};
  const version = options.workbookVersion || workbookVersionForFleet(fleet);
  const scope = options.scope || "all";

  // Camp B cells = passwords VCF auto-generate can't cover. These MUST be
  // user-supplied (or studio-generated) regardless of toggle state.
  const CAMP_B_KINDS = new Set([
    "esx-root", "encryption-passphrase", "vsan-witness-root",
    "bgp-peer", "sso-admin", "sso-user",
  ]);

  const passwords = new Map();
  const credentials = [];

  for (const entry of WORKBOOK_CELL_MAP) {
    if (!entry.passwordKind) continue;
    if (!entry.workbookVersions || !entry.workbookVersions.includes(version)) continue;

    // Apply scope filter.
    if (scope === "camp-b" && !CAMP_B_KINDS.has(entry.passwordKind)) continue;
    if (scope === "skip-bgp" && entry.passwordKind === "bgp-peer") continue;

    const cellAddr = (entry.cellByVersion && entry.cellByVersion[version]) || entry.cell;
    if (!cellAddr) continue;

    const password = generatePassword(entry.passwordKind);
    passwords.set(`${entry.sheet}!${cellAddr}`, password);
    credentials.push({
      cellAddress: `${entry.sheet}!${cellAddr}`,
      sheet: entry.sheet,
      cell: cellAddr,
      label: entry.label,
      credentialType: entry.passwordKind,
      password,
      complexityRule: PASSWORD_POLICY[entry.passwordKind],
    });
  }

  // Sort credentials by (sheet, cell) for stable, audit-friendly output.
  credentials.sort((a, b) => {
    if (a.sheet !== b.sheet) return a.sheet.localeCompare(b.sheet);
    return a.cell.localeCompare(b.cell, undefined, { numeric: true });
  });

  const vault = {
    $comment: "VCF Design Studio generated vault. Save to your password manager IMMEDIATELY and delete this file. Studio retains no copy. BGP peer passwords need to be coordinated with the customer's network/router team before applying.",
    // Audit-trail headers — let vault-tool integrators key off a stable
    // identifier and recognize a future format bump without parsing the
    // body. Bump $schemaVersion when the credentials[] shape changes in
    // a way third-party importers need to adapt to.
    $schema: "https://github.com/mavlite/VCF-Design-Studio/blob/main/README.md#workbook-passwords--vault-delivery",
    $schemaVersion: 1,
    $generator: `vcf-design-studio v${VAULT_GENERATOR_VERSION}`,
    workbookVersion: version,
    generatedAt: new Date().toISOString(),
    fleetName: (fleet && fleet.name) || "(unnamed fleet)",
    scope,
    totalPasswords: credentials.length,
    credentials,
  };

  return { passwords, vault };
}

// Stable identifier baked into every vault file for audit + format-drift
// detection. Bumped when the vault `credentials[]` shape or `$schema*`
// header semantics change. NOT tied to the studio's package.json version
// — vault consumers should key off $schemaVersion for compatibility,
// $generator for provenance.
const VAULT_GENERATOR_VERSION = "5.0.0";

// parseWorkbookCellMap — reverse: parse a CSV string into the same row shape.
// Tolerant of trailing newlines and stripped/whitespace cells.
function parseWorkbookCellMap(csv) {
  if (!csv || typeof csv !== "string") return [];
  const out = [];
  // Tokenize lines respecting quoted fields.
  const records = [];
  let cur = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < csv.length) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { cur.push(field); field = ""; i++; continue; }
    if (c === "\n" || c === "\r") {
      cur.push(field); field = "";
      if (cur.length > 1 || cur[0] !== "") records.push(cur);
      cur = [];
      if (c === "\r" && csv[i + 1] === "\n") i += 2; else i++;
      continue;
    }
    field += c; i++;
  }
  if (field !== "" || cur.length > 0) { cur.push(field); records.push(cur); }
  if (records.length === 0) return [];
  const header = records[0];
  const idx = {
    workbookVersion: header.indexOf("workbookVersion"),
    sheet: header.indexOf("sheet"),
    cell: header.indexOf("cell"),
    label: header.indexOf("label"),
    value: header.indexOf("value"),
  };
  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    out.push({
      workbookVersion: row[idx.workbookVersion],
      sheet: row[idx.sheet],
      cell: row[idx.cell],
      label: row[idx.label],
      value: row[idx.value],
    });
  }
  return out;
}

// ─── WORKBOOK_CELL_MAP — workbook cell-map ─────────────────────────────────
// Approximately 50 entries covering every scope value + version-routing
// pattern. Exercises every resolver semantic (workbookVersions filter,
// cellByVersion override, cellPattern with expandsTo, dataValidation enum,
// per-host expansion, initial-instance-only scope, multi-version sharing).
//
// Cell-meta fixtures at test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json
// are the canonical reference for cell addresses; verify-cell-map.mjs
// asserts these labels match the pristine workbook.

// Theme 5 helper — auto-create the first T0 gateway on a cluster when an
// import row provides a non-empty BGP/routing value but no T0 exists yet.
// Returns the (existing or freshly-created) T0. Returns null if cluster
// itself is missing or the value is empty (i.e. nothing to persist).
function _ensureT0OnCluster(cluster, value) {
  if (!cluster) return null;
  const s = String(value == null ? "" : value).trim();
  if (!s) return (cluster.t0Gateways || [])[0] || null;
  const existing = (cluster.t0Gateways || [])[0];
  if (existing) return existing;
  if (!Array.isArray(cluster.t0Gateways)) cluster.t0Gateways = [];
  const t0 = newT0Gateway(cluster.name ? `t0-${cluster.name}` : "t0-imported");
  cluster.t0Gateways.push(t0);
  return t0;
}

// Theme 5 helper — emits the 16 per-peer BGP cell-map entries (slots 1+2 of
// the AZ1 uplink pair, on both Configure Mgmt and Configure WLD sheets,
// across 9.0 and 9.1). 9.1 swapped MTU and BFD relative to 9.0, so each
// field carries an explicit cellByVersion address rather than a uniform
// offset.
//
// Slot 0 = first peer, slot 1 = second peer. The studio's bgpPeers[] index
// IS the slot — bgpPeers[0] is "AZ1 TOR1", bgpPeers[1] is "AZ1 TOR2".
function _buildBgpPeerCellMapEntries() {
  // Field → { mgmt: { v9_0: [slot1, slot2], v9_1: [slot1, slot2] },
  //           wld:  { v9_0: [slot1, slot2], v9_1: [slot1, slot2] },
  //           verifyLabel, kind ("ip"|"asn"|"mtu"|"bfd") }
  // BFD slot-2 cells (Mgmt D168/D172, WLD D111/D114) are formula-derived
  // in the workbook — stamping would destroy the formula. Each field
  // carries a `slots` array that explicitly enumerates the slot indexes
  // we own (BFD is slot-0-only; everything else covers slots 0 and 1).
  const fields = [
    {
      key: "ip", verifyLabel: "BGP Peer IP", slots: [0, 1],
      mgmt: { "9.0": ["D160", "D167"], "9.1": ["D163", "D170"] },
      wld:  { "9.0": ["D103", "D110"], "9.1": ["D106", "D113"] },
    },
    {
      key: "bfd", verifyLabel: "BFD", slots: [0],
      mgmt: { "9.0": ["D161"], "9.1": ["D165"] },
      wld:  { "9.0": ["D104"], "9.1": ["D107"] },
    },
    {
      key: "mtu", verifyLabel: "MTU", slots: [0, 1],
      mgmt: { "9.0": ["D162", "D169"], "9.1": ["D164", "D171"] },
      wld:  { "9.0": ["D105", "D112"], "9.1": ["D108", "D115"] },
    },
    {
      key: "asn", verifyLabel: "BGP Peer ASN", slots: [0, 1],
      mgmt: { "9.0": ["D163", "D170"], "9.1": ["D166", "D173"] },
      wld:  { "9.0": ["D106", "D113"], "9.1": ["D109", "D116"] },
    },
  ];

  function resolveValue(peer, kind) {
    if (!peer) return "";
    if (kind === "ip") return peer.ip || "";
    if (kind === "asn") return peer.asn != null ? peer.asn : "";
    if (kind === "mtu") return peer.mtu != null ? peer.mtu : "";
    if (kind === "bfd") return peer.bfdEnabled ? "Selected" : "Unselected";
    return "";
  }

  function applyValue(t0, peerIdx, kind, raw) {
    if (!t0) return;
    if (!Array.isArray(t0.bgpPeers)) t0.bgpPeers = [];
    while (t0.bgpPeers.length <= peerIdx) {
      t0.bgpPeers.push({ id: "peer-" + localId(), name: null, ip: null, asn: null, mtu: null, bfdEnabled: false });
    }
    const peer = t0.bgpPeers[peerIdx];
    const s = String(raw == null ? "" : raw).trim();
    if (kind === "ip") {
      peer.ip = s || null;
    } else if (kind === "asn") {
      if (!s) { peer.asn = null; return; }
      const n = parseInt(s, 10);
      peer.asn = Number.isFinite(n) ? n : null;
    } else if (kind === "mtu") {
      if (!s) { peer.mtu = null; return; }
      const n = parseInt(s, 10);
      peer.mtu = Number.isFinite(n) ? n : null;
    } else if (kind === "bfd") {
      const v = s.toLowerCase();
      if (v === "selected") peer.bfdEnabled = true;
      else if (v === "unselected") peer.bfdEnabled = false;
    }
  }

  function buildEntry(sheetName, scope, fieldDef, slotIdx, addrIdx, sheetKey, label) {
    const v9_0 = fieldDef[sheetKey]["9.0"][addrIdx];
    const v9_1 = fieldDef[sheetKey]["9.1"][addrIdx];
    return {
      sheet: sheetName, cell: v9_0, cellByVersion: { "9.1": v9_1 },
      label, verifyLabel: fieldDef.verifyLabel,
      workbookVersions: ["9.0", "9.1"],
      scope,
      resolve: (_fleet, ctx) => {
        const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
        const peer = t0 && (t0.bgpPeers || [])[slotIdx];
        return resolveValue(peer, fieldDef.key);
      },
      apply: (_fleet, ctx, value) => {
        const t0 = _ensureT0OnCluster(ctx.cluster, value);
        if (!t0) return;
        applyValue(t0, slotIdx, fieldDef.key, value);
      },
    };
  }

  const entries = [];
  for (const fieldDef of fields) {
    for (let addrIdx = 0; addrIdx < fieldDef.slots.length; addrIdx++) {
      const slotIdx = fieldDef.slots[addrIdx];
      entries.push(buildEntry(
        "Configure Management Domain",
        "initial-instance-mgmt-cluster",
        fieldDef, slotIdx, addrIdx, "mgmt",
        `T0 BGP Peer #${slotIdx + 1} ${fieldDef.verifyLabel} (Mgmt)`,
      ));
      entries.push(buildEntry(
        "Configure Workload Domain",
        "workload-cluster",
        fieldDef, slotIdx, addrIdx, "wld",
        `T0 BGP Peer #${slotIdx + 1} ${fieldDef.verifyLabel} (WLD)`,
      ));
    }
  }
  return entries;
}

const WORKBOOK_CELL_MAP = [
  // ─── Per-fleet (DNS / NTP — once per workbook) ─────────────────────────
  // Cell addresses verified against the cell-meta fixtures
  // (test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json).
  // Verifier uses verifyLabelByVersion when the workbook's label is more
  // generic than the cell-map's semantic label (e.g. "Server #1" in 9.1
  // where context lives in the section header one row up).
  {
    sheet: "Deploy Management Domain", cell: "L43",
    cellByVersion: { "9.1": "L71" },
    label: "DNS Domain name",
    verifyLabelByVersion: { "9.1": "Default hostname DNS suffix" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (fleet) => (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "",
    apply: (fleet, _ctx, value) => {
      fleet.networkConfig = fleet.networkConfig || {};
      fleet.networkConfig.dns = fleet.networkConfig.dns || {};
      fleet.networkConfig.dns.primaryDomain = String(value || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L44",
    cellByVersion: { "9.1": "L72" },
    label: "DNS Server #1",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (fleet) => ((fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.servers) || [])[0] || "",
    apply: (fleet, _ctx, value) => {
      fleet.networkConfig = fleet.networkConfig || {};
      fleet.networkConfig.dns = fleet.networkConfig.dns || {};
      fleet.networkConfig.dns.servers = fleet.networkConfig.dns.servers || [];
      fleet.networkConfig.dns.servers[0] = String(value || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L45",
    cellByVersion: { "9.1": "L73" },
    label: "DNS Server #2",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (fleet) => ((fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.servers) || [])[1] || "",
    apply: (fleet, _ctx, value) => {
      fleet.networkConfig = fleet.networkConfig || {};
      fleet.networkConfig.dns = fleet.networkConfig.dns || {};
      fleet.networkConfig.dns.servers = fleet.networkConfig.dns.servers || [];
      fleet.networkConfig.dns.servers[1] = String(value || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L47",
    cellByVersion: { "9.1": "L75" },
    label: "NTP Server #1",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (fleet) => ((fleet.networkConfig && fleet.networkConfig.ntp && fleet.networkConfig.ntp.servers) || [])[0] || "",
    apply: (fleet, _ctx, value) => {
      fleet.networkConfig = fleet.networkConfig || {};
      fleet.networkConfig.ntp = fleet.networkConfig.ntp || {};
      fleet.networkConfig.ntp.servers = fleet.networkConfig.ntp.servers || [];
      fleet.networkConfig.ntp.servers[0] = String(value || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L48",
    cellByVersion: { "9.1": "L76" },
    label: "NTP Server #2",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (fleet) => ((fleet.networkConfig && fleet.networkConfig.ntp && fleet.networkConfig.ntp.servers) || [])[1] || "",
    apply: (fleet, _ctx, value) => {
      fleet.networkConfig = fleet.networkConfig || {};
      fleet.networkConfig.ntp = fleet.networkConfig.ntp || {};
      fleet.networkConfig.ntp.servers = fleet.networkConfig.ntp.servers || [];
      fleet.networkConfig.ntp.servers[1] = String(value || "");
    },
  },

  // ─── Theme 1b — VCF Installer / depot / proxy (Deploy Mgmt L9–L20) ────
  // Fleet-scope (single stamp per workbook). 9.1 inserts an Activation
  // Code row at L13, shifting the entire proxy block (Enable through
  // Password) down by one row vs 9.0. cellByVersion captures the shift.
  //
  // The workbook uses Online/Offline (not broadcom/offline) and
  // Selected/Unselected (not true/false) enums. The resolve/apply pairs
  // translate between the engine's lowercase / boolean model and the
  // workbook's display strings, both directions.
  {
    sheet: "Deploy Management Domain", cell: "L9",
    label: "Depot Type",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    dataValidation: ["Online", "Offline"],
    resolve: (f) => (f.installerConfig && f.installerConfig.depotType === "offline") ? "Offline" : "Online",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.depotType = String(v || "").trim().toLowerCase() === "offline" ? "offline" : "online";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L10",
    label: "Offline Depot Hostname",
    verifyLabel: "Offline Depot - Hostname",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    resolve: (f) => (f.installerConfig && f.installerConfig.offlineDepotHostname) || "",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.offlineDepotHostname = String(v || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L11",
    label: "Offline Depot Port",
    verifyLabel: "Offline Depot - Port",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    resolve: (f) => {
      const p = f.installerConfig && f.installerConfig.offlineDepotPort;
      return (p === null || p === undefined || p === "") ? "" : String(p);
    },
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      const n = parseInt(v, 10);
      f.installerConfig.offlineDepotPort = Number.isFinite(n) ? n : 443;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L12",
    label: "Download Token",
    verifyLabelByVersion: { "9.0": "Download Token", "9.1": "Download Service ID" },
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    resolve: (f) => (f.installerConfig && f.installerConfig.downloadToken) || "",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.downloadToken = String(v || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L13",
    label: "Activation Code",
    workbookVersions: ["9.1"],
    scope: "per-fleet",
    resolve: (f) => (f.installerConfig && f.installerConfig.activationCode) || "",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.activationCode = String(v || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L13",
    cellByVersion: { "9.1": "L14" },
    label: "Enable Proxy Server",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    dataValidation: ["Selected", "Unselected"],
    resolve: (f) => (f.installerConfig && f.installerConfig.proxyEnabled === true) ? "Selected" : "Unselected",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.proxyEnabled = String(v || "").trim().toLowerCase() === "selected";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L14",
    cellByVersion: { "9.1": "L15" },
    label: "Proxy Protocol",
    verifyLabel: "Protocol",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    dataValidation: ["HTTP", "HTTPS"],
    resolve: (f) => (f.installerConfig && f.installerConfig.proxyProtocol === "http") ? "HTTP" : "HTTPS",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.proxyProtocol = String(v || "").trim().toLowerCase() === "http" ? "http" : "https";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L15",
    cellByVersion: { "9.1": "L16" },
    label: "Proxy Host",
    verifyLabelByVersion: { "9.0": "Proxy Address", "9.1": "Proxy FQDN or IP address" },
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    resolve: (f) => (f.installerConfig && f.installerConfig.proxyHost) || "",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.proxyHost = String(v || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L16",
    cellByVersion: { "9.1": "L17" },
    label: "Proxy Port",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    resolve: (f) => {
      const p = f.installerConfig && f.installerConfig.proxyPort;
      return (p === null || p === undefined || p === "") ? "" : String(p);
    },
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      const n = parseInt(v, 10);
      f.installerConfig.proxyPort = Number.isFinite(n) ? n : 443;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L17",
    cellByVersion: { "9.1": "L18" },
    label: "Proxy Authenticated",
    verifyLabel: "Authenticated",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    dataValidation: ["Selected", "Unselected"],
    resolve: (f) => (f.installerConfig && f.installerConfig.proxyAuthenticated === true) ? "Selected" : "Unselected",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.proxyAuthenticated = String(v || "").trim().toLowerCase() === "selected";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L18",
    cellByVersion: { "9.1": "L19" },
    label: "Proxy Username",
    verifyLabel: "Username",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    resolve: (f) => (f.installerConfig && f.installerConfig.proxyUser) || "",
    apply: (f, _c, v) => {
      f.installerConfig = f.installerConfig || createFleetInstallerConfig();
      f.installerConfig.proxyUser = String(v || "");
    },
  },
  {
    // Vault-only — never emits through the regular cell-map (passwordKind
    // entries are skipped in emitWorkbookCellMap) and never imports
    // (emitOnly + no apply). The vault generates a fresh value on every
    // export; the user-typed UI field is decorative and stored only in
    // the fleet JSON, matching the BGP peer password convention.
    sheet: "Deploy Management Domain", cell: "L19",
    cellByVersion: { "9.1": "L20" },
    label: "Proxy Password",
    verifyLabel: "Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "per-fleet",
    passwordKind: "proxy",
    emitOnly: true,
    resolve: () => "",
  },

  // ─── instance scope (one row per VCF instance) ─────────────────────────
  {
    sheet: "Deploy Management Domain", cell: "L38",
    cellByVersion: { "9.1": "L67" },
    label: "VCF Instance Name",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    resolve: (_fleet, ctx) => (ctx.instance && ctx.instance.name) || "",
    apply: (_fleet, ctx, value) => { if (ctx.instance) ctx.instance.name = String(value || ""); },
  },
  {
    sheet: "Deploy Management Domain", cell: "L41",
    cellByVersion: { "9.1": "L39" },
    label: "Deployment model",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    dataValidation: ["Deploy Simple", "Deploy HA", "Deploy HA with NSX Federation"],
    resolve: (_fleet, ctx) => {
      const map = { simple: "Deploy Simple", ha: "Deploy HA", haFederation: "Deploy HA with NSX Federation" };
      return map[ctx.instance && ctx.instance.deploymentProfile] || "Deploy HA";
    },
    apply: (_fleet, ctx, value) => {
      if (!ctx.instance) return;
      const inverse = {
        "deploy simple": "simple",
        "deploy ha": "ha",
        "deploy ha with nsx federation": "haFederation",
      };
      const key = String(value || "").trim().toLowerCase();
      const profile = inverse[key];
      if (profile) ctx.instance.deploymentProfile = profile;
    },
  },

  // ─── mgmt-domain scope (per-domain identity) ───────────────────────────
  {
    sheet: "Deploy Management Domain", cell: "L39",
    cellByVersion: { "9.1": "L68" },
    label: "Management domain name",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-domain",
    resolve: (_fleet, ctx) => (ctx.domain && ctx.domain.name) || "",
    apply: (_fleet, ctx, value) => { if (ctx.domain) ctx.domain.name = String(value || ""); },
  },

  // ─── mgmt-cluster scope (per-mgmt-cluster appliances) ──────────────────
  // 9.1 moved vCenter detail rows from L90-L94 into the main vCenter
  // section at L181-L185, and the appliance size rows into the API-only
  // customization sub-section at L320-L328.
  {
    // Emit-only: derived from naming template + DNS suffix; both round-trip
    // via other cell-map entries (host FQDN expansion, DNS Domain name).
    sheet: "Deploy Management Domain", cell: "L90",
    cellByVersion: { "9.1": "L181" },
    label: "vCenter Appliance FQDN",
    verifyLabelByVersion: { "9.1": "Appliance FQDN" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    emitOnly: true,
    resolve: (fleet, ctx) => {
      const hn = (resolveHostname && resolveHostname(fleet, ctx.instance, ctx.domain, ctx.cluster, 0)) || "";
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      return hn && dn ? `${hn}.${dn}` : (hn || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L91",
    cellByVersion: { "9.1": "L325" },
    label: "vCenter Appliance Size",
    verifyLabelByVersion: { "9.1": "Appliance Size" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["Tiny", "Small", "Medium", "Large", "X-Large"],
    resolve: (_fleet, ctx) => {
      const entry = (ctx.cluster && (ctx.cluster.infraStack || []).find((e) => e.id === "vcenter"));
      const size = entry && entry.size;
      return size === "XLarge" ? "X-Large" : (size || "");
    },
    apply: (_fleet, ctx, value) => {
      const entry = (ctx.cluster && (ctx.cluster.infraStack || []).find((e) => e.id === "vcenter"));
      if (entry) entry.size = String(value || "").replace("-", "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L92",
    cellByVersion: { "9.1": "L326" },
    label: "vCenter Appliance Storage Size",
    verifyLabelByVersion: { "9.1": "Appliance Storage Size" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["Default", "Large", "X-Large"],
    resolve: (_fleet, ctx) => {
      const entry = (ctx.cluster && (ctx.cluster.infraStack || []).find((e) => e.id === "vcenter"));
      const profile = (entry && entry.storageProfile) || "default";
      return profile.charAt(0).toUpperCase() + profile.slice(1).replace("xlarge", "Large");
    },
    apply: (_fleet, ctx, value) => {
      const entry = (ctx.cluster && (ctx.cluster.infraStack || []).find((e) => e.id === "vcenter"));
      if (entry) entry.storageProfile = String(value || "default").toLowerCase().replace(/[\s-]/g, "").replace("xlarge", "xlarge");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L94",
    cellByVersion: { "9.1": "L183" },
    label: "vCenter Cluster Name",
    verifyLabelByVersion: { "9.1": "Cluster Name" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_fleet, ctx) => (ctx.cluster && ctx.cluster.name) || "",
    apply: (_fleet, ctx, value) => { if (ctx.cluster) ctx.cluster.name = String(value || ""); },
  },
  {
    sheet: "Deploy Management Domain", cell: "L103",
    cellByVersion: { "9.1": "L328" },
    label: "NSX Manager Appliance Size",
    verifyLabel: "Appliance Size",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["ExtraSmall", "Small", "Medium", "Large", "XLarge"],
    resolve: (_fleet, ctx) => {
      const entry = (ctx.cluster && (ctx.cluster.infraStack || []).find((e) => e.id === "nsxMgr"));
      return (entry && entry.size) || "";
    },
    apply: (_fleet, ctx, value) => {
      const entry = (ctx.cluster && (ctx.cluster.infraStack || []).find((e) => e.id === "nsxMgr"));
      if (entry) entry.size = String(value || "").trim();
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L116",
    cellByVersion: { "9.1": "L58" },
    label: "vSAN Architecture",
    verifyLabelByVersion: { "9.1": "Storage Option" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["vSAN-ESA", "vSAN-OSA"],
    resolve: (_fleet, ctx) => (ctx.cluster && ctx.cluster.host && ctx.cluster.host.vsanArchitecture) || "vSAN-ESA",
    apply: (_fleet, ctx, value) => {
      if (ctx.cluster) {
        ctx.cluster.host = ctx.cluster.host || {};
        ctx.cluster.host.vsanArchitecture = String(value || "").trim();
      }
    },
  },

  // ─── Theme 2 — vSAN data services (Deploy Mgmt L116-L122 / 9.1 L58+L60+L61+L190-L196) ─
  // Per-mgmt-cluster scope. 9.1 splits the block: storage/FTT/dedup near
  // the top (L58/L60/L61) while datastore + DIT rekey + NFS sit further
  // down (L190-L196). 9.0 keeps everything contiguous at L117-L122.
  {
    sheet: "Deploy Management Domain", cell: "L118",
    cellByVersion: { "9.1": "L60" },
    label: "Failures to Tolerate",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["1", "2"],
    resolve: (_f, ctx) => {
      const ftt = ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.ftt;
      return ftt === 2 ? "2" : "1";
    },
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      const n = parseInt(v, 10);
      ctx.cluster.storage.dataServices.ftt = (n === 2) ? 2 : 1;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L119",
    cellByVersion: { "9.1": "L61" },
    label: "vSAN Dedup and Compression",
    verifyLabelByVersion: { "9.0": "Enable vSAN Deduplication and Compression", "9.1": "Activate vSAN Deduplication and Compression" },
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["Selected", "Unselected"],
    resolve: (_f, ctx) => {
      const on = ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.dedupCompressionEnabled === true;
      return on ? "Selected" : "Unselected";
    },
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.dedupCompressionEnabled = String(v || "").trim().toLowerCase() === "selected";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L117",
    cellByVersion: { "9.1": "L190" },
    label: "vSAN Datastore Name",
    verifyLabel: "Datastore Name",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_f, ctx) => (ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.datastoreName) || "",
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.datastoreName = String(v || "");
    },
  },
  {
    // DIT Rekey mode — 9.1 only (no equivalent cell in 9.0)
    sheet: "Deploy Management Domain", cell: "L191",
    label: "DIT Rekey Mode",
    verifyLabel: "Rekey mode",
    workbookVersions: ["9.1"],
    scope: "mgmt-cluster",
    resolve: (_f, ctx) => (ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.dit && ctx.cluster.storage.dataServices.dit.rekeyMode) || "Default",
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.dit = ctx.cluster.storage.dataServices.dit || { ...baseStorageDataServices().dit };
      const s = String(v || "").trim();
      ctx.cluster.storage.dataServices.dit.rekeyMode = s === "Custom" ? "Custom" : "Default";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L192",
    label: "DIT Rekey Interval (Default)",
    verifyLabel: "Rekey interval - Default",
    workbookVersions: ["9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["6 Hours", "12 hours", "1 Day", "3 Days", "7 Days"],
    resolve: (_f, ctx) => (ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.dit && ctx.cluster.storage.dataServices.dit.rekeyInterval) || "1 Day",
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.dit = ctx.cluster.storage.dataServices.dit || { ...baseStorageDataServices().dit };
      ctx.cluster.storage.dataServices.dit.rekeyInterval = String(v || "1 Day");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L193",
    label: "DIT Rekey Interval (Custom hours)",
    verifyLabel: "Rekey interval - Custom",
    workbookVersions: ["9.1"],
    scope: "mgmt-cluster",
    resolve: (_f, ctx) => {
      const h = ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.dit && ctx.cluster.storage.dataServices.dit.rekeyHoursCustom;
      return (h === null || h === undefined || h === "") ? "" : String(h);
    },
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.dit = ctx.cluster.storage.dataServices.dit || { ...baseStorageDataServices().dit };
      const n = parseInt(v, 10);
      ctx.cluster.storage.dataServices.dit.rekeyHoursCustom = Number.isFinite(n) ? n : 1440;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L120",
    cellByVersion: { "9.1": "L194" },
    label: "NFS Share Path",
    verifyLabel: "Path to NFS Share",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_f, ctx) => (ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.nfs && ctx.cluster.storage.dataServices.nfs.sharePath) || "",
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.nfs = ctx.cluster.storage.dataServices.nfs || { ...baseStorageDataServices().nfs };
      ctx.cluster.storage.dataServices.nfs.sharePath = String(v || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L121",
    cellByVersion: { "9.1": "L195" },
    label: "NFS Server IP",
    verifyLabel: "NFS Server IP Address",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_f, ctx) => (ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.nfs && ctx.cluster.storage.dataServices.nfs.serverIp) || "",
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.nfs = ctx.cluster.storage.dataServices.nfs || { ...baseStorageDataServices().nfs };
      ctx.cluster.storage.dataServices.nfs.serverIp = String(v || "");
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L122",
    cellByVersion: { "9.1": "L196" },
    label: "NFS Bound to vmknic",
    verifyLabel: "NFS Datastore with datastore bound to vmknic",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    dataValidation: ["Selected", "Unselected"],
    resolve: (_f, ctx) => {
      const bound = ctx.cluster && ctx.cluster.storage && ctx.cluster.storage.dataServices && ctx.cluster.storage.dataServices.nfs && ctx.cluster.storage.dataServices.nfs.boundToVmknic !== false;
      return bound ? "Selected" : "Unselected";
    },
    apply: (_f, ctx, v) => {
      if (!ctx.cluster) return;
      ctx.cluster.storage = ctx.cluster.storage || { ...baseStorageSettings() };
      ctx.cluster.storage.dataServices = ctx.cluster.storage.dataServices || baseStorageDataServices();
      ctx.cluster.storage.dataServices.nfs = ctx.cluster.storage.dataServices.nfs || { ...baseStorageDataServices().nfs };
      ctx.cluster.storage.dataServices.nfs.boundToVmknic = String(v || "").trim().toLowerCase() === "selected";
    },
  },

  // ─── mgmt-cluster-host scope (16-row host FQDN expansion) ──────────────
  // 9.0 and 9.1 use different cellPattern bases (host block moved 9.0 L128
  // → 9.1 L82). The resolver picks the version-specific cellPattern via
  // cellPatternByVersion when present.
  {
    sheet: "Deploy Management Domain",
    cellPattern: "L{128+i}",
    cellPatternByVersion: { "9.1": "L{82+i}" },
    label: "Host #{i+1} FQDN",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster-host",
    expandsTo: 16,
    resolve: (fleet, ctx, i) => {
      const hn = (resolveHostname && resolveHostname(fleet, ctx.instance, ctx.domain, ctx.cluster, i)) || "";
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      return hn && dn ? `${hn}.${dn}` : (hn || "");
    },
    // Round-trip apply: strip the DNS suffix off the FQDN and persist the
    // bare hostname on cluster.hostOverrides[i]. Lets a stamped workbook
    // re-import without losing per-host customizations. If no DNS domain
    // is set on the fleet, the entire value is treated as the hostname.
    apply: (fleet, ctx, value, i) => {
      if (!ctx.cluster) return;
      const raw = String(value || "").trim();
      if (!raw) return;
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      let hostname = raw;
      if (dn && raw.toLowerCase().endsWith("." + dn.toLowerCase())) {
        hostname = raw.slice(0, raw.length - dn.length - 1);
      }
      ctx.cluster.hostOverrides = ctx.cluster.hostOverrides || [];
      while (ctx.cluster.hostOverrides.length <= i) {
        ctx.cluster.hostOverrides.push(typeof createHostIpOverride === "function" ? createHostIpOverride() : {});
      }
      ctx.cluster.hostOverrides[i] = ctx.cluster.hostOverrides[i] || {};
      ctx.cluster.hostOverrides[i].hostname = hostname;
    },
  },

  // ─── initial-instance-mgmt-cluster scope (9.1 VCFMS, fleet-scope) ──────
  //
  // Note on the four "*FQDN" entries below: each emits a value derived from
  // (instance.name | fixed prefix) + fleet DNS suffix. These are
  // intentionally emit-only — the studio doesn't persist FQDNs; they're
  // recomputed at allocation time from the instance name + naming
  // template + DNS suffix, all of which round-trip via other cell-map
  // entries (VCF Instance Name, DNS Domain name). Adding apply here would
  // duplicate state with no benefit.
  {
    sheet: "Deploy Management Domain", cell: "L168",
    label: "Instance Components FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    emitOnly: true,
    resolve: (fleet, ctx) => {
      const inst = ctx.instance;
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      const base = inst && inst.name ? `${inst.name}-ic` : "instance-components";
      return dn ? `${base}.${dn}` : base;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L169",
    label: "Identity Broker FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    emitOnly: true,
    resolve: (fleet) => {
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      return dn ? `idb.${dn}` : "idb";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L170",
    label: "VCF services runtime FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    emitOnly: true,
    resolve: (fleet) => {
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      return dn ? `vcfa-sr.${dn}` : "vcfa-sr";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L176",
    label: "VCF Automation services runtime FQDN",
    verifyLabel: "VCF services runtime FQDN",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    emitOnly: true,
    resolve: (fleet) => {
      const dn = (fleet.networkConfig && fleet.networkConfig.dns && fleet.networkConfig.dns.primaryDomain) || "";
      return dn ? `vcfa-auto-sr.${dn}` : "vcfa-auto-sr";
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L117",
    label: "VCFMS Node IPv4 IP Range — From",
    verifyLabel: "IPv4 address Range From",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const pool = ctx.cluster && ctx.cluster.networks && ctx.cluster.networks.mgmt && ctx.cluster.networks.mgmt.pool;
      return (pool && pool.start) || "";
    },
    apply: (_fleet, ctx, value) => {
      if (!ctx.cluster) return;
      ctx.cluster.networks = ctx.cluster.networks || {};
      ctx.cluster.networks.mgmt = ctx.cluster.networks.mgmt || {};
      ctx.cluster.networks.mgmt.pool = ctx.cluster.networks.mgmt.pool || {};
      ctx.cluster.networks.mgmt.pool.start = String(value || "").trim();
    },
  },
  {
    // Emit-only: derived from pool.start + worker/control counts (which
    // round-trip via the VCFMS Node IPv4 From entry + the stack entry
    // counts persisted on the cluster's infraStack).
    sheet: "Deploy Management Domain", cell: "L118",
    label: "VCFMS Node IPv4 IP Range — To",
    verifyLabel: "IPv4 address Range To",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    emitOnly: true,
    resolve: (_fleet, ctx) => {
      // Derive: start + (control + worker + small headroom) - 1.
      // Honors user-customized vcfmsWorker.instances counts (not just 3/4 default).
      const pool = ctx.cluster && ctx.cluster.networks && ctx.cluster.networks.mgmt && ctx.cluster.networks.mgmt.pool;
      const start = pool && pool.start;
      if (!start || typeof ipToInt !== "function" || typeof intToIp !== "function") return "";
      const ctrl = ((ctx.cluster.infraStack || []).find((e) => e.id === "vcfmsControl") || {}).instances || 3;
      const wkr  = ((ctx.cluster.infraStack || []).find((e) => e.id === "vcfmsWorker")  || {}).instances || 3;
      const headroom = 2;
      return intToIp(ipToInt(start) + ctrl + wkr + headroom - 1);
    },
  },

  // ─── Network rows on mgmt-cluster ─────────────────────────────────────
  // 9.1 inserted VCF Management Network (L111-L115) and VCFMS / VCF
  // Automation IP Range sub-sections (L116-L123), pushing every
  // downstream VLAN row up by ~46 rows. Workbook labels these as bare
  // "VLAN ID" because the network type lives in the section sub-header
  // one row above; verify-cell-map uses verifyLabel to match.
  {
    sheet: "Deploy Management Domain", cell: "L148",
    cellByVersion: { "9.1": "L102" },
    label: "ESX Mgmt VLAN ID",
    verifyLabel: "VLAN ID",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const n = ctx.cluster && ctx.cluster.networks && ctx.cluster.networks.mgmt;
      return (n && n.vlan != null) ? String(n.vlan) : "";
    },
    apply: (_fleet, ctx, value) => {
      if (!ctx.cluster) return;
      ctx.cluster.networks = ctx.cluster.networks || {};
      ctx.cluster.networks.mgmt = ctx.cluster.networks.mgmt || {};
      const n = Number(value);
      if (Number.isFinite(n)) ctx.cluster.networks.mgmt.vlan = n;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L159",
    cellByVersion: { "9.1": "L125" },
    label: "vMotion VLAN ID",
    verifyLabel: "VLAN ID",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const n = ctx.cluster && ctx.cluster.networks && ctx.cluster.networks.vmotion;
      return (n && n.vlan != null) ? String(n.vlan) : "";
    },
    apply: (_fleet, ctx, value) => {
      if (!ctx.cluster) return;
      ctx.cluster.networks = ctx.cluster.networks || {};
      ctx.cluster.networks.vmotion = ctx.cluster.networks.vmotion || {};
      const n = Number(value);
      if (Number.isFinite(n)) ctx.cluster.networks.vmotion.vlan = n;
    },
  },
  {
    sheet: "Deploy Management Domain", cell: "L166",
    cellByVersion: { "9.1": "L133" },
    label: "vSAN VLAN ID",
    verifyLabel: "VLAN ID",
    workbookVersions: ["9.0", "9.1"],
    scope: "mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const n = ctx.cluster && ctx.cluster.networks && ctx.cluster.networks.vsan;
      return (n && n.vlan != null) ? String(n.vlan) : "";
    },
    apply: (_fleet, ctx, value) => {
      if (!ctx.cluster) return;
      ctx.cluster.networks = ctx.cluster.networks || {};
      ctx.cluster.networks.vsan = ctx.cluster.networks.vsan || {};
      const n = Number(value);
      if (Number.isFinite(n)) ctx.cluster.networks.vsan.vlan = n;
    },
  },

  // ─── workload-domain scope (sample row from Deploy WLD sheet) ──────────
  // Workload Domain Name lives at D23 in both 9.0 and 9.1. Earlier draft
  // pinned this at L38 — wrong column entirely; the sheet uses B=label,
  // D=value (same convention as Configure Workload Domain).
  {
    sheet: "Deploy Workload Domain", cell: "D23",
    label: "Workload domain name",
    verifyLabel: "Workload Domain Name",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-domain",
    resolve: (_fleet, ctx) => (ctx.domain && ctx.domain.name) || "",
    apply: (_fleet, ctx, value) => { if (ctx.domain) ctx.domain.name = String(value || ""); },
  },

  // ─── workload-cluster scope (NSX Edge from WLD's first cluster) ────────
  // Edge Cluster Name at D38 on Configure Workload Domain (both versions).
  {
    sheet: "Configure Workload Domain", cell: "D38",
    label: "NSX Edge Cluster Name",
    verifyLabel: "Edge Cluster Name",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      return (t0 && t0.clusterName) || (ctx.cluster && ctx.cluster.name) || "";
    },
    // Round-trip applies to t0Gateways[0].clusterName when a T0 exists;
    // otherwise the WLD cluster name itself (matches the resolver's
    // fallback). On import we never auto-create a T0 — importing T0/BGP
    // topology from the workbook is out of scope here.
    apply: (_fleet, ctx, value) => {
      if (!ctx.cluster) return;
      const name = String(value || "").trim();
      if (!name) return;
      const t0 = (ctx.cluster.t0Gateways || [])[0];
      if (t0) t0.clusterName = name;
      else ctx.cluster.name = name;
    },
  },

  // ─── T0 BGP / routing detail (Theme 5 — export-only) ───────────────────
  //
  // The UI editors in vcf-design-studio-v9.jsx (Theme 5a, PR #52) populate
  // t0Gateways[0].{asnLocal, bgpPeers[]} on the mgmt and workload first
  // clusters. This block stamps them into the Configure Management Domain
  // and Configure Workload Domain sheets.
  //
  // Slot mapping: peer index 0 → uplink #1 (AZ1 TOR1), peer index 1 →
  // uplink #2 (AZ1 TOR2). Slots 3+4 (AZ2 stretched) are not yet exported —
  // they need stretched-cluster AZ2 peer modeling (a future theme).
  //
  // The Gateway Interface VLAN + Gateway Interface IP rows in the workbook
  // are also not exported here: those source from cluster.networks.uplinks[]
  // which has no UI input today (per the project's "every exported field
  // must have a UI input" rule).
  //
  // 9.1 added two rows above the routing-type cell (Gateway Name + HA Mode),
  // shifting every subsequent row down by 3. cellByVersion captures this.

  // T0 Local ASN — Mgmt
  {
    sheet: "Configure Management Domain", cell: "D156", cellByVersion: { "9.1": "D159" },
    label: "T0 Local ASN (Mgmt)",
    verifyLabel: "ASN",
    workbookVersions: ["9.0", "9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      return (t0 && t0.asnLocal != null) ? t0.asnLocal : "";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const s = String(value || "").trim();
      if (!s) { t0.asnLocal = null; return; }
      const n = parseInt(s, 10);
      t0.asnLocal = Number.isFinite(n) ? n : null;
    },
  },
  // T0 Local ASN — WLD
  {
    sheet: "Configure Workload Domain", cell: "D99", cellByVersion: { "9.1": "D102" },
    label: "T0 Local ASN (WLD)",
    verifyLabel: "ASN",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      return (t0 && t0.asnLocal != null) ? t0.asnLocal : "";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const s = String(value || "").trim();
      if (!s) { t0.asnLocal = null; return; }
      const n = parseInt(s, 10);
      t0.asnLocal = Number.isFinite(n) ? n : null;
    },
  },

  // Gateway Routing Type — Mgmt (BGP / STATIC enum; maps bgpEnabled flag)
  {
    sheet: "Configure Management Domain", cell: "D155", cellByVersion: { "9.1": "D158" },
    label: "T0 Gateway Routing Type (Mgmt)",
    verifyLabel: "Gateway Routing Type",
    workbookVersions: ["9.0", "9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      if (!t0) return "";
      return t0.bgpEnabled ? "BGP" : "STATIC";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const v = String(value || "").trim().toUpperCase();
      if (v === "BGP") t0.bgpEnabled = true;
      else if (v === "STATIC") t0.bgpEnabled = false;
    },
  },
  // Gateway Routing Type — WLD
  {
    sheet: "Configure Workload Domain", cell: "D98", cellByVersion: { "9.1": "D101" },
    label: "T0 Gateway Routing Type (WLD)",
    verifyLabel: "Gateway Routing Type",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      if (!t0) return "";
      return t0.bgpEnabled ? "BGP" : "STATIC";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const v = String(value || "").trim().toUpperCase();
      if (v === "BGP") t0.bgpEnabled = true;
      else if (v === "STATIC") t0.bgpEnabled = false;
    },
  },

  // T0 Gateway Name + HA Mode (9.1-only; 9.0 doesn't carry these rows)
  {
    sheet: "Configure Management Domain", cell: "D156",
    label: "T0 Gateway Name (Mgmt)",
    verifyLabel: "Gateway Name",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      return (t0 && t0.name) || "";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const name = String(value || "").trim();
      if (name) t0.name = name;
    },
  },
  {
    sheet: "Configure Management Domain", cell: "D157",
    label: "T0 HA Mode (Mgmt)",
    verifyLabel: "High Availability Mode",
    workbookVersions: ["9.1"],
    scope: "initial-instance-mgmt-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      if (!t0) return "";
      if (t0.haMode === "active-active") return "Active Active";
      if (t0.haMode === "active-standby") return "Active Standby";
      return "";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const v = String(value || "").trim().toLowerCase();
      if (v === "active active") t0.haMode = "active-active";
      else if (v === "active standby") t0.haMode = "active-standby";
    },
  },
  {
    sheet: "Configure Workload Domain", cell: "D99",
    label: "T0 Gateway Name (WLD)",
    verifyLabel: "Gateway Name",
    workbookVersions: ["9.1"],
    scope: "workload-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      return (t0 && t0.name) || "";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const name = String(value || "").trim();
      if (name) t0.name = name;
    },
  },
  {
    sheet: "Configure Workload Domain", cell: "D100",
    label: "T0 HA Mode (WLD)",
    verifyLabel: "High Availability Mode",
    workbookVersions: ["9.1"],
    scope: "workload-cluster",
    resolve: (_fleet, ctx) => {
      const t0 = ctx.cluster && (ctx.cluster.t0Gateways || [])[0];
      if (!t0) return "";
      if (t0.haMode === "active-active") return "Active Active";
      if (t0.haMode === "active-standby") return "Active Standby";
      return "";
    },
    apply: (_fleet, ctx, value) => {
      const t0 = _ensureT0OnCluster(ctx.cluster, value);
      if (!t0) return;
      const v = String(value || "").trim().toLowerCase();
      if (v === "active active") t0.haMode = "active-active";
      else if (v === "active standby") t0.haMode = "active-standby";
    },
  },

  // ─── Per-peer BGP detail (slots 1+2 = AZ1 TOR1 + TOR2; slots 3+4 = AZ2,
  //     deferred until stretched-cluster AZ2 model lands). Each slot has
  //     4 user-input cells: Peer IP, Peer ASN, MTU, BFD. Order between
  //     9.0 and 9.1 differs (9.1 swapped MTU and BFD), so we use per-entry
  //     cellByVersion overrides rather than a uniform offset.

  // Helpers materialized inline (no closures over loop indexes — each
  // entry's resolve/apply hard-codes the peerIdx it owns).
  ..._buildBgpPeerCellMapEntries(),

  // ─── additional-cluster scope (Sheet "Deploy Cluster") ─────────────────
  // The new-cluster name field is at D19 in both 9.0 and 9.1 (workbook
  // labels it bare "Name"; sub-section header above is "Workload Domain
  // Name" / "Configuration").
  {
    sheet: "Deploy Cluster", cell: "D19",
    label: "Additional Cluster Name",
    verifyLabel: "Name",
    workbookVersions: ["9.0", "9.1"],
    scope: "additional-cluster",
    resolve: (_fleet, ctx) => (ctx.cluster && ctx.cluster.name) || "",
    apply: (_fleet, ctx, value) => { if (ctx.cluster) ctx.cluster.name = String(value || ""); },
  },

  // ─── Auto-generate password toggles ────────────────────────────────────
  //
  // Broadcom built five toggle cells into the workbook that delegate
  // password generation to VCF Lifecycle Manager at deploy time. Setting
  // them to "Selected" means the studio doesn't have to supply ~52 of the
  // ~70 user-input password cells; VCF creates and rotates them itself.
  // The remaining ~18 user-input cells (ESX root, BGP peers, SSO admin/user,
  // Encryption Passphrase, vSAN witness root) require user-supplied values
  // regardless of toggle state.
  //
  // These entries are emit-only — they only ever stamp "Selected" on
  // export and don't read back on import (auto-generate toggle state is
  // an export-time choice, not a studio-persisted setting).
  {
    sheet: "Deploy Management Domain", cell: "L296",
    cellByVersion: { "9.0": "L49" },
    label: "Auto-generate passwords for newly installed appliances",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    emitOnly: true,
    dataValidation: ["Selected", "Unselected"],
    resolve: () => "Selected",
  },
  {
    sheet: "Configure Management Domain", cell: "D152",
    cellByVersion: { "9.0": "D148" },
    label: "Auto generate passwords with VCF to manage Edge node",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    emitOnly: true,
    dataValidation: ["Selected", "Unselected"],
    resolve: () => "Selected",
  },
  {
    sheet: "Deploy Workload Domain", cell: "D47",
    label: "Auto Generate Passwords",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-domain",
    emitOnly: true,
    dataValidation: ["Selected", "Unselected"],
    resolve: () => "Selected",
  },
  {
    sheet: "Deploy Workload Domain", cell: "D357",
    cellByVersion: { "9.0": "D151" },
    label: "Auto-generate my passwords for newly installed appliances",
    verifyLabel: "Auto-generate",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-domain",
    emitOnly: true,
    dataValidation: ["Selected", "Unselected"],
    resolve: () => "Selected",
  },
  {
    sheet: "Configure Workload Domain", cell: "D95",
    cellByVersion: { "9.0": "D91" },
    label: "Auto generate passwords and manage them via VCF Ops",
    verifyLabel: "Auto generate passwords",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-cluster",
    emitOnly: true,
    dataValidation: ["Selected", "Unselected"],
    resolve: () => "Selected",
  },

  // ─── Password cell entries (passwordKind only; no resolve/apply) ──────
  //
  // The studio never emits a password through the normal resolve path;
  // emitWorkbookCellMap explicitly skips entries whose `passwordKind` is
  // set. Instead, the generator path (`generateWorkbookVault`) walks
  // these entries, synthesizes per-cell passwords against PASSWORD_POLICY,
  // and the export-with-passwords flow stamps them into the .xlsx.
  //
  // `resolve` returns "" so the cell-map's schema invariant
  // ("every entry has a resolve fn") holds. These rows do NOT show up
  // in the regular cell-map CSV / .xlsx export.
  //
  // Cells are grouped by appliance/credential type so the vault file's
  // sorted output keeps related credentials together.

  // --- ESX root password (mgmt domain) — Camp B (user must supply)
  {
    sheet: "Deploy Management Domain", cell: "L127",
    cellByVersion: { "9.1": "L81" },
    label: "ESX Root Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "esx-root",
    emitOnly: true,
    resolve: () => "",
  },

  // --- VCF Operations passwords (Camp A — covered by auto-gen but
  //     studio can still generate if user opts into the vault flow)
  {
    sheet: "Deploy Management Domain", cell: "L60", cellByVersion: { "9.1": "L298" },
    label: "VCF Ops Administrator Password",
    verifyLabel: "Administrator Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "ops-admin",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Deploy Management Domain", cell: "L61", cellByVersion: { "9.1": "L299" },
    label: "VCF Ops Root Password",
    verifyLabel: "Root Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "ops-root",
    emitOnly: true,
    resolve: () => "",
  },

  // --- vCenter Server Root Password (Camp A)
  {
    sheet: "Deploy Management Domain", cell: "L72", cellByVersion: { "9.1": "L301" },
    label: "vCenter Server Root Password",
    verifyLabel: "Root Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "vcenter-root",
    emitOnly: true,
    resolve: () => "",
  },

  // --- NSX Manager passwords (Camp A) — admin / root / audit on node 1
  //     (nodes 2 + 3 inherit via formula cells we deliberately skip)
  {
    sheet: "Configure Management Domain", cell: "D406", cellByVersion: { "9.1": "D477" },
    label: "NSX Manager System Root User Password (Node 1)",
    verifyLabel: "System Root User Password (Node 1)",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "nsx-root",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Configure Management Domain", cell: "D407", cellByVersion: { "9.1": "D478" },
    label: "NSX Manager CLI admin User Password (Node 1)",
    verifyLabel: "CLI \"admin\" User Password (Node 1)",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "nsx-admin",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Configure Management Domain", cell: "D408", cellByVersion: { "9.1": "D479" },
    label: "NSX Manager CLI audit User Password (Node 1)",
    verifyLabel: "CLI \"audit\" User Password (Node 1)",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "nsx-audit",
    emitOnly: true,
    resolve: () => "",
  },

  // --- SDDC Manager passwords (Camp A) — root + VCF + admin
  {
    sheet: "Deploy Management Domain", cell: "L267", cellByVersion: { "9.1": "L315" },
    label: "SDDC Manager Root Password",
    verifyLabel: "Root Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "sddc-root",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Deploy Management Domain", cell: "L268", cellByVersion: { "9.1": "L316" },
    label: "SDDC Manager VCF Password",
    verifyLabel: "VCF Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "sddc-vcf",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Deploy Management Domain", cell: "L269", cellByVersion: { "9.1": "L317" },
    label: "SDDC Manager Administrator Password",
    verifyLabel: "Administrator Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "sddc-admin",
    emitOnly: true,
    resolve: () => "",
  },

  // --- BGP peer passwords (Camp B — user must coordinate with router team)
  {
    sheet: "Configure Management Domain", cell: "D164", cellByVersion: { "9.1": "D167" },
    label: "BGP Peer Password (Mgmt #1)",
    verifyLabel: "BGP Peer Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "bgp-peer",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Configure Management Domain", cell: "D171", cellByVersion: { "9.1": "D174" },
    label: "BGP Peer Password (Mgmt #2)",
    verifyLabel: "BGP Peer Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "bgp-peer",
    emitOnly: true,
    resolve: () => "",
  },

  // --- Encryption Passphrase (Camp B — recovery secret)
  {
    sheet: "Configure Management Domain", cell: "D28", cellByVersion: { "9.1": "D29" },
    label: "Encryption Passphrase",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "encryption-passphrase",
    emitOnly: true,
    resolve: () => "",
  },

  // --- vSAN Witness root password (Camp B): the workbook's
  //     vsan_witness_root_password cells (D332 / D403 / D384) are
  //     FORMULAS, not user-input. The witness appliance root password
  //     is set out-of-band when the witness OVA is deployed, not
  //     through the workbook. Keep the "vsan-witness-root" entry in
  //     PASSWORD_POLICY for future use (e.g. if Broadcom adds a
  //     user-input cell for it) but no cell-map entry today.

  // --- SSO passwords (Camp B) — workload-domain scope
  {
    sheet: "Deploy Workload Domain", cell: "D32",
    label: "SSO User Password (WLD)",
    verifyLabel: "SSO user password",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-domain",
    passwordKind: "sso-user",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Deploy Workload Domain", cell: "D152", cellByVersion: { "9.1": "D359" },
    label: "SSO Administration Password (WLD)",
    verifyLabel: "SSO Administration Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "workload-domain",
    passwordKind: "sso-admin",
    emitOnly: true,
    resolve: () => "",
  },

  // --- Edge node passwords (Camp A) — Configure Mgmt sheet
  {
    sheet: "Configure Management Domain", cell: "D149", cellByVersion: { "9.1": "D153" },
    label: "NSX Edge Root Password (Mgmt)",
    verifyLabel: "Edge Root Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "edge-root",
    emitOnly: true,
    resolve: () => "",
  },
  {
    sheet: "Configure Management Domain", cell: "D150", cellByVersion: { "9.1": "D154" },
    label: "NSX Edge Admin Password (Mgmt)",
    verifyLabel: "Edge Admin Password",
    workbookVersions: ["9.0", "9.1"],
    scope: "instance",
    passwordKind: "edge-admin",
    emitOnly: true,
    resolve: () => "",
  },

  // --- per-fleet scope (rare today; left as a marker for AD/HCX in Phase 5) ─
  // No entries today — Phase 5 will add when fleet.adConfig / fleet.hcxConfig
  // exist in the data model.
];

// Given a cluster, return all issues against VCF-INV-060..065. Each entry has
// { ruleId, severity: "critical"|"warn", message }. Empty array = clean.
function validateT0Gateways(cluster) {
  const issues = [];
  const t0s = cluster?.t0Gateways || [];

  // VCF-INV-061 — count how many T0s reference each edge key
  const edgeT0Map = new Map();
  for (const t0 of t0s) {
    for (const k of t0.edgeNodeKeys || []) {
      edgeT0Map.set(k, (edgeT0Map.get(k) || 0) + 1);
    }
  }
  for (const [k, count] of edgeT0Map.entries()) {
    if (count > T0_MAX_T0S_PER_EDGE_NODE) {
      issues.push({
        ruleId: "VCF-INV-061",
        severity: "critical",
        message: `Edge node ${k} hosts ${count} T0 gateways (max ${T0_MAX_T0S_PER_EDGE_NODE})`,
      });
    }
  }

  for (const t0 of t0s) {
    const mode = T0_HA_MODES[t0.haMode];
    if (!mode) {
      issues.push({
        ruleId: "VCF-INV-060",
        severity: "critical",
        message: `T0 ${t0.name}: unknown haMode "${t0.haMode}"`,
      });
      continue;
    }
    const nodeCount = (t0.edgeNodeKeys || []).length;

    // VCF-INV-060 — edge-node count limit per HA mode
    if (nodeCount > mode.maxEdgeNodes) {
      issues.push({
        ruleId: "VCF-INV-060",
        severity: "critical",
        message: `T0 ${t0.name} in ${t0.haMode} mode has ${nodeCount} Edge nodes (max ${mode.maxEdgeNodes})`,
      });
    }

    // VCF-INV-062 — stateful A/A requires even count ≥ 2
    if (t0.haMode === "active-active" && t0.stateful) {
      if (nodeCount < 2 || nodeCount % 2 !== 0) {
        issues.push({
          ruleId: "VCF-INV-062",
          severity: "critical",
          message: `T0 ${t0.name}: stateful A/A requires an EVEN number of Edge nodes (2, 4, 6, or 8); have ${nodeCount}`,
        });
      }
      // VCF-INV-064 — stateful A/A not producible via Installer/wizard
      issues.push({
        ruleId: "VCF-INV-064",
        severity: "warn",
        message: `T0 ${t0.name}: stateful A/A requires Day-2 NSX Manager UI configuration (interface groups + sub-cluster pairs). Not producible via VCF Installer or vCenter guided Edge wizard.`,
      });
    }

    // VCF-INV-063 — A/A cannot satisfy VKS/Automation All-Apps requirement
    if (t0.haMode === "active-active"
        && (t0.featureRequirements || []).some((f) => ["vks", "vcfAutomationAllApps"].includes(f))) {
      issues.push({
        ruleId: "VCF-INV-063",
        severity: "critical",
        message: `T0 ${t0.name}: VKS / VCF Automation All-Apps require an Active/Standby T0`,
      });
    }

    // VCF-INV-065 — A/A uplink accounting: each Edge node may have up to
    // T0_MAX_UPLINKS_PER_EDGE_AA (2) uplinks; total per T0 capped at
    // 8 edges × 2 = 16 uplinks. Only evaluated for A/A; A/S is capped
    // earlier by VCF-INV-060 at 2 edge nodes.
    if (t0.haMode === "active-active") {
      const uplinks = t0.uplinksPerEdge || [];
      // Any explicitly-set value above the per-node cap
      for (let i = 0; i < uplinks.length; i++) {
        const n = uplinks[i];
        if (typeof n === "number" && n > T0_MAX_UPLINKS_PER_EDGE_AA) {
          issues.push({
            ruleId: "VCF-INV-065",
            severity: "critical",
            message: `T0 ${t0.name}: Edge node index ${i} configured with ${n} uplinks (max ${T0_MAX_UPLINKS_PER_EDGE_AA} per Edge node in A/A)`,
          });
        }
      }
      // Total uplinks across the T0 capped at maxEdgeNodes × 2 = 16
      const totalUplinks = uplinks.reduce((s, n) => s + (typeof n === "number" ? n : 0), 0);
      const maxTotal = mode.maxEdgeNodes * T0_MAX_UPLINKS_PER_EDGE_AA;
      if (totalUplinks > maxTotal) {
        issues.push({
          ruleId: "VCF-INV-065",
          severity: "critical",
          message: `T0 ${t0.name}: total A/A uplinks = ${totalUplinks} (max ${maxTotal} = ${mode.maxEdgeNodes} edge nodes × ${T0_MAX_UPLINKS_PER_EDGE_AA})`,
        });
      }
      // Informational: uplinksPerEdge array longer than edgeNodeKeys
      if (uplinks.length > (t0.edgeNodeKeys || []).length) {
        issues.push({
          ruleId: "VCF-INV-065",
          severity: "info",
          message: `T0 ${t0.name}: uplinksPerEdge has ${uplinks.length} entries but only ${(t0.edgeNodeKeys || []).length} edge nodes are bound`,
        });
      }
    }
  }

  return issues;
}

const DR_POSTURES = {
  active: {
    ruleId: null,
    label: "Active",
    description: "Instance runs its full appliance stack in steady-state.",
  },
  "warm-standby": {
    ruleId: "VCF-DR-001",
    label: "Warm Standby",
    description: "Instance is a VLR/SRM replication target. Fleet-level services remain dormant until failover is triggered (VCF-DR-040).",
  },
};

// Components that VLR/vSphere Replication protects per VCF-DR-010.
const DR_REPLICATED_COMPONENTS = ["vcfOps", "fleetMgr", "vcfOpsLogs", "vcfOpsNet", "vcfmsControl", "vcfmsWorker"];
// Components that use backup/restore instead of active replication per VCF-DR-020.
const DR_BACKUP_COMPONENTS = ["vcfAuto", "identityBroker"];

function isWarmStandby(instance) {
  return instance?.drPosture === "warm-standby";
}

// Count per-fleet appliance entries on ACTIVE instances only — warm-standby
// placeholders don't count toward VCF-INV-010. Used by the invariant test.
function countActivePerFleetEntries(fleet, applianceId) {
  let n = 0;
  for (const inst of fleet?.instances || []) {
    if (isWarmStandby(inst)) continue;
    for (const dom of inst.domains || []) {
      for (const clu of dom.clusters || []) {
        for (const e of clu.infraStack || []) {
          if (e.id === applianceId) n += 1;
        }
      }
    }
  }
  return n;
}

const SSO_MODES = {
  embedded: {
    ruleId: "VCF-SSO-001",
    label: "Embedded (per-instance)",
    description: "Each instance runs an embedded broker inside its own vCenter. Smallest blast radius; recommended for single-instance fleets.",
  },
  "fleet-wide": {
    ruleId: "VCF-SSO-002",
    label: "Fleet-Wide (single broker)",
    description: "One 3-node broker cluster serves the whole fleet, deployed on the initial instance. Recommended for up to 5 instances.",
  },
  "multi-broker": {
    ruleId: "VCF-SSO-003",
    label: "Cross-Instance (multi-broker)",
    description: "Multiple broker clusters, each serving a subset of instances. For >5 instances or per-region identity isolation.",
  },
};

// Infer the right SSO mode for a legacy fleet: single-instance → embedded,
// multi-instance → fleet-wide (users can upgrade to multi-broker explicitly).
function inferSsoMode(fleet) {
  if (fleet?.ssoMode && SSO_MODES[fleet.ssoMode]) return fleet.ssoMode;
  const n = fleet?.instances?.length || 0;
  return n > 1 ? "fleet-wide" : "embedded";
}

// VCF-INV-031 instance-per-broker threshold. Returns { overBrokerCount }:
// if true, the fleet exceeds the recommended 5 instances per broker and
// should consider multi-broker segmentation. Informational (not a hard fail).
const SSO_INSTANCES_PER_BROKER_LIMIT = 5;
function ssoInstancesPerBroker(fleet) {
  const mode = inferSsoMode(fleet);
  const instances = fleet?.instances?.length || 0;
  const brokers = mode === "multi-broker"
    ? (fleet?.ssoBrokers?.length || 0)
    : 1;
  const perBroker = brokers > 0 ? instances / brokers : Infinity;
  return {
    mode,
    instances,
    brokers,
    perBroker,
    overLimit: perBroker > SSO_INSTANCES_PER_BROKER_LIMIT,
  };
}

// VCF-INV-003 placement-constraint validator (Plan 5).
//
// Walks every workload domain's wldStack and emits a critical issue for any
// entry whose appliance has placementConstraint === "mgmt-only-greenfield"
// AND resolves to a workload-domain cluster AND the owning domain is not
// imported (brownfield).
//
// nsxEdge entries are flexible by Broadcom rule (VCF-APP-006) and are
// never flagged. vksSupervisor is wld-only by design and is also never
// flagged here.
//
// Resolution mirrors sizeInstance:
//   target = entry.placementClusterId ?? domain.componentsClusterId
//   wld    = target's id is in this WLD's clusters
//
// Returns: array of { ruleId, severity, message, instanceId, domainId, entryKey }.
function validatePlacementConstraints(fleet) {
  const issues = [];
  for (const inst of fleet?.instances || []) {
    const mgmtDomain = (inst.domains || []).find((d) => d.type === "mgmt");
    if (!mgmtDomain) continue;
    const mgmtClusterIds = new Set((mgmtDomain.clusters || []).map((c) => c.id));
    for (const dom of inst.domains || []) {
      if (dom.type !== "workload") continue;
      if (dom.imported) continue;
      const wldClusterIds = new Set((dom.clusters || []).map((c) => c.id));
      for (const entry of dom.wldStack || []) {
        const def = APPLIANCE_DB[entry.id];
        if (!def) continue;
        if (def.placementConstraint !== "mgmt-only-greenfield") continue;
        const targetId = entry.placementClusterId || dom.componentsClusterId;
        if (!targetId) continue;
        if (mgmtClusterIds.has(targetId)) continue;
        if (!wldClusterIds.has(targetId)) continue;
        issues.push({
          ruleId: "VCF-INV-003",
          severity: "critical",
          instanceId: inst.id,
          domainId: dom.id,
          entryKey: entry.key,
          message: `${def.label} for workload domain "${dom.name}" must run on a management-domain cluster (Broadcom VCF 9 placement rule). Mark the domain as Imported (brownfield) if this is intentional.`,
        });
      }
    }
  }
  return issues;
}

const DEPLOYMENT_PATHWAYS = {
  greenfield: {
    ruleId: "VCF-PATH-001",
    label: "Greenfield",
    description: "New fleet + new instance. VCF Installer deploys everything into a freshly-built mgmt cluster.",
  },
  expand: {
    ruleId: "VCF-PATH-002",
    label: "Expand Fleet",
    description: "Add an instance to an existing fleet. Fleet-level services are REUSED from the initial instance.",
  },
  converge: {
    ruleId: "VCF-PATH-003",
    label: "Converge",
    description: "Convert a non-VCF vCenter into a VCF mgmt cluster. Preserves existing vCenter + storage.",
  },
  import: {
    ruleId: "VCF-PATH-004",
    label: "Import Workload Domain",
    description: "Import an existing vCenter as a WORKLOAD DOMAIN into an existing VCF instance. No new mgmt appliances.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SCALE LIMITS & RECOMMENDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const SIZING_LIMITS = {
  vcenter: {
    Tiny:   { hosts: 10,   vms: 100,   label: "10 hosts / 100 VMs" },
    Small:  { hosts: 100,  vms: 1000,  label: "100 hosts / 1k VMs" },
    Medium: { hosts: 400,  vms: 4000,  label: "400 hosts / 4k VMs" },
    Large:  { hosts: 1000, vms: 10000, label: "1k hosts / 10k VMs" },
    XLarge: { hosts: 2000, vms: 35000, label: "2k hosts / 35k VMs" },
  },
  nsxMgr: {
    ExtraSmall: { hosts: 0,    clusters: 0,   label: "CSM only", production: false },
    Small:      { hosts: 0,    clusters: 0,   label: "PoC only", production: false },
    Medium:     { hosts: 128,  clusters: 5,   label: "128 hosts / 5 clusters", production: true },
    Large:      { hosts: 1024, clusters: 256, label: "1024 hosts / 256 clusters", production: true },
    XLarge:     { hosts: 2048, clusters: 512, label: "2048 hosts / 512 clusters", production: true },
  },
};

function recommendVcenterSize(hosts, vms) {
  for (const k of ["Tiny", "Small", "Medium", "Large", "XLarge"]) {
    const lim = SIZING_LIMITS.vcenter[k];
    if (hosts <= lim.hosts && vms <= lim.vms) return k;
  }
  return "XLarge";
}
function recommendNsxSize(hosts, clusters) {
  for (const k of ["Medium", "Large", "XLarge"]) {
    const lim = SIZING_LIMITS.nsxMgr[k];
    if (hosts <= lim.hosts && clusters <= lim.clusters) return k;
  }
  return "XLarge";
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTION POLICIES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const POLICIES = {
  raid5_2p1:   { label: "RAID-5 (2+1) FTT=1", pf: 1.50, minHosts: 3, ftt: 1 },
  raid5_4p1:   { label: "RAID-5 (4+1) FTT=1", pf: 1.25, minHosts: 6, ftt: 1 },
  raid6_4p2:   { label: "RAID-6 (4+2) FTT=2", pf: 1.50, minHosts: 6, ftt: 2 },
  mirror_ftt1: { label: "Mirror FTT=1",       pf: 2.00, minHosts: 3, ftt: 1 },
  mirror_ftt2: { label: "Mirror FTT=2",       pf: 3.00, minHosts: 5, ftt: 2 },
  mirror_ftt3: { label: "Mirror FTT=3",       pf: 4.00, minHosts: 7, ftt: 3 },
};

const TB_TO_TIB = 0.9095;
const TIB_PER_CORE = 1;
const NVME_TIER_PARTITION_CAP_GB = 4096;

// ─── NETWORK CONSTANTS ─────────────────────────────────────────────────────
const VLAN_ID_MIN = 1;
const VLAN_ID_MAX = 4094;
const MTU_MGMT = 1500;
const MTU_VMOTION = 9000;
const MTU_VSAN = 9000;
const MTU_TEP_MIN = 1600;
const MTU_TEP_RECOMMENDED = 1700;
const DEFAULT_BGP_ASN_AA = 65000;
const TEP_POOL_GROWTH_FACTOR = 1.25;

// ─── VCF VERSION SUPPORT ───────────────────────────────────────────────────
// _LEGACY: used by migrateFleet backfill for imports without a vcfVersion
// field (preserves snapshot stability for existing 9.0 fleets).
// _NEW:    used by the newFleet() factory in PR 2 once engine threading is
//          live, so brand-new fleets start on the latest shipping version.
const DEFAULT_VCF_VERSION_LEGACY = "9.0";
const DEFAULT_VCF_VERSION_NEW = "9.1";
const SUPPORTED_VCF_VERSIONS = ["9.0", "9.1"];

// ─── WORKBOOK INTEROP ──────────────────────────────────────────────────────
// Workbook versions the cell-map knows about. May diverge from
// SUPPORTED_VCF_VERSIONS if a new VCF release ships before its workbook
// (e.g. 9.2 sized via 9.1 workbook until Broadcom catches up).
const SUPPORTED_WORKBOOK_VERSIONS = ["9.0", "9.1"];

// fleet.vcfVersion → target workbook version. When 9.2 ships before its
// own workbook, add { "9.2": "9.1" } so 9.2 fleets export against 9.1.
const VCF_TO_WORKBOOK_VERSION = {
  "9.0": "9.0",
  "9.1": "9.1",
};

function workbookVersionForFleet(fleet) {
  const v = (fleet && fleet.vcfVersion) || DEFAULT_VCF_VERSION_LEGACY;
  return VCF_TO_WORKBOOK_VERSION[v] || v;
}

const NIC_PROFILES = {
  "2-nic": {
    nicCount: 2,
    uplinks: ["vmnic0", "vmnic1"],
    vds: [{ name: "vds-converged", uplinks: ["vmnic0", "vmnic1"], mtu: 9000 }],
    portgroups: { mgmt: "vds-converged", vmotion: "vds-converged", vsan: "vds-converged", hostTep: "vds-converged" },
    teaming: "loadBalanceSrcId",
  },
  "4-nic": {
    nicCount: 4,
    uplinks: ["vmnic0", "vmnic1", "vmnic2", "vmnic3"],
    vds: [
      { name: "vds-mgmt-vmotion", uplinks: ["vmnic0", "vmnic1"], mtu: 9000 },
      { name: "vds-sdn", uplinks: ["vmnic2", "vmnic3"], mtu: 9000 },
    ],
    portgroups: { mgmt: "vds-mgmt-vmotion", vmotion: "vds-mgmt-vmotion", vsan: "vds-sdn", hostTep: "vds-sdn" },
    teaming: "loadBalanceSrcId",
  },
  "6-nic": {
    nicCount: 6,
    uplinks: ["vmnic0", "vmnic1", "vmnic2", "vmnic3", "vmnic4", "vmnic5"],
    vds: [
      { name: "vds-mgmt", uplinks: ["vmnic0", "vmnic1"], mtu: 1500 },
      { name: "vds-vmotion-vsan", uplinks: ["vmnic2", "vmnic3"], mtu: 9000 },
      { name: "vds-overlay", uplinks: ["vmnic4", "vmnic5"], mtu: 9000 },
    ],
    portgroups: { mgmt: "vds-mgmt", vmotion: "vds-vmotion-vsan", vsan: "vds-vmotion-vsan", hostTep: "vds-overlay" },
    teaming: "loadBalanceSrcId",
  },
  "8-nic": {
    nicCount: 8,
    uplinks: ["vmnic0", "vmnic1", "vmnic2", "vmnic3", "vmnic4", "vmnic5", "vmnic6", "vmnic7"],
    vds: [
      { name: "vds-mgmt", uplinks: ["vmnic0", "vmnic1"], mtu: 1500 },
      { name: "vds-vmotion", uplinks: ["vmnic2", "vmnic3"], mtu: 9000 },
      { name: "vds-vsan", uplinks: ["vmnic4", "vmnic5"], mtu: 9000 },
      { name: "vds-overlay", uplinks: ["vmnic6", "vmnic7"], mtu: 9000 },
    ],
    portgroups: { mgmt: "vds-mgmt", vmotion: "vds-vmotion", vsan: "vds-vsan", hostTep: "vds-overlay" },
    teaming: "loadBalanceSrcId",
  },
};

// Lightweight number formatter used inside engine reason strings.
// Mirrors the UI fmt() helper but intentionally lives here so engine.js stays
// self-contained for Node tests.
function fmtNum(n, d = 0) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES — create new entities at each level of the hierarchy
// ─────────────────────────────────────────────────────────────────────────────
// Generate a short pseudo-random identifier for in-process entity IDs
// (cluster.id, instance.id, hostOverride keys, etc.). NOT cryptographic —
// uses Math.random() + Date.now() for ~40 bits of local-uniqueness
// entropy. The studio doesn't transmit these IDs or use them as secrets;
// they exist to disambiguate items inside a single fleet's React state.
// For password / vault generation see generatePassword() which uses
// crypto.getRandomValues exclusively.
function localId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const baseHostSpec = () => ({
  cpuQty: 2,
  coresPerCpu: 16,
  hyperthreadingEnabled: false,
  ramGb: 1024,
  nvmeQty: 6,
  nvmeSizeTb: 7.68,
  cpuOversub: 2,
  ramOversub: 1,
  reservePct: 30,
});

// Theme 2 — vSAN data services. Distinct from the sizing-oriented
// `dedup` / `compression` ratios above (which drive math). These are
// workbook-level toggles + identifiers for the actual vSAN feature
// configuration: FTT enum, the Dedup/Compression on/off switch, the
// datastore name override, DIT rekey config (9.1 only), and NFS
// principal-storage. Workbook export lives in Deploy Mgmt L116-L122
// (9.0) / L58-L61+L190-L196 (9.1).
function baseStorageDataServices() {
  return {
    ftt: 1,                                  // Failures to Tolerate: 1 | 2
    dedupCompressionEnabled: false,          // workbook boolean, NOT the sizing ratio
    datastoreName: "",                       // empty → workbook formula default
    dit: {                                   // 9.1-only DIT rekey config
      rekeyMode: "Default",                  // "Default" | "Custom"
      rekeyInterval: "1 Day",                // when Default: "6 Hours" | "12 hours" | "1 Day" | "3 Days" | "7 Days"
      rekeyHoursCustom: 1440,                // when Custom: integer hours (sample workbook uses 1440)
    },
    nfs: {                                   // principal-storage = NFSv3
      sharePath: "",
      serverIp: "",
      boundToVmknic: true,                   // L122/L196 default Selected
    },
  };
}

const baseStorageSettings = () => ({
  policy: "raid5_2p1",
  dedup: 1.0,
  compression: 1.0,
  swapPct: 100,
  freePct: 25,
  growthPct: 15,
  externalStorage: false,
  externalArrayTib: 0,
  dataServices: baseStorageDataServices(),
});

const baseTiering = () => ({
  enabled: false,
  nvmePct: 100,
  eligibilityPct: 70,
  tierDriveSizeTb: 7.68,
});

// A cluster is the leaf-level unit where the sizing math runs. It has its own
// host hardware, its own workload demand, and its own infrastructure stack.
function newCluster(name = "cluster-01", isDefault = true) {
  return {
    id: `clu-${localId()}`,
    name,
    isDefault,
    host: baseHostSpec(),
    // Workload VMs that run in this cluster
    workload: {
      vmCount: 0,
      vcpuPerVm: 4,
      ramPerVm: 16,
      diskPerVm: 100,
    },
    // Infrastructure appliances that run in this cluster
    infraStack: [],
    storage: baseStorageSettings(),
    tiering: baseTiering(),
    // Manual host-count floor: when > 0 the sizing engine treats this as
    // another `candidates` entry alongside CPU/RAM/storage/policy floors.
    // Lets the user force a stretched cluster to have enough hosts per
    // side to survive a site failure without changing host specs. Cannot
    // drop finalHosts below the architectural minimum; only raise it.
    hostOverride: 0,
    // T0 gateway topology per VCF-APP-006 / VCF-INV-060..065. Each entry
    // represents one Tier-0 gateway served by a subset of this cluster's
    // nsxEdge stack entries.
    t0Gateways: [],
    // VCF-PATH-003 converge pathway marker: when true, this cluster
    // pre-existed and is being converged into the VCF fleet rather than
    // deployed fresh. Purely informational — used by the UI to render a
    // muted "existing" badge and by reports to separate capex.
    preExisting: false,
    // VCF-APP-006 Edge deployment model. Informational — sizing doesn't
    // change, but the chosen model drives DC layout expectations and
    // survivability. Null when not declared.
    edgeDeploymentModel: null,
    networks: createClusterNetworks(),
    hostOverrides: [],
    // Plan 7 — per-cluster naming overrides. All fields null = inherit
    // from fleet.namingConfig.
    naming: createClusterNaming(),
  };
}

// Build the default mgmt cluster — same as a regular cluster but with the
// standard management appliance stack pre-populated. Plan 12: resolves the
// stack via profileStack() so 9.1 fleets get the VCFMS-extended stack.
// Defaults to legacy 9.0 when vcfVersion omitted (preserves snapshot
// stability for tests/factories that call newMgmtCluster() with no args).
function newMgmtCluster(name = "mgmt-cluster-01", vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  const c = newCluster(name, true);
  const baseStack = profileStack(DEPLOYMENT_PROFILES.ha, vcfVersion);
  c.infraStack = baseStack.map((s) => ({ ...s, key: localId() }));
  return c;
}

// A workload cluster pre-populated with vCLS (since every cluster needs it)
function newWorkloadCluster(name = "wld-cluster-01") {
  const c = newCluster(name, true);
  c.infraStack = [{ id: "vcls", size: "Default", instances: 2, key: localId() }];
  c.workload = { vmCount: 200, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
  return c;
}

// A domain is a thin container that holds clusters. The domain's vCenter and
// other management overhead live in its parent instance's mgmt domain (the
// workbook convention) — domains themselves don't carry sizing data.
function newMgmtDomain(name = "Management Domain", vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  return {
    id: `dom-${localId()}`,
    type: "mgmt",
    name,
    placement: "stretched", // mgmt domain defaults to stretched when instance is stretched
    hostSplitPct: 50,       // % of hosts at stretchSiteIds[0] (rest at stretchSiteIds[1]) when stretched
    localSiteId: null,      // when placement === "local", which site id the domain runs at
    // When placement === "stretched", the exact pair of site ids this domain
    // stretches across. Must be a 2-element subset of instance.siteIds. Null
    // for local placement. Introduced to support VCF instances that touch
    // 3+ sites where only some domains stretch across a specific pair.
    stretchSiteIds: null,
    clusters: [newMgmtCluster("mgmt-cluster-01", vcfVersion)],
  };
}

function newWorkloadDomain(name = "Workload Domain 01") {
  return {
    id: `dom-${localId()}`,
    type: "workload",
    name,
    placement: "local",  // "local" = pinned to one site, "stretched" = spans a pair
    hostSplitPct: 50,    // % of hosts at stretchSiteIds[0] when stretched
    localSiteId: null,   // set by the parent InstanceCard to a concrete site id
    stretchSiteIds: null, // pair of site ids; set when placement === "stretched"
    // VCF-PATH-004 brownfield import marker. False for greenfield/expand/
    // converge workload domains where vCenter/NSX-Manager/Avi-Controller VMs
    // MUST land on mgmt-domain hosts (VCF-INV-003). True for imported domains
    // where pre-existing appliance VMs may already live on this domain's own
    // hosts; the placement constraint is relaxed for those entries.
    imported: false,
    // VCF domain services (dedicated vCenter, NSX Manager cluster, edges, Avi,
    // VCF Automation, etc.) for this workload domain. Does NOT include vCLS —
    // that is per-cluster baseline and lives in cluster.infraStack.
    wldStack: [],
    // Id of the specific cluster that hosts wldStack VMs. For greenfield
    // workload domains this MUST resolve to a mgmt-domain cluster (Broadcom
    // VCF 9: workload-domain vCenter and NSX Manager run on mgmt hosts). For
    // imported domains the value may point at a cluster in THIS workload
    // domain. Null means "fall back to the mgmt domain's first cluster at
    // sizing time".
    componentsClusterId: null,
    clusters: [newWorkloadCluster()],
  };
}

// A VCF instance has exactly one mgmt domain plus zero or more workload domains.
// When stretched: the instance spans a primary site (where it lives in the hierarchy)
// and a secondary site. Individual domains can be local or stretched.
// Stretched clusters require synchronous storage replication (vSAN stretched
// cluster or array-based replication) and L2 network stretch via NSX.
function newInstance(name = "vcf-instance-01", siteIds = [], vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  // Shape the default mgmt domain to match the siteIds passed in. The
  // factory can't rely on the mgmt domain's own defaults (which assume a
  // stretched pair) when the caller asks for a single-site or multi-site
  // instance.
  const mgmt = newMgmtDomain("Management Domain", vcfVersion);
  if (siteIds.length >= 2) {
    mgmt.placement = "stretched";
    mgmt.localSiteId = null;
    mgmt.stretchSiteIds = [siteIds[0], siteIds[1]];
  } else {
    mgmt.placement = "local";
    mgmt.localSiteId = siteIds[0] || null;
    mgmt.stretchSiteIds = null;
  }
  return {
    id: "inst-" + localId(),
    name,
    deploymentProfile: "ha",
    siteIds: [...siteIds],
    witnessEnabled: false,
    witnessSize: "Medium",
    witnessSite: { name: "Witness Site", location: "" },
    // VCF-APP-080: optional reference to a fleet.sites[] entry with
    // siteRole === "witness". When non-null, takes precedence over the
    // free-form witnessSite object for rendering and reporting. Lets one
    // physical witness location be shared across multiple stretched
    // instances.
    witnessSiteId: null,
    // VCF-DR-001..050 posture. "active" runs the full stack; "warm-standby"
    // is paired with another instance via VLR/SRM replication and does NOT
    // actively run fleet-level appliances even if they appear in its stack.
    drPosture: "active",
    drPairedInstanceId: null,
    domains: [mgmt],
  };
}

function newSite(name = "Primary Site", location = "") {
  return {
    id: "site-" + localId(),
    name,
    location,
    // Optional region grouping per VCF-TOPO-004 (multi-region fleet). Purely
    // informational — used to group sites in Per-Site view and reports.
    region: "",
    // Optional site role. "primary" | "dr" | "witness" per VCF-DR rules.
    // Empty string means unspecified (default).
    siteRole: "",
  };
}

function newFleet() {
  const primary = newSite("Primary Site", "");
  // Plan 12: brand-new fleets default to the latest shipping VCF version
  // (currently 9.1). Threaded through the factory chain so newMgmtCluster
  // seeds the 9.1 profile stack (with VCFMS).
  const vcfVersion = DEFAULT_VCF_VERSION_NEW;
  const inst = newInstance("vcf-instance-01", [primary.id], vcfVersion);
  return {
    id: "fleet-" + localId(),
    name: "Production Fleet",
    // Plan 12 — fleet-level VCF version selector. Drives the resolver chain
    // (applianceSize, profileStack), sizing math (stackTotals → sizeFleet),
    // and migration directionality. Defaults to the latest at fleet creation;
    // migrateFleet backfills to DEFAULT_VCF_VERSION_LEGACY for unversioned imports.
    vcfVersion,
    // Deployment pathway per VCF-PATH-001..004. Drives per-fleet appliance
    // placement decisions: "greenfield" deploys the full initial stack,
    // "expand" reuses an existing initial instance (never duplicates
    // per-fleet appliances), "converge" preserves an existing non-VCF
    // cluster, "import" pulls in a running workload-domain vCenter.
    deploymentPathway: "greenfield",
    // NSX Federation intent per VCF-INV-021. When true, nsxGlobalMgr is
    // expected on the initial instance (active cluster) and a second
    // instance (standby cluster). Defaults to false; UI toggles this and
    // legacy imports infer it from profile names.
    federationEnabled: false,
    // SSO deployment model per VCF-APP-030 / VCF-SSO-001/002/003.
    //   "embedded"     — each instance runs an embedded broker in its own
    //                    vCenter (VCF-SSO-001). Smallest blast radius.
    //   "fleet-wide"   — one shared 3-node broker cluster for the entire
    //                    fleet, on the initial instance (VCF-SSO-002).
    //                    Recommended up to 5 instances (VCF-INV-031).
    //   "multi-broker" — multiple broker clusters, each serving a subset
    //                    of instances (VCF-SSO-003). Scales past 5.
    ssoMode: "embedded",
    // Active brokers when ssoMode === "multi-broker". Each entry lists the
    // instance ids it serves. Validated by VCF-INV-031.
    ssoBrokers: [],
    // Fleet-level services (vcfOps, vcfAuto) bind to exactly ONE broker
    // regardless of how many exist (VCF-INV-032). When null, defaults to
    // the single broker in embedded / fleet-wide modes.
    ssoFleetServicesBrokerId: null,
    networkConfig: createFleetNetworkConfig(),
    // Plan 7 — token-based naming templates for hosts and vDS switches.
    // Empty templates by default; users opt in via the Fleet Summary panel.
    namingConfig: createFleetNamingConfig(),
    // Plan 8 — report metadata for the PDF export cover page. Empty
    // defaults; populated via the Fleet Summary panel.
    reportMetadata: createFleetReportMetadata(),
    // Theme 1a — VCF Installer / depot / proxy / activation. Empty
    // credentials by default; populated via the Fleet Summary panel.
    // Workbook export lands in Deploy Mgmt L9–L20 (theme 1b).
    installerConfig: createFleetInstallerConfig(),
    sites: [primary],
    instances: [inst],
  };
}

// Resolve the set of site ids a single domain physically lives at. Stretched
// domains return their explicit stretchSiteIds pair; local domains return
// their localSiteId (falling back to the instance's first site for legacy
// data that pre-dates explicit per-domain pinning).
function domainSites(dom, instance) {
  const instSiteIds = instance.siteIds || [];
  if (dom.placement === "stretched"
      && Array.isArray(dom.stretchSiteIds)
      && dom.stretchSiteIds.length === 2) {
    return dom.stretchSiteIds;
  }
  const localId =
    dom.localSiteId && instSiteIds.includes(dom.localSiteId)
      ? dom.localSiteId
      : instSiteIds[0] || null;
  return localId ? [localId] : [];
}

// Build default appliance-to-site assignments. For each appliance entry
// we distribute its VM instances round-robin across the home sites of the
// domain that owns the cluster the entry belongs to — the stretch pair for
// a stretched domain, or the pinned site for a local domain. Returns a map:
// { [applianceKey]: [siteId, ...] }.
function buildDefaultPlacement(instance) {
  const siteIds = instance.siteIds || [];
  if (siteIds.length < 2) return {};
  const placement = {};
  for (const dom of instance.domains || []) {
    const targets = domainSites(dom, instance);
    if (!targets || targets.length === 0) continue;
    for (const clu of dom.clusters || []) {
      for (const entry of clu.infraStack || []) {
        const count = entry.instances || 1;
        const assigned = [];
        for (let i = 0; i < count; i++) {
          assigned.push(targets[i % targets.length]);
        }
        placement[entry.key] = assigned;
      }
    }
    if (dom.type === "workload") {
      for (const entry of dom.wldStack || []) {
        const count = entry.instances || 1;
        const assigned = [];
        for (let i = 0; i < count; i++) {
          assigned.push(targets[i % targets.length]);
        }
        placement[entry.key] = assigned;
      }
    }
  }
  return placement;
}

// Ensure instance.appliancePlacement exists and covers all current stack
// entries. Adds missing keys with default alternating assignments, and
// replaces entries whose site ids no longer sit inside the instance's
// siteIds (e.g. a site was removed).
function ensurePlacement(instance) {
  if ((instance.siteIds || []).length < 2) return {};
  const existing = instance.appliancePlacement || {};
  const defaults = buildDefaultPlacement(instance);
  const merged = {};
  for (const [key, defaultAssign] of Object.entries(defaults)) {
    const prev = existing[key];
    if (prev && prev.length === defaultAssign.length) {
      // Validate all site IDs still exist on this instance
      const valid = prev.every((sid) => instance.siteIds.includes(sid));
      merged[key] = valid ? prev : defaultAssign;
    } else {
      merged[key] = defaultAssign;
    }
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION — convert old v2 flat format into new v3 hierarchical structure.
// Old format: { version: "vcf-sizer-v2", mgmt: {...}, wlds: [{...}] }
// New format: { version: "vcf-sizer-v3", fleet: { sites: [{ instances: [{ domains: [...] }] }] } }
// ─────────────────────────────────────────────────────────────────────────────
function migrateV2ToV3(oldConfig) {
  const oldMgmt = oldConfig.mgmt;
  const oldWlds = oldConfig.wlds || [];

  // Old mgmt domain → new mgmt domain with one cluster containing the old data
  const mgmtCluster = {
    id: `clu-${localId()}`,
    name: "mgmt-cluster-01",
    isDefault: true,
    host: oldMgmt.host || baseHostSpec(),
    workload: { vmCount: 0, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
    infraStack: (oldMgmt.stack || []).map((s) => ({ ...s, key: localId() })),
    storage: oldMgmt.storage || baseStorageSettings(),
    tiering: oldMgmt.tiering || baseTiering(),
  };
  const mgmtDomain = {
    id: `dom-${localId()}`,
    type: "mgmt",
    name: oldMgmt.name || "Management Domain",
    clusters: [mgmtCluster],
  };

  // Old workload domains → new workload domains with one cluster each
  const wldDomains = oldWlds.map((w, i) => {
    const cluster = {
      id: `clu-${localId()}`,
      name: `wld-cluster-01`,
      isDefault: true,
      host: w.host || baseHostSpec(),
      workload: {
        vmCount: w.vmCount || 0,
        vcpuPerVm: w.vcpuPerVm || 4,
        ramPerVm: w.ramPerVm || 16,
        diskPerVm: w.diskPerVm || 100,
      },
      infraStack: (w.infraStack || []).map((s) => ({ ...s, key: localId() })),
      storage: w.storage || baseStorageSettings(),
      tiering: w.tiering || baseTiering(),
    };
    return {
      id: `dom-${localId()}`,
      type: "workload",
      name: w.name || `Workload Domain ${i + 1}`,
      clusters: [cluster],
    };
  });

  return {
    id: `fleet-${localId()}`,
    name: "Migrated Fleet (from v2)",
    sites: [{
      id: `site-${localId()}`,
      name: "Primary Site",
      location: "",
      instances: [{
        id: `inst-${localId()}`,
        name: "vcf-instance-01",
        domains: [mgmtDomain, ...wldDomains],
      }],
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v3 → v5 MIGRATION — lift instances out of sites, consolidate stretched dupes
// ─────────────────────────────────────────────────────────────────────────────
function domainStructureMatches(a, b) {
  if (!a?.domains || !b?.domains) return false;
  if (a.domains.length !== b.domains.length) return false;
  for (let i = 0; i < a.domains.length; i++) {
    const da = a.domains[i], db = b.domains[i];
    if (da.type !== db.type) return false;
    if ((da.clusters || []).length !== (db.clusters || []).length) return false;
    for (let j = 0; j < da.clusters.length; j++) {
      if (!!da.clusters[j].isDefault !== !!db.clusters[j].isDefault) return false;
    }
  }
  return true;
}

function stackSignature(domains) {
  const parts = [];
  for (const d of domains || []) {
    for (const c of d.clusters || []) {
      for (const e of c.infraStack || []) parts.push(`${e.id}:${e.size}:${e.instances}`);
    }
  }
  return parts.sort().join("|");
}

function liftV3Instance(v3Inst, siteIds) {
  // Pre-resolve the mgmt domain's first cluster id so we can default every
  // workload domain's wldStack placement to "any cluster in the mgmt domain"
  // without each per-domain map callback having to re-walk the domain list.
  const mgmtFirstCluId =
    (v3Inst.domains || []).find((d) => d.type === "mgmt")?.clusters?.[0]?.id || null;
  return {
    id: v3Inst.id,
    name: v3Inst.name,
    deploymentProfile: v3Inst.deploymentProfile || "ha",
    siteIds: [...siteIds],
    witnessEnabled: !!v3Inst.witnessSize && v3Inst.witnessSize !== "None",
    witnessSize: v3Inst.witnessSize || "Medium",
    witnessSite: v3Inst.witnessSite || { name: "Witness Site", location: "" },
    domains: (v3Inst.domains || []).map((d) => {
      const placement = d.placement || (siteIds.length === 2 ? "stretched" : "local");
      // v3 had no per-domain site pinning — local domains always lived at the
      // instance's primary (first) site. Preserve that semantic on migration.
      const localSiteId =
        placement === "local"
          ? (d.localSiteId && siteIds.includes(d.localSiteId) ? d.localSiteId : siteIds[0] || null)
          : null;
      // v3 has no wldStack or components placement. Default workload domains
      // to empty wldStack + "host appliances in mgmt domain's first cluster"
      // (VCF 9's default behavior). Every wldStack entry is tagged with
      // ownerDomainId for downstream visibility/attribution.
      const wldStack =
        d.type === "workload"
          ? (d.wldStack || []).map((e) => ({
              ...e,
              key: e.key || localId(),
              ownerDomainId: e.ownerDomainId || d.id,
            }))
          : [];
      const componentsClusterId =
        d.type === "workload" ? (d.componentsClusterId || mgmtFirstCluId) : null;
      // Drop the legacy componentsLocation enum — it existed briefly in v5.1
      // but is now superseded by componentsClusterId.
      const { componentsLocation: _legacy, ...rest } = d;
      const stretchSiteIds =
        placement === "stretched" && siteIds.length >= 2
          ? [siteIds[0], siteIds[1]]
          : null;
      const base = {
        ...rest,
        placement,
        hostSplitPct: getHostSplitPct(d),
        localSiteId,
        stretchSiteIds,
        wldStack,
        componentsClusterId,
      };
      if (d.type === "workload") {
        base.imported = typeof d.imported === "boolean" ? d.imported : false;
      }
      return base;
    }),
  };
}

function migrateV3ToV5(v3Fleet) {
  const sites = (v3Fleet.sites || []).map((s) => ({ id: s.id, name: s.name, location: s.location || "" }));
  const flat = [];
  for (const s of v3Fleet.sites || []) {
    for (const inst of s.instances || []) flat.push({ parentSiteId: s.id, inst });
  }
  const consumed = new Set();
  const instances = [];
  for (let i = 0; i < flat.length; i++) {
    if (consumed.has(i)) continue;
    const { parentSiteId: aSite, inst: A } = flat[i];
    if (!A.stretched || !A.secondarySiteId) {
      instances.push(liftV3Instance(A, [aSite])); continue;
    }
    let pairIdx = -1;
    for (let j = i + 1; j < flat.length; j++) {
      if (consumed.has(j)) continue;
      const { parentSiteId: bSite, inst: B } = flat[j];
      if (B.stretched && B.secondarySiteId === aSite && A.secondarySiteId === bSite &&
          B.name === A.name && domainStructureMatches(A, B)) { pairIdx = j; break; }
    }
    if (pairIdx === -1) {
      console.warn(`[vcf-migrate] ${A.id} marked stretched but no partner found`);
      instances.push(liftV3Instance(A, [aSite])); continue;
    }
    const { parentSiteId: bSite, inst: B } = flat[pairIdx];
    consumed.add(pairIdx);
    if (stackSignature(A.domains) !== stackSignature(B.domains)) {
      console.warn(`[vcf-migrate] stack drift between ${A.id} and ${B.id}; keeping ${A.id} as authoritative`);
    }
    instances.push(liftV3Instance(A, [aSite, bSite]));
  }
  return { id: v3Fleet.id, name: v3Fleet.name, sites, instances };
}

function migrateV5ToV6(fleet) {
  if (!fleet.networkConfig) {
    fleet = { ...fleet, networkConfig: createFleetNetworkConfig() };
  }
  // Plan 7 — backfill namingConfig at fleet level. Empty defaults preserve
  // today's "no hostname / hardcoded vDS names" behavior until the user
  // opts in by setting a template.
  if (!fleet.namingConfig) {
    fleet = { ...fleet, namingConfig: createFleetNamingConfig() };
  }
  // Plan 8 — backfill reportMetadata at fleet level. Empty defaults; the
  // PDF cover page renders blank values as "—" so existing fleets don't
  // suddenly carry stale data.
  if (!fleet.reportMetadata) {
    fleet = { ...fleet, reportMetadata: createFleetReportMetadata() };
  }
  // Theme 1a — backfill installerConfig at fleet level. Defaults to
  // broadcom/https/authenticated with empty credentials so legacy fleets
  // open without surprise; users fill in the depot URL + creds in the
  // Installer / Depot panel. Idempotent on round-trip.
  if (!fleet.installerConfig) {
    fleet = { ...fleet, installerConfig: createFleetInstallerConfig() };
  }
  return {
    ...fleet,
    version: "vcf-sizer-v6",
    instances: (fleet.instances || []).map(function(inst) {
      var instSiteIds = inst.siteIds || [];
      return {
        ...inst,
        domains: (inst.domains || []).map(function(dom) {
          // Backfill stretchSiteIds for stretched domains that pre-date the
          // multi-site schema. Existing fleets only had 2-site stretched
          // instances, so default to the first two site ids if the domain
          // is stretched and the field is missing. Idempotent: leaves
          // already-populated values alone.
          var stretchSiteIds = dom.stretchSiteIds;
          if (dom.placement === "stretched" && !stretchSiteIds && instSiteIds.length >= 2) {
            stretchSiteIds = [instSiteIds[0], instSiteIds[1]];
          } else if (dom.placement !== "stretched" && stretchSiteIds) {
            stretchSiteIds = null;
          }
          return {
            ...dom,
            stretchSiteIds: stretchSiteIds != null ? stretchSiteIds : null,
            clusters: (dom.clusters || []).map(function(cl) {
              // Theme 2 — backfill the new vSAN data services block on
              // existing cluster.storage. Whitelist-merge against the
              // factory shape so future schema bumps backfill missing
              // fields without overwriting user-set values.
              var existingDS = (cl.storage && cl.storage.dataServices) || {};
              var dsFactory = baseStorageDataServices();
              var mergedDS = {
                ...dsFactory,
                ...existingDS,
                dit: { ...dsFactory.dit, ...(existingDS.dit || {}) },
                nfs: { ...dsFactory.nfs, ...(existingDS.nfs || {}) },
              };
              var storage = cl.storage
                ? { ...cl.storage, dataServices: mergedDS }
                : { ...baseStorageSettings(), dataServices: mergedDS };
              var updated = {
                ...cl,
                storage,
                networks: cl.networks || createClusterNetworks(),
                hostOverrides: (cl.hostOverrides || []).map(function(o) {
                  return Object.assign({ hostname: null }, o, {
                    hostname: o.hostname != null ? o.hostname : null,
                  });
                }),
                // Plan 7 — per-cluster naming overrides.
                naming: cl.naming || createClusterNaming(),
              };
              updated.t0Gateways = (updated.t0Gateways || []).map(function(t0) {
                return {
                  ...t0,
                  asnLocal: t0.asnLocal != null ? t0.asnLocal : (t0.asn != null ? t0.asn : null),
                  bgpPeers: (t0.bgpPeers || []).map(function(p) {
                    return {
                      ...p,
                      id: p.id || ("peer-" + localId()),
                      name: p.name != null ? p.name : null,
                      ip: p.ip != null ? p.ip : null,
                      asn: p.asn != null ? p.asn : null,
                      mtu: p.mtu != null ? p.mtu : null,
                      bfdEnabled: !!p.bfdEnabled,
                    };
                  }),
                  uplinksPerEdge: Array.isArray(t0.uplinksPerEdge) ? t0.uplinksPerEdge : [],
                };
              });
              return updated;
            }),
          };
        }),
      };
    }),
  };
}

// Plan 12: data-format bump v6 → v9. Studio rebrand to v9 reflects dual VCF
// version support (9.0 + 9.1). The format change is additive — vcfVersion
// backfill plus the new `sizesByVersion` / `stackByVersion` / `availableInVersions`
// fields on appliances and profiles. Legacy v6 imports flow through here
// unchanged on shape; the version stamp is updated so re-exports advertise v9.
function migrateV6ToV9(fleet) {
  return {
    ...fleet,
    version: "vcf-sizer-v9",
  };
}

function migrateFleet(raw) {
  if (!raw) return migrateV6ToV9(migrateV5ToV6(newFleet()));
  const version = raw.version || "vcf-sizer-v3";
  // Plan 12: snapshot vcfVersion before the v2/v3 chain. migrateV2ToV3 and
  // migrateV3ToV5 return literal `{ id, name, sites, instances }` objects
  // that drop unknown top-level fields — so a v3 JSON with vcfVersion set
  // would lose it through the chain. Restore after the v5→v6 pass.
  const preservedVcfVersion =
    (raw && typeof raw === "object" && raw.vcfVersion) ||
    (raw && raw.fleet && raw.fleet.vcfVersion) ||
    undefined;
  let fleet = raw.fleet || raw;
  // Run older versions through their upgrade paths first, then fall through
  // to the v5 normalization pass so that newly-added host fields
  // (e.g. hyperthreadingEnabled) are populated regardless of source version.
  if (version === "vcf-sizer-v2") {
    const v3 = migrateV2ToV3(fleet);
    fleet = migrateV3ToV5(v3.fleet || v3);
  } else if (
    version !== "vcf-sizer-v5" &&
    version !== "vcf-sizer-v6" &&
    version !== "vcf-sizer-v9"
  ) {
    fleet = migrateV3ToV5(fleet);
  }
  fleet = migrateV5ToV6(fleet);
  fleet = migrateV6ToV9(fleet);
  // Re-attach vcfVersion AFTER the v3→v5 migrator (which would otherwise
  // strip it), but BEFORE the v6/v9 normalization spreads (which preserve it).
  if (preservedVcfVersion) fleet.vcfVersion = preservedVcfVersion;
  {
    // Resolve the deployment pathway once so the inner instance/domain
    // mappers can use it to backfill VCF-PATH-004 import semantics on
    // workload domains (see Plan 4 — domain.imported flag).
    const resolvedPathway = fleet.deploymentPathway || inferDeploymentPathway(fleet);
    // Capture domains the auto-detect heuristic flipped to imported so the
    // UI can surface a one-time post-import banner and the user can confirm
    // the brownfield classification was correct. Each entry: { id, name }.
    const autoImportedDomains = [];
    const migratedFleet = {
      ...fleet,
      // Plan 12 / studio rebrand v9 — the canonical current format stamp.
      // Legacy v5/v6 imports are normalized to v9 by the chain above; the
      // migrators don't re-stamp the version because some flow paths bypass
      // them, so re-assert here.
      version: "vcf-sizer-v9",
      // Plan 12 — backfill vcfVersion. Legacy imports (no vcfVersion in the
      // source JSON) default to DEFAULT_VCF_VERSION_LEGACY ("9.0") so existing
      // 9.0 fleets continue to size identically. Explicit values pass through.
      vcfVersion: fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY,
      networkConfig: fleet.networkConfig,
      // Plan 7 — preserve fleet-level naming templates on round-trip.
      // Backfilled to empty defaults if missing (migrateV5ToV6 does this);
      // re-asserted here so legacy callers that bypass V5→V6 still get a
      // valid shape.
      namingConfig: fleet.namingConfig || createFleetNamingConfig(),
      // Plan 8 — preserve report metadata on round-trip; backfill empty
      // defaults when missing (e.g. legacy v5 imports).
      reportMetadata: fleet.reportMetadata || createFleetReportMetadata(),
      // Theme 1a/1b — preserve installerConfig on round-trip; backfill
      // empty defaults when missing. Whitelist-merge against the factory
      // so unknown keys (e.g. the dead theme-1a "depotUrl" / "depotUser"
      // shape that briefly existed before the schema was reconciled with
      // the workbook) are dropped on import. Idempotent.
      installerConfig: (() => {
        const factory = createFleetInstallerConfig();
        const existing = (fleet.installerConfig && typeof fleet.installerConfig === "object") ? fleet.installerConfig : {};
        const merged = { ...factory };
        for (const k of Object.keys(factory)) {
          if (k in existing && existing[k] !== undefined) merged[k] = existing[k];
        }
        return merged;
      })(),
      id: fleet.id || "fleet-" + localId(),
      name: fleet.name || "Fleet",
      // Backfill VCF-PATH-* deploymentPathway on legacy imports based on
      // instance count (single=greenfield, multi=expand). Users can override.
      deploymentPathway: resolvedPathway,
      // Backfill VCF-INV-021 federationEnabled flag from profile names
      // ("haFederation*") on legacy imports. Explicit field wins when set.
      federationEnabled: typeof fleet.federationEnabled === "boolean"
        ? fleet.federationEnabled
        : inferFederationEnabled(fleet),
      // Backfill VCF-SSO-001..003 SSO model on legacy imports based on
      // instance count. Explicit ssoMode wins when set.
      ssoMode: (fleet.ssoMode && SSO_MODES[fleet.ssoMode])
        ? fleet.ssoMode
        : inferSsoMode(fleet),
      ssoBrokers: Array.isArray(fleet.ssoBrokers) ? fleet.ssoBrokers : [],
      ssoFleetServicesBrokerId: fleet.ssoFleetServicesBrokerId ?? null,
      sites: (fleet.sites || []).map((s) => ({
        ...s,
        region: s.region ?? "",
        siteRole: s.siteRole ?? "",
      })),
      instances: (fleet.instances || []).map((inst) => {
        const siteIds = inst.siteIds || [];
        // Resolve the mgmt domain's first cluster id once per instance so we
        // can fall back to it for any workload domain that doesn't already
        // have a valid componentsClusterId pin.
        const mgmtDom = (inst.domains || []).find((d) => d.type === "mgmt");
        const mgmtFirstCluId = mgmtDom?.clusters?.[0]?.id || null;
        const firstWldCluByDomId = {};
        for (const dom of inst.domains || []) {
          if (dom.type === "workload") firstWldCluByDomId[dom.id] = dom.clusters?.[0]?.id || null;
        }
        return {
          ...inst,
          siteIds,
          // Backfill VCF-DR-* posture on legacy imports. Default to "active".
          drPosture: inst.drPosture || "active",
          drPairedInstanceId: inst.drPairedInstanceId ?? null,
          // VCF-APP-080 witnessSiteId — default null; set via UI when users
          // choose to promote witness metadata to a first-class site.
          witnessSiteId: inst.witnessSiteId ?? null,
          domains: (inst.domains || []).map((d) => {
            const localSiteId =
              d.placement === "local"
                ? (d.localSiteId && siteIds.includes(d.localSiteId) ? d.localSiteId : siteIds[0] || null)
                : null;
            const wldStack =
              d.type === "workload"
                ? (d.wldStack || []).map((e) => ({
                    ...e,
                    key: e.key || localId(),
                    ownerDomainId: e.ownerDomainId || d.id,
                  }))
                : [];
            // componentsClusterId resolution order:
            //   1. Keep an existing valid id (v5.2+ round-trip)
            //   2. Map the legacy v5.1 componentsLocation enum:
            //        "wld"  → this domain's first cluster
            //        "mgmt" → mgmt domain's first cluster
            //   3. Fall back to the mgmt domain's first cluster (v5.0 and
            //      legacy-free defaults)
            let componentsClusterId = null;
            if (d.type === "workload") {
              if (d.componentsClusterId) {
                componentsClusterId = d.componentsClusterId;
              } else if (d.componentsLocation === "wld") {
                componentsClusterId = firstWldCluByDomId[d.id] || null;
              } else {
                componentsClusterId = mgmtFirstCluId;
              }
            }
            // VCF-PATH-004 imported (brownfield) marker. Resolution order:
            //   1. Keep an explicit boolean set by user/round-trip.
            //   2. fleet.deploymentPathway === "import" → all WLDs imported.
            //   3. Auto-detect: pre-existing fleets that pinned the WLD
            //      components on a cluster INSIDE the workload domain were
            //      only legal under the old permissive model. Migration
            //      preserves their behavior by flagging the domain as
            //      imported so the placement-constraint validator (Plan 5)
            //      doesn't fire on legacy data.
            //   4. Default false (greenfield).
            let imported = false;
            if (d.type === "workload") {
              if (typeof d.imported === "boolean") {
                imported = d.imported;
              } else if (resolvedPathway === "import") {
                imported = true;
              } else if (componentsClusterId) {
                const wldCluIds = (d.clusters || []).map((c) => c.id);
                imported = wldCluIds.includes(componentsClusterId);
                if (imported) {
                  // Auto-detected brownfield. Capture for the post-import
                  // UI banner and surface a one-time console warning so users
                  // who imported via CLI / tests can spot the heuristic firing.
                  autoImportedDomains.push({ id: d.id, name: d.name || d.id });
                }
              }
            }
            // Normalize each cluster's host spec to guarantee fields added in
            // later v5 revisions (e.g. hyperthreadingEnabled) are present on
            // imports that predate them. Defaults preserve legacy math.
            // Also backfill `role` on stack entries whose appliance is
            // dual-role per APPLIANCE_DB (vcenter, nsxMgr) based on the
            // domain type — see VCF-DEPLOYMENT-PATTERNS.md §2 (VCF-APP-002/003
            // and VCF-APP-004/005).
            const defaultRole = d.type === "mgmt" ? "mgmt" : "wld";
            const backfillRole = (entries) => (entries || []).map((e) => {
              const def = APPLIANCE_DB[e.id];
              if (!def?.dualRole) return e;
              return { ...e, role: e.role || defaultRole };
            });
            // Plan 10 — backfill storageProfile on appliances that expose an
            // independent storage-size knob (currently only vCenter per VCF 9.0
            // P&P Workbook). Legacy fleets default to "default" — same disk
            // values as before this change, so existing sizing math is preserved.
            const backfillStorageProfile = (entries) => (entries || []).map((e) => {
              const def = APPLIANCE_DB[e.id];
              if (!def?.storageProfiles || def.storageProfiles.length <= 1) return e;
              if (e.storageProfile && def.storageProfiles.includes(e.storageProfile)) return e;
              return { ...e, storageProfile: def.defaultStorageProfile || def.storageProfiles[0] };
            });
            // Plan 3 — rewrite legacy `aviLb` entries to the split pair.
            //   - On a mgmt cluster's infraStack: aviLb → aviController.
            //   - On a workload domain's wldStack: aviLb → aviController,
            //     and append a Service Engine group (Small × 2) for that WLD.
            // Idempotent: skipped when aviController is already present, and
            // skipped for SE addition when an aviServiceEngine entry already
            // exists in the same stack.
            const rewriteAvi = (entries, { addServiceEngineForDomainId } = {}) => {
              const list = entries || [];
              const out = [];
              for (const e of list) {
                if (e.id === "aviLb") {
                  out.push({ ...e, id: "aviController" });
                } else {
                  out.push(e);
                }
              }
              if (addServiceEngineForDomainId) {
                const hasSe = out.some((e) => e.id === "aviServiceEngine");
                const hasController = out.some((e) => e.id === "aviController");
                if (hasController && !hasSe) {
                  out.push({
                    id: "aviServiceEngine",
                    size: APPLIANCE_DB.aviServiceEngine.defaultSize,
                    instances: 2,
                    key: localId(),
                    role: "wld",
                    placementClusterId: null,
                    ownerDomainId: addServiceEngineForDomainId,
                  });
                }
              }
              return out;
            };
            const clusters = (d.clusters || []).map((c) => ({
              ...c,
              host: {
                ...(c.host || {}),
                hyperthreadingEnabled: c.host?.hyperthreadingEnabled ?? false,
              },
              infraStack: backfillStorageProfile(rewriteAvi(backfillRole(c.infraStack))),
              // Backfill VCF-APP-006 T0 array on legacy imports. Empty by
              // default; users populate via the ClusterCard T0 editor.
              t0Gateways: Array.isArray(c.t0Gateways) ? c.t0Gateways : [],
              // VCF-PATH-003 preExisting marker — default false for legacy.
              preExisting: !!c.preExisting,
              // VCF-APP-006 Edge deployment model — default null for legacy.
              edgeDeploymentModel: c.edgeDeploymentModel || null,
              // Plan 7 — per-cluster naming overrides (all-null = inherit).
              naming: c.naming || createClusterNaming(),
              // Plan 7 — backfill `hostname: null` on existing host overrides.
              hostOverrides: (c.hostOverrides || []).map((o) => ({
                hostname: null,
                ...o,
              })),
            }));
            // Drop the legacy componentsLocation field on its way out.
            const { componentsLocation: _legacy, ...rest } = d;
            const finalWldStack = backfillStorageProfile(
              d.type === "workload"
                ? rewriteAvi(wldStack, { addServiceEngineForDomainId: d.id })
                : wldStack
            );
            const out = {
              ...rest,
              localSiteId,
              wldStack: finalWldStack,
              componentsClusterId,
              clusters,
            };
            if (d.type === "workload") out.imported = imported;
            return out;
          }),
        };
      }),
    };
    if (autoImportedDomains.length > 0) {
      const names = autoImportedDomains.map((d) => d.name).join(", ");
      // eslint-disable-next-line no-console
      console.warn(
        `[vcf-migrate] auto-flagged ${autoImportedDomains.length} workload domain(s) as imported (brownfield) due to legacy WLD-cluster appliance placement: ${names}`
      );
      // Transient marker the UI strips before re-export. Used by the
      // post-import banner to confirm the heuristic firing was intended.
      migratedFleet._migrated = { autoImportedDomains };
    } else {
      // No new auto-flips this run — explicitly clear any stale marker
      // brought in by the spread so re-importing a previously-migrated
      // file doesn't re-trigger the post-import banner.
      delete migratedFleet._migrated;
    }
    return migratedFleet;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SIZING ENGINE — pure functions, runs at cluster level then aggregates upward
// ─────────────────────────────────────────────────────────────────────────────
// Resolve the disk allocation for a single appliance-stack entry. Most
// appliances expose a flat `sz.disk` value, but vCenter (per VCF 9.0 P&P
// Workbook) has an independent storage-size knob — Default / Large / XLarge —
// that scales disk without changing vCPU/RAM. For those, the size record
// ─── VERSION RESOLVERS ─────────────────────────────────────────────────────
// Resolve a sized appliance entry against a target VCF version. Full-replacement
// semantics: when `def.sizesByVersion[v]` is present, it REPLACES `def.sizes`
// entirely for that version. A missing size in the override means the size
// doesn't exist in that version, not that it falls back to baseline.
// `defaultSize` and `storageProfiles` are always read from the top-level def.
function applianceSize(def, sizeName, vcfVersion) {
  if (!def) return null;
  const sizes = def.sizesByVersion?.[vcfVersion] ?? def.sizes;
  return sizes?.[sizeName] ?? null;
}

// Whether an appliance def is available in a given VCF version. Defs without
// an explicit `availableInVersions` list are unrestricted (available in all).
function applianceAvailableIn(def, vcfVersion) {
  if (!def?.availableInVersions) return true;
  return def.availableInVersions.includes(vcfVersion);
}

// Version-filtered view of APPLIANCE_DB. Used by the StackPicker UI to hide
// version-exclusive appliances (e.g., VCFMS in 9.0 fleets).
function availableAppliances(vcfVersion) {
  const out = {};
  for (const [id, def] of Object.entries(APPLIANCE_DB)) {
    if (applianceAvailableIn(def, vcfVersion)) out[id] = def;
  }
  return out;
}

// Resolve a DEPLOYMENT_PROFILES entry's stack against a target VCF version.
// Same full-replacement semantics as applianceSize. Used so that profile
// re-apply on a 9.1 fleet picks up the 9.1-extended stack (including VCFMS)
// instead of silently stripping it.
function profileStack(profile, vcfVersion) {
  if (!profile) return [];
  return profile.stackByVersion?.[vcfVersion] ?? profile.stack ?? [];
}

// carries `sz.storage = { default, large, xlarge }` and the stack entry
// declares which one via `entry.storageProfile`. Missing/legacy entries
// fall back to the appliance's defaultStorageProfile.
function applianceEntryDisk(entry, def, sz) {
  if (!sz) return 0;
  if (typeof sz.disk === "number") return sz.disk;
  if (sz.storage) {
    const profile = entry?.storageProfile || def?.defaultStorageProfile || "default";
    return sz.storage[profile] ?? sz.storage[def?.defaultStorageProfile] ?? sz.storage.default ?? 0;
  }
  return 0;
}

// Plan 12: vcfVersion threading. Resolves each entry's size via applianceSize()
// so 9.1 vCenter Medium uses 858 GB and 9.0 stays at 908 GB. Entries whose
// appliance is gated to a different version (e.g., VCFMS on 9.0) are skipped
// as defense in depth — the UI also strips them via availableAppliances.
function stackTotals(stack, vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  let vcpu = 0, ram = 0, disk = 0;
  for (const item of stack || []) {
    if (!item.instances) continue;
    const def = APPLIANCE_DB[item.id];
    if (!def) continue;
    if (!applianceAvailableIn(def, vcfVersion)) continue;
    const sz = applianceSize(def, item.size, vcfVersion);
    if (!sz) continue;
    vcpu += sz.vcpu * item.instances;
    ram  += sz.ram  * item.instances;
    disk += applianceEntryDisk(item, def, sz) * item.instances;
  }
  return { vcpu, ram, disk };
}

// ─── VCF VERSION MIGRATION HELPERS ─────────────────────────────────────────
// Append-only injection of VCFMS Control + Worker entries. Preserves any
// existing entries (with their custom sizes / instance counts) so users who
// hand-tuned VCFMS don't see their work overwritten by a re-migration.
function ensureVcfmsEntries(stack) {
  const safe = Array.isArray(stack) ? stack : [];
  const hasControl = safe.some((e) => e?.id === "vcfmsControl");
  const hasWorker  = safe.some((e) => e?.id === "vcfmsWorker");
  const additions = [];
  if (!hasControl) additions.push({ id: "vcfmsControl", size: "Medium", instances: 3, key: localId() });
  if (!hasWorker)  additions.push({ id: "vcfmsWorker",  size: "Medium", instances: 3, key: localId() });
  return [...safe, ...additions];
}

// Filter out stack entries whose appliance is unavailable in `targetVersion`.
// Used by migrate9_1To9_0 (strips VCFMS) and reconcileFleetVersion (defense
// in depth against hand-edited JSON).
function stripVersionExclusive(stack, targetVersion) {
  if (!Array.isArray(stack)) return [];
  return stack.filter((e) => {
    const def = APPLIANCE_DB[e?.id];
    if (!def) return true; // unknown ids passed through; stackTotals will skip them
    return applianceAvailableIn(def, targetVersion);
  });
}

// 9.0 → 9.1 up-migration. Adds VCFMS to the initial instance's mgmt-domain
// clusters only (scope:"per-fleet"). Idempotent on 9.1 input.
function migrate9_0To9_1(fleet) {
  if (!fleet || fleet.vcfVersion === "9.1") return fleet;
  const initial = getInitialInstance(fleet);
  return {
    ...fleet,
    vcfVersion: "9.1",
    instances: (fleet.instances || []).map((inst) => {
      if (!initial || inst.id !== initial.id) return inst;
      return {
        ...inst,
        domains: (inst.domains || []).map((dom) => {
          if (dom.type !== "mgmt") return dom;
          return {
            ...dom,
            clusters: (dom.clusters || []).map((clu) => ({
              ...clu,
              infraStack: ensureVcfmsEntries(clu.infraStack || []),
            })),
          };
        }),
      };
    }),
  };
}

// 9.1 → 9.0 down-migration. Strips every 9.1-exclusive appliance from every
// stack across every cluster in every domain in every instance. Destructive
// by design — customizations to 9.1-only appliances are lost.
function migrate9_1To9_0(fleet) {
  if (!fleet || fleet.vcfVersion === "9.0") return fleet;
  return {
    ...fleet,
    vcfVersion: "9.0",
    instances: (fleet.instances || []).map((inst) => ({
      ...inst,
      domains: (inst.domains || []).map((dom) => ({
        ...dom,
        clusters: (dom.clusters || []).map((clu) => ({
          ...clu,
          infraStack: stripVersionExclusive(clu.infraStack, "9.0"),
          wldStack:   stripVersionExclusive(clu.wldStack,   "9.0"),
        })),
      })),
    })),
  };
}

// Defense-in-depth invariant enforcer for fleet objects with potentially
// inconsistent state (hand-edited JSON, future migration bugs). Strips
// wrong-version entries everywhere, then ensures 9.1 fleets have VCFMS on
// the initial-instance mgmt cluster. Returns null/undefined unchanged.
function reconcileFleetVersion(fleet) {
  if (!fleet) return fleet;
  const version = fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
  // Strip wrong-version entries everywhere.
  const cleaned = {
    ...fleet,
    vcfVersion: version,
    instances: (fleet.instances || []).map((inst) => ({
      ...inst,
      domains: (inst.domains || []).map((dom) => ({
        ...dom,
        clusters: (dom.clusters || []).map((clu) => ({
          ...clu,
          infraStack: stripVersionExclusive(clu.infraStack, version),
          wldStack:   stripVersionExclusive(clu.wldStack,   version),
        })),
      })),
    })),
  };
  // If declared 9.1, ensure VCFMS invariant via the up-migration helper
  // (temporarily flag as 9.0 so the guard inside migrate9_0To9_1 doesn't
  // short-circuit).
  if (version === "9.1") {
    return migrate9_0To9_1({ ...cleaned, vcfVersion: "9.0" });
  }
  return cleaned;
}

// Single-instance variant. Used by the JSX importAsNewInstance handler when
// importing a v9.0 instance into a v9.1 fleet (or vice versa). Wraps the
// instance as a one-element pseudo-fleet, runs the appropriate directional
// migration, unwraps. Returns null/undefined unchanged.
function reconcileInstanceVersion(instance, targetVersion) {
  if (!instance) return instance;
  if (instance.vcfVersion === targetVersion) return instance;
  const pseudoFleet = {
    vcfVersion: instance.vcfVersion || DEFAULT_VCF_VERSION_LEGACY,
    instances: [instance],
  };
  const migrated = targetVersion === "9.1"
    ? migrate9_0To9_1(pseudoFleet)
    : migrate9_1To9_0(pseudoFleet);
  const out = { ...migrated.instances[0] };
  out.vcfVersion = targetVersion;
  return out;
}

function sizeHost(host) {
  const cores = host.cpuQty * host.coresPerCpu;
  const threads = host.hyperthreadingEnabled ? cores * 2 : cores;
  const rawGb = host.nvmeQty * host.nvmeSizeTb * 1000;
  const usableVcpu = threads * host.cpuOversub * (1 - host.reservePct / 100);
  const usableRam = host.ramGb * host.ramOversub * (1 - host.reservePct / 100);
  return { cores, threads, rawGb, usableVcpu, usableRam };
}

function applyTiering(host, hostBase, demandRamGb, tiering) {
  if (!tiering.enabled) {
    return {
      effectiveRamPerHost: hostBase.usableRam,
      tieredDemandRamGb: demandRamGb,
      tierPartitionGb: 0,
      activeRatio: 0,
    };
  }
  const requestedTierGb = host.ramGb * (tiering.nvmePct / 100);
  const driveCapGb = tiering.tierDriveSizeTb * 1000;
  const tierPartitionGb = Math.min(requestedTierGb, driveCapGb, NVME_TIER_PARTITION_CAP_GB);
  const activeRatio = tierPartitionGb / host.ramGb;
  const effectiveRamPerHost = host.ramGb * (1 + activeRatio) * host.ramOversub *
    (1 - host.reservePct / 100);
  const eligible = demandRamGb * (tiering.eligibilityPct / 100);
  const ineligible = demandRamGb - eligible;
  const tieredEligible = eligible / (1 + activeRatio);
  const tieredDemandRamGb = tieredEligible + ineligible;
  return { effectiveRamPerHost, tieredDemandRamGb, tierPartitionGb, activeRatio };
}

function sizeStoragePipeline(demandDiskGb, demandRamGb, s) {
  const drr = s.dedup * s.compression;
  const vmCapGb = demandDiskGb / drr;
  const swapGb = demandRamGb * (s.swapPct / 100);
  const interimGb = vmCapGb + swapGb;
  const pf = POLICIES[s.policy].pf;
  const protectedGb = interimGb * pf;
  const withFreeGb = protectedGb * (1 + s.freePct / 100);
  const totalReqGb = withFreeGb * (1 + s.growthPct / 100);
  return { drr, vmCapGb, swapGb, interimGb, pf, protectedGb, withFreeGb, totalReqGb };
}

// Size a single cluster — this is the leaf-level computation. Demand comes
// from workload VMs, the cluster's own infraStack (vCLS etc.), and any
// "injected" appliances from wldStacks that have been relocated here (e.g.
// a workload domain whose componentsLocation is "mgmt" charges its wldStack
// to the mgmt cluster via extraStack).
function sizeCluster(cluster, extraStack = [], vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  const h = sizeHost(cluster.host);
  const infra = stackTotals([...(cluster.infraStack || []), ...(extraStack || [])], vcfVersion);
  const workloadVcpu = (cluster.workload?.vmCount || 0) * (cluster.workload?.vcpuPerVm || 0);
  const workloadRam = (cluster.workload?.vmCount || 0) * (cluster.workload?.ramPerVm || 0);
  const workloadDisk = (cluster.workload?.vmCount || 0) * (cluster.workload?.diskPerVm || 0);

  const demandVcpu = workloadVcpu + infra.vcpu;
  const demandRam = workloadRam + infra.ram;
  const demandDisk = workloadDisk + infra.disk;

  const tier = applyTiering(cluster.host, h, demandRam, cluster.tiering);

  const cpuHosts = Math.ceil(demandVcpu / h.usableVcpu);
  const ramHosts = Math.ceil(tier.tieredDemandRamGb / tier.effectiveRamPerHost);

  const policy = POLICIES[cluster.storage.policy];
  let storageHosts = 0;
  let pipeline = null;
  if (!cluster.storage.externalStorage) {
    pipeline = sizeStoragePipeline(demandDisk, demandRam, cluster.storage);
    storageHosts = Math.ceil(pipeline.totalReqGb / h.rawGb) + policy.ftt;
  }

  const manualOverride = Math.max(0, cluster.hostOverride || 0);
  const candidates = [
    { name: "Compute", val: cpuHosts },
    { name: "Memory", val: ramHosts },
    { name: "Policy", val: policy.minHosts },
    { name: "Manual", val: manualOverride },
  ];
  if (!cluster.storage.externalStorage) {
    candidates.push({ name: "Storage", val: storageHosts });
  }

  const finalHosts = Math.max(...candidates.map((c) => c.val));
  const limiter = candidates.find((c) => c.val === finalHosts).name;

  const vsanMinWarning =
    !cluster.storage.externalStorage &&
    finalHosts === 3 &&
    policy.minHosts <= 3;

  return {
    host: h,
    demand: { vcpu: demandVcpu, ram: demandRam, disk: demandDisk },
    tier,
    floors: { cpuHosts, ramHosts, storageHosts, policyMin: policy.minHosts, manualOverride },
    pipeline,
    finalHosts,
    limiter,
    licensedCores: finalHosts * h.cores,
    rawTib: cluster.storage.externalStorage
      ? 0
      : finalHosts * cluster.host.nvmeQty * cluster.host.nvmeSizeTb * TB_TO_TIB,
    externalStorage: cluster.storage.externalStorage,
    vsanMinWarning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRETCHED-CLUSTER FAILOVER ANALYSIS — pure function
//
// Given a cluster result from sizeCluster and the cluster's current
// hostSplitPct, determine whether each site on its own could absorb the
// FULL cluster demand after the other site is lost.
//
// The full-cluster demand (vCPU / RAM / disk / raw storage) is already the
// sum across both sites — sizeCluster doesn't split it. What changes on
// failover is the number of surviving hosts: if hostSplitPct is 60, site A
// has ceil(finalHosts * 0.60) hosts and site B has finalHosts - that. The
// survivor's capacity is its-host-count × per-host-capacity.
//
// Three verdicts:
//   green  : survivor has enough SAFE capacity (respecting reservePct /
//            oversub / policy minHosts / storage policy FTT on full demand).
//            Design is truly HA.
//   yellow : survivor has enough RAW oversubscribed capacity but only by
//            eating into the configured reserve slack. Everything runs but
//            there is no headroom — the failover burns the reserve.
//   red    : even at zero reserve the survivor cannot host the demand, OR
//            the survivor falls below the storage policy's minHosts floor,
//            OR the storage pipeline requires more raw capacity than the
//            survivor can provide. Components cannot all run at one site.
//
// Storage verdict: on failover, the storage policy still applies (vSAN still
// needs FTT hosts of capacity), so we rerun the same sizeStoragePipeline
// call against the survivor's per-host raw capacity and compare required
// host counts.
//
// Returns one verdict PER stretched cluster, so a stretched mgmt cluster
// that comfortably survives with 60/40 but a stretched WLD cluster that
// can't survive 50/50 produces two different rollups.
// ─────────────────────────────────────────────────────────────────────────────
function analyzeStretchedFailover(cluster, result, hostSplitPct) {
  const pct = getHostSplitPct({ hostSplitPct });
  const full = result.finalHosts;
  const hostsA = Math.max(0, Math.ceil(full * (pct / 100)));
  const hostsB = Math.max(0, full - hostsA);
  const h = result.host;
  const tier = result.tier;
  const policy = POLICIES[cluster.storage.policy];

  // Per-host "safe" capacity (what sizeCluster used to pick finalHosts).
  const safeVcpuPerHost = h.usableVcpu;
  const safeRamPerHost  = tier.effectiveRamPerHost;
  // Per-host "raw-oversubscribed" capacity: cores × oversub (no reserve
  // removed). This is the true compute ceiling a host can sustain briefly.
  const rawVcpuPerHost = h.cores * cluster.host.cpuOversub;
  const rawRamPerHost  = (tier.effectiveRamPerHost /
                          Math.max(1e-9, 1 - cluster.host.reservePct / 100));

  // Run the storage pipeline once for the full (unchanged) demand so we can
  // compare against each survivor's raw capacity.
  const storagePerHost = cluster.host.nvmeQty * cluster.host.nvmeSizeTb * 1000;
  let storageHostsNeeded = 0;
  if (!cluster.storage.externalStorage && result.pipeline) {
    storageHostsNeeded = Math.ceil(result.pipeline.totalReqGb / Math.max(1, storagePerHost)) + policy.ftt;
  }

  function verdictFor(survHosts) {
    if (survHosts <= 0) {
      return { verdict: "red", reason: "Survivor has 0 hosts", hosts: 0 };
    }
    if (survHosts < policy.minHosts) {
      return {
        verdict: "red",
        reason: `Survivor has ${survHosts} host${survHosts === 1 ? "" : "s"}, below storage policy minimum (${policy.minHosts})`,
        hosts: survHosts,
      };
    }
    if (!cluster.storage.externalStorage && survHosts < storageHostsNeeded) {
      return {
        verdict: "red",
        reason: `Survivor needs ${storageHostsNeeded} hosts of vSAN capacity, has ${survHosts}`,
        hosts: survHosts,
      };
    }
    const safeVcpu = survHosts * safeVcpuPerHost;
    const safeRam  = survHosts * safeRamPerHost;
    const rawVcpu  = survHosts * rawVcpuPerHost;
    const rawRam   = survHosts * rawRamPerHost;
    const demand = result.demand;
    const demandRamTiered = tier.tieredDemandRamGb;

    const safeOk = demand.vcpu <= safeVcpu && demandRamTiered <= safeRam;
    if (safeOk) {
      return {
        verdict: "green",
        reason: "Survivor absorbs full demand within safe reserves",
        hosts: survHosts,
        vcpuUsedPct: Math.round((demand.vcpu / Math.max(1, safeVcpu)) * 100),
        ramUsedPct:  Math.round((demandRamTiered / Math.max(1, safeRam)) * 100),
      };
    }
    const rawOk = demand.vcpu <= rawVcpu && demandRamTiered <= rawRam;
    if (rawOk) {
      const vcpuPctRaw = Math.round((demand.vcpu / Math.max(1, rawVcpu)) * 100);
      const ramPctRaw  = Math.round((demandRamTiered / Math.max(1, rawRam)) * 100);
      return {
        verdict: "yellow",
        reason: "Survivor runs everything but only by consuming the configured reserve slack",
        hosts: survHosts,
        vcpuUsedPct: vcpuPctRaw,
        ramUsedPct: ramPctRaw,
      };
    }
    const overVcpu = demand.vcpu > rawVcpu;
    const overRam  = demandRamTiered > rawRam;
    const parts = [];
    if (overVcpu) parts.push(`vCPU short (${fmtNum(demand.vcpu)} need / ${fmtNum(rawVcpu)} avail)`);
    if (overRam)  parts.push(`RAM short (${fmtNum(demandRamTiered)} GB need / ${fmtNum(rawRam)} GB avail)`);
    return {
      verdict: "red",
      reason: parts.join(", ") || "Survivor cannot absorb demand",
      hosts: survHosts,
    };
  }

  return {
    hostsA,
    hostsB,
    siteA: verdictFor(hostsA),
    siteB: verdictFor(hostsB),
  };
}

// Find the smallest total host count at which BOTH sites achieve at least
// the target verdict. Used by the ClusterCard failover target toggles so
// users can click "Survive failover" and have the host-count floor jump
// to a number that flips both sides green without them having to hunt.
//
// Iterates from the architectural minimum upward (monotonic — adding hosts
// only ever improves the verdict). Returns null if no reasonable host
// count satisfies the target (shouldn't happen for sensible configs, but
// the caller treats null as "impossible" and disables the button).
function minHostsForVerdict(cluster, result, hostSplitPct, targetVerdict) {
  const order = { green: 0, yellow: 1, red: 2 };
  const targetMax = order[targetVerdict];
  const archMin = Math.max(
    result.floors.cpuHosts || 0,
    result.floors.ramHosts || 0,
    result.floors.storageHosts || 0,
    result.floors.policyMin || 0,
    1
  );
  const cap = Math.max(archMin * 20, 200);
  for (let n = archMin; n <= cap; n++) {
    // Synthesize a result with the candidate host count. analyzeStretchedFailover
    // only reads finalHosts / host / tier / demand / pipeline from the result,
    // and none of those change with the override — so we can safely substitute
    // finalHosts without re-running sizeCluster.
    const simulated = { ...result, finalHosts: n };
    const fo = analyzeStretchedFailover(cluster, simulated, hostSplitPct);
    if (order[fo.siteA.verdict] <= targetMax && order[fo.siteB.verdict] <= targetMax) {
      return n;
    }
  }
  return null;
}

// Aggregate cluster results up to domain level. `extraByClusterId` optionally
// injects additional appliance demand onto specific clusters (built by
// sizeInstance from wldStack componentsLocation decisions).
//
// The domain's own `placement` + a valid stretchSiteIds pair decide whether
// we compute a per-cluster failover analysis. Local domains and stretched
// domains without an explicit pair get `failover: null`.
function sizeDomain(domain, extraByClusterId = {}, _unusedInstanceIsStretched = false, vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  const domainIsStretched =
    domain.placement === "stretched"
    && Array.isArray(domain.stretchSiteIds)
    && domain.stretchSiteIds.length === 2;
  const clusterResults = domain.clusters.map((c) => {
    const r = sizeCluster(c, extraByClusterId[c.id] || [], vcfVersion);
    if (domainIsStretched) {
      r.failover = analyzeStretchedFailover(c, r, domain.hostSplitPct);
    } else {
      r.failover = null;
    }
    return r;
  });
  const totalHosts = clusterResults.reduce((s, r) => s + r.finalHosts, 0);
  const totalCores = clusterResults.reduce((s, r) => s + r.licensedCores, 0);
  const totalRawTib = clusterResults.reduce((s, r) => s + r.rawTib, 0);
  return { clusterResults, totalHosts, totalCores, totalRawTib };
}

// ─────────────────────────────────────────────────────────────────────────────
// v5 SIZING — instance-first, site-projected
// ─────────────────────────────────────────────────────────────────────────────
function sizeInstance(instance, vcfVersion = DEFAULT_VCF_VERSION_LEGACY) {
  // Step 1: build a per-cluster-id map of "extra" appliance demand that
  // should be injected into specific clusters.
  //
  // Each wldStack entry resolves to a target cluster in this order
  // (Plan 1 — per-appliance placement):
  //   1. entry.placementClusterId (per-entry override; e.g. an NSX Edge
  //      entry pinned to the WLD's own cluster while vCenter stays on mgmt)
  //   2. domain.componentsClusterId (per-domain default)
  //   3. mgmt domain's first cluster (VCF 9 default placement)
  //
  // Each level falls through to the next if the id doesn't resolve to a
  // real cluster — e.g. user deleted the pinned cluster after selecting it.
  //
  // wldStack entries are still listed ONCE in sharedStack downstream so the
  // Shared Appliances panel shows the full appliance inventory.
  const domains = instance.domains || [];
  const clusterById = {};
  for (const dom of domains) {
    for (const c of dom.clusters || []) clusterById[c.id] = c;
  }
  const mgmtDomain = domains.find((d) => d.type === "mgmt");
  const mgmtFirstCluster = mgmtDomain?.clusters?.[0];

  const extraByClusterId = {};
  for (const d of domains) {
    if (d.type !== "workload") continue;
    const wldStack = d.wldStack || [];
    if (wldStack.length === 0) continue;
    const domainTarget = clusterById[d.componentsClusterId] || mgmtFirstCluster;
    for (const entry of wldStack) {
      const target =
        clusterById[entry.placementClusterId]
        || domainTarget;
      if (!target) continue;
      extraByClusterId[target.id] = [
        ...(extraByClusterId[target.id] || []),
        entry,
      ];
    }
  }

  // A domain is "effectively stretched" when it carries a placement of
  // "stretched" AND an explicit 2-site pair via stretchSiteIds. With per-
  // domain pairs, the instance itself may touch 3+ sites but only some
  // domains may actually stretch.
  const anyStretchedDomain = domains.some(
    (d) =>
      d.placement === "stretched"
      && Array.isArray(d.stretchSiteIds)
      && d.stretchSiteIds.length === 2
  );
  const domainResults = domains.map((d) =>
    sizeDomain(d, extraByClusterId, anyStretchedDomain, vcfVersion)
  );
  const sharedStack = [];
  for (const d of domains) {
    for (const c of d.clusters || []) {
      for (const e of c.infraStack || []) sharedStack.push(e);
    }
    if (d.type === "workload") {
      for (const e of d.wldStack || []) sharedStack.push(e);
    }
  }
  const sharedTotals = stackTotals(sharedStack, vcfVersion);
  let witness = null;
  if (instance.witnessEnabled && anyStretchedDomain) {
    const wDef = APPLIANCE_DB.vsanWitness;
    const wSz = wDef?.sizes?.[instance.witnessSize] || wDef?.sizes?.Medium;
    // Count clusters that belong to an effectively-stretched domain (placement
    // + valid 2-site pair). Stretched-without-pair domains don't trigger
    // witness sizing.
    const stretchedClusters = domains.reduce(
      (acc, d) =>
        acc + (
          d.placement === "stretched"
          && Array.isArray(d.stretchSiteIds)
          && d.stretchSiteIds.length === 2
            ? (d.clusters || []).length
            : 0
        ),
      0
    );
    if (wSz && stretchedClusters > 0) {
      witness = {
        id: "vsanWitness",
        size: instance.witnessSize,
        instances: stretchedClusters,
        vcpu: wSz.vcpu * stretchedClusters,
        ram: wSz.ram * stretchedClusters,
        disk: wSz.disk * stretchedClusters,
      };
    }
  }
  const totalHosts = domainResults.reduce((s, r) => s + r.totalHosts, 0);
  const totalCores = domainResults.reduce((s, r) => s + r.totalCores, 0);
  const totalRawTib = domainResults.reduce((s, r) => s + r.totalRawTib, 0);
  return { instance, domainResults, sharedStack, sharedTotals, witness, totalHosts, totalCores, totalRawTib };
}

function projectInstanceOntoSite(instanceResult, siteId) {
  const { instance, domainResults } = instanceResult;
  const instSiteIds = instance.siteIds || [];
  if (!instSiteIds.includes(siteId)) return null;

  const projectedDomains = [];
  let anyPrimaryHere = false;
  let anySecondaryHere = false;
  let firstPartnerSiteId = null;

  for (let i = 0; i < domainResults.length; i++) {
    const dr = domainResults[i];
    const domain = instance.domains[i];
    const pair = Array.isArray(domain.stretchSiteIds) ? domain.stretchSiteIds : null;
    const stretched =
      domain.placement === "stretched" && pair && pair.length === 2;

    if (!stretched) {
      // Local domain — pinned to one specific site via localSiteId. Fall back
      // to instSiteIds[0] for backward compatibility with pre-v5.1 data (where
      // local always meant "primary site only").
      const localSite =
        domain.localSiteId && instSiteIds.includes(domain.localSiteId)
          ? domain.localSiteId
          : instSiteIds[0];
      if (localSite !== siteId) continue;
      projectedDomains.push({
        domain, domainResult: dr, sharePct: 100,
        projectedClusters: dr.clusterResults.map((cr, idx) => ({
          cluster: domain.clusters[idx], result: cr,
          hostsHere: cr.finalHosts, rawTibHere: cr.rawTib,
        })),
      });
      continue;
    }

    // Stretched domain — each domain carries its own 2-site pair, so the
    // primary/secondary role is resolved per-domain against stretchSiteIds,
    // not against the instance-wide siteIds.
    const isPrimary = pair[0] === siteId;
    const isSecondary = pair[1] === siteId;
    if (!isPrimary && !isSecondary) continue; // this site isn't part of this domain's pair
    if (isPrimary) anyPrimaryHere = true;
    else anySecondaryHere = true;
    if (firstPartnerSiteId === null) {
      firstPartnerSiteId = isPrimary ? pair[1] : pair[0];
    }

    const pct = getHostSplitPct(domain);
    const sharePct = isPrimary ? pct : 100 - pct;
    const frac = sharePct / 100;
    projectedDomains.push({
      domain, domainResult: dr, sharePct,
      projectedClusters: dr.clusterResults.map((cr, idx) => {
        // Host count split: the primary site gets ceil(full * pct/100) and
        // the secondary site gets `full - primary` so the two sites always
        // sum EXACTLY to finalHosts. The previous version independently
        // ceil'd both fractions, which for odd host counts produced
        // primary+secondary === finalHosts+1 — the extra phantom host
        // surfaced in fleet totalHosts rollups and masked single-host
        // increments from the manual override control.
        const full = cr.finalHosts || 0;
        const primaryHosts = Math.ceil(full * (pct / 100));
        const secondaryHosts = full - primaryHosts;
        const hostsHere = isPrimary ? primaryHosts : secondaryHosts;
        return {
          cluster: domain.clusters[idx], result: cr,
          hostsHere,
          rawTibHere: (cr.rawTib || 0) * frac,
        };
      }),
    });
  }

  // Role captures how this site sits within the instance's stretched domains.
  // "primary" when it's the primary of at least one pair; "secondary" when
  // it only acts as a secondary. When no stretched domain touches this site
  // (local-only projections, or single-site instances) we fall back to the
  // instance's siteIds index so legacy 2-site fleets keep returning
  // "primary"/"secondary" unchanged.
  let role;
  if (anyPrimaryHere) {
    role = "primary";
  } else if (anySecondaryHere) {
    role = "secondary";
  } else {
    const idx = instSiteIds.indexOf(siteId);
    role = idx === 0 ? "primary" : idx === 1 ? "secondary" : null;
  }
  return {
    siteId, instance,
    role,
    otherSiteId: firstPartnerSiteId,
    projectedDomains,
  };
}

function sizeFleet(fleet) {
  const vcfVersion = fleet.vcfVersion || DEFAULT_VCF_VERSION_LEGACY;
  // Plan 12 critical: explicit lambda — bare `.map(sizeInstance)` would silently
  // pass (element, index, array) and ignore vcfVersion, causing instances 1+
  // on a 9.1 fleet to size as 9.0. Discrete commit so this is bisectable.
  const instanceResults = (fleet.instances || []).map((inst) => sizeInstance(inst, vcfVersion));
  const siteResults = (fleet.sites || []).map((site) => ({
    site,
    projections: instanceResults
      .filter((ir) => ir.instance.siteIds.includes(site.id))
      .map((ir) => projectInstanceOntoSite(ir, site.id))
      .filter(Boolean),
  }));
  let totalVcpu = 0, totalRamGb = 0, totalDiskGb = 0;
  let fleetRawTib = 0, totalCores = 0;
  for (const ir of instanceResults) {
    totalVcpu += ir.sharedTotals.vcpu;
    totalRamGb += ir.sharedTotals.ram;
    totalDiskGb += ir.sharedTotals.disk;
    if (ir.witness) {
      totalVcpu += ir.witness.vcpu || 0;
      totalRamGb += ir.witness.ram || 0;
      totalDiskGb += ir.witness.disk || 0;
    }
    fleetRawTib += ir.totalRawTib || 0;
    totalCores  += ir.totalCores  || 0;
  }
  let totalHosts = 0;
  for (const sr of siteResults) {
    for (const p of sr.projections) {
      for (const pd of p.projectedDomains) {
        for (const pc of pd.projectedClusters) totalHosts += pc.hostsHere;
      }
    }
  }
  const entitlementTib = totalCores * TIB_PER_CORE;
  const addonTib = Math.max(0, fleetRawTib - entitlementTib);
  return {
    fleet, instanceResults, siteResults,
    totalHosts, totalCores, fleetRawTib, entitlementTib, addonTib,
    totals: { vcpu: totalVcpu, ramGb: totalRamGb, diskGb: totalDiskGb, hosts: totalHosts },
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// UMD-style export — attach to window (browser) and module.exports (Node).
// ─────────────────────────────────────────────────────────────────────────────
const VcfEngine = { APPLIANCE_DB, PLACEMENT_CONSTRAINTS, placementOptionsFor, DEPLOYMENT_PROFILES, DEPLOYMENT_PATHWAYS, SIZING_LIMITS, POLICIES, TB_TO_TIB, TIB_PER_CORE, NVME_TIER_PARTITION_CAP_GB, VLAN_ID_MIN, VLAN_ID_MAX, MTU_MGMT, MTU_VMOTION, MTU_VSAN, MTU_TEP_MIN, MTU_TEP_RECOMMENDED, DEFAULT_BGP_ASN_AA, TEP_POOL_GROWTH_FACTOR, DEFAULT_VCF_VERSION_LEGACY, DEFAULT_VCF_VERSION_NEW, SUPPORTED_VCF_VERSIONS, applianceSize, applianceAvailableIn, availableAppliances, profileStack, ensureVcfmsEntries, stripVersionExclusive, migrate9_0To9_1, migrate9_1To9_0, reconcileFleetVersion, reconcileInstanceVersion, SUPPORTED_WORKBOOK_VERSIONS, VCF_TO_WORKBOOK_VERSION, workbookVersionForFleet, WORKBOOK_CELL_MAP, emitWorkbookCellMap, emitWorkbookCellMapCsv, parseWorkbookCellMap, emitWorkbookXlsx, detectWorkbookVersion, readWorkbookXlsxAsCellMapRows, importWorkbookCellMap, computeReconcileDiff, PASSWORD_POLICY, generatePassword, generateWorkbookVault, emitWorkbookXlsxWithPasswords, NIC_PROFILES, createFleetNetworkConfig, createClusterNetworks, createHostIpOverride, createFleetNamingConfig, createClusterNaming, createFleetReportMetadata, createFleetInstallerConfig, baseStorageDataServices, slugify, resolveTemplate, mergeNamingConfig, hostTokensFor, vdsTokensFor, vdsSlotPurpose, resolveHostname, resolveVdsName, applyVdsTemplate, ipToInt, intToIp, ipPoolSize, subnetContainsIp, allocateClusterIps, validateNetworkDesign, validateNamingDesign, validateHostnameFormat, NAMING_DNS_LABEL_MAX, NAMING_DNS_FQDN_MAX, emitInstallerJson, recommendVcenterSize, recommendNsxSize, localId, baseHostSpec, baseStorageSettings, baseTiering, newCluster, newMgmtCluster, newWorkloadCluster, newMgmtDomain, newWorkloadDomain, newInstance, newSite, newFleet, domainSites, buildDefaultPlacement, ensurePlacement, getInitialInstance, isInitialInstance, getHostSplitPct, stackForInstance, promoteToInitial, inferDeploymentPathway, inferFederationEnabled, SSO_MODES, inferSsoMode, ssoInstancesPerBroker, SSO_INSTANCES_PER_BROKER_LIMIT, DR_POSTURES, DR_REPLICATED_COMPONENTS, DR_BACKUP_COMPONENTS, isWarmStandby, countActivePerFleetEntries, T0_HA_MODES, T0_MAX_T0S_PER_EDGE_NODE, T0_MAX_UPLINKS_PER_EDGE_AA, newT0Gateway, validateT0Gateways, EDGE_DEPLOYMENT_MODELS, validatePlacementConstraints, migrateV2ToV3, domainStructureMatches, stackSignature, liftV3Instance, migrateV3ToV5, migrateV5ToV6, migrateV6ToV9, migrateFleet, stackTotals, applianceEntryDisk, sizeHost, applyTiering, sizeStoragePipeline, sizeCluster, analyzeStretchedFailover, minHostsForVerdict, sizeDomain, sizeInstance, projectInstanceOntoSite, sizeFleet };
if (typeof window !== "undefined") { window.VcfEngine = VcfEngine; }
if (typeof module !== "undefined" && module.exports) { module.exports = VcfEngine; }
