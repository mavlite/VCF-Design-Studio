// M1.3 — Gateway Interface VLAN/IP/Gateway cell-map coverage.
//
// Closes the deferred-feature gap documented at engine.js:6304-6307.
// The Edge cluster T0's per-uplink VLAN + Gateway (shared across edge
// nodes) and per-edge-node per-uplink Gateway Interface IPs now stamp
// to Configure Mgmt (mgmt-cluster scope) and Configure WLD (workload-
// cluster scope) — 8 cells per scope × 2 versions = 32 entry/version
// combos.
//
// Model surface introduced by M1.3:
//   cluster.networks.uplinks = [
//     { vlan: null, gateway: "" },   // uplink 1
//     { vlan: null, gateway: "" },   // uplink 2
//   ]
//   cluster.edgeCluster.nodes[j].gatewayInterfaceIps = ["", ""]   // [uplink1 IP, uplink2 IP]

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  createClusterNetworks,
  createEdgeNode,
  migrateFleet,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

function mgmtCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
}

function fleetWithWld(version = "9.1") {
  const f = newFleet();
  f.vcfVersion = version;
  const wld = newWorkloadDomain("WLD-01");
  wld.clusters = [newWorkloadCluster("wld-cl01")];
  f.instances[0].domains.push(wld);
  return f;
}

function wldCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
}

describe("M1.3 — model surface", () => {
  it("createClusterNetworks().uplinks defaults to 2 entries", () => {
    const n = createClusterNetworks();
    expect(n.uplinks).toEqual([
      { vlan: null, gateway: "" },
      { vlan: null, gateway: "" },
    ]);
  });

  it("createEdgeNode().gatewayInterfaceIps defaults to two empty strings", () => {
    expect(createEdgeNode().gatewayInterfaceIps).toEqual(["", ""]);
  });

  it("migrateFleet backfills uplinks[] when source has legacy empty array", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).networks.uplinks = []; // legacy default
    const r = migrateFleet(f);
    expect(mgmtCluster(r).networks.uplinks).toEqual([
      { vlan: null, gateway: "" },
      { vlan: null, gateway: "" },
    ]);
  });

  it("migrateFleet preserves user-supplied uplinks values + drops unknown keys", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).networks.uplinks = [
      { vlan: 1617, gateway: "10.0.17.1", bogus: "drop me" },
      { vlan: 1618 },
    ];
    const r = migrateFleet(f);
    expect(mgmtCluster(r).networks.uplinks).toEqual([
      { vlan: 1617, gateway: "10.0.17.1" },
      { vlan: 1618, gateway: "" },
    ]);
  });

  it("migrateFleet backfills edgeNode.gatewayInterfaceIps when missing", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).edgeCluster.nodes[0].gatewayInterfaceIps = undefined;
    mgmtCluster(f).edgeCluster.nodes[1].gatewayInterfaceIps = ["10.0.17.3/24"]; // short array
    const r = migrateFleet(f);
    expect(mgmtCluster(r).edgeCluster.nodes[0].gatewayInterfaceIps).toEqual(["", ""]);
    // Short arrays pad to length 2.
    expect(mgmtCluster(r).edgeCluster.nodes[1].gatewayInterfaceIps).toEqual(["10.0.17.3/24", ""]);
  });
});

describe("M1.3 — cell-map entries shipped (2 scopes × 8 fields × 2 versions)", () => {
  it("mgmt-cluster scope has 8 Gateway Interface entries on Configure Mgmt", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === "Configure Management Domain" &&
        e.scope === "initial-instance-mgmt-cluster" &&
        /^T0 Uplink [12] (VLAN|Gateway)$|^Edge Node [12] Uplink [12] Gateway Interface IP$/.test(e.label || "")
    );
    expect(entries).toHaveLength(8);
  });

  it("workload-cluster scope has 8 Gateway Interface entries on Configure WLD", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === "Configure Workload Domain" &&
        e.scope === "workload-cluster" &&
        /^T0 Uplink [12] (VLAN|Gateway)$|^Edge Node [12] Uplink [12] Gateway Interface IP$/.test(e.label || "")
    );
    expect(entries).toHaveLength(8);
  });

  it("each entry covers both 9.0 and 9.1", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => /Gateway Interface IP$/.test(e.label || "") || /^T0 Uplink [12]/.test(e.label || "")
    );
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(expect.arrayContaining(["9.0", "9.1"]));
    }
  });
});

describe("M1.3 — emit on mgmt-cluster scope", () => {
  it("9.1 emits T0 Uplink 1 VLAN at D161", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.uplinks[0].vlan = 1617;
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = rows.find((r) => r.cell === "D161" && r.label === "T0 Uplink 1 VLAN");
    expect(row.value).toBe("1617");
  });

  it("9.0 emits T0 Uplink 1 Gateway at D194; 9.1 at D231", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    mgmtCluster(f).networks.uplinks[0].gateway = "10.0.17.1";
    const rows90 = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows90.find((r) => r.cell === "D194" && r.label === "T0 Uplink 1 Gateway").value).toBe("10.0.17.1");
    f.vcfVersion = "9.1";
    const rows91 = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows91.find((r) => r.cell === "D231" && r.label === "T0 Uplink 1 Gateway").value).toBe("10.0.17.1");
  });

  it("emits Edge Node 1/2 Uplink 1/2 Gateway Interface IPs to the correct cells (9.0 and 9.1)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const c = mgmtCluster(f);
    c.edgeCluster.nodes[0].gatewayInterfaceIps = ["10.0.17.2/24", "10.0.18.2/24"];
    c.edgeCluster.nodes[1].gatewayInterfaceIps = ["10.0.17.3/24", "10.0.18.3/24"];
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // 9.1 Edge Node 1 cells: D162 (Up1), D169 (Up2)
    expect(rows.find((r) => r.cell === "D162").value).toBe("10.0.17.2/24");
    expect(rows.find((r) => r.cell === "D169").value).toBe("10.0.18.2/24");
    // 9.1 Edge Node 2 cells: D177 (Up1), D184 (Up2)
    expect(rows.find((r) => r.cell === "D177").value).toBe("10.0.17.3/24");
    expect(rows.find((r) => r.cell === "D184").value).toBe("10.0.18.3/24");
  });

  it("emits empty values when no values configured (factory defaults)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.cell === "D161" && r.label === "T0 Uplink 1 VLAN").value).toBe("");
    expect(rows.find((r) => r.cell === "D162" && r.label.includes("Edge Node 1")).value).toBe("");
  });
});

describe("M1.3 — emit on workload-cluster scope", () => {
  it("9.0 workload-cluster emits T0 Uplink 1 VLAN at D101 + Gateway at D137", () => {
    const f = fleetWithWld("9.0");
    wldCluster(f).networks.uplinks[0].vlan = 1717;
    wldCluster(f).networks.uplinks[0].gateway = "10.1.17.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const vlanRow = rows.find((r) => r.sheet === "Configure Workload Domain" && r.cell === "D101" && r.label === "T0 Uplink 1 VLAN");
    const gwRow = rows.find((r) => r.sheet === "Configure Workload Domain" && r.cell === "D137" && r.label === "T0 Uplink 1 Gateway");
    expect(vlanRow.value).toBe("1717");
    expect(gwRow.value).toBe("10.1.17.1");
  });

  it("9.1 workload-cluster emits Edge Node 2 Uplink 2 IP at D127", () => {
    const f = fleetWithWld("9.1");
    wldCluster(f).edgeCluster.nodes[1].gatewayInterfaceIps[1] = "10.1.18.3/24";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = rows.find((r) => r.sheet === "Configure Workload Domain" && r.cell === "D127" && r.label.includes("Edge Node 2 Uplink 2"));
    expect(row.value).toBe("10.1.18.3/24");
  });
});

describe("M1.3 — round-trip preservation", () => {
  it("preserves all 8 mgmt-cluster fields across emit→CSV→parse→import for 9.1", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    const c = mgmtCluster(original);
    c.networks.uplinks[0].vlan = 1617;
    c.networks.uplinks[1].vlan = 1618;
    c.networks.uplinks[0].gateway = "10.0.17.1";
    c.networks.uplinks[1].gateway = "10.0.18.1";
    c.edgeCluster.nodes[0].gatewayInterfaceIps = ["10.0.17.2/24", "10.0.18.2/24"];
    c.edgeCluster.nodes[1].gatewayInterfaceIps = ["10.0.17.3/24", "10.0.18.3/24"];

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const back = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" }).fleet;
    const bc = mgmtCluster(back);

    expect(bc.networks.uplinks[0].vlan).toBe(1617);
    expect(bc.networks.uplinks[1].vlan).toBe(1618);
    expect(bc.networks.uplinks[0].gateway).toBe("10.0.17.1");
    expect(bc.networks.uplinks[1].gateway).toBe("10.0.18.1");
    expect(bc.edgeCluster.nodes[0].gatewayInterfaceIps).toEqual(["10.0.17.2/24", "10.0.18.2/24"]);
    expect(bc.edgeCluster.nodes[1].gatewayInterfaceIps).toEqual(["10.0.17.3/24", "10.0.18.3/24"]);
  });

  it("preserves workload-cluster fields on 9.0", () => {
    const original = fleetWithWld("9.0");
    const c = wldCluster(original);
    c.networks.uplinks[0].vlan = 1717;
    c.networks.uplinks[1].vlan = 1718;
    c.networks.uplinks[0].gateway = "10.1.17.1";
    c.networks.uplinks[1].gateway = "10.1.18.1";
    c.edgeCluster.nodes[0].gatewayInterfaceIps = ["10.1.17.2/24", "10.1.18.2/24"];
    c.edgeCluster.nodes[1].gatewayInterfaceIps = ["10.1.17.3/24", "10.1.18.3/24"];

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const back = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" }).fleet;
    const bc = wldCluster(back);

    expect(bc.networks.uplinks[0].vlan).toBe(1717);
    expect(bc.networks.uplinks[1].vlan).toBe(1718);
    expect(bc.edgeCluster.nodes[0].gatewayInterfaceIps).toEqual(["10.1.17.2/24", "10.1.18.2/24"]);
    expect(bc.edgeCluster.nodes[1].gatewayInterfaceIps).toEqual(["10.1.17.3/24", "10.1.18.3/24"]);
  });

  it("VLAN apply coerces non-numeric to null", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const rows = [
      { workbookVersion: "9.1", sheet: "Configure Management Domain", cell: "D161", label: "T0 Uplink 1 VLAN", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.uplinks[0].vlan).toBeNull();
  });
});
