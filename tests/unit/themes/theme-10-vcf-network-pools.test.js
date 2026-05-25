// Theme 10 — VCF Network Pools cluster-level export.
//
// Three sheets each carry a "VCF Network Pool" block:
//   - Configure Management Domain (9.1-only, 3 networks: vmotion/vsan/hostTep)
//   - Configure Workload Domain   (9.1-only, 4 networks; edgeTep IP Range End
//     absent in the pristine workbook so 6 cells for that block)
//   - Deploy Cluster              (dual-version, 4 networks, +12 row offset 9.0→9.1)
//
// Per network: VLAN ID, MTU, Network (=cidrToNetwork(subnet)), Subnet
// Mask (=cidrToNetmask(subnet)), Default Gateway, IP Range Start, IP
// Range End. Network + Subnet Mask collaborate on import: Network
// applies first (stamping the bare network address into `subnet`),
// then Subnet Mask combines with the prior write to restore the full
// CIDR.
//
// "Host 1..16" cells on each sheet are workbook formulas that derive
// per-host IPs from the pool range — no stamping needed.
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
  createClusterNetworks,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

const MGMT_SHEET = "Configure Management Domain";
const WLD_SHEET = "Configure Workload Domain";
const DEPLOY_CL_SHEET = "Deploy Cluster";

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

describe("Theme 10 — createClusterNetworks", () => {
  it("includes poolName field defaulted to empty string", () => {
    const n = createClusterNetworks();
    expect(n.poolName).toBe("");
  });

  it("preserves all existing network blocks (no regression)", () => {
    const n = createClusterNetworks();
    expect(n.vmotion).toBeTruthy();
    expect(n.vsan).toBeTruthy();
    expect(n.hostTep).toBeTruthy();
    expect(n.edgeTep).toBeTruthy();
    expect(n.mgmt).toBeTruthy();
  });
});

describe("Theme 10 — newFleet wires poolName", () => {
  it("default mgmt cluster has empty poolName", () => {
    const f = newFleet();
    expect(mgmtCluster(f).networks.poolName).toBe("");
  });
});

describe("Theme 10 — WORKBOOK_CELL_MAP entries", () => {
  it("Configure Mgmt has Network Pool Name + 3 networks × 7 cells = 22 entries (9.1-only)", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === MGMT_SHEET && (e.label === "Network Pool Name" || /^(vMotion|vSAN|Host TEP)/.test(e.label))
    );
    expect(entries).toHaveLength(22);
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("mgmt-cluster");
    }
  });

  it("Configure WLD has Network Pool Name + 3 networks × 7 + edgeTep × 6 = 28 entries (9.1-only)", () => {
    // Theme 4 has an "Edge TEP VLAN" entry at D58/D59 (NSX Edge
    // cluster section) which the broad regex would also catch — scope
    // it to the cells theme 10 owns (D267+).
    const entries = WORKBOOK_CELL_MAP.filter((e) => {
      if (e.sheet !== WLD_SHEET) return false;
      if (!(e.label === "Network Pool Name" || /^(vMotion|vSAN|Host TEP|Edge TEP)/.test(e.label))) return false;
      const cell = (e.cellByVersion && e.cellByVersion["9.1"]) || e.cell;
      return /^D(2[6-9]\d|30[0-9])$/.test(cell);
    });
    expect(entries).toHaveLength(28);
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("workload-cluster");
    }
  });

  it("Configure WLD edgeTep has no IP Range End entry (cell absent in pristine workbook)", () => {
    const e = WORKBOOK_CELL_MAP.find(
      (x) => x.sheet === WLD_SHEET && x.label === "Edge TEP IP Range End"
    );
    expect(e).toBeFalsy();
  });

  it("Deploy Cluster has Network Pool Name + 4 networks × 7 = 29 entries (dual-version)", () => {
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_CL_SHEET && (e.label === "Network Pool Name" || /^(vMotion|vSAN|Host TEP|Edge TEP)/.test(e.label))
    );
    expect(entries).toHaveLength(29);
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.scope).toBe("additional-cluster");
    }
  });

  it("targets the documented cells for vMotion on Configure Mgmt 9.1", () => {
    const expected = {
      "vMotion VLAN ID": "D323",
      "vMotion MTU": "D324",
      "vMotion Network": "D325",
      "vMotion Subnet Mask": "D326",
      "vMotion Default Gateway": "D327",
      "vMotion IP Range Start": "D328",
      "vMotion IP Range End": "D329",
    };
    for (const [label, cell] of Object.entries(expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === MGMT_SHEET && x.label === label && x.scope === "mgmt-cluster");
      expect(e, `missing entry: ${label}`).toBeTruthy();
      expect(e.cellByVersion["9.1"]).toBe(cell);
    }
  });

  it("targets the documented cells for vMotion on Deploy Cluster (both versions)", () => {
    const expected = {
      "vMotion VLAN ID": ["D283", "D295"],
      "vMotion IP Range End": ["D289", "D301"],
    };
    for (const [label, [v90, v91]] of Object.entries(expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === DEPLOY_CL_SHEET && x.label === label && x.scope === "additional-cluster");
      expect(e.cell).toBe(v90);
      expect(e.cellByVersion["9.1"]).toBe(v91);
    }
  });
});

describe("Theme 10 — emit semantics", () => {
  it("emits Network + Subnet Mask derived from CIDR `subnet`", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === MGMT_SHEET && r.cell === cell);
    expect(find("D323").value).toBe("1612");          // VLAN
    expect(find("D324").value).toBe("9000");          // MTU
    expect(find("D325").value).toBe("10.0.12.0");     // Network (CIDR stripped)
    expect(find("D326").value).toBe("255.255.255.0"); // Subnet Mask (derived from /24)
    expect(find("D327").value).toBe("10.0.12.1");     // Gateway
    expect(find("D328").value).toBe("10.0.12.100");   // IP Range Start
    expect(find("D329").value).toBe("10.0.12.116");   // IP Range End
  });

  it("derives correct subnet mask for several CIDRs", () => {
    const cases = [
      ["10.0.0.0/8", "255.0.0.0"],
      ["10.0.0.0/16", "255.255.0.0"],
      ["10.0.0.0/24", "255.255.255.0"],
      ["10.0.0.0/30", "255.255.255.252"],
    ];
    for (const [cidr, expected] of cases) {
      const f = newFleet();
      f.vcfVersion = "9.1";
      mgmtCluster(f).networks.vmotion = { ...createClusterNetworks().vmotion, subnet: cidr };
      const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
      const mask = rows.find((r) => r.sheet === MGMT_SHEET && r.cell === "D326");
      expect(mask.value, `mask for ${cidr}`).toBe(expected);
    }
  });

  it("emits Network Pool Name", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.poolName = "mgmt-az1-pool";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = rows.find((r) => r.sheet === MGMT_SHEET && r.cell === "D321");
    expect(row.value).toBe("mgmt-az1-pool");
  });

  it("emits empty values for unconfigured networks", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.sheet === MGMT_SHEET && r.cell === "D325").value).toBe("");  // Network
    expect(rows.find((r) => r.sheet === MGMT_SHEET && r.cell === "D326").value).toBe("");  // Mask
  });
});

describe("Theme 10 — import round-trip", () => {
  it("Network + Subnet Mask combine into full CIDR on import", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    const c = mgmtCluster(original);
    c.networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };
    c.networks.vsan = {
      vlan: 1613, subnet: "10.0.13.0/24", gateway: "10.0.13.1",
      pool: { start: "10.0.13.100", end: "10.0.13.116" }, mtu: 9000,
    };
    c.networks.poolName = "mgmt-az1-pool";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const back = mgmtCluster(rebuilt);
    expect(back.networks.vmotion.vlan).toBe(1612);
    expect(back.networks.vmotion.subnet).toBe("10.0.12.0/24");
    expect(back.networks.vmotion.gateway).toBe("10.0.12.1");
    expect(back.networks.vmotion.pool.start).toBe("10.0.12.100");
    expect(back.networks.vmotion.pool.end).toBe("10.0.12.116");
    expect(back.networks.vmotion.mtu).toBe(9000);
    expect(back.networks.vsan.subnet).toBe("10.0.13.0/24");
    expect(back.networks.poolName).toBe("mgmt-az1-pool");
  });

  it("Deploy Cluster round-trip restores additional cluster networks (9.0)", () => {
    const original = fleetWithMultiClusterWld();
    original.vcfVersion = "9.0";
    const wld = original.instances[0].domains.find((d) => d.type === "workload");
    const additional = wld.clusters[1];
    additional.networks.edgeTep = {
      vlan: 1616, subnet: "10.0.16.0/24", gateway: "10.0.16.1",
      pool: { start: "10.0.16.50", end: "10.0.16.100" }, mtu: 1700,
    };
    additional.networks.poolName = "wld-cluster-02-pool";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    const wldRebuilt = rebuilt.instances[0].domains.find((d) => d.type === "workload");
    const backCl = wldRebuilt.clusters[1];
    expect(backCl.networks.edgeTep.subnet).toBe("10.0.16.0/24");
    expect(backCl.networks.edgeTep.pool.start).toBe("10.0.16.50");
    expect(backCl.networks.edgeTep.pool.end).toBe("10.0.16.100");
    expect(backCl.networks.poolName).toBe("wld-cluster-02-pool");
  });

  it("VLAN apply coerces non-numeric to null", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: MGMT_SHEET, cell: "D323", label: "vMotion VLAN ID", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vmotion.vlan).toBeNull();
  });

  it("MTU apply coerces non-numeric to null", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: MGMT_SHEET, cell: "D324", label: "vMotion MTU", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vmotion.mtu).toBeNull();
  });
});

describe("Theme 10 — migrate stability", () => {
  it("migrateFleet on a fleet with custom poolName preserves it (idempotent)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    mgmtCluster(f).networks.poolName = "preserved";
    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    expect(mgmtCluster(r2).networks.poolName).toBe("preserved");
  });
});
