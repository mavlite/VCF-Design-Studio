import { describe, it } from "vitest";

// Theme 5 — T0 BGP / routing detail workbook export
//
// EXPORT-ONLY work. Studio already fully models t0Gateways[].bgpPeers,
// uplinksPerEdge, asnLocal, haMode, bfdEnabled. Nothing exports to
// the workbook today.
//
// Target cells: Configure Mgmt D156–D184, Configure WLD D99–D127.
// ~25 cells per sheet.
//
// Acceptance:
//   - WORKBOOK_CELL_MAP carries entries for: HA mode, ASN, per-uplink
//     VLAN/IP/peer-IP/peer-ASN/MTU/BFD enum
//   - BGP peer passwords flow through emitWorkbookXlsxWithPasswords
//     (vault path) — not the CSV cell-map
//   - importWorkbookCellMap reads back into t0Gateways[].bgpPeers
//   - verify-cell-map green on both versions
//   - migrateFleet idempotent with BGP detail round-trip

describe.todo("Theme 5 — T0 BGP routing detail workbook export (TRACKING)");
