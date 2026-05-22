import { describe, it } from "vitest";

// Theme 13 — NSX Federation (GM cluster + RTEP + cross-instance Tier-1)
//
// Studio has fleet.federationEnabled + nsxGlobalMgr stack entry. Missing
// GM cluster IDs, API thumbprints, RTEP data, T1 cross-instance segments.
//
// Target cells: Configure Mgmt D521–D599, Configure WLD D7. ~25 cells.
//
// Proposed:
//   fleet.federationConfig = {
//     globalManager: {
//       cluster: { nodeFqdns: [], clusterId, apiThumbprint },
//       rtep: { vlan, edgeSwitchName },
//     },
//     tier1: { name, linkedT0, crossInstanceSegment },
//     nsxt: { username, password, thumbprint, locationName }, // creds via vault
//   }
//
// Acceptance:
//   - fleet.federationConfig model added, gated by federationEnabled
//   - migrateFleet idempotent
//   - NSX-T creds + thumbprint in vault path
//   - WORKBOOK_CELL_MAP entries scoped to federation-enabled fleets only
//   - Import round-trip
//   - verify-cell-map green

describe.todo("Theme 13 — NSX Federation GM cluster + RTEP (TRACKING)");
