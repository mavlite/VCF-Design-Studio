// Theme 18 — Dual-stack IPv6 fields (9.1-only).
//
// Per-network IPv6 sub-block on cluster.networks[type].ipv6 carrying
// gatewayCidr / rangeStart / rangeEnd. Plus a cluster-wide
// cluster.networks.dualStackIpv6 toggle that stamps Deploy WLD D162
// ("Dual Stack (IPv6 and IPv4) Networking" → Include / Exclude).
//
// Cell layout (all 9.1-only):
//   Deploy WLD vMotion   D89 GW, D92/D93 range
//                        (verifyLabel: "IPv6 IP Range Start :" — note "IP" prefix + space)
//   Deploy WLD vSAN      D100 GW, D103/D104 range
//   Deploy WLD hostTep   D111 GW, D114/D115 range
//   Deploy WLD edgeTep   D122 GW, D125/D126 range
//   Deploy WLD toggle    D162
//   Deploy Cluster vMotion  D55 GW, D58/D59 range
//   Deploy Cluster vSAN     D66 GW, D69/D70 range
//   Deploy Cluster hostTep  D77 GW, D80/D81 range
//   Deploy Cluster edgeTep  D88 GW, D91/D92 range
//
// 25 entries × 1 version (9.1) = 25 entry/version combinations.
//
// Cells verified against test-fixtures/workbook/workbook-cell-meta-
// 9.1.json 2026-05-25.
//
// Deferred: Configure Mgmt IPv6 cells (L105/L110/L115/L119-120/
// L130-131/L138-139) target mgmt-host / mgmt-VM / vcf-mgmt sub-types
// the studio model doesn't split yet.

import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrateFleet,
  createNetworkIpv6,
  createClusterNetworks,
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

describe("Theme 18 — factory + model", () => {
  it("createNetworkIpv6 returns the documented empty block", () => {
    expect(createNetworkIpv6()).toEqual({ gatewayCidr: "", rangeStart: "", rangeEnd: "" });
  });

  it("createClusterNetworks initializes ipv6 on every network", () => {
    const n = createClusterNetworks();
    for (const key of ["mgmt", "vmotion", "vsan", "hostTep", "edgeTep"]) {
      expect(n[key].ipv6).toEqual(createNetworkIpv6());
    }
  });

  it("createClusterNetworks initializes dualStackIpv6 to false", () => {
    expect(createClusterNetworks().dualStackIpv6).toBe(false);
  });
});

describe("Theme 18 — migrateFleet backfill", () => {
  it("backfills ipv6 on legacy networks", () => {
    const raw = { ...newFleet(), version: "vcf-sizer-v9" };
    // Strip ipv6 from each network as if loaded from an older JSON.
    const mgmt = raw.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
    for (const k of ["mgmt", "vmotion", "vsan", "hostTep", "edgeTep"]) {
      delete mgmt.networks[k].ipv6;
    }
    delete mgmt.networks.dualStackIpv6;
    const migrated = migrateFleet(raw);
    const back = migrated.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
    for (const k of ["mgmt", "vmotion", "vsan", "hostTep", "edgeTep"]) {
      expect(back.networks[k].ipv6).toEqual(createNetworkIpv6());
    }
    expect(back.networks.dualStackIpv6).toBe(false);
  });

  it("preserves user-customized ipv6 values on round-trip", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    const mgmt = f.instances[0].domains[0].clusters[0];
    mgmt.networks.vmotion.ipv6 = { gatewayCidr: "2001:db8:1::/64", rangeStart: "2001:db8:1::10", rangeEnd: "2001:db8:1::50" };
    mgmt.networks.dualStackIpv6 = true;
    const r1 = migrateFleet(f);
    const r2 = migrateFleet(r1);
    const back = r2.instances[0].domains[0].clusters[0];
    expect(back.networks.vmotion.ipv6.gatewayCidr).toBe("2001:db8:1::/64");
    expect(back.networks.vmotion.ipv6.rangeStart).toBe("2001:db8:1::10");
    expect(back.networks.dualStackIpv6).toBe(true);
  });

  it("dualStackIpv6 coerces non-boolean to false (whitelist)", () => {
    const f = { ...newFleet(), version: "vcf-sizer-v9" };
    f.instances[0].domains[0].clusters[0].networks.dualStackIpv6 = "yes";    // bogus
    const migrated = migrateFleet(f);
    expect(migrated.instances[0].domains[0].clusters[0].networks.dualStackIpv6).toBe(false);
  });
});

describe("Theme 18 — WORKBOOK_CELL_MAP entries (9.1-only)", () => {
  const NETWORKS = ["vMotion", "vSAN", "Host TEP", "Edge TEP"];
  const FIELDS = ["IPv6 Gateway CIDR", "IPv6 Range Start", "IPv6 Range End"];

  it("Deploy WLD: 12 per-network entries + 1 dual-stack toggle = 13 total", () => {
    const entries = WORKBOOK_CELL_MAP.filter((e) =>
      e.sheet === "Deploy Workload Domain" &&
      (FIELDS.some((f) => e.label.endsWith(f)) || e.label === "WLD Dual Stack IPv6 Enabled")
    );
    expect(entries).toHaveLength(13);
    for (const e of entries) expect(e.workbookVersions).toEqual(["9.1"]);
  });

  it("Deploy Cluster: 12 per-network entries", () => {
    const entries = WORKBOOK_CELL_MAP.filter((e) =>
      e.sheet === "Deploy Cluster" && FIELDS.some((f) => e.label.endsWith(f))
    );
    expect(entries).toHaveLength(12);
    for (const e of entries) expect(e.workbookVersions).toEqual(["9.1"]);
  });

  it("Deploy WLD vMotion targets the documented cells with the IP-prefix verifyLabel", () => {
    const gw = WORKBOOK_CELL_MAP.find((e) => e.label === "vMotion IPv6 Gateway CIDR" && e.sheet === "Deploy Workload Domain");
    const start = WORKBOOK_CELL_MAP.find((e) => e.label === "vMotion IPv6 Range Start" && e.sheet === "Deploy Workload Domain");
    const end = WORKBOOK_CELL_MAP.find((e) => e.label === "vMotion IPv6 Range End" && e.sheet === "Deploy Workload Domain");
    expect(gw.cell).toBe("D89");
    expect(start.cell).toBe("D92");
    expect(end.cell).toBe("D93");
    // vMotion uses "IPv6 IP Range Start :" (with IP and space) per the
    // workbook label; vSAN/hostTep/edgeTep use the plain form.
    expect(start.verifyLabel).toBe("IPv6 IP Range Start :");
    expect(end.verifyLabel).toBe("IPv6 IP Range End :");
  });

  it("Deploy Cluster vSAN targets D66/D69/D70", () => {
    const gw = WORKBOOK_CELL_MAP.find((e) => e.label === "vSAN IPv6 Gateway CIDR" && e.sheet === "Deploy Cluster");
    const start = WORKBOOK_CELL_MAP.find((e) => e.label === "vSAN IPv6 Range Start" && e.sheet === "Deploy Cluster");
    expect(gw.cell).toBe("D66");
    expect(start.cell).toBe("D69");
  });

  it("Dual Stack toggle carries Exclude/Include dataValidation matching the workbook dropdown", () => {
    const e = WORKBOOK_CELL_MAP.find((x) => x.label === "WLD Dual Stack IPv6 Enabled");
    expect(e.cell).toBe("D162");
    expect(e.dataValidation).toEqual(["Exclude", "Include"]);
  });
});

describe("Theme 18 — emit semantics", () => {
  it("emits empty IPv6 values for a fresh fleet", () => {
    const f = fleetWithWld("9.1");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    expect(rows.find((r) => r.cell === "D89" && r.sheet === "Deploy Workload Domain").value).toBe("");
    expect(rows.find((r) => r.cell === "D162" && r.sheet === "Deploy Workload Domain").value).toBe("Exclude");
  });

  it("emits customized IPv6 values to the right cells", () => {
    const f = fleetWithWld("9.1");
    const c = wldCluster(f);
    c.networks.dualStackIpv6 = true;
    c.networks.vmotion.ipv6 = { gatewayCidr: "2001:db8:11::/64", rangeStart: "2001:db8:11::10", rangeEnd: "2001:db8:11::20" };
    c.networks.vsan.ipv6    = { gatewayCidr: "2001:db8:12::/64", rangeStart: "2001:db8:12::10", rangeEnd: "2001:db8:12::20" };
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (cell) => rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === cell);
    expect(find("D89").value).toBe("2001:db8:11::/64");
    expect(find("D92").value).toBe("2001:db8:11::10");
    expect(find("D93").value).toBe("2001:db8:11::20");
    expect(find("D100").value).toBe("2001:db8:12::/64");
    expect(find("D162").value).toBe("Include");
  });

  it("does NOT emit theme 18 entries on a 9.0 fleet (9.1-only gate)", () => {
    const f = fleetWithWld("9.0");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => r.cell === "D89" && r.label === "vMotion IPv6 Gateway CIDR")).toBeUndefined();
    expect(rows.find((r) => r.cell === "D162" && r.label === "WLD Dual Stack IPv6 Enabled")).toBeUndefined();
  });
});

describe("Theme 18 — import round-trip", () => {
  it("Deploy WLD CSV round-trip reconstructs ipv6 per network + dualStackIpv6", () => {
    const original = fleetWithWld("9.1");
    const c = wldCluster(original);
    c.networks.dualStackIpv6 = true;
    c.networks.vmotion.ipv6 = { gatewayCidr: "2001:db8:11::/64", rangeStart: "2001:db8:11::10", rangeEnd: "2001:db8:11::20" };
    c.networks.hostTep.ipv6 = { gatewayCidr: "2001:db8:15::/64", rangeStart: "2001:db8:15::100", rangeEnd: "2001:db8:15::200" };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const parsed = parseWorkbookCellMap(csv);
    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const back = wldCluster(rebuilt);
    expect(back.networks.dualStackIpv6).toBe(true);
    expect(back.networks.vmotion.ipv6).toEqual({ gatewayCidr: "2001:db8:11::/64", rangeStart: "2001:db8:11::10", rangeEnd: "2001:db8:11::20" });
    expect(back.networks.hostTep.ipv6.gatewayCidr).toBe("2001:db8:15::/64");
  });

  it("Deploy Cluster round-trip on a second WLD cluster", () => {
    const original = fleetWithAdditionalCluster("9.1");
    const c = additionalCluster(original);
    c.networks.edgeTep.ipv6 = { gatewayCidr: "2001:db8:16::/64", rangeStart: "2001:db8:16::10", rangeEnd: "2001:db8:16::20" };
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });
    expect(additionalCluster(rebuilt).networks.edgeTep.ipv6).toEqual({
      gatewayCidr: "2001:db8:16::/64", rangeStart: "2001:db8:16::10", rangeEnd: "2001:db8:16::20",
    });
  });

  it("Dual Stack apply accepts 'Include' case-insensitively", () => {
    const rows = [
      { workbookVersion: "9.1", sheet: "Deploy Workload Domain", cell: "D162", label: "WLD Dual Stack IPv6 Enabled", value: "INCLUDE" },
    ];
    const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const wld = rebuilt.instances[0].domains.find((d) => d.type === "workload");
    expect(wld.clusters[0].networks.dualStackIpv6).toBe(true);
  });

  it("Dual Stack apply coerces out-of-enum values to false (factory default)", () => {
    // The dataValidation enum is ["Exclude", "Include"]. Anything not
    // matching "include" (case-insensitive) lands on false — matches
    // the workbook's "Exclude" default behavior.
    for (const garbage of ["", "garbage", "true", "1", "yes", "Exclude"]) {
      const rows = [
        { workbookVersion: "9.1", sheet: "Deploy Workload Domain", cell: "D162", label: "WLD Dual Stack IPv6 Enabled", value: garbage },
      ];
      const { fleet: rebuilt } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
      const wld = rebuilt.instances[0].domains.find((d) => d.type === "workload");
      expect(wld.clusters[0].networks.dualStackIpv6, `value="${garbage}"`).toBe(false);
    }
  });
});

describe("M1.4 — mgmt-cluster IPv6 cells on Deploy Mgmt (9.1 only)", () => {
  // Closes the mgmt-cluster scope gap for Deploy Mgmt IPv6. Theme 18
  // had wired workload-cluster + additional-cluster IPv6 but the mgmt
  // domain was missing. The model surface (cluster.networks.{mgmt,
  // vmotion,vsan}.ipv6.{gatewayCidr,rangeStart,rangeEnd}) was already
  // in place from Theme 18 — these tests confirm the cell-map entries
  // route correctly.
  function mgmtCluster(f) {
    return f.instances[0].domains.find((d) => d.type === "mgmt").clusters[0];
  }

  it("Mgmt IPv6 gateway emits at L105", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.mgmt.ipv6.gatewayCidr = "2001:db8::1/64";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const row = rows.find((r) => r.cell === "L105" && r.label === "Mgmt IPv6 Gateway CIDR");
    expect(row).toBeTruthy();
    expect(row.sheet).toBe("Deploy Management Domain");
    expect(row.value).toBe("2001:db8::1/64");
  });

  it("vMotion IPv6 range emits at L130/L131", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.vmotion.ipv6.rangeStart = "2001:db8:1::100";
    mgmtCluster(f).networks.vmotion.ipv6.rangeEnd = "2001:db8:1::200";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const start = rows.find((r) => r.cell === "L130" && r.label === "vMotion IPv6 Range Start");
    const end = rows.find((r) => r.cell === "L131" && r.label === "vMotion IPv6 Range End");
    expect(start.value).toBe("2001:db8:1::100");
    expect(end.value).toBe("2001:db8:1::200");
    expect(start.sheet).toBe("Deploy Management Domain");
  });

  it("vSAN IPv6 range emits at L138/L139", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    mgmtCluster(f).networks.vsan.ipv6.rangeStart = "2001:db8:2::100";
    mgmtCluster(f).networks.vsan.ipv6.rangeEnd = "2001:db8:2::200";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const start = rows.find((r) => r.cell === "L138" && r.label === "vSAN IPv6 Range Start");
    const end = rows.find((r) => r.cell === "L139" && r.label === "vSAN IPv6 Range End");
    expect(start.value).toBe("2001:db8:2::100");
    expect(end.value).toBe("2001:db8:2::200");
  });

  it("9.0 emit does not produce any mgmt-cluster IPv6 rows (9.1-only entries)", () => {
    const f = newFleet();
    f.vcfVersion = "9.0";
    mgmtCluster(f).networks.mgmt.ipv6.gatewayCidr = "2001:db8::1/64";
    mgmtCluster(f).networks.vmotion.ipv6.rangeStart = "2001:db8:1::100";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const ipv6Rows = rows.filter((r) =>
      r.sheet === "Deploy Management Domain" &&
      /^(Mgmt|vMotion|vSAN) IPv6/.test(r.label)
    );
    expect(ipv6Rows).toHaveLength(0);
  });

  it("round-trip preserves all 5 mgmt-cluster IPv6 fields", () => {
    const original = newFleet();
    original.vcfVersion = "9.1";
    const c = mgmtCluster(original);
    c.networks.mgmt.ipv6.gatewayCidr = "2001:db8::1/64";
    c.networks.vmotion.ipv6.rangeStart = "2001:db8:1::100";
    c.networks.vmotion.ipv6.rangeEnd = "2001:db8:1::200";
    c.networks.vsan.ipv6.rangeStart = "2001:db8:2::100";
    c.networks.vsan.ipv6.rangeEnd = "2001:db8:2::200";
    const csv = VcfEngine.emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const back = importWorkbookCellMap(VcfEngine.parseWorkbookCellMap(csv), { workbookVersion: "9.1" }).fleet;
    const bc = mgmtCluster(back);
    expect(bc.networks.mgmt.ipv6.gatewayCidr).toBe("2001:db8::1/64");
    expect(bc.networks.vmotion.ipv6.rangeStart).toBe("2001:db8:1::100");
    expect(bc.networks.vmotion.ipv6.rangeEnd).toBe("2001:db8:1::200");
    expect(bc.networks.vsan.ipv6.rangeStart).toBe("2001:db8:2::100");
    expect(bc.networks.vsan.ipv6.rangeEnd).toBe("2001:db8:2::200");
  });
});
