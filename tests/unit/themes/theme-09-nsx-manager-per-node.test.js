import { describe, it } from "vitest";

// Theme 9 — NSX Manager per-node detail
//
// Studio has nsxMgr stack entry with size (sizing only). Missing per-node
// VM name, deployment size, FQDN, mgmt IPv4, domain search list for
// Node 1/2/3.
//
// Target cells: Configure Mgmt D468–D515 (~25). WLD versions live on
// Deploy WLD sheet.
//
// Acceptance:
//   - nsxManager.nodes[i] data model (vmName, deploySize, fqdn, mgmtIp,
//     searchList) added with defaults
//   - migrateFleet idempotent
//   - WORKBOOK_CELL_MAP entries per node × field
//   - Import round-trip
//   - verify-cell-map green

describe.todo("Theme 9 — NSX Manager per-node detail (TRACKING)");
