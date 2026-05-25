// Theme 8a — fleet.backupConfig model expansion.
//
// Adds the data model + UI + vault-policy entry for SDDC Manager and
// NSX Manager's SFTP/FTPS backup destination + the fleet-wide
// Encryption Passphrase. Workbook export (Configure Mgmt D5-D29) is
// deferred to theme 8b, which references the passwordKind entries
// added here.
//
// Field set (createFleetBackupConfig):
//   host, port (default 22), protocol ("sftp"|"ftps"),
//   user, password,                      // vault — sftp-backup
//   directory, sshFingerprint,
//   encryptionPassphrase                 // vault — encryption-passphrase (existing policy)
//
// Acceptance:
//   - newFleet() carries default backupConfig
//   - migrateFleet idempotent on legacy fleets (whitelist-merge)
//   - PASSWORD_POLICY["sftp-backup"] exists with infrastructure-grade settings
//   - PASSWORD_POLICY["encryption-passphrase"] unchanged (no regression)
//   - No regression in validatePlacementConstraints (backupConfig is metadata-only)

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  migrateFleet,
  createFleetBackupConfig,
  PASSWORD_POLICY,
  generatePassword,
  validatePlacementConstraints,
} = VcfEngine;

describe("Theme 8a — createFleetBackupConfig factory", () => {
  it("returns the documented field set with safe defaults", () => {
    expect(createFleetBackupConfig()).toEqual({
      host: "",
      port: 22,
      protocol: "sftp",
      user: "",
      password: "",
      directory: "",
      sshFingerprint: "",
      encryptionPassphrase: "",
    });
  });

  it("returns a fresh object on each call (no shared state)", () => {
    const a = createFleetBackupConfig();
    const b = createFleetBackupConfig();
    a.host = "x.example.com";
    expect(b.host).toBe("");
  });

  it("port defaults to SFTP standard (22), protocol defaults to sftp", () => {
    const cfg = createFleetBackupConfig();
    expect(cfg.port).toBe(22);
    expect(cfg.protocol).toBe("sftp");
  });
});

describe("Theme 8a — newFleet wires backupConfig", () => {
  it("ships fleet.backupConfig with factory defaults", () => {
    const f = newFleet();
    expect(f.backupConfig).toEqual(createFleetBackupConfig());
  });
});

describe("Theme 8a — migrateFleet backfill", () => {
  it("backfills backupConfig on legacy fleets that lack it", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    delete raw.backupConfig;
    const migrated = migrateFleet(raw);
    expect(migrated.backupConfig).toEqual(createFleetBackupConfig());
  });

  it("preserves user-customized fields on round-trip (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.backupConfig = {
      host: "backup-01.lab.local",
      port: 990,
      protocol: "ftps",
      user: "vcf-svc",
      password: "preserved",
      directory: "/srv/backups",
      sshFingerprint: "SHA256:abc",
      encryptionPassphrase: "passphrase-preserved",
    };
    const round1 = migrateFleet(f);
    const round2 = migrateFleet(round1);
    expect(round2.backupConfig).toEqual({
      host: "backup-01.lab.local",
      port: 990,
      protocol: "ftps",
      user: "vcf-svc",
      password: "preserved",
      directory: "/srv/backups",
      sshFingerprint: "SHA256:abc",
      encryptionPassphrase: "passphrase-preserved",
    });
  });

  it("drops unknown keys (whitelist-merge against factory)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.backupConfig = { host: "x", bogus: "junk" };
    const migrated = migrateFleet(f);
    expect(migrated.backupConfig.host).toBe("x");
    expect(migrated.backupConfig).not.toHaveProperty("bogus");
    // Missing fields fall back to factory defaults.
    expect(migrated.backupConfig.port).toBe(22);
    expect(migrated.backupConfig.protocol).toBe("sftp");
  });

  it("handles a non-object backupConfig defensively", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.backupConfig = "not-an-object";
    const migrated = migrateFleet(f);
    expect(migrated.backupConfig).toEqual(createFleetBackupConfig());
  });
});

describe("Theme 8a — PASSWORD_POLICY entries", () => {
  it("adds sftp-backup entry with 20-char infrastructure-grade settings", () => {
    const p = PASSWORD_POLICY["sftp-backup"];
    expect(p).toBeTruthy();
    expect(p.len).toBe(20);
    expect(p.classes).toEqual({ upper: 5, lower: 5, digit: 5, special: 5 });
    // Sum of class counts == total length (no slack characters).
    const sum = p.classes.upper + p.classes.lower + p.classes.digit + p.classes.special;
    expect(sum).toBe(p.len);
  });

  it("sftp-backup shares the canonical infra-credential special alphabet", () => {
    const sftp = PASSWORD_POLICY["sftp-backup"];
    const sddc = PASSWORD_POLICY["sddc-root"];
    // Same alphabet as other infrastructure service accounts — keeps the
    // shell-safety guarantees (no \, ', ", <, >, backtick, ;) and the
    // Excel-safety guarantees (no =, +, -, @) consistent across creds.
    expect(sftp.alphabet.special).toBe(sddc.alphabet.special);
    // Spot-check the documented exclusions per README:
    for (const ch of ["=", "+", "-", "@", "\\", "'", "\"", "<", ">", "`", ";"]) {
      expect(sftp.alphabet.special, `${ch} must NOT appear in sftp-backup specials`).not.toContain(ch);
    }
  });

  it("encryption-passphrase entry unchanged (no regression)", () => {
    const p = PASSWORD_POLICY["encryption-passphrase"];
    expect(p.len).toBe(32);
    expect(p.classes).toEqual({ upper: 8, lower: 8, digit: 8, special: 8 });
  });

  it("generatePassword('sftp-backup') yields a valid 20-char password", () => {
    const pw = generatePassword("sftp-backup");
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[0-9]/);
    // Has at least one special char from _SPECIAL_SAFE.
    expect(pw).toMatch(/[^A-Za-z0-9]/);
  });

  it("generatePassword('sftp-backup') produces unique values across calls (CSPRNG)", () => {
    const a = generatePassword("sftp-backup");
    const b = generatePassword("sftp-backup");
    expect(a).not.toBe(b);
  });
});

describe("Theme 8a — no regression on placement validator", () => {
  it("validatePlacementConstraints clean on a default newFleet (backupConfig is metadata-only)", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    expect(Array.isArray(issues)).toBe(true);
    // No new critical issues introduced by the model addition.
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });

  it("validatePlacementConstraints still clean after backupConfig is populated", () => {
    const fleet = newFleet();
    fleet.backupConfig = {
      host: "backup.example.com",
      port: 22,
      protocol: "sftp",
      user: "vcf-svc",
      password: "",
      directory: "/backups",
      sshFingerprint: "SHA256:abc",
      encryptionPassphrase: "",
    };
    const issues = validatePlacementConstraints(fleet);
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });
});
