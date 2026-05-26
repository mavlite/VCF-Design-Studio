// Theme 4 — NSX Edge cluster + per-node detail.
//
// Adds cluster.edgeCluster carrying cluster-level fields (name, MTU,
// TEP VLAN) plus 2 fixed Edge node slots. Each node carries fqdn,
// mgmtIpCidr, hostGroup, resourcePool (Node 1 only — workbook formula
// on Node 2), fpEth0Uplinks[2], fpEth1Uplinks[2], tepIps[2].
//
// Cell-map covers both sheets:
//   Configure Management Domain (mgmt-cluster scope) — 22 entries
//   Configure Workload Domain   (workload-cluster scope) — 22 entries
// Total: 44 entries × 2 versions = 88 entry/version combos.
//
// Scope-reduction calls (workbook formula cells skipped):
//   - Resource Pool on Node 2 (workbook derives from Node 1)
//   - TEP VLAN on Node 2 (workbook derives from Node 1)
//   - Mgmt Gateway / Datastore / Port Group / Host Group Affinity
//     (derived from cluster-level config)
//
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// {9.0,9.1}.json 2026-05-25.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  migrateFleet,
  createEdgeCluster,
  createEdgeNode,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
  validatePlacementConstraints,
} = VcfEngine;

const MGMT_SHEET = "Configure Management Domain";
const WLD_SHEET = "Configure Workload Domain";

function findEntry(label, scope) {
  return WORKBOOK_CELL_MAP.find((x) => x.label === label && x.scope === scope);
}

function mgmtCluster(f) {
  const dom = f.instances[0].domains.find((d) => d.type === "mgmt");
  return dom.clusters[0];
}

function fleetWithWld() {
  const f = newFleet();
  const wld = newWorkloadDomain("WLD-01");
  f.instances[0].domains.push(wld);
  return f;
}

function wldCluster(f) {
  const wld = f.instances[0].domains.find((d) => d.type === "workload");
  return wld.clusters[0];
}

describe("Theme 4 — factories", () => {
  it("createEdgeNode returns the documented shape with empty defaults", () => {
    expect(createEdgeNode()).toEqual({
      fqdn: "",
      mgmtIpCidr: "",
      hostGroup: "",
      resourcePool: "",
      fpEth0Uplinks: ["", ""],
      fpEth1Uplinks: ["", ""],
      tepIps: ["", ""],
    });
  });

  it("createEdgeCluster returns 2 fresh nodes, MTU 1700 (TEP-recommended), tepVlan null", () => {
    const ec = createEdgeCluster();
    expect(ec.name).toBe("");
    expect(ec.mtu).toBe(1700);
    expect(ec.tepVlan).toBeNull();
    expect(ec.nodes).toHaveLength(2);
    expect(ec.nodes[0]).toEqual(createEdgeNode());
    expect(ec.nodes[1]).toEqual(createEdgeNode());
    // No shared array refs.
    ec.nodes[0].fpEth0Uplinks[0] = "x";
    expect(createEdgeCluster().nodes[0].fpEth0Uplinks[0]).toBe("");
  });
});

describe("Theme 4 — newCluster wires edgeCluster", () => {
  it("every cluster has edgeCluster with factory defaults", () => {
    const f = newFleet();
    expect(mgmtCluster(f).edgeCluster).toEqual(createEdgeCluster());
  });
});

describe("Theme 4 — migrateFleet backfill", () => {
  it("backfills edgeCluster on legacy clusters that lack it", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    delete mgmtCluster(raw).edgeCluster;
    const migrated = migrateFleet(raw);
    expect(mgmtCluster(migrated).edgeCluster).toEqual(createEdgeCluster());
  });

  it("preserves customized cluster + per-node fields on round-trip (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).edgeCluster = {
      name: "mgmt-edge-01",
      mtu: 9000,
      tepVlan: 1230,
      nodes: [
        { fqdn: "en01.lab", mgmtIpCidr: "10.0.0.50/24", hostGroup: "hg-az1", resourcePool: "rp-edge", fpEth0Uplinks: ["vmnic2", "vmnic3"], fpEth1Uplinks: ["vmnic4", "vmnic5"], tepIps: ["10.0.99.10", "10.0.99.11"] },
        { fqdn: "en02.lab", mgmtIpCidr: "10.0.0.51/24", hostGroup: "hg-az2", resourcePool: "rp-edge", fpEth0Uplinks: ["vmnic2", "vmnic3"], fpEth1Uplinks: ["vmnic4", "vmnic5"], tepIps: ["10.0.99.12", "10.0.99.13"] },
      ],
    };
    const round1 = migrateFleet(f);
    const round2 = migrateFleet(round1);
    const ec = mgmtCluster(round2).edgeCluster;
    expect(ec.name).toBe("mgmt-edge-01");
    expect(ec.tepVlan).toBe(1230);
    expect(ec.nodes[0].fqdn).toBe("en01.lab");
    expect(ec.nodes[1].mgmtIpCidr).toBe("10.0.0.51/24");
    expect(ec.nodes[0].fpEth0Uplinks).toEqual(["vmnic2", "vmnic3"]);
    expect(ec.nodes[1].tepIps).toEqual(["10.0.99.12", "10.0.99.13"]);
  });

  it("normalizes a short uplinks array to exactly 2 slots", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).edgeCluster = { name: "x", nodes: [{ fqdn: "en01", fpEth0Uplinks: ["vmnic2"], tepIps: [] }, {}] };
    const migrated = migrateFleet(f);
    const n = mgmtCluster(migrated).edgeCluster.nodes[0];
    expect(n.fpEth0Uplinks).toEqual(["vmnic2", ""]);
    expect(n.tepIps).toEqual(["", ""]);
    expect(n.fpEth1Uplinks).toEqual(["", ""]);
  });

  it("drops unknown keys at every level (whitelist-merge)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).edgeCluster = {
      name: "ec",
      bogusTop: "junk",
      nodes: [{ fqdn: "en01", bogusNode: "junk" }, {}],
    };
    const migrated = migrateFleet(f);
    expect(mgmtCluster(migrated).edgeCluster).not.toHaveProperty("bogusTop");
    expect(mgmtCluster(migrated).edgeCluster.nodes[0]).not.toHaveProperty("bogusNode");
  });

  it("handles non-object edgeCluster defensively", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).edgeCluster = "garbage";
    const migrated = migrateFleet(f);
    expect(mgmtCluster(migrated).edgeCluster).toEqual(createEdgeCluster());
  });
});

describe("Theme 4 — WORKBOOK_CELL_MAP — Configure Mgmt", () => {
  const TESTS = [
    // [label, scope, v90, v91]
    ["Edge Cluster Name", "mgmt-cluster", "D95", "D95"],
    ["Edge Tunnel Endpoint MTU", "mgmt-cluster", "D96", "D96"],
    ["Edge TEP VLAN", "mgmt-cluster", "D115", "D116"],
    ["Edge Node 1 FQDN", "mgmt-cluster", "D99", "D99"],
    ["Edge Node 1 Resource Pool", "mgmt-cluster", "D101", "D101"],
    ["Edge Node 1 Host Group", "mgmt-cluster", "D103", "D103"],
    ["Edge Node 1 Management IP CIDR", "mgmt-cluster", "D107", "D107"],
    ["Edge Node 1 fp-eth0 Uplink 1", "mgmt-cluster", "D111", "D112"],
    ["Edge Node 1 fp-eth0 Uplink 2", "mgmt-cluster", "D112", "D113"],
    ["Edge Node 1 fp-eth1 Uplink 1", "mgmt-cluster", "D113", "D114"],
    ["Edge Node 1 fp-eth1 Uplink 2", "mgmt-cluster", "D114", "D115"],
    ["Edge Node 1 TEP 1 IP", "mgmt-cluster", "D120", "D122"],
    ["Edge Node 1 TEP 2 IP", "mgmt-cluster", "D121", "D123"],
    ["Edge Node 2 FQDN", "mgmt-cluster", "D125", "D128"],
    ["Edge Node 2 Host Group", "mgmt-cluster", "D129", "D132"],
    ["Edge Node 2 Management IP CIDR", "mgmt-cluster", "D133", "D135"],
    ["Edge Node 2 TEP 1 IP", "mgmt-cluster", "D144", "D147"],
  ];
  for (const [label, scope, v90, v91] of TESTS) {
    it(`${label} targets ${v90} / ${v91}`, () => {
      const e = findEntry(label, scope);
      expect(e).toBeTruthy();
      expect(e.cell).toBe(v90);
      expect(e.cellByVersion["9.1"]).toBe(v91);
    });
  }

  it("Node 2 has no Resource Pool entry (workbook formula)", () => {
    expect(findEntry("Edge Node 2 Resource Pool", "mgmt-cluster")).toBeFalsy();
  });
});

describe("Theme 4 — WORKBOOK_CELL_MAP — Configure WLD", () => {
  const TESTS = [
    // Edge Cluster Name intentionally NOT shipped on Configure WLD —
    // the existing "NSX Edge Cluster Name" entry (D38, owned by the T0
    // export) already covers that cell. See engine.js comment.
    ["Edge Tunnel Endpoint MTU", "workload-cluster", "D39", "D39"],
    ["Edge TEP VLAN", "workload-cluster", "D58", "D59"],
    ["Edge Node 1 FQDN", "workload-cluster", "D42", "D42"],
    ["Edge Node 1 Management IP CIDR", "workload-cluster", "D50", "D50"],
    ["Edge Node 1 TEP 1 IP", "workload-cluster", "D63", "D65"],
    ["Edge Node 2 FQDN", "workload-cluster", "D68", "D71"],
    ["Edge Node 2 fp-eth0 Uplink 1", "workload-cluster", "D80", "D83"],
    ["Edge Node 2 TEP 2 IP", "workload-cluster", "D88", "D91"],
  ];
  for (const [label, scope, v90, v91] of TESTS) {
    it(`${label} targets ${v90} / ${v91}`, () => {
      const e = findEntry(label, scope);
      expect(e).toBeTruthy();
      expect(e.cell).toBe(v90);
      expect(e.cellByVersion["9.1"]).toBe(v91);
    });
  }
});

describe("Theme 4 — emit semantics", () => {
  it("emits factory defaults on a fresh 9.1 fleet (no Edge data)", () => {
    const f = { ...newFleet(), vcfVersion: "9.1" };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (sheet, cell) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    expect(find(MGMT_SHEET, "D95").value).toBe("");          // cluster name
    expect(find(MGMT_SHEET, "D96").value).toBe("1700");      // MTU default (TEP recommended)
    expect(find(MGMT_SHEET, "D116").value).toBe("");         // TEP VLAN (null → "")
    expect(find(MGMT_SHEET, "D99").value).toBe("");          // Node 1 FQDN
  });

  it("emits customized values into the right Configure Mgmt 9.1 cells", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).edgeCluster = {
      name: "mgmt-edge",
      mtu: 9100,
      tepVlan: 1230,
      nodes: [
        { fqdn: "en01.lab.local", mgmtIpCidr: "10.0.0.50/24", hostGroup: "hg1", resourcePool: "rp1", fpEth0Uplinks: ["vmnic2", "vmnic3"], fpEth1Uplinks: ["vmnic4", "vmnic5"], tepIps: ["10.99.0.10", "10.99.0.11"] },
        { fqdn: "en02.lab.local", mgmtIpCidr: "10.0.0.51/24", hostGroup: "hg2", resourcePool: "rp1", fpEth0Uplinks: ["vmnic2", "vmnic3"], fpEth1Uplinks: ["vmnic4", "vmnic5"], tepIps: ["10.99.0.12", "10.99.0.13"] },
      ],
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === MGMT_SHEET && r.cell === cell);
    expect(find("D95").value).toBe("mgmt-edge");
    expect(find("D96").value).toBe("9100");
    expect(find("D116").value).toBe("1230");
    expect(find("D99").value).toBe("en01.lab.local");
    expect(find("D101").value).toBe("rp1");
    expect(find("D103").value).toBe("hg1");
    expect(find("D107").value).toBe("10.0.0.50/24");
    expect(find("D112").value).toBe("vmnic2");
    expect(find("D113").value).toBe("vmnic3");
    expect(find("D114").value).toBe("vmnic4");
    expect(find("D115").value).toBe("vmnic5");
    expect(find("D122").value).toBe("10.99.0.10");
    expect(find("D123").value).toBe("10.99.0.11");
    expect(find("D128").value).toBe("en02.lab.local");
    expect(find("D132").value).toBe("hg2");
    expect(find("D135").value).toBe("10.0.0.51/24");
    expect(find("D147").value).toBe("10.99.0.12");
    expect(find("D148").value).toBe("10.99.0.13");
  });
});

describe("Theme 4 — Configure WLD round-trip", () => {
  it("CSV round-trip reconstructs the workload-cluster edge config", () => {
    const original = fleetWithWld();
    original.vcfVersion = "9.1";
    wldCluster(original).edgeCluster = {
      name: "wld-edge-01",
      mtu: 9000,
      tepVlan: 1240,
      nodes: [
        { fqdn: "wld-en01", mgmtIpCidr: "10.20.0.10/24", hostGroup: "wld-hg1", resourcePool: "wld-rp", fpEth0Uplinks: ["vmnic2", "vmnic3"], fpEth1Uplinks: ["vmnic4", "vmnic5"], tepIps: ["10.20.99.10", "10.20.99.11"] },
        { fqdn: "wld-en02", mgmtIpCidr: "10.20.0.11/24", hostGroup: "wld-hg2", resourcePool: "wld-rp", fpEth0Uplinks: ["vmnic2", "vmnic3"], fpEth1Uplinks: ["vmnic4", "vmnic5"], tepIps: ["10.20.99.12", "10.20.99.13"] },
      ],
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const ec = wldCluster(rebuilt).edgeCluster;
    // edgeCluster.name is NOT round-tripped on Configure WLD (its D38
    // cell is owned by the pre-existing "NSX Edge Cluster Name" entry).
    // Reverts to factory default on re-import.
    expect(ec.name).toBe("");
    expect(ec.tepVlan).toBe(1240);
    expect(ec.mtu).toBe(9000);
    expect(ec.nodes[0].fqdn).toBe("wld-en01");
    expect(ec.nodes[1].mgmtIpCidr).toBe("10.20.0.11/24");
    expect(ec.nodes[0].fpEth0Uplinks).toEqual(["vmnic2", "vmnic3"]);
    expect(ec.nodes[1].tepIps).toEqual(["10.20.99.12", "10.20.99.13"]);
    // Node 2 resourcePool isn't stamped (workbook formula); resets to "".
    expect(ec.nodes[1].resourcePool).toBe("");
    // Node 1's resourcePool DOES round-trip.
    expect(ec.nodes[0].resourcePool).toBe("wld-rp");
  });
});

describe("Theme 4 — apply coercion", () => {
  it("MTU apply coerces non-numeric to default 1700 (TEP-recommended)", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: MGMT_SHEET, cell: "D96", label: "Edge Tunnel Endpoint MTU", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).edgeCluster.mtu).toBe(1700);
  });

  it("TEP VLAN apply coerces non-numeric to null", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: MGMT_SHEET, cell: "D116", label: "Edge TEP VLAN", value: "not-a-number" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).edgeCluster.tepVlan).toBeNull();
  });
});

describe("Theme 4 — no regression on placement validator", () => {
  it("validatePlacementConstraints clean on a default newFleet", () => {
    const fleet = newFleet();
    const issues = validatePlacementConstraints(fleet);
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });

  it("validatePlacementConstraints still clean with edgeCluster populated", () => {
    const f = newFleet();
    mgmtCluster(f).edgeCluster = {
      ...createEdgeCluster(),
      name: "edge",
      nodes: [
        { ...createEdgeNode(), fqdn: "en01" },
        { ...createEdgeNode(), fqdn: "en02" },
      ],
    };
    const issues = validatePlacementConstraints(f);
    const criticals = issues.filter((i) => i.severity === "critical");
    expect(criticals).toEqual([]);
  });
});
