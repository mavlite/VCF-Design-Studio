# Environment Scan Import (Phase 1) — Design

**Date:** 2026-05-29
**Branch:** `feat/environment-scan-import`
**Status:** Phase 1 of a larger "scan an existing environment → recommend a VCF design" capability. This spec covers Phase 1 only; Phases 2–3 are summarized as roadmap.

## Context & vision

Consultants assessing a customer for VCF want to start from the customer's *actual* environment, not a blank fleet. The vision: the customer runs a read-only collector against their existing **standalone vSphere** (vCenter + ESXi + vSAN), uploads the resulting file to VCF Design Studio, and the studio (a) reconstructs their current state as a fleet, (b) seeds a recommended VCF 9 target design, and (c) produces a readiness/gap report — all consultant-refined in the existing editor, then exported as a workbook.

Key decisions from brainstorming:
- **Collection:** customer-run **read-only PowerCLI** script that emits a versioned JSON file. No backend, no inbound network access, no credential custody — the file is uploaded exactly like the existing workbook/JSON import. The whole pipeline stays **client-side in the browser**.
- **Source scope (first slice):** standalone vSphere → VCF (not existing-VCF→newer-VCF).
- **Automation level:** seed a design + readiness report, **consultant-refined** (human in the loop). Never fully automatic.

The studio already provides the "target design" half: design model, sizing (`sizeFleet`, `recommendVcenterSize`/`recommendNsxSize`), brownfield/converge pathways (`deploymentPathway`, `domain.imported`, `cluster.preExisting`), validation rules, and workbook export. This feature adds the **input** half.

## Phasing (roadmap)

- **Phase 0 — Collector contract + reference collector.** Define the collector-output JSON schema (the contract) and ship a minimal read-only PowerCLI collector that emits it. (The schema is defined in THIS spec because Phase 1 consumes it; the PowerCLI script is a companion deliverable that can harden in parallel — Phase 1 is testable from fixtures.)
- **Phase 1 — Ingest → current-state fleet + UI (THIS SPEC).** Parse + validate the scan JSON, map it into a current-state fleet (real host specs, workload totals, networks, brownfield/converge markers), and load it into the existing editor via a new "Import environment scan" upload. **Outcome:** a scan becomes a pre-populated studio design a consultant can immediately work and export.
- **Phase 2 (roadmap).** Auto-seed a recommended VCF 9 *target* design from the current-state fleet (add a mgmt domain, map existing clusters as converge/brownfield workload domains, size the VCF management overhead, recommend appliance sizes).
- **Phase 3 (roadmap).** Readiness/gap report — coarse hardware-fit + "what's missing for VCF 9" checks driven by the sizing engine and a curated rule set.

## Phase 1 goal

A consultant can take a customer's vSphere scan JSON, import it into the studio, and see an accurate current-state fleet (hosts, clusters, storage, workloads, networking) loaded in the editor — ready to refine and export. No design *recommendation* yet (that's Phase 2); this proves the collection→ingest→model pipeline end-to-end with real data.

## Non-goals (Phase 1)

- No target-design recommendation or readiness scoring (Phase 2/3).
- No existing-VCF (SDDC Manager) source — standalone vSphere only.
- No live API connection / backend — file upload only, client-side.
- No full Broadcom HCL / hardware-compatibility lookup.
- Not a lossless inventory: the studio models a VCF-shaped design, not every vSphere object. We capture what drives a VCF design (capacity, topology, networking), not e.g. per-VM snapshots or DRS rules.

## Architecture

Client-side, mirroring the existing import path:

```
[customer] PowerCLI collector (read-only)  ──emits──>  scan.json (versioned)
                                                          │ (consultant uploads)
[browser] file input ──> importEnvironmentScan(scanJson) ──> current-state fleet
                                              │
                                              └─> migrateFleet(fleet) ──> editor loads it
```

- **`engine.js`** gains `importEnvironmentScan(scan)` (pure function: scan object → fleet) plus a small `SCAN_SCHEMA_VERSION` constant and validation. No engine behavioral change to existing paths.
- **`vcf-design-studio-v9.jsx`** gains an "Import environment scan" control (hidden file input + button, like the existing workbook import) that parses the JSON, calls `importEnvironmentScan`, runs it through `migrateFleet`, sets fleet state, and shows an import summary (counts + any warnings).
- **HTML** is regenerated via `npm run build-html` (engine + jsx change).

### Why a new function rather than extending `importWorkbookCellMap`
The workbook importer maps cell addresses → fields; a scan is a structured inventory with different shape and richer hardware data. A separate, focused `importEnvironmentScan` keeps each importer single-purpose. Both ultimately produce a fleet and hand off to `migrateFleet`.

## The collector-output JSON schema (v1) — the contract

A single JSON object. `schemaVersion` gates compatibility; the studio rejects unknown major versions with a clear message.

```jsonc
{
  "schemaVersion": "1.0",
  "collector": { "tool": "vcf-ds-collector", "version": "1.0.0", "collectedAt": "<ISO8601>" },
  "vcenter": {
    "version": "8.0.2",            // vCenter version
    "build": "22385739",
    "fqdn": "vc01.corp.local"
  },
  "datacenters": [
    {
      "name": "DC1",
      "clusters": [
        {
          "name": "Cluster-Prod",
          "drsEnabled": true,
          "haEnabled": true,
          "vsanEnabled": true,
          "vsanType": "ESA",        // "ESA" | "OSA" | null (non-vSAN)
          "hosts": [
            {
              "name": "esx01.corp.local",
              "version": "8.0.2",   // ESXi version
              "build": "22380479",
              "cpuSockets": 2,
              "coresPerSocket": 16,
              "hyperthreading": true,
              "cpuModel": "Intel(R) Xeon(R) Gold 6326",
              "ramGB": 1024,
              "nics": [ { "name": "vmnic0", "speedMbps": 25000 } ],
              "storageDevices": [    // physical disks/devices backing vSAN or local
                { "type": "NVMe", "capacityGB": 7680, "count": 6 }
              ]
            }
          ],
          "datastores": [
            { "name": "vsanDatastore", "type": "vsan", "capacityGB": 92160, "freeGB": 40000 }
          ],
          "vmCount": 180,
          "vmTotals": { "vcpu": 720, "ramGB": 5760, "provisionedDiskGB": 86000, "usedDiskGB": 52000 }
        }
      ]
    }
  ],
  "networking": {
    "vdSwitches": [
      { "name": "vds-prod", "mtu": 9000, "uplinks": ["vmnic0","vmnic1"],
        "portgroups": [ { "name": "PG-Mgmt", "vlan": 100 }, { "name": "PG-vMotion", "vlan": 101 } ] }
    ]
  }
}
```

Notes:
- Sizes are explicit units in field names (`GB`, `Mbps`) to avoid ambiguity.
- `storageDevices` aggregates by type+capacity with a `count` (collector rolls up identical devices).
- `vmTotals` are cluster-level aggregates; per-VM detail is intentionally omitted (privacy + size; we only need capacity drivers).
- Fields the studio can't yet use (e.g. `drsEnabled`) are carried for forward use / Phase 3 and ignored by Phase 1 ingest.

## The PowerCLI collector (Phase 0 companion)

A single read-only `.ps1` the customer runs after `Connect-VIServer`. Requirements:
- **Read-only:** only `Get-*` cmdlets; no writes. Document the minimum vCenter read-only role.
- Emits exactly the schema above to `vcf-scan-<vcenter>-<date>.json`.
- Self-contained, no modules beyond VMware PowerCLI; prints a one-line summary (N hosts, N clusters).
- Handles partial permissions gracefully (a field it can't read → `null`, never a crash).

Phase 1 does not block on the collector's hardening: ingest is developed and tested against **committed fixture JSON** (see Testing). The reference collector is delivered alongside but its field-by-field robustness across vSphere versions is ongoing.

## Ingest: `importEnvironmentScan(scan)` → fleet

Pure function in `engine.js`. Validates, then maps:

**Validation**
- Reject if `scan.schemaVersion` major ≠ supported (`SCAN_SCHEMA_VERSION`), with a message naming the found vs expected version.
- Tolerate missing optional fields; collect human-readable `warnings[]` (e.g. "host esx03 reported no storage devices — host storage left at default").
- Return `{ fleet, warnings, summary }` where `summary` = counts (datacenters, clusters, hosts, VMs).

**Mapping (collector → fleet model)**

| Collector | Fleet model | Heuristic |
|---|---|---|
| top-level | `newFleet()` base; `deploymentPathway = "converge"`; `vcfVersion` = studio default (target) | converge = bring existing infra under VCF |
| `vcenter.version`/`build` | recorded on fleet metadata (informational; not a model field today → add `fleet.sourceEnvironment = { vcenterVersion, collectedAt, ... }`) | provenance for Phase 2/3 |
| each `datacenter` | a site (`newSite`) on the initial instance | 1 datacenter → 1 site; domains derived from that datacenter's clusters get `localSiteId` = this site |
| all `cluster`s | every cluster is converge/`preExisting = true` | existing clusters are converge candidates |
| **cluster roles** | each cluster's role comes from `opts.roleAssignments[clusterName]` when the UI supplies it (the Review-table selections): **management** → seeds the single `newMgmtDomain`; **workload** → `newWorkloadCluster` in a workload domain marked `imported = true`; **skip** → omitted. When `opts.roleAssignments` is absent (headless/tests), `_pickMgmtCandidate` picks management (name matches `/mgmt|management/i`, else fewest hosts) and all others default to workload. | the consultant drives topology in the Review step; the heuristic is only the pre-selected default. Exactly one management cluster is required (validated; surfaced as a warning/error if zero or many) |
| grouping clusters → domains | clusters in the same datacenter that aren't the mgmt cluster are grouped into one workload domain per datacenter (`newWorkloadDomain`), pinned to that datacenter's site | keeps the v1 mapping simple + site-correct; consultant can split/merge domains in the editor |
| `cluster.hosts[]` | `cluster.host` spec (the studio models a representative host per cluster) from the **modal/most-common** host: `cpuQty←cpuSockets`, `coresPerCpu←coresPerSocket`, `hyperthreadingEnabled←hyperthreading`, `ramGb←ramGB`, `nvmeQty/nvmeSizeTb←storageDevices` (NVMe rollup); `cpuOversub/ramOversub/reservePct` keep studio defaults (planning assumptions, not collected) | host count → `cluster.hostOverride` = number of hosts so sizing preserves the real count; mixed hardware → use modal host + a warning |
| `cluster.vmCount` / `vmTotals` | `cluster.workload = { vmCount, vcpuPerVm: round(vcpu/vmCount), ramPerVm: round(ramGB/vmCount), diskPerVm: round(provisionedDiskGB/vmCount) }` | averages drive the studio's workload sizing |
| `cluster.vsanType` | `cluster.storage` principal = vSAN; ESA/OSA noted | non-vSAN datastores → warning (VCF assumes vSAN by default) |
| `networking.vdSwitches`/`portgroups`/`vlan` | `cluster.networks.vds[]` + portgroup/VLAN hints where mappable | best-effort; unmapped networking → warning, consultant completes in editor |

After building, run the fleet through `migrateFleet` (same as other imports) so every factory default/whitelist is normalized, then return it.

**Signature.** `importEnvironmentScan(scan, opts = {})` where `opts.roleAssignments` is an optional `{ clusterName → "management" | "workload" | "skip" }` map (supplied by the Review-step table). Returns `{ fleet, warnings, summary }`.

**Single-purpose decomposition.** `importEnvironmentScan` orchestrates small private helpers, each independently testable: `_validateScan`, `_resolveClusterRoles` (apply `opts.roleAssignments` or fall back to `_pickMgmtCandidate`), `_mapHostToSpec`, `_mapClusterWorkload`, `_mapNetworking`. Each has one clear job and is unit-tested directly.

## Error handling

- Bad/empty JSON or wrong schema major → throw a clear `Error` the UI catches and shows (no silent failure).
- Partial data → never throw; degrade to defaults + a `warnings[]` entry naming the field and the fallback.
- The produced fleet must pass `sizeFleet` without throwing (a coherence guard; asserted in tests).

## UI (`vcf-design-studio-v9.jsx`) — guided wizard

**Trigger.** A new header button `Import Environment Scan` in the existing top-bar import-button row (same `text-[10px] uppercase tracking-wider font-mono` style as `Import JSON`/`Import Workbook`, with an indigo hover accent). It opens a **modal wizard** styled like the existing Compare Fleet modal (`fixed inset-0 bg-black/40`, white `rounded-lg shadow-xl`, serif title, mono section labels). Validated visually in brainstorming (design direction "C · guided wizard", review layout "cluster role table").

**Four steps** (a step rail across the top: `1 Collector · 2 Upload · 3 Review · 4 Load`):

1. **Collector** — instructions + the read-only PowerCLI snippet in a copy box + a "Download script" action + a "no data leaves your browser" reassurance. (Static; the script ships as a repo asset the button serves.)
2. **Upload** — drag/drop or choose `scan.json`. On select, parse JSON and run `_validateScan`; show schema-version / parse errors inline here (can't advance until a valid scan is loaded).
3. **Review & map** — the heart of the wizard. A **cluster-role table**: one row per discovered cluster (columns: Cluster, Site, Hosts, VMs, Storage) with a per-row **VCF role** selector — **Management / Workload / Skip**. Exactly one cluster must be Management (the `_pickMgmtCandidate` heuristic pre-selects a suggested default; the consultant can re-assign). Above the table: a parsed-summary pill row (vCenter version, DC/cluster/host/VM counts). Below: a **Warnings** list (mixed-hardware, non-vSAN, etc.) the consultant treats as a checklist. The role assignments + mgmt pick are passed into ingest so the consultant *drives* the topology mapping rather than relying purely on the heuristic.
4. **Load** — final confirm; **replaces** the current fleet (greenfield, matching the workbook-import convention) after a brief "this replaces your current design" confirmation, then closes the wizard and shows the editor with the imported fleet.

**State & wiring.** Wizard state (current step, parsed scan, role assignments) is local component state. On "Load", call `importEnvironmentScan(scan, { roleAssignments })` → `migrateFleet` → set fleet via the history hook (so it's undoable) → switch to the editor view.

**Conventions.** No internal jargon in rendered strings (no `Plan-N`/cell addresses). Errors surface in-wizard, never console-only. Reuses existing modal/pill/label styling — no new design system.

**Ingest takes role assignments.** Because the Review table lets the consultant assign roles, `importEnvironmentScan(scan, opts)` accepts an optional `opts.roleAssignments` (`clusterName → "management" | "workload" | "skip"`). When omitted (e.g. programmatic/tests), it falls back to the `_pickMgmtCandidate` heuristic + "all others workload." This keeps the engine function usable headless while letting the UI override.

## Testing

- **Fixtures:** commit representative scan JSONs under `test-fixtures/scan/` — at minimum: `minimal-3host.json` (one vSAN cluster), `multi-cluster.json` (mgmt-candidate + workload clusters, mixed hardware), `edge-cases.json` (missing fields, non-vSAN datastore, empty networking).
- **Unit tests** (`tests/unit/environment-scan-import.test.js`, node env):
  - schema-version rejection (wrong major throws; right major passes).
  - each helper (`_resolveClusterRoles`, `_mapHostToSpec`, `_mapClusterWorkload`, `_pickMgmtCandidate`, `_mapNetworking`) with direct inputs.
  - role handling: with `opts.roleAssignments` (management/workload/skip honored) AND without it (heuristic fallback); zero-or-many management clusters surfaces the expected warning/error.
  - end-to-end: each fixture → `importEnvironmentScan` → assert fleet shape (site/domain/cluster counts, a host spec, a workload, `deploymentPathway === "converge"`, `preExisting`/`imported` markers) and that `warnings` fire where expected.
  - coherence: `sizeFleet(fleet)` does not throw for every fixture.
- **Component test** (jsdom, M2.2 RTL stack): the wizard opens from the header button, advances Upload→Review on a valid fixture, the role table renders one row per cluster, and "Load" loads the fleet into the editor.
- TDD throughout (test-first per the project's workflow).

## Risks

- **Topology variability** — real environments rarely map cleanly to VCF domains. Mitigated by: converge/brownfield markers, the mgmt-candidate heuristic + warning, and consultant-in-the-loop refinement. The mapping table above is the v1 heuristic and will iterate against real scans.
- **Mixed hardware per cluster** — the studio models one representative host per cluster. We use the modal host and warn; the consultant adjusts. (A future enhancement could split a mixed cluster.)
- **Collector maintenance** — vSphere API/cmdlet drift across versions. The versioned schema isolates the studio from collector changes; the collector is the moving part.
- **Scope creep into Phase 2** — it will be tempting to "just also seed the target." Hold the line: Phase 1 reconstructs current state only.

## Roadmap detail (out of scope here)

- **Phase 2 — recommend target design:** from the converge fleet, add a mgmt domain sized for VCF 9 overhead, set `vcfVersion` target, recommend vCenter/NSX appliance sizes via existing helpers, flip appropriate clusters to VCF-managed. Output: a second "recommended" fleet the consultant compares against current state (the existing Compare modal could diff them).
- **Phase 3 — readiness/gap report:** coarse rules (CPU generation adequacy, RAM/storage headroom for added VCF overhead, vSAN-ESA eligibility, NSX present?) surfaced as a structured report, reusing the validation-panel pattern.
