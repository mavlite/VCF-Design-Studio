import { describe, it } from "vitest";

// Theme 12 — Stretched cluster + vSAN witness deployment data
//
// Studio knows instance.witnessEnabled / witnessSize / witnessSite and
// mgmt.placement="stretched", but doesn't carry the witness deployment
// data (FQDN, IPs, datastore name, AZ2 overlay).
//
// Target cells: Configure Mgmt D381–D442, Deploy Cluster D361–D426. ~30.
//
// Proposed:
//   instance.witness = {
//     ...existing,
//     fqdn, mgmtIp, vmName, clusterName,
//     mgmtNetwork: { vlan, cidr, gateway },
//     vsanDatastore,
//     rootPassword,                  // vault (PASSWORD_POLICY exists)
//     az2: {
//       hostOverlay: { vlan, gateway, cidr, mtu, ipRangeStart, ipRangeEnd },
//       hostOverlayProfile,
//       sddcId,
//     },
//   }
//
// Acceptance:
//   - instance.witness model extended
//   - migrateFleet idempotent (default null)
//   - WORKBOOK_CELL_MAP entries gated by instance.witnessEnabled scope
//   - Import round-trip
//   - verify-cell-map green

describe.todo("Theme 12 — Stretched cluster witness deployment data (TRACKING)");
