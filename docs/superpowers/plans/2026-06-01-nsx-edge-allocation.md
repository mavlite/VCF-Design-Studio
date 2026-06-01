# NSX Edge IP Assignment / Allocation + Overlay Pool — Implementation Plan

> **For agentic workers:** implement task-by-task; steps use `- [ ]`.

**Goal:** stamp edge-cluster-level IP assignment/allocation modes + overlay pool
into the workbook. **Spec:** `docs/superpowers/specs/2026-06-01-nsx-edge-allocation-design.md`

**Architecture:** new flat fields on `createEdgeCluster()` (cluster-level, shared
across edge nodes — Node-2 cells are workbook formulas), mapped to the Node-1
input cells via the existing `_get/_ensureEdgeCluster` helpers. Two PRs.

---

## PR-1 — Allocation / assignment dropdowns (6 enum fields)

**Files:** `engine.js`, `vcf-design-studio-v9.jsx`, `tests/unit/edge-allocation.test.js`,
`tests/unit/round-trip-matrix.test.js`, `vcf-design-studio-v9.html`, factory snapshots.

- [ ] **Test first** (`tests/unit/edge-allocation.test.js`): for each of the 6
  fields, find the cell-map entry by label, assert sheet/scope/verifyLabel +
  exact `cellFor(e,"9.0")`/`cellFor(e,"9.1")` per the spec §4 tables (mgmt + WLD),
  dataValidation, and resolve/apply against `cluster.edgeCluster`. Assert the two
  9.1-only fields have `workbookVersions:["9.1"]`. migrate backfill + preserve.
  Run → RED.
- [ ] **Model:** extend `createEdgeCluster()` (engine.js:1233) with
  hostGroupAffinity "No", mgmtIpAssignment "IPv4 Only", mgmtIpAllocation "DHCP",
  useClusterHostOverlay "Unselected", tepIpAddressType "IPv4", tepIpAllocation
  "DHCP".
- [ ] **migrate:** extend the `edgeCluster` backfill in `migrateFleet` to
  whitelist-merge the new flat fields against the factory (idempotent).
- [ ] **Cell-map:** add a `_edgeAllocationEntries({scope, sheet, cells})` builder
  (cluster-level — one entry per field, Node-1 cell) resolving via
  `_getEdgeCluster`/`_ensureEdgeCluster`. Dual-version fields use `{v90,v91}`;
  mgmtIpAssignment + tepIpAddressType use `cell:<9.1>, workbookVersions:["9.1"]`.
  Per-sheet `dataValidation` (note WLD TEP-alloc order differs). Enum apply
  coerces to a valid member. Invoke 2× (Configure Mgmt + Configure WLD) with the
  spec §4 addresses.
- [ ] Run targeted test → GREEN.
- [ ] **M2.1:** add the 4 dual-version fields to both CSV matrices (mgmt + WLD);
  the 2 9.1-only fields to CSV_MATRIX_91 + NON_WORKBOOK_ALLOWLIST_90_ONLY;
  enumOverrides for all 6 (valid members per spec §6); additional-cluster
  positions allowlisted (mirror existing edge handling).
- [ ] **UI:** EdgeClusterPanel — cluster-level "IP Assignment & Allocation"
  sub-block with 6 selects (9.1 tooltip on the two 9.1-only ones).
- [ ] **build-html**, full `npm test`, `npm run coverage`, verify-cell-map
  (manual per-version collision recheck vs `_edgeClusterEntries`).
- [ ] **Snapshots:** `vitest run tests/snapshot --update`; diff = only `edgeCluster.*`.
- [ ] Commit (no attribution; include spec + this plan), PR, auto-merge.

## PR-2 — Edge overlay pool (3 text fields)

- [ ] **Test first:** extend `edge-allocation.test.js` with ipPoolName,
  overlayPoolStart, overlayPoolEnd — cell mapping (spec §4) + resolve/apply +
  migrate. RED.
- [ ] **Model:** add the 3 string fields to `createEdgeCluster()`.
- [ ] **migrate:** include them in the whitelist-merge.
- [ ] **Cell-map:** add 3 entries/sheet to `_edgeAllocationEntries` (all
  dual-version, no dataValidation).
- [ ] Targeted test → GREEN.
- [ ] **M2.1:** add the 3 paths to both CSV matrices (mgmt + WLD); additional
  cluster allowlisted.
- [ ] **UI:** EdgeClusterPanel — 3 text inputs in the same sub-block.
- [ ] **build-html**, full gate, coverage, verify-cell-map.
- [ ] **Snapshots** update; diff = only the 3 new fields.
- [ ] Commit, PR, auto-merge.

## Out of scope (spec §8)
Static-IP-list sub-cells (CIDR / static gateway / subnet mask) + edge Management
Gateway — deferred follow-up.
