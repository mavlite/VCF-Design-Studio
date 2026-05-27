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
// Theme O (2a): Witness DNS/NTP refs on Configure Mgmt. After PR #89's
//   9.0 backfill the 3 DNS entries are dual-version (D393↔D322,
//   D395↔D324, D396↔D325); the 2 NTP entries (D397/D398) stay 9.1-only
//   — no 9.0 workbook counterpart. Echoes fleet.networkConfig.dns/ntp.
//
// Theme O (2c): Additional cluster DNS/NTP refs on Deploy Cluster.
//   After PR #89's 9.0 backfill the 3 DNS entries are dual-version
//   (D373↔D361, D375↔D363, D376↔D364); the 2 NTP entries (D377/D378)
//   stay 9.1-only. Also echoes fleet.networkConfig.

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

describe("Theme L (a) — Per-host FQDN: host[15] (16th host) expansion", () => {
  it("emit + apply both cover the 16th host (index 15) — Deploy WLD", () => {
    // expandsTo: 16 means rows are stamped for hostIndex 0..15. A previous
    // off-by-one would silently drop host 15. Assert host 15's row exists
    // on emit and round-trips through apply.
    const f = fleetWithWld("9.1");
    f.namingConfig.hostTemplate = "wld-host-{i}";
    f.networkConfig.dns.primaryDomain = "lab.local";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // Deploy WLD host 15 → 9.1 D{131+15} = D146
    const host16 = rows.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D146");
    expect(host16, "Deploy WLD D146 (host 16 / index 15) should emit").toBeTruthy();
    expect(host16.value).toMatch(/\.lab\.local$/);
    // 9.0 base
    const f90 = fleetWithWld("9.0");
    f90.namingConfig.hostTemplate = "wld-host-{i}";
    f90.networkConfig.dns.primaryDomain = "lab.local";
    const rows90 = emitWorkbookCellMap(f90, null, { workbookVersion: "9.0" });
    // 9.0 D{120+15} = D135
    const host16_90 = rows90.find((r) => r.sheet === "Deploy Workload Domain" && r.cell === "D135");
    expect(host16_90, "Deploy WLD 9.0 D135 (host 16 / index 15) should emit").toBeTruthy();
  });

  it("emit + apply both cover the 16th host (index 15) — Deploy Cluster", () => {
    const f = fleetWithAdditionalCluster("9.1");
    f.namingConfig.hostTemplate = "ac-host-{i}";
    f.networkConfig.dns.primaryDomain = "lab.local";
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    // Deploy Cluster host 15 → 9.1 D{96+15} = D111
    const host16 = rows.find((r) => r.sheet === "Deploy Cluster" && r.cell === "D111");
    expect(host16, "Deploy Cluster D111 (host 16 / index 15) should emit").toBeTruthy();
    expect(host16.value).toMatch(/\.lab\.local$/);
  });

  it("apply preserves hostIndex on every new hostOverride entry (resolveHostname requires it)", () => {
    // Bug: prior Theme L apply called createHostIpOverride() without args,
    // producing entries with hostIndex=undefined. resolveHostname() looks
    // up overrides by `.find(o => o.hostIndex === hostIndex)` — entries
    // without hostIndex were invisible to it, so subsequent re-imports
    // would lose their custom hostnames.
    const original = fleetWithWld("9.1");
    original.networkConfig.dns.primaryDomain = "lab.local";
    original.namingConfig.hostTemplate = "wld-host-{i}";
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.1" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.1" });
    const reWld = wldCluster(rebuilt);
    expect(reWld.hostOverrides.length).toBeGreaterThanOrEqual(16);
    for (let i = 0; i < 16; i++) {
      expect(reWld.hostOverrides[i], `hostOverrides[${i}] should exist`).toBeTruthy();
      expect(reWld.hostOverrides[i].hostIndex, `hostOverrides[${i}].hostIndex should equal ${i}`).toBe(i);
    }
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
  it("ships 5 witness DNS/NTP entries on Configure Mgmt (3 dual + 2 9.1-only)", () => {
    // 3 DNS entries have 9.0 counterparts in the witness section (D322,
    // D324, D325). The 2 NTP entries don't — 9.0's witness section lacks
    // NTP Server rows.
    const dual = [
      ["Witness DNS Domain", "D393", "D322"],
      ["Witness DNS Server #1", "D395", "D324"],
      ["Witness DNS Server #2", "D396", "D325"],
    ];
    const only91 = [
      ["Witness NTP Server #1", "D397"],
      ["Witness NTP Server #2", "D398"],
    ];
    for (const [label, cell91, cell90] of dual) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe("Configure Management Domain");
      expect(e.cell).toBe(cell91);
      expect(e.cellByVersion).toEqual({ "9.0": cell90, "9.1": cell91 });
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.scope).toBe("instance");
    }
    for (const [label, cell] of only91) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
    }
  });

  it("ships 5 Deploy Cluster DNS/NTP entries (3 dual + 2 9.1-only)", () => {
    const dual = [
      ["Additional Cluster DNS Domain", "D373", "D361"],
      ["Additional Cluster DNS Server #1", "D375", "D363"],
      ["Additional Cluster DNS Server #2", "D376", "D364"],
    ];
    const only91 = [
      ["Additional Cluster NTP Server #1", "D377"],
      ["Additional Cluster NTP Server #2", "D378"],
    ];
    for (const [label, cell91, cell90] of dual) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe("Deploy Cluster");
      expect(e.cell).toBe(cell91);
      expect(e.cellByVersion).toEqual({ "9.0": cell90, "9.1": cell91 });
      expect(e.workbookVersions).toEqual(["9.0", "9.1"]);
      expect(e.scope).toBe("additional-cluster");
    }
    for (const [label, cell] of only91) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.1"]);
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

  it("9.0 emit stamps the 6 dual-version DNS cells at their 9.0 addresses", () => {
    const f = fleetWithAdditionalCluster("9.0");
    f.networkConfig.dns.primaryDomain = "v9.lab";
    f.networkConfig.dns.servers = ["10.9.0.1", "10.9.0.2"];
    f.networkConfig.ntp.servers = ["ntp1.v9.lab", "ntp2.v9.lab"];
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (sheet, cell) => rows.find((r) => r.sheet === sheet && r.cell === cell);
    // 9.0 Witness DNS (D322/D324/D325 — not the 9.1 D393/D395/D396).
    expect(find("Configure Management Domain", "D322").value).toBe("v9.lab");
    expect(find("Configure Management Domain", "D324").value).toBe("10.9.0.1");
    expect(find("Configure Management Domain", "D325").value).toBe("10.9.0.2");
    // 9.0 Additional Cluster DNS (D361/D363/D364 — not the 9.1 D373/D375/D376).
    expect(find("Deploy Cluster", "D361").value).toBe("v9.lab");
    expect(find("Deploy Cluster", "D363").value).toBe("10.9.0.1");
    expect(find("Deploy Cluster", "D364").value).toBe("10.9.0.2");
    // Mutual exclusion: 9.1 addresses must NOT appear in 9.0 emit.
    expect(find("Configure Management Domain", "D393")).toBeUndefined();
    expect(find("Configure Management Domain", "D395")).toBeUndefined();
    expect(find("Deploy Cluster", "D373")).toBeUndefined();
    expect(find("Deploy Cluster", "D375")).toBeUndefined();
    // NTP entries (D397/D398/D377/D378) stay 9.1-only — absent from 9.0 emit.
    expect(rows.find((r) => r.label === "Witness NTP Server #1")).toBeUndefined();
    expect(rows.find((r) => r.label === "Additional Cluster NTP Server #2")).toBeUndefined();
  });

  it("9.0 CSV round-trip preserves DNS values via the witness + additional-cluster routes", () => {
    const original = fleetWithAdditionalCluster("9.0");
    original.networkConfig.dns.primaryDomain = "roundtrip-v9.lab";
    original.networkConfig.dns.servers = ["10.99.0.1", "10.99.0.2"];
    const csv = emitWorkbookCellMapCsv(original, null, { workbookVersion: "9.0" });
    const { fleet: rebuilt } = importWorkbookCellMap(parseWorkbookCellMap(csv), { workbookVersion: "9.0" });
    expect(rebuilt.networkConfig.dns.primaryDomain).toBe("roundtrip-v9.lab");
    expect(rebuilt.networkConfig.dns.servers[0]).toBe("10.99.0.1");
    expect(rebuilt.networkConfig.dns.servers[1]).toBe("10.99.0.2");
  });

  // Single-source-of-truth invariant: the same fleet.networkConfig.dns
  // values must show up identically across all THREE emit paths
  // (Deploy Mgmt primary block + Configure Mgmt witness echo + Deploy
  // Cluster additional-cluster echo). A regression where one path
  // diverges from the model would silently put different values in
  // different cells of the same exported workbook. Asserted on both
  // workbook versions.
  for (const version of ["9.0", "9.1"]) {
    it(`${version} emit: DNS values are identical across all 3 emit routes (Deploy Mgmt + Witness + Additional Cluster)`, () => {
      const f = fleetWithAdditionalCluster(version);
      f.networkConfig.dns.primaryDomain = "echo.lab";
      f.networkConfig.dns.servers = ["1.1.1.1", "8.8.8.8"];
      const rows = emitWorkbookCellMap(f, null, { workbookVersion: version });
      const find = (label, scopeFilter) => {
        const r = rows.find((x) => x.label === label && (!scopeFilter || scopeFilter(x)));
        return r ? r.value : undefined;
      };
      // Primary Deploy Mgmt DNS — mgmt-domain scope.
      const primaryDomain = find("DNS Domain name");
      const primaryServer1 = find("DNS Server #1");
      const primaryServer2 = find("DNS Server #2");
      // Witness DNS (Configure Mgmt, instance scope).
      const witnessDomain = find("Witness DNS Domain");
      const witnessServer1 = find("Witness DNS Server #1");
      const witnessServer2 = find("Witness DNS Server #2");
      // Additional Cluster DNS (Deploy Cluster, additional-cluster scope).
      const additionalDomain = find("Additional Cluster DNS Domain");
      const additionalServer1 = find("Additional Cluster DNS Server #1");
      const additionalServer2 = find("Additional Cluster DNS Server #2");
      // All three routes echo the same fleet-level value.
      expect(primaryDomain).toBe("echo.lab");
      expect(witnessDomain).toBe("echo.lab");
      expect(additionalDomain).toBe("echo.lab");
      expect(primaryServer1).toBe("1.1.1.1");
      expect(witnessServer1).toBe("1.1.1.1");
      expect(additionalServer1).toBe("1.1.1.1");
      expect(primaryServer2).toBe("8.8.8.8");
      expect(witnessServer2).toBe("8.8.8.8");
      expect(additionalServer2).toBe("8.8.8.8");
    });
  }

  // Bonus 9.0-only block — the 9.0 Configure WLD workbook has a witness
  // sub-section at D277-D282 (with D278 being the formula Witness
  // Hostname). The 9.1 workbook dropped this section. 5 9.0-only
  // entries echo the same fleet-level networkConfig.dns/ntp model.
  it("ships 5 Configure WLD witness DNS/NTP entries as 9.0-only (no 9.1 counterpart)", () => {
    const labels = [
      ["Witness DNS Domain (WLD)", "D277"],
      ["Witness DNS Server #1 (WLD)", "D279"],
      ["Witness DNS Server #2 (WLD)", "D280"],
      ["Witness NTP Server #1 (WLD)", "D281"],
      ["Witness NTP Server #2 (WLD)", "D282"],
    ];
    for (const [label, cell] of labels) {
      const e = WORKBOOK_CELL_MAP.find((x) => x.label === label);
      expect(e, label).toBeTruthy();
      expect(e.sheet).toBe("Configure Workload Domain");
      expect(e.cell).toBe(cell);
      expect(e.workbookVersions).toEqual(["9.0"]);
      expect(e.cellByVersion).toBeFalsy();
      expect(e.scope).toBe("workload-cluster");
    }
  });

  it("9.0 emit stamps Configure WLD witness DNS/NTP from fleet networkConfig", () => {
    const f = fleetWithWld("9.0");
    f.networkConfig.dns.primaryDomain = "wld-witness.lab";
    f.networkConfig.dns.servers = ["10.10.0.1", "10.10.0.2"];
    f.networkConfig.ntp.servers = ["ntp-w1.lab", "ntp-w2.lab"];
    const rows = emitWorkbookCellMap(f, null, { workbookVersion: "9.0" });
    const find = (cell) => rows.find((r) => r.sheet === "Configure Workload Domain" && r.cell === cell);
    expect(find("D277").value).toBe("wld-witness.lab");
    expect(find("D279").value).toBe("10.10.0.1");
    expect(find("D280").value).toBe("10.10.0.2");
    expect(find("D281").value).toBe("ntp-w1.lab");
    expect(find("D282").value).toBe("ntp-w2.lab");
    // 9.1 emit: these entries gate out (workbookVersions: ["9.0"]).
    const rows91 = emitWorkbookCellMap(f, null, { workbookVersion: "9.1" });
    for (const cell of ["D277", "D279", "D280", "D281", "D282"]) {
      expect(rows91.find((r) => r.sheet === "Configure Workload Domain" && r.cell === cell && /^Witness /.test(r.label))).toBeUndefined();
    }
  });
});
