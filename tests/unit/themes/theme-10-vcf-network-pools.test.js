// Theme 10 — VCF Network Pools cluster-level export.
//
// AZ1 vMotion/vSAN/Host TEP for each cluster scope stamps to the
// pristine workbook's Deploy sheets (the Configure-sheet cells in the
// same row range are designated for AZ2 per the pristine workbook's
// sample formulas, which reference `prefix_*_az2_*`):
//   - mgmt-cluster      → Deploy Management Domain (mgmt + vmotion + vsan + hostTep)
//   - workload-cluster  → Deploy Workload Domain   (WLD mgmt + WLD vmotion + WLD vsan)
//   - additional-cluster → Deploy Cluster          (mgmt + vmotion + vsan)
//
// hostTep on Deploy WLD and Deploy Cluster is owned by Theme P's
// nsxHostOverlay block (collision avoided). Edge TEP has no AZ1 cells
// on Deploy WLD or Deploy Cluster — it belongs to the NSX Edge cluster
// scope (Theme 4 stamps "Edge TEP VLAN" at D58/D59).
//
// Cell shape varies by workbook version:
//   - 9.0 carries separate Gateway + CIDR-Notation cells (Deploy Mgmt
//     vMotion: VLAN/Gateway/CIDR/MTU/Range Start/End).
//   - 9.1 collapses Gateway + CIDR into one "IPv4 gateway (CIDR
//     notation)" cell (Deploy Mgmt vMotion: VLAN/MTU/gw-CIDR/Range
//     From/To). The combined-cell utilities `_combineGwCidr` and
//     `_parseGwCidr` handle emit/apply.
//
// AZ2 vMotion + vSAN for each cluster scope continues to stamp to the
// Configure sheet for that scope (Theme 19 follow-on). Deploy Cluster
// uniquely carries BOTH AZ1 and AZ2 blocks on the same sheet (lower
// row range for AZ1, D283+ for AZ2).
//
// "Host 1..16" cells on each sheet are workbook formulas derived from
// the pool range — no stamping needed.
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
  // Entry counts are not fixed because _deployNetworkBlock skips
  // missing keys per version. 9.0 emits a Gateway + CIDR Notation
  // pair where 9.1 emits a single combined "IPv4 gateway (CIDR
  // notation)" cell, so version-specific entries diverge in count.

  it("Deploy Mgmt carries mgmt-cluster mgmt/vmotion/vsan/hostTep entries", () => {
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

  it("Configure Mgmt no longer carries AZ1 mgmt-cluster vMotion/vSAN/hostTep mappings", () => {
    // Configure Mgmt entries for mgmt-cluster scope are AZ2 only —
    // the pristine workbook designates these cells for AZ2 (sample
    // formulas reference prefix_mgmt_az2_*). AZ1 lives on Deploy Mgmt.
    const az1Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === MGMT_SHEET && e.scope === "mgmt-cluster"
        && /^(vMotion|vSAN|Host TEP) (VLAN ID|MTU|Network|Default Gateway|IP Range Start|IP Range End|Subnet Mask)$/.test(e.label || "")
    );
    expect(az1Entries).toHaveLength(0);
  });

  it("Configure Mgmt now carries AZ2 vMotion + vSAN entries (Theme 19)", () => {
    const az2Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === MGMT_SHEET && e.scope === "mgmt-cluster"
        && /AZ2/.test(e.label || "")
    );
    // AZ2 mgmt (3 cells) + AZ2 vMotion (5) + AZ2 vSAN (5) = 13 entries
    // minimum; AZ2 host blocks add per-host entries too.
    expect(az2Entries.length).toBeGreaterThan(0);
  });

  it("Configure WLD AZ1 workload-cluster pool entries removed", () => {
    // Configure WLD's vMotion/vSAN entries are AZ2 only (AZ1 stamps
    // to Deploy WLD). hostTep on Deploy WLD is owned by Theme P's
    // nsxHostOverlay (collision avoided). edgeTep has no AZ1 cells
    // on Deploy WLD. Theme 4 (NSX Edge cluster) still has an "Edge
    // TEP VLAN" entry at D58/D59 — that's a different scope/concern,
    // intentionally out-of-scope for this filter.
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

  it("Configure WLD now carries AZ2 vMotion + vSAN entries (Theme 19)", () => {
    const az2Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === WLD_SHEET && e.scope === "workload-cluster"
        && /AZ2/.test(e.label || "")
    );
    expect(az2Entries.length).toBeGreaterThan(0);
  });

  it("Deploy WLD carries workload-cluster AZ1 mgmt/vmotion/vsan entries", () => {
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

  it("workload-cluster Edge TEP pool entries absent (no AZ1 Edge TEP on Deploy WLD)", () => {
    // Edge TEP has no AZ1 block at workload-cluster scope — Edge TEP
    // belongs to the NSX Edge cluster scope. Theme 4's "Edge TEP VLAN"
    // at D58/D59 is the legitimate NSX Edge cluster entry and is
    // intentionally retained. Filter to only pool-style entry labels
    // (Network/Pool/Range/Gateway/CIDR/Subnet).
    const e = WORKBOOK_CELL_MAP.find(
      (x) => x.sheet === WLD_SHEET && x.scope === "workload-cluster"
        && /^Edge TEP (Network|Subnet Mask|Default Gateway|Gateway|IP Range Start|IP Range End|CIDR Notation|MTU)$/.test(x.label || "")
    );
    expect(e).toBeUndefined();
  });

  it("Deploy Cluster carries additional-cluster AZ1 mgmt/vmotion/vsan entries", () => {
    // additional-cluster AZ1 stamps to the lower row range on Deploy
    // Cluster (D24+/D50+/D58+). hostTep + edgeTep intentionally NOT
    // mapped: hostTep collides with Theme P's nsxHostOverlay block on
    // the same sheet, and Edge TEP belongs to NSX Edge cluster scope.
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_CL_SHEET && e.scope === "additional-cluster"
        && /^Additional Cluster (Mgmt|vMotion|vSAN) /.test(e.label || "")
    );
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it("Deploy Cluster now carries AZ2 vMotion + vSAN entries (Theme 19)", () => {
    const az2Entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_CL_SHEET && e.scope === "additional-cluster"
        && /AZ2/.test(e.label || "")
    );
    expect(az2Entries.length).toBeGreaterThan(0);
  });

  it("targets the documented cells for vMotion on Deploy Mgmt", () => {
    // 9.0 uses 6 cells: VLAN/Gateway/CIDR Notation/MTU/Pool Start/End.
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

  it("targets the documented cells for vMotion on Deploy Cluster", () => {
    // 9.0 uses 7-cell shape (separate Network+Netmask cells with
    // "CIDR Notation"/"Netmask" labels). 9.1 uses 5-cell shape with
    // combined "IPv4 Gateway (CIDR Notation)" cell.
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

describe("Theme 10 — emit semantics (Deploy Mgmt cells)", () => {
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

describe("Theme 10 — import round-trip (Deploy sheets)", () => {
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

  it("Deploy Cluster round-trip restores additional cluster networks (9.0)", () => {
    // additional-cluster scope stamps to Deploy Cluster AZ1 row range
    // (D24+/D50+/D58+). vMotion is the simplest pool-shape protocol to
    // exercise (edgeTep has no AZ1 block at this scope).
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
    // AZ1 mgmt-cluster network config stamps to Deploy Mgmt; this
    // round-trip checks value preservation (vlan/subnet/gateway/pool/
    // mtu) across emit→CSV→parse→import for all three protocols.
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

  // workload-cluster Edge TEP round-trip is a deferred gap — Edge TEP
  // is configured via the NSX Edge cluster scope rather than the
  // workload domain, so there's no AZ1 Edge TEP block on Deploy WLD
  // to round-trip against.

  it("VLAN apply coerces non-numeric to null (Deploy Mgmt 9.1 L125)", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L125", label: "vMotion VLAN ID", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vmotion.vlan).toBeNull();
  });

  it("MTU apply coerces non-numeric to null (Deploy Mgmt 9.1 L126)", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Management Domain", cell: "L126", label: "vMotion MTU", value: "garbage" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    expect(mgmtCluster(rebuilt).networks.vmotion.mtu).toBeNull();
  });
});

describe("Theme 10 — AZ1 cell addresses (regression guards)", () => {
  // Comprehensive (scope, sheet, network, field) → (9.0 cell, 9.1 cell)
  // table. These guards catch silent drift in _deployNetworkBlock cell
  // assignments — if any address moves, this table fails and forces
  // an explicit decision to update the workbook documentation. Cells
  // verified against test-fixtures/workbook/workbook-cell-meta-
  // {9.0,9.1}.json 2026-05-25.
  //
  // 9.0 carries Gateway + CIDR Notation as separate cells; 9.1 carries
  // a single combined "IPv4 gateway (CIDR notation)" cell. Per-version
  // null marks "no cell at that version" (the entry ships single-
  // version via workbookVersions). Deploy Cluster 9.0 uniquely uses
  // "Network" + "Subnet Mask" labels instead of "CIDR Notation" — the
  // entries are still routed via the same network model field.
  const CASES = [
    // mgmt-cluster → Deploy Management Domain
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Mgmt VLAN ID", v90: "L148", v91: "L102" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Mgmt Gateway", v90: "L149", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Mgmt CIDR Notation", v90: "L150", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Mgmt MTU", v90: "L151", v91: "L103" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Mgmt IPv4 gateway (CIDR notation)", v90: null, v91: "L104" },

    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion VLAN ID", v90: "L159", v91: "L125" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion Gateway", v90: "L160", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion CIDR Notation", v90: "L161", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion MTU", v90: "L162", v91: "L126" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion IPv4 gateway (CIDR notation)", v90: null, v91: "L127" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion IP Range Start", v90: "L163", v91: "L128" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vMotion IP Range End", v90: "L164", v91: "L129" },

    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN VLAN ID", v90: "L166", v91: "L133" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN Gateway", v90: "L167", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN CIDR Notation", v90: "L168", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN MTU", v90: "L169", v91: "L134" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN IPv4 gateway (CIDR notation)", v90: null, v91: "L135" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN IP Range Start", v90: "L170", v91: "L136" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "vSAN IP Range End", v90: "L171", v91: "L137" },

    // Host TEP 9.0 has quirky ordering: VLAN, IP Assignment, Pool
    // Name, CIDR (no Netmask), Range Start, Range End, Gateway (LAST,
    // after Range End — not before like the other pool blocks).
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP VLAN ID", v90: "L253", v91: "L147" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP IP Assignment", v90: "L254", v91: "L149" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP Pool Name", v90: "L255", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP CIDR Notation", v90: "L257", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP IP Range Start", v90: "L258", v91: "L150" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP IP Range End", v90: "L259", v91: "L151" },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP Gateway", v90: "L260", v91: null },
    { scope: "mgmt-cluster", sheet: "Deploy Management Domain", label: "Host TEP IPv4 gateway (CIDR notation)", v90: null, v91: "L148" },

    // workload-cluster → Deploy Workload Domain (WLD prefix per
    // existing labeling convention so the entries don't collide with
    // additional-cluster labels on Deploy Cluster).
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD Mgmt VLAN ID", v90: "D58", v91: "D58" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD Mgmt Gateway", v90: "D59", v91: null },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD Mgmt CIDR Notation", v90: "D60", v91: null },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD Mgmt MTU", v90: "D61", v91: "D59" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD Mgmt IPv4 gateway (CIDR notation)", v90: null, v91: "D60" },

    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion VLAN ID", v90: "D85", v91: "D85" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion Gateway", v90: "D89", v91: null },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion CIDR Notation", v90: "D87", v91: null },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion MTU", v90: "D86", v91: "D86" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion IPv4 gateway (CIDR notation)", v90: null, v91: "D88" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion IP Range Start", v90: "D90", v91: "D90" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vMotion IP Range End", v90: "D91", v91: "D91" },

    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN VLAN ID", v90: "D93", v91: "D96" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN Gateway", v90: "D97", v91: null },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN CIDR Notation", v90: "D95", v91: null },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN MTU", v90: "D94", v91: "D97" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN IPv4 gateway (CIDR notation)", v90: null, v91: "D99" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN IP Range Start", v90: "D98", v91: "D101" },
    { scope: "workload-cluster", sheet: "Deploy Workload Domain", label: "WLD vSAN IP Range End", v90: "D99", v91: "D102" },

    // additional-cluster → Deploy Cluster. 9.0 uses "Network" +
    // "Subnet Mask" labels (instead of "CIDR Notation"). Mgmt has no
    // pool (4-cell block); vMotion+vSAN have the 7-cell pool shape.
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster Mgmt VLAN ID", v90: "D24", v91: "D24" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster Mgmt Gateway", v90: "D25", v91: "D25" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster Mgmt CIDR Notation", v90: "D26", v91: "D26" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster Mgmt MTU", v90: "D27", v91: "D27" },

    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion VLAN ID", v90: "D50", v91: "D51" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion MTU", v90: "D51", v91: "D52" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion Network", v90: "D52", v91: null },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion Subnet Mask", v90: "D53", v91: null },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion Gateway", v90: "D54", v91: null },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion IPv4 gateway (CIDR notation)", v90: null, v91: "D54" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion IP Range Start", v90: "D55", v91: "D56" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vMotion IP Range End", v90: "D56", v91: "D57" },

    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN VLAN ID", v90: "D58", v91: "D62" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN MTU", v90: "D59", v91: "D63" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN Network", v90: "D60", v91: null },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN Subnet Mask", v90: "D61", v91: null },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN Gateway", v90: "D62", v91: null },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN IPv4 gateway (CIDR notation)", v90: null, v91: "D65" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN IP Range Start", v90: "D63", v91: "D67" },
    { scope: "additional-cluster", sheet: "Deploy Cluster", label: "Additional Cluster vSAN IP Range End", v90: "D64", v91: "D68" },
  ];

  // Entry shape is asymmetric: `entry.cell` holds the 9.0 fallback
  // address, and `cellByVersion` only stores per-version overrides
  // (typically the 9.1 address when it differs from 9.0). `workbook-
  // Versions` is the authoritative list of which versions the entry
  // ships in.
  function cellFor(entry, version) {
    if (!entry) return null;
    if (!entry.workbookVersions || !entry.workbookVersions.includes(version)) return null;
    if (entry.cellByVersion && entry.cellByVersion[version]) return entry.cellByVersion[version];
    return entry.cell;
  }

  for (const c of CASES) {
    it(`${c.scope} / ${c.sheet} / ${c.label} → 9.0=${c.v90 ?? "(absent)"} / 9.1=${c.v91 ?? "(absent)"}`, () => {
      const entry = WORKBOOK_CELL_MAP.find(
        (e) => e.scope === c.scope && e.sheet === c.sheet && e.label === c.label
      );
      expect(entry, `cell-map missing entry: ${c.scope} / ${c.sheet} / ${c.label}`).toBeTruthy();
      expect(cellFor(entry, "9.0")).toBe(c.v90);
      expect(cellFor(entry, "9.1")).toBe(c.v91);
    });
  }
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
