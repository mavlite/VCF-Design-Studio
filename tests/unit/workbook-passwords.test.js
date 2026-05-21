// Tests for the password-generation engine (Plan 13 Phase 13a + 13b).
//
// What we DO assert:
//   - PASSWORD_POLICY entries match the documented per-credential rules
//   - generatePassword(kind) returns a string of the right length with
//     at least the minimum count of each required character class
//   - The studio never uses Math.random for password generation (lint
//     check: grep the engine source for `Math.random` near password
//     functions)
//   - generateWorkbookVault returns a vault with sorted, well-typed
//     credentials and never persists anything in the module
//   - emitWorkbookCellMap skips passwordKind entries (passwords never
//     flow through the default export)
//   - Auto-generate toggle cells emit "Selected" by default
//
// What we DO NOT assert:
//   - Specific output values (passwords are non-deterministic by design)
//   - Cryptographic strength (we trust crypto.getRandomValues; counting
//     entropy here would just re-implement the spec)

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import VcfEngine from "../../engine.js";

const {
  PASSWORD_POLICY,
  generatePassword,
  generateWorkbookVault,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  newFleet,
} = VcfEngine;

describe("PASSWORD_POLICY — schema", () => {
  it("every policy declares len + classes + alphabet (or default)", () => {
    for (const [kind, policy] of Object.entries(PASSWORD_POLICY)) {
      expect(typeof policy.len, `${kind}.len`).toBe("number");
      expect(policy.len, `${kind}.len > 0`).toBeGreaterThan(0);
      expect(typeof policy.classes, `${kind}.classes`).toBe("object");
      for (const cls of ["upper", "lower", "digit", "special"]) {
        expect(typeof policy.classes[cls], `${kind}.classes.${cls}`).toBe("number");
        expect(policy.classes[cls], `${kind}.classes.${cls} >= 0`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("BGP peer policy has zero special chars (router-friendly alphabet)", () => {
    expect(PASSWORD_POLICY["bgp-peer"].classes.special).toBe(0);
    expect(PASSWORD_POLICY["bgp-peer"].alphabet.special).toBe("");
  });

  it("encryption passphrase is the longest policy (32 chars)", () => {
    expect(PASSWORD_POLICY["encryption-passphrase"].len).toBe(32);
  });

  it("class sums equal policy length for all entries (no padding required)", () => {
    for (const [kind, policy] of Object.entries(PASSWORD_POLICY)) {
      const sum = policy.classes.upper + policy.classes.lower +
                  policy.classes.digit + policy.classes.special;
      expect(sum, `${kind}: class sum should equal len`).toBe(policy.len);
    }
  });
});

describe("generatePassword — output shape", () => {
  it("returns a string of the requested length for every policy", () => {
    for (const kind of Object.keys(PASSWORD_POLICY)) {
      const p = generatePassword(kind);
      expect(typeof p).toBe("string");
      expect(p.length, kind).toBe(PASSWORD_POLICY[kind].len);
    }
  });

  it("satisfies each class minimum (upper, lower, digit, special)", () => {
    for (const [kind, policy] of Object.entries(PASSWORD_POLICY)) {
      const p = generatePassword(kind);
      const upper = (p.match(/[A-Z]/g) || []).length;
      const lower = (p.match(/[a-z]/g) || []).length;
      const digit = (p.match(/[0-9]/g) || []).length;
      // The default special set is "!#$%^&*_?". BGP policy has special=0
      // so we accept any non-alphanumeric remainder.
      const special = (p.match(/[^A-Za-z0-9]/g) || []).length;
      expect(upper,   `${kind} upper`).toBeGreaterThanOrEqual(policy.classes.upper);
      expect(lower,   `${kind} lower`).toBeGreaterThanOrEqual(policy.classes.lower);
      expect(digit,   `${kind} digit`).toBeGreaterThanOrEqual(policy.classes.digit);
      expect(special, `${kind} special`).toBeGreaterThanOrEqual(policy.classes.special);
    }
  });

  it("BGP peer passwords are alphanumeric only (router-friendly)", () => {
    for (let i = 0; i < 5; i++) {
      const p = generatePassword("bgp-peer");
      expect(p).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("characters are shuffled across positions (not class-grouped)", () => {
    // Each policy fills classes in order (upper, lower, digit, special)
    // BEFORE shuffling. A working shuffle should put a digit or special
    // somewhere other than the last quarter of the password the majority
    // of the time. Run 20 trials; expect at least 15 to have a digit
    // outside the canonical "last quarter" position.
    let shuffledCount = 0;
    for (let i = 0; i < 20; i++) {
      const p = generatePassword("vcenter-root");
      const halfPoint = p.length / 2;
      const firstHalf = p.slice(0, halfPoint);
      if (/[0-9]/.test(firstHalf) || /[^A-Za-z0-9]/.test(firstHalf)) shuffledCount++;
    }
    expect(shuffledCount).toBeGreaterThanOrEqual(15);
  });

  it("throws on unknown passwordKind", () => {
    expect(() => generatePassword("not-a-real-kind")).toThrow(/unknown passwordKind/);
  });

  it("produces different passwords on consecutive calls (entropy sanity)", () => {
    const samples = new Set();
    for (let i = 0; i < 50; i++) samples.add(generatePassword("vcenter-root"));
    // 50 independent 16-char passwords should have effectively zero
    // collision probability. >=49 unique is a generous floor.
    expect(samples.size).toBeGreaterThanOrEqual(49);
  });
});

describe("generatePassword — security guarantees", () => {
  it("engine.js's password section uses no non-crypto RNG", () => {
    // Read the engine source and confirm the literal token "Math.random"
    // doesn't appear anywhere in the password section. This is a
    // regression guard against a future contributor accidentally
    // swapping crypto.getRandomValues for a non-CSPRNG. The engine code
    // also avoids the literal token in comments/error strings (see
    // _resolveCrypto's docstring) so this is a hard assertion.
    const enginePath = path.resolve(__dirname, "../../engine.js");
    const src = fs.readFileSync(enginePath, "utf8");
    const start = src.indexOf("PASSWORD GENERATION (Plan 13");
    const end = src.indexOf("parseWorkbookCellMap", start);
    expect(start, "PASSWORD GENERATION section must exist").toBeGreaterThan(0);
    expect(end, "section must close before parseWorkbookCellMap").toBeGreaterThan(start);
    const section = src.slice(start, end);
    expect(section).not.toMatch(/Math\.random/);
  });

  it("requires crypto.getRandomValues — throws when crypto is absent", () => {
    // Verify the resolver throws when no crypto is available. Patch
    // globalThis temporarily so we can simulate a crypto-less environment.
    const originalCrypto = globalThis.crypto;
    delete globalThis.crypto;
    try {
      expect(() => generatePassword("vcenter-root")).toThrow(/crypto\.getRandomValues is not available/);
    } finally {
      globalThis.crypto = originalCrypto;
    }
  });
});

describe("generateWorkbookVault — output", () => {
  it("returns { passwords: Map, vault: object } with matching counts", () => {
    const fleet = newFleet();
    const { passwords, vault } = generateWorkbookVault(fleet);
    expect(passwords).toBeInstanceOf(Map);
    expect(typeof vault).toBe("object");
    expect(vault.credentials.length).toBe(passwords.size);
    expect(vault.totalPasswords).toBe(vault.credentials.length);
  });

  it("includes workbookVersion + generatedAt + fleetName + scope in the header", () => {
    const fleet = newFleet();
    fleet.name = "MyFleet";
    const { vault } = generateWorkbookVault(fleet);
    expect(vault.workbookVersion).toBe("9.1");
    expect(typeof vault.generatedAt).toBe("string");
    expect(vault.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(vault.fleetName).toBe("MyFleet");
    expect(vault.scope).toBe("all");
    expect(vault.$comment).toMatch(/Save to your password manager/i);
  });

  it("each credential has a sane shape (cellAddress, sheet, cell, label, password, complexityRule)", () => {
    const fleet = newFleet();
    const { vault } = generateWorkbookVault(fleet);
    expect(vault.credentials.length).toBeGreaterThan(0);
    for (const c of vault.credentials) {
      expect(c.cellAddress).toMatch(/^[A-Za-z & ]+![A-Z]+\d+$/);
      expect(typeof c.sheet).toBe("string");
      expect(typeof c.cell).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(typeof c.password).toBe("string");
      expect(c.password.length).toBe(c.complexityRule.len);
      expect(c.credentialType in PASSWORD_POLICY).toBe(true);
    }
  });

  it("credentials are sorted by (sheet, cell) for stable output", () => {
    const fleet = newFleet();
    const { vault } = generateWorkbookVault(fleet);
    for (let i = 1; i < vault.credentials.length; i++) {
      const prev = vault.credentials[i - 1];
      const cur  = vault.credentials[i];
      if (prev.sheet === cur.sheet) {
        // Same sheet — cell address should come after lexically/numerically
        const prevRow = parseInt(prev.cell.match(/\d+/)[0], 10);
        const curRow  = parseInt(cur.cell.match(/\d+/)[0], 10);
        const prevCol = prev.cell.match(/^[A-Z]+/)[0];
        const curCol  = cur.cell.match(/^[A-Z]+/)[0];
        const order = prevCol === curCol ? (prevRow - curRow) : prevCol.localeCompare(curCol);
        expect(order).toBeLessThanOrEqual(0);
      } else {
        expect(prev.sheet.localeCompare(cur.sheet)).toBeLessThan(0);
      }
    }
  });

  it("'camp-b' scope returns only Camp B passwords (user-required, not auto-gen-coverable)", () => {
    const fleet = newFleet();
    const { vault } = generateWorkbookVault(fleet, { scope: "camp-b" });
    // vsan-witness-root is part of Camp B in concept but has no workbook
    // input cell today (formula-derived) — so it doesn't show up in vault.
    const allowed = new Set([
      "esx-root", "encryption-passphrase",
      "bgp-peer", "sso-admin", "sso-user",
    ]);
    expect(vault.credentials.length).toBeGreaterThan(0);
    for (const c of vault.credentials) {
      expect(allowed.has(c.credentialType), `unexpected ${c.credentialType} in camp-b`).toBe(true);
    }
  });

  it("'skip-bgp' scope omits BGP peer passwords but keeps everything else", () => {
    const fleet = newFleet();
    const all = generateWorkbookVault(fleet, { scope: "all" });
    const noBgp = generateWorkbookVault(fleet, { scope: "skip-bgp" });
    expect(noBgp.passwords.size).toBeLessThan(all.passwords.size);
    for (const c of noBgp.vault.credentials) {
      expect(c.credentialType).not.toBe("bgp-peer");
    }
    const diff = all.passwords.size - noBgp.passwords.size;
    expect(diff).toBeGreaterThan(0); // confirms at least one BGP peer existed
  });

  it("generates passwords for 9.0 fleets (cellByVersion override paths)", () => {
    const fleet = newFleet();
    fleet.vcfVersion = "9.0";
    const { vault } = generateWorkbookVault(fleet);
    expect(vault.workbookVersion).toBe("9.0");
    // Each credential's cell should reference the 9.0 address, not the
    // 9.1 one. e.g. ESX root is L127 in 9.0 / L81 in 9.1.
    const esxRoot = vault.credentials.find((c) => c.credentialType === "esx-root");
    expect(esxRoot.cell).toBe("L127");
  });

  it("generates passwords for 9.1 fleets via cellByVersion overrides", () => {
    const fleet = newFleet();
    fleet.vcfVersion = "9.1";
    const { vault } = generateWorkbookVault(fleet);
    expect(vault.workbookVersion).toBe("9.1");
    const esxRoot = vault.credentials.find((c) => c.credentialType === "esx-root");
    expect(esxRoot.cell).toBe("L81");
  });

  it("two consecutive vault generations produce different passwords (idempotency by design IS unwanted)", () => {
    const fleet = newFleet();
    const a = generateWorkbookVault(fleet);
    const b = generateWorkbookVault(fleet);
    // Find a shared cell address and confirm the passwords differ. The
    // plan explicitly forbids stable regeneration so users can't
    // accidentally overwrite their vault by re-exporting.
    for (const [cell, pw] of a.passwords.entries()) {
      if (b.passwords.has(cell)) {
        expect(b.passwords.get(cell)).not.toBe(pw);
        return;
      }
    }
    throw new Error("expected at least one shared cell address between two vault generations");
  });
});

describe("emitWorkbookCellMap — password cells are skipped from default export", () => {
  it("regular emit returns NO password cells (passwordKind entries excluded)", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    // Reject any row whose underlying cell-map entry carries a passwordKind.
    const passwordCellAddresses = new Set();
    for (const e of WORKBOOK_CELL_MAP) {
      if (!e.passwordKind) continue;
      const cell = (e.cellByVersion && e.cellByVersion["9.1"]) || e.cell;
      passwordCellAddresses.add(`${e.sheet}!${cell}`);
    }
    for (const r of rows) {
      const key = `${r.sheet}!${r.cell}`;
      expect(passwordCellAddresses.has(key), `password cell ${key} leaked into regular emit`).toBe(false);
    }
  });

  it("emit DOES include the 5 auto-generate toggle cells set to 'Selected'", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const toggles = rows.filter((r) => /^Auto[- ]?generate/i.test(r.label));
    // 5 toggles defined across the cell-map; scope filtering only emits
    // those whose context exists on the default newFleet (instance +
    // workload-domain when WLD present + workload-cluster).
    // Default fleet has no WLD, so only instance-scope toggles emit (2:
    // L296 + D152).
    expect(toggles.length).toBeGreaterThanOrEqual(2);
    for (const t of toggles) expect(t.value).toBe("Selected");
  });

  it("all 5 auto-generate toggles emit 'Selected' when fleet has a workload domain", () => {
    // Adding a WLD activates the workload-domain + workload-cluster
    // scopes that the 3 WLD-side toggles depend on. With one WLD all 5
    // toggle resolves should fire.
    const { newWorkloadDomain, newWorkloadCluster } = VcfEngine;
    const fleet = newFleet();
    const wld = newWorkloadDomain("Test WLD");
    wld.clusters = [newWorkloadCluster("wld-cl01")];
    fleet.instances[0].domains.push(wld);
    const rows = emitWorkbookCellMap(fleet);
    const toggles = rows.filter((r) => /^Auto[- ]?generate/i.test(r.label));
    expect(toggles.length).toBe(5);
    for (const t of toggles) expect(t.value).toBe("Selected");
  });
});

describe("WORKBOOK_CELL_MAP — passwordKind entries are well-formed", () => {
  it("every passwordKind references a defined PASSWORD_POLICY", () => {
    for (const e of WORKBOOK_CELL_MAP) {
      if (!e.passwordKind) continue;
      expect(PASSWORD_POLICY[e.passwordKind], `${e.label}: passwordKind "${e.passwordKind}" not in PASSWORD_POLICY`).toBeDefined();
    }
  });

  it("every passwordKind entry is also tagged emitOnly: true (defense in depth)", () => {
    for (const e of WORKBOOK_CELL_MAP) {
      if (!e.passwordKind) continue;
      expect(e.emitOnly, `${e.label}: passwordKind entries must be emitOnly`).toBe(true);
    }
  });

  it("no passwordKind entry has an apply() function (round-trip is via vault, not import)", () => {
    for (const e of WORKBOOK_CELL_MAP) {
      if (!e.passwordKind) continue;
      expect(typeof e.apply, `${e.label}: passwords MUST NOT round-trip into the studio`).not.toBe("function");
    }
  });

  it("every passwordKind entry's resolve returns the empty string (placeholder confirmed)", () => {
    // Password values come from generateWorkbookVault, not from the cell-
    // map's resolve. Each passwordKind entry carries a `resolve: () => ""`
    // placeholder so the cell-map schema invariant holds. Confirm each
    // one returns "" — guards against a future contributor accidentally
    // putting a password literal in resolve and leaking it into the
    // regular emit path.
    for (const e of WORKBOOK_CELL_MAP) {
      if (!e.passwordKind) continue;
      expect(typeof e.resolve, `${e.label} needs a resolve fn`).toBe("function");
      // Call with a minimal mock context (resolves don't use it for these
      // emit-only password placeholders).
      const result = e.resolve(newFleet(), { instance: { name: "x" }, domain: { name: "y" }, cluster: { name: "z" } }, 0);
      expect(result, `${e.label}.resolve() must return ""`).toBe("");
    }
  });

  it("at least one cell-map entry exists per Camp B credential kind that has a workbook input cell", () => {
    // Camp B = passwords VCF auto-gen can't cover; user must supply. Of
    // those, vsan-witness-root has no workbook user-input cell (the
    // vsan_witness_root_password cells are formula-derived and the
    // witness root password is set during OVA bootstrap, not via the
    // workbook). The other 5 must have at least one cell-map entry.
    const campBWithCells = ["esx-root", "encryption-passphrase", "bgp-peer", "sso-admin", "sso-user"];
    for (const kind of campBWithCells) {
      const found = WORKBOOK_CELL_MAP.some((e) => e.passwordKind === kind);
      expect(found, `no cell-map entry covers Camp B kind "${kind}"`).toBe(true);
    }
  });
});
