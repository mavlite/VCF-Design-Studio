# VPC / Transit Gateway IP-Block Pools — Implementation Plan

> **For agentic workers:** implement task-by-task; steps use `- [ ]`.

**Goal:** stamp the VCF 9.1 VPC/TGW IP-block pool config + workload network-
connectivity mode into the workbook, with a structured `cluster.vpcConfig` model.

**Spec:** `docs/superpowers/specs/2026-06-01-vpc-tgw-ip-block-pools-design.md`

**Architecture:** new `cluster.vpcConfig` (independent of `supervisorConfig`),
mirroring the supervisorConfig factory + migrate whitelist + cell-map builder +
UI panel patterns. Two PRs.

**Tech:** engine.js (model/cell-map), vcf-design-studio-v9.jsx (UI),
vitest (TDD), M2.1 round-trip matrix, snapshot rebaseline.

---

## PR-1 — Sub-area A: workload network-connectivity mode

**Files:** `engine.js`, `vcf-design-studio-v9.jsx`, `tests/unit/vpc-config.test.js`,
`tests/unit/round-trip-matrix.test.js`, `tests/unit/engine-smoke.test.js`,
`vcf-design-studio-v9.html`, factory snapshots.

- [ ] **Test first** — `tests/unit/vpc-config.test.js`: a workload cluster with
  `vpcConfig.networkConnectivity = "Distributed Connectivity"` resolves to Deploy
  WLD `D185` (9.0) / `D196` (9.1); apply parses back. `migrateFleet` backfills
  `vpcConfig` and preserves a set value. Run → RED.
- [ ] **Model** — `createClusterVpcConfig()` returning `{ networkConnectivity:
  "Centralized Connectivity" }`; add `vpcConfig: createClusterVpcConfig()` to
  `newMgmtCluster()` + `newWorkloadCluster()`. Export `createClusterVpcConfig`.
- [ ] **migrate** — whitelist-merge `vpcConfig` in `migrateFleet` (mirror
  supervisorConfig block at engine.js:~11703): spread factory, overwrite known keys.
- [ ] **Cell-map** — one entry: Deploy Workload Domain, scope `workload-cluster`,
  `cell: {v90:"D185", v91:"D196"}`, verifyLabel "Configure Network Connectivity",
  dataValidation `["Centralized Connectivity","Distributed Connectivity"]`,
  resolve/apply `_getVpcConfig/_ensureVpcConfig(ctx).networkConnectivity`. Add the
  `_getVpcConfig`/`_ensureVpcConfig` helpers (mirror supervisor helpers).
- [ ] **engine-smoke** — add `createClusterVpcConfig` to EXPECTED_SYMBOLS.
- [ ] **M2.1 matrix** — add `…clusters.*.vpcConfig.networkConnectivity` to CSV
  matrices (workload-cluster has the cell; mgmt + additional clusters → allowlist,
  since the dropdown is Deploy-WLD only). enumOverride → "Distributed Connectivity".
- [ ] Run targeted test → GREEN.
- [ ] **UI** — in the cluster editor, a Network Connectivity `<select>` (workload
  clusters only) writing `vpcConfig.networkConnectivity` via the cluster `update`.
- [ ] **build-html**, full `npm test`, `npm run coverage`, verify-cell-map.
- [ ] **Snapshots** — `vitest run tests/snapshot --update`; diff = only `vpcConfig`.
- [ ] Commit (no attribution), include the spec + this plan doc, PR, auto-merge.

## PR-2 — Sub-areas B+C: structured IP-block pools

**Files:** same set + the pool builder.

- [ ] **Test first** — extend `tests/unit/vpc-config.test.js`: populate
  `externalPool`/`tgwPool` (all 5 fields); assert each maps to the exact cell per
  §5 table on 9.1, and `ipBlocks` to the 9.0 flat cell; apply parses back; migrate
  preserves nested pool values. RED.
- [ ] **Model** — extend `createClusterVpcConfig()` with `externalPool` +
  `tgwPool` via `createVpcIpBlockPool()` (`{ poolName, visibility, ipBlocks,
  excludedIps, reservedSubnet }`, all ""). Export `createVpcIpBlockPool`. Extend
  migrate whitelist to recurse one level into the two pools (like `deployment`).
- [ ] **Cell-map builder** — `_vpcPoolBlockEntries({ scope, sheet, poolKey, cells })`
  mirroring `_supervisorConfigureBlockEntries`; emit 5 entries/pool (`ipBlocks`
  dual-version `{v90,v91}`, others 9.1-only). Invoke 4× (Configure Mgmt external+tgw,
  Configure WLD external+tgw) with the §5 cell addresses. verifyLabels per §5
  (note "Visability" spelling, per-pool ipBlocks label).
- [ ] **engine-smoke** — add `createVpcIpBlockPool` to EXPECTED_SYMBOLS.
- [ ] **M2.1 matrix** — add all 10 nested pool paths × scopes to CSV matrices;
  9.1-only sub-fields → 9.0 KNOWN_CSV_GAPS; additional-cluster → allowlist.
- [ ] Targeted test → GREEN.
- [ ] **UI** — two pool cards (External, Private TGW) in the VPC panel, 5 inputs
  each, writing the nested pool fields.
- [ ] **build-html**, full gate, coverage, verify-cell-map (manual per-version
  collision recheck on D196/D188/etc.).
- [ ] **Snapshots** — update; diff = only the new pool fields.
- [ ] Commit, PR, auto-merge.

## Out of scope (per spec §6)
Deploy-WLD deploy-time singular `External IP Block`/`Private TGW IP Block` echo;
Configure-WLD stray `D171/D172`. Documented, deferred — coverage not 100%.
