// Theme 8b — SDDC Manager + NSX SFTP backup workbook export.
//
// Source model: fleet.backupConfig (shipped by theme 8a). Workbook
// layout is identical across 9.0/9.1 with a +1 row shift (block starts
// D21 in 9.0, D22 in 9.1). Cells verified against
// test-fixtures/workbook/workbook-cell-meta-{9.0,9.1}.json 2026-05-25.
//
// Target cells (Configure Management Domain, instance scope):
//   Host FQDN or IP        D21 / D22
//   Port                   D22 / D23
//   Transfer Protocol      D23 / D24
//   Username               D24 / D25
//   Password (vault)       D25 / D26   passwordKind: "sftp-backup"
//   Backup Directory       D26 / D27
//   SSH Fingerprint        D27 / D28
//   Encryption Passphrase  D28 / D29   passwordKind: "encryption-passphrase" (preserved from prior)

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  createFleetBackupConfig,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  generateWorkbookVault,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

const SHEET = "Configure Management Domain";

const NEW_LABELS = [
  "SFTP Backup Host",
  "SFTP Backup Port",
  "SFTP Backup Transfer Protocol",
  "SFTP Backup Username",
  "SFTP Backup Password",
  "SFTP Backup Directory",
  "SFTP Backup SSH Fingerprint",
];

const EXPECTED_CELLS = {
  "SFTP Backup Host":              { v90: "D21", v91: "D22" },
  "SFTP Backup Port":              { v90: "D22", v91: "D23" },
  "SFTP Backup Transfer Protocol": { v90: "D23", v91: "D24" },
  "SFTP Backup Username":          { v90: "D24", v91: "D25" },
  "SFTP Backup Password":          { v90: "D25", v91: "D26" },
  "SFTP Backup Directory":         { v90: "D26", v91: "D27" },
  "SFTP Backup SSH Fingerprint":   { v90: "D27", v91: "D28" },
};

function fleetWithBackup() {
  const f = newFleet();
  f.backupConfig = {
    host: "backup-01.lab.local",
    port: 990,
    protocol: "ftps",
    user: "vcf-svc",
    password: "irrelevant-the-vault-overrides",
    directory: "/srv/backups",
    sshFingerprint: "SHA256:abc123",
    encryptionPassphrase: "irrelevant-the-vault-overrides",
  };
  return f;
}

describe("Theme 8b — WORKBOOK_CELL_MAP entries", () => {
  it("all 7 new SFTP backup entries present on instance scope", () => {
    for (const label of NEW_LABELS) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "instance");
      expect(e, `missing cell-map entry: ${label}`).toBeTruthy();
      expect(e.sheet).toBe(SHEET);
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    }
  });

  it("each entry targets the documented (9.0, 9.1) cell pair", () => {
    for (const [label, { v90, v91 }] of Object.entries(EXPECTED_CELLS)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "instance");
      expect(e.cell, `${label} 9.0 cell`).toBe(v90);
      expect(e.cellByVersion["9.1"], `${label} 9.1 cell`).toBe(v91);
    }
  });

  it("Password entry is vault-flow (passwordKind sftp-backup, emitOnly)", () => {
    const pw = WORKBOOK_CELL_MAP.find((x) => x.label === "SFTP Backup Password" && x.scope === "instance");
    expect(pw.passwordKind).toBe("sftp-backup");
    expect(pw.emitOnly).toBe(true);
    expect(typeof pw.apply).toBe("undefined");        // no apply — never round-trips through CSV
  });

  it("non-password entries each carry resolve + apply", () => {
    const dataEntries = NEW_LABELS.filter((l) => l !== "SFTP Backup Password");
    for (const label of dataEntries) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "instance");
      expect(typeof e.resolve).toBe("function");
      expect(typeof e.apply).toBe("function");
      expect(e.emitOnly).toBeFalsy();
      expect(e.passwordKind).toBeFalsy();
    }
  });

  it("existing Encryption Passphrase entry preserved at D28/D29", () => {
    const ep = WORKBOOK_CELL_MAP.find((x) => x.label === "Encryption Passphrase" && x.scope === "instance");
    expect(ep).toBeTruthy();
    expect(ep.cell).toBe("D28");
    expect(ep.cellByVersion["9.1"]).toBe("D29");
    expect(ep.passwordKind).toBe("encryption-passphrase");
    expect(ep.emitOnly).toBe(true);
  });
});

describe("Theme 8b — emit semantics", () => {
  it("emits factory defaults to the right cells on a 9.1 fleet", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("D22").value).toBe("");          // host (empty default)
    expect(find("D23").value).toBe("22");        // port default
    expect(find("D24").value).toBe("SFTP");      // protocol uppercased
    expect(find("D25").value).toBe("");          // user (empty default)
    expect(find("D27").value).toBe("");          // directory (empty default)
    expect(find("D28").value).toBe("");          // ssh fingerprint (empty default)
  });

  it("emits user-populated values into 9.0 cells", () => {
    const f = fleetWithBackup();
    f.vcfVersion = "9.0";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("D21").value).toBe("backup-01.lab.local");
    expect(find("D22").value).toBe("990");
    expect(find("D23").value).toBe("FTPS");
    expect(find("D24").value).toBe("vcf-svc");
    expect(find("D26").value).toBe("/srv/backups");
    expect(find("D27").value).toBe("SHA256:abc123");
  });

  it("DOES NOT emit the SFTP Password cell on the normal cell-map (vault flow)", () => {
    const f = fleetWithBackup();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const pwRow91 = rows.find((r) => r.sheet === SHEET && r.cell === "D26" && r.label === "SFTP Backup Password");
    expect(pwRow91).toBeUndefined();
    // No row on 9.0 either (D25).
    const rows90 = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const pwRow90 = rows90.find((r) => r.sheet === SHEET && r.cell === "D25" && r.label === "SFTP Backup Password");
    expect(pwRow90).toBeUndefined();
  });
});

describe("Theme 8b — import round-trip", () => {
  it("CSV round-trip reconstructs every non-password backupConfig field", () => {
    const original = fleetWithBackup();
    original.vcfVersion = "9.1";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    expect(rebuilt.backupConfig.host).toBe("backup-01.lab.local");
    expect(rebuilt.backupConfig.port).toBe(990);
    expect(rebuilt.backupConfig.protocol).toBe("ftps");
    expect(rebuilt.backupConfig.user).toBe("vcf-svc");
    expect(rebuilt.backupConfig.directory).toBe("/srv/backups");
    expect(rebuilt.backupConfig.sshFingerprint).toBe("SHA256:abc123");
    // Passwords never ride the cell-map — they come back blank (factory default).
    expect(rebuilt.backupConfig.password).toBe("");
    expect(rebuilt.backupConfig.encryptionPassphrase).toBe("");
  });

  it("Port apply coerces non-numeric input back to default 22", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: SHEET, cell: "D23", label: "SFTP Backup Port", value: "not-a-number" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(rebuilt.backupConfig.port).toBe(22);
  });

  it("Protocol apply normalizes any input to 'sftp' unless explicitly 'ftps'", () => {
    const ftps = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D24", label: "SFTP Backup Transfer Protocol", value: "FTPS" }],
      { workbookVersion: "9.1" }
    );
    const sftp = importWorkbookCellMap(
      [{ workbookVersion: "9.1", sheet: SHEET, cell: "D24", label: "SFTP Backup Transfer Protocol", value: "garbage" }],
      { workbookVersion: "9.1" }
    );
    expect(ftps.fleet.backupConfig.protocol).toBe("ftps");
    expect(sftp.fleet.backupConfig.protocol).toBe("sftp");
  });
});

describe("Theme 8b — vault inclusion", () => {
  it("generateWorkbookVault includes the SFTP Password cell on a 9.1 fleet", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const { vault } = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const sftpCred = vault.credentials.find((c) => c.credentialType === "sftp-backup");
    expect(sftpCred, "vault must include the sftp-backup credential").toBeTruthy();
    expect(sftpCred.sheet).toBe(SHEET);
    expect(sftpCred.cell).toBe("D26");           // 9.1 password cell
    expect(sftpCred.password).toHaveLength(20);  // matches PASSWORD_POLICY len
  });

  it("Encryption Passphrase still in the vault (no regression)", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const { vault } = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const ep = vault.credentials.find((c) => c.credentialType === "encryption-passphrase");
    expect(ep).toBeTruthy();
    expect(ep.cell).toBe("D29");
    expect(ep.password).toHaveLength(32);
  });

  it("sftp-backup credential is unique per generation (CSPRNG)", () => {
    const f = newFleet();
    const a = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const b = generateWorkbookVault(f, { workbookVersion: "9.1" });
    const pwA = a.vault.credentials.find((c) => c.credentialType === "sftp-backup").password;
    const pwB = b.vault.credentials.find((c) => c.credentialType === "sftp-backup").password;
    expect(pwA).not.toBe(pwB);
  });
});
