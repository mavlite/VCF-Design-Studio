import { describe, it } from "vitest";

// Theme 3 — vDS / port-group / LAG topology
//
// Largest cell-count gap (~120 cells per cluster sheet × 3 sheets).
// Studio has cluster.networks.vds[i] with name/uplinks/mtu. Missing:
//   - LAG name, mode (active/passive), timeout, load-balancing
//   - Port-group names per traffic type (mgmt, vmotion, vsan, host-TEP,
//     edge-TEP, edge-uplink-1/2, vSAN witness)
//   - Per-traffic teaming policy + uplink ordering (active/standby)
//
// Target cells:
//   - Deploy Mgmt L201–L273
//   - Deploy WLD D247–D335
//   - Deploy Cluster D172–D261
//
// Acceptance:
//   - cluster.networks.vds[i] extended with lag{} + portGroups{} blocks
//   - migrateFleet idempotent on legacy fleets
//   - NIC_PROFILES preset templates updated to populate the new fields
//   - WORKBOOK_CELL_MAP carries entries per VDS slot × traffic type
//   - Import round-trip works
//   - verify-cell-map green

describe.todo("Theme 3 — vDS / port-group / LAG topology export (TRACKING)");
