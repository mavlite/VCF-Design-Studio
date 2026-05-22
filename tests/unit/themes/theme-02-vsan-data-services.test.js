import { describe, it } from "vitest";

// Theme 2 — vSAN data services & encryption
//
// Extend cluster storage settings to cover FTT enum, dedupe/compression
// toggles (already present), DIT encryption mode + rekey interval, vSAN
// datastore name, and NFS principal-storage path/server/folder.
//
// Target cells: Deploy Mgmt L57–L61, Deploy WLD D212–D219, Deploy
// Cluster D138–D148. ~25 cells per cluster context.
//
// Today: cluster.host.vsanArchitecture exists. Missing: ftt, dit, rekey,
// datastoreName, nfs{path,server,folder}.
//
// Acceptance:
//   - cluster.storage extended with the new fields (default values)
//   - migrateFleet idempotently populates new fields
//   - WORKBOOK_CELL_MAP carries entries for each field, per workbook version
//   - import path round-trips through importWorkbookCellMap
//   - sizeFleet does not regress on existing fleets
//   - verify-cell-map green

describe.todo("Theme 2 — vSAN data services + encryption + datastore export (TRACKING)");
