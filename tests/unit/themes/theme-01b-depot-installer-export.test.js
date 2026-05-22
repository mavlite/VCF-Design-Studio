import { describe, it } from "vitest";

// Theme 1b — Depot / proxy / activation cell-map export
//
// Adds WORKBOOK_CELL_MAP entries for Deploy Management Domain L9–L20
// (9.0 + 9.1) so the studio stamps fleet.installerConfig into the
// workbook on emit, and reads it back on import.
//
// Depends on theme-01a (model expansion) being merged first.
//
// Acceptance:
//   - emitWorkbookCellMap produces rows for every installerConfig field
//   - importWorkbookCellMap rebuilds installerConfig from a stamped workbook
//   - depot/proxy passwords flow through the vault, not the CSV
//   - 9.1 Activation Code is gated by workbookVersions: ["9.1"]
//   - verify-cell-map green
//   - migrateFleet round-trip idempotent

describe.todo("Theme 1b — depot/installer workbook export (TRACKING)");
