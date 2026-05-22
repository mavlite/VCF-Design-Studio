import { describe, it } from "vitest";

// Theme 7a — Active Directory / SSO integration model
//
// Adds fleet.adConfig for AD-joined SDDC accounts + signed-cert
// generation + SSL params. Studio doesn't model any of this today.
//
// Target cells (export in theme 7b): Configure Mgmt D33–D85 + the
// separate "Active Directory Inputs" sheet (~30 cells).
//
// Proposed shape:
//   fleet.adConfig = {
//     adFqdn, adUser, adPassword,         // vault
//     templateName,
//     ca: { url, algorithm, keySize, csrSubject: { org, ou, country, state, locality, email } },
//     ssp: { ... },                        // separate SSP block if surfaced here
//   }
//
// Acceptance:
//   - fleet.adConfig default shape via newFleet()
//   - migrateFleet idempotent
//   - AD password has PASSWORD_POLICY entry, flows through vault
//   - UI editor in a new "Identity / AD" panel
//   - validatePlacementConstraints does not regress
//   - Export deferred to theme 7b

describe.todo("Theme 7a — fleet.adConfig model expansion (TRACKING)");
