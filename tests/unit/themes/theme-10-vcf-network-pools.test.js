import { describe, it } from "vitest";

// Theme 10 — VCF Network Pools (cluster-level)
//
// Studio has cluster.networks.{mgmt, vmotion, vsan, hostTep, edgeTep} with
// vlan/subnet/gateway/pool. Currently only VLAN/CIDR are exported. Missing:
// MTU, gateway full CIDR, pool start/end, host-to-pool table for up to
// 16 hosts.
//
// Target cells: Configure Mgmt D319–D365, Configure WLD D267–D300,
// Deploy Cluster D291–D344. ~30 per sheet.
//
// Acceptance:
//   - cluster.networks shape extended with mtu, gateway full CIDR,
//     poolRangeStart, poolRangeEnd (some already present — audit and unify)
//   - WORKBOOK_CELL_MAP entries for every pool per sheet
//   - Host-to-pool table (16 hosts × 4 networks) expanded via cellPattern
//   - Import round-trip
//   - verify-cell-map green

describe.todo("Theme 10 — VCF Network Pools cluster-level export (TRACKING)");
