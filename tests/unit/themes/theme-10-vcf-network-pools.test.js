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

  it("Configure WLD has Network Pool Name + 3 networks × 7 + edgeTep × 7 = 29 entries (all dual or 9.0-only)", () => {
    // Theme 4 has an "Edge TEP VLAN" entry at D58/D59 (NSX Edge
    // cluster section) which the broad regex would also catch — scope
    // it to the cells theme 10 owns. The Configure WLD edgeTep block
    // gained a 9.0-only IP Range End entry (D227) since the 9.0
    // workbook has it but the 9.1 workbook doesn't.
    const entries = WORKBOOK_CELL_MAP.filter((e) => {
      if (e.sheet !== WLD_SHEET) return false;
      if (!(e.label === "Network Pool Name" || /^(vMotion|vSAN|Host TEP|Edge TEP)/.test(e.label))) return false;
      const cell = (e.cellByVersion && e.cellByVersion["9.1"]) || e.cell;
      // After backfill, entries can live at 9.0 (D195-D227) OR 9.1
      // (D269-D300) addresses. Scope by either set.
      return /^D(19[5-9]|2[0-9]\d|30[0-9])$/.test(cell);
    });
    expect(entries).toHaveLength(29);
    for (const e of entries) {
      expect(e.scope).toBe("workload-cluster");
      // 9.0-only Edge TEP IP Range End vs dual-version everything else.
      if (e.label === "Edge TEP IP Range End") {
        expect(e.workbookVersions).toEqual(["9.0"]);
      } else {
        expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      }
    }
  });

  it("Configure WLD edgeTep IP Range End is 9.0-only (cell absent in 9.1 pristine workbook)", () => {
    const e = WORKBOOK_CELL_MAP.find(
      (x) => x.sheet === WLD_SHEET && x.label === "Edge TEP IP Range End"
    );
    expect(e).toBeTruthy();
    expect(e.cell).toBe("D227");
    expect(e.workbookVersions).toEqual(["9.0"]);
    expect(e.cellByVersion).toBeFalsy();
  });

  it("Deploy Cluster has Network Pool Name + 4 networks × 7 = 29 entries (dual-version)", () => {
    // Theme 18 adds IPv6 sub-block entries with overlapping label prefixes
    // (e.g. "vMotion IPv6 GW CIDR"); Theme 12 adds "vSAN Compute Site
    // Network Topology" / "vSAN Compute Fault Domain Mapping"; Theme M
    // adds "vMotion PG (Deploy Cluster) ...", "vSAN Storage Client PG..."
    // labels. Exclude all three so the count reflects only theme 10's
    // pool entries.
    const entries = WORKBOOK_CELL_MAP.filter(
      (e) => e.sheet === DEPLOY_CL_SHEET
        && !/IPv6/.test(e.label)
        && !/^vSAN Compute /.test(e.label)
        && !/ PG \(/.test(e.label)
        && (e.label === "Network Pool Name" || /^(vMotion|vSAN|Host TEP|Edge TEP)/.test(e.label))
    );
    expect(entries).toHaveLength(29);
    for (const e of entries) {
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.scope).toBe("additional-cluster");
    }
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

  it("Configure WLD 9.0 round-trip restores all 4 networks including edgeTep with End", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
    const wld = f.instances[0].domains.find((d) => d.type === "workload");
    const c = wld.clusters[0];
    c.networks.edgeTep = {
      vlan: 1616, subnet: "10.0.16.0/24", gateway: "10.0.16.1",
      pool: { start: "10.0.16.50", end: "10.0.16.250" }, mtu: 1700,
    };
    const csv = emitWorkbookCellMapCsv(f, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    const back = rebuilt.instances[0].domains.find((d) => d.type === "workload").clusters[0];
    expect(back.networks.edgeTep.vlan).toBe(1616);
    expect(back.networks.edgeTep.subnet).toBe("10.0.16.0/24");
    expect(back.networks.edgeTep.pool.start).toBe("10.0.16.50");
    // 9.0-only IP Range End round-trips on 9.0 (would silently drop on 9.1).
    expect(back.networks.edgeTep.pool.end).toBe("10.0.16.250");
  });

  it("Configure WLD Edge TEP IP Range End is dropped on 9.1 round-trip (no workbook cell)", () => {
    // Asymmetric workbook coverage: the 9.0 workbook has a Configure WLD
    // edgeTep IP Range End cell at D227; the 9.1 workbook does NOT carry
    // that row. The cell-map ships the entry as workbookVersions=["9.0"].
    // Emit on 9.1 must produce no row for the End; CSV round-trip on 9.1
    // therefore loses any edgeTep.pool.end value that was on the source
    // fleet. This test documents the lossy boundary so a future change
    // either re-adds the 9.1 cell or surfaces the loss to the UI.
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
    const wld = f.instances[0].domains.find((d) => d.type === "workload");
    const c = wld.clusters[0];
    c.networks.edgeTep = {
      vlan: 1616, subnet: "10.0.16.0/24", gateway: "10.0.16.1",
      pool: { start: "10.0.16.50", end: "10.0.16.250" }, mtu: 1700,
    };
    // 9.1 emit: no row for Edge TEP IP Range End anywhere.
    const rows91 = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows91.find((r) => r.label === "Edge TEP IP Range End" && r.sheet === WLD_SHEET)).toBeUndefined();
    // The cell-map entry IS present, just gated out of 9.1.
    const entry = WORKBOOK_CELL_MAP.find((x) => x.sheet === WLD_SHEET && x.label === "Edge TEP IP Range End");
    expect(entry).toBeTruthy();
    expect(entry.workbookVersions).toEqual(["9.0"]);
    // 9.1 CSV round-trip drops edgeTep.pool.end (no cell stamped → no
    // value to re-apply on import).
    const csv = emitWorkbookCellMapCsv(f, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });
    const back = rebuilt.instances[0].domains.find((d) => d.type === "workload").clusters[0];
    // Start round-trips; End does not.
    expect(back.networks.edgeTep.pool.start).toBe("10.0.16.50");
    expect(back.networks.edgeTep.pool.end == null).toBe(true);
  });

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
