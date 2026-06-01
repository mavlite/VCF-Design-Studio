# NSX Edge Per-Cluster IP Assignment / Allocation + Overlay Pool — Design Spec

**Date:** 2026-06-01
**Status:** Draft for review
**Workbook coverage track** — extends the Theme 4 / M1.3 NSX Edge node config.

---

## 1. Goal

Stamp the NSX Edge **IP-assignment / IP-allocation mode** and **edge-overlay IP-pool**
configuration into the workbook (Configure Mgmt + Configure WLD edge-node blocks).
One sentence: *let a designer choose how the edge cluster's management and TEP
IPs are assigned (address type, DHCP vs Static vs IP-Pool) and define the edge
overlay IP pool, and round-trip it through JSON + the workbook.*

## 2. Background & the key modeling decision

The edge config lives in per-edge-node blocks on each Configure sheet (Node 1,
Node 2). Theme 4 + M1.3 already map the genuinely per-node fields: FQDN, mgmt IP
CIDR, host group, resource pool, fp-eth uplinks, TEP IPs, gateway-interface IPs
(`_edgeClusterEntries`, engine.js ~5049; `createEdgeNode`, engine.js:1214).

The **open** cells are the IP-assignment / allocation **modes** and the overlay
**pool**. Critically, in the pristine workbook the **Node-2 copies of these cells
are formula-propagated from Node 1** (their `dataValidation` is `null` — verified;
matches the engine.js:1208-1213 note that the cell-map skips Node-2 formula
cells). That tells us these are **edge-cluster-level settings shared across all
edge nodes**, not per-node — you don't run Node 1 on DHCP and Node 2 on Static
within one cluster.

### Decision: model at the edge-CLUSTER level

Add the new fields to `createEdgeCluster()` (one value per cluster), and map them
to the **Node-1 input cells only** — exactly mirroring how the existing builder
treats Node-2 formula cells (skipped). This is simpler, matches the workbook's
propagation semantics, and avoids fictitious per-node allocation state.

## 3. Model

```js
// engine.js — extend createEdgeCluster() (engine.js:1233)
function createEdgeCluster() {
  return {
    name: "", mtu: MTU_TEP_RECOMMENDED, tepVlan: null,
    nodes: [createEdgeNode(), createEdgeNode()],
    // NEW — cluster-level IP assignment / allocation modes + overlay pool:
    hostGroupAffinity: "No",            // "Yes" | "No"
    mgmtIpAssignment: "IPv4 Only",      // "IPv4 Only" | "IPv6 Only" | "IPv4 & IPv6"   (9.1-only cell)
    mgmtIpAllocation: "DHCP",           // "DHCP" | "Static"
    useClusterHostOverlay: "Unselected",// "Selected" | "Unselected"
    tepIpAddressType: "IPv4",           // "IPv4" | "IPv6"                              (9.1-only cell)
    tepIpAllocation: "DHCP",            // "Static IP List" | "DHCP" | "IP Pool"        (3-value)
    ipPoolName: "",                     // edge-overlay IP pool name
    overlayPoolStart: "",               // Edge Overlay Pool: Start IP
    overlayPoolEnd: "",                 // Edge Overlay Pool: End IP
  };
}
```

- **`tepIpAllocation` is a genuine 3-value enum** — the existing boolean
  `hostTep.useDhcp` cannot represent it, which is why a new field is required.
- `mgmtIpAssignment` and `tepIpAddressType` cells **exist only in 9.1** (the 9.1
  workbook inserted them); model fields are always present, stamped 9.1-only.
- **migrate:** extend the existing `edgeCluster` backfill in `migrateFleet` to
  whitelist-merge the new flat fields against the factory (idempotent; unknown
  keys dropped) — same pattern as `supervisorConfig`/`vpcConfig`.

## 4. Cell-map (VERIFIED against pristine 9.0/9.1 fixtures, 2026-06-01)

All map to the **Node-1** input cell; all `scope` = `mgmt-cluster` (Configure
Management Domain) or `workload-cluster` (Configure Workload Domain). Cells
confirmed **open** (not already mapped). The 9.1 sheet inserts two rows above the
TEP block, so TEP-area cells shift +1/+2 vs 9.0.

### Configure Management Domain (`mgmt-cluster`)

| Field | 9.0 | 9.1 | dataValidation | verifyLabel |
|-------|-----|-----|----------------|-------------|
| hostGroupAffinity | D102 | D102 | `["Yes","No"]` | Host Group Affinity |
| mgmtIpAssignment | — | D105 | `["IPv4 Only","IPv6 Only","IPv4 & IPv6"]` | IP Assignment |
| mgmtIpAllocation | D105 | D106 | `["DHCP","Static"]` | IP Allocation |
| useClusterHostOverlay | D109 | D110 | `["Selected","Unselected"]` | Use the host overlay |
| tepIpAddressType | — | D117 | `["IPv4","IPv6"]` | TEP IP Address Type |
| tepIpAllocation | D116 | D118 | `["Static IP List","DHCP","IP Pool"]` | IP Allocation (TEP) |
| ipPoolName | D117 | D119 | — | IP Pool |
| overlayPoolStart | D118 | D120 | — | Edge Overlay Pool: Start IP |
| overlayPoolEnd | D119 | D121 | — | Edge Overlay Pool: End IP |

### Configure Workload Domain (`workload-cluster`)

| Field | 9.0 | 9.1 | dataValidation | verifyLabel |
|-------|-----|-----|----------------|-------------|
| hostGroupAffinity | D45 | D45 | `["Yes","No"]` | Host Group Affinity |
| mgmtIpAssignment | — | D48 | `["IPv4 Only","IPv6 Only","IPv4 & IPv6"]` | IP Assignment |
| mgmtIpAllocation | D48 | D49 | `["DHCP","Static"]` | IP Allocation |
| useClusterHostOverlay | D52 | D53 | `["Selected","Unselected"]` | Use the host overlay |
| tepIpAddressType | — | D60 | `["IPv4","IPv6"]` | TEP IP Address Type |
| tepIpAllocation | D59 | D61 | `["DHCP","IP Pool","Static IP List"]` | IP Allocation (TEP) |
| ipPoolName | D60 | D62 | — | IP Pool |
| overlayPoolStart | D61 | D63 | — | Edge Overlay Pool: Start IP |
| overlayPoolEnd | D62 | D64 | — | Edge Overlay Pool: End IP |

**Note — TEP allocation DV order differs by sheet** (Mgmt `["Static IP List",
"DHCP","IP Pool"]` vs WLD `["DHCP","IP Pool","Static IP List"]`). The `dataValidation`
is set per-sheet; the model stores one of the three strings, so resolve/apply is
order-independent. `hostGroupAffinity` is at the same cell in both versions (it
sits above the 9.1-inserted rows).

### Builder
Extend (or add a sibling to) `_edgeClusterEntries`: these are **cluster-level**
(one entry per field, Node-1 cell), so they don't need the per-node loop —
emit them once per (sheet, scope) with `cell:{v90,v91}` (dual-version) or
`cell:<9.1>, workbookVersions:["9.1"]` for the two 9.1-only fields. resolve/apply
target `_getEdgeCluster(ctx)` / `_ensureEdgeCluster(ctx)` (existing helpers,
engine.js ~3777). Enum apply coerces to a valid member (default as in §3).

## 5. UI

Extend `EdgeClusterPanel` (vcf-design-studio-v9.jsx) with a cluster-level
"IP Assignment & Allocation" sub-block: selects for hostGroupAffinity,
mgmtIpAssignment (9.1 note), mgmtIpAllocation, useClusterHostOverlay,
tepIpAddressType (9.1 note), tepIpAllocation, and text inputs for ipPoolName +
overlay pool start/end. Writes via the existing edge `update` callback. Satisfies
the every-exported-field-has-a-UI-path rule.

## 6. M2.1 round-trip matrix

- Add `…edgeCluster.{hostGroupAffinity,mgmtIpAllocation,useClusterHostOverlay,
  tepIpAllocation,ipPoolName,overlayPoolStart,overlayPoolEnd}` to both CSV
  matrices (mgmt + WLD clusters; these have dual-version cells).
- Add `…edgeCluster.{mgmtIpAssignment,tepIpAddressType}` to CSV_MATRIX_91 only +
  `NON_WORKBOOK_ALLOWLIST_90_ONLY` (9.1-only cells).
- **enumOverrides:** all six enum fields need a valid-member override
  (e.g. tepIpAllocation→"IP Pool", mgmtIpAllocation→"Static", hostGroupAffinity→
  "Yes", useClusterHostOverlay→"Selected", mgmtIpAssignment→"IPv4 & IPv6",
  tepIpAddressType→"IPv6").
- Additional cluster (clusters.1) has no edge block in some scopes → allowlist
  per the existing edge-cluster matrix treatment (mirror how Theme 4 edge fields
  are handled for the additional cluster).

## 7. Phasing

- **PR-1 — allocation/assignment dropdowns** (6 enum fields): hostGroupAffinity,
  mgmtIpAssignment, mgmtIpAllocation, useClusterHostOverlay, tepIpAddressType,
  tepIpAllocation. Model + cell-map + UI selects + matrix + snapshots.
- **PR-2 — edge overlay pool** (3 text fields): ipPoolName, overlayPoolStart,
  overlayPoolEnd. Model + cell-map + UI inputs + matrix.

## 8. Out of scope (deferred, documented)

The **static-IP-list** sub-cells that appear only when `tepIpAllocation =
"Static IP List"` — per-node "IPv4 Static List Edge TEP 1/2 IP" (the TEP IPs are
already modeled as `node.tepIps`), plus the static-list "CIDR" / "Static IPv4
Gateway" / "IPv4 Subnet Mask" cells, and the edge **Management Gateway** cell.
These are a smaller conditional sub-case; deferred to a follow-up once the core
allocation model lands. Coverage is therefore not 100% after PR-2.

## 9. Risks

- **R1 — snapshot churn.** New `edgeCluster` fields change factory output → the
  23 factory snapshots rebaseline. Mitigation: `--update` + diff to confirm only
  `edgeCluster.*` changed (same discipline as VPC/WI-3).
- **R2 — collision with existing edge entries.** The new cells were verified
  `open`, but implementation MUST re-check per-version resolved addresses against
  `_edgeClusterEntries`/`_gatewayInterfaceEntries` (verify-cell-map does not
  detect two-entries-same-cell). The TDD engine test asserts exact cells.
- **R3 — 9.1 row-shift correctness.** TEP-area cells shift +1/+2 in 9.1;
  `cellByVersion` must be exact (the §4 tables are verified).
- **R4 — additional-cluster matrix handling.** Mirror the existing edge-cluster
  allowlist treatment; confirm the meta-guard stays green on both versions.

## Sources
Verified against `test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json`
(2026-06-01). Edge architecture per Theme 4 (`docs/.../theme-04-*`) and the
existing `_edgeClusterEntries` builder.
