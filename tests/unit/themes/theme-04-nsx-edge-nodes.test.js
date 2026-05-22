import { describe, it } from "vitest";

// Theme 4 — NSX Edge cluster + per-node detail
//
// Studio has t0Gateways[].edgeNodeKeys + form-factor. Missing per-node
// FQDN, mgmt IP, TEP VLAN+pool, MTU, host-group affinity, resource pool
// name, fp-eth0/fp-eth1 port mapping.
//
// Target cells: Configure Mgmt D89–D154, Configure WLD D34–D97. ~70
// cells per sheet.
//
// Acceptance:
//   - edgeCluster.nodes[i] data model added (fqdn, mgmtIp, tepIps, mtu,
//     hostGroup, resourcePool, fpEth0, fpEth1)
//   - migrateFleet idempotent
//   - WORKBOOK_CELL_MAP entries per node × field
//   - Import round-trip preserves all node data
//   - validatePlacementConstraints — no regression on existing T0 rules
//   - verify-cell-map green

describe.todo("Theme 4 — NSX Edge node FQDN/IP/MTU export (TRACKING)");
