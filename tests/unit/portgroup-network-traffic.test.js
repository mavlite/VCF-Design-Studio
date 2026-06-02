// Per-portgroup "Network Traffic: X" cell → portgroupSlot.vdsSlot.
// The cell sits one row above each portgroup slot's name/LB/uplinks on the
// three Deploy sheets; it carries the vDS/network the portgroup's traffic uses.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { WORKBOOK_CELL_MAP, createPortgroupSlot, migrateFleet } = VcfEngine;

function entryByLabel(label) { return WORKBOOK_CELL_MAP.find((m) => m.label === label); }
function cellFor(e, ver) { return (e.cellByVersion && e.cellByVersion[ver]) || e.cell; }

describe("portgroupSlot.vdsSlot — factory + migrate", () => {
  it("createPortgroupSlot carries a vdsSlot field", () => {
    expect(createPortgroupSlot().vdsSlot).toBe("");
  });
  it("migrateFleet backfills vdsSlot and preserves a hand-set value", () => {
    const f = migrateFleet({ version: "vcf-sizer-v9", instances: [
      { id: "i1", domains: [{ type: "mgmt", clusters: [
        { id: "c1", networks: { portgroups: { mgmt: { name: "pg", vdsSlot: "vDS 1" } } } },
      ] }] },
    ] });
    const pg = f.instances[0].domains[0].clusters[0].networks.portgroups;
    expect(pg.mgmt.vdsSlot).toBe("vDS 1");      // preserved
    expect(pg.vmotion.vdsSlot).toBe("");         // backfilled
  });
});

describe("portgroup Network-Traffic cell-map entries", () => {
  // [label, sheet, scope, cell90, cell91]
  const ROWS = [
    ["Mgmt PG (Deploy Mgmt: ESX Mgmt) Network Traffic", "Deploy Management Domain", "mgmt-cluster",       "L220", "L238"],
    ["NFS PG (Deploy Mgmt) Network Traffic",            "Deploy Management Domain", "mgmt-cluster",       "L240", "L263"],
    ["Mgmt PG (Deploy WLD) Network Traffic",            "Deploy Workload Domain",   "workload-cluster",   "D271", "D286"],
    ["vSAN Storage Client PG (Deploy WLD) Network Traffic", "Deploy Workload Domain", "workload-cluster", "D291", "D306"],
    ["vMotion PG (Deploy Cluster) Network Traffic",     "Deploy Cluster",           "additional-cluster", "D209", "D221"],
  ];
  it.each(ROWS)("%s", (label, sheet, scope, c90, c91) => {
    const e = entryByLabel(label);
    expect(e, `entry '${label}' must exist`).toBeTruthy();
    expect(e.sheet).toBe(sheet);
    expect(e.scope).toBe(scope);
    expect(e.verifyLabel).toBe("Network Traffic");
    expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    expect(cellFor(e, "9.0")).toBe(c90);
    expect(cellFor(e, "9.1")).toBe(c91);
  });

  it("resolves from and applies to the slot's vdsSlot", () => {
    const e = entryByLabel("Mgmt PG (Deploy Mgmt: ESX Mgmt) Network Traffic");
    const cluster = { networks: { portgroups: { mgmt: { ...createPortgroupSlot(), vdsSlot: "vDS 2" } } } };
    expect(e.resolve({}, { cluster })).toBe("vDS 2");
    const target = { networks: { portgroups: { mgmt: createPortgroupSlot() } } };
    e.apply({}, { cluster: target }, "vDS 1");
    expect(target.networks.portgroups.mgmt.vdsSlot).toBe("vDS 1");
  });

  it("maps a Network-Traffic cell for all 15 portgroup slots (5 per sheet × 3 sheets)", () => {
    const nt = WORKBOOK_CELL_MAP.filter((m) => m.verifyLabel === "Network Traffic" && / PG .*Network Traffic$/.test(m.label || ""));
    expect(nt.length).toBe(15);
  });
});
