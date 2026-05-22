import { describe, it } from "vitest";

// Theme 6 — VCF Operations / Automation appliance detail (9.1 new)
//
// New 9.1 fleet-services block. Studio has 3 emit-only stubs (Instance
// Components, Identity Broker, VCFA services runtime). Everything else
// (per-node FQDNs, LB FQDN, datastore, NFS, rekey interval) is missing.
//
// Target cells: Deploy Mgmt L155–L195 (9.1-only).
//
// Acceptance:
//   - fleet.fleetServicesConfig (or extends naming/) carries the new fields
//   - VCFA / VCF Ops appliance stack entries surface their per-node FQDNs
//     in the export
//   - WORKBOOK_CELL_MAP entries gated workbookVersions: ["9.1"]
//   - resolveHostname template feeds per-node FQDN derivation
//   - Import round-trip on a 9.1 workbook reconstructs all fields
//   - verify-cell-map green on 9.1

describe.todo("Theme 6 — VCF Ops/Automation appliance detail (9.1) (TRACKING)");
