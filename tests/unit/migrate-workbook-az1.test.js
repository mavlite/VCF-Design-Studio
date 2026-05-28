// Smoke test for scripts/migrate-workbook-az1.mjs.
//
// The migrator bridges OLD-format workbook CSVs (stamped with AZ1
// mgmt/workload/additional-cluster vMotion/vSAN/hostTep at the
// pre-refactor cell positions) to NEW-format CSVs that the current
// engine.js's importWorkbookCellMap can consume.
//
// Strategy under test:
//   1. Build a fleet with configured AZ1 networks
//   2. Stamp it using the OLD engine (loaded via git show) → OLD-format CSV
//   3. Run migrateCsv() → NEW-format CSV
//   4. Parse + import NEW-format CSV with NEW engine → rebuilt fleet
//   5. Assert that the AZ1 network values survived the round-trip
//
// This proves the model-driven migration approach works end-to-end.

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { Module } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrateCsv } from "../../scripts/migrate-workbook-az1.mjs";
import VcfEngine from "../../engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const { parseWorkbookCellMap, importWorkbookCellMap } = VcfEngine;

// OLD engine is loaded lazily in beforeAll. Loading at module top
// level via Module._compile of git-show output isn't vitest-loader-
// friendly (surfaces as an opaque SyntaxError with no location).
let oldEngine;
beforeAll(() => {
  const oldSrc = execSync(`git -C "${ROOT}" show pre-az1-relocation:engine.js`).toString();
  const mod = new Module("old-engine");
  mod.filename = path.join(ROOT, "engine.js");
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(oldSrc, mod.filename);
  oldEngine = mod.exports;
});

function mgmtCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
}

describe("migrate-workbook-az1 — end-to-end migration", () => {
  it("preserves mgmt-cluster vMotion across OLD→NEW for 9.0", () => {
    const original = oldEngine.newFleet();
    original.vcfVersion = "9.0";
    const c = mgmtCluster(original);
    c.networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };

    const oldCsv = oldEngine.emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { csv: newCsv, version } = migrateCsv(oldCsv, { workbookVersion: "9.0" });
    expect(version).toBe("9.0");

    const rebuilt = importWorkbookCellMap(parseWorkbookCellMap(newCsv), { workbookVersion: "9.0" }).fleet;
    const back = mgmtCluster(rebuilt).networks.vmotion;
    expect(back.vlan).toBe(1612);
    expect(back.subnet).toBe("10.0.12.0/24");
    expect(back.gateway).toBe("10.0.12.1");
    expect(back.pool.start).toBe("10.0.12.100");
    expect(back.pool.end).toBe("10.0.12.116");
    expect(back.mtu).toBe(9000);
  });

  it("preserves mgmt-cluster vMotion across OLD→NEW for 9.1", () => {
    const original = oldEngine.newFleet();
    original.vcfVersion = "9.1";
    const c = original.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
    c.networks.vmotion = {
      vlan: 1622, subnet: "10.0.22.0/24", gateway: "10.0.22.1",
      pool: { start: "10.0.22.100", end: "10.0.22.116" }, mtu: 9000,
    };

    const oldCsv = oldEngine.emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { csv: newCsv } = migrateCsv(oldCsv, { workbookVersion: "9.1" });

    const rebuilt = importWorkbookCellMap(parseWorkbookCellMap(newCsv), { workbookVersion: "9.1" }).fleet;
    const back = mgmtCluster(rebuilt).networks.vmotion;
    expect(back.vlan).toBe(1622);
    expect(back.subnet).toBe("10.0.22.0/24");
    expect(back.gateway).toBe("10.0.22.1");
    expect(back.pool.start).toBe("10.0.22.100");
    expect(back.pool.end).toBe("10.0.22.116");
    expect(back.mtu).toBe(9000);
  });

  it("preserves mgmt-cluster vSAN + Host TEP across OLD→NEW for 9.0", () => {
    const original = oldEngine.newFleet();
    original.vcfVersion = "9.0";
    const c = mgmtCluster(original);
    c.networks.vsan = {
      vlan: 1613, subnet: "10.0.13.0/24", gateway: "10.0.13.1",
      pool: { start: "10.0.13.100", end: "10.0.13.116" }, mtu: 9000,
    };
    c.networks.hostTep = {
      vlan: 1614, subnet: "10.0.14.0/24", gateway: "10.0.14.1",
      pool: { start: "10.0.14.100", end: "10.0.14.116" }, mtu: 1700,
    };

    const oldCsv = oldEngine.emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { csv: newCsv } = migrateCsv(oldCsv, { workbookVersion: "9.0" });

    const rebuilt = importWorkbookCellMap(parseWorkbookCellMap(newCsv), { workbookVersion: "9.0" }).fleet;
    const back = mgmtCluster(rebuilt);
    expect(back.networks.vsan.vlan).toBe(1613);
    expect(back.networks.vsan.subnet).toBe("10.0.13.0/24");
    expect(back.networks.vsan.pool.end).toBe("10.0.13.116");
    expect(back.networks.hostTep.vlan).toBe(1614);
    expect(back.networks.hostTep.subnet).toBe("10.0.14.0/24");
    expect(back.networks.hostTep.pool.end).toBe("10.0.14.116");
  });

  it("produces a non-empty output CSV with row count close to input", () => {
    // Sanity: the model-roundtrip approach should produce a CSV in
    // roughly the same shape as the input (a few rows differ because
    // some old entries were intentionally dropped — Edge TEP, Network
    // Pool Name standalone — and a few new entries were added —
    // AZ2 vMotion/vSAN on Configure sheets).
    const original = oldEngine.newFleet();
    original.vcfVersion = "9.1";
    mgmtCluster(original).networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };
    const oldCsv = oldEngine.emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { csv: newCsv, inputRowCount, outputRowCount } = migrateCsv(oldCsv, { workbookVersion: "9.1" });

    expect(newCsv.length).toBeGreaterThan(0);
    expect(outputRowCount).toBeGreaterThan(0);
    // Output should be within +/- 30% of input row count — the
    // refactor added/removed at most a few dozen entries.
    expect(outputRowCount).toBeGreaterThan(inputRowCount * 0.7);
    expect(outputRowCount).toBeLessThan(inputRowCount * 1.3);
  });

  it("auto-detects version from input CSV when --version is not supplied", () => {
    const original = oldEngine.newFleet();
    original.vcfVersion = "9.0";
    mgmtCluster(original).networks.vmotion = {
      vlan: 1700, subnet: "10.0.70.0/24", gateway: "10.0.70.1",
      pool: { start: "10.0.70.100", end: "10.0.70.116" }, mtu: 9000,
    };
    const oldCsv = oldEngine.emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });

    const result = migrateCsv(oldCsv); // no workbookVersion
    expect(result.version).toBe("9.0");

    const rebuilt = importWorkbookCellMap(parseWorkbookCellMap(result.csv), { workbookVersion: "9.0" }).fleet;
    expect(mgmtCluster(rebuilt).networks.vmotion.vlan).toBe(1700);
  });
});
