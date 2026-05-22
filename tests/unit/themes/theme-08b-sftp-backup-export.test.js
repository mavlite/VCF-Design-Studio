import { describe, it } from "vitest";

// Theme 8b — SFTP backup workbook export
//
// Depends on theme 8a (fleet.backupConfig) being merged first.
//
// Target cells: Configure Mgmt D5–D29. ~10 cells.
//
// Acceptance:
//   - WORKBOOK_CELL_MAP entries for every backupConfig field
//   - SFTP password + Encryption Passphrase flow through vault
//   - import round-trip rebuilds backupConfig
//   - verify-cell-map green

describe.todo("Theme 8b — SFTP backup workbook export (TRACKING)");
