// Theme 3 — vDS + LAG topology export.
//
// Each of 3 workbook sheets (Deploy Mgmt, Deploy WLD, Deploy Cluster)
// carries a 3-vDS-slot block. Per slot we ship 6 fields:
//   - Distributed Switch Name        (already in model: vds[i].name)
//   - MTU                            (already in model: vds[i].mtu)
//   - LAG Name, LACP Mode, LAG Load Balancing, LACP Time Out
//                                    (new: vds[i].lag = {...})
//
// 6 fields × 3 vDS slots × 3 sheets × 2 versions = 108 entry/version
// combinations.
//
// Port-group naming + per-traffic teaming policies are deferred to a
// follow-up "theme 3b".
//
// Workbook label varies per sheet for the vDS Name cell:
//   Deploy Mgmt: "Distributed Switch Name"
//   Deploy WLD / Cluster: "Primary/Secondary/Tertiary vSphere Distributed Switch"
//
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// {9.0,9.1}.json 2026-05-25.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  createVdsLag,
  createClusterNetworks,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

function mgmtCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
}

function fleetWithMultiClusterWld() {
  const f = newFleet();
  f.vcfVersion = "9.1";
  const wld = newWorkloadDomain("WLD-01");
  wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
  f.instances[0].domains.push(wld);
  return f;
}

describe("Theme 3 — factories", () => {
  it("createVdsLag returns the documented default block", () => {
    expect(createVdsLag()).toEqual({
      name: "",
      mode: "Active",
      loadBalancing: "Source and destination IP and TCP/UDP port",
      timeout: "Slow",
    });
  });

  it("newFleet vds entries carry a default LAG block", () => {
    const f = newFleet();
    const vds = mgmtCluster(f).networks.vds;
    for (const v of vds) expect(v.lag).toEqual(createVdsLag());
  });
});

describe("Theme 3 — migrateFleet backfills lag on legacy vds entries", () => {
  it("legacy vds without lag pull factory defaults", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    // Simulate a legacy fleet shape — strip lag from each vds.
    mgmtCluster(raw).networks.vds = mgmtCluster(raw).networks.vds.map((v) => ({ name: v.name, uplinks: v.uplinks, mtu: v.mtu }));
    const migrated = migrateFleet(raw);
    for (const v of mgmtCluster(migrated).networks.vds) {
      expect(v.lag).toEqual(createVdsLag());
    }
  });

  it("preserves customized LAG fields on round-trip (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).networks.vds[0].lag = {
      name: "lag-mgmt",
      mode: "Passive",
      loadBalancing: "Source MAC address",
      timeout: "Fast",
    };
    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    expect(mgmtCluster(r2).networks.vds[0].lag).toEqual({
      name: "lag-mgmt",
      mode: "Passive",
      loadBalancing: "Source MAC address",
      timeout: "Fast",
    });
  });

  it("drops unknown keys at the lag level (whitelist-merge)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).networks.vds[0].lag = { name: "lag-x", bogus: "junk" };
    const migrated = migrateFleet(f);
    expect(mgmtCluster(migrated).networks.vds[0].lag).not.toHaveProperty("bogus");
    expect(mgmtCluster(migrated).networks.vds[0].lag.name).toBe("lag-x");
    // Missing fields fall back to factory defaults.
    expect(mgmtCluster(migrated).networks.vds[0].lag.mode).toBe("Active");
  });
});

describe("Theme 3 — WORKBOOK_CELL_MAP entries", () => {
  const SHEETS = [
    { sheet: "Deploy Management Domain", scope: "mgmt-cluster" },
    { sheet: "Deploy Workload Domain", scope: "workload-cluster" },
    { sheet: "Deploy Cluster", scope: "additional-cluster" },
  ];

  it("each sheet ships 6 × 3 = 18 entries (3 vDS slots × 6 fields)", () => {
    for (const { sheet, scope } of SHEETS) {
      const entries = WORKBOOK_CELL_MAP.filter(
        (e) => e.sheet === sheet && /^vDS [123] /.test(e.label) && e.scope === scope
      );
      expect(entries, `${sheet} count`).toHaveLength(18);
      for (const e of entries) expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
    }
  });

  it("Deploy Mgmt vDS 1 targets the documented cells", () => {
    const expected = {
      "vDS 1 Name":               { v90: "L188", v91: "L206" },
      "vDS 1 MTU":                { v90: "L189", v91: "L207" },
      "vDS 1 LAG Name":           { v90: "L191", v91: "L209" },
      "vDS 1 LACP Mode":          { v90: "L192", v91: "L210" },
      "vDS 1 LAG Load Balancing": { v90: "L193", v91: "L211" },
      "vDS 1 LACP Time Out":      { v90: "L194", v91: "L212" },
    };
    for (const [label, { v90, v91 }] of Object.entries(expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === "Deploy Management Domain" && x.label === label && x.scope === "mgmt-cluster");
      expect(e, `missing ${label}`).toBeTruthy();
      expect(e.cell).toBe(v90);
      expect(e.cellByVersion["9.1"]).toBe(v91);
    }
  });

  it("Deploy Mgmt vDS 3 MTU lands at the +2-row quirk (9.0)", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === "Deploy Management Domain" && x.label === "vDS 3 MTU");
    expect(e.cell).toBe("L212");                                  // Name(L210) + 2, not +1
    expect(e.cellByVersion["9.1"]).toBe("L229");
  });

  it("Deploy WLD vDS Name labels vary per slot (Primary/Secondary/Tertiary)", () => {
    const e1 = WORKBOOK_CELL_MAP.find((x) => x.sheet === "Deploy Workload Domain" && x.label === "vDS 1 Name");
    const e2 = WORKBOOK_CELL_MAP.find((x) => x.sheet === "Deploy Workload Domain" && x.label === "vDS 2 Name");
    const e3 = WORKBOOK_CELL_MAP.find((x) => x.sheet === "Deploy Workload Domain" && x.label === "vDS 3 Name");
    expect((e1.verifyLabelByVersion && e1.verifyLabelByVersion["9.1"]) || e1.verifyLabel).toMatch(/Primary/);
    expect(e2.verifyLabel).toMatch(/Secondary/);
    expect(e3.verifyLabel).toMatch(/Tertiary/);
  });

  it("LACP Mode entries carry an Active/Passive data-validation enum", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "vDS 1 LACP Mode" && x.scope === "mgmt-cluster");
    expect(e.dataValidation).toEqual(["Active", "Passive"]);
  });

  it("LACP Time Out entries carry a Slow/Fast data-validation enum", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "vDS 1 LACP Time Out" && x.scope === "mgmt-cluster");
    expect(e.dataValidation).toEqual(["Slow", "Fast"]);
  });
});

describe("Theme 3 — emit semantics", () => {
  it("emits Name + MTU + factory LAG defaults on a fresh 9.1 fleet", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === cell);
    expect(find("L206").value).toBe("vds-mgmt-vmotion");                                // vDS 1 Name (4-NIC profile default)
    expect(find("L207").value).toBe("9000");                                            // vDS 1 MTU
    expect(find("L209").value).toBe("");                                                // vDS 1 LAG Name (empty default)
    expect(find("L210").value).toBe("Active");                                          // vDS 1 LACP Mode
    expect(find("L211").value).toBe("Source and destination IP and TCP/UDP port");      // LAG LB
    expect(find("L212").value).toBe("Slow");                                            // LACP Time Out
  });

  it("emits user-customized LAG values into 9.0 cells", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    mgmtCluster(f).networks.vds[0].lag = {
      name: "lag-mgmt",
      mode: "Passive",
      loadBalancing: "Source MAC address",
      timeout: "Fast",
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (cell) => rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === cell);
    expect(find("L191").value).toBe("lag-mgmt");
    expect(find("L192").value).toBe("Passive");
    expect(find("L193").value).toBe("Source MAC address");
    expect(find("L194").value).toBe("Fast");
  });

  it("emits empty values for vDS slots beyond cluster.networks.vds.length", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    // Switch to 2-NIC profile (only 1 vDS in cluster.networks.vds).
    mgmtCluster(f).networks.vds = [{ name: "vds-converged", uplinks: ["vmnic0", "vmnic1"], mtu: 9000, lag: createVdsLag() }];
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === "L217").value).toBe("");  // vDS 2 Name
    expect(rows.find((r) => r.sheet === "Deploy Management Domain" && r.cell === "L228").value).toBe("");  // vDS 3 Name
  });
});

describe("Theme 3 — import round-trip", () => {
  it("CSV round-trip reconstructs LAG fields on the mgmt cluster", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    mgmtCluster(original).networks.vds[0].lag = {
      name: "lag-mgmt",
      mode: "Passive",
      loadBalancing: "Source and destination MAC",
      timeout: "Fast",
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const back = mgmtCluster(rebuilt).networks.vds[0].lag;
    expect(back.name).toBe("lag-mgmt");
    expect(back.mode).toBe("Passive");
    expect(back.loadBalancing).toBe("Source and destination MAC");
    expect(back.timeout).toBe("Fast");
  });

  it("Deploy Cluster round-trip restores additional cluster LAG (9.0)", () => {
    const original = fleetWithMultiClusterWld();
    original.vcfVersion = "9.0";
    const additional = original.instances[0].domains.find((d) => d.type === "workload").clusters[1];
    additional.networks.vds[0].lag = {
      name: "lag-addl",
      mode: "Active",
      loadBalancing: "Source IP hash",
      timeout: "Slow",
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    const back = rebuilt.instances[0].domains.find((d) => d.type === "workload").clusters[1].networks.vds[0].lag;
    expect(back.name).toBe("lag-addl");
    expect(back.loadBalancing).toBe("Source IP hash");
  });

  it("LACP Mode apply normalizes garbage to Active", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L210", label: "vDS 1 LACP Mode", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vds[0].lag.mode).toBe("Active");
  });

  it("LACP Time Out apply normalizes garbage to Slow", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L212", label: "vDS 1 LACP Time Out", value: "Sometimes" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vds[0].lag.timeout).toBe("Slow");
  });

  it("MTU apply coerces non-numeric to 9000", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L207", label: "vDS 1 MTU", value: "nope" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vds[0].mtu).toBe(9000);
  });
});
