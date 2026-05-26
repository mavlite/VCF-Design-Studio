import { describe, it, expect } from "vitest";
import VcfEngine from "../../../engine.js";

// Theme L (option a) + Theme O (sub-themes 2a + 2c) — combined model-
// ready quick-wins PR.
//
// Theme L (a): per-host FQDN tables on Deploy WLD (D120/D131) and
//   Deploy Cluster (D84/D96). Uses resolveHostname() + fleet DNS
//   suffix. Mirrors Theme 14's existing Deploy Mgmt FQDN block at L82/
//   L128 — same model, parallel sheets.
//
// Theme O (2a): Witness DNS/NTP refs on Configure Mgmt D393/D395-D398
//   (9.1-only). Echoes fleet.networkConfig.dns/ntp.
//
// Theme O (2c): Additional cluster DNS/NTP refs on Deploy Cluster
//   D373/D375-D378 (9.1-only). Also echoes fleet.networkConfig.

const {
  newFleet,
  newWorkloadDomain,
  newWorkloadCluster,
  WORKBOOK_CELL_MAP,
  emitWorkbookCellMap,
  emitWorkbookCellMapCsv,
  parseWorkbookCellMap,
  importWorkbookCellMap,
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

describe("Theme L (a) — Per-host FQDN tables: cell-map entries", () => {
  it("ships Deploy WLD FQDN entry with dual-version cellPattern (9.0 D120, 9.1 D131)", () => {
    const e = WORKBOOK_CELL_MAP.find(
      (x) => x.sheet === "Deploy Workload Domain" && x.label === "WLD Host #{i+1} FQDN"
    );
    expect(e).toBeTruthy();
    expect(e.cellPattern).toBe("D{120+i}");
    expect(e.cellPatternByVersion).toEqual({ "9.1": "D{131+i}" });
    expect(e.expandsTo).toBe(16);
    expect(e.scope).toBe("workload-cluster-host");
    expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
  });

  it("ships Deploy Cluster FQDN entry with dual-version cellPattern (9.0 D84, 9.1 D96)", () => {
    const e = WORKBOOK_CELL_MAP.find(
      (x) => x.sheet === "Deploy Cluster" && x.label === "Additional Cluster Host #{i+1} FQDN"
    );
    expect(e).toBeTruthy();
    expect(e.cellPattern).toBe("D{84+i}");
    expect(e.cellPatternByVersion).toEqual({ "9.1": "D{96+i}" });
    expect(e.expandsTo).toBe(16);
    expect(e.scope).toBe("additional-cluster-host");
    expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
  });
});

describe("Theme L (a) — Per-host FQDN: emit semantics", () => {
  it("emits empty FQDNs on a fresh fleet (no namingConfig template)", () => {
    const f = fleetWithWld("9.1");
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // Deploy WLD D131-D146 (16 hosts).
    const wld = rows.filter((r) => r.sheet === "Deploy Workload Domain" && /^D(13[1-9]|14[0-6])$/.test(r.cell));
    expect(wld).toHaveLength(16);
    for (const r of wld) expect(r.value).toBe("");
  });

  it("emits hostname.dns-domain when fleet has both naming template + DNS domain", () => {
    const f = fleetWithWld("9.1");
    f.namingConfig.hostTemplate = "test-esx{i}";
    f.networkConfig.dns.primaryDomain = "lab.local";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const host1 = rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D131");
    // resolveHostname may apply prefix/postfix + zero-pad — just confirm
    // we get a non-empty FQDN ending in the DNS domain.
    expect(host1.value).toMatch(/\.lab\.local$/);
  });

  it("9.0 fleet emits FQDNs at the 9.0 cell range (D120-D135)", () => {
    const f = fleetWithWld("9.0");
    f.namingConfig.hostTemplate = "test-esx{i}";
    f.networkConfig.dns.primaryDomain = "lab.local";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const host1 = rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D120");
    expect(host1).toBeTruthy();
    expect(host1.value).toMatch(/\.lab\.local$/);
  });

  it("Deploy Cluster FQDN emits on additional clusters only (not the first WLD cluster)", () => {
    const f = fleetWithAdditionalCluster("9.1");
    f.namingConfig.hostTemplate = "test-esx{i}";
    f.networkConfig.dns.primaryDomain = "lab.local";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const dcHost1 = rows.filter((r) => r.sheet === "Deploy Cluster" && r.cell === "D96");
    // Only the additional cluster (second cluster) emits to Deploy Cluster.
    expect(dcHost1.length).toBeGreaterThanOrEqual(1);
    expect(dcHost1[0].value).toMatch(/\.lab\.local$/);
  });
});

describe("Theme L (a) — Per-host FQDN: round-trip persists hostname overrides", () => {
  it("strips DNS suffix on apply, persisting bare hostname to cluster.hostOverrides[i]", () => {
    // Mirror the round-trip pattern used by Theme 14's existing FQDN
    // entry (Deploy Mgmt): the resolver derives hostnames via
    // resolveHostname(), which needs a fleet hostTemplate to produce
    // non-empty values. Set both the template and the DNS suffix so
    // emit produces real FQDNs, then verify apply rebuilds the
    // hostOverrides[i].hostname slots.
    const original = fleetWithWld("9.1");
    original.networkConfig.dns.primaryDomain = "lab.local";
    original.namingConfig.hostTemplate = "wld-host-{i}";

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    // First row: D131 carries Host #1's FQDN.
    const parsed = parseWorkbookCellMap(csv);
    const wldRow1 = parsed.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D131");
    expect(wldRow1).toBeTruthy();
    expect(wldRow1.value).toMatch(/\.lab\.local$/);

    const { fleet: rebuilt } = importWorkbookCellMap(parsed, { workbookVersion: "9.1" });
    const reWld = wldCluster(rebuilt);
    expect(Array.isArray(reWld.hostOverrides)).toBe(true);
    expect(reWld.hostOverrides.length).toBeGreaterThanOrEqual(16);
    // Host 1's hostname survives the DNS-suffix strip.
    expect(reWld.hostOverrides[0].hostname).not.toBe(null);
    expect(reWld.hostOverrides[0].hostname).not.toContain(".lab.local");
    // The reconstructed hostname matches what resolveHostname produced
    // for host index 0 on the original fleet.
    expect(reWld.hostOverrides[0].hostname).toMatch(/wld-host/);
  });
});

describe("Theme O (2a + 2c) — DNS/NTP refs echo fleet.networkConfig", () => {
  it("ships 5 witness DNS/NTP entries on Configure Mgmt (9.1-only)", () => {
    const labels = [
      ["Witness DNS Domain", "D393"],
      ["Witness DNS Server #1", "D395"],
      ["Witness DNS Server #2", "D396"],
      ["Witness NTP Server #1", "D397"],
      ["Witness NTP Server #2", "D398"],
    ];
    for (const [label, cell] of labels) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe("Configure Management Domain");
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("instance");
    }
  });

  it("ships 5 Deploy Cluster DNS/NTP entries (9.1-only)", () => {
    const labels = [
      ["Additional Cluster DNS Domain", "D373"],
      ["Additional Cluster DNS Server #1", "D375"],
      ["Additional Cluster DNS Server #2", "D376"],
      ["Additional Cluster NTP Server #1", "D377"],
      ["Additional Cluster NTP Server #2", "D378"],
    ];
    for (const [label, cell] of labels) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe("Deploy Cluster");
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
      expect(e.scope).toBe("additional-cluster");
    }
  });

  it("emits fleet DNS/NTP values to all 10 cells (witness + additional cluster)", () => {
    const f = fleetWithAdditionalCluster("9.1");
    f.networkConfig.dns.primaryDomain = "echo.lab";
    f.networkConfig.dns.servers = ["1.1.1.1", "8.8.8.8"];
    f.networkConfig.ntp.servers = ["ntp1.echo.lab", "ntp2.echo.lab"];
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    const find = (sheet, cell) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    // Witness block (Configure Mgmt) — emits on each instance.
    expect(find("Configure Management Domain", "D393").value).toBe("echo.lab");
    expect(find("Configure Management Domain", "D395").value).toBe("1.1.1.1");
    expect(find("Configure Management Domain", "D396").value).toBe("8.8.8.8");
    expect(find("Configure Management Domain", "D397").value).toBe("ntp1.echo.lab");
    expect(find("Configure Management Domain", "D398").value).toBe("ntp2.echo.lab");
    // Deploy Cluster block — emits on additional clusters.
    expect(find("Deploy Cluster", "D373").value).toBe("echo.lab");
    expect(find("Deploy Cluster", "D375").value).toBe("1.1.1.1");
    expect(find("Deploy Cluster", "D376").value).toBe("8.8.8.8");
    expect(find("Deploy Cluster", "D377").value).toBe("ntp1.echo.lab");
    expect(find("Deploy Cluster", "D378").value).toBe("ntp2.echo.lab");
  });

  it("CSV round-trip preserves fleet DNS/NTP values across stamp + import", () => {
    const original = fleetWithAdditionalCluster("9.1");
    original.networkConfig.dns.primaryDomain = "roundtrip.lab";
    original.networkConfig.dns.servers = ["10.0.0.1", "10.0.0.2"];
    original.networkConfig.ntp.servers = ["ntp1.roundtrip.lab", "ntp2.roundtrip.lab"];

    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });
    expect(rebuilt.networkConfig.dns.primaryDomain).toBe("roundtrip.lab");
    expect(rebuilt.networkConfig.dns.servers[0]).toBe("10.0.0.1");
    expect(rebuilt.networkConfig.dns.servers[1]).toBe("10.0.0.2");
    expect(rebuilt.networkConfig.ntp.servers[0]).toBe("ntp1.roundtrip.lab");
    expect(rebuilt.networkConfig.ntp.servers[1]).toBe("ntp2.roundtrip.lab");
  });

  it("does NOT emit theme O entries on a 9.0 fleet (version gate)", () => {
    const f = fleetWithAdditionalCluster("9.0");
    f.networkConfig.dns.primaryDomain = "v9.lab";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    expect(rows.find((r) => r.label === "Witness DNS Domain")).toBeUndefined();
    expect(rows.find((r) => r.label === "Additional Cluster DNS Domain")).toBeUndefined();
  });
});
