# VPC / Transit Gateway IP-Block Pools — Design Spec

**Date:** 2026-06-01
**Status:** Draft for review
**Author:** design pass (brainstorming skill)
**Workbook coverage track** — closes the VPC/TGW gap beyond WI-1 (Transit Gateway type, L53).

---

## 1. Goal

Stamp the VCF 9.1 **VPC / Transit Gateway IP-block pool** configuration into the
Planning & Preparation Workbook, with a model + UI that matches the real NSX VPC
data model. Covers three sub-areas (A/B/C below). One sentence: *let a designer
define the NSX External and Private-Transit-Gateway IP-block pools (name,
visibility, CIDRs, excluded IPs, reserved subnet) and the workload network-
connectivity mode, and round-trip them through JSON + the workbook.*

## 2. Background & research findings

VCF 9.x NSX VPC connectivity has **two distinct layers** (confirmed against
Broadcom docs and the VMware Cloud Foundation blog — see §11):

1. **IP-Block *definition* (NSX-level resource).** An *External IP Block* is a
   VCF-owned public range the Tier-0 advertises via BGP; a *Private (Transit
   Gateway) IP Block* is project-scoped and not advertised (in 9.1 the private
   TGW subnet must be /16). Each block has: a **name** (project-specific or
   generic), a **visibility** (exposed to one VPC/project or many), up to 10
   **CIDRs**, **excluded IPs**, and **reserved subnets**.
2. **Consumption / reference (VPC Connectivity Profile).** A profile *points at*
   those blocks. This is what the Supervisor uses.

**Mapping to the workbook:**

- The **pool block** (Configure Mgmt `D194–D203`, Configure WLD `D137–D146`) is
  layer 1 — the IP-block *definition*, with all five sub-fields. **Not yet mapped.**
- The **Supervisor block's** flat `External IP Blocks` / `Private TGW IP Blocks`
  (Configure Mgmt `D265/D266`, WLD `D211/D212`) are layer 2 — the profile's
  reference. **Already mapped** to `cluster.supervisorConfig.{externalIpBlocks,
  privateTgwIpBlocks, vpcConnectivityProfile, privateVpcCidrs}` (engine.js:1453–1498,
  cell-map at engine.js:8590–8639). Shipped + round-trip-tested. **Out of scope here.**

### Decision: independent structured model (evidence-backed)

The pool block and the supervisor flat fields are **different layers, not
duplicates**. The supervisor reference points at a pool *by name/profile*; it does
not own the CIDRs, and it has none of the pool's structure (visibility, excluded,
reserved). Therefore:

- Add a **new structured model** (`cluster.vpcConfig`), **separate** from the
  shipped supervisor flat fields. **No refactor** of `supervisorConfig`.
- This is both the architecturally-correct layering *and* the zero-risk choice
  for the shipped/tested supervisor round-trip.

## 3. The three sub-areas

| # | Sub-area | Cells | Versions |
|---|----------|-------|----------|
| **A** | Workload **network-connectivity mode** dropdown | Deploy WLD `D185`(9.0)/`D196`(9.1) | dual |
| **B** | **Structured IP-block pools** (External + Private TGW), 5 sub-fields each | Configure Mgmt `D194–D203`, Configure WLD `D137–D146` | 9.1 (except `ipBlocks`, see C) |
| **C** | **Flat `ipBlocks` 9.0 home** for the two pools | Configure Mgmt `D188/D189`, Configure WLD `D131/D132` | 9.0 |

A is the workload parallel to WI-1's mgmt-side `fleet.transitGatewayType` (L53).
B is the structured pool definition. C is the 9.0 home for B's `ipBlocks` field
(9.0 had only the flat CIDR cell, none of the name/visibility/excluded/reserved
structure), so `ipBlocks` is **dual-version** and the other four sub-fields are
**9.1-only**.

## 4. Model design

New object on the domain's components cluster (same home + lifecycle as
`supervisorConfig`; present on both mgmt and workload clusters):

```js
// engine.js — factory
function createClusterVpcConfig() {
  return {
    networkConnectivity: "Centralized Connectivity", // sub-area A (workload); enum
    externalPool: createVpcIpBlockPool(),            // sub-area B
    tgwPool: createVpcIpBlockPool(),                 // sub-area B
  };
}
function createVpcIpBlockPool() {
  return {
    poolName: "",       // 9.1 only
    visibility: "",     // 9.1 only — FREE STRING (workbook cell has no data-validation)
    ipBlocks: "",       // dual-version (9.0 flat + 9.1 in-pool) — CIDR list, comma/newline sep
    excludedIps: "",    // 9.1 only
    reservedSubnet: "", // 9.1 only ("Reserved for Specific Subnet")
  };
}
```

- **`networkConnectivity`** is an enum: `["Centralized Connectivity","Distributed
  Connectivity"]`. Default `"Centralized Connectivity"` (matches the L53 mgmt
  default and the workbook default). It is **workload-only** in the workbook
  (Deploy WLD); the mgmt side already has `fleet.transitGatewayType` (L53). We
  still store it on `vpcConfig` for both cluster types but only stamp it on the
  workload sheet.
- **`visibility`** is a **free string** (verified: the workbook cells `D195/D200/
  D138/D143` have *no* data-validation). Do **not** model it as a dropdown.

### Placement, factory, migrate

- Created in `newMgmtCluster()` / `newWorkloadCluster()` alongside
  `supervisorConfig` (engine.js:~10475): `vpcConfig: createClusterVpcConfig()`.
- `migrateFleet` whitelist-merge: mirror the `supervisorConfig` block at
  engine.js:11703–11719 — spread factory, overwrite known keys from existing,
  recurse one level into `externalPool` / `tgwPool` (like `deployment`), so
  hand-edited JSON survives and new keys backfill. Unknown keys dropped.

## 5. Cell-map design

A new builder `_vpcPoolBlockEntries({ scope, sheet, poolKey, cells })` mirroring
`_supervisorConfigureBlockEntries` (engine.js:4316) and using the same `E()` /
`expandCell()` helpers, plus a small set of entries for sub-area A. Resolve/apply
target `_getVpcConfig(ctx)` / `_ensureVpcConfig(ctx)` (new helpers mirroring
`_get/_ensureSupervisorConfig`). `expandCell("D194") → 9.1-only`;
`expandCell({v90,v91}) → dual-version` (engine.js:4332–4340).

### Exact cells (verified against pristine fixtures 2026-06-01)

**Sub-area A — `networkConnectivity` (workload-cluster, Deploy Workload Domain):**

| field | 9.0 | 9.1 | dataValidation |
|-------|-----|-----|----------------|
| networkConnectivity | D185 | D196 | `["Centralized Connectivity","Distributed Connectivity"]` |

**Sub-area B+C — pools (5 fields × 2 pools × 2 sheets):**

*Configure Management Domain (scope `mgmt-cluster`):*

| pool / field | poolName | visibility | ipBlocks | excludedIps | reservedSubnet |
|---|---|---|---|---|---|
| externalPool | D194 (9.1) | D195 (9.1) | **{v90:D188, v91:D196}** | D197 (9.1) | D198 (9.1) |
| tgwPool | D199 (9.1) | D200 (9.1) | **{v90:D189, v91:D201}** | D202 (9.1) | D203 (9.1) |

*Configure Workload Domain (scope `workload-cluster`):*

| pool / field | poolName | visibility | ipBlocks | excludedIps | reservedSubnet |
|---|---|---|---|---|---|
| externalPool | D137 (9.1) | D138 (9.1) | **{v90:D131, v91:D139}** | D140 (9.1) | D141 (9.1) |
| tgwPool | D142 (9.1) | D143 (9.1) | **{v90:D132, v91:D144}** | D145 (9.1) | D146 (9.1) |

Only `ipBlocks` is dual-version; the other four sub-fields per pool are 9.1-only.

**verifyLabel** values (case-insensitive substring match): poolName→"Pool Name",
visibility→"Visability" (sic — the workbook misspells it; match the fixture text),
ipBlocks→"VPC External IP Blocks"/"Private - Transit Gateway IP Blocks" (per pool),
excludedIps→"Excluded Ips", reservedSubnet→"Reserved for Specific Subnet".

### Collision check
Configure Mgmt `D196` is `externalPool.ipBlocks` on **9.1**, and Deploy WLD `D196`
is `networkConnectivity` on **9.1** — different *sheets*, so no collision. The
9.0 `ipBlocks` cells (`D188/D189` Configure Mgmt) do **not** collide with the
9.1-only `excludedIps`/etc. because they resolve to different addresses per
version. verify-cell-map's per-version resolution will confirm; **manually
re-check** that no two entries resolve to the same (sheet, resolved-cell, version).

## 6. Out of scope (documented, deferred)

- **Deploy WLD deploy-time singular cells** `D188 "External IP Block"` / `D189
  "Private - Transit Gateway IP Block"` (9.0) + `D186/D187` VLAN/Gateway: these
  are a deploy-time echo of the pool `ipBlocks`. Mapping them = duplicate stamps
  from the same field; deferred until we confirm they're not independent.
- **Configure WLD stray echo** `D171/D172` ("VPC External IP Blocks" / "Private -
  Transit Gateway IP Blocks", 9.1): a second occurrence below the supervisor-node
  block. Deferred — same reason. Both are noted so coverage isn't silently
  assumed complete.

## 7. UI design

New panel mirroring `SupervisorConfigPanel` (vcf-design-studio-v9.jsx:2637+,
`{ cluster, update, isMgmtCluster }`, `updateField` spread-merge). Renders:

- **Network Connectivity** `<select>` — workload clusters only (mgmt uses the
  existing fleet-header Transit Gateway type, L53). Values = the A enum.
- **Two pool cards** (External IP Block, Private Transit Gateway IP Block), each
  with Pool Name / Visibility / IP Blocks / Excluded IPs / Reserved-for-Subnet
  text inputs. The four 9.1-only fields render always but carry a tooltip noting
  9.1-only stamping; `ipBlocks` is the always-relevant field.

Placed adjacent to the Supervisor panel in the cluster editor. Satisfies the
"every exported field has a UI editor path" rule for all newly-mapped cells.

## 8. M2.1 round-trip matrix

Per tests/unit/round-trip-matrix.test.js conventions:

- Add the nested paths to the CSV matrices for both versions, e.g.
  `instances.0.domains.0.clusters.0.vpcConfig.externalPool.ipBlocks`,
  `…vpcConfig.externalPool.poolName`, `…tgwPool.reservedSubnet`,
  `…vpcConfig.networkConnectivity`. Mirror how
  `…supervisorConfig.externalIpBlocks` appears today.
- **enumOverrides:** `networkConnectivity` → a valid member ("Distributed
  Connectivity"), so the sentinel walk doesn't stamp garbage that gets coerced.
- **9.1-only fields** (poolName/visibility/excludedIps/reservedSubnet): add to the
  9.0-only KNOWN_CSV_GAPS allowlist (no 9.0 cell), exactly like the supervisor
  9.1-only fields.
- **Additional-cluster scope:** vpcConfig has no cell on additional clusters
  (block is mgmt+WLD only) → allowlist `instances.0.domains.*.clusters.1+.vpcConfig.*`
  mirroring the existing supervisorConfig additional-cluster allowlist.

## 9. Testing strategy (TDD)

1. **Engine round-trip unit test** (`tests/unit/vpc-ip-block-pools.test.js`):
   build a cluster with a populated `vpcConfig`, find cell-map entries by label,
   assert resolve→cell and apply→model for each field on both 9.0 (ipBlocks +
   networkConnectivity only) and 9.1 (all fields).
2. **Model/migrate test:** `migrateFleet` backfills `vpcConfig` on legacy fleets;
   hand-set pool values survive a round-trip; unknown keys dropped.
3. **M2.1 matrix:** green on 9.0 + 9.1 (meta-guard: leaves accounted for).
4. **verify-cell-map** clean; **build-html**; **full gate**; snapshots updated if
   factory output changed (it will — new `vpcConfig` on every cluster → expect
   factory-snapshot churn; verify the diff is only `vpcConfig`).
5. **Coverage** stays above gate.

## 10. Phasing

One PR is feasible but sizeable (model + factory + migrate + builder invoked 4×
(2 sheets × 2 pools) + the A connectivity entry + UI + matrix + snapshots).
Recommended split:

- **PR-1 (sub-area A):** `vpcConfig.networkConnectivity` + dropdown cell (Deploy
  WLD, dual-version) + UI select + matrix. Small, completes the WI-1 parallel.
- **PR-2 (sub-areas B+C):** the structured pools (model + `_vpcPoolBlockEntries`
  + Configure Mgmt/WLD entries + 9.0 `ipBlocks` dual-version + UI pool cards +
  matrix + snapshots).

Both follow the established TDD → gate → PR → auto-merge cadence.

## 11. Risks & open items

- **R1 — model churn / snapshots.** Adding `vpcConfig` to every cluster changes
  factory output → 23 factory snapshots rebaseline. Mitigation: regenerate with
  `--update`, diff to confirm only `vpcConfig` changed (same discipline as WI-3).
- **R2 — `ipBlocks` dual-version correctness.** The single field stamps a 9.0 cell
  and a 9.1 cell at different addresses; `cellByVersion` must be exact and
  verify-cell-map per-version resolution must stay collision-free. Mitigation:
  the engine round-trip test exercises both versions explicitly.
- **R3 — deferred cells (§6).** Coverage of VPC/TGW is *not* 100% after this —
  the deploy-time echo + stray D171/172 remain. Explicitly logged, not silent.
- **R4 — `visibility` semantics.** Modeled as free string per the fixture (no
  data-validation). If a later workbook revision adds a dropdown, revisit.

## Sources

- [Broadcom — Add a VPC Connectivity Profile](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/virtual-private-cloud-in-nsx/add-a-vpc-connectivity-profile.html)
- [Broadcom — Virtual Private Cloud in NSX](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/virtual-private-cloud-in-nsx.html)
- [VMware Cloud Foundation blog — VMware Virtual Private Cloud in VCF 9.0](https://blogs.vmware.com/cloud-foundation/2025/07/02/vmware-virtual-private-cloud/)
- [VMware Cloud Foundation blog — Transit Gateway Connectivity Options in VCF 9.1](https://blogs.vmware.com/cloud-foundation/2026/05/12/transit-gateway-connectivity-options-in-vcf-9-1/)
- [evoila — VCF 9 NSX VPC Part 1, centralized Transit Gateway](https://evoila.com/us/blog/vcf-9-nsx-vpc-part-1-centralized-transit-gateway/)
- [sdn-warrior — VCF 9 NSX VPC Part 2, distributed Transit Gateway](https://sdn-warrior.org/posts/vcf9-nsx-vpc-part2/)
