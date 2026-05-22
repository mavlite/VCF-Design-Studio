import { describe, it } from "vitest";

// Theme 15 — WONTFIX
//
// Deploy Mgmt L330–L408 + L385–L408 area is reference-block formula
// cells (=xreg_vrops_*, =mgmt_nsxt_*, =sddc_mgr_fqdn) plus 15 ESX FQDN
// "Value Missing" placeholders. These are NOT user-input cells —
// they're calculated from named ranges elsewhere in the workbook and
// will resolve on export when the underlying named ranges are
// populated.
//
// Decision: do not add cell-map entries. Existing emit-only entries
// already cover the underlying FQDNs that these formulas reference.
//
// This tracking PR exists for traceability only.

describe.todo("Theme 15 — WONTFIX, formula cells not user-input (TRACKING)");
