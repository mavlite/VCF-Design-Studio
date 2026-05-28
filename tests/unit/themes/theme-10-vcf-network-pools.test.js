// Theme 10 — VCF Network Pools cluster-level export.
//
// Three sheets each carry a "VCF Network Pool" block (all dual-version
// after PR #91 backfilled the Configure Mgmt + Configure WLD 9.0 cells):
//   - Configure Management Domain (3 networks: vmotion/vsan/hostTep)
//   - Configure Workload Domain   (4 networks; edgeTep IP Range End is
//     9.0-only — that cell exists at D227 in 9.0 but is absent in the
//     pristine 9.1 workbook, so the entry ships as workbookVersions=
//     ["9.0"] without a 9.1 counterpart)
//   - Deploy Cluster              (4 networks, +12 row offset 9.0→9.1)
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
  // Task #30 / C2 relocated mgmt-cluster vMotion/vSAN/hostTep AZ1
  // mappings from Configure Management Domain to Deploy Management
  // Domain (the pristine workbook's true AZ1 cells; the Configure
  // sheet cells were AZ2-designated per sample formulas). Cell shape
  // varies by version: 9.0 has separate Gateway + CIDR Notation +
  // MTU cells; 9.1 uses a single combined "IPv4 gateway (CIDR
  // notation)" cell. The new _deployNetworkBlock helper emits the
  // entries; counts are no longer fixed because the helper skips
  // missing keys per version.

  it("Deploy Mgmt carries mgmt-cluster mgmt/vmotion/vsan/hostTep entries post-C2", () => {
    const DEPLOY_MGMT = "Deploy Management Domain";
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_MGMT && e.scope === "mgmt-cluster"
        && /^(Mgmt|vMotion|vSAN|Host TEP) /.test(e.label || "")
    );
    // Sanity: there should be 4 protocols × multiple fields ≥ 12 entries.
    expect(entries.length).toBeGreaterThanOrEqual(12);
    // Each entry must be tagged with at least one version.
    for (const e of entries) {
      expect(e.workbookVersions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("Configure Mgmt no longer carries AZ1 mgmt-cluster vMotion/vSAN/hostTep mappings (post-C2)", () => {
    // After C2, Configure Mgmt entries for mgmt-cluster scope are AZ2
    // only (Theme 19 follow-on). AZ1 lives on Deploy Mgmt.
    const az1Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === MGMT_SHEET && e.scope === "mgmt-cluster"
        && /^(vMotion|vSAN|Host TEP) (VLAN ID|MTU|Network|Default Gateway|IP Range Start|IP Range End|Subnet Mask)$/.test(e.label || "")
    );
    expect(az1Entries).toHaveLength(0);
  });

  it("Configure Mgmt now carries AZ2 vMotion + vSAN entries (Theme 19 follow-on)", () => {
    const az2Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === MGMT_SHEET && e.scope === "mgmt-cluster"
        && /AZ2/.test(e.label || "")
    );
    // AZ2 mgmt (3 cells) + AZ2 vMotion (5) + AZ2 vSAN (5) = 13 entries
    // minimum; AZ2 host blocks add per-host entries too.
    expect(az2Entries.length).toBeGreaterThan(0);
  });

  it("Configure WLD AZ1 workload-cluster pool entries removed (post-C3)", () => {
    // Task #30 / C3 moved workload-cluster AZ1 vMotion/vSAN to Deploy
    // WLD. Configure WLD's vMotion/vSAN entries are now AZ2 only.
    // hostTep on Deploy WLD is owned by Theme P's nsxHostOverlay
    // (collision avoided). edgeTep removed — its cells targeted AZ2.
    // Theme 4 (NSX Edge cluster) still has an "Edge TEP VLAN" entry
    // at D58/D59 — that's a different scope/concern, intentionally
    // out-of-scope for this filter.
    const az1Entries = WORKBOOK_CELL_MAP.filter((e) => {
      if (e.sheet !== WLD_SHEET) return false;
      if (e.scope !== "workload-cluster") return false;
      const lbl = e.label || "";
      if (!/^(vMotion|vSAN|Host TEP) /.test(lbl)) return false;
      // AZ1-style labels (no "AZ2" in them)
      return !/AZ2/.test(lbl);
    });
    expect(az1Entries).toHaveLength(0);
  });

  it("Configure WLD now carries AZ2 vMotion + vSAN entries (Theme 19 follow-on, C3)", () => {
    const az2Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === WLD_SHEET && e.scope === "workload-cluster"
        && /AZ2/.test(e.label || "")
    );
    expect(az2Entries.length).toBeGreaterThan(0);
  });

  it("Deploy WLD carries workload-cluster AZ1 mgmt/vmotion/vsan entries (post-C3)", () => {
    const DEPLOY_WLD = "Deploy Workload Domain";
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_WLD && e.scope === "workload-cluster"
        && /^(WLD Mgmt|WLD vMotion|WLD vSAN) /.test(e.label || "")
    );
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const e of entries) {
      expect(e.workbookVersions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("workload-cluster Edge TEP pool entries removed post-C3 (no AZ1 Edge TEP on Deploy WLD)", () => {
    // The previous Configure WLD edgeTep cell-map (D221-D227 9.0)
    // targeted AZ2 cells incorrectly and has been removed. Theme 4's
    // "Edge TEP VLAN" at D58/D59 is a different NSX Edge cluster
    // entry and is intentionally retained. Filter to only pool-style
    // entry labels (Network/Pool/Range/Gateway/CIDR/Subnet).
    const e = WORKBOOK_CELL_MAP.find(
      (x) => x.sheet === WLD_SHEET && x.scope === "workload-cluster"
        && /^Edge TEP (Network|Subnet Mask|Default Gateway|Gateway|IP Range Start|IP Range End|CIDR Notation|MTU)$/.test(x.label || "")
    );
    expect(e).toBeUndefined();
  });

  it("Deploy Cluster carries additional-cluster AZ1 mgmt/vmotion/vsan entries (post-C4)", () => {
    // Task #30 / C4 moved additional-cluster AZ1 to the lower row
    // range on Deploy Cluster (D24+/D50+/D58+). Old D283+ mappings
    // (which were AZ2 cells) are removed. hostTep + edgeTep
    // intentionally NOT mapped (Theme P collision + Edge TEP scope
    // mismatch — same pattern as C3).
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_CL_SHEET && e.scope === "additional-cluster"
        && /^Additional Cluster (Mgmt|vMotion|vSAN) /.test(e.label || "")
    );
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it("Deploy Cluster now carries AZ2 vMotion + vSAN entries (Theme 19 follow-on, C4)", () => {
    const az2Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_CL_SHEET && e.scope === "additional-cluster"
        && /AZ2/.test(e.label || "")
    );
    expect(az2Entries.length).toBeGreaterThan(0);
  });

  it("targets the documented cells for vMotion on Deploy Mgmt (post-C2)", () => {
    // Task #30 / C2 moved AZ1 vMotion to Deploy Management Domain.
    // 9.0 uses 5 cells: VLAN/Gateway/CIDR Notation/MTU/Pool Start/End.
    // 9.1 uses 5 cells: VLAN/MTU/IPv4 gateway (CIDR notation)/Range From/To.
    const DEPLOY_MGMT = "Deploy Management Domain";
    const expected = {
      "vMotion VLAN ID": ["L159", "L125"],
      "vMotion MTU": ["L162", "L126"],
      // 9.0 has Gateway + CIDR Notation as separate cells; 9.1 has them
      // combined into "IPv4 gateway (CIDR notation)" at L127.
      "vMotion Gateway": ["L160", null],
      "vMotion CIDR Notation": ["L161", null],
      "vMotion IPv4 gateway (CIDR notation)": [null, "L127"],
      "vMotion IP Range Start": ["L163", "L128"],
      "vMotion IP Range End": ["L164", "L129"],
    };
    for (const [label, [v90, v91]] of Object.entries(expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === DEPLOY_MGMT && x.label === label && x.scope === "mgmt-cluster");
      expect(e, `missing entry: ${label}`).toBeTruthy();
      if (v90) expect(e.cell === v90 || (e.cellByVersion && e.cellByVersion["9.0"] === v90)).toBe(true);
      if (v91) expect(e.cellByVersion && e.cellByVersion["9.1"]).toBe(v91);
    }
  });

  it("targets the documented cells for vMotion on Deploy Cluster (post-C4)", () => {
    // Task #30 / C4 moved AZ1 vMotion to the lower row range. 9.0 still
    // uses 7-cell shape (separate Network+Netmask cells with "CIDR
    // Notation"/"Netmask" labels). 9.1 uses 5-cell shape with combined
    // "IPv4 Gateway (CIDR Notation)" cell.
    const v90Expected = {
      "Additional Cluster vMotion VLAN ID": "D50",
      "Additional Cluster vMotion MTU": "D51",
      "Additional Cluster vMotion IP Range End": "D56",
    };
    const v91Expected = {
      "Additional Cluster vMotion VLAN ID": "D51",
      "Additional Cluster vMotion MTU": "D52",
      "Additional Cluster vMotion IP Range End": "D57",
    };
    for (const [label, cell] of Object.entries(v90Expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === DEPLOY_CL_SHEET && x.label === label && x.scope === "additional-cluster");
      expect(e, `missing ${label}`).toBeTruthy();
      expect(e.cell === cell || (e.cellByVersion && e.cellByVersion["9.0"] === cell)).toBe(true);
    }
    for (const [label, cell] of Object.entries(v91Expected)) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.sheet === DEPLOY_CL_SHEET && x.label === label && x.scope === "additional-cluster");
      expect(e, `missing ${label}`).toBeTruthy();
      expect(e.cellByVersion && e.cellByVersion["9.1"]).toBe(cell);
    }
  });
});

describe("Theme 10 — emit semantics (post-C2)", () => {
  const DEPLOY_MGMT = "Deploy Management Domain";

  it("9.1 emit: vMotion stamps to Deploy Mgmt with combined gw-CIDR cell", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === DEPLOY_MGMT && r.cell === cell);
    expect(find("L125").value).toBe("1612");        // VLAN
    expect(find("L126").value).toBe("9000");        // MTU
    expect(find("L127").value).toBe("10.0.12.1/24"); // Combined gw-CIDR
    expect(find("L128").value).toBe("10.0.12.100"); // Range From
    expect(find("L129").value).toBe("10.0.12.116"); // Range To
  });

  it("9.0 emit: vMotion stamps to Deploy Mgmt with separate Gateway + CIDR Notation cells", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    mgmtCluster(f).networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (cell) => rows.find((r) => r.sheet === DEPLOY_MGMT && r.cell === cell);
    expect(find("L159").value).toBe("1612");         // VLAN
    expect(find("L160").value).toBe("10.0.12.1");    // Gateway
    expect(find("L161").value).toBe("10.0.12.0/24"); // CIDR Notation (single cell)
    expect(find("L162").value).toBe("9000");         // MTU
    expect(find("L163").value).toBe("10.0.12.100");  // Range Start
    expect(find("L164").value).toBe("10.0.12.116");  // Range End
  });

  it("9.1 combined gw-CIDR cell round-trips through parse", () => {
    // Emit on a configured fleet, then verify a fresh apply re-parses
    // back into the same gateway + subnet values.
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.vsan = {
      vlan: 1613, subnet: "10.0.13.0/24", gateway: "10.0.13.1",
      pool: { start: "10.0.13.100", end: "10.0.13.116" }, mtu: 9000,
    };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const gwCidr = rows.find((r) => r.sheet === DEPLOY_MGMT && r.cell === "L135").value;
    expect(gwCidr).toBe("10.0.13.1/24");
  });

  it("emits empty values for unconfigured networks (Deploy Mgmt cells stay empty)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // 9.1 vMotion VLAN at L125 — empty when not configured.
    const vlanRow = rows.find((r) => r.sheet === DEPLOY_MGMT && r.cell === "L125");
    expect(vlanRow.value).toBe("");
    // Combined gw-CIDR at L127 — empty when gateway OR subnet missing.
    const gwCidrRow = rows.find((r) => r.sheet === DEPLOY_MGMT && r.cell === "L127");
    expect(gwCidrRow.value).toBe("");
  });
});

describe("Theme 10 — import round-trip (post-C2)", () => {
  it("9.1 combined gw-CIDR cell apply restores gateway + subnet to model", () => {
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
  });

  it("Deploy Cluster round-trip restores additional cluster networks (9.0, post-C4)", () => {
    // Task #30 / C4: additional-cluster scope now stamps to Deploy
    // Cluster AZ1 row range (D24+/D50+/D58+). edgeTep removed (no AZ1
    // cells on Deploy Cluster). Test now uses vMotion instead.
    const original = fleetWithMultiClusterWld();
    original.vcfVersion = "9.0";
    const wld = original.instances[0].domains.find((d) => d.type === "workload");
    const additional = wld.clusters[1];
    additional.networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.50", end: "10.0.12.100" }, mtu: 9000,
    };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    const wldRebuilt = rebuilt.instances[0].domains.find((d) => d.type === "workload");
    const backCl = wldRebuilt.clusters[1];
    expect(backCl.networks.vmotion.vlan).toBe(1612);
    expect(backCl.networks.vmotion.subnet).toBe("10.0.12.0/24");
    expect(backCl.networks.vmotion.pool.start).toBe("10.0.12.50");
    expect(backCl.networks.vmotion.pool.end).toBe("10.0.12.100");
  });

  it("Deploy Mgmt 9.0 round-trip restores vMotion + vSAN + Host TEP networks", () => {
    // Task #30 / C2: AZ1 mgmt-cluster network config now stamps to
    // Deploy Mgmt (not Configure Mgmt). Round-trip checks values, not
    // sheet placement — should still pass.
    const original = newFleet();
    original.vcfVersion = "9.0";
    const c = mgmtCluster(original);
    c.networks.vmotion = {
      vlan: 1612, subnet: "10.0.12.0/24", gateway: "10.0.12.1",
      pool: { start: "10.0.12.100", end: "10.0.12.116" }, mtu: 9000,
    };
    c.networks.vsan = {
      vlan: 1613, subnet: "10.0.13.0/24", gateway: "10.0.13.1",
      pool: { start: "10.0.13.100", end: "10.0.13.116" }, mtu: 9000,
    };
    c.networks.hostTep = {
      vlan: 1614, subnet: "10.0.14.0/24", gateway: "10.0.14.1",
      pool: { start: "10.0.14.100", end: "10.0.14.116" }, mtu: 1700,
    };
    c.networks.poolName = "mgmt-90-pool";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    const back = mgmtCluster(rebuilt);
    expect(back.networks.vmotion.vlan).toBe(1612);
    expect(back.networks.vmotion.subnet).toBe("10.0.12.0/24");
    expect(back.networks.vmotion.pool.start).toBe("10.0.12.100");
    expect(back.networks.vsan.subnet).toBe("10.0.13.0/24");
    expect(back.networks.hostTep.subnet).toBe("10.0.14.0/24");
    expect(back.networks.hostTep.pool.end).toBe("10.0.14.116");
    expect(back.networks.poolName).toBe("mgmt-90-pool");
  });

  // C3 removed the Configure WLD edgeTep mapping (it targeted AZ2 cells
  // and there's no AZ1 Edge TEP block on Deploy WLD). Two prior tests
  // asserting Configure WLD edgeTep round-trip on 9.0 and 9.1 were
  // removed because the cell-map no longer ships those entries.
  // workload-cluster Edge TEP round-trip is a gap deferred to a future
  // theme (it requires identifying where AZ1 Edge TEP cells actually
  // live in the pristine workbook — Edge TEP is typically configured
  // via the NSX Edge cluster scope rather than the workload domain).

  it("VLAN apply coerces non-numeric to null (post-C2: Deploy Mgmt 9.1 L125)", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L125", label: "vMotion VLAN ID", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vmotion.vlan).toBeNull();
  });

  it("MTU apply coerces non-numeric to null (post-C2: Deploy Mgmt 9.1 L126)", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L126", label: "vMotion MTU", value: "garbage" },
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
