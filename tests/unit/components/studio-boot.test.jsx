// @vitest-environment jsdom
//
// M2.2 — VcfFleetSizer boot smoke (real-studio component test).
//
// Proves the JSDOM + RTL setup can render the studio's actual top-
// level component, not just isolated test fixtures. This is the
// foundation that future component tests (clone buttons, undo/redo,
// validation panel, AZ2 panel, etc.) will build on.
//
// Mechanism:
//   1. Import engine.js (ESM) and attach it to globalThis.window.
//      VcfEngine. The studio .jsx has a runtime fallback at line ~141:
//      `typeof window !== "undefined" ? window.VcfEngine : require(...)`.
//      In the jsdom env, window IS defined, so the window-attached
//      path is taken — same code path as the browser.
//   2. Dynamically import the .jsx (after window.VcfEngine is set).
//      The .jsx is the actual production source — same file the build
//      pipeline (scripts/build-html.mjs) stitches into the shipped HTML.
//   3. Render VcfFleetSizer and assert recognizable chrome appears.
//
// This intentionally does NOT test deep app behavior — that belongs in
// focused tests for each editor workflow (clone, undo/redo, AZ2 panel).
// The job here is to validate the infrastructure end-to-end so the
// follow-up component tests can land cheaply.

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import VcfEngine from "../../../engine.js";

let VcfFleetSizer;

beforeAll(async () => {
  // Attach the engine to window BEFORE importing the .jsx — the .jsx
  // destructures from window.VcfEngine at module-load time.
  window.VcfEngine = VcfEngine;
  // SheetJS — the studio's xlsx import/export code paths reference it,
  // though the boot smoke shouldn't touch the .xlsx surface. Stub the
  // module-level XLSX global so the .jsx doesn't ReferenceError on
  // module evaluation.
  globalThis.XLSX = globalThis.XLSX || { read: () => ({}), write: () => "", utils: { sheet_to_json: () => [] } };
  const mod = await import("../../../vcf-design-studio-v9.jsx");
  VcfFleetSizer = mod.default;
});

describe("M2.2 — VcfFleetSizer boots in jsdom", () => {
  it("imports the studio .jsx without throwing", () => {
    expect(typeof VcfFleetSizer).toBe("function");
  });

  it("renders without crashing and produces visible chrome", () => {
    render(<VcfFleetSizer />);
    // The studio has a tab strip + cluster cards + top bar. Any
    // recognizable user-facing text proves render succeeded. We pick
    // text that's unlikely to change with feature work.
    // Use queryAllByText to tolerate multiple occurrences (e.g. the
    // "VCF" prefix appears in many headers / labels).
    const candidates = screen.queryAllByText(/VCF/i);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
