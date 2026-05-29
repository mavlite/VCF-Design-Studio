// Phase C — xlsx / cell-map edge-case coverage for engine.js.
//
// Targets:
//   - cellPattern expansion + _findExpansionIndexForCell (via importWorkbookCellMap)
//   - computeReconcileDiff cross-version downgrade reporting
//   - Per-host FQDN DNS-suffix strip — Deploy Mgmt (mgmt-cluster-host scope)
//   - Per-host FQDN DNS-suffix strip — Deploy WLD (workload-cluster-host scope)
//   - Single-line apply callbacks: Download Token, Activation Code, proxy user,
//     FTT, NFS share path
//
// Round-trip strategy: CSV-level (emitWorkbookCellMapCsv → parseWorkbookCellMap
// → importWorkbookCellMap) — no actual .xlsx binary required.
//
// Node env; no JSDOM pragma needed.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  migrate9_1To9_0,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
  computeReconcileDiff,
  APPLIANCE_DB,
  WORKBOOK_CELL_MAP,
} = VcfEngine;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a fleet with vcfVersion and emit → parse → import at that version. */
function roundTrip(fleet, version) {
  const ver = version || fleet.vcfVersion || "9.1";
  const csv = emitWorkbookCellMapCsv(fleet, null, { workbookVersion: ver });
  const { fleet: rebuilt } = importWorkbookCellMap(
    parseWorkbookCellMap(csv),
    { workbookVersion: ver }
  );
  return rebuilt;
}

/** Build the minimal row array needed to import a single cell value. */
function singleRow(sheet, cell, value, version) {
  return [{ workbookVersion: version, sheet, cell, label: "test", value }];
}

// ─── cellPattern expansion + _findExpansionIndexForCell ───────────────────────

describe("cellPattern expansion — per-host FQDN expansion index", () => {
  it("expands 16 host-FQDN rows in 9.1 emit (L82-L97)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.networkConfig.dns.primaryDomain = "test.local";
    const csv = emitWorkbookCellMapCsv(f, null, { workbookVersion: "9.1" });
    const rows = parseWorkbookCellMap(csv);
    // Expect row for L82 (host 1) through L97 (host 16) on Deploy Management Domain.
    const fqdnRows = rows.filter(
      (r) => r.sheet === "Deploy Management Domain" && /^L(8[2-9]|9[0-7])$/.test(r.cell)
    );
    expect(fqdnRows.length).toBe(16);
  });

  it("expands 16 host-FQDN rows in 9.0 emit (L128-L143)", () => {
    const f = migrate9_1To9_0(newFleet());
    f.vcfVersion = "9.0";
    f.networkConfig.dns.primaryDomain = "test.local";
    const csv = emitWorkbookCellMapCsv(f, null, { workbookVersion: "9.0" });
    const rows = parseWorkbookCellMap(csv);
    const fqdnRows = rows.filter(
      (r) => r.sheet === "Deploy Management Domain" && /^L(12[89]|1[3-3][0-9]|14[0-3])$/.test(r.cell)
    );
    expect(fqdnRows.length).toBe(16);
  });

  it("non-expansion entry (_findExpansionIndexForCell) returns i=0 on re-import", () => {
    // A non-expansion entry (single literal cell) should apply to context index 0.
    // We verify this by round-tripping a per-fleet scalar field.
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.installerConfig.downloadToken = "token-scalar-test";
    const rebuilt = roundTrip(f, "9.1");
    // If index were mis-computed the value would be empty.
    expect(rebuilt.installerConfig.downloadToken).toBe("token-scalar-test");
  });

  it("expansion i=0 (host 1) addresses L82 (9.1) and maps back to hostname index 0", () => {
    // Supply a single host-FQDN row for L82 directly and confirm it lands on
    // hostOverrides[0] — i.e. _findExpansionIndexForCell returns 0 for L82.
    const rows = [
      {
        workbookVersion: "9.1",
        sheet: "Deploy Management Domain",
        cell: "L82",
        label: "Host #1 FQDN",
        value: "esx-alpha",
      },
    ];
    const { fleet } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(cluster.hostOverrides).toBeDefined();
    expect(cluster.hostOverrides[0]).toBeDefined();
    expect(cluster.hostOverrides[0].hostname).toBe("esx-alpha");
  });

  it("expansion i=3 (host 4) addresses L85 (9.1) and maps back to hostname index 3", () => {
    // L82+3 = L85 → hostOverrides[3]
    const rows = [
      {
        workbookVersion: "9.1",
        sheet: "Deploy Management Domain",
        cell: "L85",
        label: "Host #4 FQDN",
        value: "esx-04",
      },
    ];
    const { fleet } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const cluster = fleet.instances[0].domains[0].clusters[0];
    // hostOverrides must be padded to at least index 3
    expect(cluster.hostOverrides.length).toBeGreaterThanOrEqual(4);
    expect(cluster.hostOverrides[3].hostname).toBe("esx-04");
  });
});

// ─── computeReconcileDiff — cross-version downgrade reporting ─────────────────

describe("computeReconcileDiff — cross-version downgrade reporting", () => {
  it("returns empty array for null fleet", () => {
    expect(computeReconcileDiff(null)).toEqual([]);
    expect(computeReconcileDiff(null, "9.0")).toEqual([]);
  });

  it("reports no drops when source and target versions match (9.1 → 9.1)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const diff = computeReconcileDiff(f, "9.1");
    // vcfmsControl/vcfmsWorker are 9.1-only but available in 9.1 target → no drops.
    expect(diff).toEqual([]);
  });

  it("reports no drops when fleet has no 9.1-exclusive appliances targeting 9.0", () => {
    // A minimal 9.0 fleet has no vcfmsControl/vcfmsWorker entries in any stack.
    const f = migrate9_1To9_0(newFleet());
    f.vcfVersion = "9.0";
    const diff = computeReconcileDiff(f, "9.0");
    expect(diff).toEqual([]);
  });

  it("reports dropped entries when a 9.1-only appliance is on a 9.0 target fleet", () => {
    // Build a 9.1 fleet and inject a 9.1-exclusive appliance (vcfmsControl)
    // into a cluster's infraStack to trigger the drop path.
    const f = newFleet();
    f.vcfVersion = "9.1";
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.infraStack = cluster.infraStack || [];
    cluster.infraStack.push({ id: "vcfmsControl", size: "Medium", key: "test-key" });

    const diff = computeReconcileDiff(f, "9.0");
    expect(diff.length).toBeGreaterThanOrEqual(1);
    const dropped = diff.find((d) => d.entryId === "vcfmsControl");
    expect(dropped).toBeDefined();
    expect(dropped.reason).toMatch(/not available in VCF 9\.0/);
  });

  it("reports the correct metadata fields on each dropped entry", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const inst = f.instances[0];
    const dom = inst.domains[0];
    const cluster = dom.clusters[0];
    cluster.infraStack = cluster.infraStack || [];
    cluster.infraStack.push({ id: "vcfmsWorker", size: "Medium", key: "test-key-2" });

    const diff = computeReconcileDiff(f, "9.0");
    const dropped = diff.find((d) => d.entryId === "vcfmsWorker");
    expect(dropped).toBeDefined();
    expect(dropped.instanceId).toBe(inst.id);
    expect(dropped.domainId).toBe(dom.id);
    expect(dropped.clusterId).toBe(cluster.id);
    expect(dropped.stack).toBe("infraStack");
    expect(dropped.applianceLabel).toBe(APPLIANCE_DB.vcfmsWorker.label);
  });

  it("uses fleet.vcfVersion as target when targetVersion argument is omitted", () => {
    // If targetVersion is omitted, the function should use fleet.vcfVersion.
    // A 9.1 fleet with 9.1-only appliances → no drops (available in 9.1).
    const f = newFleet();
    f.vcfVersion = "9.1";
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.infraStack.push({ id: "vcfmsControl", size: "Medium", key: "k3" });
    const diff = computeReconcileDiff(f);  // no targetVersion argument
    expect(diff).toEqual([]);
  });

  it("scans wldStack entries as well as infraStack", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.wldStack = cluster.wldStack || [];
    cluster.wldStack.push({ id: "vcfmsControl", size: "Medium", key: "w1" });
    const diff = computeReconcileDiff(f, "9.0");
    const dropped = diff.find((d) => d.entryId === "vcfmsControl" && d.stack === "wldStack");
    expect(dropped).toBeDefined();
  });
});

// ─── Per-host FQDN apply — Deploy Mgmt (mgmt-cluster-host scope) ─────────────

describe("per-host FQDN apply — Deploy Mgmt (mgmt-cluster-host scope)", () => {
  it("strips DNS suffix and writes hostname-only on import (9.1)", () => {
    // Provide DNS domain + FQDN row: the apply callback should strip the domain.
    // We must include the DNS Domain row first so the suffix-strip sees it.
    const dnsRows = singleRow("Deploy Management Domain", "L71", "example.com", "9.1");
    const fqdnRows = singleRow("Deploy Management Domain", "L82", "esx-01.example.com", "9.1");
    const { fleet } = importWorkbookCellMap([...dnsRows, ...fqdnRows], { workbookVersion: "9.1" });
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(cluster.hostOverrides[0].hostname).toBe("esx-01");
  });

  it("writes the full value as hostname when no DNS domain is set", () => {
    const rows = singleRow("Deploy Management Domain", "L82", "esx-01.local.corp", "9.1");
    const { fleet } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(cluster.hostOverrides[0].hostname).toBe("esx-01.local.corp");
  });

  it("strips DNS suffix on 9.0 using the 9.0 cell address (L128)", () => {
    const dnsRows = singleRow("Deploy Management Domain", "L43", "legacy.corp", "9.0");
    const fqdnRows = singleRow("Deploy Management Domain", "L128", "esx-host1.legacy.corp", "9.0");
    const { fleet } = importWorkbookCellMap([...dnsRows, ...fqdnRows], { workbookVersion: "9.0" });
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(cluster.hostOverrides[0].hostname).toBe("esx-host1");
  });

  it("is case-insensitive when stripping the DNS suffix", () => {
    const dnsRows = singleRow("Deploy Management Domain", "L71", "CORP.LOCAL", "9.1");
    const fqdnRows = singleRow("Deploy Management Domain", "L82", "esx-box.corp.local", "9.1");
    const { fleet } = importWorkbookCellMap([...dnsRows, ...fqdnRows], { workbookVersion: "9.1" });
    const cluster = fleet.instances[0].domains[0].clusters[0];
    expect(cluster.hostOverrides[0].hostname).toBe("esx-box");
  });
});

// ─── Per-host FQDN apply — Deploy WLD (workload-cluster-host scope) ──────────

describe("per-host FQDN apply — Deploy WLD (workload-cluster-host scope)", () => {
  it("strips DNS suffix and writes hostname-only for WLD host on 9.1 (D131)", () => {
    // WLD scope requires a workload-domain context. Build a fleet with a WLD
    // and round-trip through CSV so importWorkbookCellMap has the context.
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.networkConfig.dns.primaryDomain = "wld.local";
    f.instances[0].domains.push(newWorkloadDomain("WLD-01"));

    // Set a per-host hostname override on the WLD cluster so emit produces FQDN rows.
    const wldCluster = f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
    wldCluster.hostOverrides = [{ hostname: "wld-esx-01", hostIndex: 0 }];

    const rebuilt = roundTrip(f, "9.1");
    const rebuiltWld = rebuilt.instances[0].domains.find((d) => d.type === "workload");
    expect(rebuiltWld).toBeDefined();
    const rebuiltCluster = rebuiltWld.clusters[0];
    // The resolved FQDN is "wld-esx-01.wld.local"; on re-import it strips back to "wld-esx-01".
    expect(rebuiltCluster.hostOverrides[0].hostname).toBe("wld-esx-01");
  });

  it("direct row injection — strips DNS suffix for WLD host D131 (9.1)", () => {
    // Inject DNS domain + WLD FQDN row directly.
    const dnsRows = singleRow("Deploy Management Domain", "L71", "myorg.net", "9.1");
    const wldFqdnRows = singleRow("Deploy Workload Domain", "D131", "whost-01.myorg.net", "9.1");
    const { fleet } = importWorkbookCellMap([...dnsRows, ...wldFqdnRows], { workbookVersion: "9.1" });
    const wldDomain = fleet.instances[0].domains.find((d) => d.type === "workload");
    expect(wldDomain).toBeDefined();
    expect(wldDomain.clusters[0].hostOverrides[0].hostname).toBe("whost-01");
  });

  it("direct row injection — WLD host D120 (9.0) strips DNS suffix", () => {
    const dnsRows = singleRow("Deploy Management Domain", "L43", "old.net", "9.0");
    const wldFqdnRows = singleRow("Deploy Workload Domain", "D120", "whost-99.old.net", "9.0");
    const { fleet } = importWorkbookCellMap([...dnsRows, ...wldFqdnRows], { workbookVersion: "9.0" });
    const wldDomain = fleet.instances[0].domains.find((d) => d.type === "workload");
    expect(wldDomain).toBeDefined();
    expect(wldDomain.clusters[0].hostOverrides[0].hostname).toBe("whost-99");
  });
});

// ─── Single-line apply callbacks ──────────────────────────────────────────────

describe("single-line apply callbacks — per-fleet installer fields", () => {
  it("applies Download Token cell (L12 on 9.0, L12 on 9.1)", () => {
    // 9.1 round-trip
    const f91 = newFleet();
    f91.vcfVersion = "9.1";
    f91.installerConfig.downloadToken = "tok-abc-91";
    expect(roundTrip(f91, "9.1").installerConfig.downloadToken).toBe("tok-abc-91");

    // 9.0 round-trip
    const f90 = migrate9_1To9_0(newFleet());
    f90.vcfVersion = "9.0";
    f90.installerConfig.downloadToken = "tok-abc-90";
    expect(roundTrip(f90, "9.0").installerConfig.downloadToken).toBe("tok-abc-90");
  });

  it("applies Activation Code cell (L13 on 9.1 only) — 9.1-only field", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.installerConfig.activationCode = "ACT-001-XYZ";
    const rebuilt = roundTrip(f, "9.1");
    expect(rebuilt.installerConfig.activationCode).toBe("ACT-001-XYZ");
  });

  it("Activation Code cell is absent in 9.0 cell-map (workbookVersions: ['9.1'])", () => {
    // Find the Activation Code entry; it must be 9.1-only.
    const entry = WORKBOOK_CELL_MAP.find((e) => e.label === "Activation Code");
    expect(entry).toBeDefined();
    expect(entry.workbookVersions).toEqual(["9.1"]);
  });

  it("applies proxy user cell (L18 on 9.0 / L19 on 9.1)", () => {
    const f91 = newFleet();
    f91.vcfVersion = "9.1";
    f91.installerConfig.proxyUser = "proxy-user-91";
    expect(roundTrip(f91, "9.1").installerConfig.proxyUser).toBe("proxy-user-91");

    const f90 = migrate9_1To9_0(newFleet());
    f90.vcfVersion = "9.0";
    f90.installerConfig.proxyUser = "proxy-user-90";
    expect(roundTrip(f90, "9.0").installerConfig.proxyUser).toBe("proxy-user-90");
  });
});

describe("single-line apply callbacks — vSAN FTT (mgmt-cluster scope)", () => {
  it("applies FTT=2 on re-import (9.1)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.storage.dataServices.ftt = 2;
    const rebuilt = roundTrip(f, "9.1");
    expect(rebuilt.instances[0].domains[0].clusters[0].storage.dataServices.ftt).toBe(2);
  });

  it("applies FTT=1 on re-import (9.0)", () => {
    const f = migrate9_1To9_0(newFleet());
    f.vcfVersion = "9.0";
    const cluster = f.instances[0].domains[0].clusters[0];
    cluster.storage.dataServices.ftt = 1;
    const rebuilt = roundTrip(f, "9.0");
    expect(rebuilt.instances[0].domains[0].clusters[0].storage.dataServices.ftt).toBe(1);
  });

  it("applies FTT=2 via direct row injection on 9.0 (L118)", () => {
    const rows = singleRow("Deploy Management Domain", "L118", "2", "9.0");
    const { fleet } = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    expect(fleet.instances[0].domains[0].clusters[0].storage.dataServices.ftt).toBe(2);
  });
});

describe("single-line apply callbacks — NFS share path (workload-cluster scope)", () => {
  it("applies NFS share path cell round-trip on 9.1 (D222)", () => {
    const f = newFleet();
    f.vcfVersion = "9.1";
    f.instances[0].domains.push(newWorkloadDomain("WLD-NFS"));
    const wldCluster = f.instances[0].domains.find((d) => d.type === "workload").clusters[0];
    wldCluster.storage = wldCluster.storage || {};
    wldCluster.storage.principalStorage = "NFSv3";
    wldCluster.storage.dataServices = wldCluster.storage.dataServices || {};
    wldCluster.storage.dataServices.nfs = { sharePath: "/exports/vcf-ds", serverIp: "192.168.1.100", boundToVmknic: true };

    const rebuilt = roundTrip(f, "9.1");
    const rebuiltWld = rebuilt.instances[0].domains.find((d) => d.type === "workload");
    expect(rebuiltWld).toBeDefined();
    // NFS share path emitted only when principalStorage === "NFSv3"; on import the
    // apply callback sets it unconditionally (the cell value is what the workbook stamped).
    const rebuiltCluster = rebuiltWld.clusters[0];
    expect(rebuiltCluster.storage.dataServices.nfs.sharePath).toBe("/exports/vcf-ds");
  });

  it("applies NFS share path via direct row injection on 9.0 (D207)", () => {
    const rows = singleRow("Deploy Workload Domain", "D207", "/nfs/share", "9.0");
    const { fleet } = importWorkbookCellMap(rows, { workbookVersion: "9.0" });
    const wldDomain = fleet.instances[0].domains.find((d) => d.type === "workload");
    expect(wldDomain).toBeDefined();
    expect(wldDomain.clusters[0].storage.dataServices.nfs.sharePath).toBe("/nfs/share");
  });

  it("applies NFS share path via direct row injection on 9.1 (D222)", () => {
    const rows = singleRow("Deploy Workload Domain", "D222", "/nfs/folder91", "9.1");
    const { fleet } = importWorkbookCellMap(rows, { workbookVersion: "9.1" });
    const wldDomain = fleet.instances[0].domains.find((d) => d.type === "workload");
    expect(wldDomain).toBeDefined();
    expect(wldDomain.clusters[0].storage.dataServices.nfs.sharePath).toBe("/nfs/folder91");
  });
});
