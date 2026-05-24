import { describe, it } from "vitest";

// Theme 2c — Additional-cluster vSAN data services (Deploy Cluster sheet).
//
// Mirror of theme 2 (mgmt-cluster) and theme 2b (workload-cluster) onto
// the "Deploy Cluster" sheet, targeting the second-and-beyond clusters
// of each workload domain (scope: "additional-cluster"). Cells verified
// against test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json on
// 2026-05-24. The original theme-2 tracking commit cited "D138–D148"
// for this sheet; that was speculative and partially wrong — the actual
// 9.1 range is D141/D143/D144/D146-D148 (FTT at D143, not D138).
//
// Target cells (Deploy Cluster sheet):
//   FTT                  D131 / D143   (dynamic label: "vSAN: Failures to Tolerate" / "Storage Policy")
//   Dedup/Compression    D132 / D144   "vSAN: Deduplication and Compression"   Selected/Unselected
//   vSAN Datastore Name  D129 / D141   "vSAN Datastore Name"
//   NFS Datastore Name   D134 / D146   "NFS: Datastore Name"
//   NFS Share Path       D135 / D147   "NFS: Share Path"
//   NFS Server IP        D136 / D148   "NFS: Address of NFS Server"
//
// Scope differences vs. theme 2 / 2b:
//   - No DIT / rekey cells on this sheet. Additional clusters inherit
//     Data-in-Transit encryption settings from their parent WLD. Smaller
//     export footprint (6 cells per cluster context, not 10).
//   - No NFS-bound-to-vmknic cell.
//   - The Deploy Cluster sheet also has a second block (D334-D429)
//     covering vSAN witness / stretched compute topology — that belongs
//     to theme 12 (stretched cluster witness), out of scope here.
//
// UI: VsanDataServicesPanel already renders for every cluster including
// additional clusters in WLDs (vcf-design-studio-v9.jsx:1270). No new
// schema fields needed — all six map onto fields already added by
// theme 2.
//
// Acceptance:
//   - WORKBOOK_CELL_MAP carries 6 new entries scoped to
//     "additional-cluster" with cellByVersion overrides per the table
//   - No new schema additions to baseStorageDataServices()
//   - importWorkbookCellMap round-trips every new entry
//   - verify-cell-map.mjs green for both 9.0 and 9.1
//   - Snapshot fixtures updated for any fleet with additional clusters
//     that touch the new fields

describe.todo("Theme 2c — Additional-cluster vSAN data services export (TRACKING)");
