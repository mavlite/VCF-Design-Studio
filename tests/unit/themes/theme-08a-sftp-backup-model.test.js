import { describe, it } from "vitest";

// Theme 8a — SFTP backup target model
//
// Add fleet.backupConfig for SDDC Manager + NSX SFTP backup destination
// and Encryption Passphrase. Studio doesn't model any of this today.
//
// Proposed:
//   fleet.backupConfig = {
//     host, port, protocol: "sftp" | "ftps",
//     user, password,             // vault
//     directory, sshFingerprint,
//     encryptionPassphrase,       // vault (PASSWORD_POLICY already exists)
//   }
//
// Acceptance:
//   - newFleet() carries default backupConfig
//   - migrateFleet idempotent
//   - SFTP password and Encryption Passphrase both flow through vault
//   - UI panel "Backup / SFTP"
//   - No regression in validatePlacementConstraints

describe.todo("Theme 8a — fleet.backupConfig model expansion (TRACKING)");
