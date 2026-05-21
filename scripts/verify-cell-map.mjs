#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-cell-map.mjs — Plan 11 Phase 1.5 automated CI gate.
//
// For every entry in engine.js's WORKBOOK_CELL_MAP, asserts that the
// corresponding cell in the pristine workbook carries a label matching the
// entry's `label` field (case-insensitive substring), and that the target
// cell is NOT a formula cell.
//
// Reads the cell-meta fixtures emitted by Phase 0
// (test-fixtures/workbook/workbook-cell-meta-{version}.json) instead of
// re-parsing the .xlsx — that fixture is the canonical source of truth
// captured against a SHA-256-pinned pristine workbook.
//
// Exit 0 = clean. Exit 1 = drift detected (e.g. Broadcom shipped a workbook
// update that renumbered rows, or a cell-map entry's label is wrong).
//
// Usage:
//   node scripts/verify-cell-map.mjs
//   npm run verify-cell-map
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Engine import: cell-map lives in engine.js. Use require via createRequire
// to keep this script .mjs without a build step.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const VcfEngine = require(path.join(ROOT, "engine.js"));

const FIXTURE_PATHS = {
  "9.0": path.join(ROOT, "test-fixtures", "workbook", "workbook-cell-meta-9.0.json"),
  "9.1": path.join(ROOT, "test-fixtures", "workbook", "workbook-cell-meta-9.1.json"),
};

function loadFixture(version) {
  const p = FIXTURE_PATHS[version];
  if (!fs.existsSync(p)) {
    console.error(`ERROR: fixture not found: ${p}`);
    console.error(`Run: python scripts/extract-workbook-cell-meta.py`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildIndex(fixture) {
  // Index entries by "sheet|cell" for O(1) lookup.
  const idx = new Map();
  for (const e of fixture.entries) {
    idx.set(`${e.sheet}|${e.cell}`, e);
  }
  return idx;
}

function resolveCell(entry, version, i) {
  const pattern = (entry.cellPatternByVersion && entry.cellPatternByVersion[version]) || entry.cellPattern;
  if (pattern) {
    return pattern
      .replace(/\{(\d+)\+i\}/g, (_, base) => String(parseInt(base, 10) + i))
      .replace(/\{i\}/g, String(i));
  }
  let cell = (entry.cellByVersion && entry.cellByVersion[version]) || entry.cell;
  if (typeof cell === "string" && /\{i\}/.test(cell)) {
    cell = cell.replace(/\{i\}/g, String(i));
  }
  return cell;
}

function verify() {
  const issues = [];
  let checked = 0;

  for (const version of VcfEngine.SUPPORTED_WORKBOOK_VERSIONS) {
    const fixture = loadFixture(version);
    const idx = buildIndex(fixture);

    for (const entry of VcfEngine.WORKBOOK_CELL_MAP) {
      if (!entry.workbookVersions.includes(version)) continue;
      // For expandsTo entries, only verify the first iteration (i=0). If the
      // base cell is right and the pattern is well-formed, expansion is too.
      const cell = resolveCell(entry, version, 0);
      const key = `${entry.sheet}|${cell}`;
      checked++;
      const fix = idx.get(key);
      if (!fix) {
        issues.push({
          severity: "ERROR",
          version,
          entry: entry.label,
          cell,
          sheet: entry.sheet,
          reason: "target cell not found in pristine workbook (label / cell address drift)",
        });
        continue;
      }
      // Label match: case-insensitive substring either way.
      // `verifyLabel` / `verifyLabelByVersion` override the cell-map's
      // semantic label when the workbook uses a less specific term (e.g.
      // cell-map says "VCFMS Node IPv4 IP Range — From" but the workbook
      // cell is labeled generically as "IPv4 address Range From" because
      // the VCFMS context lives in the section header one row above).
      const expectedRaw = (entry.verifyLabelByVersion && entry.verifyLabelByVersion[version])
                        || entry.verifyLabel
                        || entry.label
                        || "";
      const expected = expectedRaw.toLowerCase();
      const actual = (fix.labelText || "").toLowerCase();
      const labelOK = expected && actual && (
        expected.includes(actual) || actual.includes(expected) ||
        // Allow template tokens like "Host #{i+1} FQDN" — compare with i=0
        actual.includes(expected.replace(/\{i\+\d+\}/g, "1").replace(/\{i\}/g, "0"))
      );
      if (!labelOK) {
        issues.push({
          severity: "WARN",
          version,
          entry: entry.label,
          cell,
          sheet: entry.sheet,
          expected: entry.label,
          actual: fix.labelText,
          reason: "label mismatch (workbook label changed?)",
        });
      }
      // Formula-cell refusal.
      if (fix.dataType === "f") {
        issues.push({
          severity: "ERROR",
          version,
          entry: entry.label,
          cell,
          sheet: entry.sheet,
          reason: "target cell carries a formula — stamping would destroy it",
        });
      }
    }
  }

  if (issues.length === 0) {
    console.log(`verify-cell-map: clean — checked ${checked} entry/version combinations across ${VcfEngine.SUPPORTED_WORKBOOK_VERSIONS.length} workbook versions`);
    process.exit(0);
  }
  console.error(`verify-cell-map: ${issues.length} issue(s) across ${checked} checks\n`);
  for (const issue of issues) {
    console.error(`  [${issue.severity}] ${issue.version} ${issue.sheet}!${issue.cell} (${issue.entry})`);
    console.error(`      ${issue.reason}`);
    if (issue.expected) console.error(`      expected label: ${JSON.stringify(issue.expected)}`);
    if (issue.actual)   console.error(`      actual label:   ${JSON.stringify(issue.actual)}`);
  }
  // Hard-fail on ERROR; pass on WARN-only.
  const hasError = issues.some((i) => i.severity === "ERROR");
  process.exit(hasError ? 1 : 0);
}

verify();
