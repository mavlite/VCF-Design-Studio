import { describe, it } from "vitest";

// Theme 1a — Depot / proxy / activation config model expansion
//
// Adds a new fleet-level config object describing how the VCF Installer
// reaches Broadcom (or an offline depot mirror) and what activation
// material is needed at deploy time.
//
// Target cells: Deploy Management Domain L9–L20 (9.0 + 9.1).
// Activation Code is new in 9.1.
//
// Proposed shape:
//   fleet.installerConfig = {
//     depotType: "broadcom" | "offline",
//     depotUrl: string,
//     depotProtocol: "https" | "http",
//     authenticated: boolean,
//     depotUser: string,
//     depotPassword: string,       // routed through PASSWORD_POLICY
//     proxyEnabled: boolean,
//     proxyHost: string,
//     proxyPort: number,
//     proxyUser: string,
//     proxyPassword: string,       // routed through PASSWORD_POLICY
//     activationCode: string,      // 9.1-only
//   }
//
// Acceptance:
//   - newFleet() carries a default installerConfig
//   - migrateFleet idempotently populates installerConfig on legacy fleets
//   - depot/proxy passwords have PASSWORD_POLICY entries
//   - validatePlacementConstraints does not regress
//   - UI editor exposes the fields under an "Installer / Depot" panel
//   - workbook export to follow in theme-01b

describe.todo("Theme 1a — fleet.installerConfig model expansion (TRACKING)");
