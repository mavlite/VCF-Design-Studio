import { describe, it } from "vitest";

// Theme 17 — WONTFIX
//
// Deploy Mgmt L290–L292 (9.1-only) is VCF Installer placement +
// Appliance FQDN. The studio designs fleet topology; the installer is
// the BOOTSTRAP HOST that consumes the workbook. Installer placement
// is decided by the operator running the installer, not by fleet
// planning.
//
// Decision: do not model. This tracking PR exists for traceability.

describe.todo("Theme 17 — WONTFIX, installer is upstream of fleet planning (TRACKING)");
