#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// audit-cell-map-gaps.mjs — finds cells in the pristine workbook that are
// NOT yet covered by WORKBOOK_CELL_MAP. Inverse of verify-cell-map.mjs.
//
// Filters out formula cells (not stampable), workbook-derived sample cells
// in columns K and C, and password / vault cells (vault flow, not cell-map).
//
// Output groups un-mapped user-input cells by sheet and shows runs of
// consecutive rows (trailing blocks / large gaps).
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const VcfEngine = require(path.join(ROOT, "engine.js"));

const FIXTURE_PATHS = {
  "9.0": path.join(ROOT, "test-fixtures", "workbook", "workbook-cell-meta-9.0.json"),
  "9.1": path.join(ROOT, "test-fixtures", "workbook", "workbook-cell-meta-9.1.json"),
};

function loadFixture(version) {
  return JSON.parse(fs.readFileSync(FIXTURE_PATHS[version], "utf8"));
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

function buildMappedSet(version) {
  const mapped = new Set();
  for (const entry of VcfEngine.WORKBOOK_CELL_MAP) {
    if (!entry.workbookVersions.includes(version)) continue;
    const expandsTo = entry.expandsTo || 1;
    for (let i = 0; i < expandsTo; i++) {
      const cell = resolveCell(entry, version, i);
      mapped.add(`${entry.sheet}|${cell}`);
    }
  }
  return mapped;
}

function parseCell(addr) {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) return null;
  return { col: m[1], row: parseInt(m[2], 10) };
}

function audit(version) {
  const fix = loadFixture(version);
  const mapped = buildMappedSet(version);

  // Universe: only the "user input column" cells, i.e. column L on Deploy
  // sheets, column D on Configure sheets. Other columns are labels (B/C)
  // or sample/formula (K/C). We restrict to L and D here.
  const candidates = [];
  for (const e of fix.entries) {
    const p = parseCell(e.cell);
    if (!p) continue;
    if (p.col !== "L" && p.col !== "D") continue;
    // Skip formula cells — not stampable, workbook derives them.
    if (e.dataType === "f") continue;
    // Skip if already mapped.
    if (mapped.has(`${e.sheet}|${e.cell}`)) continue;
    candidates.push(e);
  }

  // Group by sheet.
  const bySheet = new Map();
  for (const e of candidates) {
    if (!bySheet.has(e.sheet)) bySheet.set(e.sheet, []);
    bySheet.get(e.sheet).push(e);
  }

  console.log(`\n=== Un-mapped user-input (col L/D) cells in workbook ${version} ===`);
  for (const [sheet, items] of bySheet) {
    console.log(`\n--- ${sheet} (${items.length} un-mapped cells) ---`);
    // Sort by column then row.
    items.sort((a, b) => {
      const pa = parseCell(a.cell), pb = parseCell(b.cell);
      if (pa.col !== pb.col) return pa.col.localeCompare(pb.col);
      return pa.row - pb.row;
    });
    // Group consecutive rows for compact display.
    let prevRow = -2, prevCol = "";
    let runStart = -1, runItems = [];
    const flushRun = () => {
      if (runItems.length === 0) return;
      const start = runItems[0], end = runItems[runItems.length - 1];
      if (runItems.length === 1) {
        console.log(`  ${start.cell.padEnd(6)} ${JSON.stringify(start.labelText || "")}`);
      } else {
        console.log(`  ${start.cell}–${end.cell} (${runItems.length} cells)`);
        for (const it of runItems) {
          console.log(`    ${it.cell.padEnd(6)} ${JSON.stringify(it.labelText || "")}`);
        }
      }
      runItems = [];
    };
    for (const it of items) {
      const p = parseCell(it.cell);
      if (p.col === prevCol && p.row === prevRow + 1) {
        runItems.push(it);
      } else {
        flushRun();
        runItems = [it];
      }
      prevCol = p.col;
      prevRow = p.row;
    }
    flushRun();
  }
  console.log(`\nTotal un-mapped (col L/D, non-formula) in ${version}: ${candidates.length}`);
}

for (const v of VcfEngine.SUPPORTED_WORKBOOK_VERSIONS) audit(v);
