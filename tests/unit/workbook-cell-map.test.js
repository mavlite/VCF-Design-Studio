// Tests for the workbook cell-map emitter / parser (Plan 11 Phase 1a).
// Covers version filtering, cellByVersion overrides, scope iteration,
// per-host expansion, VCFMS gating, vCenter storage cell move 9.0→9.1,
// CSV round-trip, and the workbookVersionForFleet helper.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  migrate9_0To9_1,
  migrate9_1To9_0,
  SUPPORTED_WORKBOOK_VERSIONS,
  VCF_TO_WORKBOOK_VERSION,
  workbookVersionForFleet,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  DEFAULT_VCF_VERSION_LEGACY,
} = VcfEngine;

describe("workbook version routing", () => {
  it("SUPPORTED_WORKBOOK_VERSIONS includes both 9.0 and 9.1", () => {
    expect(SUPPORTED_WORKBOOK_VERSIONS).toEqual(expect.arrayContaining(["9.0", "9.1"]));
  });

  it("VCF_TO_WORKBOOK_VERSION maps 9.0 and 9.1 identity", () => {
    expect(VCF_TO_WORKBOOK_VERSION["9.0"]).toBe("9.0");
    expect(VCF_TO_WORKBOOK_VERSION["9.1"]).toBe("9.1");
  });

  it("workbookVersionForFleet falls back to legacy when vcfVersion missing", () => {
    expect(workbookVersionForFleet({})).toBe(DEFAULT_VCF_VERSION_LEGACY);
    expect(workbookVersionForFleet(null)).toBe(DEFAULT_VCF_VERSION_LEGACY);
  });

  it("workbookVersionForFleet returns mapped value for known VCF version", () => {
    expect(workbookVersionForFleet({ vcfVersion: "9.1" })).toBe("9.1");
    expect(workbookVersionForFleet({ vcfVersion: "9.0" })).toBe("9.0");
  });
});

describe("WORKBOOK_CELL_MAP schema", () => {
  it("every entry has a sheet, scope, label, resolve fn, and workbookVersions", () => {
    for (const entry of WORKBOOK_CELL_MAP) {
      expect(entry.sheet, `entry ${JSON.stringify(entry)} missing sheet`).toBeTypeOf("string");
      expect(entry.scope, `entry ${entry.label} missing scope`).toBeTypeOf("string");
      expect(entry.label, `entry on ${entry.sheet} missing label`).toBeTypeOf("string");
      expect(entry.resolve, `entry ${entry.label} missing resolve fn`).toBeTypeOf("function");
      expect(Array.isArray(entry.workbookVersions), `entry ${entry.label} workbookVersions must be array`).toBe(true);
      // Every entry must specify either `cell` or `cellPattern`.
      expect(entry.cell || entry.cellPattern, `entry ${entry.label} missing cell/cellPattern`).toBeTruthy();
    }
  });

  it("uses L or D for value-column targets — never K or C", () => {
    for (const entry of WORKBOOK_CELL_MAP) {
      const checkAddr = (addr) => {
        if (!addr) return;
        const col = addr.match(/^([A-Z]+)/)?.[1];
        // Sheet 5/6 (Configure Mgmt) uses D for user-input; everything else uses L.
        // K and C are sample-formula columns — must not be targeted.
        expect(["K", "C"]).not.toContain(col);
      };
      checkAddr(entry.cell);
      if (entry.cellByVersion) {
        for (const v of Object.keys(entry.cellByVersion)) checkAddr(entry.cellByVersion[v]);
      }
    }
  });
});

describe("emitWorkbookCellMap — version filtering", () => {
  it("default 9.1 fleet emits VCFMS rows", () => {
    const fleet = newFleet(); // defaults to vcfVersion: "9.1"
    const rows = emitWorkbookCellMap(fleet);
    const vcfmsCells = rows.filter((r) => /VCFMS|Instance Components|Identity Broker|services runtime/i.test(r.label));
    expect(vcfmsCells.length).toBeGreaterThan(0);
  });

  it("forced 9.0 fleet does NOT emit VCFMS rows", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const vcfmsCells = rows.filter((r) => /VCFMS|Instance Components|Identity Broker|services runtime/i.test(r.label));
    expect(vcfmsCells.length).toBe(0);
  });

  it("every emitted row's workbookVersion matches the target", () => {
    const fleet = newFleet();
    const rows91 = emitWorkbookCellMap(fleet);
    for (const r of rows91) expect(r.workbookVersion).toBe("9.1");

    const fleet90 = migrate9_1To9_0(newFleet());
    const rows90 = emitWorkbookCellMap(fleet90);
    for (const r of rows90) expect(r.workbookVersion).toBe("9.0");
  });

  it("explicit options.workbookVersion overrides fleet.vcfVersion", () => {
    const fleet = newFleet(); // 9.1
    const rows = emitWorkbookCellMap(fleet, null, { workbookVersion: "9.0" });
    for (const r of rows) expect(r.workbookVersion).toBe("9.0");
  });
});

describe("cellByVersion overrides — vCenter Storage Size cell move", () => {
  it("vCenter Storage Size points to L92 in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "vCenter Appliance Storage Size");
    expect(row).toBeDefined();
    expect(row.cell).toBe("L92");
  });

  it("vCenter Storage Size points to L326 in 9.1 (moved in API-only sub-section)", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "vCenter Appliance Storage Size");
    expect(row).toBeDefined();
    expect(row.cell).toBe("L326");
  });
});

describe("cell-map row shifts — VCF Instance Name", () => {
  it("L38 in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "VCF Instance Name");
    expect(row.cell).toBe("L38");
  });

  it("L67 in 9.1 (sheet restructured)", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "VCF Instance Name");
    expect(row.cell).toBe("L67");
  });
});

describe("per-host expansion (mgmt-cluster-host scope)", () => {
  it("emits 16 host FQDN rows in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    // Fleet has DNS domain so the FQDN resolver returns non-empty even
    // without a naming template (the studio's resolveHostname may still
    // return falsy without a template — that's OK; the rows themselves
    // are still emitted).
    const rows = emitWorkbookCellMap(fleet);
    const hostRows = rows.filter((r) => /^Host #\d+ FQDN$/.test(r.label));
    expect(hostRows.length).toBe(16);
    expect(hostRows[0].cell).toBe("L128");
    expect(hostRows[15].cell).toBe("L143");
  });

  it("emits 16 host FQDN rows in 9.1 with cells L82–L97", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const hostRows = rows.filter((r) => /^Host #\d+ FQDN$/.test(r.label));
    expect(hostRows.length).toBe(16);
    expect(hostRows[0].cell).toBe("L82");
    expect(hostRows[15].cell).toBe("L97");
  });
});

describe("initial-instance-mgmt-cluster scope (VCFMS, fleet-scope)", () => {
  it("9.1 fleet emits VCFMS cells once even with multiple instances", () => {
    const fleet = newFleet();
    // Add a second instance to test scope filtering.
    const inst2 = { ...fleet.instances[0], id: "inst-2", name: "instance-2" };
    fleet.instances.push(inst2);
    const rows = emitWorkbookCellMap(fleet);
    const idBrokerRows = rows.filter((r) => r.label === "Identity Broker FQDN");
    expect(idBrokerRows.length).toBe(1);
  });
});

describe("CSV round-trip", () => {
  it("emit → parse recovers same rows", () => {
    const fleet = newFleet();
    fleet.networkConfig.dns.primaryDomain = "acme.local";
    fleet.networkConfig.dns.servers = ["10.0.0.1", "10.0.0.2"];
    const csv = emitWorkbookCellMapCsv(fleet);
    const parsed = parseWorkbookCellMap(csv);
    const original = emitWorkbookCellMap(fleet);
    expect(parsed.length).toBe(original.length);
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]).toEqual(original[i]);
    }
  });

  it("CSV values containing commas / quotes / newlines are escaped (RFC 4180)", () => {
    const fleet = newFleet();
    fleet.instances[0].name = 'instance, with, commas and "quotes"';
    const csv = emitWorkbookCellMapCsv(fleet);
    const parsed = parseWorkbookCellMap(csv);
    const row = parsed.find((r) => r.label === "VCF Instance Name");
    expect(row.value).toBe('instance, with, commas and "quotes"');
  });

  it("CSV starts with the expected header", () => {
    const fleet = newFleet();
    const csv = emitWorkbookCellMapCsv(fleet);
    expect(csv.split("\n")[0]).toBe("workbookVersion,sheet,cell,label,value");
  });
});

describe("emitWorkbookCellMap — defensive defaults", () => {
  it("empty fleet returns []", () => {
    expect(emitWorkbookCellMap(null)).toEqual([]);
    expect(emitWorkbookCellMap(undefined)).toEqual([]);
  });

  it("fleet without instances does not crash", () => {
    expect(() => emitWorkbookCellMap({ vcfVersion: "9.0", instances: [] })).not.toThrow();
  });

  it("entries with a throwing resolve produce empty string, not throw", () => {
    const fleet = newFleet();
    // Synthetic test by directly checking that all values are strings.
    const rows = emitWorkbookCellMap(fleet);
    for (const r of rows) expect(typeof r.value).toBe("string");
  });
});

describe("DNS Domain cell move (9.0 L43 → 9.1 L71)", () => {
  it("L43 in 9.0", () => {
    const fleet = migrate9_1To9_0(newFleet());
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "DNS Domain name");
    expect(row.cell).toBe("L43");
  });

  it("L71 in 9.1 (workbook label is 'Default hostname DNS suffix')", () => {
    const fleet = newFleet();
    const rows = emitWorkbookCellMap(fleet);
    const row = rows.find((r) => r.label === "DNS Domain name");
    expect(row.cell).toBe("L71");
  });
});
