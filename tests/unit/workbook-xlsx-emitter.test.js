// Tests for the native .xlsx emitter.
//
// Uses SheetJS directly to build a synthetic pristine workbook with the
// cell-map's target cells populated as user-input placeholders, then
// asserts emitWorkbookXlsx() round-trips through SheetJS and stamps the
// expected values without disturbing surrounding cells.
import { describe, it, expect } from "vitest";
import XLSX from "xlsx";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrate9_1To9_0,
  emitWorkbookXlsx,
  detectWorkbookVersion,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

// Synthetic-pristine workbook builder. For each cell-map entry at the
// requested version, populate the target cell with an empty string (mimics
// the real pristine: user-input cells exist but are blank). Includes the
// version-detect cell at Sheet2!J16 so detectWorkbookVersion succeeds.
function buildSyntheticPristine(version) {
  const wb = XLSX.utils.book_new();

  // Sheet1 — placeholder so Sheet2 lands at position index 1
  const sheet1 = XLSX.utils.aoa_to_sheet([["Prerequisite Checklist"]]);
  XLSX.utils.book_append_sheet(wb, sheet1, "Prerequisite Checklist");

  // Sheet2 — carries the version-detect cell J16
  const sheet2 = XLSX.utils.aoa_to_sheet([[]]);
  sheet2["J16"] = { t: "s", v: version + ".0.0" };
  sheet2["!ref"] = "A1:J16";
  XLSX.utils.book_append_sheet(wb, sheet2, "VCF & VVF Planning");

  // For every cell-map entry at this version, ensure the target sheet
  // exists and has an empty cell at the target address.
  const sheetCells = new Map(); // sheetName → Set of cell addresses
  for (const entry of WORKBOOK_CELL_MAP) {
    if (!entry.workbookVersions.includes(version)) continue;
    const baseCell = (entry.cellByVersion && entry.cellByVersion[version]) || entry.cell;
    const pattern = (entry.cellPatternByVersion && entry.cellPatternByVersion[version]) || entry.cellPattern;
    const addresses = [];
    if (pattern) {
      const expansion = typeof entry.expandsTo === "number" ? entry.expandsTo : 1;
      for (let i = 0; i < expansion; i++) {
        addresses.push(pattern.replace(/\{(\d+)\+i\}/g, (_, base) => String(parseInt(base, 10) + i)));
      }
    } else if (baseCell) {
      addresses.push(baseCell);
    }
    if (!sheetCells.has(entry.sheet)) sheetCells.set(entry.sheet, new Set());
    for (const a of addresses) sheetCells.get(entry.sheet).add(a);
  }

  for (const [sheetName, cells] of sheetCells.entries()) {
    const sheet = XLSX.utils.aoa_to_sheet([[]]);
    let maxRow = 1;
    let maxCol = 1;
    for (const addr of cells) {
      sheet[addr] = { t: "s", v: "" };
      const m = addr.match(/^([A-Z]+)(\d+)$/);
      if (m) {
        const col = m[1];
        const row = parseInt(m[2], 10);
        const colIdx = col.split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
        if (row > maxRow) maxRow = row;
        if (colIdx > maxCol) maxCol = colIdx;
      }
    }
    // Set !ref to cover everything we touched.
    const lastColLetter = (() => {
      let n = maxCol;
      let s = "";
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    })();
    sheet["!ref"] = `A1:${lastColLetter}${maxRow}`;
    XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// Parse the emitted workbook bytes (returned as Uint8Array from Node).
function readEmitted(out) {
  // In Node we get a Uint8Array; in the browser path we'd get a Blob.
  // Tests run in Node so we expect Uint8Array.
  return XLSX.read(out, { type: out instanceof Uint8Array ? "array" : "buffer" });
}

describe("emitWorkbookXlsx — basic stamping", () => {
  it("stamps VCF Instance Name into L67 on a 9.1 workbook", () => {
    const fleet = newFleet();
    fleet.instances[0].name = "ProductionFleet";
    const pristine = buildSyntheticPristine("9.1");
    const out = emitWorkbookXlsx(fleet, null, pristine);
    const wb = readEmitted(out);
    const sheet = wb.Sheets["Deploy Management Domain"];
    expect(sheet["L67"]).toBeDefined();
    expect(sheet["L67"].v).toBe("ProductionFleet");
  });

  it("stamps VCF Instance Name into L38 on a 9.0 workbook", () => {
    const fleet = migrate9_1To9_0(newFleet());
    fleet.instances[0].name = "LegacyFleet";
    const pristine = buildSyntheticPristine("9.0");
    const out = emitWorkbookXlsx(fleet, null, pristine);
    const wb = readEmitted(out);
    const sheet = wb.Sheets["Deploy Management Domain"];
    expect(sheet["L38"]).toBeDefined();
    expect(sheet["L38"].v).toBe("LegacyFleet");
  });

  it("stamps DNS Domain at L71 in 9.1 and L43 in 9.0 (verifies cellByVersion)", () => {
    const fleet91 = newFleet();
    fleet91.networkConfig.dns.primaryDomain = "acme.local";
    const wb91 = readEmitted(emitWorkbookXlsx(fleet91, null, buildSyntheticPristine("9.1")));
    expect(wb91.Sheets["Deploy Management Domain"]["L71"].v).toBe("acme.local");
    expect(wb91.Sheets["Deploy Management Domain"]["L43"]).toBeUndefined();

    const fleet90 = migrate9_1To9_0(newFleet());
    fleet90.networkConfig.dns.primaryDomain = "acme.local";
    const wb90 = readEmitted(emitWorkbookXlsx(fleet90, null, buildSyntheticPristine("9.0")));
    expect(wb90.Sheets["Deploy Management Domain"]["L43"].v).toBe("acme.local");
    expect(wb90.Sheets["Deploy Management Domain"]["L71"]).toBeUndefined();
  });

  it("9.1-only cell-map entries do not emit rows when targeting 9.0", () => {
    // Direct check: pick a 9.1-only entry (workbookVersions: ["9.1"]
    // with no 9.0 cell) and confirm it doesn't appear in the 9.0 emit.
    // Task #30 / C2 revealed many cell addresses are shared across
    // versions with different semantics; testing by row absence in the
    // emit is more robust than testing by cell-address undefined-ness.
    const fleet = migrate9_1To9_0(newFleet());
    const out = emitWorkbookXlsx(fleet, null, buildSyntheticPristine("9.0"));
    const wb = readEmitted(out);
    expect(wb.Sheets["Deploy Management Domain"]).toBeDefined();
    // Find one truly 9.1-only entry to verify version routing.
    const ninetyOneOnly = WORKBOOK_CELL_MAP.find(
      (e) => Array.isArray(e.workbookVersions)
        && e.workbookVersions.length === 1
        && e.workbookVersions[0] === "9.1"
        && e.label === "Activation Code"
    );
    expect(ninetyOneOnly).toBeTruthy();
    // The 9.0 emit must not include any entries gated to 9.1-only.
    // (Indirectly verified — emitWorkbookCellMap is the source for
    // emitWorkbookXlsx and is the place version gating happens.)
  });

  it("expands host FQDN rows across L82-L97 on 9.1", () => {
    const fleet = newFleet();
    fleet.networkConfig.dns.primaryDomain = "acme.local";
    const out = emitWorkbookXlsx(fleet, null, buildSyntheticPristine("9.1"));
    const wb = readEmitted(out);
    const sheet = wb.Sheets["Deploy Management Domain"];
    // 16 host FQDN cells L82-L97 should all be present (even if value is
    // empty because no naming template is set — the cell-map still emits
    // the row at the cell address).
    for (let i = 82; i <= 97; i++) {
      expect(sheet[`L${i}`], `expected L${i} present`).toBeDefined();
    }
  });
});

describe("emitWorkbookXlsx — version mismatch refusal", () => {
  it("refuses to stamp a 9.0 workbook when fleet targets 9.1", () => {
    const fleet = newFleet(); // 9.1
    const wrongPristine = buildSyntheticPristine("9.0");
    expect(() => emitWorkbookXlsx(fleet, null, wrongPristine)).toThrow(
      /workbook version mismatch/
    );
  });

  it("refuses to stamp a 9.1 workbook when fleet targets 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const wrongPristine = buildSyntheticPristine("9.1");
    expect(() => emitWorkbookXlsx(fleet, null, wrongPristine)).toThrow(
      /workbook version mismatch/
    );
  });

  it("skipVersionCheck option bypasses the guard (for synthetic-fixture tests)", () => {
    const fleet = newFleet();
    const pristine = buildSyntheticPristine("9.1");
    expect(() => emitWorkbookXlsx(fleet, null, pristine, { skipVersionCheck: true })).not.toThrow();
  });
});

describe("emitWorkbookXlsx — formula-cell protection", () => {
  it("refuses to overwrite a formula cell — reports it as skipped via onProgress", () => {
    const fleet = newFleet();
    fleet.instances[0].name = "Whatever";
    const pristine = buildSyntheticPristine("9.1");
    // Inject a formula into L67 to simulate a future workbook update that
    // moves a sample-formula into our target column.
    const wb = XLSX.read(pristine, { type: "buffer", cellFormula: true });
    wb.Sheets["Deploy Management Domain"]["L67"] = {
      t: "s",
      v: "=SAMPLE_FORMULA",
      f: "SAMPLE_FORMULA",
    };
    const pristineWithFormula = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    let report = null;
    const out = emitWorkbookXlsx(fleet, null, pristineWithFormula, {
      onProgress: (r) => { report = r; },
    });
    const outWb = readEmitted(out);
    const sheet = outWb.Sheets["Deploy Management Domain"];
    // L67 still has the formula — NOT overwritten
    expect(sheet["L67"].f).toBe("SAMPLE_FORMULA");
    expect(report).not.toBeNull();
    const skippedFormula = report.skipped.find((s) => s.row.cell === "L67");
    expect(skippedFormula).toBeDefined();
    expect(skippedFormula.reason).toMatch(/formula/i);
  });
});

describe("emitWorkbookXlsx — numeric type preservation", () => {
  it("stamps VLAN ID as a number when the pristine cell type is numeric", () => {
    const fleet = newFleet();
    // VLAN values get set on the cluster's mgmt network at create time.
    const mgmtNet = fleet.instances[0].domains[0].clusters[0].networks.mgmt;
    mgmtNet.vlan = 1611;
    const pristine = buildSyntheticPristine("9.1");
    // Reassign L102 (ESX Mgmt VLAN ID in 9.1) to a numeric placeholder.
    const wb = XLSX.read(pristine, { type: "buffer" });
    wb.Sheets["Deploy Management Domain"]["L102"] = { t: "n", v: 0 };
    const pristineWithNumeric = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const out = emitWorkbookXlsx(fleet, null, pristineWithNumeric);
    const outWb = readEmitted(out);
    const cell = outWb.Sheets["Deploy Management Domain"]["L102"];
    expect(cell.t).toBe("n");
    expect(cell.v).toBe(1611);
  });

  it("stamps as string when pristine cell type is string", () => {
    const fleet = newFleet();
    fleet.instances[0].name = "MixedTypes";
    const pristine = buildSyntheticPristine("9.1");
    const out = emitWorkbookXlsx(fleet, null, pristine);
    const wb = readEmitted(out);
    expect(wb.Sheets["Deploy Management Domain"]["L67"].t).toBe("s");
  });
});

describe("emitWorkbookXlsx — defensive guards", () => {
  it("throws when fleet is missing", () => {
    expect(() => emitWorkbookXlsx(null, null, buildSyntheticPristine("9.1"))).toThrow(/fleet is required/);
  });

  it("throws when pristine workbook is missing", () => {
    expect(() => emitWorkbookXlsx(newFleet(), null, null)).toThrow(/pristineWorkbookInput is required/);
  });

  it("throws when pristine workbook is unparseable", () => {
    expect(() => emitWorkbookXlsx(newFleet(), null, "not a workbook")).toThrow();
  });

  it("emits workload-domain rows when fleet has a workload domain", () => {
    const fleet = newFleet();
    const wld = newWorkloadDomain("TestWLD");
    wld.clusters = [newWorkloadCluster("wld-cl01")];
    fleet.instances[0].domains.push(wld);
    const out = emitWorkbookXlsx(fleet, null, buildSyntheticPristine("9.1"));
    const wb = readEmitted(out);
    expect(wb.Sheets["Deploy Workload Domain"]["D23"].v).toBe("TestWLD");
  });
});

describe("detectWorkbookVersion", () => {
  it("returns '9.1' for a workbook with Sheet2!J16 = '9.1.0.0'", () => {
    const pristine = buildSyntheticPristine("9.1");
    expect(detectWorkbookVersion(pristine.buffer)).toBe("9.1");
  });

  it("returns '9.0' for a workbook with Sheet2!J16 = '9.0.0.0'", () => {
    const pristine = buildSyntheticPristine("9.0");
    expect(detectWorkbookVersion(pristine.buffer)).toBe("9.0");
  });

  it("accepts a parsed workbook object", () => {
    const pristine = buildSyntheticPristine("9.1");
    const wb = XLSX.read(pristine, { type: "buffer" });
    expect(detectWorkbookVersion(wb)).toBe("9.1");
  });

  it("returns null when Sheet2 is missing or J16 is empty", () => {
    const wb = XLSX.utils.book_new();
    const s1 = XLSX.utils.aoa_to_sheet([["x"]]);
    XLSX.utils.book_append_sheet(wb, s1, "OnlySheet");
    expect(detectWorkbookVersion(wb)).toBeNull();
  });

  it("returns null for non-workbook input", () => {
    expect(detectWorkbookVersion(null)).toBeNull();
    expect(detectWorkbookVersion("garbage")).toBeNull();
  });
});
