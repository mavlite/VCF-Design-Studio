import { describe, it } from "vitest";

// Theme 7b — Active Directory / SSO workbook export
//
// Depends on theme 7a (fleet.adConfig model) being merged first.
//
// Target cells: Configure Mgmt D33–D85 + the separate "Active
// Directory Inputs" sheet. ~30 cells per workbook version.
//
// Acceptance:
//   - WORKBOOK_CELL_MAP entries cover every adConfig field
//   - AD password flows through vault, not CSV
//   - import round-trip rebuilds adConfig
//   - new sheet "Active Directory Inputs" added to verify-cell-map scope
//   - verify-cell-map green

describe.todo("Theme 7b — AD/SSO workbook export (TRACKING)");
