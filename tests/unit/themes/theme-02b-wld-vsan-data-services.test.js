import { describe, it } from "vitest";

// Theme 2b — WLD vSAN data services (workload-cluster scope).
//
// Mirror of theme 2 (mgmt-cluster) onto the "Deploy Workload Domain"
// sheet, targeting the primary cluster of each workload domain
// (scope: "workload-cluster"). Cells verified against
// test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json on
// 2026-05-24.
//
// Target cells (Deploy Workload Domain sheet):
//   FTT                     D203 / D214   (dynamic label: "vSAN: Failures to Tolerate" / "Storage Policy")
//   Dedup/Compression       D204 / D219   "vSAN: Deduplication and Compression"   Selected/Unselected
//   vSAN Datastore Name     D201 / D212   "vSAN Datastore Name"
//   DIT encryption ON/OFF      —  / D215   "Data-in-Transit encryption"           9.1-only, Selected/Unselected
//   DIT Rekey Mode             —  / D216   "Rekey interval"                       9.1-only, Default/Custom
//   DIT Rekey Interval (Def)   —  / D217   "Rekey interval - Default"             9.1-only
//   DIT Rekey Interval (Cust)  —  / D218   "Rekey interval - Custom"              9.1-only
//   NFS Datastore Name      D206 / D221   "NFS: Datastore Name"
//   NFS Share Path          D207 / D222   verifyLabelByVersion: "NFS: Share Path" (9.0) / "NFS: Folder" (9.1)
//   NFS Server IP           D208 / D223   verifyLabelByVersion: "NFS: Address of NFS Server" (9.0) / "NFS: Server IP Address" (9.1)
//
// Schema delta vs. theme 2 (mgmt):
//   - Add `dataServices.dit.enabled` (boolean, 9.1-only export) — WLD
//     sheet has a separate DIT-on toggle that mgmt sheet lacks.
//   - No "bound to vmknic" cell on this sheet (mgmt's L122/L196 has no
//     counterpart) — that field stays mgmt-cluster-scoped.
//
// UI: VsanDataServicesPanel already renders for every cluster in
// ClusterCard (vcf-design-studio-v9.jsx:1270) regardless of domain type,
// so existing fields satisfy [[feedback-export-requires-ui-input]].
// The new `dit.enabled` toggle must be added to the panel and schema
// before its WORKBOOK_CELL_MAP entry can ship.
//
// Acceptance:
//   - baseStorageDataServices() gains `dit.enabled` (default true)
//   - VsanDataServicesPanel surfaces the new toggle, gated on
//     vcfVersion === "9.1"
//   - migrateFleet idempotently populates the new field
//   - WORKBOOK_CELL_MAP carries 10 new entries scoped to
//     "workload-cluster" with workbookVersions split per the table above
//   - importWorkbookCellMap round-trips every new entry
//   - verify-cell-map.mjs green for both 9.0 and 9.1
//   - Snapshot fixtures updated for any fleet whose workload domains
//     touch the new fields

describe.todo("Theme 2b — WLD vSAN data services export (TRACKING)");
