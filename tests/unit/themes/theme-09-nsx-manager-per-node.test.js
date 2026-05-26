// Theme 9 — NSX Global Manager per-node detail.
//
// Scope note: the tracking spec said "NSX Manager per-node detail"
// targeting Configure Mgmt D468-D515, but those cells are actually
// NSX Global Manager (federation control plane). The regular NSX
// Manager's per-node FQDNs/IPs are workbook-derived formula cells, not
// user-input. So theme 9 ships NSX GM per-node — the cells the spec
// pointed at — under fleet.federationConfig.globalManager.nodes[].
//
// Each of 3 fixed node slots carries 5 model fields (vmName,
// deploySize, fqdn, mgmtIp, searchList). The cell-map exports only the
// subset that is user-input in both 9.0 and 9.1:
//   - VM Name × 3 nodes (D400/D417/D434 ↔ D471/D488/D505)
//   - Hostname FQDN × 3 (D409/D426/D443 ↔ D480/D497/D514)
//   - Management IPv4 × 3 (D410/D427/D444 ↔ D481/D498/D515)
//   - Deployment Size at Node 1 only (D403 ↔ D474) — workbook
//     propagates to Node 2/3 via =D403 / =D420 formulas
// Search List + Node 2/3 Deployment Size are formula cells in the
// pristine workbook and intentionally not stamp targets.
//
// 10 cell-map entries × 2 versions = 20 entry/version combinations.
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// {9.0,9.1}.json 2026-05-25.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  migrateFleet,
  createFleetFederationConfig,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
  validatePlacementConstraints,
} = VcfEngine;

const SHEET = "Configure Management Domain";

const PER_NODE_FIELDS = {
  vmName: {
    label: "NSX GM Virtual Machine Name",
    cells: {
      1: { v90: "D400", v91: "D471" },
      2: { v90: "D417", v91: "D488" },
      3: { v90: "D434", v91: "D505" },
    },
  },
  fqdn: {
    label: "NSX GM Hostname FQDN",
    cells: {
      1: { v90: "D409", v91: "D480" },
      2: { v90: "D426", v91: "D497" },
      3: { v90: "D443", v91: "D514" },
    },
  },
  mgmtIp: {
    label: "NSX GM Management IPv4",
    cells: {
      1: { v90: "D410", v91: "D481" },
      2: { v90: "D427", v91: "D498" },
      3: { v90: "D444", v91: "D515" },
    },
  },
};

function findEntry(label) {
  return WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === "instance");
}

function nodeLabel(field, nodeIdx) {
  return `${PER_NODE_FIELDS[field].label} (Node ${nodeIdx})`;
}

describe("Theme 9 — createFleetFederationConfig factory", () => {
  it("returns 3 empty NSX GM nodes with deploySize defaulted to Medium", () => {
    const cfg = createFleetFederationConfig();
    expect(cfg).toEqual({
      globalManager: {
        nodes: [
          { vmName: "", deploySize: "Medium", fqdn: "", mgmtIp: "", searchList: "" },
          { vmName: "", deploySize: "Medium", fqdn: "", mgmtIp: "", searchList: "" },
          { vmName: "", deploySize: "Medium", fqdn: "", mgmtIp: "", searchList: "" },
        ],
      },
    });
  });

  it("each node is a fresh object (no shared references)", () => {
    const cfg = createFleetFederationConfig();
    cfg.globalManager.nodes[0].vmName = "x";
    const cfg2 = createFleetFederationConfig();
    expect(cfg2.globalManager.nodes[0].vmName).toBe("");
    expect(cfg.globalManager.nodes[0]).not.toBe(cfg2.globalManager.nodes[0]);
  });
});

describe("Theme 9 — newFleet wires federationConfig", () => {
  it("ships fleet.federationConfig with factory defaults", () => {
    const f = newFleet();
    expect(f.federationConfig).toEqual(createFleetFederationConfig());
  });
});

describe("Theme 9 — migrateFleet backfill", () => {
  it("backfills federationConfig on legacy fleets that lack it", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    delete raw.federationConfig;
    const migrated = migrateFleet(raw);
    expect(migrated.federationConfig).toEqual(createFleetFederationConfig());
  });

  it("preserves customized per-node fields on round-trip (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig = {
      globalManager: {
        nodes: [
          { vmName: "gm-01a", deploySize: "Large", fqdn: "gm-01a.lab", mgmtIp: "10.0.0.11", searchList: "lab.local" },
          { vmName: "gm-01b", deploySize: "Large", fqdn: "gm-01b.lab", mgmtIp: "10.0.0.12", searchList: "lab.local" },
          { vmName: "gm-01c", deploySize: "Large", fqdn: "gm-01c.lab", mgmtIp: "10.0.0.13", searchList: "lab.local" },
        ],
      },
    };
    const round1 = migrateFleet(f);
    const round2 = migrateFleet(round1);
    expect(round2.federationConfig.globalManager.nodes[0].vmName).toBe("gm-01a");
    expect(round2.federationConfig.globalManager.nodes[1].mgmtIp).toBe("10.0.0.12");
    expect(round2.federationConfig.globalManager.nodes[2].deploySize).toBe("Large");
  });

  it("drops unknown keys at the node level (whitelist-merge per slot)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig = {
      globalManager: {
        nodes: [
          { vmName: "gm-01a", bogus: "junk" },
          {},
          {},
        ],
      },
    };
    const migrated = migrateFleet(f);
    expect(migrated.federationConfig.globalManager.nodes[0].vmName).toBe("gm-01a");
    expect(migrated.federationConfig.globalManager.nodes[0]).not.toHaveProperty("bogus");
    expect(migrated.federationConfig.globalManager.nodes[0].deploySize).toBe("Medium");
    expect(migrated.federationConfig.globalManager.nodes[1].vmName).toBe("");
  });

  it("normalizes a partial nodes[] array to exactly 3 slots", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig = { globalManager: { nodes: [{ vmName: "only-one" }] } };
    const migrated = migrateFleet(f);
    expect(migrated.federationConfig.globalManager.nodes).toHaveLength(3);
    expect(migrated.federationConfig.globalManager.nodes[0].vmName).toBe("only-one");
    expect(migrated.federationConfig.globalManager.nodes[1].vmName).toBe("");
    expect(migrated.federationConfig.globalManager.nodes[2].vmName).toBe("");
  });

  it("handles non-object federationConfig defensively", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.federationConfig = "garbage";
    const migrated = migrateFleet(f);
    expect(migrated.federationConfig).toEqual(createFleetFederationConfig());
  });
});

describe("Theme 9 — WORKBOOK_CELL_MAP entries", () => {
  it("all 9 per-node entries present (3 fields × 3 nodes) on instance scope", () => {
    for (const nodeIdx of [1, 2, 3]) {
      for (const field of Object.keys(PER_NODE_FIELDS)) {
        const label = nodeLabel(field, nodeIdx);
        const e = findEntry(label);
        expect(e, `missing entry: ${label}`).toBeTruthy();
        expect(e.sheet).toBe(SHEET);
        expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      }
    }
  });

  it("each per-node entry targets the documented (9.0, 9.1) cell pair", () => {
    for (const nodeIdx of [1, 2, 3]) {
      for (const field of Object.keys(PER_NODE_FIELDS)) {
        const label = nodeLabel(field, nodeIdx);
        const { v90, v91 } = PER_NODE_FIELDS[field].cells[nodeIdx];
        const e = findEntry(label);
        expect(e.cell, `${label} 9.0 cell`).toBe(v90);
        expect(e.cellByVersion["9.1"], `${label} 9.1 cell`).toBe(v91);
      }
    }
  });

  it("ships a single cluster-wide Deployment Size entry at Node 1's cell", () => {
    const e = findEntry("NSX GM Deployment Size");
    expect(e).toBeTruthy();
    expect(e.sheet).toBe(SHEET);
    expect(e.cell).toBe("D403");
    expect(e.cellByVersion["9.1"]).toBe("D474");
    expect(e.dataValidation).toEqual(["Small", "Medium", "Large", "X-Large"]);
  });

  it("does NOT ship per-node Deployment Size entries for Node 2/3", () => {
    expect(findEntry("NSX GM Deployment Size (Node 2)")).toBeFalsy();
    expect(findEntry("NSX GM Deployment Size (Node 3)")).toBeFalsy();
  });

  it("does NOT ship Search List entries (workbook formulas, not stamp targets)", () => {
    for (const n of [1, 2, 3]) {
      expect(findEntry(`NSX GM Domain Search List (Node ${n})`)).toBeFalsy();
    }
  });

  it("all theme-9 entries carry resolve + apply (not vault, not emit-only)", () => {
    const themeEntries = WORKBOOK_CELL_MAP.filter((x) => x.label && x.label.startsWith("NSX GM "));
    expect(themeEntries).toHaveLength(10);                  // 9 per-node + 1 cluster-wide
    for (const e of themeEntries) {
      expect(typeof e.resolve).toBe("function");
      expect(typeof e.apply).toBe("function");
      expect(e.emitOnly).toBeFalsy();
      expect(e.passwordKind).toBeFalsy();
    }
  });
});

describe("Theme 9 — emit semantics", () => {
  it("emits factory defaults at the right cells on a 9.1 fleet", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("D471").value).toBe("");           // Node 1 VM Name
    expect(find("D474").value).toBe("Medium");     // cluster-wide deploy size
    expect(find("D480").value).toBe("");           // Node 1 FQDN
    expect(find("D481").value).toBe("");           // Node 1 IP
    expect(find("D505").value).toBe("");           // Node 3 VM Name
  });

  it("emits user-populated values into 9.0 cells", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    f.federationConfig.globalManager.nodes[0] = {
      vmName: "fleet-m01-nsx-gm01a",
      deploySize: "Large",
      fqdn: "fleet-m01-nsx-gm01a.lab.local",
      mgmtIp: "10.11.10.31",
      searchList: "lab.local,corp.lab.local",         // not stamped (formula cell)
    };
    f.federationConfig.globalManager.nodes[1].vmName = "fleet-m01-nsx-gm01b";
    f.federationConfig.globalManager.nodes[2].vmName = "fleet-m01-nsx-gm01c";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (cell) => rows.find((r) => r.sheet === SHEET && r.cell === cell);
    expect(find("D400").value).toBe("fleet-m01-nsx-gm01a");
    expect(find("D403").value).toBe("Large");           // cluster-wide deploy size
    expect(find("D409").value).toBe("fleet-m01-nsx-gm01a.lab.local");
    expect(find("D410").value).toBe("10.11.10.31");
    expect(find("D417").value).toBe("fleet-m01-nsx-gm01b");
    expect(find("D434").value).toBe("fleet-m01-nsx-gm01c");
    // Search list cells are NOT in the export.
    expect(find("D414")).toBeUndefined();
    expect(find("D431")).toBeUndefined();
    expect(find("D448")).toBeUndefined();
  });
});

describe("Theme 9 — import round-trip", () => {
  it("CSV round-trip reconstructs the cell-map-covered fields exactly", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    original.federationConfig.globalManager.nodes = [
      { vmName: "gm-01a", deploySize: "Small",  fqdn: "gm-01a.lab", mgmtIp: "10.0.0.11", searchList: "lab" },
      { vmName: "gm-01b", deploySize: "Medium", fqdn: "gm-01b.lab", mgmtIp: "10.0.0.12", searchList: "lab" },
      { vmName: "gm-01c", deploySize: "Large",  fqdn: "gm-01c.lab", mgmtIp: "10.0.0.13", searchList: "lab" },
    ];
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    // vmName, fqdn, mgmtIp round-trip per node.
    for (const i of [0, 1, 2]) {
      const orig = original.federationConfig.globalManager.nodes[i];
      const back = rebuilt.federationConfig.globalManager.nodes[i];
      expect(back.vmName).toBe(orig.vmName);
      expect(back.fqdn).toBe(orig.fqdn);
      expect(back.mgmtIp).toBe(orig.mgmtIp);
    }
    // Cluster-wide deploy size lives on Node 1 in the cell-map; Node 1's
    // value round-trips. Node 2/3 deploy size values are not stamped and
    // reset to factory default on import.
    expect(rebuilt.federationConfig.globalManager.nodes[0].deploySize).toBe("Small");
    expect(rebuilt.federationConfig.globalManager.nodes[1].deploySize).toBe("Medium");
    expect(rebuilt.federationConfig.globalManager.nodes[2].deploySize).toBe("Medium");
    // searchList isn't in the cell-map at all; reverts to "".
    for (const i of [0, 1, 2]) {
      expect(rebuilt.federationConfig.globalManager.nodes[i].searchList).toBe("");
    }
  });

  it("Deployment Size apply rejects garbage and falls back to Medium", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: SHEET, cell: "D474", label: "NSX GM Deployment Size", value: "Huge" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(rebuilt.federationConfig.globalManager.nodes[0].deploySize).toBe("Medium");
  });
});

describe("Theme 9 — no regression on placement validator", () => {
  it("validatePlacementConstraints clean on a default newFleet", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });
});
