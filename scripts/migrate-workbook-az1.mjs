#!/usr/bin/env node
// migrate-workbook-az1.mjs — migrates a workbook CSV stamped by a
// VCF Design Studio version PRIOR to the AZ1 cell relocation refactor
// (Task #30, branch refactor/az1-cell-relocation).
//
// Pre-refactor cell positions:
//   - mgmt-cluster AZ1 vMotion/vSAN/hostTep → Configure Management Domain D-cells
//   - workload-cluster AZ1 vMotion/vSAN/hostTep/edgeTep → Configure Workload Domain D-cells
//   - additional-cluster AZ1 vMotion/vSAN/hostTep/edgeTep → Deploy Cluster D281+ (AZ2-designated cells, used incorrectly as AZ1)
//
// Post-refactor cell positions:
//   - mgmt-cluster AZ1 → Deploy Management Domain L148+/L102+
//   - workload-cluster AZ1 → Deploy Workload Domain D58+
//   - additional-cluster AZ1 → Deploy Cluster D24+/D50+/D58+ (AZ1 row range)
//
// Strategy: model-driven roundtrip.
//   1. Load OLD engine via `git show pre-az1-relocation:engine.js`
//      (the rollback-anchor tag captures the prior cell-map).
//   2. Parse the input CSV with OLD engine's WORKBOOK_CELL_MAP →
//      apply to fleet model (values land on cluster.networks.* fields).
//   3. Re-emit via NEW engine's WORKBOOK_CELL_MAP — the same model
//      fields now stamp to the relocated cells.
//
// The model is the canonical interchange — no fragile cell-shape
// conversion table needed. Cell-shape changes (Network + Subnet Mask
// → CIDR Notation; separate Gateway + CIDR → combined gw-CIDR) are
// handled by the engines themselves.
//
// CLI:
//   node scripts/migrate-workbook-az1.mjs <input.csv> [options]
//
// Options:
//   --out <path>     Output path (default: <input>.migrated.csv alongside input)
//   --version <ver>  Workbook version: 9.0 or 9.1 (default: auto-detect from input)
//   --dry-run        Print summary without writing the output file
//   --help, -h       Show this help

import { execSync } from "node:child_process";
import { Module, createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const OLD_ENGINE_TAG = "pre-az1-relocation";

function loadOldEngine() {
  let oldSrc;
  try {
    oldSrc = execSync(`git -C "${ROOT}" show ${OLD_ENGINE_TAG}:engine.js`, {
      stdio: ["pipe", "pipe", "pipe"],
    }).toString();
  } catch (e) {
    throw new Error(
      `cannot load OLD engine via 'git show ${OLD_ENGINE_TAG}:engine.js'.\n` +
      `The migrator requires the '${OLD_ENGINE_TAG}' git tag to be present (rollback anchor at commit 364146e).\n` +
      `If you cloned a fork without tags, run: git fetch --tags origin`
    );
  }
  const mod = new Module("old-engine");
  mod.filename = path.join(ROOT, "engine.js");
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(oldSrc, mod.filename);
  return mod.exports;
}

function loadNewEngine() {
  const require = createRequire(import.meta.url);
  return require("../engine.js");
}

function parseArgs(argv) {
  const args = { input: null, out: null, version: null, dryRun: false, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--version") args.version = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
    else positional.push(a);
  }
  args.input = positional[0];
  return args;
}

function usage() {
  return [
    "Usage: node scripts/migrate-workbook-az1.mjs <input.csv> [options]",
    "",
    "Migrates a workbook CSV stamped by a pre-refactor VCF Design Studio to",
    "the post-refactor cell layout (Task #30 AZ1 cell relocation).",
    "",
    "Options:",
    "  --out <path>      Output CSV path (default: <input>.migrated.csv)",
    "  --version <ver>   Workbook version: 9.0 or 9.1 (default: auto-detect)",
    "  --dry-run         Print summary without writing the output file",
    "  --help, -h        Show this help",
    "",
    `Requires the '${OLD_ENGINE_TAG}' git tag to be present in this repo.`,
  ].join("\n");
}

function detectVersion(csvText) {
  const lines = csvText.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const ver = line.split(",")[0];
    if (ver === "9.0" || ver === "9.1") return ver;
  }
  return null;
}

export function migrateCsv(csvText, { workbookVersion } = {}) {
  const version = workbookVersion || detectVersion(csvText);
  if (version !== "9.0" && version !== "9.1") {
    throw new Error(`could not detect workbook version from CSV; pass workbookVersion explicitly`);
  }
  const oldEngine = loadOldEngine();
  const newEngine = loadNewEngine();

  const parsed = oldEngine.parseWorkbookCellMap(csvText);
  const importResult = oldEngine.importWorkbookCellMap(parsed, { workbookVersion: version });
  const fleet = importResult.fleet;
  const newCsv = newEngine.emitWorkbookCellMapCsv(fleet, null, { workbookVersion: version });

  return {
    csv: newCsv,
    version,
    inputRowCount: parsed.length,
    outputRowCount: newCsv.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("workbookVersion,")).length,
    warnings: importResult.warnings || [],
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  if (args.help || !args.input) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(inputPath, "utf8");
  let result;
  try {
    result = migrateCsv(csvText, { workbookVersion: args.version });
  } catch (e) {
    console.error("ERROR: " + e.message);
    process.exit(1);
  }

  const outPath = args.out
    ? path.resolve(args.out)
    : inputPath.replace(/\.csv$/i, "") + ".migrated.csv";

  console.error(`migrate-workbook-az1 — version ${result.version}`);
  console.error(`  input:  ${inputPath} (${result.inputRowCount} rows)`);
  console.error(`  output: ${outPath} (${result.outputRowCount} rows)`);
  if (result.warnings.length) {
    console.error(`  warnings: ${result.warnings.length}`);
    for (const w of result.warnings.slice(0, 5)) console.error(`    - ${w}`);
    if (result.warnings.length > 5) console.error(`    ... and ${result.warnings.length - 5} more`);
  }

  if (args.dryRun) {
    console.error("(dry-run — not writing output)");
    return;
  }

  fs.writeFileSync(outPath, result.csv, "utf8");
  console.error("done.");
}

// Run main when invoked as a CLI; importers (e.g., tests) get the
// migrateCsv export without triggering the CLI path. Guards against
// undefined process.argv[1] (vitest's loader leaves it unset in some
// modes).
const isCli = process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) main();
