import { describe, it } from "vitest";

// Theme 11 — vSphere Supervisor / VKS (9.1 major expansion)
//
// Studio has a vks stack entry but no Supervisor config object. Big
// 9.1-only block (~60 cells per sheet × 3 sheets).
//
// Target cells: Configure Mgmt D242–D289, Configure WLD D188–D235,
// Deploy WLD D339–D353 (9.1-only).
//
// Proposed:
//   cluster.supervisorConfig = {
//     networkingStack: "nsx" | "nsxt-vpc",
//     supervisorName, vSphereZone,
//     storagePolicies: { controlPlane: string[3] },
//     ipMode: "static" | "dhcp", ipAddresses: { mgmt, workload, frontend },
//     dnsServers: [], ntpServers: [],
//     nsxProject, vpcConnectivityProfile,
//     externalCidr, transitCidr, privateCidr, serviceCidr,
//     controlPlaneSize: enum,
//     apiServerDnsNames: [],
//     tanzuMissionControl: { url, registration, creds },
//   }
//
// Acceptance:
//   - cluster.supervisorConfig (or fleet.vksConfig?) — design decision
//   - migrateFleet idempotent (default null when not configured)
//   - WORKBOOK_CELL_MAP entries gated workbookVersions: ["9.1"]
//   - Import round-trip
//   - verify-cell-map green on 9.1 only

describe.todo("Theme 11 — vSphere Supervisor / VKS (9.1) (TRACKING)");
