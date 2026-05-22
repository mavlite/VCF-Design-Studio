import { describe, it } from "vitest";

// Theme 18 — Dual-stack IPv6 fields (9.1 new)
//
// createClusterNetworks is IPv4-only today. 9.1 adds dual-stack IPv6
// fields throughout most sheets (~50 cells per cluster sheet).
//
// Target cells: Deploy WLD D89–D126, Deploy Cluster D54–D92, Deploy
// Mgmt L105/L110/L115/L119/L130/L138. All 9.1-only.
//
// Proposed extension:
//   cluster.networks[trafficType].ipv6 = {
//     gatewayCidr,
//     rangeStart, rangeEnd,
//     enabled: boolean,
//   }
//
// Acceptance:
//   - cluster.networks extended with v6 sub-objects (default disabled)
//   - createClusterNetworks gains ipv6 awareness
//   - allocateClusterIps / validateNetworkDesign honor IPv6
//   - migrateFleet idempotent
//   - WORKBOOK_CELL_MAP entries gated workbookVersions: ["9.1"]
//   - Import round-trip
//   - verify-cell-map green on 9.1

describe.todo("Theme 18 — dual-stack IPv6 cluster networks (9.1) (TRACKING)");
