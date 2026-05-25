// Theme 14 — Per-host ESX management IP table export.
//
// Scope of THIS PR (theme 14a — IP-only sweep, no model changes):
//   - Deploy WLD D63-D78 (9.0) / D62-D77 (9.1) — 16 hosts × mgmt IP,
//     workload-cluster-host scope
//   - Deploy Cluster D29-D44 (both versions) — 16 hosts × mgmt IP,
//     additional-cluster-host scope
//
// Deferred to follow-ups:
//   - Configure WLD AZ2 block (D248-D263) — stretched-cluster scenario
//   - Per-host vmotion/vsan/hostTep IPs (model has them; sheets don't
//     dedicate 16-row blocks for those networks today)
//   - Per-host hostname blocks on Deploy WLD / Deploy Cluster
//     (the canonical hostname expansion lives on Configure Mgmt and
//     already round-trips)
//
// resolve precedence per host:
//   1. cluster.hostOverrides[i].mgmtIp (explicit per-host override)
//   2. allocateClusterIps(cluster, 16, ctx).hosts[i].mgmtIp (pool)
//   3. "" when pool isn't configured
//
// apply writes to cluster.hostOverrides[i].mgmtIp and ensures the
// array has a slot for index i.
//
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// {9.0,9.1}.json 2026-05-25.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

function fleetWithWld(vcfVersion = "9.1") {
  const f = newFleet();
  f.vcfVersion = vcfVersion;
  f.version = "vcf-sizer-v9";
  f.instances[0].domains.push(newWorkloadDomain("WLD-01"));
  return f;
}

function wldCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
}

function fleetWithAdditionalCluster(vcfVersion = "9.1") {
  const f = fleetWithWld(vcfVersion);
  const wld = f.instances[0].domains.find((d) => d.type === "workload");
  wld.clusters.push(newWorkloadCluster("wld-cluster-02"));
  return f;
}

function additionalCluster(f) {
  return f.instances[0].domains.find((d) => d.type === "workload").clusters[1];
}

function setMgmtPool(cluster, start, end) {
  cluster.networks.mgmt = cluster.networks.mgmt || { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null } };
  cluster.networks.mgmt.pool = { start, end };
}

describe("Theme 14 — WORKBOOK_CELL_MAP entries", () => {
  it("Deploy WLD entry exists with correct cellPattern + scope + expansion", () => {
    const e = WORKBOOK_CELL_MAP.find((x) =>
      x.sheet === "Deploy Workload Domain" && x.scope === "workload-cluster-host" && /Management IP/.test(x.label)
    );
    expect(e).toBeTruthy();
    expect(e.cellPattern).toBe("D{63+i}");
    expect(e.cellPatternByVersion["9.1"]).toBe("D{62+i}");
    expect(e.expandsTo).toBe(16);
    expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
  });

  it("Deploy Cluster entry exists with single cellPattern (both versions use same address)", () => {
    const e = WORKBOOK_CELL_MAP.find((x) =>
      x.sheet === "Deploy Cluster" && x.scope === "additional-cluster-host" && /Management IP/.test(x.label)
    );
    expect(e).toBeTruthy();
    expect(e.cellPattern).toBe("D{29+i}");
    expect(e.cellPatternByVersion).toBeUndefined();           // identical on both versions
    expect(e.expandsTo).toBe(16);
  });
});

describe("Theme 14 — emit (Deploy WLD, workload-cluster-host)", () => {
  it("emits empty values when no pool and no overrides are set", () => {
    const f = fleetWithWld("9.1");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // All 16 host cells should emit empty.
    for (let i = 0; i < 16; i++) {
      const row = rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === `D${62 + i}`);
      expect(row, `host ${i + 1} row missing`).toBeTruthy();
      expect(row.value).toBe("");
    }
  });

  it("emits pool-derived IPs across 16 hosts on 9.1", () => {
    const f = fleetWithWld("9.1");
    setMgmtPool(wldCluster(f), "10.0.11.101", "10.0.11.116");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D62").value).toBe("10.0.11.101");
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D63").value).toBe("10.0.11.102");
    expect(rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D77").value).toBe("10.0.11.116");
  });

  it("emits per-host overrides ahead of pool fallback", () => {
    const f = fleetWithWld("9.1");
    setMgmtPool(wldCluster(f), "10.0.11.101", "10.0.11.116");
    wldCluster(f).hostOverrides = [
      { hostIndex: 0, mgmtIp: "10.0.11.200", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
    ];
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // Host 1 honors override.
    expect(rows.find((r) => r.cell === "D62" && r.sheet === "Deploy Workload Domain").value).toBe("10.0.11.200");
    // Host 2 onwards: pool sequence skips the override IP — so host 2 = pool start (101), not (102).
    // (allocator avoids overrideIps in the pool walk.)
    expect(rows.find((r) => r.cell === "D63" && r.sheet === "Deploy Workload Domain").value).toBe("10.0.11.101");
  });

  it("9.0 cells land at the -1 row offset (D63-D78)", () => {
    const f = fleetWithWld("9.0");
    setMgmtPool(wldCluster(f), "10.0.11.101", "10.0.11.116");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => r.cell === "D63" && r.sheet === "Deploy Workload Domain").value).toBe("10.0.11.101");
    expect(rows.find((r) => r.cell === "D78" && r.sheet === "Deploy Workload Domain").value).toBe("10.0.11.116");
  });
});

describe("Theme 14 — emit (Deploy Cluster, additional-cluster-host)", () => {
  it("emits empty when no additional cluster present", () => {
    const f = fleetWithWld("9.1");                            // 1 WLD cluster, no additional
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // No additional-cluster-host context → no Deploy Cluster host rows.
    const hostRows = rows.filter((r) => r.sheet === "Deploy Cluster" && /Additional Cluster Host/.test(r.label));
    expect(hostRows).toHaveLength(0);
  });

  it("emits pool-derived IPs on the second WLD cluster", () => {
    const f = fleetWithAdditionalCluster("9.1");
    setMgmtPool(additionalCluster(f), "10.0.21.101", "10.0.21.116");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.cell === "D29" && r.sheet === "Deploy Cluster").value).toBe("10.0.21.101");
    expect(rows.find((r) => r.cell === "D44" && r.sheet === "Deploy Cluster").value).toBe("10.0.21.116");
  });
});

describe("Theme 14 — import round-trip", () => {
  it("CSV round-trip rebuilds hostOverrides[i].mgmtIp from Deploy WLD cells", () => {
    const original = fleetWithWld("9.1");
    setMgmtPool(wldCluster(original), "10.0.11.101", "10.0.11.116");
    // Place a couple of explicit overrides so we test override round-trip.
    wldCluster(original).hostOverrides = [
      { hostIndex: 0, mgmtIp: "10.0.11.200", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
      { hostIndex: 1, mgmtIp: "10.0.11.201", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null, hostname: null },
    ];
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const back = wldCluster(rebuilt);
    // Verify each host's mgmtIp came back.
    expect(back.hostOverrides[0].mgmtIp).toBe("10.0.11.200");
    expect(back.hostOverrides[1].mgmtIp).toBe("10.0.11.201");
    // The pool-derived hosts 3..16 also round-trip via apply writing
    // back into hostOverrides[].
    expect(back.hostOverrides[2].mgmtIp).toBe("10.0.11.101");  // first pool IP not consumed by overrides
    expect(back.hostOverrides[15].mgmtIp).toBeTruthy();
  });

  it("apply skips empty values (workbook cells left blank)", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Workload Domain", cell: "D62", label: "WLD Host #1 Management IP", value: "10.0.11.50" },
      { workbookVersion: "9.1", sheet: "Deploy Workload Domain", cell: "D63", label: "WLD Host #2 Management IP", value: "" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const back = wldCluster(rebuilt);
    expect(back.hostOverrides[0].mgmtIp).toBe("10.0.11.50");
    // Host 2 row was empty — no entry created.
    expect(back.hostOverrides[1]).toBeUndefined();
  });
});

describe("Theme 14 — no regression on existing hostname expansion", () => {
  it("Configure Mgmt L82+i FQDN entry still uses mgmt-cluster-host scope", () => {
    const e = WORKBOOK_CELL_MAP.find((x) =>
      x.scope === "mgmt-cluster-host" && /FQDN/.test(x.label)
    );
    expect(e).toBeTruthy();
    expect(e.cellPatternByVersion["9.1"]).toBe("L{82+i}");
    expect(e.expandsTo).toBe(16);
  });
});
