# VCF Design Studio

A browser-based design and sizing tool for VMware Cloud Foundation 9 fleets.
Model multi-site deployments, configure host hardware, choose vSAN protection
policies, and let the sizing engine compute host counts, storage requirements,
and vSAN licensing. Version 6 adds full network design: physical NIC
profiles, VLAN/subnet/IP pool configuration, per-host IP allocation,
network validation, and export to VCF Installer JSON and Planning
Workbook CSV — all in a single HTML file with no build step.

**Dual-version support.** The studio targets both **VCF 9.0** and
**VCF 9.1**. A version selector in the fleet header pane lets you switch
between the two; the engine swaps in the right vCenter storage values and
toggles VCFMS (the new VCF 9.1 Kubernetes-based management service) on or off.
New fleets created today default to 9.1; legacy imports are backfilled to 9.0
and stay there unless you explicitly upgrade via the dropdown.

## Getting Started

### Quick start

1. Download or clone this repository
2. Open `vcf-design-studio-v9.html` in any modern browser (Chrome, Edge, Firefox, Safari)
3. Start designing — no installation, no server, no build step required

The entire application runs in a single HTML file. It loads React 18,
Tailwind CSS, and Babel from CDNs and runs entirely client-side.

### Typical workflow

1. **Configure your fleet** — set sites, VCF instances, deployment profile,
   and cluster hardware in the **Editor** tab
2. **Add networking** — select a NIC profile (2/4/6/8-NIC), fill in VLANs,
   subnets, and IP pools per cluster. Enter fleet DNS and NTP servers in the
   Fleet Summary panel
3. **Review the design** — switch to the **Network** tab to see physical NIC
   diagrams, VLAN/subnet map, T0 topology, and per-host IP assignments
4. **Check topology** — use the **Topology Diagram** tab for logical and
   physical fleet layout, and **Per-Site View** for resource allocation
5. **Export** — click **Export JSON** to save the full design,
   **Export Installer JSON** for VCF cloudBuilder input, or
   **Export Workbook CSV** for the Planning Workbook

### Importing an existing design

Click **Import JSON** to load a previously exported `.json` file. The studio
auto-migrates designs from older versions (v2, v3, v5) — you'll see a
notification when migration occurs. The original file is never modified.

To add an instance to an existing fleet, use **Import as new instance**
(VCF-PATH-002). This strips per-fleet appliances from the imported instance
so the current fleet's initial instance remains the sole host of those
services.

### Offline use

The app requires an internet connection on first load (to fetch React,
Tailwind, and Babel from CDNs). After that, most browsers will cache
these resources. For fully offline use, open the file once while connected,
then it will work offline from cache.

### For developers

```bash
npm install          # install dev dependencies (Vitest, Playwright)
npm test             # run full test suite
npm run build-html   # regenerate HTML from engine.js + JSX
npm run verify-html  # CI guard: check HTML matches source
npm run test:e2e     # Playwright browser tests
npm run coverage     # coverage report
npm audit --audit-level=high  # same check CI runs on every PR
```

CI runs `npm audit --audit-level=high` on every push and PR. A high- or
critical-severity advisory anywhere in the dependency tree fails the build;
moderates don't block (most live in dev-only tooling with no runtime
exposure). Dependabot opens upgrade PRs weekly and on-demand for security
advisories — see [.github/dependabot.yml](.github/dependabot.yml).

## What's New in v9

v9 is the dual-VCF-version release. The studio targets **both VCF 9.0 and VCF
9.1** from a single codebase; a version selector in the fleet header pane
swaps in the right vCenter storage values and toggles the new VCF 9.1 VCFMS
(VCF Management Service) Kubernetes control plane on or off. Existing
v5/v6 JSON exports auto-migrate on import — the v9 data format is additive
(adds `vcfVersion`, `sizesByVersion`, `stackByVersion`, `availableInVersions`)
so legacy fleets round-trip cleanly through the upgrade chain.

### VCF 9.1 support

- **Dual VCF version support** — single fleet header dropdown switches a
  fleet between VCF 9.0 and VCF 9.1 with confirmation dialogs that explain
  exactly what changes (VCFMS injection on up-migrate, VCFMS stripping on
  down-migrate). `value={fleet.vcfVersion ?? DEFAULT_VCF_VERSION_LEGACY}`
  protects against uncontrolled-input warnings during load.
- **VCFMS appliances** — VCF Management Service Control + Worker nodes (new
  in 9.1), modeled as `scope: "per-fleet"` so they deploy on the initial
  instance only and don't multiply across instances. Added to
  `DR_REPLICATED_COMPONENTS` alongside `fleetMgr`. `placementConstraint:
  "mgmt-only-greenfield"` hooks into existing `validatePlacementConstraints`.
- **vCenter storage profile values** — 9.1 reduces storage across all 5
  sizes × 3 profiles (Default/Large/X-Large) per the 9.1 P&P Workbook. The
  studio resolves the right value at sizing time from
  `def.sizesByVersion["9.1"]` via the new `applianceSize(def, size, vcfVersion)`
  resolver. Full-replacement override semantics — `sizesByVersion[v]` replaces
  `def.sizes` entirely when present.
- **`DEPLOYMENT_PROFILES.stackByVersion`** — each of the five profiles
  (simple/ha/haFederation/haSiteProtection/haFederationSiteProtection) gains
  a 9.1 stack variant that includes VCFMS entries. Profile re-apply on a 9.1
  fleet preserves VCFMS instead of silently stripping it.
- **Bidirectional migration** — `migrate9_0To9_1` (append-only injection of
  VCFMS, scope:per-fleet so only initial instance gets entries) and
  `migrate9_1To9_0` (destructive strip of 9.1-exclusive entries with
  user-confirmation dialog showing VCFMS removal count).
- **Reconcile helpers** — `reconcileFleetVersion` and
  `reconcileInstanceVersion` enforce VCF-version invariants on imported
  fleets / instances. Used by both `importConfig` (full fleet import) and
  `importAsNewInstance` (expand-fleet pathway with cross-version dialog).
- **`stackForInstance` / `promoteToInitial` are now version-aware** — they
  route through the new `profileStack(profile, vcfVersion)` resolver, so the
  user-facing "click HA profile" button on a 9.1 fleet preserves VCFMS.

### Studio rebrand v6 → v9

- **Single-HTML artifact renamed**: `vcf-design-studio-v6.html` → `vcf-design-studio-v9.html`
  (and `.jsx` source file). All build scripts, tests, and documentation
  updated.
- **Data format version**: `vcf-sizer-v6` → `vcf-sizer-v9` with new
  `migrateV6ToV9` step in the chain. Legacy v5/v6 imports still flow through
  cleanly via the existing `migrateV5ToV6` → `migrateV6ToV9` chain. Re-exports
  stamp `version: "vcf-sizer-v9"`.
- **Migration chain**: now `v2 → v3 → v5 → v6 → v9` with `vcfVersion` snapshot-
  and-restore across the v2/v3 chain (which historically dropped top-level
  fields). Legacy unversioned fleets backfill to `vcfVersion: "9.0"`.

### Workbook interop

- **Native `.xlsx` export (primary path)** — "Export VCF 9.x Workbook
  (.xlsx)" button in the export bar produces a stamped copy of the official
  VCF Planning & Preparation Workbook in one click. First click opens a
  modal asking you to drop the pristine `.xlsx` (download from Broadcom
  techdocs). The studio reads `Sheet2!J16` to confirm the version matches
  the fleet, then stamps every cell from `WORKBOOK_CELL_MAP` into a copy
  via SheetJS — the original file is never modified. The parsed workbook
  is cached for the tab's lifetime so subsequent exports are zero-click.
  Refuses to overwrite formula cells; ignores wrong-version pristine
  files; falls back to the cell-map CSV if you cancel the picker. SheetJS
  pinned to 0.20.3 from cdn.sheetjs.com (npm-published 0.18.5 has known
  Prototype Pollution + ReDoS CVEs).
- **Workbook import (greenfield)** — "Import Workbook" button accepts a
  stamped `.xlsx` or a cell-map CSV, parses every cell-map target, and
  offers to replace the current fleet with the imported state. A pre-flight
  modal shows the detected VCF version (read from `Sheet2!J16` or the CSV
  header), the count of cells applied, the count skipped (intentionally
  emit-only entries like naming-template-derived FQDNs), and any appliance
  entries that `computeReconcileDiff` would strip on the version boundary.
  The current fleet is not touched until you click **Replace current
  fleet** in the confirm modal. Full round-trip with the .xlsx and CSV
  emit paths: DNS / NTP servers, instance + domain identity, deployment
  model, vCenter sizing + cluster name, NSX Manager sizing, vSAN
  architecture, ESX / vMotion / vSAN VLAN IDs, VCFMS pool start, per-host
  ESXi hostnames (stripped of the DNS suffix into `hostOverrides[i]`),
  workload domain name, NSX Edge cluster name, and additional cluster
  names. The importer sorts rows by scope priority before applying so DNS
  lands before the per-host FQDN apply needs to strip it; multi-cluster
  workbooks get one cluster skeleton per row pre-allocated.
- **Cell-addressable CSV export (power-user fallback)** — "Cell Map CSV"
  button produces rows of `(workbookVersion, sheet, cell, label, value)`
  tuples targeting the official VCF Planning & Preparation Workbook. Each
  row tells the stamp script exactly which workbook cell to fill. The
  export auto-selects the workbook version from `fleet.vcfVersion` via
  `workbookVersionForFleet()`.
- **`WORKBOOK_CELL_MAP` constant** in [engine.js](engine.js) covers every
  scope value (per-fleet, instance, mgmt-domain, mgmt-cluster,
  mgmt-cluster-host with 16-row per-host expansion,
  initial-instance-mgmt-cluster for VCFMS, workload-domain, workload-cluster,
  additional-cluster) and every version-routing pattern (`cellByVersion`
  overrides, `cellPatternByVersion` for expansion blocks, version-scoped
  `workbookVersions`, `verifyLabel` / `verifyLabelByVersion` for cases where
  the workbook's bare label depends on the section header one row above).
- **Cell-meta fixtures** at
  [test-fixtures/workbook/](test-fixtures/workbook/) with 1681 entries (9.0)
  / 1760 entries (9.1), SHA-256 pinned. Captures sheet name, cell address,
  label cell + text, data type, sample value, data-validation enum, and
  merged-range membership for every labeled user-input cell on the five
  studio-relevant sheets. Source of truth for `WORKBOOK_CELL_MAP` addresses.
- **Extractor script** —
  [scripts/extract-workbook-cell-meta.py](scripts/extract-workbook-cell-meta.py)
  is the reproducible extraction pipeline. Re-run when Broadcom issues a
  workbook update.
- **Stamp script** — [scripts/stamp-workbook.py](scripts/stamp-workbook.py)
  consumes the CSV cell-map and writes values into a pristine copy of the
  official .xlsx via openpyxl with formula-cell refusal, merged-range
  detection, and data-validation case normalization safeguards.
- **Verifier** — [scripts/verify-cell-map.mjs](scripts/verify-cell-map.mjs)
  asserts every cell-map entry's `(sheet, cell)` matches a labelled
  user-input cell in the pristine workbook fixture (label match
  case-insensitive substring; formula cells fail).

### Carried forward from v6

- Full network design, NIC profiles, VLAN/subnet/IP allocator, VCF Installer
  JSON / freeform Workbook CSV export (cell-addressable export available
  alongside the freeform CSV).

### Test coverage

- **1178 automated tests** across 41 files (was 922 before v9 dual-version
  rebrand), 98.7% statement coverage. New test files for v9:
  `vcf-version-resolver.test.js`, `vcf-version-migration.test.js`,
  `vcf-version-integration.test.js`.

## What It Does

- Design multi-site VCF 9 fleets with configurable hardware per cluster
- Size management and workload domains against CPU, memory, and storage constraints
- Toggle per-cluster hyperthreading/SMT to model logical-thread-based CPU capacity
- Surface a recommendation when a vSAN cluster resolves to the 3-host minimum
- Model stretched clusters spanning two sites with configurable host-split ratios
- Compute per-cluster host counts, raw storage, and licensed cores
- Analyze failover capacity for stretched deployments (green / yellow / red verdicts)
- Select a deployment pathway (greenfield / expand / converge / import) and flag
  pre-existing clusters for the converge workflow
- Promote any VCF instance to be the fleet's initial instance; the per-fleet
  appliances (VCF Operations, Automation, Fleet Manager, Logs, Networks Platform)
  automatically move with the initial flag
- Model SSO topology (embedded / fleet-wide / multi-broker), NSX Federation
  intent, T0 gateway HA modes (Active/Standby vs Active/Active, stateful A/A),
  Edge cluster deployment model (host-FT / rack-FT / AZ-FT edge-HA / AZ-FT
  vSphere-HA), and fleet DR warm-standby pairings
- Export and import fleet designs as JSON (auto-migrates older format versions);
  "Import as new instance" supports the expand-fleet workflow

## Supported Deployment Permutations

The studio can design any VCF 9.0 deployment described in
[VCF-DEPLOYMENT-PATTERNS.md](VCF-DEPLOYMENT-PATTERNS.md). Every rule ID below
(`VCF-APP-*`, `VCF-INV-*`, `VCF-TOPO-*`, `VCF-PATH-*`, `VCF-DR-*`, `VCF-SSO-*`)
is the stable contract between the research doc, the engine, and the test
suite — every test name cites the rule ID it enforces.

### Fleet Topologies (VCF-TOPO-001..004)

| ID | Shape | Example fixture |
|----|-------|-----------------|
| VCF-TOPO-001 | Single instance, single site | [minimal-simple.json](test-fixtures/v5/minimal-simple.json), [minimal-ha.json](test-fixtures/v5/minimal-ha.json) |
| VCF-TOPO-002 | Single instance, stretched across 2 sites (one shared appliance stack) | [stretched-50-50.json](test-fixtures/v5/stretched-50-50.json), [enterprise-full.json](test-fixtures/v5/enterprise-full.json) |
| VCF-TOPO-003 | Multi-instance fleet (per-fleet services on initial instance; Collector on each) | [multi-instance-2.json](test-fixtures/v5/multi-instance-2.json), [multi-instance-federated.json](test-fixtures/v5/multi-instance-federated.json) |
| VCF-TOPO-004 | Multi-region fleet (optional per-site region grouping, warm-standby DR) | [multi-region-dr.json](test-fixtures/v5/multi-region-dr.json), [warm-standby-pair.json](test-fixtures/v5/warm-standby-pair.json) |

### Deployment Pathways (VCF-PATH-001..004)

| ID | Pathway | What it models |
|----|---------|----------------|
| VCF-PATH-001 | Greenfield | New fleet + new instance; Installer deploys full stack |
| VCF-PATH-002 | Expand-fleet | Add an instance; fleet-level services REUSED from initial |
| VCF-PATH-003 | Converge | Convert non-VCF vCenter to VCF mgmt (tag clusters as `preExisting`) |
| VCF-PATH-004 | Import | Import existing vCenter as a workload domain |

### SSO Models (VCF-SSO-001..003)

| ID | Mode | VMs | Scope |
|----|------|-----|-------|
| VCF-SSO-001 | Embedded (in mgmt vCenter) | 0 extra | per-instance |
| VCF-SSO-002 | Fleet-Wide appliance | 3-node cluster | per-fleet (recommended ≤ 5 instances) |
| VCF-SSO-003 | Cross-Instance multi-broker | 3 per broker | N brokers per fleet; fleet services bind to exactly ONE (VCF-INV-032) |

The fleet header has an SSO Model selector; multi-broker mode exposes a
broker list and a fleet-services broker pointer. A soft-warn pill flashes
when instances-per-broker exceeds 5 (VCF-INV-031).

### Fleet DR Posture (VCF-DR-001..050)

| ID | Concept | Modeled as |
|----|---------|------------|
| VCF-DR-001 | Warm-standby posture | `instance.drPosture: "warm-standby"` + badge on InstanceCard |
| VCF-DR-010 | VLR/vSphere-Replication components | Operations, Fleet Mgmt, Ops Logs, Ops Networks |
| VCF-DR-020 | Backup/restore components | Automation, Identity Broker |
| VCF-DR-030 | Per-instance appliances stay | SDDC Mgr, mgmt vCenter, mgmt NSX do NOT fail over |
| VCF-DR-040 | Fleet services dormant on standby | Warm-standby copies excluded from VCF-INV-010 active count |

### T0 Gateway Topology (VCF-APP-006, VCF-INV-060..065)

| HA Mode | Max Edge Nodes | Stateful services | Typical use |
|---------|:---:|---|---|
| Active/Standby | 2 | YES (default path) | VKS (Supervisor), VCF Automation All-Apps — both REQUIRE A/S |
| Active/Active stateless | 8 | no | N-S throughput scaling |
| Active/Active stateful | 2, 4, 6, or 8 (even) | Day-2 NSX Manager UI (VCF-INV-064) | NAT / LB / VPN under A/A with sub-cluster pairs |

Each T0 also carries:
- Up to 2 uplinks per Edge node in A/A (VCF-INV-065, total ≤ 16)
- Each Edge node hosts at most 1 T0 (VCF-INV-061)
- BGP default: A/A enabled with ASN 65000, A/S disabled with no default ASN
- Feature requirements chips (`vks`, `vcfAutomationAllApps`) that validate HA-mode compatibility

### Edge Cluster Deployment Models (VCF-APP-006)

| Model | Topology |
|-------|----------|
| Host Fault-Tolerant | Single AZ; survives host failure via vSphere HA |
| Rack Fault-Tolerant | Multi-rack within single AZ; higher N-S throughput |
| AZ FT — Edge HA | Dual-AZ with NSX Edge Node HA (fast failover) |
| AZ FT — vSphere HA | Dual-AZ with vSphere HA (requires VIRTUAL form factor — bare-metal NOT supported) |

Selectable per cluster via the T0 section of the ClusterCard. Informational
at design time; does not change sizing math.

## Appliance Catalog

`APPLIANCE_DB` in [engine.js](engine.js) contains 28 VCF management appliances.
Each entry carries cross-reference metadata:

- `ruleId` — points into [VCF-DEPLOYMENT-PATTERNS.md](VCF-DEPLOYMENT-PATTERNS.md) (e.g. `VCF-APP-010`).
- `scope` — one of `per-fleet`, `per-instance`, `per-domain-shared`, `per-cluster`, `per-stretched-cluster`, `cluster-internal`, `per-nsx-manager`, `per-monitored-scope`, `fleet-wide`, or `flex`.
- `dualRole: true` — for `vcenter` and `nsxMgr` which serve both mgmt and wld scopes; stack entries carry `role: "mgmt" | "wld"` to disambiguate.
- `availableInVersions: ["9.1"]` — version gating. Appliances without this field are available in every supported VCF version. VCFMS Control + Worker (new in 9.1) are gated to `["9.1"]` only.
- `sizesByVersion` — optional override map keyed by VCF version. When present, replaces `def.sizes` entirely for that version (full-replacement semantics — not deep-merge). Used for vCenter where 9.1 changed all storage profile values but kept vCPU/RAM identical.

Every value traces to the official Broadcom **VCF 9.0 Planning and
Preparation Workbook** (rows B8–B266) or the **VCF 9.1 P&P Workbook** for
9.1 deltas, or `techdocs.broadcom.com` (VKS Supervisor sizing). No blog
sources.

### Per-fleet appliances (live ONCE per fleet, on the initial instance)

| ID | Appliance | Research rule |
|----|-----------|---------------|
| `vcfOps` | VCF Operations (analytics) | VCF-APP-010 |
| `fleetMgr` | VCF Operations Fleet Manager | VCF-APP-012 |
| `vcfOpsLogs` | VCF Operations for Logs | VCF-APP-013 |
| `vcfOpsNet` | VCF Operations for Networks (Platform) | VCF-APP-014 |
| `vcfAuto` | VCF Automation | VCF-APP-020 |

**How the studio enforces this:** each profile's stack composition lists
all appliances, but the `stackForInstance(profileKey, isInitial)` helper
filters per-fleet entries out of non-initial instances' stacks. The
"Apply Profile" button on an InstanceCard uses this filter automatically —
a non-initial instance shows the per-fleet appliances *struck through* in
the profile preview so the user can see they were correctly excluded.

When `promoteToInitial()` moves the initial flag to another instance, both
instances' mgmt-cluster stacks are re-derived so per-fleet appliances
follow the flag.

### Per-instance appliances (live on every instance's mgmt domain)

| ID | Appliance | Research rule |
|----|-----------|---------------|
| `sddcMgr` | SDDC Manager | VCF-APP-001 |
| `vcenter` (role: mgmt) | Management vCenter | VCF-APP-002 |
| `nsxMgr` (role: mgmt) | Management NSX Manager | VCF-APP-004 |
| `vcfOpsCollector` | VCF Operations Collector | VCF-APP-011 (required on every non-initial instance) |
| `identityBroker` | VCF Identity Broker (WSA) | VCF-APP-030 (in embedded / fleet-wide / multi-broker modes) |
| `aviLb` | Avi Load Balancer | VCF-APP-050 |
| `srm` | Site Recovery Manager | VCF-APP-060 |
| `vrms` | vSphere Replication (VRMS) | VCF-APP-061 |

### Per-domain / per-cluster / per-nsx-manager

| ID | Appliance | Scope | Placement | Research rule |
|----|-----------|-------|-----------|---------------|
| `vcenter` (role: wld) | Workload vCenter | per-domain | mgmt-only-greenfield | VCF-APP-003 |
| `nsxMgr` (role: wld) | Workload NSX Manager | per-domain-shared (one NSX can serve multiple wld domains in same instance) | mgmt-only-greenfield | VCF-APP-005 |
| `nsxEdge` | NSX Edge | per-nsx-manager | flexible (mgmt OR wld — user choice) | VCF-APP-006 |
| `aviController` | Avi Load Balancer Controller | per-instance | mgmt-only-greenfield | VCF-APP-050a |
| `aviServiceEngine` | Avi Load Balancer Service Engine | per-domain | wld-only (data plane) | VCF-APP-050b |
| `nsxGlobalMgr` | NSX Global Manager | fleet-wide (only when `fleet.federationEnabled`) | per-instance | VCF-APP-040 |
| `vksSupervisor` | VKS Supervisor | per-cluster | wld-only (cluster-internal) | VCF-APP-070 |
| `vsanWitness` | vSAN Witness Host Appliance | per-stretched-cluster | witness site | VCF-APP-080 |

**Placement constraints (`APPLIANCE_DB[id].placementConstraint`):**

- **`mgmt-only-greenfield`** — Workload-domain vCenter, NSX Manager, and Avi Controller VMs run on the management domain in greenfield/expand/converge pathways. The placement validator (VCF-INV-003) flags violations. Imported (brownfield) workload domains are exempt — see [Brownfield workload domains](#brownfield-workload-domains-vcf-path-004).
- **`flexible`** — NSX Edge nodes are user-placeable on either mgmt or workload-domain clusters per VCF-APP-006-SUP-1/4. Aria-adjacent Edge clusters MUST be on mgmt; workload-facing Edges typically live on the workload domain's hosts.
- **`wld-only`** — Avi Service Engines and VKS Supervisor control-plane/worker VMs run on the workload domain's own clusters by design.

#### Avi Load Balancer split

The legacy `aviLb` appliance id is split into two entries reflecting Broadcom's authoritative architecture:

> "All Avi Controllers are deployed in the management domain, even when the Avi Load Balancer is deployed in a VI workload domain. Service Engines (SEs) are deployed in the workload domain in which the Avi Load Balancer is providing load balancing services."

The `aviLb` id is retained as a deprecated alias so unmigrated v5/v6 fixtures keep loading; `migrateFleet` rewrites them to `aviController` + appends a default `aviServiceEngine` group on workload domains.

#### Brownfield workload domains (VCF-PATH-004)

Each workload domain carries `domain.imported: boolean`. False (default) means greenfield/expand/converge — placement constraints fully apply. True means the domain was imported via VCF-PATH-004 and may carry pre-existing appliance VMs on its own hosts; mgmt-only-greenfield constraints relax. Migration auto-detects legacy fleets that placed wldStack appliances on workload-domain clusters and flips `imported = true`, surfacing a one-time UI banner on import.

## Data Model

```
Fleet
├── deploymentPathway       — greenfield | expand | converge | import (VCF-PATH-*)
├── federationEnabled       — boolean; controls nsxGlobalMgr placement (VCF-INV-021)
├── ssoMode                 — embedded | fleet-wide | multi-broker (VCF-SSO-*)
├── ssoBrokers[]            — only when ssoMode === "multi-broker"
├── ssoFleetServicesBrokerId — VCF-INV-032: fleet services bind to ONE broker
├── sites[]                 — physical locations
│   ├── name, location
│   ├── region              — optional; drives Per-Site view grouping (VCF-TOPO-004)
│   └── siteRole            — optional: "primary" | "dr" | "witness"
└── instances[]             — VCF deployments (sibling to sites, not nested)
    ├── siteIds[]           — 1 = single-site, 2 = stretched
    ├── deploymentProfile   — simple | ha | haFederation | haSiteProtection | haFederationSiteProtection
    ├── drPosture           — "active" (default) | "warm-standby" (VCF-DR-001)
    ├── drPairedInstanceId  — paired primary instance id when warm-standby
    ├── witnessSiteId       — references fleet.sites[] with siteRole="witness"
    └── domains[]           — exactly 1 mgmt + 0..N workload
        ├── placement       — local (pinned to one site) or stretched
        ├── hostSplitPct    — % of hosts at siteIds[0] when stretched
        ├── imported        — VCF-PATH-004 brownfield marker; relaxes the
        │                     mgmt-only-greenfield placement constraint for
        │                     workload-domain clusters
        ├── componentsClusterId — domain-default cluster for wldStack entries
        ├── wldStack[]      — workload-domain appliances (vCenter, NSX Mgr, Edges, Avi)
        │   └── entry: { id, size, instances, key, role, placementClusterId, ownerDomainId }
        │     placementClusterId — per-entry override; null = follow domain default;
        │                          lets NSX Edge pin to a WLD cluster while vCenter
        │                          stays on a mgmt cluster
        └── clusters[]
            ├── host spec         — CPUs, cores, hyperthreading, RAM, NVMe
            ├── workload          — VM count, vCPU/RAM/disk per VM
            ├── infraStack[]      — appliances hosted in this cluster (per-stack-entry role for dualRole appliances)
            ├── storage policy    — RAID/Mirror, dedup, compression, reserves
            ├── tiering           — NVMe memory tiering settings
            ├── t0Gateways[]      — T0 HA mode, edge bindings, stateful, BGP, feature reqs
            ├── edgeDeploymentModel — host-FT | rack-FT | AZ-FT edge-HA | AZ-FT vSphere-HA
            ├── preExisting       — VCF-PATH-003 converge marker
            └── hostOverride      — manual host-count floor
```

**Workload-domain components placement.** Each `wldStack` entry resolves to a target cluster in this order:

1. `entry.placementClusterId` (per-entry override)
2. `domain.componentsClusterId` (per-domain default)
3. The management domain's first cluster (fleet-wide fallback)

For greenfield/expand/converge fleets, entries with `placementConstraint: "mgmt-only-greenfield"` (vCenter, NSX Manager, Avi Controller) MUST resolve to a mgmt-domain cluster — `validatePlacementConstraints(fleet)` flags any that don't with a critical VCF-INV-003 issue. Toggle the workload domain's **Imported (brownfield)** flag to relax the rule for VCF-PATH-004 imports.

**Stretched clusters:** A stretched VCF instance is ONE instance with two
`siteIds` and ONE appliance stack (one SDDC Manager, one 3-node NSX Manager
cluster, etc.). This matches how VCF actually deploys — appliances are not
duplicated per site.

**Initial-instance convention:** `fleet.instances[0]` IS the initial
instance by convention. Per-fleet appliances (see table above) live only on
this instance's mgmt domain initial cluster. The UI shows a "★ INITIAL"
badge on instance[0] and a "↑ Promote to initial" button on each other
instance that automatically re-derives both instances' mgmt stacks.

## Deployment Profiles

Each VCF instance selects a deployment profile that determines which
management appliances are deployed and how many nodes each gets. The
initial instance gets the full stack; non-initial instances drop
`scope === "per-fleet"` entries automatically.

| Profile | Description | Typical Stack Size (initial) |
|---------|-------------|:----------------------------:|
| `simple` | Lab/PoC — single-node appliances, no redundancy | ~8 VMs |
| `ha` | Production — clustered with full HA | ~14 VMs |
| `haFederation` | HA + 3-node NSX Global Manager | ~17 VMs |
| `haSiteProtection` | HA + SRM + vSphere Replication | ~16 VMs |
| `haFederationSiteProtection` | Full enterprise — HA + Federation + DR | ~19 VMs |

## Sizing Engine

### Host Capacity

Each cluster defines its own host hardware spec:

```
cores       = cpuQty × coresPerCpu                         // physical
threads     = hyperthreadingEnabled ? cores × 2 : cores    // logical
rawGb       = nvmeQty × nvmeSizeTb × 1000
usableVcpu  = threads × cpuOversub × (1 - reservePct / 100)
usableRam   = ramGb   × ramOversub × (1 - reservePct / 100)
```

Hyperthreading (Intel HT / AMD SMT) affects **vCPU sizing capacity only**.
`licensedCores` stays based on physical cores to match VCF per-core
licensing. A dual-socket 16-core host reports 32 cores / 64 threads with
HT enabled; licensing is still computed against the 32 physical cores.

Default host: 2 × 16-core CPUs, 1024 GB RAM, 6 × 7.68 TB NVMe,
2:1 CPU overcommit, 1:1 RAM overcommit, 30% reserve, hyperthreading
disabled (preserves math for configs imported from earlier versions).

### Storage Pipeline

Raw workload demand flows through a multi-stage pipeline:

```
drr          = dedup × compression                         // data reduction ratio
vmCapGb      = demandDiskGb / drr                          // after reduction
swapGb       = demandRamGb × (swapPct / 100)               // swap allocation
protectedGb  = (vmCapGb + swapGb) × protectionFactor       // after RAID/Mirror
withFreeGb   = protectedGb × (1 + freePct / 100)           // free space buffer
totalReqGb   = withFreeGb × (1 + growthPct / 100)          // growth headroom
```

Default storage: RAID-5 (2+1), no dedup/compression, 100% swap,
25% free space buffer, 15% growth allowance.

### NVMe Memory Tiering

When enabled, a partition of each NVMe drive extends effective RAM:

```
tierPartitionGb   = min(ramGb × nvmePct/100, tierDriveSizeTb × 1000, 4096)
activeRatio       = tierPartitionGb / ramGb
effectiveRam      = ramGb × (1 + activeRatio) × ramOversub × (1 - reservePct/100)
```

Only a configurable percentage of workload is eligible for tiered memory.
Ineligible workload uses standard RAM demand. The partition cap is 4 TB
per drive (`NVME_TIER_PARTITION_CAP_GB = 4096`).

### Cluster Host Count

The final host count is the maximum of five constraint floors:

```
cpuHosts      = ceil(totalVcpuDemand / usableVcpu)
ramHosts      = ceil(tieredRamDemand / effectiveRamPerHost)
storageHosts  = ceil(totalReqGb / rawGbPerHost) + ftt
policyMin     = minHosts from protection policy (3, 5, 6, or 7)
manualFloor   = user-specified host override (0 = disabled)

finalHosts    = max(cpuHosts, ramHosts, storageHosts, policyMin, manualFloor)
```

The **limiter** label shown in the UI indicates which floor determined the
host count (CPU, Memory, Storage, Policy, or Manual). When a vSAN cluster
resolves to exactly 3 hosts, the UI renders an informational warning
recommending 4 nodes for auto-healing (see **vSAN Protection Policies**
below).

### vSAN Protection Policies

| Policy | Protection Factor | Min Hosts | FTT |
|--------|:-----------------:|:---------:|:---:|
| RAID-5 (2+1) FTT=1 | 1.50 | 3 | 1 |
| RAID-5 (4+1) FTT=1 | 1.25 | 6 | 1 |
| RAID-6 (4+2) FTT=2 | 1.50 | 6 | 2 |
| Mirror FTT=1 | 2.00 | 3 | 1 |
| Mirror FTT=2 | 3.00 | 5 | 2 |
| Mirror FTT=3 | 4.00 | 7 | 3 |

When external storage is enabled on a cluster, vSAN storage math is skipped
and `rawTib = 0` for that cluster.

**3-node vSAN caution.** Policies with a 3-host minimum (RAID-5 2+1,
Mirror FTT=1) meet the architectural minimum but cannot auto-heal after a
host failure — rebuild requires replacement hardware before redundancy is
restored. 4 hosts provide a spare fault domain and enable automatic
re-protection of data after failures or during maintenance. The UI
surfaces a warning on any vSAN cluster that resolves to exactly 3 hosts.
To lift the floor without changing the policy, set a Host Override of 4
on the cluster.

### vSAN Licensing

```
licensedCores  = finalHosts × coresPerHost        // per cluster
totalCores     = sum across all clusters in fleet
entitlementTib = totalCores × TIB_PER_CORE         // 1 TiB per core
fleetRawTib    = sum of rawTib across all clusters
addonTib       = max(0, fleetRawTib - entitlementTib)
```

If raw capacity exceeds entitlement, the fleet summary shows the additional
vSAN capacity TiB required (`addonTib`).

### Stretched Cluster Failover Analysis

For stretched domains, the engine evaluates whether each site can survive
loss of the other:

- **Green** — survivor has headroom within reserves (CPU, RAM, and storage
  demands fit in usable capacity)
- **Yellow** — survivor can run everything but consumes reserve capacity
  (fits raw capacity with overcommit, but exceeds usable after reserve)
- **Red** — survivor cannot absorb demand, or surviving host count is below
  the protection policy minimum

Host distribution is controlled by `hostSplitPct` (default 50/50):

```
primaryHosts   = ceil(finalHosts × hostSplitPct / 100)
secondaryHosts = finalHosts - primaryHosts
```

### vSAN Witness

When an instance is stretched and has stretched clusters, a vSAN witness
host is deployed at a third fault domain. One witness per stretched cluster.
Witness can either live in `instance.witnessSite` (free-form) or be shared
across instances by referencing a `fleet.sites[]` entry with
`siteRole: "witness"` via `instance.witnessSiteId`.

Witness sizing tiers:

| Size | vCPU | RAM | Disk | Limits |
|------|:----:|:---:|:----:|--------|
| Tiny | 2 | 8 GB | 15 GB | ≤10 hosts, ≤750 components |
| Medium | 2 | 16 GB | 350 GB | ≤21 hosts, ≤22.5k components |
| Large | 2 | 32 GB | 730 GB | ≤64 hosts, ≤45k components |

## Views

- **Editor** — configure sites, instances, domains, and clusters with
  per-cluster hardware specs, workload sizing, storage policies, T0
  gateways, and Edge deployment model
- **Topology** — auto-generated SVG diagram showing fleet layout (solid
  lines to primary site, dashed blue lines to secondary sites for
  stretched instances). Overlay panels below the SVG summarize T0
  Gateways, SSO Topology, DR Pairs, and NSX Federation links
- **Physical** — rack/host-level view with the same overlay panels; legend
  includes Warm-Standby and T0 Gateway color keys
- **Per-Site** — resource projections broken down by site, optionally
  grouped by `site.region` (VCF-TOPO-004). Shared appliances (stretched
  instance management stacks) render in their own section rather than
  being split per site

## Import / Export

- **Import JSON** — replaces the current fleet. Auto-migrates v2 / v3 / v5 / v6 / v9
  exports; migration alert fires when the version bumps.
- **Import as new instance** — appends the imported fleet's first instance
  to the current fleet as an expand-fleet addition (VCF-PATH-002). Strips
  per-fleet appliances from the imported instance so the current fleet's
  initial instance remains the sole host of those services.
- **Export JSON** — serializes the full fleet with `version: "vcf-sizer-v9"`
  and a timestamp. Includes network configuration per cluster.
- **Export Installer JSON** — produces VCF Installer `bringup-spec.json`-shaped
  output with DNS, NTP, network specs, per-host IPs, and edge specs.
- **Export Workbook CSV** — produces Planning Workbook rows for fleet services,
  network config, IP plan, and BGP configuration.
- **Print / Save as PDF** — opens the browser print dialog with a polished
  multi-page document optimized for client delivery. Use the dialog's "Save
  as PDF" option to write the file. The output is vector (text-selectable,
  searchable, zoomable), typically 300 KB – 2 MB, and renders in under 2 s.
  See [PDF export](#pdf-export-plan-8) below for the full content map and
  customization options.

### PDF export

Click **Print / Save as PDF** in the header to open the browser's print
dialog with a print-optimized rendering of the entire fleet. The output
includes:

1. **Cover page** — fleet name, summary stats, plus optional client/project
   metadata from `fleet.reportMetadata` (configured in the Fleet Summary
   panel under "Report Metadata"): client name, project ID, prepared by,
   revision, document date.
2. **Executive summary** — pathway, SSO, federation, fleet totals, sites table.
3. **Per-instance sections** — one per VCF instance with profile, sites,
   capacity, and per-domain breakdown (mgmt + workload). Domain entries
   include placement (local / stretched), brownfield (VCF-PATH-004) badge
   when applicable, components-cluster pin, and the workload-domain
   appliance stack (vCenter, NSX Manager, Avi Controller, etc.).
4. **Per-cluster blocks** — host hardware spec, sizing math output (host
   count + limiter + floors), storage policy, T0 gateways, NIC profile +
   VLAN/subnet config, per-host IP plan with resolved hostnames.
5. **Network configuration** — DNS, NTP, syslog, naming-convention templates.
6. **Validation issues** — VCF-IP-* / VCF-NET-* / VCF-NAMING-* issues grouped
   by severity (critical, error, warn, info).
7. **Appliance inventory** — fleet-wide totals by appliance type.

**Customization:** populate fields in the **Fleet Summary → Report
Metadata** panel before printing. Empty fields render as `—` on the cover.
`documentDate` defaults to today's date when blank.

**Output format:** A4 by default; switch to Letter via the print dialog's
paper-size dropdown. All numbers formatted with `en-US` locale for
predictable client deliverables regardless of the consultant's browser
locale.

**Why browser print, not html2pdf.js or pdfmake:** chosen after a
multi-agent technical review (architect / performance / code review).
`window.print()` produces vector PDFs (text-selectable, sub-2-second
generation, ~0 KB additional bundle, native SVG fidelity). Image-based
alternatives like html2pdf.js were rejected because they break Ctrl-F /
copy-paste of IPs and hostnames, take 60–120 s on the enterprise fixture,
and produce 27–56 MB output that exceeds typical email attachment limits.

#### Print dialog settings for the cleanest output

The browser injects a default header/footer (timestamp, page title,
URL, page count) on every page. To produce a clean client deliverable:

1. Click **Print / Save as PDF** to open the dialog.
2. Set **Destination** to *Save as PDF*.
3. Expand **More settings**.
4. Uncheck **Headers and footers**.
5. (Optional) Set **Margins** to *Default* (or *Minimum* for denser output).
6. (Optional) Switch **Paper size** to *Letter* if your deliverable
   norm is US Letter rather than A4.
7. Save.

Without these settings, the PDF still works but carries the browser-
injected `5/8/26, 11:27 AM | VCF Design Studio — v9 | file:///…` chrome
on every page.

#### What the PDF includes

A typical fleet renders to ~10–14 pages:

- **Cover page** — fleet name + report metadata + 8-tile scope panel
  (sites, instances, domains, clusters, hosts, cores, raw vSAN, add-on)
- **Table of contents** — all top-level sections
- **Executive summary** — pathway, SSO, federation, totals + sites
  table + **Design Highlights** surfacing stretched domains, DR
  pairings, brownfield (imported) workload domains, per-appliance
  placement overrides, and naming-template configuration
- **Logical topology** — fleet → site → instance → mgmt/workload
  domain → cluster hierarchy on a landscape page so the entire tree
  fits at a glance. High-level cluster boxes (name, host count, cores,
  limiter) — appliance detail belongs on the physical view
- **Physical topology** — fleet-wide rack-level layout on a landscape
  page showing every site side-by-side, with full appliance pills
  inside each cluster (label + ×N count + cpu/RAM specs). Stretched
  relationships and witness sites summarized in callouts
- **Per-instance sections** — domains and clusters flow inside the
  parent instance section so pages aren't sparse. Each cluster shows
  hardware, sizing math, T0 list, NIC profile, NIC topology SVG,
  T0 SVG (when configured), and per-host IP plan (when subnet pool
  configured)
- **Per-site capacity** — host count + raw TiB per site + fleet totals
- **Network & naming configuration** — DNS / NTP / syslog / templates
- **Validation issues** — grouped by severity
- **Fleet appliance inventory** — fleet-wide totals by appliance type

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TB_TO_TIB` | 0.9095 | TB → TiB conversion factor |
| `TIB_PER_CORE` | 1 | vSAN raw TiB entitlement per licensed CPU core |
| `NVME_TIER_PARTITION_CAP_GB` | 4096 | Max NVMe memory tier partition (4 TB) |
| `T0_MAX_T0S_PER_EDGE_NODE` | 1 | One T0 per Edge node (VCF-INV-061) |
| `T0_MAX_UPLINKS_PER_EDGE_AA` | 2 | Max uplinks per Edge node in A/A T0 (VCF-INV-065) |
| `SSO_INSTANCES_PER_BROKER_LIMIT` | 5 | Soft warn threshold (VCF-INV-031) |
| `VLAN_ID_MIN` / `MAX` | 1 / 4094 | Valid VLAN range |
| `MTU_MGMT` | 1500 | Management network MTU |
| `MTU_VMOTION` / `MTU_VSAN` | 9000 | Jumbo frame MTU for vMotion / vSAN |
| `MTU_TEP_MIN` / `RECOMMENDED` | 1600 / 1700 | Geneve overlay TEP MTU bounds |
| `DEFAULT_BGP_ASN_AA` | 65000 | Default BGP ASN for A/A T0 (VCF-APP-006) |
| `NIC_PROFILES` | 4 profiles | 2-NIC / 4-NIC / 6-NIC / 8-NIC layouts |

## File Structure

```
vcf-design-studio-v9.html         standalone runnable app (open in browser)
vcf-design-studio-v9.jsx          source JSX (React components)
engine.js                          pure sizing engine (shared between HTML + tests)

scripts/
├── build-html.mjs                 stitches engine.js + .jsx into the HTML
├── verify-html-sync.mjs           CI guard: blocks drift between source + HTML
└── generate-fixtures.mjs          deterministic fixture generator

test-fixtures/
├── v5/                             18 canonical fleet scenarios (see table above)
├── v6/                             6 network-populated fixtures
├── v3/, v2/                        legacy imports used by migration tests
└── snapshots/                      committed sizing snapshots per fixture

tests/
├── unit/                           Vitest unit tests (pure engine functions)
├── migration/                      v2→v3→v5→v6→v9 migration suites
├── snapshot/                       sizing snapshot regression guard
├── invariants/                     fast-check property-based tests
└── e2e/                            Playwright browser tests

.github/workflows/
├── test.yml                        push/PR — unit + coverage → playwright
└── nightly.yml                     06:00 UTC daily against main + artifacts
```

## Test Suite

Run `npm test` for the full Vitest suite (unit + migration + snapshot +
invariants), `npm run test:e2e` for Playwright. Current counts:

- **1178 automated checks** across 41 test files
- Engine coverage: 98.4% stmts / 75.5% branches / 98.4% funcs
- 18 v5 fixtures + 6 v6 network fixtures + 1 v3 fixture + 1 v2 fixture
  (legacy fixtures exercise the v2→v3→v5→v6→v9 migration chain) covering
  every `VCF-TOPO-*`, `VCF-PATH-*`, `VCF-DR-*`, `VCF-SSO-*`, `VCF-NET-*`,
  `VCF-IP-*`, `VCF-HW-NET-*` and major policy permutation
- 6 Playwright smoke tests exercising UI shell, tab switching, overlay
  panels, and full-fixture round-trip import

Rule IDs (`VCF-INV-*`, `VCF-APP-*`, etc.) appear in test `describe()` titles
so `grep -r "VCF-INV-" tests/` produces a complete coverage matrix.

## Networking Design (v9)

The studio models the full VCF networking stack alongside compute sizing:

- **NIC Profiles** — 4 canned layouts (2-NIC / 4-NIC / 6-NIC / 8-NIC) defining
  physical vmnic → vDS → portgroup mappings. Selectable per cluster.
- **VLAN / Subnet / IP Pool** — per-cluster configuration for Management, vMotion,
  vSAN, Host TEP, and Edge TEP networks with gateway and IP pool ranges.
- **IP Allocator** — deterministic pool-driven allocation of per-host IPs (vmk0
  mgmt, vmk1 vMotion, vmk2 vSAN, vmk10/11 TEP). Per-host overrides supported.
  DHCP path for host TEP.
- **Network Validation** — 13 rules (VCF-IP-001..007, VCF-NET-010/011/030/031,
  VCF-HW-NET-020/022) checking VLAN uniqueness, pool sizing, subnet containment,
  MTU minimums, and BGP peer reachability.
- **Naming Conventions** — token-based templates for ESXi hostnames and vDS
  switch names (see [Naming Conventions](#naming-conventions) below).
- **Export: VCF Installer JSON** — produces `bringup-spec.json`-shaped output with
  `dnsSpec`, `ntpServers`, `networkSpecs`, `hostSpecs` (incl. resolved `hostname`),
  and `edgeSpecs`.
- **Export: Workbook CSV** — produces Planning Workbook rows for Fleet Services,
  Network Configuration, IP Address Plan (with Hostname column), and BGP Configuration sheets.
- **Network View tab** — dedicated visualization with Physical NIC diagrams,
  VLAN/Subnet map, NSX Edge/T0 topology, and per-host IP grid.

Network rules are documented in [VCF-NETWORKING-PATTERNS.md](VCF-NETWORKING-PATTERNS.md).

### Naming Conventions

Hostnames and vDS switch names render from token-based templates with a
three-tier override hierarchy. Templates default to empty (preserves
"no hostname / hardcoded vDS names" behavior); users opt in via the
**Naming Conventions** panel inside Fleet Summary.

**Override hierarchy** (most specific wins):

1. `cluster.hostOverrides[i].hostname` (per-host literal)
2. `cluster.naming.{hostTemplate, vdsTemplate, prefix, postfix}` (per-cluster override)
3. `fleet.namingConfig.{hostTemplate, vdsTemplate, prefix, postfix, separator, seqStart, seqPadding}` (fleet defaults)

**Available tokens:**

| Token | Source | Notes |
|---|---|---|
| `{prefix}` | `naming.prefix` | Fleet/cluster prefix (e.g. `vcf`) |
| `{postfix}` | `naming.postfix` | Lives at the end; leading dot preserved (e.g. `.lab.local`) |
| `{site}` | site name slug | Falls back to first instance siteId |
| `{instance}` | instance name slug | |
| `{cluster}` | cluster name slug | |
| `{role}` / `{domain}` | `mgmt` or `wld` | Synonyms; `{role}` reads more naturally |
| `{purpose}` | vDS only | Lowercased portgroup keys joined with `-` (e.g. `mgmt-vmotion`, `sdn`) |
| `{seq}`, `{seq:02}`, `{seq:03}` | host index + `seqStart` | Optional zero-padding |

**Examples:**

| Template | Resolves to |
|---|---|
| `{prefix}-{site}-{role}-{seq:02}{postfix}` | `vcf-wh200-wld-01.lab.local` |
| `{prefix}-{cluster}-vds-{purpose}` (vDS) | `vcf-prod-01-vds-mgmt-vmotion` |
| `host-{seq:02}` | `host-01`, `host-02`, … |

**Slug rules:** lowercase, whitespace/`_` → separator, strip non-`[a-z0-9-]`,
collapse runs, trim edges, cap at 32 chars. Unknown tokens render as empty
string and adjacent separators collapse — `{prefix}-{site}-{role}-{seq:02}`
with empty prefix and no site renders `mgmt-01`, not `--mgmt-01`. Leading
dots in `{postfix}` are preserved so FQDN suffixes survive intact.

**Storage:**
- Hostnames are **virtual** — computed at IP allocation time from template +
  per-host override. Only `cluster.hostOverrides[i].hostname` is persisted
  (when set explicitly). Edit a template and every cluster's hostnames
  update in the next render.
- vDS names are **stored** in `cluster.networks.vds[i].name` (so users can
  hand-edit). Click **↻ Re-apply naming template** on a ClusterCard to
  regenerate stored names from the current vDS template.

**Validators:**
- `VCF-NAMING-001` — hostname uniqueness across the entire fleet (critical;
  blocks export).
- `VCF-NAMING-002` — DNS-format compliance per resolved hostname: ≤63 chars
  per label, ≤253 chars total FQDN, only `[a-z0-9-]`, no leading/trailing
  hyphens (critical).

Both fire from `validateNetworkDesign(fleet, fleetResult)` when a
`fleetResult` is supplied; without one, only per-host overrides are
checked (skips template-resolved names since `finalHosts` is unknown).

### VCF-PATH-004 brownfield workload domains

Each workload domain carries `domain.imported: boolean`. Greenfield
WLDs (`false`, default) follow Broadcom's mgmt-only-greenfield placement
constraint for vCenter / NSX Manager / Avi Controller. Imported WLDs
(`true`) keep pre-existing appliance VMs on the workload domain's own
hosts; `validatePlacementConstraints` skips them. Migration auto-detects
legacy fleets that placed wldStack appliances on workload-domain clusters
and flips `imported = true`, surfacing a one-time post-import banner
above the editor.


## Related Documents

- [VCF-DEPLOYMENT-PATTERNS.md](VCF-DEPLOYMENT-PATTERNS.md) — authoritative
  catalog of VCF 9.0 placement rules, fleet topologies, and invariants.
  Engine `APPLIANCE_DB` ids and scopes are the stable contract against
  this doc. 9.0 reference document; 9.1 deltas live in
  [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md).
- [VCF-NETWORKING-PATTERNS.md](VCF-NETWORKING-PATTERNS.md) — VCF 9.0
  networking design rules. Rule IDs `VCF-NET-*`, `VCF-IP-*`, `VCF-HW-NET-*`
  are the validation contract. Networking is unchanged in 9.1; see
  VCF-9.1-DELTA.md for the one new VCFMS network requirement.
- [VCF-9.1-DELTA.md](VCF-9.1-DELTA.md) — captures every change between
  VCF 9.0 and VCF 9.1 that affects sizing math, plus VCFMS network
  requirements (contiguous IPs on the mgmt VLAN, FQDNs, internal
  Kubernetes pod CIDR).

## Provenance

Every appliance value in `APPLIANCE_DB` traces to the official Broadcom
**VCF 9.0 Planning and Preparation Workbook** (`sizes`) and the **VCF 9.1
P&P Workbook** (`sizesByVersion["9.1"]`), or `techdocs.broadcom.com` (VKS
Supervisor sizing, VCFMS deployment guidance). No blog sources. Validate
against current VMware documentation before procurement.
